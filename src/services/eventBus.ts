import { Logger, OnInit } from '@diia-inhouse/types'

import { EventBusListener, EventBusQueue, MessageHandler, MessagePayload, SubscribeOptions } from '../interfaces'
import { InternalEvent, InternalQueueName } from '../interfaces/queueConfig'
import { RabbitMQProvider } from '../providers/rabbitmq'
import * as Utils from '../utils'

import { EventMessageHandler } from './eventMessageHandler'

export class EventBus implements EventBusQueue, OnInit {
    constructor(
        private readonly queueProvider: RabbitMQProvider,
        private readonly eventListenerList: EventBusListener[],
        private readonly eventMessageHandler: EventMessageHandler,

        private readonly logger: Logger,
        private readonly queueName: InternalQueueName | undefined = undefined,
    ) {}

    async onInit(): Promise<void> {
        await this.queueProvider.init?.()
        if (!this.queueName) {
            return
        }

        const config = this.queueProvider.getConfig()
        const eventListeners = Utils.collectEventBusListeners(this.eventListenerList)

        await this.subscribe(
            this.queueName,
            this.eventMessageHandler.eventListenersMessageHandler.bind(this.eventMessageHandler, eventListeners),
            {
                listener: config.listenerOptions,
            },
        )

        this.eventListenerList.forEach((listener) => {
            this.logger.info(`Event listener [${listener.event}] initialized successfully`)
        })
    }

    async subscribe(subscriptionName: InternalQueueName, messageHandler: MessageHandler, options?: SubscribeOptions): Promise<boolean> {
        return await this.queueProvider.subscribe(subscriptionName, messageHandler, options)
    }

    async publish(eventName: InternalEvent, message: MessagePayload, routingKey?: string): Promise<boolean> {
        return await this.queueProvider.publish(eventName, message, routingKey)
    }
}
