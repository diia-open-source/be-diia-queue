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

jest.mock('uuid', () => ({ v4: uuid }))
jest.mock('@src/providers/rabbitmq/amqpConnection', () => ({ AmqpConnection }))
jest.mock('@src/providers/rabbitmq/amqpListener', () => ({ AmqpListener }))
jest.mock('@src/providers/rabbitmq/amqpPublisher', () => ({ AmqpPublisher }))

import { AsyncLocalStorage } from 'async_hooks'
import { randomUUID } from 'crypto'

import { RabbitMQProvider } from '@src/providers/rabbitmq'

import { validRabbitMQConfig } from '@tests/mocks/providers/rabbitmq'
import { logger } from '@tests/unit/mocks'

import { ConnectionStatus, ExchangeType, MessagePayload, QueueContext } from '@interfaces/index'
import {
    ExternalEvent,
    ExternalTopic,
    InternalEvent,
    InternalQueueName,
    InternalTopic,
    QueueConfigType,
    ServiceConfigByConfigType,
} from '@interfaces/queueConfig'

describe('RabbitMQProvider', () => {
    const serviceName = 'Auth'
    let serviceConfig: ServiceConfigByConfigType
    const topicConfig = {}
    const queueConfig = {}
    const externalTypeConfig = QueueConfigType.External
    const internalTypeConfig = QueueConfigType.Internal
    let mockedExternalRabbitMQProvider: RabbitMQProvider
    let mockedInternalRabbitMQProvider: RabbitMQProvider

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
            internalTypeConfig,
            logger,
            asyncLocalStorageMock,
            queueConfig,
        )
    })

    describe('method: `publishExternalDirect`', () => {
        it('should call publishToExchangeDirect', async () => {
            const eventName = ExternalEvent.AidVaccinationStatus

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
                routingKey: 'queue.diia.aid.vaccination.status.req',
            })
        })
    })

    describe('method: `publishExternal`', () => {
        it('should return false for non existing topics', async () => {
            amqpPublisherMock.publishToExchange.mockResolvedValue(true)

            const result = await mockedExternalRabbitMQProvider.publishExternal(ExternalEvent.AidVaccinationStatus, {})

            expect(result).toBeFalsy()
        })

        it('should call publisher for publishing', async () => {
            const eventName = ExternalEvent.AidVaccinationStatus

            amqpPublisherMock.publishToExchange.mockResolvedValue(true)

            const rabbitMQProvider = new RabbitMQProvider(
                serviceName,
                validRabbitMQConfig,
                Object.assign(serviceConfig, {
                    publish: [eventName],
                }),
                {
                    [ExternalTopic.AcquirerSharing]: {
                        events: [eventName],
                    },
                },
                externalTypeConfig,
                logger,
                asyncLocalStorageMock,
                queueConfig,
            )

            const result = await rabbitMQProvider.publishExternal(eventName, {})

            expect(result).toBeTruthy()
            expect(amqpPublisherMock.publishToExchange).toHaveBeenCalledWith({
                eventName,
                exchangeName: 'TopicExternalAcquirerSharing',
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

        it('should call publisher for subscribing', async () => {
            const eventName = ExternalEvent.AidVaccinationStatus
            const topicName = ExternalTopic.AcquirerSharing

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
            const eventName = ExternalEvent.AidVaccinationStatus
            const topicName = ExternalTopic.AcquirerSharing

            const rabbitMQProvider = new RabbitMQProvider(
                serviceName,
                validRabbitMQConfig,
                serviceConfig,
                {
                    [topicName]: {
                        events: [eventName],
                    },
                },
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
            const topicName = ExternalTopic.AcquirerSharing
            const eventName = ExternalEvent.AcquirerDocumentRequest
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
                internalTypeConfig,
                logger,
                asyncLocalStorageMock,
                queueConfig,
            )

            const messageHandler = async (): Promise<void> => {}

            const result = await rabbitMQProvider.subscribeExternal(messageHandler, {
                listener: {
                    prefetchCount: 1,
                },
            })

            expect(result).toBeTruthy()
            expect(amqpListenerMock.listenQueue).toHaveBeenCalledWith(expectedQueueName, messageHandler)
        })

        it('should call listenQueue without Prefix', async () => {
            const eventName = ExternalEvent.AcquirerDocumentRequest
            const topicName = ExternalTopic.AcquirerSharing
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
                internalTypeConfig,
                logger,
                asyncLocalStorageMock,
                queueConfig,
            )

            const messageHandler = async (): Promise<void> => {}

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
            const subscriptionName = InternalQueueName.QueueAuth

            const rabbitMQProvider = new RabbitMQProvider(
                serviceName,
                validRabbitMQConfig,
                Object.assign(serviceConfig, {
                    subscribe: [subscriptionName],
                }),
                topicConfig,
                internalTypeConfig,
                logger,
                asyncLocalStorageMock,
                {
                    [InternalQueueName.QueueAuth]: {
                        topics: [],
                    },
                },
            )

            await rabbitMQProvider.init()

            expect(await rabbitMQProvider.subscribe(subscriptionName, async () => {}, { queueSuffix: 'suffix' })).toBeTruthy()
            expect(await rabbitMQProvider.subscribe(subscriptionName, async () => {})).toBeTruthy()
        })

        it('should not subscribe message handler in case subscription name is not included in service subscriptions list', async () => {
            const subscriptionName = InternalQueueName.QueueAuth

            await mockedInternalRabbitMQProvider.init()

            expect(await mockedInternalRabbitMQProvider.subscribe(subscriptionName, async () => {})).toBeFalsy()
            expect(logger.error).toHaveBeenCalledWith(`Subscription [${subscriptionName}] is not related to the service [${serviceName}]`)
        })

        it('should successfully subscribe message handler even in case subscription does not have topics', async () => {
            const subscriptionName = InternalQueueName.QueueAuth

            const rabbitMQProvider = new RabbitMQProvider(
                serviceName,
                validRabbitMQConfig,
                Object.assign(serviceConfig, {
                    subscribe: [subscriptionName],
                }),
                topicConfig,
                internalTypeConfig,
                logger,
                asyncLocalStorageMock,
                {
                    [subscriptionName]: {
                        topics: [InternalTopic.TopicAnalytics],
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
            const eventName = InternalEvent.AcquirersOfferRequestHasDeleted
            const validMessageToPublish: MessagePayload = { key: 'value' }
            const topicName = InternalTopic.TopicAcquirersOfferRequestLifeCycle

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
                externalTypeConfig,
                logger,
                asyncLocalStorageMock,
                queueConfig,
            )

            uuid.mockReturnValue(traceId)
            amqpPublisherMock.publishToExchange.mockResolvedValue(true)

            expect(await rabbitMQProvider.publish(eventName, validMessageToPublish, 'routingKey')).toBeTruthy()
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
            const eventName = <InternalEvent>(<unknown>'unknown')
            const validMessageToPublish: MessagePayload = { key: 'value' }

            expect(await mockedInternalRabbitMQProvider.publish(eventName, validMessageToPublish, 'routingKey')).toBeFalsy()
            expect(logger.error).toHaveBeenCalledWith(`Event [${eventName}] is not implemented`)
        })

        it('should not publish message for specified event in case there is no exchange for provided event', async () => {
            const eventName = InternalEvent.AuthUserLogOut
            const validMessageToPublish: MessagePayload = { key: 'value' }

            expect(await mockedInternalRabbitMQProvider.publish(eventName, validMessageToPublish, 'routingKey')).toBeFalsy()
            expect(logger.error).toHaveBeenCalledWith(`Can't find topic name by event [${eventName}]`)
        })

        it('should not publish message for specified event in case event is not allowed for actual exchange', async () => {
            const eventName = InternalEvent.AuthUserLogOut
            const validMessageToPublish: MessagePayload = { key: 'value' }

            expect(await mockedInternalRabbitMQProvider.publish(eventName, validMessageToPublish, 'routingKey')).toBeFalsy()
        })

        it('should not publish message for specified event in case unable to check exchange', async () => {
            const eventName = InternalEvent.AuthUserLogOut
            const validMessageToPublish: MessagePayload = { key: 'value' }

            amqpPublisherMock.checkExchange.mockRejectedValue(new Error())

            expect(await mockedInternalRabbitMQProvider.publish(eventName, validMessageToPublish, 'routingKey')).toBeFalsy()
        })
    })

    describe('method: `subscribeTask`', () => {
        it('should successfully subscribe task with delay', async () => {
            const queueName = InternalQueueName.QueueAuth

            const messageHandler = async (): Promise<void> => {}

            expect(await mockedInternalRabbitMQProvider.subscribeTask(queueName, messageHandler, { delayed: true })).toBeTruthy()
            expect(amqpListenerMock.listenQueue).toHaveBeenCalledWith(queueName, messageHandler)
            expect(amqpPublisherMock.checkExchange).toHaveBeenCalledWith(queueName, ExchangeType.XDelayedMessage, {
                arguments: { 'x-delayed-type': 'topic' },
            })
            expect(amqpListenerMock.bindQueueToExchange).toHaveBeenCalledWith(queueName, queueName)
        })

        it('should successfully subscribe task without delay', async () => {
            const queueName = InternalQueueName.QueueAuth

            const messageHandler = async (): Promise<void> => {}

            expect(await mockedInternalRabbitMQProvider.subscribeTask(queueName, messageHandler, {})).toBeTruthy()
            expect(amqpListenerMock.listenQueue).toHaveBeenCalledWith(queueName, messageHandler)
            expect(amqpPublisherMock.checkExchange).toHaveBeenCalledWith(queueName)
            expect(amqpListenerMock.bindQueueToExchange).toHaveBeenCalledWith(queueName, queueName)
        })
    })

    describe('method: `publishTask`', () => {
        it('should successfully publish task', async () => {
            const traceId = randomUUID()
            const queueName = InternalQueueName.QueueAuth
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
