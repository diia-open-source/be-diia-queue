const collectEventBusListeners = jest.fn()

jest.mock('@src/utils', () => ({ collectEventBusListeners }))

import { mockClass } from '@diia-inhouse/test'

import { asyncLocalStorage, eventMessageHandler, logger } from '../mocks'

import { EventBusListener, RabbitMQConfig, ScheduledTask } from '@src/index'
import { RabbitMQProvider } from '@src/providers/rabbitmq'

import { validRabbitMQConfig } from '@tests/mocks/providers/rabbitmq'

import { QueueConfigType } from '@interfaces/queueConfig'

const messageHandler = async (): Promise<void> => {}

describe('ScheduledTask', () => {
    const queueProvider = new (mockClass(RabbitMQProvider))(
        'Auth',
        validRabbitMQConfig,
        {},
        {},
        [],
        [],
        QueueConfigType.Internal,
        logger,
        asyncLocalStorage,
    )

    describe('method: `subscribe`', () => {
        it('should successfully subscribe', async () => {
            const queueName = 'scheduledTasksQueueAuth'
            const scheduledTask = new ScheduledTask(queueProvider, [], eventMessageHandler, logger, undefined)

            jest.spyOn(queueProvider, 'subscribe').mockResolvedValue(true)
            jest.spyOn(queueProvider, 'getServiceName').mockReturnValue('Auth')

            expect(await scheduledTask.subscribe(queueName, messageHandler, {})).toBeTruthy()
            expect(queueProvider.subscribe).toHaveBeenCalledWith(queueName, messageHandler, { routingKey: 'Auth.scheduled-task' })
        })
    })

    describe('method: `publish`', () => {
        it('should successfully publish', async () => {
            const eventName = 'authCheckRefreshTokensExpiration'
            const message = 'message'
            const scheduledTask = new ScheduledTask(queueProvider, [], eventMessageHandler, logger, undefined)

            jest.spyOn(queueProvider, 'publish').mockResolvedValue(true)
            jest.spyOn(queueProvider, 'getServiceName').mockReturnValue('Auth')

            expect(await scheduledTask.publish(eventName, message)).toBeTruthy()
            expect(queueProvider.publish).toHaveBeenCalledWith(eventName, {}, { routingKey: 'message.scheduled-task' })
        })
    })

    describe('method: `onInit`', () => {
        it('should successfully initialize event bus', async () => {
            const eventBusListener = <EventBusListener>(<unknown>{
                getEvent: () => 'authUserLogOut',
            })
            const scheduledTask = new ScheduledTask(
                queueProvider,
                [eventBusListener],
                eventMessageHandler,
                logger,
                'scheduledTasksQueueAuth',
            )

            jest.spyOn(queueProvider, 'getConfig').mockReturnValue(<RabbitMQConfig>{
                listenerOptions: { prefetchCount: 10 },
            })
            collectEventBusListeners.mockReturnValue([eventBusListener])
            jest.spyOn(queueProvider, 'subscribe').mockResolvedValue(true)

            await scheduledTask.onInit()

            expect(queueProvider.subscribe).toHaveBeenCalledWith('scheduledTasksQueueAuth', expect.anything(), {
                routingKey: 'Auth.scheduled-task',
            })
            expect(logger.info).toHaveBeenCalledWith(`Scheduled task [${eventBusListener.event}] initialized successfully`)
        })

        it('should skip to initialize event bus in case queue name was not provided', async () => {
            const eventBusListener = <EventBusListener>(<unknown>{
                getEvent: () => 'authUserLogOut',
            })
            const scheduledTask = new ScheduledTask(queueProvider, [eventBusListener], eventMessageHandler, logger, undefined)

            expect(await scheduledTask.onInit()).toBeUndefined()
        })
    })
})
