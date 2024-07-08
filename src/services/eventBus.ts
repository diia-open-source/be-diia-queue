import { Logger, OnInit } from '@diia-inhouse/types'

import { EventBusListener, EventBusQueue } from '../interfaces/eventBus'
import { MessageHandler } from '../interfaces/messageHandler'
import { PublishInternalEventOptions, SubscribeOptions } from '../interfaces/options'
import { MessagePayload } from '../interfaces/providers/rabbitmq/amqpPublisher'
import { QueueName } from '../interfaces/queueConfig'
import { RabbitMQProvider } from '../providers/rabbitmq'
import * as Utils from '../utils'

import { EventMessageHandler } from './eventMessageHandler'

export class EventBus implements EventBusQueue, OnInit {
    constructor(
        private readonly queueProvider: RabbitMQProvider,
        private readonly eventListenerList: EventBusListener[],
        private readonly eventMessageHandler: EventMessageHandler,

        private readonly logger: Logger,
        private readonly queueName: QueueName | undefined,
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

        for (const listener of this.eventListenerList) {
            this.logger.info(`Event listener [${listener.event}] initialized successfully`)
        }
    }

    async subscribe(subscriptionName: QueueName, messageHandler: MessageHandler, options?: SubscribeOptions): Promise<boolean> {
        return await this.queueProvider.subscribe(subscriptionName, messageHandler, options)
    }

    async publish(eventName: QueueName, message: MessagePayload, options?: PublishInternalEventOptions): Promise<boolean> {
        return await this.queueProvider.publish(eventName, message, options)
    }
}
