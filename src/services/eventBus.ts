import Logger from '@diia-inhouse/diia-logger'
import { OnInit } from '@diia-inhouse/types'

import {
    EventBusListener,
    EventBusQueue,
    ExchangeName,
    ExchangeType,
    MessageBrokerServiceEventsListener,
    MessagePayload,
    PublishOptions,
    PublishingResult,
} from '../interfaces/index.js'
import { ExchangeOptions } from '../interfaces/messageBrokerServiceConfig.js'
import { EventName, QueueName } from '../interfaces/queueConfig/index.js'
import { RabbitMQProvider } from '../providers/rabbitmq/index.js'
import Communicator from './communicator.js'
import { EventCommunicator } from './eventCommunicator.js'
import { EventMessageHandler } from './eventMessageHandler.js'

export class EventBus extends Communicator implements EventBusQueue, OnInit {
    private readonly eventCommunicator: EventCommunicator

    constructor(
        queueProvider: RabbitMQProvider,
        private readonly eventListenerList: EventBusListener[],
        eventMessageHandler: EventMessageHandler,
        logger: Logger,
        hostName: string,
        systemServiceName: string,
        private readonly queueName: QueueName | undefined = undefined,
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
