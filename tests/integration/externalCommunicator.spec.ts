import { AsyncLocalStorage } from 'async_hooks'

import DiiaLogger from '@diia-inhouse/diia-logger'
import { EnvService } from '@diia-inhouse/env'
import { CacheService, PubSubService } from '@diia-inhouse/redis'
import { LogLevel } from '@diia-inhouse/types'
import { AppValidator } from '@diia-inhouse/validators'

import {
    EventMessageHandler,
    EventMessageValidator,
    ExternalCommunicator,
    ExternalCommunicatorChannel,
    ExternalEventBus,
    Queue,
} from '@services/index'

import { NotificationSendTargetEventListener, UbkiCreditInfoEventListener } from '@tests/mocks/externalEventListeners'

import { QueueConnectionConfig, QueueConnectionType, QueueContext } from '@interfaces/index'
import { ExternalEvent, ExternalTopic } from '@interfaces/queueConfig'

jest.setTimeout(300000)

let external: ExternalCommunicator

const rabbitMqConfig: QueueConnectionConfig = {
    [QueueConnectionType.External]: {
        connection: {
            hostname: '127.0.0.1',
            port: 5672,
            username: 'guest',
            password: 'guest',
            heartbeat: 60,
        },
        socketOptions: {
            clientProperties: {
                applicationName: `User Service`,
            },
        },
        reconnectOptions: {
            reconnectEnabled: true,
        },
        listenerOptions: {
            prefetchCount: 3,
        },
        assertExchanges: true,
    },
}

describe(`${ExternalCommunicator.name} service`, () => {
    beforeAll(async () => {
        const asyncLocalStorage = new AsyncLocalStorage<QueueContext>()
        const logger = new DiiaLogger({ logLevel: LogLevel.DEBUG }, asyncLocalStorage)
        const envService = new EnvService(logger)
        const queue = new Queue('User', rabbitMqConfig, asyncLocalStorage, logger)
        const cache = new CacheService({ readOnly: { port: 6379 }, readWrite: { port: 6379 } }, envService, logger)
        const pubsub = new PubSubService({ readOnly: { port: 6379 }, readWrite: { port: 6379 } }, logger)
        const externalChannel = new ExternalCommunicatorChannel(cache)
        const validator = new AppValidator()
        const eventMessageValidator = new EventMessageValidator(validator)
        const eventMessageHandler = new EventMessageHandler(eventMessageValidator, externalChannel, pubsub, asyncLocalStorage, logger)

        const externalEventListenerList = [new UbkiCreditInfoEventListener(logger), new NotificationSendTargetEventListener()]
        const externalEventBus = new ExternalEventBus(
            queue.getExternalQueue(),
            externalEventListenerList,
            eventMessageHandler,
            envService,
            logger,
        )

        await externalEventBus.onInit()
        external = new ExternalCommunicator(
            externalChannel,
            externalEventBus,
            externalEventListenerList,
            eventMessageValidator,
            logger,
            pubsub,
        )
        external.onRegistrationsFinished()
    })

    it('should work when "receive" called', async () => {
        const result = await external.receive(ExternalEvent.UbkiCreditInfo, {}, { async: true })

        expect(result).toBeUndefined()
    })

    it('should work when "receiveDirect" called', async () => {
        const result = await external.receiveDirect<{ data: string }>(
            ExternalEvent.NotificationTopicSubscribeTarget,
            {
                notaryCertificateNumber: '1234',
                notarialActRegistrationNumber: '12345',
                notarialActDate: '22.11.2021',
                requestId: '-0',
            },
            {
                topic: ExternalTopic.Notification,
            },
        )

        expect(result).toEqual({ data: 'test' })
    })
})
