const collectEventBusListeners = jest.fn()

jest.mock('@src/utils', () => ({ collectEventBusListeners }))

import { mockClass } from '@diia-inhouse/test'

import { asyncLocalStorage, eventMessageHandler, logger } from '../mocks'

import { EventBus, EventBusListener, InternalEvent, InternalQueueName, RabbitMQConfig } from '@src/index'
import { RabbitMQProvider } from '@src/providers/rabbitmq'

import { validRabbitMQConfig } from '@tests/mocks/providers/rabbitmq'

import { QueueConfigType } from '@interfaces/queueConfig'

describe('EventBus', () => {
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
        it('should successfully subscribe', async () => {
            const queueName = InternalQueueName.QueueAuth
            const eventBus = new EventBus(queueProvider, [], eventMessageHandler, logger)

            const messageHandler = async (): Promise<void> => {}

            jest.spyOn(queueProvider, 'subscribe').mockResolvedValue(true)

            expect(await eventBus.subscribe(queueName, messageHandler, {})).toBeTruthy()
            expect(queueProvider.subscribe).toHaveBeenCalledWith(queueName, messageHandler, {})
        })
    })

    describe('method: `publish`', () => {
        it('should successfully publish', async () => {
            const eventName = InternalEvent.AuthUserLogOut
            const message = { key: 'value' }
            const eventBus = new EventBus(queueProvider, [], eventMessageHandler, logger)

            jest.spyOn(queueProvider, 'publish').mockResolvedValue(true)

            expect(await eventBus.publish(eventName, message, '')).toBeTruthy()
            expect(queueProvider.publish).toHaveBeenCalledWith(eventName, message, '')
        })
    })

    describe('method: `onInit`', () => {
        it('should successfully initialize event bus', async () => {
            const eventBusListener = <EventBusListener>(<unknown>{
                getEvent: () => InternalEvent.AuthUserLogOut,
            })
            const eventBus = new EventBus(queueProvider, [eventBusListener], eventMessageHandler, logger, InternalQueueName.QueueAuth)

            jest.spyOn(queueProvider, 'getConfig').mockReturnValue(<RabbitMQConfig>{
                listenerOptions: { prefetchCount: 10 },
            })
            collectEventBusListeners.mockReturnValue([eventBusListener])
            jest.spyOn(queueProvider, 'subscribe').mockResolvedValue(true)

            await eventBus.onInit()

            expect(queueProvider.subscribe).toHaveBeenCalledWith(InternalQueueName.QueueAuth, expect.anything(), {
                listener: { prefetchCount: 10 },
            })
            expect(logger.info).toHaveBeenCalledWith(`Event listener [${eventBusListener.event}] initialized successfully`)
        })

        it('should skip to initialize event bus in case queue name was not provided', async () => {
            const eventBusListener = <EventBusListener>(<unknown>{
                getEvent: () => InternalEvent.AuthUserLogOut,
            })
            const eventBus = new EventBus(queueProvider, [eventBusListener], eventMessageHandler, logger)

            expect(await eventBus.onInit()).toBeUndefined()
        })
    })
})
