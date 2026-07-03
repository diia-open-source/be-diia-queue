import Logger from '@diia-inhouse/diia-logger'
import { OnInit } from '@diia-inhouse/types'

import {
    EventBusListener,
    ExchangeName,
    ExchangeType,
    MessageBrokerServiceEventsListener,
    PublishingResult,
    ScheduledTasksQueue,
} from '../interfaces/index.js'
import { ExchangeOptions } from '../interfaces/messageBrokerServiceConfig.js'
import { QueueName } from '../interfaces/queueConfig/index.js'
import { RabbitMQProvider } from '../providers/rabbitmq/index.js'
import Communicator from './communicator.js'
import { EventCommunicator } from './eventCommunicator.js'
import { EventMessageHandler } from './eventMessageHandler.js'

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
        private readonly queueName: QueueName | undefined = undefined,
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
        const globalExchangesOptions: ExchangeOptions[] = []

        const {
            topics = {},
            rabbit: { declareOptions: { assertExchanges } = {} },
        } = this.queueProvider.getConfig()

        const createExchangeOptions = (exchangeName: string): ExchangeOptions => ({
            name: exchangeName,
            type: ExchangeType.Topic,
            declare: assertExchanges,
        })

        const globalExchangeNamesByQueueName = this.optionsBuilder.getExchangeNamesByQueueName(this.queueName)

        const globalExchangeNamesSet = new Set([...Object.keys(topics), ...globalExchangeNamesByQueueName])

        for (const globalExchangeName of globalExchangeNamesSet) {
            const exchangeOptions = createExchangeOptions(globalExchangeName)

            globalExchangesOptions.push(exchangeOptions)
        }

        const { exchangesOptions: messageBrokerServiceConfigExchangesOptions } = this.queueProvider.getMessageBrokerServiceConfig()

        return [...globalExchangesOptions, ...messageBrokerServiceConfigExchangesOptions]
    }

    private getRoutingKey(serviceName: string): string {
        return `${serviceName}.${this.eventRoutingPart}`
    }
}
