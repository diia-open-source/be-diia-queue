import { AsyncLocalStorage } from 'node:async_hooks'
import { EventEmitter } from 'node:events'

import { afterAll, expect } from 'vitest'

import DiiaLogger from '@diia-inhouse/diia-logger'
import { LogLevel } from '@diia-inhouse/types'
import { AppValidator } from '@diia-inhouse/validators'

import constants from '@src/constants'
import { QueueContext, QueueTypes } from '@src/interfaces'
import { EventMessageHandler, EventMessageValidator, Queue, Task } from '@src/services'

import { getConfig } from '@mocks/config'
import { makeMockMetricsService } from '@mocks/services/metricsService'
import { TestTaskListener } from '@mocks/tasks'

import { ExchangeOptions, ExchangeType, QueueOptions } from '@interfaces/messageBrokerServiceConfig'

describe('Delayed task', () => {
    const hostname = 'hostname'
    const serviceName = 'testServiceName'
    const systemServiceName = 'testSystemServiceName'

    const metricsService = makeMockMetricsService()
    const asyncLocalStorage = new AsyncLocalStorage<QueueContext>()
    const logger = new DiiaLogger({ logLevel: LogLevel.DEBUG }, asyncLocalStorage)
    const validator = new AppValidator()
    const eventMessageValidator = new EventMessageValidator(validator)
    const eventMessageHandler = new EventMessageHandler(eventMessageValidator, asyncLocalStorage, logger)
    const receivingEvent = 'receiveMessage'
    // eslint-disable-next-line unicorn/prefer-event-target
    const eventEmitter = new EventEmitter()

    const defaultConfig = getConfig({ assertQueues: true, assertExchanges: true })

    afterAll(() => {
        eventEmitter.removeAllListeners(receivingEvent)
    })

    it('should be handled after delay', async () => {
        // Assert
        const queue = new Queue(systemServiceName, metricsService, defaultConfig, asyncLocalStorage, logger)
        const queueProvider = queue.makeInternalRabbitMQProvider('task')

        const testListener = new TestTaskListener('DelayedTask')

        const spiedHandler = vi.spyOn(testListener, 'handler').mockImplementation(async () => {
            eventEmitter.emit(receivingEvent)
        })

        const task = new Task(serviceName, systemServiceName, queueProvider, [testListener], eventMessageHandler, logger, hostname)

        await task.onInit()
        const delay = 500

        const publishingTime: number = Date.now()

        const receivingPromise = new Promise<number>((resolve) =>
            eventEmitter.once<number>(receivingEvent, () => {
                resolve(Date.now())
            }),
        )

        // Act
        await task.publish(testListener.name, { text: '+++' }, delay)

        const receivingTime = await receivingPromise

        // Arrange
        expect(spiedHandler).toHaveBeenCalledOnce()

        expect(receivingTime - publishingTime >= delay).toBe(true)
    })

    it('should fail to publish if isDelayed option is not specified', async () => {
        // Assert
        const queue = new Queue(systemServiceName, metricsService, defaultConfig, asyncLocalStorage, logger)

        const queueProvider = queue.makeInternalRabbitMQProvider('task')

        const testListener = new TestTaskListener('NotDelayedTask', false)

        const task = new Task(serviceName, systemServiceName, queueProvider, [testListener], eventMessageHandler, logger, hostname)

        // Act
        await task.onInit()
        const publishingPromise = task.publish(testListener.name, {}, 1)

        // Arrange
        await expect(publishingPromise).rejects.toThrow('Delay option could be used only with delayed tasks')
    })

    it('should handle message with relative configs', async () => {
        // Assert
        const queueName = 'TestQueue'
        const exchangeName = 'TextExchange'

        const queue = new Queue(systemServiceName, metricsService, defaultConfig, asyncLocalStorage, logger)

        const queueProvider = queue.makeInternalRabbitMQProvider('task')

        const exchangesOptions: ExchangeOptions[] = [
            {
                declare: true,
                name: exchangeName,
                type: ExchangeType.Direct,
            },
        ]
        const queueOptions: QueueOptions = {
            name: queueName,
            declare: true,
            type: QueueTypes.Quorum,
            options: {
                durable: true,
            },
            bindTo: [
                {
                    bind: true,
                    exchangeName,
                    routingKey: constants.DEFAULT_ROUTING_KEY,
                },
            ],
        }

        vi.spyOn(queueProvider, 'getMessageBrokerServiceConfig').mockReturnValue({
            exchangesOptions,
            queuesOptions: [queueOptions],
        })

        const testListener = new TestTaskListener('SpecialTask', false, [queueName])

        const spiedHandler = vi.spyOn(testListener, 'handler').mockImplementation(async () => {
            eventEmitter.emit(receivingEvent)
        })

        const task = new Task(serviceName, systemServiceName, queueProvider, [testListener], eventMessageHandler, logger, hostname)

        await task.onInit()

        const receivingPromise = new Promise<number>((resolve) => eventEmitter.once(receivingEvent, resolve))

        // Act
        await task.publish(testListener.name, { text: '+++' })
        await receivingPromise

        // Assert
        expect(spiedHandler).toHaveBeenCalledOnce()
    })
})
