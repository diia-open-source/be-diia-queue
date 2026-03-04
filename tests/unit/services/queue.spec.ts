import { HttpStatusCode } from '@diia-inhouse/types'

import { ConnectionStatus, ExchangeOptions, ExchangeType, MessageBrokerServiceConfig, Queue, QueueOptions } from '@src/index'
import { RabbitMQProvider } from '@src/providers/rabbitmq'

import { getConnectOptions } from '@mocks/config'

import { makeMockMetricsService } from '@tests/mocks/services/metricsService'

import { asyncLocalStorage, logger } from '../mocks'

describe('Queue', () => {
    const systemServiceName = 'Auth'
    const metricsService = makeMockMetricsService()
    const defaultConnectOptions = getConnectOptions()
    const defaultQueueService = new Queue(systemServiceName, metricsService, defaultConnectOptions, asyncLocalStorage, logger)

    describe('method: `onHealthCheck`', () => {
        const cases = [
            {
                description: 'should return ok status',
                expectedConnectionStatus: {
                    listener: ConnectionStatus.Connected,
                    publisher: ConnectionStatus.Connected,
                },
                expectedStatus: HttpStatusCode.OK,
            },
            {
                description: 'should return service unavailable status',
                expectedConnectionStatus: {
                    listener: ConnectionStatus.Connected,
                    publisher: ConnectionStatus.Connecting,
                },
                expectedStatus: HttpStatusCode.SERVICE_UNAVAILABLE,
            },
        ]

        it('should pass health check when listener is not initialized (publish-only mode)', async () => {
            // Arrange
            const taskRabbitMQProvider = defaultQueueService.makeInternalRabbitMQProvider('task')
            const eventBusRabbitMQProvider = defaultQueueService.makeInternalRabbitMQProvider('eventBus')
            const scheduledTaskRabbitMQProvider = defaultQueueService.makeInternalRabbitMQProvider('scheduledTask')
            const externalEventBusRabbitMQProvider = defaultQueueService.makeExternalRabbitMQProvider('externalEventBus')

            const publishOnlyStatus = {
                publisher: ConnectionStatus.Connected,
            }

            vi.spyOn(taskRabbitMQProvider, 'getStatus').mockReturnValue(publishOnlyStatus)
            vi.spyOn(eventBusRabbitMQProvider, 'getStatus').mockReturnValue(publishOnlyStatus)
            vi.spyOn(scheduledTaskRabbitMQProvider, 'getStatus').mockReturnValue(publishOnlyStatus)
            vi.spyOn(externalEventBusRabbitMQProvider, 'getStatus').mockReturnValue(publishOnlyStatus)

            // Act
            const result = await defaultQueueService.onHealthCheck()

            // Assert
            expect(result.status).toEqual(HttpStatusCode.OK)
        })

        it.each(cases)('$description', async (params) => {
            // Arrange
            const { expectedConnectionStatus, expectedStatus } = params
            const taskRabbitMQProvider = defaultQueueService.makeInternalRabbitMQProvider('task')
            const eventBusRabbitMQProvider = defaultQueueService.makeInternalRabbitMQProvider('eventBus')
            const scheduledTaskRabbitMQProvider = defaultQueueService.makeInternalRabbitMQProvider('scheduledTask')
            const externalEventBusRabbitMQProvider = defaultQueueService.makeExternalRabbitMQProvider('externalEventBus')

            vi.spyOn(taskRabbitMQProvider, 'getStatus').mockReturnValue(expectedConnectionStatus)
            vi.spyOn(eventBusRabbitMQProvider, 'getStatus').mockReturnValue(expectedConnectionStatus)
            vi.spyOn(scheduledTaskRabbitMQProvider, 'getStatus').mockReturnValue(expectedConnectionStatus)
            vi.spyOn(externalEventBusRabbitMQProvider, 'getStatus').mockReturnValue(expectedConnectionStatus)

            // Act
            const result = await defaultQueueService.onHealthCheck()

            // Assert
            await expect(result).toEqual({
                status: expectedStatus,
                details: {
                    rabbit: {
                        internal: {
                            task: expectedConnectionStatus,
                            eventBus: expectedConnectionStatus,
                            scheduledTask: expectedConnectionStatus,
                        },
                        external: {
                            externalEventBus: expectedConnectionStatus,
                        },
                    },
                },
            })
        })
    })

    describe('method: `makeInternalRabbitMQProvider`', () => {
        it('should successfully return rabbit mq provider', () => {
            expect(defaultQueueService.makeInternalRabbitMQProvider('task')).toBeInstanceOf(RabbitMQProvider)
            expect(defaultQueueService.makeInternalRabbitMQProvider('eventBus')).toBeInstanceOf(RabbitMQProvider)
            expect(defaultQueueService.makeInternalRabbitMQProvider('eventBus')).toBeInstanceOf(RabbitMQProvider)
        })
        it('should successfully return internal rabbit mq provider', () => {
            // Arrange
            const alternateExchangeOptions: ExchangeOptions = {
                name: 'AlternateExchange',
                type: ExchangeType.Fanout,
            }
            const alternateQueueOptions: QueueOptions = {
                name: 'AlternateQueue',
                bindTo: [{ exchangeName: alternateExchangeOptions.name }],
            }

            const taskExchangeOptions: ExchangeOptions = {
                name: 'TaskExchange',
                type: ExchangeType.Topic,
            }

            const taskQueueOptions: QueueOptions = {
                name: 'TaskQueue',
                bindTo: [{ exchangeName: taskExchangeOptions.name }],
            }

            const connectionOptions = getConnectOptions({
                general: {
                    queuesOptions: [alternateQueueOptions],
                    exchangesOptions: [alternateExchangeOptions],
                },
                task: {
                    queuesOptions: [taskQueueOptions],
                    exchangesOptions: [taskExchangeOptions],
                },
            })

            const queueService = new Queue(systemServiceName, metricsService, connectionOptions, asyncLocalStorage, logger)
            const rabbitMQProvider = queueService.makeInternalRabbitMQProvider('task')

            // Act
            const messageBrokerServiceConfig = rabbitMQProvider.getMessageBrokerServiceConfig()

            // Assert
            expect(messageBrokerServiceConfig).toEqual<MessageBrokerServiceConfig>({
                queuesOptions: [taskQueueOptions, alternateQueueOptions],
                exchangesOptions: [taskExchangeOptions, alternateExchangeOptions],
            })
        })
    })

    describe('method: `makeExternalRabbitMQProvider`', () => {
        it('should successfully return rabbit mq provider', () => {
            expect(defaultQueueService.makeExternalRabbitMQProvider('externalEventBus')).toBeInstanceOf(RabbitMQProvider)
        })
    })
})
