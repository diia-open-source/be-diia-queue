import { expect } from 'vitest'

import Logger from '@diia-inhouse/diia-logger'

import { ExchangeOptions, MessageHandler, QueueMessage, QueueMessageData, QueueTypes } from '@src/interfaces'
import { AmqpAsserter, AmqpConnection, AmqpListener } from '@src/providers'

import RabbitMQMetricsService from '@services/metrics'

import { getExchangeOptions, getQueueOptions, getRabbitMQConfig } from '@mocks/config'
import { getExpectedMsgData, getMsgData } from '@mocks/providers/rabbitmq/amqpPublisher'
import { makeMockMetricsService } from '@mocks/services/metricsService'

import AmqpHelper from '@tests/utils/amqpHelper'

describe(`${AmqpListener.name}`, async () => {
    const connectionConfig = getRabbitMQConfig({ assertQueues: true, assertExchanges: true })

    const amqpHelper = new AmqpHelper(connectionConfig)

    await amqpHelper.init()

    const logger = new Logger()

    const defaultAmqpConnection = new AmqpConnection(
        connectionConfig.connection,
        logger,
        connectionConfig.reconnectOptions,
        connectionConfig.socketOptions,
    )

    await defaultAmqpConnection.connect()

    const metrics = makeMockMetricsService()

    const rabbitmqMetricsService = new RabbitMQMetricsService(metrics)

    const systemServiceName = 'test-service-name'

    const defaultAmqpAsserter = new AmqpAsserter(defaultAmqpConnection, logger)

    describe(`method ${AmqpListener.prototype.listenQueue.name}`, () => {
        it('should reconnect while deleted queue is being listening', async (context) => {
            // Arrange
            const amqpListener = new AmqpListener(defaultAmqpConnection, logger, rabbitmqMetricsService, [], systemServiceName)

            await amqpListener.init()

            const exchangeOptions: ExchangeOptions = getExchangeOptions({
                name: `TestExchangeName-${context.task.name}`,
                options: {
                    durable: true,
                    alternateExchange: 'TestTopicExchangeName',
                },
            })

            const { name: exchangeName } = exchangeOptions

            const routingKey = 'test-routing-key.res'
            const queueOptions = getQueueOptions({
                name: `TestQueueName-${context.task.name}`,
                type: QueueTypes.Classic,
                bindTo: [
                    {
                        bind: true,
                        routingKey: routingKey,
                        exchangeName: exchangeName,
                    },
                ],
            })

            const { name: queueName } = queueOptions

            try {
                await defaultAmqpAsserter.init()
                await defaultAmqpAsserter.deleteQueue(queueName)
                await defaultAmqpAsserter.deleteExchange(exchangeName)
            } catch {
                // not need to check an error because we just recreate a queue
            }

            const beforeEvent = 'before-event'
            const messageDataBeforeDelete: QueueMessageData = getMsgData(beforeEvent, { data: 'before' })

            await defaultAmqpAsserter.init([exchangeOptions], [queueOptions])

            const messages: QueueMessageData[] = []

            const handler: MessageHandler = vi.fn().mockImplementation(async (message: QueueMessage) => {
                if (message.data.event === beforeEvent) {
                    await new Promise((resolve) => setTimeout(resolve, 1000))
                }

                messages.push(message.data)
            })

            await amqpListener.listenQueue(queueName, handler)

            await amqpHelper.publishMessageToExchange(exchangeName, messageDataBeforeDelete, routingKey)

            // Act
            await defaultAmqpAsserter.declareQueues([
                {
                    ...queueOptions,
                    redeclareOptions: { redeclare: true, type: QueueTypes.Quorum, options: { durable: true } },
                },
            ])

            const messageDataAfterDelete: QueueMessageData = getMsgData('after-event', { data: 'after' })

            await amqpHelper.publishMessageToExchange(exchangeName, messageDataAfterDelete, routingKey)

            await new Promise((resolve) => setTimeout(resolve, 2000))

            // Assert
            const expectedMessageDataBeforeDelete: QueueMessageData = getExpectedMsgData(
                messageDataBeforeDelete.event,
                messageDataBeforeDelete.payload,
                { date: expect.any(String) },
            )
            const expectedMessageDataAfterDelete: QueueMessageData = getExpectedMsgData(
                messageDataAfterDelete.event,
                messageDataAfterDelete.payload,
                { date: expect.any(String) },
            )

            expect(messages).toEqual<QueueMessageData[]>(
                expect.arrayContaining([expectedMessageDataBeforeDelete, expectedMessageDataAfterDelete]),
            )
            expect(handler).toHaveBeenCalledTimes(2)
        })
    })
})
