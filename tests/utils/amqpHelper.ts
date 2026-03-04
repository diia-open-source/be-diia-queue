import DiiaLogger from '@diia-inhouse/diia-logger'

import { ExchangeOptions, MessageHeaders, QueueMessageData, QueueOptions, RabbitMQConfig } from '@src/interfaces'
import { AmqpAsserter, AmqpConnection, AmqpListener, AmqpPublisher } from '@src/providers'

import { makeMockRabbitMQMetricsService } from '@mocks/services/metricsService'

export default class AmqpHelper {
    private readonly amqpAsserter: AmqpAsserter
    private readonly amqpListener: AmqpListener
    private readonly amqpPublisher: AmqpPublisher
    private readonly amqpConnection: AmqpConnection

    constructor(connectionConfig: RabbitMQConfig) {
        const logger = new DiiaLogger()

        const { connection, reconnectOptions, socketOptions } = connectionConfig

        this.amqpConnection = new AmqpConnection(connection, logger, reconnectOptions, socketOptions)

        const systemServiceName = 'amqp-tester'
        const rabbitMQMetricsService = makeMockRabbitMQMetricsService()

        this.amqpAsserter = new AmqpAsserter(this.amqpConnection, logger)
        this.amqpPublisher = new AmqpPublisher(this.amqpConnection, logger, rabbitMQMetricsService, systemServiceName)
        this.amqpListener = new AmqpListener(this.amqpConnection, logger, rabbitMQMetricsService, [], systemServiceName)
    }

    async init(): Promise<void> {
        await this.amqpConnection.connect()
        await this.amqpAsserter.init()
        await this.amqpListener.init()
        await this.amqpPublisher.init()
    }

    async publishMessageToExchange(exchangeName: string, payload: QueueMessageData, routingKey: string): Promise<void> {
        const headers: MessageHeaders = { traceId: 'test-trace-id' }

        await this.amqpPublisher.publishToExchange(exchangeName, payload, headers, routingKey)
    }

    async deleteQueues(queuesNames: string[]): Promise<void> {
        await this.amqpAsserter.deleteQueues(queuesNames)
    }

    async assertExchanges(exchangesOptions: ExchangeOptions[]): Promise<void> {
        await this.amqpAsserter.assertExchanges(exchangesOptions)
    }

    async assertQueues(queuesOptions: QueueOptions[]): Promise<void> {
        await this.amqpAsserter.assertQueues(queuesOptions)
    }

    async readMessagesFromQueue(queueName: string): Promise<unknown[]> {
        const channel = await this.amqpConnection.createChannel()

        const messages = []

        while (true) {
            const message = await channel.get(queueName, { noAck: true })
            if (!message) {
                break
            }

            messages.push(JSON.parse(message.content.toString()))
        }

        return messages
    }

    async unbindQueue(queueName: string, routingKey: string, exchangeName: string): Promise<void> {
        await this.amqpAsserter.unbindQueueFromExchange(queueName, {
            routingKey,
            exchangeName,
            unbind: true,
        })
    }
}
