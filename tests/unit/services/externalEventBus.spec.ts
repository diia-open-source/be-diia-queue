import { mock } from 'vitest-mock-extended'

import { EnvService } from '@diia-inhouse/env'
import { InternalServerError } from '@diia-inhouse/errors'

import constants from '@src/constants'
import {
    ExchangeType,
    ExportConfig,
    MessageData,
    PublishDirectOptions,
    PublishExternalEventOptions,
    QueueMessageMetaData,
    emptyMessageBrokerServiceConfig,
} from '@src/interfaces'
import { RabbitMQProvider } from '@src/providers/rabbitmq'
import { ExternalEventBus } from '@src/services'

import { getExchangeOptions, getExportConfig, getQueueOptions, getRabbitMQConfig } from '@mocks/config'
import { TestEventBusListener } from '@mocks/eventBusListeners/eventBusListeners'
import { getExpectedMsgData } from '@mocks/providers/rabbitmq/amqpPublisher'

import { eventMessageHandler, logger } from '@tests/unit/mocks'

import { ExchangeOptions, QueueOptions } from '@interfaces/messageBrokerServiceConfig'

describe('ExternalEventBus', () => {
    const defaultHostName = 'hostname'
    const defaultServiceName = 'defaultService'
    const defaultExchangeName = 'DefaultExternalEventBusExchange'
    const defaultPublishEvent = 'default-publish-event'
    const defaultSubscribeEvent = 'default-subscribe-event'
    const specialEvent = 'special-event'

    const exchangeOptions = getExchangeOptions({ name: 'SpecialExternalEventBusExchange' })

    const resQueueName = `special-queue.${constants.PROJECT_NAME}.${specialEvent}.res`
    const resQueueOptions = getQueueOptions(
        {
            name: resQueueName,
            bindTo: [
                {
                    routingKey: resQueueName,
                    exchangeName: exchangeOptions.name,
                },
            ],
            consumerOptions: {
                prefetchCount: 1,
            },
        },
        defaultServiceName,
        defaultHostName,
    )

    const reqQueueName = `special-queue.${constants.PROJECT_NAME}.${defaultSubscribeEvent}.req`
    const reqQueueOptions = getQueueOptions(
        {
            name: reqQueueName,
            bindTo: [
                {
                    routingKey: reqQueueName,
                    exchangeName: exchangeOptions.name,
                },
            ],
            consumerOptions: {
                prefetchCount: 1,
            },
        },
        defaultServiceName,
        defaultHostName,
    )

    const defaultExportConfig = getExportConfig({
        topics: {
            [defaultExchangeName]: {
                events: [defaultSubscribeEvent, defaultPublishEvent],
            },
        },
        service: {
            publish: [defaultPublishEvent],
            subscribe: [defaultSubscribeEvent],
        },
        rabbit: {
            ...getRabbitMQConfig(),
            declareOptions: {
                assertQueues: true,
                assertExchanges: false,
            },
        },
    })
    const emptyExportConfig = getExportConfig({})

    const envService = mock<EnvService>()
    const queueProvider = mock<RabbitMQProvider>()

    const expectedDefaultExchangeName = `TopicExternal${defaultExchangeName}`
    const expectedDefaultResQueueName = `queue.${constants.PROJECT_NAME}.${defaultPublishEvent}.res`
    const expectedDefaultReqQueueName = `queue.${constants.PROJECT_NAME}.${defaultSubscribeEvent}.req`
    const defaultMessage: MessageData = {
        event: defaultPublishEvent,
        payload: {
            text: 'test-text',
        },
    }
    const defaultFakeEvent = 'fakeEvent'

    const expectedDefaultExchangeOptions: ExchangeOptions = getExchangeOptions({
        name: expectedDefaultExchangeName,
        declare: defaultExportConfig.rabbit.declareOptions.assertExchanges,
    })
    const expectedDefaultReqQueueOptions: QueueOptions = getQueueOptions(
        {
            name: expectedDefaultReqQueueName,
            declare: defaultExportConfig.rabbit.declareOptions.assertQueues,
            bindTo: [
                {
                    routingKey: expectedDefaultReqQueueName,
                    exchangeName: expectedDefaultExchangeName,
                    bind: defaultExportConfig.rabbit.declareOptions.assertQueues,
                },
            ],
            consumerOptions: { prefetchCount: defaultExportConfig.rabbit.listenerOptions.prefetchCount },
        },
        defaultServiceName,
        defaultHostName,
    )
    const expectedDefaultResQueueOptions: QueueOptions = getQueueOptions(
        {
            name: expectedDefaultResQueueName,
            declare: defaultExportConfig.rabbit.declareOptions.assertQueues,
            bindTo: [
                {
                    routingKey: expectedDefaultResQueueName,
                    exchangeName: expectedDefaultExchangeName,
                    bind: defaultExportConfig.rabbit.declareOptions.assertQueues,
                },
            ],
            consumerOptions: { prefetchCount: defaultExportConfig.rabbit.listenerOptions.prefetchCount },
        },
        defaultServiceName,
        defaultHostName,
    )

    describe('subscriber side', () => {
        describe('method: onInit', () => {
            describe('global config', () => {
                it('should successfully initialize', async () => {
                    // Arrange
                    queueProvider.getConfig.mockReturnValue(defaultExportConfig)
                    queueProvider.getMessageBrokerServiceConfig.mockReturnValue(emptyMessageBrokerServiceConfig)

                    const eventBusListener1 = new TestEventBusListener()
                    const eventBusListener2 = new TestEventBusListener()

                    const eventListenerList = [eventBusListener1, eventBusListener2]

                    const externalEventBus = new ExternalEventBus(
                        logger,
                        defaultServiceName,
                        envService,
                        queueProvider,
                        eventListenerList,
                        eventMessageHandler,
                        defaultHostName,
                    )

                    const initMock = queueProvider.init.mockResolvedValue()

                    const subscribeMock = queueProvider.subscribe.mockResolvedValue(true)

                    const subscribeToQueuesMock = vi.spyOn(externalEventBus, 'subscribeToQueues')

                    // Act
                    await externalEventBus.onInit()

                    // Assert
                    expect(initMock).toHaveBeenCalledExactlyOnceWith({
                        exchangesOptions: [expectedDefaultExchangeOptions],
                        queuesOptions: [expectedDefaultResQueueOptions, expectedDefaultReqQueueOptions],
                    })

                    expect(subscribeToQueuesMock).toHaveBeenCalledExactlyOnceWith([
                        expect.objectContaining({ eventNames: [defaultPublishEvent] }),
                        expect.objectContaining({ eventNames: [defaultSubscribeEvent] }),
                    ])

                    expect(subscribeMock).toHaveBeenCalledTimes(eventListenerList.length)
                    expect(subscribeMock).toHaveBeenNthCalledWith(1, expectedDefaultResQueueName, expect.any(Function))
                    expect(subscribeMock).toHaveBeenNthCalledWith(2, expectedDefaultReqQueueName, expect.any(Function))
                })
                it('should successfully initialize portal queues', async () => {
                    // Arrange
                    const exportConfig: ExportConfig = {
                        ...defaultExportConfig,
                        portalEvents: [defaultSubscribeEvent],
                    }

                    queueProvider.getConfig.mockReturnValue(exportConfig)
                    queueProvider.getMessageBrokerServiceConfig.mockReturnValue(emptyMessageBrokerServiceConfig)

                    const eventBusListener1 = new TestEventBusListener()
                    const eventBusListener2 = new TestEventBusListener()

                    const eventListenerList = [eventBusListener1, eventBusListener2]

                    const externalEventBus = new ExternalEventBus(
                        logger,
                        defaultServiceName,
                        envService,
                        queueProvider,
                        eventListenerList,
                        eventMessageHandler,
                        defaultHostName,
                    )

                    const initMock = queueProvider.init.mockResolvedValue()

                    const subscribeMock = queueProvider.subscribe.mockResolvedValue(true)

                    const subscribeToQueuesMock = vi.spyOn(externalEventBus, 'subscribeToQueues')

                    // Act
                    await externalEventBus.onInit()
                    const expectedPortalReqQueueName = 'queue.portal.default-subscribe-event.req'

                    // Assert
                    expect(initMock).toHaveBeenCalledExactlyOnceWith({
                        exchangesOptions: [expectedDefaultExchangeOptions],
                        queuesOptions: [
                            expectedDefaultResQueueOptions,
                            {
                                ...expectedDefaultReqQueueOptions,
                                name: expectedPortalReqQueueName,
                                bindTo: [
                                    {
                                        exchangeName: expectedDefaultExchangeName,
                                        routingKey: expectedPortalReqQueueName,
                                        bind: defaultExportConfig.rabbit.declareOptions.assertQueues,
                                    },
                                ],
                            },
                        ],
                    })

                    expect(subscribeToQueuesMock).toHaveBeenCalledExactlyOnceWith([
                        expect.objectContaining({ eventNames: [defaultPublishEvent] }),
                        expect.objectContaining({ eventNames: [defaultSubscribeEvent] }),
                    ])

                    expect(subscribeMock).toHaveBeenCalledTimes(eventListenerList.length)
                    expect(subscribeMock).toHaveBeenNthCalledWith(1, expectedDefaultResQueueName, expect.any(Function))
                    expect(subscribeMock).toHaveBeenNthCalledWith(2, expectedPortalReqQueueName, expect.any(Function))
                })
            })

            describe('relative config', () => {
                it('should successfully initialize external event bus', async () => {
                    // Arrange
                    queueProvider.getConfig.mockReturnValue(emptyExportConfig)
                    queueProvider.getMessageBrokerServiceConfig.mockReturnValue({
                        exchangesOptions: [exchangeOptions],
                        queuesOptions: [resQueueOptions, reqQueueOptions],
                    })

                    const eventBusListener1 = new TestEventBusListener([resQueueOptions.name])
                    const eventBusListener2 = new TestEventBusListener([reqQueueOptions.name])

                    const eventListenerList = [eventBusListener1, eventBusListener2]

                    const externalEventBus = new ExternalEventBus(
                        logger,
                        defaultServiceName,
                        envService,
                        queueProvider,
                        eventListenerList,
                        eventMessageHandler,
                        defaultHostName,
                    )

                    const initMock = queueProvider.init.mockResolvedValue()

                    const subscribeMock = queueProvider.subscribe.mockResolvedValue(true)

                    // Act
                    await externalEventBus.onInit()

                    // Assert
                    expect(initMock).toHaveBeenCalledExactlyOnceWith({
                        queuesOptions: [resQueueOptions, reqQueueOptions],
                        exchangesOptions: [exchangeOptions],
                    })

                    expect(subscribeMock).toHaveBeenCalledTimes(2)
                    expect(subscribeMock).toHaveBeenNthCalledWith(1, resQueueOptions.name, expect.any(Function))
                    expect(subscribeMock).toHaveBeenNthCalledWith(2, reqQueueOptions.name, expect.any(Function))
                })
            })

            describe('mix config', () => {
                it('should successfully initialize external event bus', async () => {
                    // Arrange
                    queueProvider.getConfig.mockReturnValue(defaultExportConfig)
                    queueProvider.getMessageBrokerServiceConfig.mockReturnValue({
                        queuesOptions: [reqQueueOptions],
                        exchangesOptions: [exchangeOptions],
                    })

                    const eventBusListener1 = new TestEventBusListener([reqQueueOptions.name])
                    const eventBusListener2 = new TestEventBusListener()

                    const eventListenerList = [eventBusListener1, eventBusListener2]

                    const externalEventBus = new ExternalEventBus(
                        logger,
                        defaultServiceName,
                        envService,
                        queueProvider,
                        eventListenerList,
                        eventMessageHandler,
                        defaultHostName,
                    )

                    const spiedInit = queueProvider.init.mockResolvedValue()

                    const spiedSubscribe = queueProvider.subscribe.mockResolvedValue(true)

                    // Act
                    await externalEventBus.onInit()

                    // Assert
                    expect(spiedInit).toHaveBeenCalledExactlyOnceWith({
                        queuesOptions: expect.arrayContaining([
                            reqQueueOptions,
                            expectedDefaultReqQueueOptions,
                            expectedDefaultResQueueOptions,
                        ]),
                        exchangesOptions: [expectedDefaultExchangeOptions, exchangeOptions],
                    })

                    expect(spiedSubscribe).toHaveBeenCalledTimes(3)
                    expect(spiedSubscribe).toHaveBeenNthCalledWith(1, expectedDefaultResQueueName, expect.any(Function))
                    expect(spiedSubscribe).toHaveBeenNthCalledWith(2, expectedDefaultReqQueueName, expect.any(Function))
                    expect(spiedSubscribe).toHaveBeenNthCalledWith(3, reqQueueOptions.name, expect.any(Function))
                })
                it('should successfully initialize direct exchanges with the same names', async () => {
                    // Arrange
                    const directExchangeOptions: ExchangeOptions = {
                        ...exchangeOptions,
                        type: ExchangeType.Direct,
                        name: expectedDefaultExchangeName,
                    }

                    queueProvider.getConfig.mockReturnValue(defaultExportConfig)
                    queueProvider.getMessageBrokerServiceConfig.mockReturnValue({
                        queuesOptions: [
                            {
                                ...reqQueueOptions,
                                bindTo: [
                                    {
                                        routingKey: reqQueueName,
                                        exchangeName: expectedDefaultExchangeName,
                                    },
                                ],
                            },
                        ],
                        exchangesOptions: [directExchangeOptions],
                    })

                    const eventBusListener1 = new TestEventBusListener([reqQueueOptions.name])
                    const eventBusListener2 = new TestEventBusListener()

                    const eventListenerList = [eventBusListener1, eventBusListener2]

                    const externalEventBus = new ExternalEventBus(
                        logger,
                        defaultServiceName,
                        envService,
                        queueProvider,
                        eventListenerList,
                        eventMessageHandler,
                        defaultHostName,
                    )

                    const spiedInit = queueProvider.init.mockResolvedValue()

                    const spiedSubscribe = queueProvider.subscribe.mockResolvedValue(true)

                    // Act
                    await externalEventBus.onInit()

                    // Assert
                    expect(spiedInit).toHaveBeenCalledExactlyOnceWith({
                        queuesOptions: expect.arrayContaining([
                            {
                                ...reqQueueOptions,
                                bindTo: [
                                    {
                                        routingKey: reqQueueName,
                                        exchangeName: expectedDefaultExchangeName,
                                    },
                                ],
                            },
                            expectedDefaultReqQueueOptions,
                            expectedDefaultResQueueOptions,
                        ]),
                        exchangesOptions: [directExchangeOptions],
                    })

                    expect(spiedSubscribe).toHaveBeenCalledTimes(3)
                    expect(spiedSubscribe).toHaveBeenNthCalledWith(1, expectedDefaultResQueueName, expect.any(Function))
                    expect(spiedSubscribe).toHaveBeenNthCalledWith(2, expectedDefaultReqQueueName, expect.any(Function))
                    expect(spiedSubscribe).toHaveBeenNthCalledWith(3, reqQueueOptions.name, expect.any(Function))
                })
            })
        })

        describe('method: `publish`', () => {
            describe('global config', () => {
                it('should successfully publish', async () => {
                    // Arrange
                    const message = { key: 'test-message-1' }
                    const eventBusListener = new TestEventBusListener()

                    queueProvider.getConfig.mockReturnValue(defaultExportConfig)
                    queueProvider.getMessageBrokerServiceConfig.mockReturnValue(emptyMessageBrokerServiceConfig)

                    const eventListenerList = [eventBusListener]

                    const externalEventBus = new ExternalEventBus(
                        logger,
                        defaultServiceName,
                        envService,
                        queueProvider,
                        eventListenerList,
                        eventMessageHandler,
                        defaultHostName,
                    )

                    const spiedPublish = queueProvider.publish.mockResolvedValue()

                    const publishOptions: PublishExternalEventOptions = {
                        publishTimeout: 100,
                        throwOnPublishTimeout: true,
                    }

                    // Act
                    await externalEventBus.onInit()
                    await externalEventBus.publish(defaultPublishEvent, message)
                    await externalEventBus.publish(defaultPublishEvent, message, publishOptions)

                    // Assert
                    const expectedMeta: QueueMessageMetaData = {
                        date: expect.any(Date),
                        ignoreCache: undefined,
                        responseRoutingKey: expectedDefaultResQueueName,
                    }
                    const expectedMsgData = getExpectedMsgData(defaultPublishEvent, message, expectedMeta)

                    expect(spiedPublish).toHaveBeenCalledTimes(2)
                    expect(spiedPublish).toHaveBeenNthCalledWith(
                        1,
                        expectedMsgData,
                        expectedDefaultExchangeName,
                        `queue.${constants.PROJECT_NAME}.${defaultPublishEvent}.req`,
                        {},
                    )
                    expect(spiedPublish).toHaveBeenNthCalledWith(
                        2,
                        expectedMsgData,
                        expectedDefaultExchangeName,
                        `queue.${constants.PROJECT_NAME}.${defaultPublishEvent}.req`,
                        publishOptions,
                    )
                })
            })

            describe('relative config', () => {
                it('should successfully publish message to queue', async () => {
                    // Arrange
                    queueProvider.getConfig.mockReturnValue(emptyExportConfig)

                    queueProvider.getMessageBrokerServiceConfig.mockReturnValue({
                        exchangesOptions: [exchangeOptions],
                        queuesOptions: [resQueueOptions, reqQueueOptions],
                    })

                    const spiedInit = queueProvider.init.mockResolvedValue()
                    const spiedPublish = queueProvider.publish.mockResolvedValue()
                    const spiedSubscribe = queueProvider.subscribe.mockResolvedValue(true)

                    const eventBusListener = new TestEventBusListener([resQueueOptions.name])
                    const eventListenerList = [eventBusListener]

                    const externalEventBus = new ExternalEventBus(
                        logger,
                        defaultServiceName,
                        envService,
                        queueProvider,
                        eventListenerList,
                        eventMessageHandler,
                        defaultHostName,
                    )

                    const publishOpts2 = { publishTimeout: 100 }

                    // Act
                    await externalEventBus.onInit()
                    await externalEventBus.publishToQueue(resQueueOptions.name, defaultMessage)
                    await externalEventBus.publishToQueue(reqQueueOptions.name, defaultMessage, publishOpts2)

                    // Assert
                    const expectedMsgData = getExpectedMsgData(defaultMessage.event, defaultMessage.payload)

                    expect(spiedInit).toHaveBeenCalledExactlyOnceWith({
                        exchangesOptions: [exchangeOptions],
                        queuesOptions: [resQueueOptions, reqQueueOptions],
                    })

                    expect(spiedSubscribe).toHaveBeenCalledTimes(1)
                    expect(spiedSubscribe).toHaveBeenNthCalledWith(1, resQueueOptions.name, expect.any(Function))

                    // eslint-disable-next-line unicorn/no-useless-undefined
                    expect(spiedPublish).toHaveBeenNthCalledWith(1, expectedMsgData, exchangeOptions.name, resQueueName, undefined)
                    expect(spiedPublish).toHaveBeenNthCalledWith(2, expectedMsgData, exchangeOptions.name, reqQueueName, publishOpts2)
                })
                it('should throw error for non existing topics', async () => {
                    queueProvider.getConfig.mockReturnValue(getExportConfig())

                    queueProvider.getMessageBrokerServiceConfig.mockReturnValue({
                        exchangesOptions: [exchangeOptions],
                        queuesOptions: [resQueueOptions, reqQueueOptions],
                    })

                    const spiedPublish = queueProvider.publish.mockResolvedValue()

                    const eventBusListener1 = new TestEventBusListener([resQueueOptions.name])
                    const eventBusListener2 = new TestEventBusListener([reqQueueOptions.name])

                    const eventListenerList = [eventBusListener1, eventBusListener2]

                    const externalEventBus = new ExternalEventBus(
                        logger,
                        defaultServiceName,
                        envService,
                        queueProvider,
                        eventListenerList,
                        eventMessageHandler,
                        defaultHostName,
                    )

                    await externalEventBus.onInit()

                    // Act
                    const publishingPromise = externalEventBus.publish('fake-event', defaultMessage)

                    // Assert
                    await expect(publishingPromise).rejects.toThrow(InternalServerError)
                    expect(spiedPublish).not.toHaveBeenCalled()
                })
            })
        })
    })

    describe('publisher side', () => {
        describe('method: onInit', () => {
            describe('global config', () => {
                it('should successfully initialize', async () => {
                    // Arrange
                    queueProvider.getConfig.mockReturnValue(defaultExportConfig)
                    queueProvider.getMessageBrokerServiceConfig.mockReturnValue(emptyMessageBrokerServiceConfig)

                    const externalEventBus = new ExternalEventBus(
                        logger,
                        defaultServiceName,
                        envService,
                        queueProvider,
                        [],
                        eventMessageHandler,
                        defaultHostName,
                    )

                    const spiedInit = queueProvider.init.mockResolvedValue()

                    const spiedSubscribe = queueProvider.subscribe.mockResolvedValue(true)

                    // Act
                    await externalEventBus.onInit()

                    // Assert
                    expect(spiedInit).toHaveBeenCalledExactlyOnceWith({
                        exchangesOptions: [expectedDefaultExchangeOptions],
                        queuesOptions: expect.arrayContaining([expectedDefaultReqQueueOptions, expectedDefaultResQueueOptions]),
                    })

                    expect(spiedSubscribe).toHaveBeenCalledTimes(2)
                    expect(spiedSubscribe).toHaveBeenNthCalledWith(1, expectedDefaultResQueueName, expect.any(Function))
                    expect(spiedSubscribe).toHaveBeenNthCalledWith(2, expectedDefaultReqQueueName, expect.any(Function))
                })
            })

            describe('relative config', () => {
                it('should successfully initialize', async () => {
                    // Arrange
                    queueProvider.getConfig.mockReturnValue(emptyExportConfig)
                    queueProvider.getMessageBrokerServiceConfig.mockReturnValue({
                        exchangesOptions: [exchangeOptions],
                        queuesOptions: [resQueueOptions, reqQueueOptions],
                    })

                    const externalEventBus = new ExternalEventBus(
                        logger,
                        defaultServiceName,
                        envService,
                        queueProvider,
                        [],
                        eventMessageHandler,
                        defaultHostName,
                    )

                    const spiedInit = queueProvider.init.mockResolvedValue()

                    const spiedSubscribe = queueProvider.subscribe.mockResolvedValue(true)

                    // Act
                    await externalEventBus.onInit()

                    // Assert
                    expect(spiedInit).toHaveBeenCalledExactlyOnceWith({
                        exchangesOptions: [exchangeOptions],
                        queuesOptions: [resQueueOptions, reqQueueOptions],
                    })

                    expect(spiedSubscribe).not.toHaveBeenCalled()
                })
            })

            describe('mix config', () => {
                it('should successfully initialize', async () => {
                    queueProvider.getConfig.mockReturnValue(defaultExportConfig)
                    queueProvider.getMessageBrokerServiceConfig.mockReturnValue({
                        exchangesOptions: [exchangeOptions],
                        queuesOptions: [resQueueOptions, reqQueueOptions],
                    })

                    const externalEventBus = new ExternalEventBus(
                        logger,
                        defaultServiceName,
                        envService,
                        queueProvider,
                        [],
                        eventMessageHandler,
                        defaultHostName,
                    )

                    const spiedInit = queueProvider.init.mockResolvedValue()
                    const spiedSubscribe = queueProvider.subscribe.mockResolvedValue(true)

                    // Act
                    await externalEventBus.onInit()

                    // Assert
                    expect(spiedInit).toHaveBeenCalledExactlyOnceWith({
                        queuesOptions: expect.arrayContaining([
                            reqQueueOptions,
                            resQueueOptions,
                            expectedDefaultResQueueOptions,
                            expectedDefaultReqQueueOptions,
                        ]),
                        exchangesOptions: [expectedDefaultExchangeOptions, exchangeOptions],
                    })

                    expect(spiedSubscribe).toHaveBeenCalledTimes(2)
                    expect(spiedSubscribe).toHaveBeenNthCalledWith(1, expectedDefaultResQueueName, expect.any(Function))
                    expect(spiedSubscribe).toHaveBeenNthCalledWith(2, expectedDefaultReqQueueName, expect.any(Function))
                })
            })
        })

        describe('method: `publish`', () => {
            describe('global config', () => {
                it('should successfully publish event to exchange', async () => {
                    // Arrange
                    const message = { key: 'test-message-1' }
                    const eventBusListener = new TestEventBusListener()

                    queueProvider.getConfig.mockReturnValue(defaultExportConfig)
                    queueProvider.getMessageBrokerServiceConfig.mockReturnValue(emptyMessageBrokerServiceConfig)

                    const eventListenerList = [eventBusListener]

                    const externalEventBus = new ExternalEventBus(
                        logger,
                        defaultServiceName,
                        envService,
                        queueProvider,
                        eventListenerList,
                        eventMessageHandler,
                        defaultHostName,
                    )

                    const spiedPublish = queueProvider.publish.mockResolvedValue()

                    const publishOptions: PublishExternalEventOptions = {
                        publishTimeout: 100,
                        throwOnPublishTimeout: true,
                    }

                    // Act
                    await externalEventBus.onInit()
                    await externalEventBus.publish(defaultPublishEvent, message)
                    await externalEventBus.publish(defaultPublishEvent, message, publishOptions)

                    // Assert
                    const expectedMeta: QueueMessageMetaData = {
                        date: expect.any(Date),
                        ignoreCache: undefined,
                        responseRoutingKey: expectedDefaultResQueueName,
                    }
                    const expectedMsgData = getExpectedMsgData(defaultPublishEvent, message, expectedMeta)

                    expect(spiedPublish).toHaveBeenCalledTimes(2)
                    expect(spiedPublish).toHaveBeenNthCalledWith(
                        1,
                        expectedMsgData,
                        expectedDefaultExchangeName,
                        `queue.${constants.PROJECT_NAME}.${defaultPublishEvent}.req`,

                        {},
                    )
                    expect(spiedPublish).toHaveBeenNthCalledWith(
                        2,
                        expectedMsgData,
                        expectedDefaultExchangeName,
                        `queue.${constants.PROJECT_NAME}.${defaultPublishEvent}.req`,
                        publishOptions,
                    )
                })
            })

            describe('relative config', async () => {
                it('should successfully publish message to queue and publish message to exchange by routing key', async () => {
                    // Arrange
                    queueProvider.getConfig.mockReturnValue(emptyExportConfig)

                    queueProvider.getMessageBrokerServiceConfig.mockReturnValue({
                        exchangesOptions: [exchangeOptions],
                        queuesOptions: [resQueueOptions, reqQueueOptions],
                    })

                    const spiedInit = queueProvider.init.mockResolvedValue()
                    const spiedPublish = queueProvider.publish.mockResolvedValue()
                    const spiedSubscribe = queueProvider.subscribe.mockResolvedValue(true)

                    const externalEventBus = new ExternalEventBus(
                        logger,
                        defaultServiceName,
                        envService,
                        queueProvider,
                        [],
                        eventMessageHandler,
                        defaultHostName,
                    )

                    const publishOpts2 = { publishTimeout: 100 }

                    // Act
                    await externalEventBus.onInit()
                    await externalEventBus.publishToQueue(resQueueOptions.name, defaultMessage)
                    await externalEventBus.publishToExchange(exchangeOptions.name, reqQueueName, defaultMessage, publishOpts2)

                    // Assert
                    const expectedMsgData = getExpectedMsgData(defaultMessage.event, defaultMessage.payload)

                    expect(spiedInit).toHaveBeenCalledExactlyOnceWith({
                        exchangesOptions: [exchangeOptions],
                        queuesOptions: [resQueueOptions, reqQueueOptions],
                    })

                    expect(spiedSubscribe).not.toHaveBeenCalled()

                    // eslint-disable-next-line unicorn/no-useless-undefined
                    expect(spiedPublish).toHaveBeenNthCalledWith(1, expectedMsgData, exchangeOptions.name, resQueueName, undefined)
                    expect(spiedPublish).toHaveBeenNthCalledWith(2, expectedMsgData, exchangeOptions.name, reqQueueName, publishOpts2)
                })
            })
        })
    })

    describe('independent side', () => {
        describe('method: publish', () => {
            describe('global config', () => {
                it('should throw error for non existing topics', async () => {
                    queueProvider.getConfig.mockReturnValue(defaultExportConfig)
                    queueProvider.getMessageBrokerServiceConfig.mockReturnValue(emptyMessageBrokerServiceConfig)

                    const spiedPublish = queueProvider.publish.mockResolvedValue()

                    const eventBusListener = new TestEventBusListener()

                    const externalEventBus = new ExternalEventBus(
                        logger,
                        defaultServiceName,
                        envService,
                        queueProvider,
                        [eventBusListener],
                        eventMessageHandler,
                        defaultHostName,
                    )

                    await externalEventBus.onInit()

                    // Act
                    const publishingPromise = externalEventBus.publish(defaultFakeEvent, defaultMessage)

                    // Assert
                    await expect(publishingPromise).rejects.toThrow(InternalServerError)
                    expect(spiedPublish).not.toHaveBeenCalled()
                })
                it('should publish to an exchange if the exchange is provided', async () => {
                    queueProvider.getConfig.mockReturnValue(defaultExportConfig)
                    queueProvider.getMessageBrokerServiceConfig.mockReturnValue(emptyMessageBrokerServiceConfig)

                    const spiedPublishExternalDirect = queueProvider.publishExternalDirect.mockResolvedValue(true)

                    const eventBusListener = new TestEventBusListener()

                    const externalEventBus = new ExternalEventBus(
                        logger,
                        defaultServiceName,
                        envService,
                        queueProvider,
                        [eventBusListener],
                        eventMessageHandler,
                        defaultHostName,
                    )

                    // Act
                    await externalEventBus.onInit()

                    const alternativeExchange = 'AlternativeExchange'
                    const options: PublishDirectOptions = { exchangeName: alternativeExchange }
                    const result = await externalEventBus.publishDirect(defaultFakeEvent, defaultMessage, options)

                    // Assert
                    const expectedMsgData = getExpectedMsgData(defaultFakeEvent, defaultMessage)

                    expect(result).toBeTruthy()
                    expect(spiedPublishExternalDirect).toHaveBeenCalledWith(
                        expectedMsgData,
                        alternativeExchange,
                        `queue.diia.${defaultFakeEvent}.req`,
                        options,
                    )
                })
            })
            describe('relative config', () => {
                it('should throw error for non existing topics', async () => {
                    queueProvider.getConfig.mockReturnValue(getExportConfig())
                    queueProvider.getMessageBrokerServiceConfig.mockReturnValue({
                        exchangesOptions: [exchangeOptions],
                        queuesOptions: [resQueueOptions, reqQueueOptions],
                    })

                    const spiedPublish = queueProvider.publish.mockResolvedValue()

                    const eventBusListener = new TestEventBusListener([resQueueOptions.name])

                    const externalEventBus = new ExternalEventBus(
                        logger,
                        defaultServiceName,
                        envService,
                        queueProvider,
                        [eventBusListener],
                        eventMessageHandler,
                        defaultHostName,
                    )

                    await externalEventBus.onInit()

                    // Act
                    const publishingPromise = externalEventBus.publish('fake-event', defaultMessage)

                    // Assert
                    await expect(publishingPromise).rejects.toThrow(InternalServerError)

                    expect(spiedPublish).not.toHaveBeenCalled()
                })
            })
        })
    })
})
