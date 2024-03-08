const convertParamsByRules = jest.fn()

jest.mock('@diia-inhouse/utils', () => ({ convertParamsByRules }))

import { mockClass } from '@diia-inhouse/test'
import { ValidationSchema } from '@diia-inhouse/validators'

import { asyncLocalStorage, eventMessageHandler, logger } from '../mocks'

import { Task } from '@src/index'
import { RabbitMQProvider } from '@src/providers/rabbitmq'

import { validRabbitMQConfig } from '@tests/mocks/providers/rabbitmq'

import { QueueConfigType } from '@interfaces/queueConfig'

describe('Task', () => {
    const taskListener = {
        name: 'name',
        isDelayed: false,
        validationRules: <ValidationSchema>(<unknown>{}),
        handler: jest.fn(),
    }
    const queueProvider = new (mockClass(RabbitMQProvider))(
        'Auth',
        validRabbitMQConfig,
        {},
        {},
        QueueConfigType.Internal,
        logger,
        asyncLocalStorage,
    )

    describe('method: `subscribe`', () => {
        it('should successfully subscribe to task', async () => {
            const taskName = 'taskName'
            const task = new Task(queueProvider, [taskListener], eventMessageHandler, logger)

            const messageHandler = async (): Promise<void> => {}

            jest.spyOn(queueProvider, 'getServiceName').mockReturnValue('Auth')
            jest.spyOn(queueProvider, 'subscribeTask').mockResolvedValue(true)

            expect(await task.subscribe(taskName, messageHandler, {})).toBeTruthy()
            expect(queueProvider.subscribeTask).toHaveBeenCalledWith('TasksQueueAuth[taskName]', messageHandler, {})
        })
    })

    describe('method: `publish`', () => {
        it('should successfully publish message for task', async () => {
            const taskName = 'taskName'
            const message = { key: 'value' }
            const task = new Task(queueProvider, [taskListener], eventMessageHandler, logger)

            jest.spyOn(queueProvider, 'getServiceName').mockReturnValue('Auth')
            jest.spyOn(queueProvider, 'publishTask').mockResolvedValue(true)

            expect(await task.publish(taskName, message, 1800)).toBeTruthy()
            expect(queueProvider.publishTask).toHaveBeenCalledWith('TasksQueueAuth[taskName]', message, 1800)
        })
    })
})
