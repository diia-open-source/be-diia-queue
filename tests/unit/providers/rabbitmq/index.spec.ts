const uuid = jest.fn()
const asyncLocalStorageMock = <AsyncLocalStorage<QueueContext>>(<unknown>{
    getStore: jest.fn(),
})
const amqpConnection = {
    connect: jest.fn(),
}
const amqpListenerMock = {
    listenQueue: jest.fn(),
    bindQueueToExchange: jest.fn(),
    getStatus: jest.fn(),
    init: jest.fn(),
}
const amqpPublisherMock = {
    checkExchange: jest.fn(),
    publishToExchange: jest.fn(),
    publishToExchangeDirect: jest.fn(),
    getStatus: jest.fn(),
    init: jest.fn(),
}

class AmqpConnection {
    async connect(): Promise<unknown> {
        return amqpConnection.connect()
    }
}
class AmqpListener {
    async listenQueue(...args: unknown[]): Promise<unknown> {
        return amqpListenerMock.listenQueue(...args)
    }

    async bindQueueToExchange(...args: unknown[]): Promise<unknown> {
        return amqpListenerMock.bindQueueToExchange(...args)
    }

    getStatus(): Promise<unknown> {
        return amqpListenerMock.getStatus()
    }

    async init(): Promise<unknown> {
        return amqpListenerMock.init()
    }
}
class AmqpPublisher {
    defaultExchangeType = 'topic'

    async checkExchange(...args: unknown[]): Promise<unknown> {
        return amqpPublisherMock.checkExchange(...args)
    }

    async publishToExchange(...args: unknown[]): Promise<unknown> {
        return amqpPublisherMock.publishToExchange(...args)
    }

    async publishToExchangeDirect(...args: unknown[]): Promise<unknown> {
        return amqpPublisherMock.publishToExchangeDirect(...args)
    }

    getStatus(): Promise<unknown> {
        return amqpPublisherMock.getStatus()
    }

    async init(): Promise<unknown> {
        return amqpPublisherMock.init()
    }
}

jest.mock('node:crypto', () => ({ randomUUID: uuid }))
jest.mock('@src/providers/rabbitmq/amqpConnection', () => ({ AmqpConnection }))
jest.mock('@src/providers/rabbitmq/amqpListener', () => ({ AmqpListener }))
jest.mock('@src/providers/rabbitmq/amqpPublisher', () => ({ AmqpPublisher }))

import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'

import { TimeoutError } from 'p-timeout'

import { RabbitMQProvider } from '@src/providers/rabbitmq'

import { validRabbitMQConfig } from '@tests/mocks/providers/rabbitmq'
import { logger } from '@tests/unit/mocks'

import { ConnectionStatus, ExchangeType, MessagePayload, PublishExternalEventOptions, QueueContext } from '@interfaces/index'
import { QueueConfigType, ServiceConfigByConfigType } from '@interfaces/queueConfig'

const messageHandler = async (): Promise<void> => {}

