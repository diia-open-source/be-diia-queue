import { AsyncLocalStorage } from 'node:async_hooks'
import { randomBytes } from 'node:crypto'

import { context as otelContext, isValidTraceId, propagation, trace } from '@opentelemetry/api'

import Logger from '@diia-inhouse/diia-logger'
import { MetricsService } from '@diia-inhouse/diia-metrics'
import { ApiError, ErrorType, ValidationError } from '@diia-inhouse/errors'
import { AlsData } from '@diia-inhouse/types'
import { utils } from '@diia-inhouse/utils'

import {
    EventBusListener,
    EventListeners,
    Headers,
    LabelUnknown,
    Listener,
    MessageProperties,
    NackOptions,
    QueueContext,
    QueueMessage,
    QueueMessageData,
    QueueMessageError,
    TaskListener,
} from '../interfaces/index.js'
import { ValidationResult } from '../interfaces/services/eventMessageHandler.js'
import { EventMessageValidator } from './eventMessageValidator.js'
import RabbitMQMetricsService from './metrics.js'

export class EventMessageHandler {
    private readonly noRequeueNackOptions = new NackOptions(false, false)

    private readonly rabbitMQMetrics: RabbitMQMetricsService

    constructor(
        private readonly eventMessageValidator: EventMessageValidator,
        private readonly asyncLocalStorage: AsyncLocalStorage<QueueContext>,
        private readonly logger: Logger,
        private readonly systemServiceName: string,
        metrics: MetricsService,
    ) {
        this.rabbitMQMetrics = new RabbitMQMetricsService(metrics)
    }

    async eventListenersMessageHandler(this: this, eventListeners: EventListeners, message: QueueMessage | null): Promise<void> {
        if (!message) {
            return
        }

        const listener = eventListeners[message.data.event]

        await this.eventListenerMessageHandler(listener, message)
    }

    async eventListenerMessageHandler(listener: EventBusListener | TaskListener | undefined, message: QueueMessage): Promise<void> {
        const startTime = process.hrtime.bigint()
        const {
            done,
            properties,
            data: { event, payload },
        } = message

        const serviceCode = this.getServiceCode(listener, payload)
        const context = this.prepareAsyncContext(properties, serviceCode)

        const errorType = await this.asyncLocalStorage.run(context, async () => {
            this.logger.info(`Handling event [${event}] with payload`, { payload })
            if (!listener) {
                this.logger.info(`Not found listener for the event [${event}]`)
                done()

                return
            }

            return await this.handleMessage(listener, message)
        })

        const source = properties.headers?.[Headers.sentFrom] || LabelUnknown

        this.rabbitMQMetrics.collectResponseTotalMetric(startTime, event || LabelUnknown, source, this.systemServiceName, errorType)
    }

    private prepareAsyncContext(properties: MessageProperties, serviceCode?: string): AlsData {
        return {
            logData: {
                traceId: this.resolveTraceId(properties),
                serviceCode,
            },
        }
    }

    private async handleMessage(listener: EventBusListener | TaskListener, message: QueueMessage): Promise<ErrorType | undefined> {
        const {
            data,
            done,
            reject,
            properties: { replyTo, correlationId },
        } = message
        const { event, payload, meta } = data

        const useDirectReply = replyTo && correlationId

        let hasErrorOccurred = false
        let result: unknown

        const { isValid, error } = await this.validateData(data, listener)

        if (!isValid) {
            if (useDirectReply && error) {
                this.directReplyDone(message, error, true)
            } else {
                reject(this.noRequeueNackOptions)
            }

            return this.getErrorType(error)
        }

        try {
            result = await listener.handler?.(payload, meta)
        } catch (err) {
            result = err
            hasErrorOccurred = true

            this.logger.error(`Failed to handle event ${event}`, { err })
        }

        if (useDirectReply) {
            this.directReplyDone(message, result, hasErrorOccurred)
        } else if (result instanceof NackOptions) {
            reject(result)
        } else if (hasErrorOccurred && listener.nackOptions) {
            reject(listener.nackOptions)
        } else {
            done()
        }

        return hasErrorOccurred ? this.getErrorType(result) : undefined
    }

    private getErrorType(err: unknown): ErrorType {
        return err instanceof ApiError ? err.getType() : ErrorType.Unoperated
    }

    private async validateData(data: QueueMessageData, listener: Listener): Promise<ValidationResult> {
        const { payload } = data
        const { validationRules } = listener

        try {
            this.eventMessageValidator.validateEventMessage(data, validationRules)

            return { isValid: true }
        } catch (err) {
            this.logger.error('Failed to validate event message', { err })
            if (err instanceof ValidationError && 'validationErrorHandler' in listener && payload?.uuid) {
                const eventBusListener = listener as EventBusListener

                await eventBusListener.validationErrorHandler?.(err, payload.uuid).catch((err_) => err_)
            }

            return err instanceof ValidationError ? { isValid: false, error: err } : { isValid: false }
        }
    }

    private directReplyDone(receivedMessage: QueueMessage, response: unknown, error: boolean): void {
        const {
            done,
            data: {
                event,
                payload: { uuid },
            },
        } = receivedMessage

        const data: unknown = error ? utils.handleError(response, (err) => err) : response

        const messageData: QueueMessageData = {
            event,
            meta: {
                date: new Date(),
            },
            payload: {
                uuid,
                ...(data instanceof ApiError ? { error: this.prepareQueueMessageError(data) } : { response: data }),
            },
        }

        done(messageData)
    }

    private getServiceCode(listener: EventBusListener | TaskListener | undefined, payload: unknown): string | undefined {
        try {
            return listener?.getServiceCode?.(payload)
        } catch (err) {
            this.logger.error('Failed to get event listener service code', { err, listener })
        }
    }

    private prepareQueueMessageError(err: ApiError): QueueMessageError {
        return {
            data: err.getData(),
            message: err.message,
            http_code: err.getCode(),
        }
    }

    // Prefer the trace context propagated on the message — trace.getActiveSpan() misses it
    // when the inbound span isn't active in this handler's scope.
    private resolveTraceId(properties: MessageProperties): string {
        const carrier = this.toPropagationCarrier(properties.headers)
        const extractedTraceId = trace.getSpan(propagation.extract(otelContext.active(), carrier))?.spanContext().traceId ?? ''
        if (isValidTraceId(extractedTraceId)) {
            return extractedTraceId
        }

        const activeSpanTraceId = trace.getActiveSpan()?.spanContext().traceId ?? ''
        if (isValidTraceId(activeSpanTraceId)) {
            return activeSpanTraceId
        }

        return properties.headers?.traceId || randomBytes(16).toString('hex')
    }

    private toPropagationCarrier(headers: MessageProperties['headers']): Record<string, string> {
        const carrier: Record<string, string> = {}
        for (const [key, value] of Object.entries(headers ?? {})) {
            if (value === undefined || value === null) {
                continue
            }

            carrier[key] = Buffer.isBuffer(value) ? value.toString('utf8') : String(value)
        }

        return carrier
    }
}
