import { AsyncLocalStorage } from 'async_hooks'

import DiiaLogger from '@diia-inhouse/diia-logger'
import { EnvService } from '@diia-inhouse/env'
import { CacheService, PubSubService } from '@diia-inhouse/redis'
import { LogLevel } from '@diia-inhouse/types'
import { AppValidator, ValidationSchema } from '@diia-inhouse/validators'

import { EventMessageHandler, EventMessageValidator, ExternalCommunicatorChannel, Queue, Task } from '@services/index'

import { TestTask } from '@tests/mocks/tasks'

import { QueueConnectionConfig, QueueConnectionType, QueueContext, TaskListener } from '@interfaces/index'
import { startContainers, stopContainers } from '@tests/integration/setup'

describe('Delayed task Pre-Config', () => {
    let rabbitMq: any
    let redis: any

    beforeAll(async () => {
        const { rbqConnection, redisConnection } = await startContainers()
        rabbitMq = rbqConnection
        redis = redisConnection
    })

    afterAll(async () => {
        await stopContainers()
    })

    xdescribe('Delayed task', () => {
        let rabbitMqConfig: QueueConnectionConfig
        let asyncLocalStorage: AsyncLocalStorage<QueueContext>
        let logger: DiiaLogger
        let queue: Queue
        let validator: AppValidator
        let eventMessageValidator: EventMessageValidator
        let envService: EnvService
        let cache: CacheService
        let externalChannel: ExternalCommunicatorChannel
        let pubsub: PubSubService
        let eventMessageHandler: EventMessageHandler

        beforeAll(() => {
            console.assert(rabbitMq, 'RabbitMQ connection is not defined')
            console.assert(redis, 'Redis connection is not defined')

            rabbitMqConfig = {
                [QueueConnectionType.Internal]: {
                    connection: {
                        hostname: '127.0.0.1',
                        port: 5672,
                        username: 'guest',
                        password: 'guest',
                        heartbeat: 60,
                        ...rabbitMq,
                    },
                    socketOptions: {
                        clientProperties: {
                            applicationName: `PublicService Service`,
                        },
                    },
                    reconnectOptions: {
                        reconnectEnabled: true,
                    },
                    listenerOptions: {
                        prefetchCount: 3,
                    },
                },
            }
            const redisConfig = { readOnly: redis, readWrite: redis }
            asyncLocalStorage = new AsyncLocalStorage<QueueContext>()
            logger = new DiiaLogger({ logLevel: LogLevel.DEBUG }, asyncLocalStorage)
            queue = new Queue('PublicService', rabbitMqConfig, asyncLocalStorage, logger)
            validator = new AppValidator()
            eventMessageValidator = new EventMessageValidator(validator)
            envService = new EnvService(logger)
            cache = new CacheService(redisConfig, envService, logger)
            externalChannel = new ExternalCommunicatorChannel(cache)
            pubsub = new PubSubService(redisConfig, logger)
            eventMessageHandler = new EventMessageHandler(eventMessageValidator, externalChannel, pubsub, asyncLocalStorage, logger)
        })

        it('should be handled after delay', async () => {
            const testTask = new TestTask()
            const task = new Task(queue.getInternalQueue(), [testTask], eventMessageHandler, logger)

            await task.onInit()
            const delay = 500

            const t0: number = Date.now()

            await task.publish('testTask', { text: '+++' }, delay)
            await testTask.getPromiseWithResolver()
            const t1: number = Date.now()

            expect(t1 - t0 >= delay).toBe(true)
        })

        it('should fail to publish if isDelayed is not specified', async () => {
            class TestCaseTask implements TaskListener {
                name = 'testCaseTask'

                validationRules: ValidationSchema = {}

                async handler(): Promise<void> {
                    return
                }
            }

            const task = new Task(queue.getInternalQueue(), [new TestCaseTask()], eventMessageHandler, logger)

            await task.onInit()
            await expect(async () => await task.publish('testCaseTask', {}, 1)).rejects.toThrow(
                'Delay option could be used only with delayed tasks',
            )
        })
    })
})