describe('RabbitMQProvider', () => {
    const serviceName = 'Auth'
    let serviceConfig: ServiceConfigByConfigType
    const topicConfig = {}
    const queueConfig = {}
    const externalTypeConfig = QueueConfigType.External
    const internalTypeConfig = QueueConfigType.Internal
    let mockedExternalRabbitMQProvider: RabbitMQProvider
    let mockedInternalRabbitMQProvider: RabbitMQProvider
    const eventName = 'event.name'
    const topicName = 'TopicName'

    beforeEach(() => {
        serviceConfig = {
            publish: [],
            subscribe: [],
        }

        mockedExternalRabbitMQProvider = new RabbitMQProvider(
            serviceName,
            validRabbitMQConfig,
            serviceConfig,
            topicConfig,
            [],
            [],
            externalTypeConfig,
            logger,
            asyncLocalStorageMock,
            queueConfig,
        )

        mockedInternalRabbitMQProvider = new RabbitMQProvider(
            serviceName,
            validRabbitMQConfig,
            serviceConfig,
            topicConfig,
            [],
            [],
            internalTypeConfig,
            logger,
            asyncLocalStorageMock,
            queueConfig,
        )
    })

    describe('method: `publishExternalDirect`', () => {
        it('should call publishToExchangeDirect', async () => {
            amqpPublisherMock.publishToExchangeDirect.mockResolvedValue(true)

            const result = await mockedExternalRabbitMQProvider.publishExternalDirect(eventName, {})

            expect(result).toBe(true)

            expect(amqpPublisherMock.publishToExchangeDirect).toHaveBeenCalledWith({
                eventName,
                exchangeName: 'TopicExternalDirectRPC',
                headers: {
                    serviceCode: undefined,
                    traceId: undefined,
                },
                message: {},
                options: undefined,
                routingKey: `queue.diia.${eventName}.req`,
            })
        })
    })

    describe('method: `publishExternal`', () => {
        it('should return false for non existing topics', async () => {
            amqpPublisherMock.publishToExchange.mockResolvedValue(true)

            const result = await mockedExternalRabbitMQProvider.publishExternal(eventName, {})

            expect(result).toBeFalsy()
        })

        it('should call publisher for publishing', async () => {
            amqpPublisherMock.publishToExchange.mockResolvedValue(true)

            const rabbitMQProvider = new RabbitMQProvider(
                serviceName,
                validRabbitMQConfig,
                Object.assign(serviceConfig, {
                    publish: [eventName],
                }),
                {
                    [topicName]: {
                        events: [eventName],
                    },
                },
                [],
                [],
                externalTypeConfig,
                logger,
                asyncLocalStorageMock,
                queueConfig,
            )

            const result = await rabbitMQProvider.publishExternal(eventName, {})

            expect(result).toBeTruthy()
            expect(amqpPublisherMock.publishToExchange).toHaveBeenCalledWith({
                eventName,
                exchangeName: `TopicExternal${topicName}`,
                headers: {
                    serviceCode: undefined,
                    traceId: undefined,
                },
                message: {},
                options: undefined,
                responseRoutingKey: `diia.queue.diia.${eventName}.res`,
                routingKey: `queue.diia.${eventName}.req`,
            })
        })

        it('should throw error when timeout param passed and timeout exceed', async () => {
            amqpPublisherMock.publishToExchange.mockResolvedValue(true)

            const rabbitMQProvider = new RabbitMQProvider(
                serviceName,
                validRabbitMQConfig,
                Object.assign(serviceConfig, {
                    publish: [eventName],
                }),
                {
                    [topicName]: {
                        events: [eventName],
                    },
                },
                [],
                [],
                externalTypeConfig,
                logger,
                asyncLocalStorageMock,
                queueConfig,
            )

            const options: PublishExternalEventOptions = { publishTimeout: 1000 }

            amqpPublisherMock.publishToExchange = jest.fn(async () => {
                return await new Promise((resolve) => {
                    setTimeout(() => {
                        resolve(true)
                    }, 10000)
                })
            })

            await expect(rabbitMQProvider.publishExternal(eventName, {}, options)).rejects.toThrow(TimeoutError)
            expect(amqpPublisherMock.publishToExchange).toHaveBeenCalledWith({
                eventName,
                exchangeName: `TopicExternal${topicName}`,
                headers: {
                    serviceCode: undefined,
                    traceId: undefined,
                },
                message: {},
                options,
                responseRoutingKey: `diia.queue.diia.${eventName}.res`,
                routingKey: `queue.diia.${eventName}.req`,
            })
        })

        it('should return error when timeout with throw false params passed and timeout exceed', async () => {
            amqpPublisherMock.publishToExchange.mockResolvedValue(true)

            const rabbitMQProvider = new RabbitMQProvider(
                serviceName,
                validRabbitMQConfig,
                Object.assign(serviceConfig, {
                    publish: [eventName],
                }),
                {
                    [topicName]: {
                        events: [eventName],
                    },
                },
                [],
                [],
                externalTypeConfig,
                logger,
                asyncLocalStorageMock,
                queueConfig,
            )

            const options: PublishExternalEventOptions = { publishTimeout: 1000, throwOnPublishTimeout: false }

            amqpPublisherMock.publishToExchange = jest.fn(async () => {
                return await new Promise((resolve) => {
                    setTimeout(() => {
                        resolve(true)
                    }, 10000)
                })
            })

            expect(await rabbitMQProvider.publishExternal(eventName, {}, options)).toBe(false)
            expect(amqpPublisherMock.publishToExchange).toHaveBeenCalledWith({
                eventName,
                exchangeName: `TopicExternal${topicName}`,
                headers: {
                    serviceCode: undefined,
                    traceId: undefined,
                },
                message: {},
                options,
                responseRoutingKey: `diia.queue.diia.${eventName}.res`,
                routingKey: `queue.diia.${eventName}.req`,
            })
        })

        it('should call publisher for subscribing', async () => {
            amqpPublisherMock.publishToExchange.mockResolvedValue(true)

            const rabbitMQProvider = new RabbitMQProvider(
                serviceName,
                validRabbitMQConfig,
                Object.assign(serviceConfig, {
                    subscribe: [eventName],
                }),
                {
                    [topicName]: {
                        events: [eventName],
                    },
                },
                [],
                [],
                externalTypeConfig,
                logger,
                asyncLocalStorageMock,
                queueConfig,
            )

            const result = await rabbitMQProvider.publishExternal(eventName, {})

            expect(result).toBeTruthy()
            expect(amqpPublisherMock.publishToExchange).toHaveBeenCalledWith({
                eventName,
                exchangeName: `TopicExternal${topicName}`,
                headers: {
                    serviceCode: undefined,
                    traceId: undefined,
                },
                message: {},
                options: undefined,
                routingKey: `queue.diia.${eventName}.res`,
            })
        })

        it('should return false for serviceConfig without subscription', async () => {
            const rabbitMQProvider = new RabbitMQProvider(
                serviceName,
                validRabbitMQConfig,
                serviceConfig,
                {
                    [topicName]: {
                        events: [eventName],
                    },
                },
                [],
                [],
                externalTypeConfig,
                logger,
                asyncLocalStorageMock,
                queueConfig,
            )

            const result = await rabbitMQProvider.publishExternal(eventName, {})

            expect(result).toBeFalsy()
        })
    })

    describe('method: `subscribeExternal`', () => {
        it('should call listenQueue', async () => {
            const prefix = 'prefix'
            const expectedQueueName = `${prefix}.queue.diia.${eventName}.req`

            const rabbitMQProvider = new RabbitMQProvider(
                serviceName,
                Object.assign(validRabbitMQConfig, {
                    custom: {
                        responseRoutingKeyPrefix: prefix,
                    },
                }),
                Object.assign(serviceConfig, {
                    subscribe: [eventName],
                }),
                {
                    [topicName]: {
                        events: [eventName],
                    },
                },
                [],
                [eventName],
                internalTypeConfig,
                logger,
                asyncLocalStorageMock,
                queueConfig,
            )

            const result = await rabbitMQProvider.subscribeExternal(messageHandler, {
                listener: {
                    prefetchCount: 1,
                },
            })

            expect(result).toBeTruthy()
            expect(amqpListenerMock.listenQueue).toHaveBeenCalledWith(expectedQueueName, messageHandler)
        })

        it('should call listenQueue without Prefix', async () => {
            const expectedQueueName = `queue.diia.${eventName}.req`

            const rabbitMQProvider = new RabbitMQProvider(
                serviceName,
                Object.assign(validRabbitMQConfig, {
                    custom: {
                        responseRoutingKeyPrefix: null,
                    },
                }),
                Object.assign(serviceConfig, {
                    subscribe: [eventName],
                }),
                {
                    [topicName]: {
                        events: [eventName],
                    },
                },
                [],
                [eventName],
                internalTypeConfig,
                logger,
                asyncLocalStorageMock,
                queueConfig,
            )

            const result = await rabbitMQProvider.subscribeExternal(messageHandler, {
                listener: {
                    prefetchCount: 1,
                },
            })

            expect(result).toBeTruthy()
            expect(amqpListenerMock.listenQueue).toHaveBeenCalledWith(expectedQueueName, messageHandler)
        })
    })

    describe('method: `getServiceName`', () => {
        it('should successfully get service name', () => {
            expect(mockedInternalRabbitMQProvider.getServiceName()).toEqual(serviceName)
        })
    })

    describe('method: `getConfig`', () => {
        it('should successfully get config', () => {
            expect(mockedInternalRabbitMQProvider.getConfig()).toEqual(validRabbitMQConfig)
        })
    })

    describe('method: `init`', () => {
        it('should successfully initialize RabbitMQ provider', async () => {
            expect(await mockedInternalRabbitMQProvider.init()).toBeUndefined()
            expect(amqpConnection.connect).toHaveBeenCalledWith()
        })
    })

    describe('method: `subscribe`', () => {
        it('should successfully subscribe message handler', async () => {
            const subscriptionName = 'queueAuth'

            const rabbitMQProvider = new RabbitMQProvider(
                serviceName,
                validRabbitMQConfig,
                Object.assign(serviceConfig, {
                    subscribe: [subscriptionName],
                }),
                topicConfig,
                [],
                [subscriptionName],
                internalTypeConfig,
                logger,
                asyncLocalStorageMock,
                {
                    [subscriptionName]: {
                        topics: [],
                    },
                },
            )

            await rabbitMQProvider.init()

            expect(await rabbitMQProvider.subscribe(subscriptionName, async () => {}, { queueSuffix: 'suffix' })).toBeTruthy()
            expect(await rabbitMQProvider.subscribe(subscriptionName, async () => {})).toBeTruthy()
        })

        it('should not subscribe message handler in case subscription name is not included in service subscriptions list', async () => {
            const subscriptionName = 'queueAuth'

            await mockedInternalRabbitMQProvider.init()

            expect(await mockedInternalRabbitMQProvider.subscribe(subscriptionName, async () => {})).toBeFalsy()
            expect(logger.error).toHaveBeenCalledWith(`Subscription [${subscriptionName}] is not related to the service [${serviceName}]`)
        })

        it('should successfully subscribe message handler even in case subscription does not have topics', async () => {
            const subscriptionName = 'queueAuth'

            const rabbitMQProvider = new RabbitMQProvider(
                serviceName,
                validRabbitMQConfig,
                Object.assign(serviceConfig, {
                    subscribe: [subscriptionName],
                }),
                topicConfig,
                [],
                [],
                internalTypeConfig,
                logger,
                asyncLocalStorageMock,
                {
                    [subscriptionName]: {
                        topics: ['topicAnalytics'],
                    },
                },
            )

            await rabbitMQProvider.init()

            expect(await rabbitMQProvider.subscribe(subscriptionName, async () => {})).toBeTruthy()
            expect(logger.info).toHaveBeenCalledWith(`Can't find topics for subscription [${subscriptionName}]`)
        })
    })

    describe('method: `publish`', () => {
        it('should successfully publish message for specified event', async () => {
            const traceId = randomUUID()
            const validMessageToPublish: MessagePayload = { key: 'value' }

            const rabbitMQProvider = new RabbitMQProvider(
                serviceName,
                validRabbitMQConfig,
                Object.assign(serviceConfig, {
                    publish: [topicName],
                }),
                {
                    [topicName]: {
                        events: [eventName],
                    },
                },
                [],
                [eventName],
                externalTypeConfig,
                logger,
                asyncLocalStorageMock,
                queueConfig,
            )

            uuid.mockReturnValue(traceId)
            amqpPublisherMock.publishToExchange.mockResolvedValue(true)

            expect(await rabbitMQProvider.publish(eventName, validMessageToPublish, { routingKey: 'routingKey' })).toBeTruthy()
            expect(amqpPublisherMock.checkExchange).toHaveBeenCalledWith(topicName)
            expect(amqpPublisherMock.publishToExchange).toHaveBeenCalledWith({
                eventName,
                message: validMessageToPublish,
                exchangeName: topicName,
                routingKey: 'routingKey',
                headers: {
                    serviceCode: undefined,
                    traceId,
                },
            })
        })

        it('should not publish message and throw timeout error when timeout params passed and timeout exceed', async () => {
            const traceId = randomUUID()
            const validMessageToPublish: MessagePayload = { key: 'value' }

            const rabbitMQProvider = new RabbitMQProvider(
                serviceName,
                validRabbitMQConfig,
                Object.assign(serviceConfig, {
                    publish: [topicName],
                }),
                {
                    [topicName]: {
                        events: [eventName],
                    },
                },
                [],
                [eventName],
                externalTypeConfig,
                logger,
                asyncLocalStorageMock,
                queueConfig,
            )

            uuid.mockReturnValue(traceId)
            amqpPublisherMock.publishToExchange = jest.fn(async () => {
                return await new Promise((resolve) => {
                    setTimeout(() => {
                        resolve(true)
                    }, 10000)
                })
            })

            await expect(
                rabbitMQProvider.publish(eventName, validMessageToPublish, { publishTimeout: 1000, routingKey: 'routingKey' }),
            ).rejects.toThrow(TimeoutError)
            expect(amqpPublisherMock.checkExchange).toHaveBeenCalledWith(topicName)
            expect(amqpPublisherMock.publishToExchange).toHaveBeenCalledWith({
                eventName,
                message: validMessageToPublish,
                exchangeName: topicName,
                routingKey: 'routingKey',
                headers: {
                    serviceCode: undefined,
                    traceId,
                },
            })
        })

        it('should not publish message and return false when timeout with throw false params passed and timeout exceed', async () => {
            const traceId = randomUUID()
            const validMessageToPublish: MessagePayload = { key: 'value' }

            const rabbitMQProvider = new RabbitMQProvider(
                serviceName,
                validRabbitMQConfig,
                Object.assign(serviceConfig, {
                    publish: [topicName],
                }),
                {
                    [topicName]: {
                        events: [eventName],
                    },
                },
                [],
                [eventName],
                externalTypeConfig,
                logger,
                asyncLocalStorageMock,
                queueConfig,
            )

            uuid.mockReturnValue(traceId)
            amqpPublisherMock.publishToExchange = jest.fn(async () => {
                return await new Promise((resolve) => {
                    setTimeout(() => {
                        resolve(true)
                    }, 10000)
                })
            })

            expect(
                await rabbitMQProvider.publish(eventName, validMessageToPublish, {
                    publishTimeout: 1000,
                    throwOnPublishTimeout: false,
                    routingKey: 'routingKey',
                }),
            ).toBe(false)
            expect(amqpPublisherMock.checkExchange).toHaveBeenCalledWith(topicName)
            expect(amqpPublisherMock.publishToExchange).toHaveBeenCalledWith({
                eventName,
                message: validMessageToPublish,
                exchangeName: topicName,
                routingKey: 'routingKey',
                headers: {
                    serviceCode: undefined,
                    traceId,
                },
            })
        })

        it('should not publish message for specified event in case event is not implemented', async () => {
            const unknownEventName = 'unknown.event.name'
            const validMessageToPublish: MessagePayload = { key: 'value' }

            expect(
                await mockedInternalRabbitMQProvider.publish(unknownEventName, validMessageToPublish, { routingKey: 'routingKey' }),
            ).toBeFalsy()
            expect(logger.error).toHaveBeenCalledWith(`Event [${unknownEventName}] is not implemented`)
        })

        it('should not publish message for specified event in case there is no exchange for provided event', async () => {
            const eventNameWithoutExchange = 'event.name.without.exchange'
            const validMessageToPublish: MessagePayload = { key: 'value' }
            const rabbitMQProvider = new RabbitMQProvider(
                serviceName,
                validRabbitMQConfig,
                Object.assign(serviceConfig, {
                    publish: [topicName],
                }),
                {
                    [topicName]: {
                        events: [eventName],
                    },
                },
                [],
                [eventNameWithoutExchange],
                internalTypeConfig,
                logger,
                asyncLocalStorageMock,
                queueConfig,
            )

            expect(
                await rabbitMQProvider.publish(eventNameWithoutExchange, validMessageToPublish, { routingKey: 'routingKey' }),
            ).toBeFalsy()
            expect(logger.error).toHaveBeenCalledWith(`Can't find topic name by event [${eventNameWithoutExchange}]`)
        })

        it('should not publish message for specified event in case event is not allowed for actual exchange', async () => {
            const validMessageToPublish: MessagePayload = { key: 'value' }

            expect(await mockedInternalRabbitMQProvider.publish(eventName, validMessageToPublish, { routingKey: 'routingKey' })).toBeFalsy()
        })

        it('should not publish message for specified event in case unable to check exchange', async () => {
            const validMessageToPublish: MessagePayload = { key: 'value' }

            amqpPublisherMock.checkExchange.mockRejectedValue(new Error('Error'))

            expect(await mockedInternalRabbitMQProvider.publish(eventName, validMessageToPublish, { routingKey: 'routingKey' })).toBeFalsy()
        })
    })

    describe('method: `subscribeTask`', () => {
        it('should successfully subscribe task with delay', async () => {
            const queueName = 'queueAuth'

            expect(await mockedInternalRabbitMQProvider.subscribeTask(queueName, messageHandler, { delayed: true })).toBeTruthy()
            expect(amqpListenerMock.listenQueue).toHaveBeenCalledWith(queueName, messageHandler)
            expect(amqpPublisherMock.checkExchange).toHaveBeenCalledWith(queueName, ExchangeType.XDelayedMessage, {
                arguments: { 'x-delayed-type': 'topic' },
            })
            expect(amqpListenerMock.bindQueueToExchange).toHaveBeenCalledWith(queueName, queueName)
        })

        it('should successfully subscribe task without delay', async () => {
            const queueName = 'queueAuth'

            expect(await mockedInternalRabbitMQProvider.subscribeTask(queueName, messageHandler, {})).toBeTruthy()
            expect(amqpListenerMock.listenQueue).toHaveBeenCalledWith(queueName, messageHandler)
            expect(amqpPublisherMock.checkExchange).toHaveBeenCalledWith(queueName)
            expect(amqpListenerMock.bindQueueToExchange).toHaveBeenCalledWith(queueName, queueName)
        })
    })

    describe('method: `publishTask`', () => {
        it('should successfully publish task', async () => {
            const traceId = randomUUID()
            const queueName = 'queueAuth'
            const message = { key: 'value' }

            uuid.mockReturnValue(traceId)
            amqpPublisherMock.publishToExchange.mockResolvedValue(true)

            expect(await mockedInternalRabbitMQProvider.publishTask(queueName, message, 1800)).toBeTruthy()
            expect(amqpPublisherMock.publishToExchange).toHaveBeenCalledWith({
                eventName: queueName,
                message,
                exchangeName: queueName,
                headers: { traceId, 'x-delay': 1800 },
            })
        })
    })

    describe('method: `getStatus`', () => {
        it('should successfully get status', async () => {
            amqpListenerMock.getStatus.mockReturnValue(ConnectionStatus.Connected)
            amqpPublisherMock.getStatus.mockReturnValue(ConnectionStatus.Connected)

            await mockedInternalRabbitMQProvider.init()

            expect(mockedInternalRabbitMQProvider.getStatus()).toEqual({
                listener: ConnectionStatus.Connected,
                publisher: ConnectionStatus.Connected,
            })
        })
    })
})
