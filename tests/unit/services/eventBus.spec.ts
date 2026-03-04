import { describe, expect } from 'vitest'
import { mock } from 'vitest-mock-extended'

import constants from '@src/constants'
import { EventBus, ExportConfig, MessageData, PublishOptions, emptyMessageBrokerServiceConfig } from '@src/index'
import { RabbitMQProvider } from '@src/providers/rabbitmq'

import { getExchangeOptions, getExportConfig, getQueueOptions } from '@mocks/config'
import { TestEventBusListener } from '@mocks/eventBusListeners/eventBusListeners'
import { getExpectedMsgData } from '@mocks/providers/rabbitmq/amqpPublisher'

import { BaseQueueOptions, ExchangeOptions, QueueOptions, QueueTypes } from '@interfaces/messageBrokerServiceConfig'

import { eventMessageHandler, logger } from '../mocks'

describe('EventBus', () => {
    const hostname = 'hostname'
    const systemServiceName = 'test-service'

    const defaultEventName1 = 'defaultEvent1'
    const defaultEventName2 = 'defaultEvent2'
    const defaultServiceName = 'defaultService'
    const defaultQueueName = 'DefaultEventBusQueue'
    const defaultExchangeName = 'DefaultEventBusExchange'

    const partialExportConfig: Partial<ExportConfig> = {
        topics: {
            [defaultExchangeName]: {
                events: [defaultEventName1, defaultEventName2],
            },
        },
        queues: {
            [defaultQueueName]: {
                topics: [defaultExchangeName],
            },
        },
    }
    const defaultExportConfig: ExportConfig = getExportConfig(partialExportConfig)

    const queueProvider = mock<RabbitMQProvider>()

    const exchangeOptions: ExchangeOptions = getExchangeOptions({ name: 'SpecialEventBusExchange' })

    const queueName1 = 'SpecialEventBusQueueName1'
    const queueRoutingKey1 = `${defaultServiceName}.queue.${queueName1}`
    const queueOptions1 = getQueueOptions(
        {
            name: queueName1,
            bindTo: [
                {
                    routingKey: queueRoutingKey1,
                    exchangeName: exchangeOptions.name,
                },
            ],
            consumerOptions: {
                prefetchCount: 1,
            },
        },
        systemServiceName,
        hostname,
    )

    const queueName2 = 'SpecialEventBusQueueName2'
    const queueRoutingKey2 = `${defaultServiceName}.queue.${queueName2}`
    const queueOptions2 = getQueueOptions(
        {
            name: queueName2,
            bindTo: [
                {
                    routingKey: queueRoutingKey2,
                    exchangeName: exchangeOptions.name,
                },
            ],
            consumerOptions: {
                prefetchCount: 11,
            },
        },
        systemServiceName,
        hostname,
    )

    const queueName3 = 'SpecialEventBusQueueName3'
    const queueRoutingKey3 = `${defaultServiceName}.queue.${queueName3}`
    const queueOptions3 = getQueueOptions(
        {
            name: queueName3,
            bindTo: [
                {
                    routingKey: queueRoutingKey3,
                    exchangeName: exchangeOptions.name,
                },
            ],
        },
        defaultServiceName,
        hostname,
    )

    const expectedDefaultExchangeOptions: ExchangeOptions = getExchangeOptions({
        name: defaultExchangeName,
        declare: defaultExportConfig.rabbit.declareOptions.assertExchanges,
    })

    const expectedDefaultQueueOptions: QueueOptions = getQueueOptions(
        {
            name: defaultQueueName,
            declare: defaultExportConfig.rabbit.declareOptions.assertQueues,
            options: defaultExportConfig.rabbit.listenerOptions.queueOptions,
            bindTo: [
                {
                    exchangeName: defaultExchangeName,
                    routingKey: constants.DEFAULT_ROUTING_KEY,
                    bind: defaultExportConfig.rabbit.declareOptions.assertQueues,
                },
            ],
            consumerOptions: {
                prefetchCount: defaultExportConfig.rabbit.listenerOptions.prefetchCount,
            },
        },
        systemServiceName,
        hostname,
    )

    const defaultPayload: MessageData = {
        event: defaultEventName1,
        payload: { text: 'test-text' },
    }

    describe('subscriber side', async () => {
        describe('method: `onInit`', () => {
            it('should produce no listeners and no subscriptions when consumerEnabled is false', async () => {
                // Arrange
                const exportConfigWithConsumerDisabled = getExportConfig({
                    ...partialExportConfig,
                    rabbit: { consumerEnabled: false },
                })

                queueProvider.getConfig.mockReturnValue(exportConfigWithConsumerDisabled)
                queueProvider.getMessageBrokerServiceConfig.mockReturnValue(emptyMessageBrokerServiceConfig)

                const eventBusListener1 = new TestEventBusListener(undefined, undefined, defaultEventName1)

                const eventBus = new EventBus(
                    queueProvider,
                    [eventBusListener1],
                    eventMessageHandler,
                    logger,
                    hostname,
                    systemServiceName,
                    defaultQueueName,
                )

                const initMock = queueProvider.init.mockResolvedValue()
                const subscribeMock = queueProvider.subscribe.mockResolvedValue(true)

                // Act
                await eventBus.onInit()

                // Assert
                expect(initMock).toHaveBeenCalledExactlyOnceWith(
                    expect.objectContaining({
                        queuesOptions: [],
                    }),
                )
                expect(subscribeMock).not.toHaveBeenCalled()
            })

            describe('global config', () => {
                it('should successfully initialize event bus', async () => {
                    // Arrange
                    queueProvider.getConfig.mockReturnValue(defaultExportConfig)
                    queueProvider.getMessageBrokerServiceConfig.mockReturnValue(emptyMessageBrokerServiceConfig)

                    const eventBusListener1 = new TestEventBusListener(undefined, undefined, defaultEventName1)
                    const eventBusListener2 = new TestEventBusListener(undefined, undefined, defaultEventName2)

                    const eventListenerList = [eventBusListener1, eventBusListener2]

                    const eventBus = new EventBus(
                        queueProvider,
                        eventListenerList,
                        eventMessageHandler,
                        logger,
                        hostname,
                        systemServiceName,
                        defaultQueueName,
                    )

                    const initMock = queueProvider.init.mockResolvedValue()

                    const subscribeMock = queueProvider.subscribe.mockResolvedValue(true)

                    const subscribeToQueuesMock = vi.spyOn(eventBus, 'subscribeToQueues')

                    // Act
                    await eventBus.onInit()

                    // Assert
                    expect(initMock).toHaveBeenCalledExactlyOnceWith({
                        queuesOptions: [expectedDefaultQueueOptions],
                        exchangesOptions: [expectedDefaultExchangeOptions],
                    })

                    expect(subscribeToQueuesMock).toHaveBeenCalledExactlyOnceWith([
                        expect.objectContaining({ eventNames: [defaultEventName1, defaultEventName2] }),
                    ])

                    expect(subscribeMock).toHaveBeenCalledExactlyOnceWith(defaultQueueName, expect.any(Function))
                })
                it('should successfully initialize eventBus with overridden queues options', async () => {
                    // Assert
                    const initMock = queueProvider.init.mockResolvedValue()

                    const overriddenQueuesOptions: BaseQueueOptions = {
                        type: QueueTypes.Quorum,
                        options: {
                            durable: true,
                        },
                    }

                    const exportConfig: ExportConfig = getExportConfig({
                        ...partialExportConfig,
                        rabbit: {
                            declareOptions: {
                                queuesOptions: overriddenQueuesOptions,
                            },
                        },
                    })

                    queueProvider.getConfig.mockReturnValue(exportConfig)
                    queueProvider.getMessageBrokerServiceConfig.mockReturnValue(emptyMessageBrokerServiceConfig)

                    const eventBusListener1 = new TestEventBusListener()

                    const eventBus = new EventBus(
                        queueProvider,
                        [eventBusListener1],
                        eventMessageHandler,
                        logger,
                        hostname,
                        systemServiceName,
                        defaultQueueName,
                    )

                    // Act
                    await eventBus.onInit()

                    // Arrange
                    const expectedQueueOptions: QueueOptions = {
                        ...expectedDefaultQueueOptions,
                        ...overriddenQueuesOptions,
                    }

                    expect(initMock).toHaveBeenCalledExactlyOnceWith({
                        queuesOptions: [expectedQueueOptions],
                        exchangesOptions: [expectedDefaultExchangeOptions],
                    })
                })
                it('should skip to initialize event bus in case queue name was not provided', async () => {
                    // Arrange
                    queueProvider.getConfig.mockReturnValue(defaultExportConfig)
                    queueProvider.getMessageBrokerServiceConfig.mockReturnValue(emptyMessageBrokerServiceConfig)

                    const eventBusListener = new TestEventBusListener()

                    const eventBus = new EventBus(
                        queueProvider,
                        [eventBusListener],
                        eventMessageHandler,
                        logger,
                        hostname,
                        systemServiceName,
                    )

                    const spiedInit = queueProvider.init.mockResolvedValue()

                    const spiedSubscribe = queueProvider.subscribe.mockResolvedValue(true)

                    // Act
                    await eventBus.onInit()

                    // Assert
                    expect(spiedSubscribe).not.toHaveBeenCalledOnce()
                    expect(spiedInit).toHaveBeenCalledExactlyOnceWith({
                        queuesOptions: [],
                        exchangesOptions: [],
                    })
                })
            })

            describe('relative config', () => {
                it('should successfully initialize event bus', async () => {
                    // Arrange
                    queueProvider.getConfig.mockReturnValue(getExportConfig())
                    queueProvider.getMessageBrokerServiceConfig.mockReturnValue({
                        exchangesOptions: [exchangeOptions],
                        queuesOptions: [queueOptions1, queueOptions2],
                    })

                    const eventBusListener1 = new TestEventBusListener([queueOptions1.name])
                    const eventBusListener2 = new TestEventBusListener([queueOptions2.name])

                    const eventListenerList = [eventBusListener1, eventBusListener2]

                    const eventBus = new EventBus(
                        queueProvider,
                        eventListenerList,
                        eventMessageHandler,
                        logger,
                        hostname,
                        systemServiceName,
                    )

                    const spiedInit = queueProvider.init.mockResolvedValue()

                    const spiedSubscribe = queueProvider.subscribe.mockResolvedValue(true)

                    // Act
                    await eventBus.onInit()

                    // Assert
                    expect(spiedInit).toHaveBeenCalledExactlyOnceWith({
                        exchangesOptions: [exchangeOptions],
                        queuesOptions: [queueOptions1, queueOptions2],
                    })

                    expect(spiedSubscribe).toHaveBeenCalledTimes(2)
                    expect(spiedSubscribe).toHaveBeenNthCalledWith(1, queueOptions1.name, expect.any(Function))
                    expect(spiedSubscribe).toHaveBeenNthCalledWith(2, queueOptions2.name, expect.any(Function))
                })
            })

            describe('mix config', async () => {
                it('should successfully initialize eventBus', async () => {
                    // Arrange
                    queueProvider.getConfig.mockReturnValue(defaultExportConfig)
                    queueProvider.getMessageBrokerServiceConfig.mockReturnValue({
                        exchangesOptions: [exchangeOptions],
                        queuesOptions: [queueOptions1, queueOptions2, queueOptions3],
                    })

                    const eventBusListener1 = new TestEventBusListener([queueOptions1.name])
                    const eventBusListener2 = new TestEventBusListener([queueOptions2.name])
                    const eventBusListener3 = new TestEventBusListener([queueOptions3.name])
                    const eventBusListener4 = new TestEventBusListener()

                    const eventListenerList = [eventBusListener1, eventBusListener2, eventBusListener3, eventBusListener4]

                    const eventBus = new EventBus(
                        queueProvider,
                        eventListenerList,
                        eventMessageHandler,
                        logger,
                        hostname,
                        systemServiceName,
                        defaultQueueName,
                    )

                    const spiedInit = queueProvider.init.mockResolvedValue()

                    const spiedSubscribe = queueProvider.subscribe.mockResolvedValue(true)

                    // Act
                    await eventBus.onInit()

                    // Assert
                    expect(spiedInit).toHaveBeenCalledExactlyOnceWith({
                        exchangesOptions: [expectedDefaultExchangeOptions, exchangeOptions],
                        queuesOptions: [
                            expectedDefaultQueueOptions,
                            queueOptions1,
                            queueOptions2,
                            {
                                ...queueOptions3,
                                consumerOptions: {
                                    ...queueOptions3.consumerOptions,
                                    prefetchCount: defaultExportConfig.rabbit.listenerOptions.prefetchCount,
                                },
                            },
                        ],
                    })

                    expect(spiedSubscribe).toHaveBeenCalledTimes(4)
                    expect(spiedSubscribe).toHaveBeenNthCalledWith(1, defaultQueueName, expect.any(Function))
                    expect(spiedSubscribe).toHaveBeenNthCalledWith(2, queueOptions1.name, expect.any(Function))
                    expect(spiedSubscribe).toHaveBeenNthCalledWith(3, queueOptions2.name, expect.any(Function))
                    expect(spiedSubscribe).toHaveBeenNthCalledWith(4, queueOptions3.name, expect.any(Function))
                })
            })
        })

        describe('method: onDestroy', () => {
            describe('global config', () => {
                it('should unsubscribe from queues successfully', async () => {
                    // Arrange
                    queueProvider.getConfig.mockReturnValue(defaultExportConfig)
                    queueProvider.getMessageBrokerServiceConfig.mockReturnValue(emptyMessageBrokerServiceConfig)

                    const eventBusListener1 = new TestEventBusListener()
                    const eventBusListener2 = new TestEventBusListener()

                    const eventListenerList = [eventBusListener1, eventBusListener2]

                    const eventBus = new EventBus(
                        queueProvider,
                        eventListenerList,
                        eventMessageHandler,
                        logger,
                        hostname,
                        systemServiceName,
                        defaultQueueName,
                    )

                    queueProvider.init.mockResolvedValue()
                    queueProvider.subscribe.mockResolvedValue(true)

                    const unsubscribeMock = queueProvider.unsubscribe.mockResolvedValue()

                    // Act
                    await eventBus.onInit()
                    await eventBus.onDestroy()

                    // Assert
                    expect(unsubscribeMock).toHaveBeenCalledExactlyOnceWith(defaultQueueName)
                })
            })

            describe('relative config', () => {
                it('should unsubscribe from queues successfully', async () => {
                    // Arrange
                    queueProvider.getConfig.mockReturnValue(getExportConfig())
                    queueProvider.getMessageBrokerServiceConfig.mockReturnValue({
                        exchangesOptions: [exchangeOptions],
                        queuesOptions: [queueOptions1, queueOptions2],
                    })

                    const eventBusListener1 = new TestEventBusListener([queueOptions1.name])
                    const eventBusListener2 = new TestEventBusListener([queueOptions2.name])

                    const eventListenerList = [eventBusListener1, eventBusListener2]

                    const eventBus = new EventBus(
                        queueProvider,
                        eventListenerList,
                        eventMessageHandler,
                        logger,
                        hostname,
                        systemServiceName,
                    )

                    queueProvider.init.mockResolvedValue()
                    queueProvider.subscribe.mockResolvedValue(true)

                    const unsubscribeMock = queueProvider.unsubscribe.mockResolvedValue()

                    // Act
                    await eventBus.onInit()
                    await eventBus.onDestroy()

                    // Assert
                    expect(unsubscribeMock).toHaveBeenCalledTimes(2)
                    expect(unsubscribeMock).toHaveBeenNthCalledWith(1, queueOptions1.name)
                    expect(unsubscribeMock).toHaveBeenNthCalledWith(2, queueOptions2.name)
                })
            })

            describe('mix config', async () => {
                it('should successfully initialize eventBus', async () => {
                    // Arrange
                    queueProvider.getConfig.mockReturnValue(defaultExportConfig)
                    queueProvider.getMessageBrokerServiceConfig.mockReturnValue({
                        exchangesOptions: [exchangeOptions],
                        queuesOptions: [queueOptions1, queueOptions2, queueOptions3],
                    })

                    const eventBusListener1 = new TestEventBusListener([queueOptions1.name])
                    const eventBusListener2 = new TestEventBusListener([queueOptions2.name])
                    const eventBusListener3 = new TestEventBusListener([queueOptions3.name])
                    const eventBusListener4 = new TestEventBusListener()

                    const eventListenerList = [eventBusListener1, eventBusListener2, eventBusListener3, eventBusListener4]

                    const eventBus = new EventBus(
                        queueProvider,
                        eventListenerList,
                        eventMessageHandler,
                        logger,
                        hostname,
                        systemServiceName,
                        defaultQueueName,
                    )

                    queueProvider.init.mockResolvedValue()
                    queueProvider.subscribe.mockResolvedValue(true)

                    const unsubscribeMock = queueProvider.unsubscribe.mockResolvedValue()

                    // Act
                    await eventBus.onInit()
                    await eventBus.onDestroy()

                    // Assert
                    expect(unsubscribeMock).toHaveBeenCalledTimes(4)
                    expect(unsubscribeMock).toHaveBeenNthCalledWith(1, defaultQueueName)
                    expect(unsubscribeMock).toHaveBeenNthCalledWith(2, queueOptions1.name)
                    expect(unsubscribeMock).toHaveBeenNthCalledWith(3, queueOptions2.name)
                    expect(unsubscribeMock).toHaveBeenNthCalledWith(4, queueOptions3.name)
                })
            })
        })

        describe('method: `publish`', () => {
            describe('global config', () => {
                it('should successfully publish event to exchange', async () => {
                    // Arrange
                    const message1 = { key: 'test-message-1' }
                    const eventBusListener1 = new TestEventBusListener()

                    const message2 = { key: 'test-message-2' }
                    const eventBusListener2 = new TestEventBusListener()

                    const publishOptions2: PublishOptions = {
                        publishTimeout: 100,
                        throwOnPublishTimeout: true,
                        routingKey: 'special-routing-key',
                    }

                    queueProvider.getConfig.mockReturnValue(defaultExportConfig)
                    queueProvider.getMessageBrokerServiceConfig.mockReturnValue(emptyMessageBrokerServiceConfig)

                    const eventListenerList = [eventBusListener1, eventBusListener2]

                    const eventBus = new EventBus(
                        queueProvider,
                        eventListenerList,
                        eventMessageHandler,
                        logger,
                        hostname,
                        systemServiceName,
                        defaultQueueName,
                    )

                    const spiedInit = queueProvider.init.mockResolvedValue()
                    const spiedPublish = queueProvider.publish.mockResolvedValue()
                    const spiedSubscribe = queueProvider.subscribe.mockResolvedValue(true)

                    // Act
                    await eventBus.onInit()
                    await eventBus.publish(defaultEventName1, message1)
                    await eventBus.publish(defaultEventName2, message2, publishOptions2)

                    // Assert
                    const expectedMsgData1 = getExpectedMsgData(defaultEventName1, message1)
                    const expectedMsgData2 = getExpectedMsgData(defaultEventName2, message2)

                    expect(spiedInit).toHaveBeenCalledExactlyOnceWith({
                        queuesOptions: [expectedDefaultQueueOptions],
                        exchangesOptions: [expectedDefaultExchangeOptions],
                    })

                    expect(spiedSubscribe).toHaveBeenCalledExactlyOnceWith(defaultQueueName, expect.any(Function))

                    expect(spiedPublish).toHaveBeenCalledTimes(2)

                    expect(spiedPublish).toHaveBeenNthCalledWith(1, expectedMsgData1, defaultExchangeName, undefined, {})

                    const { routingKey, ...expectedPublishOptions2 } = publishOptions2

                    expect(spiedPublish).toHaveBeenNthCalledWith(
                        2,
                        expectedMsgData2,
                        defaultExchangeName,
                        routingKey,
                        expectedPublishOptions2,
                    )
                })
            })

            describe('relative config', () => {
                it('should successfully publish message to exchange', async () => {
                    // Arrange
                    queueProvider.getConfig.mockReturnValue(getExportConfig())

                    queueProvider.getMessageBrokerServiceConfig.mockReturnValue({
                        exchangesOptions: [exchangeOptions],
                        queuesOptions: [queueOptions1, queueOptions2],
                    })

                    const spiedInit = queueProvider.init.mockResolvedValue()
                    const spiedPublish = queueProvider.publish.mockResolvedValue()
                    const spiedSubscribe = queueProvider.subscribe.mockResolvedValue(true)

                    const eventBusListener1 = new TestEventBusListener([queueOptions1.name])
                    const eventBusListener2 = new TestEventBusListener([queueOptions2.name])

                    const eventListenerList = [eventBusListener1, eventBusListener2]

                    const eventBus = new EventBus(
                        queueProvider,
                        eventListenerList,
                        eventMessageHandler,
                        logger,
                        hostname,
                        systemServiceName,
                    )

                    const publishOpts2 = { publishTimeout: 100, routingKey: 'test-routing-key' }

                    // Act
                    await eventBus.onInit()
                    await eventBus.publishToExchange(exchangeOptions.name, queueRoutingKey1, defaultPayload)
                    await eventBus.publishToExchange(exchangeOptions.name, queueRoutingKey2, defaultPayload, publishOpts2)

                    // Assert
                    const expectedMsgData = getExpectedMsgData(defaultPayload.event, defaultPayload.payload)

                    expect(spiedInit).toHaveBeenCalledExactlyOnceWith({
                        exchangesOptions: [exchangeOptions],
                        queuesOptions: [queueOptions1, queueOptions2],
                    })

                    expect(spiedSubscribe).toHaveBeenCalledTimes(2)
                    expect(spiedSubscribe).toHaveBeenNthCalledWith(1, queueOptions1.name, expect.any(Function))
                    expect(spiedSubscribe).toHaveBeenNthCalledWith(2, queueOptions2.name, expect.any(Function))

                    // eslint-disable-next-line unicorn/no-useless-undefined
                    expect(spiedPublish).toHaveBeenNthCalledWith(1, expectedMsgData, exchangeOptions.name, queueRoutingKey1, undefined)
                    expect(spiedPublish).toHaveBeenNthCalledWith(2, expectedMsgData, exchangeOptions.name, queueRoutingKey2, publishOpts2)
                })
            })
        })
    })

    describe('publisher side', async () => {
        describe('method: `onInit`', () => {
            describe('global config', () => {
                it('should successfully initialize event bus', async () => {
                    // Arrange
                    queueProvider.getConfig.mockReturnValue(defaultExportConfig)
                    queueProvider.getMessageBrokerServiceConfig.mockReturnValue(emptyMessageBrokerServiceConfig)

                    const eventBus = new EventBus(
                        queueProvider,
                        [],
                        eventMessageHandler,
                        logger,
                        hostname,
                        systemServiceName,
                        defaultQueueName,
                    )

                    const spiedInit = queueProvider.init.mockResolvedValue()

                    const spiedSubscribe = queueProvider.subscribe.mockResolvedValue(true)

                    // Act
                    await eventBus.onInit()

                    // Assert
                    expect(spiedInit).toHaveBeenCalledExactlyOnceWith({
                        queuesOptions: [],
                        exchangesOptions: [expectedDefaultExchangeOptions],
                    })

                    expect(spiedSubscribe).not.toHaveBeenCalled()
                })
                it('should skip to initialize event bus in case queue name was not provided', async () => {
                    // Arrange
                    queueProvider.getConfig.mockReturnValue(defaultExportConfig)
                    queueProvider.getMessageBrokerServiceConfig.mockReturnValue(emptyMessageBrokerServiceConfig)

                    const eventBusListener = new TestEventBusListener()

                    const eventBus = new EventBus(
                        queueProvider,
                        [eventBusListener],
                        eventMessageHandler,
                        logger,
                        hostname,
                        systemServiceName,
                    )

                    const spiedInit = queueProvider.init.mockResolvedValue()

                    const spiedSubscribe = queueProvider.subscribe.mockResolvedValue(true)

                    // Act
                    await eventBus.onInit()

                    // Assert
                    expect(spiedSubscribe).not.toHaveBeenCalledOnce()
                    expect(spiedInit).toHaveBeenCalledExactlyOnceWith({
                        queuesOptions: [],
                        exchangesOptions: [],
                    })
                })
            })

            describe('relative config', () => {
                it('should successfully initialize event bus', async () => {
                    // Arrange
                    queueProvider.getConfig.mockReturnValue(getExportConfig())

                    queueProvider.getMessageBrokerServiceConfig.mockReturnValue({
                        queuesOptions: [],
                        exchangesOptions: [exchangeOptions],
                    })

                    const eventBus = new EventBus(queueProvider, [], eventMessageHandler, logger, hostname, systemServiceName)

                    const spiedInit = queueProvider.init.mockResolvedValue()

                    const spiedSubscribe = queueProvider.subscribe.mockResolvedValue(true)

                    // Act
                    await eventBus.onInit()

                    // Assert
                    expect(spiedInit).toHaveBeenCalledExactlyOnceWith({
                        queuesOptions: [],
                        exchangesOptions: [exchangeOptions],
                    })

                    expect(spiedSubscribe).not.toHaveBeenCalled()
                })
            })

            describe('mix config', () => {
                it('should successfully initialize event bus', async () => {
                    // Arrange
                    queueProvider.getConfig.mockReturnValue(defaultExportConfig)
                    queueProvider.getMessageBrokerServiceConfig.mockReturnValue({
                        exchangesOptions: [exchangeOptions],
                        queuesOptions: [queueOptions1, queueOptions2, queueOptions3],
                    })

                    const eventBus = new EventBus(
                        queueProvider,
                        [],
                        eventMessageHandler,
                        logger,
                        hostname,
                        systemServiceName,
                        defaultQueueName,
                    )

                    const spiedInit = queueProvider.init.mockResolvedValue()

                    const spiedSubscribe = queueProvider.subscribe.mockResolvedValue(true)

                    // Act
                    await eventBus.onInit()

                    // Assert
                    expect(spiedInit).toHaveBeenCalledExactlyOnceWith({
                        exchangesOptions: [exchangeOptions, expectedDefaultExchangeOptions],
                        queuesOptions: [
                            queueOptions1,
                            queueOptions2,
                            {
                                ...queueOptions3,
                                consumerOptions: {
                                    ...queueOptions3.consumerOptions,
                                    prefetchCount: defaultExportConfig.rabbit.listenerOptions.prefetchCount,
                                },
                            },
                        ],
                    })

                    expect(spiedSubscribe).not.toHaveBeenCalled()
                })
            })
        })

        describe('method: `publish`', () => {
            describe('global config', () => {
                it('should successfully publish event to exchange', async () => {
                    // Arrange
                    queueProvider.getConfig.mockReturnValue(defaultExportConfig)
                    queueProvider.getMessageBrokerServiceConfig.mockReturnValue(emptyMessageBrokerServiceConfig)

                    const spiedInit = queueProvider.init.mockResolvedValue()

                    const spiedPublish = queueProvider.publish.mockResolvedValue()
                    const spiedSubscribe = queueProvider.subscribe.mockResolvedValue(true)

                    const eventBus = new EventBus(
                        queueProvider,
                        [],
                        eventMessageHandler,
                        logger,
                        hostname,
                        systemServiceName,
                        defaultQueueName,
                    )

                    const payload = {
                        text: 'test-text',
                    }

                    const publishOpts2 = { publishTimeout: 100, routingKey: 'test-routing-key' }

                    // Act
                    await eventBus.onInit()
                    await eventBus.publish(defaultEventName1, payload)
                    await eventBus.publish(defaultEventName2, payload, publishOpts2)

                    // Assert
                    expect(spiedInit).toHaveBeenCalledExactlyOnceWith({
                        queuesOptions: [],
                        exchangesOptions: [expectedDefaultExchangeOptions],
                    })

                    expect(spiedSubscribe).not.toHaveBeenCalledOnce()

                    const expectedMsgData1 = getExpectedMsgData(defaultEventName1, payload)
                    const expectedMsgData2 = getExpectedMsgData(defaultEventName2, payload)

                    expect(spiedPublish).toHaveBeenCalledTimes(2)

                    expect(spiedPublish).toHaveBeenNthCalledWith(1, expectedMsgData1, defaultExchangeName, undefined, {})

                    const { routingKey: routingKey2, ...expectedPublishOptions2 } = publishOpts2

                    expect(spiedPublish).toHaveBeenNthCalledWith(
                        2,
                        expectedMsgData2,
                        defaultExchangeName,
                        routingKey2,
                        expectedPublishOptions2,
                    )
                })
            })

            describe('relative config', () => {
                it('should successfully publish message to exchange', async () => {
                    // Arrange
                    queueProvider.getConfig.mockReturnValue(getExportConfig())
                    queueProvider.getMessageBrokerServiceConfig.mockReturnValue({
                        exchangesOptions: [exchangeOptions],
                        queuesOptions: [],
                    })

                    const spiedInit = queueProvider.init.mockResolvedValue()

                    const spiedPublish = queueProvider.publish.mockResolvedValue()
                    const spiedSubscribe = queueProvider.subscribe.mockResolvedValue(true)

                    const eventBus = new EventBus(queueProvider, [], eventMessageHandler, logger, hostname, systemServiceName)

                    const publishOpts2 = { publishTimeout: 100, routingKey: 'test-routing-key' }

                    // Act
                    await eventBus.onInit()
                    await eventBus.publishToExchange(exchangeOptions.name, queueRoutingKey1, defaultPayload)
                    await eventBus.publishToExchange(exchangeOptions.name, queueRoutingKey2, defaultPayload, publishOpts2)

                    // Assert
                    const expectedMsgData = getExpectedMsgData(defaultPayload.event, defaultPayload.payload)

                    expect(spiedInit).toHaveBeenCalledExactlyOnceWith({
                        queuesOptions: [],
                        exchangesOptions: [exchangeOptions],
                    })
                    expect(spiedSubscribe).not.toHaveBeenCalledOnce()
                    expect(spiedPublish).toHaveBeenCalledTimes(2)

                    // eslint-disable-next-line unicorn/no-useless-undefined
                    expect(spiedPublish).toHaveBeenNthCalledWith(1, expectedMsgData, exchangeOptions.name, queueRoutingKey1, undefined)
                    expect(spiedPublish).toHaveBeenNthCalledWith(2, expectedMsgData, exchangeOptions.name, queueRoutingKey2, publishOpts2)
                })
            })

            describe('mix config', () => {
                it('should successfully publish', async () => {
                    // Arrange
                    queueProvider.getConfig.mockReturnValue(defaultExportConfig)

                    queueProvider.getMessageBrokerServiceConfig.mockReturnValue({
                        queuesOptions: [queueOptions1],
                        exchangesOptions: [exchangeOptions],
                    })

                    const spiedInit = queueProvider.init.mockResolvedValue()

                    const spiedPublish = queueProvider.publish.mockResolvedValue()
                    const spiedSubscribe = queueProvider.subscribe.mockResolvedValue(true)

                    const scheduledTask = new EventBus(
                        queueProvider,
                        [],
                        eventMessageHandler,
                        logger,
                        hostname,
                        systemServiceName,
                        defaultQueueName,
                    )

                    const publishEventOptions = { routingKey: queueRoutingKey3 }

                    // Act
                    await scheduledTask.onInit()

                    const message = { event: defaultEventName1, payload: { text: 'test-text' } }

                    await scheduledTask.publishToQueue(queueOptions1.name, message)
                    await scheduledTask.publishToExchange(exchangeOptions.name, queueRoutingKey2, message)
                    await scheduledTask.publish(defaultEventName1, {}, publishEventOptions)

                    // Assert
                    const expectedMsgData1 = getExpectedMsgData(message.event, message.payload)
                    const expectedMsgData = getExpectedMsgData(defaultEventName1, {})

                    expect(spiedInit).toHaveBeenCalledExactlyOnceWith({
                        queuesOptions: [queueOptions1],
                        exchangesOptions: [exchangeOptions, expectedDefaultExchangeOptions],
                    })

                    expect(spiedSubscribe).not.toHaveBeenCalledOnce()

                    expect(spiedPublish).toHaveBeenCalledTimes(3)
                    // eslint-disable-next-line unicorn/no-useless-undefined
                    expect(spiedPublish).toHaveBeenNthCalledWith(1, expectedMsgData1, exchangeOptions.name, queueRoutingKey1, undefined)
                    // eslint-disable-next-line unicorn/no-useless-undefined
                    expect(spiedPublish).toHaveBeenNthCalledWith(2, expectedMsgData1, exchangeOptions.name, queueRoutingKey2, undefined)
                    expect(spiedPublish).toHaveBeenNthCalledWith(3, expectedMsgData, defaultExchangeName, queueRoutingKey3, {})
                })
            })
        })
    })
})
