import { AsyncLocalStorage } from 'node:async_hooks'

import { Channel } from 'amqplib'
import { TimeoutError } from 'p-timeout'
import { mock } from 'vitest-mock-extended'

import { InternalServerError } from '@diia-inhouse/errors'

import { RabbitMQProvider } from '@src/providers/rabbitmq'
import { AmqpAsserter } from '@src/providers/rabbitmq/amqpAsserter'
import { AmqpConnection } from '@src/providers/rabbitmq/amqpConnection'
import { AmqpListener } from '@src/providers/rabbitmq/amqpListener'
import { AmqpPublisher } from '@src/providers/rabbitmq/amqpPublisher'

import { getRabbitMQConfig } from '@mocks/config'
import { getExpectedMsgData } from '@mocks/providers/rabbitmq/amqpPublisher'

import { makeMockMetricsService } from '@tests/mocks/services/metricsService'
import { logger } from '@tests/unit/mocks'

import { ConnectionStatus, MessageHeaders, PublishExternalEventOptions, QueueContext } from '@interfaces/index'
import { EventName, ServiceConfigByConfigType, TopicConfigByConfigType } from '@interfaces/queueConfig'

const messageHandler = async (): Promise<void> => {}

describe('RabbitMQProvider', () => {
    const systemServiceName = 'Auth'
    const topicConfig = {}
    const queueConfig = {}

    const defaultEventName = 'event.name'
    const defaultTopicName = 'TopicName'
    const defaultPortalEvents: EventName[] = []
    const defaultTopicConfig: TopicConfigByConfigType = {
        [defaultTopicName]: {
            events: [defaultEventName],
        },
    }
    const defaultServiceConfig: ServiceConfigByConfigType = {}

    const metricsService = makeMockMetricsService()

    const asyncLocalStorage = mock<AsyncLocalStorage<QueueContext>>()

    const amqpListener = mock<AmqpListener>()
    const amqpAsserter = mock<AmqpAsserter>()
    const amqpPublisher = mock<AmqpPublisher>()

    const expectedMessageHeaders: MessageHeaders = {
        serviceCode: undefined,
        traceId: expect.any(String),
    }

    const rabbitMQConfig = getRabbitMQConfig()

    describe('method: `publishExternalDirect`', async () => {
        const rabbitMQProvider = new RabbitMQProvider(
            systemServiceName,
            rabbitMQConfig,
            defaultServiceConfig,
            topicConfig,
            [],
            logger,
            metricsService,
            asyncLocalStorage,
            queueConfig,
        )

        vi.spyOn(rabbitMQProvider, 'makeAMQPAsserter').mockResolvedValue(amqpAsserter)
        vi.spyOn(rabbitMQProvider, 'makeAMQPListener').mockResolvedValue(amqpListener)
        vi.spyOn(rabbitMQProvider, 'makeAMQPPublisher').mockResolvedValue(amqpPublisher)

        await rabbitMQProvider.init()

        it('should call publishToExchangeDirect', async () => {
            // Arrange
            const spiedPublishToExchangeDirect = amqpPublisher.publishToExchangeDirect.mockResolvedValueOnce(true)

            const exchangeName = 'TopicExternalDirectRPC'
            const routingKey = `queue.diia.${defaultEventName}.req`

            const messageData = getExpectedMsgData(defaultEventName, {})

            // Act
            const result = await rabbitMQProvider.publishExternalDirect(messageData, exchangeName, routingKey, {})

            // Assert
            expect(result).toBe(true)

            expect(spiedPublishToExchangeDirect).toHaveBeenCalledWith(
                exchangeName,
                messageData,
                expectedMessageHeaders,
                routingKey,
                undefined,
            )
        })
    })

    describe('method: `publish`', async () => {
        const defaultServiceConfig: ServiceConfigByConfigType = {
            publish: [defaultEventName],
        }

        const rabbitMQProvider = new RabbitMQProvider(
            systemServiceName,
            rabbitMQConfig,
            defaultServiceConfig,
            defaultTopicConfig,
            defaultPortalEvents,
            logger,
            metricsService,
            asyncLocalStorage,
            queueConfig,
        )

        vi.spyOn(rabbitMQProvider, 'makeAMQPAsserter').mockResolvedValue(amqpAsserter)
        vi.spyOn(rabbitMQProvider, 'makeAMQPListener').mockResolvedValue(amqpListener)
        vi.spyOn(rabbitMQProvider, 'makeAMQPPublisher').mockResolvedValue(amqpPublisher)

        await rabbitMQProvider.init()

        const defaultReqRoutingKey = `queue.diia.${defaultEventName}.req`
        const defaultResponseRoutingKey = `diia.queue.diia.${defaultEventName}.res`
        const defaultMessage = getExpectedMsgData(defaultEventName, {}, { responseRoutingKey: defaultResponseRoutingKey })

        it('should throw error when timeout param passed and timeout exceed', async () => {
            // Arrange
            const publishTimeout = 100

            const spiedPublishToExchange = amqpPublisher.publishToExchange.mockImplementationOnce(async () => {
                return await new Promise((resolve) => {
                    setTimeout(() => {
                        resolve()
                    }, publishTimeout * 2)
                })
            })

            const options: PublishExternalEventOptions = { publishTimeout }

            // Act
            const publishingPromise = rabbitMQProvider.publish(defaultMessage, defaultTopicName, defaultReqRoutingKey, options)

            // Assert
            await expect(publishingPromise).rejects.toThrow(TimeoutError)
            expect(spiedPublishToExchange).toHaveBeenCalledWith(
                defaultTopicName,
                defaultMessage,
                expectedMessageHeaders,
                defaultReqRoutingKey,
            )
            expect(amqpPublisher.publishToExchange).toHaveBeenCalledWith(
                defaultTopicName,
                defaultMessage,
                expectedMessageHeaders,
                defaultReqRoutingKey,
            )
        })

        it('should return false when timeout with throw false params passed and timeout exceed', async () => {
            // Arrange
            const publishTimeout = 100

            const spiedPublishToExchange = amqpPublisher.publishToExchange.mockImplementationOnce(async () => {
                return await new Promise((resolve) => {
                    setTimeout(() => {
                        resolve()
                    }, publishTimeout * 2)
                })
            })

            const options: PublishExternalEventOptions = { publishTimeout, throwOnPublishTimeout: false }

            // Act
            const publishingPromise = rabbitMQProvider.publish(defaultMessage, defaultTopicName, defaultReqRoutingKey, options)

            // Assert
            await expect(publishingPromise).rejects.toThrow(InternalServerError)

            expect(spiedPublishToExchange).toHaveBeenCalledWith(
                defaultTopicName,
                defaultMessage,
                expectedMessageHeaders,
                defaultReqRoutingKey,
            )
            expect(amqpPublisher.publishToExchange).toHaveBeenCalledWith(
                defaultTopicName,
                defaultMessage,
                expectedMessageHeaders,
                defaultReqRoutingKey,
            )
        })
    })

    describe('method: `subscribe`', async () => {
        const serviceConfig: ServiceConfigByConfigType = {
            subscribe: [defaultEventName],
        }

        const rabbitMQProvider = new RabbitMQProvider(
            systemServiceName,
            rabbitMQConfig,
            serviceConfig,
            defaultTopicConfig,
            defaultPortalEvents,
            logger,
            metricsService,
            asyncLocalStorage,
            queueConfig,
        )

        vi.spyOn(rabbitMQProvider, 'makeAMQPAsserter').mockResolvedValue(amqpAsserter)
        vi.spyOn(rabbitMQProvider, 'makeAMQPListener').mockResolvedValue(amqpListener)
        vi.spyOn(rabbitMQProvider, 'makeAMQPPublisher').mockResolvedValue(amqpPublisher)

        await rabbitMQProvider.init({
            queuesOptions: [{ name: defaultEventName, bindTo: [] }],
            exchangesOptions: [],
        })

        it('should call listenQueue', async () => {
            // Arrange

            // Act
            const result = await rabbitMQProvider.subscribe(defaultEventName, messageHandler)

            // Assert
            expect(result).toBeTruthy()
            expect(amqpListener.listenQueue).toHaveBeenCalledWith(defaultEventName, messageHandler)
        })
    })

    describe('method: `getConfig`', () => {
        const serviceConfig: ServiceConfigByConfigType = {
            subscribe: [defaultEventName],
        }

        const rabbitMQProvider = new RabbitMQProvider(
            systemServiceName,
            rabbitMQConfig,
            serviceConfig,
            defaultTopicConfig,
            defaultPortalEvents,
            logger,
            metricsService,
            asyncLocalStorage,
            queueConfig,
        )

        it('should successfully get config', () => {
            // Arrange

            // Act
            const config = rabbitMQProvider.getConfig()

            // Assert
            expect(config).toEqual({
                queues: queueConfig,
                service: serviceConfig,
                topics: defaultTopicConfig,
                rabbit: rabbitMQConfig,
                portalEvents: defaultPortalEvents,
            })
        })
    })

    describe('method: `init`', () => {
        const rabbitMQProvider = new RabbitMQProvider(
            systemServiceName,
            rabbitMQConfig,
            defaultServiceConfig,
            defaultTopicConfig,
            defaultPortalEvents,
            logger,
            metricsService,
            asyncLocalStorage,
            queueConfig,
        )

        it('should successfully initialize RabbitMQ provider', async () => {
            // Arrange
            const channel = mock<Channel>()
            const amqpConnection = mock<AmqpConnection>()
            const spyCreateChanel = amqpConnection.createChannel.mockResolvedValue(channel)
            const spyConnect = amqpConnection.connect.mockResolvedValue()

            vi.spyOn(rabbitMQProvider, 'makeAMQPConnection').mockResolvedValue(amqpConnection)

            // Act
            await rabbitMQProvider.init({
                queuesOptions: [{ name: 'test-queue', bindTo: [] }],
                exchangesOptions: [],
            })

            // Assert
            expect(spyConnect).toHaveBeenCalled()
            expect(spyConnect).toHaveBeenCalledTimes(3)
            expect(spyCreateChanel).toHaveBeenCalledTimes(3)
        })
    })

    describe('method: `getStatus`', () => {
        const rabbitMQProvider = new RabbitMQProvider(
            systemServiceName,
            rabbitMQConfig,
            defaultServiceConfig,
            defaultTopicConfig,
            defaultPortalEvents,
            logger,
            metricsService,
            asyncLocalStorage,
            queueConfig,
        )

        it('should successfully get status', async () => {
            // Arrange
            const channel = mock<Channel>()
            const amqpConnection = mock<AmqpConnection>()

            amqpConnection.createChannel.mockResolvedValue(channel)
            amqpConnection.connect.mockResolvedValue()

            vi.spyOn(rabbitMQProvider, 'makeAMQPConnection').mockResolvedValue(amqpConnection)
            vi.spyOn(AmqpListener.prototype, 'getStatus').mockReturnValue(ConnectionStatus.Connected)
            vi.spyOn(AmqpPublisher.prototype, 'getStatus').mockReturnValue(ConnectionStatus.Connected)

            // Act
            await rabbitMQProvider.init({
                queuesOptions: [{ name: 'test-queue', bindTo: [] }],
                exchangesOptions: [],
            })
            const status = await rabbitMQProvider.getStatus()

            // Assert
            expect(status).toEqual({
                listener: ConnectionStatus.Connected,
                publisher: ConnectionStatus.Connected,
            })
        })

        it('should omit listener status when no listener exists', async () => {
            // Arrange
            const provider = new RabbitMQProvider(
                systemServiceName,
                rabbitMQConfig,
                defaultServiceConfig,
                defaultTopicConfig,
                defaultPortalEvents,
                logger,
                metricsService,
                asyncLocalStorage,
                queueConfig,
            )

            vi.spyOn(provider, 'makeAMQPAsserter').mockResolvedValue(amqpAsserter)

            const publisherMock = mock<AmqpPublisher>()

            publisherMock.getStatus.mockReturnValue(ConnectionStatus.Connected)
            vi.spyOn(provider, 'makeAMQPPublisher').mockResolvedValue(publisherMock)

            // Act
            await provider.init({ queuesOptions: [], exchangesOptions: [] })
            const status = provider.getStatus()

            // Assert
            expect(status).toEqual({
                publisher: ConnectionStatus.Connected,
            })
            expect(status.listener).toBeUndefined()
        })
    })

    describe('method: `init` with empty queuesOptions', () => {
        it('should skip listener connection when queuesOptions is empty', async () => {
            // Arrange
            const provider = new RabbitMQProvider(
                systemServiceName,
                rabbitMQConfig,
                defaultServiceConfig,
                defaultTopicConfig,
                defaultPortalEvents,
                logger,
                metricsService,
                asyncLocalStorage,
                queueConfig,
            )

            const spiedMakeListener = vi.spyOn(provider, 'makeAMQPListener')

            vi.spyOn(provider, 'makeAMQPAsserter').mockResolvedValue(amqpAsserter)
            vi.spyOn(provider, 'makeAMQPPublisher').mockResolvedValue(amqpPublisher)

            // Act
            await provider.init({ queuesOptions: [], exchangesOptions: [] })

            // Assert
            expect(spiedMakeListener).not.toHaveBeenCalled()
        })
    })
})
