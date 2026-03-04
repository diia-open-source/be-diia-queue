import { describe, expect } from 'vitest'
import { mock } from 'vitest-mock-extended'

import { BaseQueueOptions, ExportConfig } from '@src/interfaces'
import { RabbitMQProvider } from '@src/providers/rabbitmq'
import { ScheduledTask } from '@src/services'

import { getExchangeOptions, getExportConfig, getQueueOptions } from '@mocks/config'
import { TestEventBusListener } from '@mocks/eventBusListeners/eventBusListeners'
import { getExpectedMsgData } from '@mocks/providers/rabbitmq/amqpPublisher'

import { ExchangeOptions, QueueOptions, QueueTypes, emptyMessageBrokerServiceConfig } from '@interfaces/messageBrokerServiceConfig'

import { eventMessageHandler, logger } from '../mocks'

describe('ScheduledTask', () => {
    const defaultHostName = 'hostname'
    const defaultServiceName = 'defaultServiceName'
    const defaultSystemServiceName = 'defaultSystemServiceName'
    const defaultQueueName = 'DefaultScheduledTaskQueueName'
    const defaultEventName = 'defaultScheduledTaskEventName'
    const defaultExchangeName = 'DefaultScheduledTaskExchangeName'
    const defaultQueueRoutingKey = `${defaultServiceName}.scheduled-task`
    const defaultExpectedMsgData = getExpectedMsgData(defaultEventName)

    const queueProvider = mock<RabbitMQProvider>()

    const exchangeOptions = getExchangeOptions({ name: 'SpecialExchange' })

    const queueName1 = 'TestScheduledTaskQueueName1'
    const queueRoutingKey1 = `${defaultQueueRoutingKey}.${queueName1}`
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
                prefetchCount: 2,
            },
        },
        defaultServiceName,
        defaultHostName,
    )

    const queueName2 = 'TestScheduledTaskQueueName2'
    const queueRoutingKey2 = `${defaultQueueRoutingKey}.${queueName2}`
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
                prefetchCount: 3,
            },
        },
        defaultServiceName,
        defaultHostName,
    )

    const queueName3 = 'TestScheduledTaskQueueName3'
    const queueRoutingKey3 = `${defaultQueueRoutingKey}.${queueName3}`
    const queueOptions3 = getQueueOptions(
        {
            name: queueName3,
            bindTo: [
                {
                    routingKey: queueRoutingKey3,
                    exchangeName: exchangeOptions.name,
                },
            ],
            consumerOptions: {
                prefetchCount: 4,
            },
        },
        defaultServiceName,
        defaultHostName,
    )

    const emptyExportConfig = getExportConfig()

    describe('subscriber side', async () => {
        const partialDefaultSubscriberExportConfig: Partial<ExportConfig> = {
            queues: {
                [defaultQueueName]: {
                    topics: [defaultExchangeName],
                },
            },
            topics: {
                [defaultExchangeName]: {
                    events: [defaultEventName],
                },
            },
        }
        const defaultSubscriberExportConfig = getExportConfig(partialDefaultSubscriberExportConfig)

        const expectedDefaultExchangeOptions: ExchangeOptions = getExchangeOptions({
            name: defaultExchangeName,
            declare: defaultSubscriberExportConfig.rabbit.declareOptions.assertExchanges,
        })

        const expectedDefaultQueueOptions: QueueOptions = getQueueOptions(
            {
                name: defaultQueueName,
                declare: defaultSubscriberExportConfig.rabbit.declareOptions.assertQueues,
                options: defaultSubscriberExportConfig.rabbit.listenerOptions.queueOptions,
                bindTo: [
                    {
                        exchangeName: defaultExchangeName,
                        routingKey: defaultQueueRoutingKey,
                        bind: defaultSubscriberExportConfig.rabbit.declareOptions.assertQueues,
                    },
                ],
                consumerOptions: {
                    prefetchCount: defaultSubscriberExportConfig.rabbit.listenerOptions.prefetchCount,
                },
            },
            defaultSystemServiceName,
            defaultHostName,
        )

        describe('method: `onInit`', () => {
            describe('global config', async () => {
                it('should successfully initialize', async () => {
                    // Arrange
                    queueProvider.getConfig.mockReturnValue(defaultSubscriberExportConfig)
                    queueProvider.getMessageBrokerServiceConfig.mockReturnValue(emptyMessageBrokerServiceConfig)

                    const event1 = 'test-event-1'
                    const event2 = 'test-event-2'

                    const eventBusListener1 = new TestEventBusListener(undefined, undefined, event1)
                    const eventBusListener2 = new TestEventBusListener(undefined, undefined, event2)

                    const eventListenerList = [eventBusListener1, eventBusListener2]

                    const scheduledTask = new ScheduledTask(
                        defaultServiceName,
                        defaultSystemServiceName,
                        queueProvider,
                        eventListenerList,
                        eventMessageHandler,
                        logger,
                        defaultHostName,
                        defaultQueueName,
                    )

                    const initMock = queueProvider.init.mockResolvedValue()

                    const subscribeMock = queueProvider.subscribe.mockResolvedValue(true)

                    const subscribeToQueuesMock = vi.spyOn(scheduledTask, 'subscribeToQueues')

                    // Act
                    await scheduledTask.onInit()

                    // Assert
                    expect(initMock).toHaveBeenCalledExactlyOnceWith({
                        queuesOptions: [expectedDefaultQueueOptions],
                        exchangesOptions: [expectedDefaultExchangeOptions],
                    })

                    expect(subscribeToQueuesMock).toHaveBeenCalledExactlyOnceWith([
                        expect.objectContaining({ eventNames: [event1, event2] }),
                    ])

                    expect(subscribeMock).toHaveBeenCalledExactlyOnceWith(defaultQueueName, expect.any(Function))
                })
                it('should successfully initialize with overridden queue options', async () => {
                    // Arrange
                    const overriddenQueuesOptions: BaseQueueOptions = {
                        type: QueueTypes.Quorum,
                        options: {
                            durable: true,
                        },
                    }

                    const exportConfig = getExportConfig({
                        ...partialDefaultSubscriberExportConfig,
                        rabbit: {
                            declareOptions: {
                                queuesOptions: overriddenQueuesOptions,
                            },
                        },
                    })

                    queueProvider.getConfig.mockReturnValue(exportConfig)
                    queueProvider.getMessageBrokerServiceConfig.mockReturnValue(emptyMessageBrokerServiceConfig)

                    const eventBusListener1 = new TestEventBusListener()
                    const eventBusListener2 = new TestEventBusListener()

                    const eventListenerList = [eventBusListener1, eventBusListener2]

                    const scheduledTask = new ScheduledTask(
                        defaultServiceName,
                        defaultSystemServiceName,
                        queueProvider,
                        eventListenerList,
                        eventMessageHandler,
                        logger,
                        defaultHostName,
                        defaultQueueName,
                    )

                    const spiedInit = queueProvider.init.mockResolvedValue()

                    // Act
                    await scheduledTask.onInit()

                    // Assert
                    expect(spiedInit).toHaveBeenCalledExactlyOnceWith({
                        queuesOptions: [
                            {
                                ...expectedDefaultQueueOptions,
                                ...overriddenQueuesOptions,
                            },
                        ],
                        exchangesOptions: [expectedDefaultExchangeOptions],
                    })
                })
                it('should skip to initialize in case queue name was not provided', async () => {
                    queueProvider.getConfig.mockReturnValue(defaultSubscriberExportConfig)
                    queueProvider.getMessageBrokerServiceConfig.mockReturnValue(emptyMessageBrokerServiceConfig)

                    const eventBusListener = new TestEventBusListener()

                    const scheduledTask = new ScheduledTask(
                        defaultServiceName,
                        defaultSystemServiceName,
                        queueProvider,
                        [eventBusListener],
                        eventMessageHandler,
                        logger,
                        undefined,
                    )

                    const spiedInit = queueProvider.init.mockResolvedValue()

                    const spiedSubscribe = queueProvider.subscribe.mockResolvedValue(true)

                    // Act
                    await scheduledTask.onInit()

                    // Assert
                    expect(spiedSubscribe).not.toHaveBeenCalledOnce()
                    expect(spiedInit).toHaveBeenCalledExactlyOnceWith({
                        queuesOptions: [],
                        exchangesOptions: [expectedDefaultExchangeOptions],
                    })
                })
            })

            describe('relative config', () => {
                it('should successfully initialize scheduled task', async () => {
                    // Arrange
                    queueProvider.getConfig.mockReturnValue(emptyExportConfig)
                    queueProvider.getMessageBrokerServiceConfig.mockReturnValue({
                        exchangesOptions: [exchangeOptions],
                        queuesOptions: [queueOptions1, queueOptions2],
                    })

                    const scheduledTaskListener1 = new TestEventBusListener([queueOptions1.name])
                    const scheduledTaskListener2 = new TestEventBusListener([queueOptions2.name])

                    const eventListenerList = [scheduledTaskListener1, scheduledTaskListener2]

                    const scheduledTask = new ScheduledTask(
                        defaultServiceName,
                        defaultSystemServiceName,
                        queueProvider,
                        eventListenerList,
                        eventMessageHandler,
                        logger,
                        defaultHostName,
                    )

                    const spiedInit = queueProvider.init.mockResolvedValue()

                    const spiedSubscribe = queueProvider.subscribe.mockResolvedValue(true)

                    // Act
                    await scheduledTask.onInit()

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

            describe('mix config', () => {
                it('should successfully initialize scheduled task', async () => {
                    // Arrange
                    queueProvider.getConfig.mockReturnValue(defaultSubscriberExportConfig)
                    queueProvider.getMessageBrokerServiceConfig.mockReturnValue({
                        exchangesOptions: [exchangeOptions],
                        queuesOptions: [queueOptions1, queueOptions3],
                    })

                    const scheduledTaskListener1 = new TestEventBusListener([queueOptions1.name])
                    const scheduledTaskListener2 = new TestEventBusListener([queueOptions3.name])
                    const scheduledTaskListener3 = new TestEventBusListener()

                    const eventListenerList = [scheduledTaskListener1, scheduledTaskListener2, scheduledTaskListener3]

                    const scheduledTask = new ScheduledTask(
                        defaultServiceName,
                        defaultSystemServiceName,
                        queueProvider,
                        eventListenerList,
                        eventMessageHandler,
                        logger,
                        defaultHostName,
                        defaultQueueName,
                    )

                    const spiedInit = queueProvider.init.mockResolvedValue()

                    const spiedSubscribe = queueProvider.subscribe.mockResolvedValue(true)

                    // Act
                    await scheduledTask.onInit()

                    // Assert
                    expect(spiedInit).toHaveBeenCalledExactlyOnceWith({
                        exchangesOptions: [expectedDefaultExchangeOptions, exchangeOptions],
                        queuesOptions: [expectedDefaultQueueOptions, queueOptions1, queueOptions3],
                    })

                    expect(spiedSubscribe).toHaveBeenCalledTimes(3)
                    expect(spiedSubscribe).toHaveBeenNthCalledWith(1, defaultQueueName, expect.any(Function))
                    expect(spiedSubscribe).toHaveBeenNthCalledWith(2, queueOptions1.name, expect.any(Function))
                    expect(spiedSubscribe).toHaveBeenNthCalledWith(3, queueOptions3.name, expect.any(Function))
                })
            })
        })

        describe('method: `publish`', () => {
            describe('global config', () => {
                it('should successfully publish event to exchange', async () => {
                    // Arrange
                    const eventBusListener1 = new TestEventBusListener()
                    const eventBusListener2 = new TestEventBusListener()

                    queueProvider.getConfig.mockReturnValue(defaultSubscriberExportConfig)
                    queueProvider.getMessageBrokerServiceConfig.mockReturnValue(emptyMessageBrokerServiceConfig)

                    const eventListenerList = [eventBusListener1, eventBusListener2]

                    const scheduledTask = new ScheduledTask(
                        defaultServiceName,
                        defaultSystemServiceName,
                        queueProvider,
                        eventListenerList,
                        eventMessageHandler,
                        logger,
                        defaultHostName,
                        defaultQueueName,
                    )

                    const spiedInit = queueProvider.init.mockResolvedValue()
                    const spiedPublish = queueProvider.publish.mockResolvedValue()
                    const spiedSubscribe = queueProvider.subscribe.mockResolvedValue(true)

                    // Act
                    await scheduledTask.onInit()
                    await scheduledTask.publish(defaultEventName, defaultServiceName)

                    // Assert
                    expect(spiedInit).toHaveBeenCalledExactlyOnceWith({
                        queuesOptions: [expectedDefaultQueueOptions],
                        exchangesOptions: [expectedDefaultExchangeOptions],
                    })

                    expect(spiedSubscribe).toHaveBeenCalledExactlyOnceWith(defaultQueueName, expect.any(Function))

                    expect(spiedPublish).toHaveBeenCalledTimes(1)
                    expect(spiedPublish).toHaveBeenNthCalledWith(1, defaultExpectedMsgData, defaultExchangeName, defaultQueueRoutingKey, {})
                })
            })

            describe('relative config', () => {
                it('should successfully publish message to queue', async () => {
                    // Arrange
                    queueProvider.getConfig.mockReturnValue(emptyExportConfig)
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

                    const scheduledTask = new ScheduledTask(
                        defaultServiceName,
                        defaultSystemServiceName,
                        queueProvider,
                        eventListenerList,
                        eventMessageHandler,
                        logger,
                        defaultHostName,
                    )

                    // Act
                    await scheduledTask.onInit()

                    const messageData = { event: defaultEventName, payload: {} }

                    await scheduledTask.publishToQueue(queueOptions1.name, messageData)
                    await scheduledTask.publishToQueue(queueOptions2.name, messageData)

                    // Assert
                    const expectedMsgData = getExpectedMsgData(messageData.event, messageData.payload)

                    expect(spiedInit).toHaveBeenCalledExactlyOnceWith({
                        exchangesOptions: [exchangeOptions],
                        queuesOptions: [queueOptions1, queueOptions2],
                    })

                    expect(spiedSubscribe).toHaveBeenCalledTimes(2)
                    expect(spiedSubscribe).toHaveBeenNthCalledWith(1, queueOptions1.name, expect.any(Function))
                    expect(spiedSubscribe).toHaveBeenNthCalledWith(2, queueOptions2.name, expect.any(Function))

                    expect(spiedPublish).toHaveBeenCalledTimes(2)
                    // eslint-disable-next-line unicorn/no-useless-undefined
                    expect(spiedPublish).toHaveBeenNthCalledWith(1, expectedMsgData, exchangeOptions.name, queueRoutingKey1, undefined)
                    // eslint-disable-next-line unicorn/no-useless-undefined
                    expect(spiedPublish).toHaveBeenNthCalledWith(2, expectedMsgData, exchangeOptions.name, queueRoutingKey2, undefined)
                })
            })

            describe('mix config', () => {
                it('should successfully publish event to exchange and message to queue', async () => {
                    // Arrange
                    queueProvider.getConfig.mockReturnValue(defaultSubscriberExportConfig)
                    queueProvider.getMessageBrokerServiceConfig.mockReturnValue({
                        exchangesOptions: [exchangeOptions],
                        queuesOptions: [queueOptions1, queueOptions3],
                    })

                    const spiedInit = queueProvider.init.mockResolvedValue()
                    const spiedPublish = queueProvider.publish.mockResolvedValue()
                    const spiedSubscribe = queueProvider.subscribe.mockResolvedValue(true)

                    const eventBusListener1 = new TestEventBusListener()
                    const eventBusListener2 = new TestEventBusListener([queueOptions1.name])
                    const eventBusListener3 = new TestEventBusListener([queueOptions3.name])

                    const eventListenerList = [eventBusListener1, eventBusListener2, eventBusListener3]

                    const scheduledTask = new ScheduledTask(
                        defaultServiceName,
                        defaultSystemServiceName,
                        queueProvider,
                        eventListenerList,
                        eventMessageHandler,
                        logger,
                        defaultHostName,
                        defaultQueueName,
                    )

                    // Act
                    await scheduledTask.onInit()

                    const messageData = { event: defaultEventName, payload: {} }

                    await scheduledTask.publishToQueue(queueOptions1.name, messageData)
                    await scheduledTask.publishToExchange(exchangeOptions.name, queueRoutingKey3, messageData)
                    await scheduledTask.publish(defaultEventName, defaultServiceName)

                    // Assert
                    const expectedMsgData = getExpectedMsgData(messageData.event, messageData.payload)

                    expect(spiedInit).toHaveBeenCalledExactlyOnceWith({
                        exchangesOptions: [expectedDefaultExchangeOptions, exchangeOptions],
                        queuesOptions: [expectedDefaultQueueOptions, queueOptions1, queueOptions3],
                    })

                    expect(spiedSubscribe).toHaveBeenCalledTimes(3)
                    expect(spiedSubscribe).toHaveBeenNthCalledWith(1, defaultQueueName, expect.any(Function))
                    expect(spiedSubscribe).toHaveBeenNthCalledWith(2, queueOptions1.name, expect.any(Function))
                    expect(spiedSubscribe).toHaveBeenNthCalledWith(3, queueOptions3.name, expect.any(Function))

                    expect(spiedPublish).toHaveBeenCalledTimes(3)
                    // eslint-disable-next-line unicorn/no-useless-undefined
                    expect(spiedPublish).toHaveBeenNthCalledWith(1, expectedMsgData, exchangeOptions.name, queueRoutingKey1, undefined)
                    // eslint-disable-next-line unicorn/no-useless-undefined
                    expect(spiedPublish).toHaveBeenNthCalledWith(2, expectedMsgData, exchangeOptions.name, queueRoutingKey3, undefined)
                    expect(spiedPublish).toHaveBeenNthCalledWith(3, expectedMsgData, defaultExchangeName, defaultQueueRoutingKey, {})
                })
            })
        })
    })

    describe('publisher side', async () => {
        const partialExportConfig: Partial<ExportConfig> = {
            topics: {
                [defaultExchangeName]: {
                    events: [defaultEventName],
                },
            },
        }
        const defaultPublisherExportConfig = getExportConfig(partialExportConfig)

        const expectedDefaultExchangeOptions = getExchangeOptions({
            name: defaultExchangeName,
            declare: defaultPublisherExportConfig.rabbit.declareOptions.assertExchanges,
        })

        describe('method: `onInit`', () => {
            describe('global config', async () => {
                it('should successfully initialize', async () => {
                    // Arrange
                    queueProvider.getConfig.mockReturnValue(defaultPublisherExportConfig)
                    queueProvider.getMessageBrokerServiceConfig.mockReturnValue(emptyMessageBrokerServiceConfig)

                    const scheduledTask = new ScheduledTask(
                        defaultServiceName,
                        defaultSystemServiceName,
                        queueProvider,
                        [],
                        eventMessageHandler,
                        logger,
                        defaultQueueName,
                    )

                    const spiedInit = queueProvider.init.mockResolvedValue()

                    const spiedSubscribe = queueProvider.subscribe.mockResolvedValue(true)

                    // Act
                    await scheduledTask.onInit()

                    // Assert
                    expect(spiedInit).toHaveBeenCalledExactlyOnceWith({
                        queuesOptions: [],
                        exchangesOptions: [expectedDefaultExchangeOptions],
                    })

                    expect(spiedSubscribe).not.toHaveBeenCalled()
                })
            })

            describe('relative config', () => {
                it('should successfully initialize', async () => {
                    // Arrange
                    queueProvider.getConfig.mockReturnValue(emptyExportConfig)
                    queueProvider.getMessageBrokerServiceConfig.mockReturnValue({
                        queuesOptions: [],
                        exchangesOptions: [exchangeOptions],
                    })

                    const scheduledTask = new ScheduledTask(
                        defaultServiceName,
                        defaultSystemServiceName,
                        queueProvider,
                        [],
                        eventMessageHandler,
                        logger,
                        defaultHostName,
                    )

                    const spiedInit = queueProvider.init.mockResolvedValue()

                    const spiedSubscribe = queueProvider.subscribe.mockResolvedValue(true)

                    // Act
                    await scheduledTask.onInit()

                    // Assert
                    expect(spiedInit).toHaveBeenCalledExactlyOnceWith({
                        queuesOptions: [],
                        exchangesOptions: [exchangeOptions],
                    })

                    expect(spiedSubscribe).not.toHaveBeenCalled()
                })
            })

            describe('mix config', () => {
                it('should successfully initialize', async () => {
                    // Arrange
                    queueProvider.getConfig.mockReturnValue(defaultPublisherExportConfig)
                    queueProvider.getMessageBrokerServiceConfig.mockReturnValue({
                        queuesOptions: [],
                        exchangesOptions: [exchangeOptions],
                    })

                    const scheduledTask = new ScheduledTask(
                        defaultServiceName,
                        defaultSystemServiceName,
                        queueProvider,
                        [],
                        eventMessageHandler,
                        logger,
                        defaultQueueName,
                    )

                    const spiedInit = queueProvider.init.mockResolvedValue()

                    const spiedSubscribe = queueProvider.subscribe.mockResolvedValue(true)

                    // Act
                    await scheduledTask.onInit()

                    // Assert
                    expect(spiedInit).toHaveBeenCalledExactlyOnceWith({
                        queuesOptions: [],
                        exchangesOptions: [exchangeOptions, expectedDefaultExchangeOptions],
                    })

                    expect(spiedSubscribe).not.toHaveBeenCalled()
                })
            })
        })

        describe('method: `publish`', () => {
            describe('global config', () => {
                it('should successfully publish', async () => {
                    // Arrange
                    const eventName1 = 'test-event-1'
                    const serviceName1 = 'test-service-name-1'

                    const eventName2 = 'test-event-2'
                    const serviceName2 = 'test-service-name-2'

                    const exportConfig = getExportConfig({
                        topics: {
                            [defaultExchangeName]: {
                                events: [eventName1, eventName2],
                            },
                        },
                    })

                    queueProvider.getConfig.mockReturnValue(exportConfig)

                    queueProvider.getMessageBrokerServiceConfig.mockReturnValue(emptyMessageBrokerServiceConfig)

                    const spiedInit = queueProvider.init.mockResolvedValue()

                    const spiedPublish = queueProvider.publish.mockResolvedValue()
                    const spiedSubscribe = queueProvider.subscribe.mockResolvedValue(true)

                    const scheduledTask = new ScheduledTask(
                        defaultServiceName,
                        defaultSystemServiceName,
                        queueProvider,
                        [],
                        eventMessageHandler,
                        logger,
                        defaultQueueName,
                    )

                    // Act
                    await scheduledTask.onInit()
                    await scheduledTask.publish(eventName1, serviceName1)
                    await scheduledTask.publish(eventName2, serviceName2)

                    // Assert
                    expect(spiedInit).toHaveBeenCalledExactlyOnceWith({
                        queuesOptions: [],
                        exchangesOptions: [expectedDefaultExchangeOptions],
                    })

                    expect(spiedSubscribe).not.toHaveBeenCalledOnce()

                    const expectedMsgData1 = getExpectedMsgData(eventName1)
                    const expectedMsgData2 = getExpectedMsgData(eventName2)

                    expect(spiedPublish).toHaveBeenCalledTimes(2)
                    expect(spiedPublish).toHaveBeenNthCalledWith(
                        1,
                        expectedMsgData1,
                        defaultExchangeName,
                        `${serviceName1}.scheduled-task`,
                        {},
                    )
                    expect(spiedPublish).toHaveBeenNthCalledWith(
                        2,
                        expectedMsgData2,
                        defaultExchangeName,
                        `${serviceName2}.scheduled-task`,
                        {},
                    )
                })
            })

            describe('relative config', () => {
                it('should successfully publish', async () => {
                    // Arrange
                    queueProvider.getConfig.mockReturnValue(emptyExportConfig)

                    queueProvider.getMessageBrokerServiceConfig.mockReturnValue({
                        queuesOptions: [],
                        exchangesOptions: [exchangeOptions],
                    })

                    const spiedInit = queueProvider.init.mockResolvedValue()

                    const spiedPublish = queueProvider.publish.mockResolvedValue()
                    const spiedSubscribe = queueProvider.subscribe.mockResolvedValue(true)

                    const scheduledTask = new ScheduledTask(
                        defaultServiceName,
                        defaultSystemServiceName,
                        queueProvider,
                        [],
                        eventMessageHandler,
                        logger,
                        defaultHostName,
                    )

                    // Act
                    await scheduledTask.onInit()

                    const message = { event: defaultEventName, payload: {} }

                    await scheduledTask.publishToExchange(exchangeOptions.name, queueRoutingKey1, message)
                    await scheduledTask.publishToExchange(exchangeOptions.name, queueRoutingKey2, message)

                    // Assert
                    const expectedMsgData = getExpectedMsgData(message.event, message.payload)

                    expect(spiedInit).toHaveBeenCalledExactlyOnceWith({
                        queuesOptions: [],
                        exchangesOptions: [exchangeOptions],
                    })

                    expect(spiedSubscribe).not.toHaveBeenCalledOnce()

                    expect(spiedPublish).toHaveBeenCalledTimes(2)
                    // eslint-disable-next-line unicorn/no-useless-undefined
                    expect(spiedPublish).toHaveBeenNthCalledWith(1, expectedMsgData, exchangeOptions.name, queueRoutingKey1, undefined)
                    // eslint-disable-next-line unicorn/no-useless-undefined
                    expect(spiedPublish).toHaveBeenNthCalledWith(2, expectedMsgData, exchangeOptions.name, queueRoutingKey2, undefined)
                })
            })

            describe('mix config', () => {
                it('should successfully publish', async () => {
                    // Arrange
                    queueProvider.getConfig.mockReturnValue(defaultPublisherExportConfig)

                    queueProvider.getMessageBrokerServiceConfig.mockReturnValue({
                        queuesOptions: [queueOptions1],
                        exchangesOptions: [exchangeOptions],
                    })

                    const spiedInit = queueProvider.init.mockResolvedValue()

                    const spiedPublish = queueProvider.publish.mockResolvedValue()
                    const spiedSubscribe = queueProvider.subscribe.mockResolvedValue(true)

                    const scheduledTask = new ScheduledTask(
                        defaultServiceName,
                        defaultSystemServiceName,
                        queueProvider,
                        [],
                        eventMessageHandler,
                        logger,
                        defaultQueueName,
                    )

                    // Act
                    const data = { event: defaultEventName, payload: {} }

                    await scheduledTask.onInit()
                    await scheduledTask.publishToQueue(queueOptions1.name, data)
                    await scheduledTask.publishToExchange(exchangeOptions.name, queueRoutingKey2, data)
                    await scheduledTask.publish(defaultEventName, defaultServiceName)

                    // Assert
                    const expectedMsgData1 = getExpectedMsgData(data.event, data.payload)
                    const expectedMsgData2 = getExpectedMsgData(defaultEventName)

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
                    expect(spiedPublish).toHaveBeenNthCalledWith(3, expectedMsgData2, defaultExchangeName, defaultQueueRoutingKey, {})
                })
            })
        })
    })
})
