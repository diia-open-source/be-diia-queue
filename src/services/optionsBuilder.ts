import constants from '../constants'
import { BindOptions, ConsumerOptions, ExchangeName, QueueOptions, QueueTypes } from '../interfaces/messageBrokerServiceConfig'
import { QueueName } from '../interfaces/queueConfig'
import { RabbitMQProvider } from '../providers/rabbitmq'

export default class OptionsBuilder {
    constructor(private readonly queueProvider: RabbitMQProvider) {}

    defineQueueOptionsBasedOnGlobalConfig(queueName?: QueueName, routingKey: string = constants.DEFAULT_ROUTING_KEY): QueueOptions[] {
        if (!queueName) {
            return []
        }

        const {
            rabbit: {
                listenerOptions: { queueOptions } = {},
                declareOptions: { assertQueues, queuesOptions: overriddenQueuesOptions = {} } = {},
            },
        } = this.queueProvider.getConfig()

        const exchangeNames = this.getExchangeNamesByQueueName(queueName)

        const bindTo: BindOptions[] = []

        for (const exchangeName of exchangeNames) {
            bindTo.push({
                routingKey,
                exchangeName,
                bind: assertQueues,
            })
        }

        return [
            {
                bindTo,
                name: queueName,
                declare: assertQueues,
                options: queueOptions,
                type: QueueTypes.Quorum,
                consumerOptions: this.defineConsumerOptionsBasedOnGlobalConfig(),
                ...overriddenQueuesOptions,
            },
        ]
    }

    defineConsumerOptionsBasedOnGlobalConfig(): ConsumerOptions {
        const {
            rabbit: { listenerOptions: { prefetchCount, recreateChannelOptions = {} } = {} },
        } = this.queueProvider.getConfig()

        return {
            prefetchCount,
            recreateChannelOptions,
        }
    }

    getExchangeNamesByQueueName(queueName?: QueueName): ExchangeName[] {
        if (!queueName) {
            return []
        }

        const { queues } = this.queueProvider.getConfig()
        if (!queues) {
            return []
        }

        const queue = queues[queueName]

        return queue?.topics || []
    }
}
