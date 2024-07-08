import { AsyncLocalStorage } from 'node:async_hooks'

import DiiaLogger from '@diia-inhouse/diia-logger'
import { EnvService } from '@diia-inhouse/env'
import { CacheService, PubSubService } from '@diia-inhouse/redis'
import { LogLevel } from '@diia-inhouse/types'
import { AppValidator, ValidationSchema } from '@diia-inhouse/validators'

import { EventMessageHandler, EventMessageValidator, ExternalCommunicatorChannel, Queue, Task } from '@services/index'

import { connectOptions } from '@tests/mocks/services/queue'
import { TestTask } from '@tests/mocks/tasks'

import { QueueConnectionConfig, QueueConnectionType, QueueContext, TaskListener } from '@interfaces/index'

describe('Delayed task', () => {
    const rabbitMqConfig: QueueConnectionConfig = {
        serviceRulesConfig: connectOptions.serviceRulesConfig,
        [QueueConnectionType.Internal]: {
            connection: {
                hostname: '127.0.0.1',
                port: 5672,
                username: 'guest',
                password: 'guest',
                heartbeat: 60,
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
    const asyncLocalStorage = new AsyncLocalStorage<QueueContext>()
    const logger = new DiiaLogger({ logLevel: LogLevel.DEBUG }, asyncLocalStorage)
    const queue = new Queue('PublicService', rabbitMqConfig, asyncLocalStorage, logger)
    const validator = new AppValidator()
    const eventMessageValidator = new EventMessageValidator(validator)
    const envService = new EnvService(logger)
    const cache = new CacheService({ readOnly: { port: 6379 }, readWrite: { port: 6379 } }, envService, logger)
    const externalChannel = new ExternalCommunicatorChannel(cache)
    const pubsub = new PubSubService({ readOnly: { port: 6379 }, readWrite: { port: 6379 } }, logger)
    const eventMessageHandler = new EventMessageHandler(eventMessageValidator, externalChannel, pubsub, asyncLocalStorage, logger)

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
