const collectEventBusListeners = jest.fn()

jest.mock('@src/utils', () => ({ collectEventBusListeners }))

import { mockClass } from '@diia-inhouse/test'

import { asyncLocalStorage, eventMessageHandler, logger } from '../mocks'

import { EventBus, EventBusListener, RabbitMQConfig } from '@src/index'
import { RabbitMQProvider } from '@src/providers/rabbitmq'

import { validRabbitMQConfig } from '@tests/mocks/providers/rabbitmq'

import { QueueConfigType } from '@interfaces/queueConfig'

const messageHandler = async (): Promise<void> => {}

describe('EventBus', () => {
    const queueName = 'queue-auth'
    const eventName = 'auth-user-log-out'
    const queueProvider = new (mockClass(RabbitMQProvider))(
        'Auth',
        validRabbitMQConfig,
        {},
        {},
        [],
        [queueName],
        QueueConfigType.Internal,
        logger,
        asyncLocalStorage,
    )

    describe('method: `subscribe`', () => {
        it('should successfully subscribe', async () => {
            const eventBus = new EventBus(queueProvider, [], eventMessageHandler, logger, undefined)

            jest.spyOn(queueProvider, 'subscribe').mockResolvedValue(true)

            expect(await eventBus.subscribe(queueName, messageHandler, {})).toBeTruthy()
            expect(queueProvider.subscribe).toHaveBeenCalledWith(queueName, messageHandler, {})
        })
    })

    describe('method: `publish`', () => {
        it('should successfully publish', async () => {
            const message = { key: 'value' }
            const eventBus = new EventBus(queueProvider, [], eventMessageHandler, logger, undefined)

            jest.spyOn(queueProvider, 'publish').mockResolvedValue(true)

            expect(await eventBus.publish(eventName, message, { routingKey: '' })).toBeTruthy()
            expect(queueProvider.publish).toHaveBeenCalledWith(eventName, message, { routingKey: '' })
        })
    })

    describe('method: `onInit`', () => {
        it('should successfully initialize event bus', async () => {
            const eventBusListener = <EventBusListener>(<unknown>{
                getEvent: () => eventName,
            })
            const eventBus = new EventBus(queueProvider, [eventBusListener], eventMessageHandler, logger, queueName)

            jest.spyOn(queueProvider, 'getConfig').mockReturnValue(<RabbitMQConfig>{
                listenerOptions: { prefetchCount: 10 },
            })
            collectEventBusListeners.mockReturnValue([eventBusListener])
            jest.spyOn(queueProvider, 'subscribe').mockResolvedValue(true)

            await eventBus.onInit()

            expect(queueProvider.subscribe).toHaveBeenCalledWith(queueName, expect.anything(), {
                listener: { prefetchCount: 10 },
            })
            expect(logger.info).toHaveBeenCalledWith(`Event listener [${eventBusListener.event}] initialized successfully`)
        })

        it('should skip to initialize event bus in case queue name was not provided', async () => {
            const eventBusListener = <EventBusListener>(<unknown>{
                getEvent: () => eventName,
            })
            const eventBus = new EventBus(queueProvider, [eventBusListener], eventMessageHandler, logger, undefined)

            expect(await eventBus.onInit()).toBeUndefined()
        })
    })
})
