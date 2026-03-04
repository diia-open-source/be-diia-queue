import { AsyncLocalStorage } from 'node:async_hooks'

import { describe } from 'vitest'
import { mock } from 'vitest-mock-extended'

import DiiaLogger from '@diia-inhouse/diia-logger'
import { EnvService } from '@diia-inhouse/env'
import { LogLevel } from '@diia-inhouse/types'
import { AppValidator } from '@diia-inhouse/validators'

import {
    ExchangeOptions,
    ExchangeType,
    QueueConnectionConfig,
    QueueConnectionType,
    QueueContext,
    QueueOptions,
    QueueTypes,
} from '@src/interfaces'
import { EventMessageHandler, EventMessageValidator, ExternalEventBus, Queue } from '@src/services'

import { defaultServiceRulesConfig, getExchangeOptions, getQueueOptions, getRabbitMQConfig } from '@mocks/config'
import { TestEventBusListener } from '@mocks/eventBusListeners/eventBusListeners'
import { getMsgData } from '@mocks/providers/rabbitmq/amqpPublisher'
import { makeMockMetricsService } from '@mocks/services/metricsService'

import AmqpHelper from '@tests/utils/amqpHelper'

describe(`${ExternalEventBus.name}`, async () => {
    const hostname = 'hostname'
    const systemServiceName = 'test-service-name'

    const connectionConfig = getRabbitMQConfig({ assertQueues: true, assertExchanges: true })

    const amqpHelper = new AmqpHelper(connectionConfig)

    await amqpHelper.init()

    const asyncLocalStorage = new AsyncLocalStorage<QueueContext>()
    const logger = new DiiaLogger({ logLevel: LogLevel.DEBUG }, asyncLocalStorage)
    const envService = mock<EnvService>()

    const metricsService = makeMockMetricsService()

    const validator = new AppValidator()
    const eventMessageValidator = new EventMessageValidator(validator)
    const eventMessageHandler = new EventMessageHandler(eventMessageValidator, asyncLocalStorage, logger)

    describe('migrate classic queue to quorum', () => {
        it('should successfully read message from two queues', async () => {
            // Arrange
            const exchangeName = `Test${ExternalEventBus.name}DirectExchange1`
            const exchangeOptions: ExchangeOptions = getExchangeOptions({
                type: ExchangeType.Direct,
                name: exchangeName,
                options: {
                    durable: true,
                },
            })

            const routingKey = 'test-routing-key.res'

            const classicQueueName = 'TestClassicQueue1.res'
            const classicQueueOptions: QueueOptions = getQueueOptions({
                name: classicQueueName,
                type: QueueTypes.Classic,
                bindTo: [
                    {
                        bind: true,
                        routingKey: routingKey,
                        exchangeName: exchangeOptions.name,
                    },
                ],
            })

            const quorumQueueName = 'TestQuorumQueue1.res'
            const quorumQueueOptions: QueueOptions = getQueueOptions({
                name: quorumQueueName,
                options: {
                    durable: true,
                },
                bindTo: [
                    {
                        bind: true,
                        routingKey: routingKey,
                        exchangeName: exchangeOptions.name,
                    },
                ],
            })

            try {
                await amqpHelper.deleteQueues([quorumQueueName, classicQueueName])
                await amqpHelper.assertExchanges([exchangeOptions])
                await amqpHelper.assertQueues([classicQueueOptions])
            } catch {
                // no need to check error
            }

            const classicPayload = getMsgData('classic-event', { data: 'classic-message' })

            await amqpHelper.publishMessageToExchange(exchangeName, classicPayload, routingKey)

            const queueConnectionConfig: QueueConnectionConfig = {
                serviceRulesConfig: {
                    ...defaultServiceRulesConfig,
                    messageBrokerServices: {
                        externalEventBus: {
                            exchangesOptions: [exchangeOptions],
                            queuesOptions: [
                                quorumQueueOptions,
                                {
                                    ...classicQueueOptions,
                                    unbindFrom: [
                                        {
                                            unbind: true,
                                            routingKey: routingKey,
                                            exchangeName: exchangeOptions.name,
                                        },
                                    ],
                                },
                            ],
                        },
                    },
                },
                [QueueConnectionType.External]: connectionConfig,
            }

            const queue = new Queue(systemServiceName, metricsService, queueConnectionConfig, asyncLocalStorage, logger)
            const queueProvider = queue.makeExternalRabbitMQProvider('externalEventBus')

            const queueNames = [classicQueueName, quorumQueueName]
            const eventBusListener = new TestEventBusListener(queueNames)

            const externalEventBus = new ExternalEventBus(
                logger,
                systemServiceName,
                envService,
                queueProvider,
                [eventBusListener],
                eventMessageHandler,
                hostname,
            )

            const handlerMock = vi.spyOn(eventBusListener, 'handler').mockResolvedValueOnce({}).mockResolvedValueOnce({})

            await externalEventBus.onInit()

            const quorumPayload = { event: 'quorum-event', payload: { data: 'quorum-message' } }

            // Act
            await externalEventBus.publishToExchange(exchangeOptions.name, routingKey, quorumPayload)

            // Assert

            await new Promise((resolve) => setTimeout(resolve, 1000))

            expect(handlerMock).toHaveBeenCalledTimes(2)
            expect(handlerMock).toHaveBeenNthCalledWith(1, classicPayload.payload, { date: expect.any(Date) })
            expect(handlerMock).toHaveBeenNthCalledWith(2, quorumPayload.payload, { date: expect.any(Date) })
        })
        it('should successfully read a message from two queues and from an alternative exchange queue', async () => {
            const alternativeExchangeName = `Test${ExternalEventBus.name}AlternativeTopicExchange`
            const alternativeExchangeOptions: ExchangeOptions = getExchangeOptions({
                type: ExchangeType.Topic,
                name: alternativeExchangeName,
            })

            const exchangeName = `Test${ExternalEventBus.name}DirectExchange2`
            const exchangeOptions: ExchangeOptions = getExchangeOptions({
                type: ExchangeType.Direct,
                name: exchangeName,
                options: {
                    durable: true,
                    alternateExchange: alternativeExchangeName,
                },
            })

            const routingKey = 'test-routing-key.res'

            const alternativeQueueName = 'TestAlternativeQueue2'
            const alternativeQueueOptions: QueueOptions = getQueueOptions({
                name: alternativeQueueName,
                options: {
                    durable: true,
                },
                bindTo: [
                    {
                        bind: true,
                        routingKey,
                        exchangeName: alternativeExchangeName,
                    },
                ],
            })

            const classicQueueName = 'TestClassicQueue.res2'
            const classicQueueOptions: QueueOptions = getQueueOptions({
                name: classicQueueName,
                type: QueueTypes.Classic,
                bindTo: [
                    {
                        bind: true,
                        routingKey: routingKey,
                        exchangeName: exchangeOptions.name,
                    },
                ],
            })

            const quorumQueueName = 'TestQuorumQueue.res2'
            const quorumQueueOptions: QueueOptions = getQueueOptions({
                name: quorumQueueName,
                options: {
                    durable: true,
                },
                bindTo: [
                    {
                        bind: true,
                        routingKey: routingKey,
                        exchangeName: exchangeOptions.name,
                    },
                ],
            })

            const connectionConfig = getRabbitMQConfig({ assertQueues: true, assertExchanges: true })

            try {
                await amqpHelper.deleteQueues([quorumQueueName, classicQueueName])
                await amqpHelper.assertExchanges([alternativeExchangeOptions, exchangeOptions])
                await amqpHelper.assertQueues([alternativeQueueOptions])
            } catch {
                // no need to check error
            }

            const classicPayload = getMsgData('classic-event', { data: 'classic-message' })

            await amqpHelper.publishMessageToExchange(exchangeName, classicPayload, routingKey)
            await amqpHelper.publishMessageToExchange(exchangeName, classicPayload, routingKey)

            const queueConnectionConfig: QueueConnectionConfig = {
                serviceRulesConfig: {
                    ...defaultServiceRulesConfig,
                    messageBrokerServices: {
                        externalEventBus: {
                            exchangesOptions: [exchangeOptions, alternativeExchangeOptions],
                            queuesOptions: [
                                quorumQueueOptions,
                                alternativeQueueOptions,
                                {
                                    ...classicQueueOptions,
                                    unbindFrom: [
                                        {
                                            unbind: true,
                                            routingKey: routingKey,
                                            exchangeName: exchangeOptions.name,
                                        },
                                    ],
                                },
                            ],
                        },
                    },
                },
                [QueueConnectionType.External]: connectionConfig,
            }

            const queue = new Queue(systemServiceName, metricsService, queueConnectionConfig, asyncLocalStorage, logger)
            const queueProvider = queue.makeExternalRabbitMQProvider('externalEventBus')

            const queueNames = [classicQueueName, quorumQueueName, alternativeQueueName]
            const eventBusListener = new TestEventBusListener(queueNames)

            const externalEventBus = new ExternalEventBus(
                logger,
                systemServiceName,
                envService,
                queueProvider,
                [eventBusListener],
                eventMessageHandler,
                hostname,
            )

            const handlerMock = vi.spyOn(eventBusListener, 'handler').mockResolvedValue({})

            await externalEventBus.onInit()

            const quorumPayload = { event: 'quorum-event', payload: { data: 'quorum-message' } }

            // Act
            await externalEventBus.publishToExchange(exchangeOptions.name, routingKey, quorumPayload)

            // Assert
            await new Promise((resolve) => setTimeout(resolve, 1000))

            expect(handlerMock).toHaveBeenCalledTimes(3)
            expect(handlerMock).toHaveBeenNthCalledWith(1, classicPayload.payload, { date: expect.any(Date) })
            expect(handlerMock).toHaveBeenNthCalledWith(2, classicPayload.payload, { date: expect.any(Date) })
            expect(handlerMock).toHaveBeenNthCalledWith(3, quorumPayload.payload, { date: expect.any(Date) })
        })
    })

    describe('onDestroy hook', () => {
        it('should unsubscribe from queue when hook is called', async (context) => {
            // Arrange
            const exchangeName = `Test${ExternalEventBus.name}-${context.task.name}`
            const exchangeOptions: ExchangeOptions = getExchangeOptions({
                type: ExchangeType.Topic,
                name: exchangeName,
                options: {
                    durable: true,
                },
            })

            const routingKey = 'test-routing-key.res'

            const queueOptions: QueueOptions = getQueueOptions({
                name: 'TestQuorumQueue3.res',
                options: {
                    durable: true,
                },
                bindTo: [
                    {
                        bind: true,
                        routingKey: routingKey,
                        exchangeName: exchangeOptions.name,
                    },
                ],
            })

            const queueConnectionConfig: QueueConnectionConfig = {
                serviceRulesConfig: {
                    ...defaultServiceRulesConfig,
                    messageBrokerServices: {
                        externalEventBus: {
                            queuesOptions: [queueOptions],
                            exchangesOptions: [exchangeOptions],
                        },
                    },
                },
                [QueueConnectionType.External]: connectionConfig,
            }

            const queue = new Queue(systemServiceName, metricsService, queueConnectionConfig, asyncLocalStorage, logger)
            const queueProvider = queue.makeExternalRabbitMQProvider('externalEventBus')

            const eventBusListener = new TestEventBusListener([queueOptions.name])

            const handlerMock = vi.spyOn(eventBusListener, 'handler').mockResolvedValue({})

            const externalEventBus = new ExternalEventBus(
                logger,
                systemServiceName,
                envService,
                queueProvider,
                [eventBusListener],
                eventMessageHandler,
                hostname,
            )

            await externalEventBus.onInit()

            const msg = getMsgData('test-event', { data: 'test-message' })

            await amqpHelper.publishMessageToExchange(exchangeName, msg, routingKey)
            await new Promise((resolve) => setTimeout(resolve, 1000))

            // Act
            await externalEventBus.onDestroy()

            await amqpHelper.publishMessageToExchange(exchangeName, msg, routingKey)

            // Assert
            expect(handlerMock).toHaveBeenCalledExactlyOnceWith(msg.payload, { date: expect.any(Date) })

            const messages = await amqpHelper.readMessagesFromQueue(queueOptions.name)

            expect(messages).toHaveLength(1)
        })
    })
})
