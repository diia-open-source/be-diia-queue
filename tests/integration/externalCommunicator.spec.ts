import { AsyncLocalStorage } from 'node:async_hooks'

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

import { ReceiveDirectEventListener, ReceiveEventListener } from '@tests/mocks/externalEventListeners'

import { QueueConnectionConfig, QueueConnectionType, QueueContext } from '@interfaces/index'
import { QueueConfigType } from '@interfaces/queueConfig'

jest.setTimeout(300000)

let external: ExternalCommunicator

const receiveEventName = 'receive-event-name'
const receiveDirectEventName = 'receive-direct-event-name'
const receiveDirectTopicName = 'receive-direct-topic-name'

const rabbitMqConfig: QueueConnectionConfig = {
    serviceRulesConfig: {
        servicesConfig: {
            [QueueConfigType.Internal]: {},
            [QueueConfigType.External]: {
                publish: [receiveEventName],
                subscribe: [receiveDirectEventName],
            },
        },
        topicsConfig: {
            [QueueConfigType.Internal]: {},
            [QueueConfigType.External]: {
                [receiveDirectTopicName]: {
                    events: [receiveDirectEventName, receiveEventName],
                },
            },
        },
        queuesConfig: {
            [QueueConfigType.Internal]: {},
        },
        portalEvents: [],
        internalEvents: [],
    },
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

        const externalEventListenerList = [
            new ReceiveEventListener(logger, receiveEventName),
            new ReceiveDirectEventListener(receiveDirectEventName),
        ]
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
        const result = await external.receive(receiveEventName, {}, { async: true })

        expect(result).toBeUndefined()
    })

    it('should work when "receiveDirect" called', async () => {
        const result = await external.receiveDirect<{ data: string }>(
            receiveDirectEventName,
            {
                notaryCertificateNumber: '1234',
                notarialActRegistrationNumber: '12345',
                notarialActDate: '22.11.2021',
                requestId: '-0',
            },
            {
                topic: receiveDirectTopicName,
            },
        )

        expect(result).toEqual({ data: 'test' })
    })
})
