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

describe(`${AmqpPublisher.name}`, async () => {
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

    const asserter = new AmqpAsserter(defaultAmqpConnection, logger)

    describe(`method ${AmqpPublisher.prototype.publishToExchangeDirect.name}`, async () => {
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

            await new Promise((resolve) => setTimeout(resolve, 500))

            const publishToExistExchangePromise = publisher.publishToExchangeDirect(exchangeName, message, headers, routingKey)

            // Assert
            await expect(publishToNotExistExchangePromise).rejects.toBeTruthy()

            await expect(publishToExistExchangePromise).rejects.toBeInstanceOf(ExternalCommunicatorError)
        })
    })
})
