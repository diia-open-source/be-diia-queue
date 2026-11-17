import { setTimeout } from 'node:timers/promises'

import { expect } from 'vitest'

import Logger from '@diia-inhouse/diia-logger'
import { ExternalCommunicatorError } from '@diia-inhouse/errors'
import { RandomUtils } from '@diia-inhouse/utils'

import { ExchangeOptions, MessageHeaders } from '@src/interfaces'
import { AmqpAsserter, AmqpConnection, AmqpPublisher } from '@src/providers'

import RabbitMQMetricsService from '@services/metrics'

import { getExchangeOptions, getQueueOptions, getRabbitMQConfig } from '@mocks/config'
import { getMsgData } from '@mocks/providers/rabbitmq/amqpPublisher'
import { makeMockMetricsService } from '@mocks/services/metricsService'

import AmqpHelper from '@tests/utils/amqpHelper'

describe('AmqpPublisher', () => {
    const connectionConfig = getRabbitMQConfig({ assertQueues: true, assertExchanges: true })

    const amqpHelper = new AmqpHelper(connectionConfig)

    const logger = new Logger()

    const defaultAmqpConnection = new AmqpConnection(
        connectionConfig.connection,
        logger,
        connectionConfig.reconnectOptions,
        connectionConfig.socketOptions,
    )

    beforeAll(async () => {
        await amqpHelper.init()
        await defaultAmqpConnection.connect()
    })

    const metrics = makeMockMetricsService()

    const rabbitmqMetricsService = new RabbitMQMetricsService(metrics)

    const systemServiceName = 'test-service-name'

    const asserter = new AmqpAsserter(defaultAmqpConnection, logger)

    describe(`method ${AmqpPublisher.prototype.publishToExchangeDirect.name}`, () => {
        it('should successfully publish message to exchange if channel is broken', async (context) => {
            // Arrange
            const publisher = new AmqpPublisher(defaultAmqpConnection, logger, rabbitmqMetricsService, systemServiceName, {
                timeout: 1000,
            })

            await publisher.init()

            const exchangeOptions: ExchangeOptions = getExchangeOptions({
                name: `TestExchangeName-${context.task.name}`,
                options: {
                    durable: true,
                },
            })

            const { name: exchangeName } = exchangeOptions

            const routingKey = 'test-routing-key.res'
            const queueOptions = getQueueOptions({
                name: `TestQueueName-${context.task.name}`,
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
                await asserter.init()
                await asserter.deleteQueue(queueName)
                await asserter.deleteExchange(exchangeName)
            } catch {
                // not need to check an error because we just recreate a queue
            }

            await asserter.init([exchangeOptions], [queueOptions])

            // Act
            const notExistExchangeName = `TestNotExistExchangeName-${RandomUtils.generateUUID()}`
            const message = getMsgData('test-event', { data: 'test' })
            const headers: MessageHeaders = { traceId: 'test-trace-id' }

            const publishToNotExistExchangePromise = publisher.publishToExchangeDirect(notExistExchangeName, message, headers, routingKey)

            await setTimeout(500)

            const publishToExistExchangePromise = publisher.publishToExchangeDirect(exchangeName, message, headers, routingKey)

            // Assert
            await expect(publishToNotExistExchangePromise).rejects.toBeTruthy()

            await expect(publishToExistExchangePromise).rejects.toBeInstanceOf(ExternalCommunicatorError)
        })
    })

    describe(`method ${AmqpPublisher.prototype.publishToExchange.name}`, () => {
        it('should count a message that no queue is bound to receive', async (context) => {
            // Arrange
            const collectUnroutedMessageMetric = vi.spyOn(rabbitmqMetricsService, 'collectUnroutedMessageMetric')
            const publisher = new AmqpPublisher(defaultAmqpConnection, logger, rabbitmqMetricsService, systemServiceName)

            await publisher.init()

            const exchangeOptions: ExchangeOptions = getExchangeOptions({
                name: `TestUnroutedExchange-${context.task.name}`,
                options: {
                    durable: true,
                },
            })

            const { name: exchangeName } = exchangeOptions
            const routingKey = 'test-routing-key'
            const eventName = 'test-event'
            const message = getMsgData(eventName, { data: 'test' })
            const headers: MessageHeaders = { traceId: 'test-trace-id' }

            try {
                await asserter.init()
                await asserter.deleteExchange(exchangeName)
            } catch {
                // not need to check an error because we just recreate an exchange
            }

            await asserter.init([exchangeOptions])

            try {
                // Act
                await publisher.publishToExchange(exchangeName, message, headers, routingKey)

                // Assert
                await vi.waitFor(() => {
                    expect(collectUnroutedMessageMetric).toHaveBeenCalledTimes(1)
                    expect(collectUnroutedMessageMetric).toHaveBeenCalledWith(exchangeName, eventName, routingKey)
                })
            } finally {
                collectUnroutedMessageMetric.mockRestore()
                await asserter.deleteExchange(exchangeName)
            }
        })

        it('should not count a message that a queue is bound to receive', async (context) => {
            // Arrange
            const collectUnroutedMessageMetric = vi.spyOn(rabbitmqMetricsService, 'collectUnroutedMessageMetric')
            const publisher = new AmqpPublisher(defaultAmqpConnection, logger, rabbitmqMetricsService, systemServiceName)

            await publisher.init()

            const exchangeOptions: ExchangeOptions = getExchangeOptions({
                name: `TestRoutedExchange-${context.task.name}`,
                options: {
                    durable: true,
                },
            })

            const { name: exchangeName } = exchangeOptions
            const routingKey = 'test-routing-key'
            const queueOptions = getQueueOptions({
                name: `TestRoutedQueue-${context.task.name}`,
                bindTo: [
                    {
                        bind: true,
                        routingKey,
                        exchangeName,
                    },
                ],
            })

            const { name: queueName } = queueOptions
            const eventName = 'test-event'
            const message = getMsgData(eventName, { data: 'test' })
            const headers: MessageHeaders = { traceId: 'test-trace-id' }

            try {
                await asserter.init()
                await asserter.deleteQueue(queueName)
                await asserter.deleteExchange(exchangeName)
            } catch {
                // not need to check an error because we just recreate a queue
            }

            await asserter.init([exchangeOptions], [queueOptions])

            try {
                // Act
                await publisher.publishToExchange(exchangeName, message, headers, routingKey)

                // A return arrives after publish, so wait out the same window the unrouted test uses.
                await setTimeout(1000)

                // Assert
                expect(collectUnroutedMessageMetric).not.toHaveBeenCalled()
            } finally {
                collectUnroutedMessageMetric.mockRestore()
                await asserter.deleteQueue(queueName)
                await asserter.deleteExchange(exchangeName)
            }
        })

        it('should not count a delayed message returned while it is still parked', async (context) => {
            // Arrange
            const collectUnroutedMessageMetric = vi.spyOn(rabbitmqMetricsService, 'collectUnroutedMessageMetric')
            const publisher = new AmqpPublisher(defaultAmqpConnection, logger, rabbitmqMetricsService, systemServiceName)

            await publisher.init()

            const exchangeOptions: ExchangeOptions = getExchangeOptions({
                name: `TestDelayedExchange-${context.task.name}`,
                delayed: true,
                options: {
                    durable: true,
                },
            })

            const { name: exchangeName } = exchangeOptions
            const routingKey = 'test-routing-key'
            const queueOptions = getQueueOptions({
                name: `TestDelayedQueue-${context.task.name}`,
                bindTo: [
                    {
                        bind: true,
                        routingKey,
                        exchangeName,
                    },
                ],
            })

            const { name: queueName } = queueOptions
            const message = getMsgData('test-event', { data: 'test' })
            const headers: MessageHeaders = { traceId: 'test-trace-id', 'x-delay': 5000 }

            try {
                await asserter.init()
                await asserter.deleteQueue(queueName)
                await asserter.deleteExchange(exchangeName)
            } catch {
                // not need to check an error because we just recreate a queue
            }

            await asserter.init([exchangeOptions], [queueOptions])

            try {
                // Act
                await publisher.publishToExchange(exchangeName, message, headers, routingKey)

                // The delayed exchange returns the message immediately, before the delay elapses.
                await setTimeout(1000)

                // Assert
                expect(collectUnroutedMessageMetric).not.toHaveBeenCalled()
            } finally {
                collectUnroutedMessageMetric.mockRestore()
                await asserter.deleteQueue(queueName)
                await asserter.deleteExchange(exchangeName)
            }
        })

        it('should not count a delayed message that no queue is bound to receive', async (context) => {
            // Arrange
            const collectUnroutedMessageMetric = vi.spyOn(rabbitmqMetricsService, 'collectUnroutedMessageMetric')
            const publisher = new AmqpPublisher(defaultAmqpConnection, logger, rabbitmqMetricsService, systemServiceName)

            await publisher.init()

            const exchangeOptions: ExchangeOptions = getExchangeOptions({
                name: `TestDelayedUnroutedExchange-${context.task.name}`,
                delayed: true,
                options: {
                    durable: true,
                },
            })

            const { name: exchangeName } = exchangeOptions
            const routingKey = 'test-routing-key'
            const message = getMsgData('test-event', { data: 'test' })
            const headers: MessageHeaders = { traceId: 'test-trace-id', 'x-delay': 500 }

            try {
                await asserter.init()
                await asserter.deleteExchange(exchangeName)
            } catch {
                // not need to check an error because we just recreate an exchange
            }

            await asserter.init([exchangeOptions])

            try {
                // Act
                await publisher.publishToExchange(exchangeName, message, headers, routingKey)

                await setTimeout(1000)

                // Assert
                expect(collectUnroutedMessageMetric).not.toHaveBeenCalled()
            } finally {
                collectUnroutedMessageMetric.mockRestore()
                await asserter.deleteExchange(exchangeName)
            }
        })
    })
})
