/* eslint-disable unicorn/prefer-event-target */
const uuid = jest.fn()

jest.mock('node:crypto', () => ({ randomUUID: uuid }))

import { EventEmitter } from 'node:events'

import { Replies } from 'amqplib'

import { validMessage, validPublishToExchangeParams } from '../../../mocks/providers/rabbitmq/amqpPublisher'

import { AmqpConnection } from '@src/providers/rabbitmq/amqpConnection'
import { AmqpPublisher } from '@src/providers/rabbitmq/amqpPublisher'

import { logger } from '@tests/unit/mocks'

import { ConnectionStatus } from '@interfaces/index'

const channelMock = {
    assertExchange: jest.fn(),
    prefetch: jest.fn(),
    publish: jest.fn(),
    bindQueue: jest.fn(),
    ack: jest.fn(),
    nack: jest.fn(),
}

const sendMessageMock = jest.fn()

class Channel extends EventEmitter {
    async assertExchange(...args: unknown[]): Promise<unknown> {
        return channelMock.assertExchange(...args)
    }

    async consume(_queueName: string, onMessageCallback: CallableFunction): Promise<void> {
        sendMessageMock(onMessageCallback)

        return
    }

    async prefetch(...args: unknown[]): Promise<unknown> {
        return channelMock.prefetch(...args)
    }

    async publish(...args: unknown[]): Promise<unknown> {
        return channelMock.publish(...args)
    }

    async bindQueue(...args: unknown[]): Promise<unknown> {
        return channelMock.bindQueue(...args)
    }

    async ack(...args: unknown[]): Promise<unknown> {
        return channelMock.ack(...args)
    }

    async nack(...args: unknown[]): Promise<unknown> {
        return channelMock.nack(...args)
    }
}

const connectionMock = {
    createChannel: jest.fn(),
}

class Connection extends EventEmitter {
    async createChannel(): Promise<unknown> {
        return connectionMock.createChannel()
    }

    getStatus(): ConnectionStatus {
        return ConnectionStatus.Connected
    }
}

