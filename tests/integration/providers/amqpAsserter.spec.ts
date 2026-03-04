import { GetMessage } from 'amqplib'

import Logger from '@diia-inhouse/diia-logger'
import { RandomUtils } from '@diia-inhouse/utils'

import { ExchangeOptions, ExchangeType, MessageHeaders, QueueMessageData, QueueOptions, QueueTypes } from '@src/interfaces'
import { AmqpAsserter } from '@src/providers/rabbitmq/amqpAsserter'
import { AmqpConnection } from '@src/providers/rabbitmq/amqpConnection'
import { AmqpPublisher } from '@src/providers/rabbitmq/amqpPublisher'

import RabbitMQMetricsService from '@services/metrics'

import { getRabbitMQConfig } from '@mocks/config'
import { getExpectedMsgData } from '@mocks/providers/rabbitmq/amqpPublisher'
import { makeMockMetricsService } from '@mocks/services/metricsService'

describe(`${AmqpAsserter.name}`, async () => {
    const connectionConfig = getRabbitMQConfig({ assertQueues: true, assertExchanges: true })

    const logger = new Logger()

    const amqpConnection = new AmqpConnection(
        connectionConfig.connection,
        logger,
        connectionConfig.reconnectOptions,
        connectionConfig.socketOptions,
    )

    await amqpConnection.connect()

    const metrics = makeMockMetricsService()

    const rabbitmqMetricsService = new RabbitMQMetricsService(metrics)

    const systemServiceName = 'test-service-name'

    const amqpPublisher: AmqpPublisher = new AmqpPublisher(amqpConnection, logger, rabbitmqMetricsService, systemServiceName, {})

    await amqpPublisher.init()

    describe(`method ${AmqpAsserter.prototype.redeclareQueue.name}`, () => {
        it('should redeclare queue', async () => {
            // Arrange
            const amqpAsserter = new AmqpAsserter(amqpConnection, logger)

            const exchangeOptions: ExchangeOptions = {
                declare: true,
                name: 'TestRedeclareDirectExchangeName',
                type: ExchangeType.Direct,
                options: {
                    durable: true,
                    alternateExchange: 'TestTopicExchangeName',
                },
            }

            const { name: exchangeName } = exchangeOptions

            const routingKey = 'test-routing-key.res'
            const queueOptions: QueueOptions = {
                declare: true,
                name: 'TestRedeclareQueueName',
                type: QueueTypes.Classic,
                bindTo: [
                    {
                        bind: true,
                        routingKey: routingKey,
                        exchangeName: exchangeName,
                    },
                ],
                redeclareOptions: {
                    type: QueueTypes.Quorum,
                    options: {
                        durable: true,
                    },
                },
            }

            const { name: queueName } = queueOptions

            const messageData: QueueMessageData = getExpectedMsgData('test-event', {
                data: 'message',
            })

            const headers: MessageHeaders = {
                traceId: 'test-trace-id',
            }

            await amqpAsserter.init([exchangeOptions], [queueOptions])

            const messageCount = 2

            await Promise.all(
                Array.from({ length: messageCount }).map(
                    async () => await amqpPublisher.publishToExchange(exchangeName, messageData, headers, routingKey),
                ),
            )

            // Act
            await amqpAsserter.declareQueues(
                [{ ...queueOptions, redeclareOptions: { redeclare: true, type: QueueTypes.Quorum, options: { durable: true } } }],
                [exchangeOptions],
            )

            // Assert
            const messages: GetMessage[] = []

            const channel = await amqpConnection.createChannel()

            while (true) {
                const message = await channel.get(queueName, { noAck: true })
                if (!message) {
                    break
                }

                messages.push(message)
            }

            await amqpAsserter.deleteQueue(queueName)

            expect(messages).toHaveLength(messageCount)
        })
        it('should redeclare broadcasted queue', async () => {
            // Arrange
            const amqpAsserter = new AmqpAsserter(amqpConnection, logger)

            const exchangeOptions1: ExchangeOptions = {
                declare: true,
                name: `TestTopicExchangeName-${RandomUtils.generateUUID()}`,
                type: ExchangeType.Topic,
                options: {
                    durable: true,
                },
            }

            const { name: exchangeName1 } = exchangeOptions1

            const exchangeOptions2: ExchangeOptions = {
                declare: true,
                name: `TestTopicExchangeName-${RandomUtils.generateUUID()}`,
                type: ExchangeType.Topic,
                options: {
                    durable: true,
                },
            }

            const { name: exchangeName2 } = exchangeOptions2

            const routingKey = '*'
            const queueOptions: QueueOptions = {
                declare: true,
                name: `TestQueueName1-${RandomUtils.generateUUID()}`,
                type: QueueTypes.Classic,
                bindTo: [
                    {
                        bind: true,
                        routingKey: routingKey,
                        exchangeName: exchangeName1,
                    },
                    {
                        bind: true,
                        routingKey: routingKey,
                        exchangeName: exchangeName2,
                    },
                ],
            }

            const { name: queueName } = queueOptions

            const messageData: QueueMessageData = getExpectedMsgData('test-event', {
                data: 'message',
            })

            const headers: MessageHeaders = {
                traceId: 'test-trace-id',
            }

            const exchangesOptions = [exchangeOptions1, exchangeOptions2]

            await amqpAsserter.init(exchangesOptions, [queueOptions])

            const messageCount = exchangesOptions.length

            for (const exchangeOptions of exchangesOptions) {
                const { name: exchangeName } = exchangeOptions

                await amqpPublisher.publishToExchange(exchangeName, messageData, headers, routingKey)
            }

            // Act
            await amqpAsserter.declareQueues(
                [{ ...queueOptions, redeclareOptions: { redeclare: true, type: QueueTypes.Quorum, options: { durable: true } } }],
                exchangesOptions,
            )

            // Assert
            const messages: GetMessage[] = []

            const channel = await amqpConnection.createChannel()

            while (true) {
                const message = await channel.get(queueName, { noAck: true })
                if (!message) {
                    break
                }

                messages.push(message)
            }

            await amqpAsserter.deleteQueue(queueName)
            await amqpAsserter.deleteExchange(exchangeName1)
            await amqpAsserter.deleteExchange(exchangeName2)

            expect(messages).toHaveLength(messageCount)
        })
    })
    describe(`method ${AmqpAsserter.prototype.disconnect.name}`, () => {
        it('should disconnect successfully', async () => {
            // Arrange
            const amqpAsserter = new AmqpAsserter(amqpConnection, logger)

            await amqpAsserter.init()

            const createChannelMock = vi.spyOn(amqpConnection, 'createChannel')

            // Act
            await amqpAsserter.disconnect()

            // Assert
            await new Promise((resolve) => setTimeout(resolve, 1000))

            expect(createChannelMock).not.toHaveBeenCalled()
        })
    })
})
