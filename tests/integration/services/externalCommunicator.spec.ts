import { AsyncLocalStorage } from 'node:async_hooks'

import DiiaLogger from '@diia-inhouse/diia-logger'
import { EnvService } from '@diia-inhouse/env'
import { LogLevel } from '@diia-inhouse/types'
import { RandomUtils } from '@diia-inhouse/utils'
import { AppValidator } from '@diia-inhouse/validators'

import { QueueConnectionConfig, QueueConnectionType, QueueContext } from '@src/interfaces'
import { EventMessageHandler, EventMessageValidator, ExternalCommunicator, ExternalEventBus, Queue } from '@src/services'

import { defaultServiceRulesConfig, getRabbitMQConfig } from '@mocks/config'
import { ReceiveDirectEventListener, ReceiveEventListener } from '@mocks/externalEventListeners'
import { makeMockMetricsService } from '@mocks/services/metricsService'

import { ReceiveDirectOps } from '@interfaces/externalCommunicator'
import { QueueConfigType } from '@interfaces/queueConfig'

let external: ExternalCommunicator

const receiveEventName = 'receive-event-name'
const receiveDirectEventName = 'receive-direct-event-name'
const receiveDirectTopicName = 'receive-direct-topic-name'

const connectionConfig: QueueConnectionConfig = {
    serviceRulesConfig: {
        ...defaultServiceRulesConfig,
        servicesConfig: {
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
    },
    [QueueConnectionType.External]: getRabbitMQConfig({ assertQueues: true, assertExchanges: true }),
}

describe(`${ExternalCommunicator.name} service`, () => {
    const systemServiceName = 'User'
    const metricsService = makeMockMetricsService()

    const asyncLocalStorage = new AsyncLocalStorage<QueueContext>()
    const logger = new DiiaLogger({ logLevel: LogLevel.DEBUG }, asyncLocalStorage)
    const queue = new Queue(systemServiceName, metricsService, connectionConfig, asyncLocalStorage, logger)
    const queueProvider = queue.makeExternalRabbitMQProvider('externalEventBus')

    beforeAll(async () => {
        const envService = new EnvService(logger)
        const validator = new AppValidator()
        const eventMessageValidator = new EventMessageValidator(validator)
        const eventMessageHandler = new EventMessageHandler(eventMessageValidator, asyncLocalStorage, logger)

        const externalEventListenerList = [
            new ReceiveEventListener(logger, receiveEventName),
            new ReceiveDirectEventListener(receiveDirectEventName),
        ]
        const externalEventBus = new ExternalEventBus(
            logger,
            systemServiceName,
            envService,
            queueProvider,
            externalEventListenerList,
            eventMessageHandler,
            'hostname',
        )

        await externalEventBus.onInit()
        external = new ExternalCommunicator(externalEventBus, eventMessageValidator, logger)
    })

    describe('receiveDirect mechanism', () => {
        it('should work when "receiveDirect" called', async () => {
            const result = await external.receiveDirect<{ data: string }>(
                receiveDirectEventName,
                {
                    notaryCertificateNumber: '1234',
                    notarialActRegistrationNumber: '12345',
                    notarialActDate: '22.11.2021',
                    requestId: '-0',
                },
                { validationRules: null },
            )

            expect(result).toEqual({ data: 'test' })
        })
        it('should send registryApiVersion field in payload meta', async () => {
            // Arrange
            const publishExternalDirectMock = vi.spyOn(queueProvider, 'publishExternalDirect').mockResolvedValueOnce({ payload: {} })

            // Act
            const request = {
                notaryCertificateNumber: '1234',
                notarialActRegistrationNumber: '12345',
                notarialActDate: '22.11.2021',
                requestId: '-0',
            }
            const registryApiVersion = 'v1'
            const opts: ReceiveDirectOps = { registryApiVersion, validationRules: null }

            await external.receiveDirect<{ data: string }>(receiveDirectEventName, request, opts)

            // Asset
            expect(publishExternalDirectMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    meta: expect.objectContaining({
                        registryApiVersion,
                    }),
                }),
                'TopicExternalreceive-direct-topic-name',
                'queue.diia.receive-direct-event-name.req',
                expect.any(Object),
            )
        })
        it('should send uuid got from options in payload', async () => {
            // Arrange
            const publishExternalDirectMock = vi.spyOn(queueProvider, 'publishExternalDirect').mockResolvedValueOnce({ payload: {} })

            // Act
            const request = {
                notaryCertificateNumber: '1234',
                notarialActRegistrationNumber: '12345',
                notarialActDate: '22.11.2021',
                requestId: '-0',
            }
            const requestUuid = RandomUtils.generateUUID()
            const opts: ReceiveDirectOps = { requestUuid, validationRules: null }

            await external.receiveDirect<{ data: string }>(receiveDirectEventName, request, opts)

            // Asset
            expect(publishExternalDirectMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    payload: expect.objectContaining({
                        uuid: requestUuid,
                    }),
                }),
                'TopicExternalreceive-direct-topic-name',
                'queue.diia.receive-direct-event-name.req',
                expect.any(Object),
            )
        })
    })
})
