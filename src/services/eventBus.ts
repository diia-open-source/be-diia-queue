import Logger from '@diia-inhouse/diia-logger'
import { OnInit } from '@diia-inhouse/types'

import {
    EventBusListener,
    EventBusQueue,
    ExchangeName,
    ExchangeType,
    MessageBrokerServiceEventsListener,
    PublishOptions,
    PublishingResult,
} from '../interfaces'
import { ExchangeOptions } from '../interfaces/messageBrokerServiceConfig'
import { MessagePayload } from '../interfaces/providers/rabbitmq/amqpPublisher'
import { EventName, QueueName } from '../interfaces/queueConfig'
import { RabbitMQProvider } from '../providers/rabbitmq'
import Communicator from './communicator'
import { EventCommunicator } from './eventCommunicator'
import { EventMessageHandler } from './eventMessageHandler'

export class EventBus extends Communicator implements EventBusQueue, OnInit {
    private readonly eventCommunicator: EventCommunicator

    constructor(
        queueProvider: RabbitMQProvider,
        private readonly eventListenerList: EventBusListener[],
        eventMessageHandler: EventMessageHandler,
        logger: Logger,
        hostName: string,
        systemServiceName: string,
        private readonly queueName?: QueueName,
    ) {
        super(logger, queueProvider, hostName, systemServiceName)

        this.eventCommunicator = new EventCommunicator(logger, queueProvider, eventMessageHandler, eventListenerList)
    }

    async publish(eventName: EventName, payload: MessagePayload, options?: PublishOptions): Promise<PublishingResult> {
        return await this.publishEventToExchange(eventName, payload, options)
    }

    protected getExchangeNameWithSuffix(exchangeName: ExchangeName): string {
        return exchangeName
    }

    protected getUnicastListeners(): MessageBrokerServiceEventsListener[] {
        return this.eventCommunicator.getUnicastListeners()
    }

    protected getProducerExchangesOptions(): ExchangeOptions[] {
        if (!this.queueName) {
            return []
        }

        const {
            rabbit: { declareOptions: { assertExchanges } = {} },
        } = this.queueProvider.getConfig()

        const exchangeNames = this.optionsBuilder.getExchangeNamesByQueueName(this.queueName)

        const exchangesOptions: ExchangeOptions[] = []

        for (const exchangeName of exchangeNames) {
            exchangesOptions.push({
                name: exchangeName,
                declare: assertExchanges,
                type: ExchangeType.Topic,
            })
        }

        return exchangesOptions
    }

    protected getMulticastListeners(): MessageBrokerServiceEventsListener[] {
        if (!this.queueName || this.eventListenerList.length === 0) {
            return []
        }

        const [queueOptions] = this.optionsBuilder.defineQueueOptionsBasedOnGlobalConfig(this.queueName)
        if (!queueOptions) {
            return []
        }

        const exchangesOptions = this.getProducerExchangesOptions()

        return this.eventCommunicator.getMulticastListeners([queueOptions], exchangesOptions)
    }
}
