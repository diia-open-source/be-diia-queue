const validateAndGetQueueConfigs = jest.fn()
const rabbitMQProviderMock = {
    getStatus: jest.fn(),
    init: jest.fn(),
}

class RabbitMQProvider {
    getStatus(): unknown {
        return rabbitMQProviderMock.getStatus()
    }

    async init(): Promise<void> {
        rabbitMQProviderMock.init()
    }
}

jest.mock('@src/providers/rabbitmq', () => ({ RabbitMQProvider }))
jest.mock('@src/utils', () => ({ validateAndGetQueueConfigs }))

import { HttpStatusCode } from '@diia-inhouse/types'

import { connectOptions } from '../../mocks/services/queue'
import { asyncLocalStorage, logger } from '../mocks'

import { ConnectionStatus, Queue } from '@src/index'

describe('Queue', () => {
    const serviceName = 'Auth'
    const queueService = new Queue(serviceName, connectOptions, asyncLocalStorage, logger)

    describe('method: `onHealthCheck`', () => {
        it('should return ok status', async () => {
            const expectedConnectionStatus = {
                listener: ConnectionStatus.Connected,
                publisher: ConnectionStatus.Connected,
            }

            validateAndGetQueueConfigs.mockReturnValue({})
            rabbitMQProviderMock.getStatus.mockReturnValue(expectedConnectionStatus)
            queueService.getInternalQueue()

            const result = await queueService.onHealthCheck()

            await expect(result).toEqual({
                status: HttpStatusCode.OK,
                details: {
                    rabbit: {
                        internal: expectedConnectionStatus,
                    },
                },
            })
        })

        it('should return service unavailable status', async () => {
            const expectedConnectionStatus = {
                listener: ConnectionStatus.Connected,
                publisher: ConnectionStatus.Connecting,
            }

            validateAndGetQueueConfigs.mockReturnValue({})
            rabbitMQProviderMock.getStatus.mockReturnValue(expectedConnectionStatus)
            queueService.getInternalQueue()

            const result = await queueService.onHealthCheck()

            expect(result).toEqual({
                status: HttpStatusCode.SERVICE_UNAVAILABLE,
                details: {
                    rabbit: {
                        internal: expectedConnectionStatus,
                    },
                },
            })
        })
    })

    describe('method: `getInternalQueue`', () => {
        it('should successfully return internal queue', () => {
            expect(queueService.getInternalQueue()).toBeInstanceOf(RabbitMQProvider)
        })
    })

    describe('method: `getExternalQueue`', () => {
        it('should successfully return external queue', () => {
            validateAndGetQueueConfigs.mockReturnValue({
                serviceConfig: {},
                queueConfig: {},
            })
            expect(queueService.getExternalQueue()).toBeInstanceOf(RabbitMQProvider)
        })
    })
})
