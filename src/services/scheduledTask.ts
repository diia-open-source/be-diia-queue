import Logger from '@diia-inhouse/diia-logger'
import { OnInit } from '@diia-inhouse/types'

import {
    EventBusListener,
    ExchangeName,
    ExchangeType,
    MessageBrokerServiceEventsListener,
    PublishingResult,
    ScheduledTasksQueue,
} from '../interfaces'
import { ExchangeOptions } from '../interfaces/messageBrokerServiceConfig'
import { QueueName } from '../interfaces/queueConfig'
import { RabbitMQProvider } from '../providers/rabbitmq'
import Communicator from './communicator'
import { EventCommunicator } from './eventCommunicator'
import { EventMessageHandler } from './eventMessageHandler'

/**
 * @deprecated use pkg-workflow entities instead
 */
export class ScheduledTask extends Communicator implements ScheduledTasksQueue, OnInit {
    private readonly eventCommunicator: EventCommunicator

    private readonly eventRoutingPart: string = 'scheduled-task'

    constructor(
        private readonly serviceName: string,
        systemServiceName: string,
        queueProvider: RabbitMQProvider,
        protected readonly scheduledTaskList: EventBusListener[],
        eventMessageHandler: EventMessageHandler,
        logger: Logger,
        hostName: string,
        private readonly queueName?: QueueName,
    ) {
        super(logger, queueProvider, hostName, systemServiceName)

        this.eventCommunicator = new EventCommunicator(logger, queueProvider, eventMessageHandler, scheduledTaskList)
    }

    async publish(eventName: string, serviceName: string): Promise<PublishingResult> {
        const routingKey = this.getRoutingKey(serviceName)

        return await this.publishEventToExchange(eventName, {}, { routingKey })
    }

    protected getExchangeNameWithSuffix(exchangeName: ExchangeName): string {
        return exchangeName
    }

    protected getUnicastListeners(): MessageBrokerServiceEventsListener[] {
        return this.eventCommunicator.getUnicastListeners()
    }

    protected getMulticastListeners(): MessageBrokerServiceEventsListener[] {
        if (!this.queueName || this.scheduledTaskList.length === 0) {
            return []
        }

        const routingKey = this.getRoutingKey(this.serviceName)

        const [queueOptions] = this.optionsBuilder.defineQueueOptionsBasedOnGlobalConfig(this.queueName, routingKey)
        if (!queueOptions) {
            return []
        }

        const exchangesOptions = this.getProducerExchangesOptions()

        return this.eventCommunicator.getMulticastListeners([queueOptions], exchangesOptions)
    }

    protected override getProducerExchangesOptions(): ExchangeOptions[] {
        const exchangesOptions: ExchangeOptions[] = []

        const {
            topics = {},
            rabbit: { declareOptions: { assertExchanges } = {} },
        } = this.queueProvider.getConfig()

        const createExchangeOptions = (exchangeName: string): ExchangeOptions => ({
            name: exchangeName,
            type: ExchangeType.Topic,
            declare: assertExchanges,
        })

        const exchangeNamesByQueueName = this.optionsBuilder.getExchangeNamesByQueueName(this.queueName)

        const exchangeNamesSet = new Set([...Object.keys(topics), ...exchangeNamesByQueueName])

        for (const exchangeName of exchangeNamesSet) {
            const exchangeOptions = createExchangeOptions(exchangeName)

            exchangesOptions.push(exchangeOptions)
        }

        return exchangesOptions
    }

    private getRoutingKey(serviceName: string): string {
        return `${serviceName}.${this.eventRoutingPart}`
    }
}
