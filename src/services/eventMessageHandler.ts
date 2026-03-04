import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'

import { isValidTraceId, trace } from '@opentelemetry/api'

import Logger from '@diia-inhouse/diia-logger'
import { ApiError, ValidationError } from '@diia-inhouse/errors'
import { AlsData } from '@diia-inhouse/types'
import { utils } from '@diia-inhouse/utils'

import {
    EventBusListener,
    EventListeners,
    Listener,
    MessageProperties,
    NackOptions,
    QueueContext,
    QueueMessage,
    QueueMessageData,
    QueueMessageError,
    TaskListener,
} from '../interfaces'
import { EventName } from '../interfaces/queueConfig'
import { ValidationResult } from '../interfaces/services/eventMessageHandler'
import { EventMessageValidator } from './eventMessageValidator'

export class EventMessageHandler {
    private readonly noRequeueNackOptions = new NackOptions(false, false)

    constructor(
        private readonly eventMessageValidator: EventMessageValidator,
        private readonly asyncLocalStorage: AsyncLocalStorage<QueueContext>,
        private readonly logger: Logger,
    ) {}

    async eventListenersMessageHandler(this: this, eventListeners: EventListeners, message: QueueMessage | null): Promise<void> {
        if (!message) {
            return
        }

        const listener = eventListeners[message.data.event as EventName]

        await this.eventListenerMessageHandler(listener, message)
    }

    async eventListenerMessageHandler(listener: EventBusListener | TaskListener | undefined, message: QueueMessage): Promise<void> {
        const {
            done,
            properties,
            data: { event, payload },
        } = message

        const serviceCode = this.getServiceCode(listener, payload)
        const context = this.prepareAsyncContext(properties, serviceCode)

        await this.asyncLocalStorage.run(context, async () => {
            this.logger.info(`Handling event [${event}] with payload`, { payload })
            if (!listener) {
                this.logger.info(`Not found listener for the event [${event}]`)

                return done()
            }

            return await this.handleMessage(listener, message)
        })
    }

    private prepareAsyncContext(properties: MessageProperties, serviceCode?: string): AlsData {
        const activeSpanTraceId = trace.getActiveSpan()?.spanContext().traceId ?? ''
        const traceId = isValidTraceId(activeSpanTraceId) ? activeSpanTraceId : properties.headers?.traceId || randomUUID()

        return {
            logData: {
                traceId,
                serviceCode,
            },
        }
    }

    private async handleMessage(listener: EventBusListener | TaskListener, message: QueueMessage): Promise<void> {
        const {
            data,
            done,
            reject,
            properties: { replyTo, correlationId },
        } = message
        const { event, payload, meta } = data

        const useDirectReply = replyTo && correlationId

        let hasErrorOccurred = false
        let result: unknown | void | NackOptions

        const { isValid, error } = await this.validateData(data, listener)

        if (!isValid) {
            if (useDirectReply && error) {
                return this.directReplyDone(message, error, true)
            }

            return reject(this.noRequeueNackOptions)
        }

        try {
            result = await listener.handler?.(payload, meta)
        } catch (err) {
            result = err
            hasErrorOccurred = true

            this.logger.error(`Failed to handle event ${event}`, { err })
        }

        if (useDirectReply) {
            return this.directReplyDone(message, result, hasErrorOccurred)
        }

        if (result instanceof NackOptions) {
            return reject(result)
        } else if (hasErrorOccurred && listener.nackOptions) {
            return reject(listener.nackOptions)
        }

        return done()
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

        const data: unknown | ApiError = error ? utils.handleError(response, (err) => err) : response

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
}
