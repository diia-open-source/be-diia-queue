import { describe, expect } from 'vitest'
import { mock } from 'vitest-mock-extended'

import constants from '@src/constants'
import {
    BaseQueueOptions,
    ExportConfig,
    MessageBrokerServiceConfig,
    QueueMessageData,
    QueueTypes,
    Task,
    emptyMessageBrokerServiceConfig,
} from '@src/index'
import { RabbitMQProvider } from '@src/providers/rabbitmq'
import { getConsumerTag } from '@src/utils'

import { getExchangeOptions, getExportConfig, getQueueOptions } from '@mocks/config'
import { TestTaskListener, TestTaskListenerName } from '@mocks/tasks'

import { eventMessageHandler, logger } from '../mocks'

describe('Task', () => {
    const defaultTaskName = 'testTask'

    const defaultHostname = 'hostname'
    const defaultSystemServiceName = 'TestSystemService'
    const defaultServiceName = 'TestService'

    const emptyExportConfig = getExportConfig()

    const queueProvider = mock<RabbitMQProvider>()

    const defaultExchangeOptions = getExchangeOptions({ name: 'TestExchange' })
    const defaultQueueOptions = getQueueOptions(
        {
            name: 'TestQueue',
            bindTo: [
                {
                    exchangeName: defaultExchangeOptions.name,
                    routingKey: constants.DEFAULT_ROUTING_KEY,
                },
            ],
            consumerOptions: {
                prefetchCount: 4,
            },
        },
        defaultServiceName,
        defaultHostname,
    )

    const defaultMessageBrokerServiceConfig: MessageBrokerServiceConfig = {
        queuesOptions: [defaultQueueOptions],
        exchangesOptions: [defaultExchangeOptions],
    }

    describe('method: `onInit`', () => {
        it('should produce no listeners and no subscriptions when consumerEnabled is false', async () => {
            // Arrange
            const exportConfigWithConsumerDisabled = getExportConfig({
                rabbit: { consumerEnabled: false },
            })

            const spiedInit = queueProvider.init.mockResolvedValue()
            const spiedSubscribe = queueProvider.subscribe.mockResolvedValue(true)

            queueProvider.getConfig.mockReturnValue(exportConfigWithConsumerDisabled)
            queueProvider.getMessageBrokerServiceConfig.mockReturnValue(emptyMessageBrokerServiceConfig)

            const taskListener = new TestTaskListener()
            const task = new Task(
                defaultServiceName,
                defaultSystemServiceName,
                queueProvider,
                [taskListener],
                eventMessageHandler,
                logger,
                defaultHostname,
            )

            // Act
            await task.onInit()

            // Assert
            expect(spiedInit).toHaveBeenCalledExactlyOnceWith(
                expect.objectContaining({
                    queuesOptions: [],
                }),
            )
            expect(spiedSubscribe).not.toHaveBeenCalled()
        })

        describe('global config', async () => {
            it('should successfully initialize', async () => {
                // Arrange
                const spiedInit = queueProvider.init.mockResolvedValue()
                const spiedSubscribe = queueProvider.subscribe.mockResolvedValue(true)

                queueProvider.getConfig.mockReturnValue(emptyExportConfig)
                queueProvider.getMessageBrokerServiceConfig.mockReturnValue(emptyMessageBrokerServiceConfig)

                const taskListener = new TestTaskListener()
                const task = new Task(
                    defaultServiceName,
                    defaultSystemServiceName,
                    queueProvider,
                    [taskListener],
                    eventMessageHandler,
                    logger,
                    defaultHostname,
                )

                // Act
                await task.onInit()

                // Assert
                const expectedTaskName = `TasksQueue${defaultServiceName}[${taskListener.name}]`

                expect(spiedInit).toHaveBeenCalledExactlyOnceWith({
                    queuesOptions: [
                        {
                            type: QueueTypes.Quorum,
                            name: expectedTaskName,
                            declare: emptyExportConfig.rabbit.declareOptions.assertQueues,
                            bindTo: [
                                {
                                    exchangeName: expectedTaskName,
                                    routingKey: constants.DEFAULT_ROUTING_KEY,
                                    bind: emptyExportConfig.rabbit.declareOptions.assertQueues,
                                },
                            ],
                            consumerOptions: {
                                consumerTag: getConsumerTag(defaultSystemServiceName, defaultHostname),
                                prefetchCount: emptyExportConfig.rabbit.listenerOptions.prefetchCount,
                            },
                        },
                    ],
                    exchangesOptions: [
                        {
                            delayed: true,
                            name: expectedTaskName,
                            declare: emptyExportConfig.rabbit.declareOptions.assertExchanges,
                        },
                    ],
                })

                expect(spiedSubscribe).toHaveBeenCalledExactlyOnceWith('TasksQueueTestService[testTask]', expect.any(Function))

                expect(logger.error).not.toHaveBeenCalledWith(
                    'Not found exchange options by name (TasksQueueTestService[testTask]) for task service',
                )
            })
            it('should successfully initialize with overridden queue options', async () => {
                // Arrange
                const spiedInit = queueProvider.init.mockResolvedValue()

                const overriddenQueuesOptions: BaseQueueOptions = {
                    type: QueueTypes.Quorum,
                    options: {
                        durable: true,
                    },
                }

                const exportConfig: ExportConfig = getExportConfig({
                    rabbit: {
                        declareOptions: {
                            queuesOptions: overriddenQueuesOptions,
                        },
                    },
                })

                queueProvider.getConfig.mockReturnValue(exportConfig)
                queueProvider.getMessageBrokerServiceConfig.mockReturnValue(emptyMessageBrokerServiceConfig)

                const taskListener = new TestTaskListener()
                const task = new Task(
                    defaultServiceName,
                    defaultSystemServiceName,
                    queueProvider,
                    [taskListener],
                    eventMessageHandler,
                    logger,
                    defaultHostname,
                )

                // Act
                await task.onInit()

                // Assert
                const expectedTaskName = `TasksQueue${defaultServiceName}[${taskListener.name}]`

                expect(spiedInit).toHaveBeenCalledExactlyOnceWith({
                    queuesOptions: [
                        {
                            name: expectedTaskName,
                            declare: exportConfig.rabbit.declareOptions.assertQueues,
                            bindTo: [
                                {
                                    exchangeName: expectedTaskName,
                                    routingKey: constants.DEFAULT_ROUTING_KEY,
                                    bind: emptyExportConfig.rabbit.declareOptions.assertQueues,
                                },
                            ],
                            consumerOptions: {
                                consumerTag: getConsumerTag(defaultSystemServiceName, defaultHostname),
                                prefetchCount: emptyExportConfig.rabbit.listenerOptions.prefetchCount,
                            },
                            ...overriddenQueuesOptions,
                        },
                    ],
                    exchangesOptions: [
                        {
                            delayed: true,
                            name: expectedTaskName,
                            declare: emptyExportConfig.rabbit.declareOptions.assertExchanges,
                        },
                    ],
                })
            })
        })

        describe('relative config', async () => {
            it('should successfully initialize', async () => {
                // Arrange
                const spiedInit = queueProvider.init.mockResolvedValue()
                const spiedSubscribe = queueProvider.subscribe.mockResolvedValue(true)

                queueProvider.getConfig.mockReturnValue(emptyExportConfig)

                queueProvider.getMessageBrokerServiceConfig.mockReturnValue(defaultMessageBrokerServiceConfig)

                const taskListener = new TestTaskListener(defaultTaskName, true, [defaultQueueOptions.name])
                const task = new Task(
                    defaultServiceName,
                    defaultSystemServiceName,
                    queueProvider,
                    [taskListener],
                    eventMessageHandler,
                    logger,
                    defaultHostname,
                )

                // Act
                await task.onInit()

                // Assert
                expect(spiedInit).toHaveBeenCalledExactlyOnceWith(defaultMessageBrokerServiceConfig)

                expect(spiedSubscribe).toHaveBeenCalledExactlyOnceWith(defaultQueueOptions.name, expect.any(Function))
            })
        })

        describe('mix config', async () => {
            it('should successfully initialize', async () => {
                // Arrange
                const spiedInit = queueProvider.init.mockResolvedValue()
                const spiedSubscribe = queueProvider.subscribe.mockResolvedValue(true)

                queueProvider.getConfig.mockReturnValue(emptyExportConfig)

                queueProvider.getMessageBrokerServiceConfig.mockReturnValue(defaultMessageBrokerServiceConfig)

                const taskListener = new TestTaskListener(defaultTaskName, true, [defaultQueueOptions.name])
                const task = new Task(
                    defaultServiceName,
                    defaultSystemServiceName,
                    queueProvider,
                    [taskListener],
                    eventMessageHandler,
                    logger,
                    defaultHostname,
                )

                // Act
                await task.onInit()

                // Assert
                expect(spiedInit).toHaveBeenCalledExactlyOnceWith({
                    queuesOptions: [defaultQueueOptions],
                    exchangesOptions: [defaultExchangeOptions],
                })

                expect(spiedSubscribe).toHaveBeenCalledExactlyOnceWith(defaultQueueOptions.name, expect.any(Function))
            })
        })
    })
    describe('method: `publish`', () => {
        describe('global config', async () => {
            it('should successfully publish message', async () => {
                // Arrange
                queueProvider.getConfig.mockReturnValue(emptyExportConfig)
                queueProvider.getMessageBrokerServiceConfig.mockReturnValue(emptyMessageBrokerServiceConfig)

                const spiedPublish = queueProvider.publish.mockResolvedValue()

                const taskListener = new TestTaskListener()
                const task = new Task(
                    defaultServiceName,
                    defaultSystemServiceName,
                    queueProvider,
                    [taskListener],
                    eventMessageHandler,
                    logger,
                    defaultHostname,
                )

                // Act
                await task.onInit()

                const payload = { text: '+++' }

                const delay = 100

                await task.publish(taskListener.name, payload, delay)

                // Assert
                const expectedMsg: QueueMessageData = {
                    payload,
                    event: 'TasksQueueTestService[testTask]',
                    meta: {
                        date: expect.any(Date),
                    },
                }

                const expectedExchangeName = `TasksQueue${defaultServiceName}[${taskListener.name}]`

                expect(spiedPublish).toHaveBeenCalledExactlyOnceWith(expectedMsg, expectedExchangeName, constants.DEFAULT_ROUTING_KEY, {
                    delay,
                })
            })
        })

        describe('relative config', async () => {
            it('should successfully publish message', async () => {
                // Arrange
                queueProvider.getConfig.mockReturnValue(emptyExportConfig)
                queueProvider.getMessageBrokerServiceConfig.mockReturnValue({
                    queuesOptions: [defaultQueueOptions],
                    exchangesOptions: [{ ...defaultExchangeOptions, delayed: true }],
                })

                const spiedPublish = queueProvider.publish.mockResolvedValue()

                const taskListener = new TestTaskListener(defaultTaskName, true, [defaultQueueOptions.name])
                const task = new Task(
                    defaultServiceName,
                    defaultSystemServiceName,
                    queueProvider,
                    [taskListener],
                    eventMessageHandler,
                    logger,
                    defaultHostname,
                )

                // Act
                await task.onInit()

                const payload = { text: '+++' }

                const delay = 100

                await task.publish(TestTaskListenerName, payload, delay)

                // Assert
                const expectedMsg: QueueMessageData = {
                    payload,
                    event: 'TasksQueueTestService[testTask]',
                    meta: {
                        date: expect.any(Date),
                    },
                }

                expect(spiedPublish).toHaveBeenCalledExactlyOnceWith(
                    expectedMsg,
                    defaultExchangeOptions.name,
                    constants.DEFAULT_ROUTING_KEY,
                    {
                        delay,
                    },
                )
            })
        })
    })
})