describe('AmqpPublisher', () => {
    describe('method: `init`', () => {
        it('should successfully initialize amqp publisher', async () => {
            const amqpConnection = <AmqpConnection>(<unknown>new Connection())
            const amqpPublisher = new AmqpPublisher(amqpConnection, logger, 1800)

            connectionMock.createChannel.mockResolvedValue(new Channel())

            await amqpPublisher.init()

            amqpConnection.emit('ready')
            await new Promise((resolve) => {
                // do not complete test case until ready event is handled
                setTimeout(resolve, 0)
            })

            expect(connectionMock.createChannel).toHaveBeenCalledWith()
        })

        it('should successfully initialize amqp publisher and emit received message', async () => {
            const amqpConnection = <AmqpConnection>(<unknown>new Connection())
            const amqpPublisher = new AmqpPublisher(amqpConnection, logger)

            connectionMock.createChannel.mockResolvedValue(new Channel())
            sendMessageMock.mockImplementationOnce((sendMessageCallback) => {
                sendMessageCallback(validMessage)
            })

            await amqpPublisher.init()

            amqpConnection.emit('ready')
            await new Promise((resolve) => {
                // do not complete test case until ready event is handled
                setTimeout(resolve, 0)
            })

            expect(connectionMock.createChannel).toHaveBeenCalledWith()
        })
    })

    describe('method: `publishToExchange`', () => {
        it('should successfully publish message to exchange', async () => {
            const amqpConnection = <AmqpConnection>(<unknown>new Connection())
            const amqpPublisher = new AmqpPublisher(amqpConnection, logger)

            connectionMock.createChannel.mockResolvedValue(new Channel())
            channelMock.publish.mockResolvedValue(true)

            await amqpPublisher.init()

            expect(await amqpPublisher.publishToExchange(validPublishToExchangeParams)).toBeTruthy()
            expect(logger.io).toHaveBeenCalledWith('Event message', expect.anything())
            expect(channelMock.publish).toHaveBeenCalled()
        })

        it.each([
            ['no event name', { ...validPublishToExchangeParams, eventName: '', routingKey: undefined }],
            ['no exchange name', { ...validPublishToExchangeParams, exchangeName: '' }],
            ['no message', { ...validPublishToExchangeParams, message: '' }],
        ])('should skip to publish message to exchange in case %s', async (_msg, publishToExchangeParams) => {
            const { eventName, exchangeName, message } = publishToExchangeParams
            const amqpConnection = <AmqpConnection>(<unknown>new Connection())
            const amqpPublisher = new AmqpPublisher(amqpConnection, logger)

            connectionMock.createChannel.mockResolvedValue(new Channel())
            channelMock.publish.mockResolvedValue(true)

            await amqpPublisher.init()

            expect(await amqpPublisher.publishToExchange(publishToExchangeParams)).toBeFalsy()
            expect(logger.error).toHaveBeenCalledWith(
                `Invalid event name [${eventName}] or exchange name [${exchangeName}] or message [${JSON.stringify(message)}]`,
            )
        })
    })

    describe('method: `publishToExchangeDirect`', () => {
        it('should successfully publish to exchange directly', async () => {
            const correlationId = validMessage.properties.correlationId
            const amqpConnection = <AmqpConnection>(<unknown>new Connection())
            const amqpPublisher = new AmqpPublisher(amqpConnection, logger, 5)

            connectionMock.createChannel.mockResolvedValue(new Channel())
            sendMessageMock.mockImplementationOnce((sendMessageCallback) => {
                setTimeout(() => {
                    sendMessageCallback(validMessage)
                }, 0)
            })
            uuid.mockReturnValue(correlationId)
            channelMock.publish.mockResolvedValue(true)

            await amqpPublisher.init()

            expect(await amqpPublisher.publishToExchangeDirect(validPublishToExchangeParams)).toEqual({ key: 'value' })
            expect(channelMock.publish).toHaveBeenCalled()
        })

        it('should fail to publish to exchange directly on timeout', async () => {
            const correlationId = validMessage.properties.correlationId
            const amqpConnection = <AmqpConnection>(<unknown>new Connection())
            const amqpPublisher = new AmqpPublisher(amqpConnection, logger, 5)

            connectionMock.createChannel.mockResolvedValue(new Channel())
            sendMessageMock.mockImplementationOnce((sendMessageCallback) => {
                sendMessageCallback(validMessage)
            })
            uuid.mockReturnValue(correlationId)
            channelMock.publish.mockResolvedValue(true)

            await amqpPublisher.init()

            await expect(async () => {
                await amqpPublisher.publishToExchangeDirect(validPublishToExchangeParams)
            }).rejects.toEqual(new Error('Time out for external event: ' + validPublishToExchangeParams.eventName))
            expect(channelMock.publish).toHaveBeenCalled()
        })

        it.each([
            ['no event name', { ...validPublishToExchangeParams, eventName: '', routingKey: undefined }],
            ['no exchange name', { ...validPublishToExchangeParams, exchangeName: '' }],
            ['no message', { ...validPublishToExchangeParams, message: '' }],
        ])('should fail to publish message to exchange directly in case %s', async (_msg, publishToExchangeParams) => {
            const { eventName, exchangeName, message } = publishToExchangeParams
            const amqpConnection = <AmqpConnection>(<unknown>new Connection())
            const amqpPublisher = new AmqpPublisher(amqpConnection, logger)

            connectionMock.createChannel.mockResolvedValue(new Channel())

            await amqpPublisher.init()

            await expect(async () => {
                await amqpPublisher.publishToExchangeDirect(publishToExchangeParams)
            }).rejects.toEqual(
                new Error(`Invalid event name [${eventName}] or exchange name [${exchangeName}] or message [${JSON.stringify(message)}]`),
            )
        })
    })

    describe('method: `checkExchange`', () => {
        it('should successfully check exchange', async () => {
            const expectedAssertExchange: Replies.AssertExchange = { exchange: 'exchangeName' }
            const amqpConnection = <AmqpConnection>(<unknown>new Connection())
            const amqpPublisher = new AmqpPublisher(amqpConnection, logger)

            connectionMock.createChannel.mockResolvedValue(new Channel())
            channelMock.assertExchange.mockResolvedValue(expectedAssertExchange)

            await amqpPublisher.init()

            expect(await amqpPublisher.checkExchange(expectedAssertExchange.exchange)).toEqual(expectedAssertExchange)
        })

        it('should fail to check exchange', async () => {
            const exchangeName = 'exchangeName'
            const expectedError = new Error('Unable to assert exchange')
            const amqpConnection = <AmqpConnection>(<unknown>new Connection())
            const amqpPublisher = new AmqpPublisher(amqpConnection, logger)

            connectionMock.createChannel.mockResolvedValue(new Channel())
            channelMock.assertExchange.mockRejectedValue(expectedError)

            await amqpPublisher.init()

            await expect(async () => {
                await amqpPublisher.checkExchange(exchangeName)
            }).rejects.toEqual(expectedError)
            expect(logger.error).toHaveBeenCalledWith(`Error while assert exchange [${exchangeName}]`)
        })
    })

    describe('method: `getStatus`', () => {
        it('should successfully get status', async () => {
            const amqpConnection = <AmqpConnection>(<unknown>new Connection())
            const amqpPublisher = new AmqpPublisher(amqpConnection, logger)

            connectionMock.createChannel.mockResolvedValue(new Channel())

            await amqpPublisher.init()

            expect(amqpPublisher.getStatus()).toEqual(ConnectionStatus.Connected)
        })
    })
})
