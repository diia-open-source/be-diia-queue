import { randomUUID } from 'node:crypto'

import { ExternalCommunicatorError } from '@diia-inhouse/errors'
import { PubSubService } from '@diia-inhouse/redis'
import { Logger, OnRegistrationsFinished } from '@diia-inhouse/types'

import { EventBusListener, ExternalEventBusQueue, MessagePayload, PublishDirectOptions, QueueMessageData } from '../interfaces'
import { EventListeners, ExternalCommunicatorResponse, ReceiveDirectOps, ReceiveOps } from '../interfaces/externalCommunicator'
import { EventName } from '../interfaces/queueConfig'
import * as Utils from '../utils'

import { EventMessageValidator } from './eventMessageValidator'
import { ExternalCommunicatorChannel } from './externalCommunicatorChannel'

export class ExternalCommunicator implements OnRegistrationsFinished {
    private eventListeners: EventListeners

    constructor(
        private readonly externalChannel: ExternalCommunicatorChannel,
        private readonly externalEventBus: ExternalEventBusQueue,
        private readonly externalEventListenerList: EventBusListener[],
        private readonly eventMessageValidator: EventMessageValidator,

        private readonly logger: Logger,
        private readonly pubsub: PubSubService,
        private readonly timeout = 10000,
    ) {}

    onRegistrationsFinished(): void {
        this.eventListeners = Utils.collectEventBusListeners(this.externalEventListenerList)
    }

    async receiveDirect<T>(event: string, request: unknown = {}, ops: ReceiveDirectOps = {}): Promise<T> {
        const requestUuid = randomUUID()
        const payload: MessagePayload = { uuid: requestUuid, request }
        const { topic, validationRules, ignoreCache, retry, timeout } = ops
        const options: PublishDirectOptions = { ignoreCache, retry, timeout }
        const externalResponse = await this.externalEventBus.publishDirect<QueueMessageData<ExternalCommunicatorResponse<T>>>(
            event,
            payload,
            topic,
            options,
        )
        if (validationRules) {
            try {
                this.eventMessageValidator.validateSyncedEventMessage(externalResponse, validationRules)
            } catch (err) {
                const errorMsg = 'Message in a wrong format was received from a direct channel'

                this.logger.fatal(errorMsg, { err, externalResponse })
                throw new Error(errorMsg)
            }
        }

        const { error, response } = externalResponse.payload

        if (error) {
            this.logger.fatal(`Error received by an external event ${event}: ${error.http_code} ${error.message}`, request)

            throw new ExternalCommunicatorError(error.message, error.http_code, { event, httpCode: error.http_code, ...error.data })
        }

        return response
    }

    /**
     * @deprecated use receiveDirect in case provider supports direct communcation
     */
    async receive<T>(event: EventName, request: unknown = {}, ops: ReceiveOps = {}): Promise<T | undefined> {
        const timeout = ops.timeout || this.timeout
        const eventListener = this.eventListeners[event]
        if (!eventListener) {
            throw new Error(`Listener not found by the provided event: ${event}`)
        }

        if (!eventListener.isSync) {
            throw new Error(`Listener is not synchronous for the provided event: ${event}`)
        }

        const requestUuid = ops.requestUuid || randomUUID()
        const payload: MessagePayload = { uuid: requestUuid, request }
        const { ignoreCache, retry, async } = ops
        const options = { ignoreCache, retry }

        if (async) {
            const success = await this.externalEventBus.publish(event, payload, options)
            if (!success) {
                throw new Error(`Failed to publish async external event ${event}`)
            }

            return
        }

        const channel = this.externalChannel.getChannel(event, requestUuid)
        const promise = new Promise((resolve: (value: T) => void, reject: (reason: unknown) => void) => {
            const timer = setTimeout(async () => {
                await this.pubsub.unsubscribe(channel)

                return reject(new Error(`External communication timeout error for the channel ${channel}`))
            }, timeout)

            this.pubsub
                .onceChannelMessage(channel, async (message: string) => {
                    clearTimeout(timer)
                    const data: QueueMessageData<ExternalCommunicatorResponse<T>> = JSON.parse(message)
                    try {
                        this.eventMessageValidator.validateSyncedEventMessage(data, eventListener.validationRules)
                    } catch (err) {
                        const errorMsg = 'Message in a wrong format was received from a redis channel'

                        this.logger.fatal(errorMsg, { err, data })

                        return reject(new Error(errorMsg))
                    }

                    const { error, response } = data.payload
                    if (error) {
                        this.logger.fatal(`Error received by an external event ${event}: ${error.http_code} ${error.message}`, request)

                        return reject(new ExternalCommunicatorError(error.message, error.http_code, { event, ...error.data }))
                    }

                    return resolve(response)
                })
                .catch(reject)
        })

        await this.externalChannel.saveActiveChannel(channel, timeout)

        const success = await this.externalEventBus.publish(event, payload)
        if (!success) {
            await this.pubsub.unsubscribe(channel)

            throw new Error(`Failed to publish external event ${event}`)
        }

        return await promise
    }
}
