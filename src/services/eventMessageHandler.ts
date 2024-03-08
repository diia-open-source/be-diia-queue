import { AsyncLocalStorage } from 'async_hooks'

import { isValidTraceId, trace } from '@opentelemetry/api'
import { v4 as uuid } from 'uuid'

import { ValidationError } from '@diia-inhouse/errors'
import { PubSubService } from '@diia-inhouse/redis'
import { AlsData, Logger, PublicServiceCode } from '@diia-inhouse/types'
import { convertParamsByRules, utils } from '@diia-inhouse/utils'
import { ValidationSchema } from '@diia-inhouse/validators'

import { EventBusListener, QueueContext, QueueMessage, QueueMessageData, TaskListener } from '../interfaces'
import { EventListeners } from '../interfaces/externalCommunicator'
import { EventName, ExternalEvent } from '../interfaces/queueConfig'
import { totalMessageHandlerErrorsMetrics } from '../metrics'

import { EventMessageValidator } from './eventMessageValidator'
import { ExternalCommunicatorChannel } from './externalCommunicatorChannel'

export class EventMessageHandler {
    constructor(
        private readonly eventMessageValidator: EventMessageValidator,
        private readonly externalChannel: ExternalCommunicatorChannel,

        private readonly pubsub: PubSubService,
        private readonly asyncLocalStorage: AsyncLocalStorage<QueueContext>,
        private readonly logger: Logger,
    ) {}

    async eventListenersMessageHandler(this: this, eventListeners: EventListeners, message: QueueMessage | null): Promise<void> {
        if (!message) {
            return
        }

        const listener = eventListeners[<EventName>message.data.event]

        await this.eventListenerMessageHandler(listener, message)
    }

    async eventListenerMessageHandler(listener: EventBusListener | TaskListener | undefined, message: QueueMessage): Promise<void> {
        const payloadValidationSchema = listener?.validationRules || {}
        const { done, data, properties } = message
        const { event, payload, meta } = data
        const activeSpanTraceId = trace.getActiveSpan()?.spanContext().traceId
        const traceId = isValidTraceId(activeSpanTraceId) ? activeSpanTraceId : properties.headers?.traceId || uuid()
        const context: AlsData = {
            logData: {
                traceId,
                serviceCode: this.getServiceCode(listener, payload),
            },
        }

        await this.asyncLocalStorage.run(context, async () => {
            this.logger.io(`Handling event [${event}] with payload`, { payload })
            if (!listener) {
                this.logger.info(`No listener for the event [${event}]`)

                return done()
            }

            if ('isSync' in listener && listener.isSync) {
                return await this.syncMessageHandler(listener, message, payloadValidationSchema)
            }

            try {
                this.eventMessageValidator.validateEventMessage(data, payloadValidationSchema)
                const convertedPayload = convertParamsByRules(payload, payloadValidationSchema)
                const resp = await listener.handler?.(
                    convertedPayload,
                    convertParamsByRules(meta, this.eventMessageValidator.metaValidationSchema),
                )

                return this.performDone(message, resp, false)
            } catch (err) {
                if (err instanceof ValidationError && 'validationErrorHandler' in listener && payload?.uuid) {
                    await listener.validationErrorHandler?.(err, payload.uuid).catch((error) => error)
                }

                this.logger.error(`Failed to handle event ${event}`, { err })

                totalMessageHandlerErrorsMetrics.increment({ event })

                // TODO(BACK-0): message.reject();
                return this.performDone(message, err, true)
            }
        })
    }

    private async syncMessageHandler(
        listener: EventBusListener | undefined,
        message: QueueMessage,
        payloadValidationSchema: ValidationSchema,
    ): Promise<void> {
        const { done, data } = message
        const { event, payload, meta } = data
        if (!payload?.uuid) {
            this.logger.error('Missing uuid in the message payload')

            return done()
        }

        const channel = this.externalChannel.getChannel(<ExternalEvent>event, payload.uuid)
        const isChannelActive = await this.externalChannel.isChannelActive(channel)

        if (!isChannelActive && listener.handler) {
            try {
                this.eventMessageValidator.validateSyncedEventMessage(data, payloadValidationSchema)
            } catch (err) {
                this.logger.error(`Message in a wrong format was received from a synced event: ${event}`, { err })

                return done()
            }

            if (payload.error) {
                this.logger.error(`Error received for a synced event: ${event}`, payload.error)

                return done()
            }

            try {
                await listener.handler(payload, meta)
            } catch (err) {
                this.logger.error(`Failed to handle the synced event [${event}] with payload`, { err })
            }
        } else {
            await this.pubsub.publish(channel, data)
        }

        return done()
    }

    private performDone(receivedMessage: QueueMessage, data: unknown, error: boolean): void {
        const {
            done,
            data: { event, payload },
            properties: { replyTo, correlationId },
        } = receivedMessage

        const useDirectReply = replyTo && correlationId
        if (!useDirectReply) {
            done()

            return
        }

        if (error) {
            return utils.handleError(data, (err) => {
                done(<QueueMessageData>{
                    event,
                    meta: {
                        date: new Date(),
                    },
                    payload: {
                        uuid: payload.uuid,
                        error: {
                            message: err.message,
                            http_code: err.getCode(),
                            data: err.getData(),
                        },
                    },
                })
            })
        }

        done(<QueueMessageData>{
            event,
            meta: {
                date: new Date(),
            },
            payload: {
                uuid: payload.uuid,
                response: data,
            },
        })
    }

    private getServiceCode(listener: EventBusListener | TaskListener | undefined, payload: unknown): PublicServiceCode | undefined {
        try {
            return listener?.getServiceCode?.(payload)
        } catch (err) {
            this.logger.error('Failed to get event listener service code', { err, listener })
        }
    }
}
