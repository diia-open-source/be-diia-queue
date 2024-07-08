import { EnvService } from '@diia-inhouse/env'
import { Logger, OnInit } from '@diia-inhouse/types'

import {
    EventBusListener,
    ExternalEventBusQueue,
    MessageHandler,
    MessagePayload,
    PublishDirectOptions,
    PublishExternalEventOptions,
    SubscribeOptions,
} from '../interfaces'
import { EventListeners } from '../interfaces/externalCommunicator'
import { EventName, Topic } from '../interfaces/queueConfig'
import { RabbitMQProvider } from '../providers/rabbitmq'
import * as Utils from '../utils'

import { EventMessageHandler } from './eventMessageHandler'

export class ExternalEventBus implements ExternalEventBusQueue, OnInit {
    constructor(
        private readonly queueProvider: RabbitMQProvider,
        private readonly externalEventListenerList: EventBusListener[],
        private readonly eventMessageHandler: EventMessageHandler,

        private readonly envService: EnvService,
        private readonly logger: Logger,
    ) {}

    async onInit(): Promise<void> {
        const externalConfig = this.queueProvider.getConfig()
        try {
            if (externalConfig.custom?.responseRoutingKeyPrefix && !this.envService.isLocal() && !this.envService.isTest()) {
                throw new Error('Response routing key could be used only on local env')
            }

            const eventListeners: EventListeners = Utils.collectEventBusListeners(this.externalEventListenerList)

            await this.subscribe(this.eventMessageHandler.eventListenersMessageHandler.bind(this.eventMessageHandler, eventListeners), {
                listener: externalConfig.listenerOptions,
            })

            for (const listener of this.externalEventListenerList) {
                this.logger.info(`External event listener [${listener.event}] initialized successfully`)
            }
        } catch (err) {
            this.logger.error('Failed to initialize external event bus', { err })
            throw err
        }
    }

    async subscribe(messageHandler: MessageHandler, options?: SubscribeOptions): Promise<boolean> {
        return await this.queueProvider.subscribeExternal(messageHandler, options)
    }

    async publish(eventName: EventName, message: MessagePayload, options?: PublishExternalEventOptions): Promise<boolean> {
        return await this.queueProvider.publishExternal(eventName, message, options)
    }

    async publishDirect<T>(eventName: EventName, message: MessagePayload, topic?: Topic, options?: PublishDirectOptions): Promise<T> {
        return await this.queueProvider.publishExternalDirect(eventName, message, topic, options)
    }
}
