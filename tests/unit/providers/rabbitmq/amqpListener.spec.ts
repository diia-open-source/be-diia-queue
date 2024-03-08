import { EventEmitter } from 'events'

import { validMessage } from '../../../mocks/providers/rabbitmq/amqpListener'

import { AmqpConnection } from '@src/providers/rabbitmq/amqpConnection'
import { AmqpListener } from '@src/providers/rabbitmq/amqpListener'

import { logger } from '@tests/unit/mocks'

import { ConnectionStatus } from '@interfaces/index'

const channelMock = {
    assertQueue: jest.fn(),
    prefetch: jest.fn(),
    publish: jest.fn(),
    bindQueue: jest.fn(),
    ack: jest.fn(),
    nack: jest.fn(),
}

const sendMessageMock = jest.fn()

class Channel extends EventEmitter {
    async assertQueue(...args: unknown[]): Promise<unknown> {
        return channelMock.assertQueue(...args)
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

describe('AmqpListener', () => {
    describe('method: `init`', () => {
        it('should successfully initialize', async () => {
            const amqpConnection = <AmqpConnection>(<unknown>new Connection())
            const amqpListener = new AmqpListener(amqpConnection, logger, { prefetchCount: 1 })

            connectionMock.createChannel.mockResolvedValue(new Channel())

            await amqpListener.listenQueue('queueName', async () => {})
            await amqpListener.init()
            amqpConnection.emit('ready')
            await new Promise((resolve) => {
                // do not complete test case until ready event is handled
                setTimeout(resolve, 0)
            })

            expect(channelMock.assertQueue).toHaveBeenCalledWith('queueName', { durable: false })
            expect(channelMock.prefetch).toHaveBeenCalledWith(1)
        })
    })

    describe('method: `listenQueue`', () => {
        it('should successfully attach callback for queue listening', async () => {
            const amqpConnection = <AmqpConnection>(<unknown>new Connection())
            const amqpListener = new AmqpListener(amqpConnection, logger)

            connectionMock.createChannel.mockResolvedValue(new Channel())

            await amqpListener.listenQueue('queueName', async () => {})

            expect(channelMock.assertQueue).toHaveBeenCalledWith('queueName', { durable: false })
            expect(channelMock.prefetch).toHaveBeenCalledWith(1)
        })

        it('should fail to attach callback for queue listening in case of inability to assert queue in channel', async () => {
            const expectedError = new Error('Unable to assert queue for channel')
            const amqpConnection = <AmqpConnection>(<unknown>new Connection())
            const amqpListener = new AmqpListener(amqpConnection, logger)

            connectionMock.createChannel.mockResolvedValue(new Channel())

            channelMock.assertQueue.mockRejectedValue(expectedError)

            await expect(async () => {
                await amqpListener.listenQueue('queueName', async () => {})
            }).rejects.toEqual(expectedError)
            expect(channelMock.assertQueue).toHaveBeenCalledWith('queueName', { durable: false })
            expect(logger.error).toHaveBeenCalledWith(`Error while start listen queue [queueName]`)
        })
    })

    describe('method: `bindQueueToExchange`', () => {
        it('should successfully bind queue to exchange', async () => {
            const amqpConnection = <AmqpConnection>(<unknown>new Connection())
            const amqpListener = new AmqpListener(amqpConnection, logger)

            connectionMock.createChannel.mockResolvedValue(new Channel())

            await amqpListener.listenQueue('queueName', async () => {})

            await amqpListener.bindQueueToExchange('queueName', 'exchangeName')

            expect(logger.debug).toHaveBeenCalledWith('Binding queue - queueName to exchange exchangeName with routing key [*]')
            expect(channelMock.bindQueue).toHaveBeenCalledWith('queueName', 'exchangeName', '*')
        })

        it('should fail to bind queue to exchange in case channel does not exist', async () => {
            const expectedError = new Error()
            const amqpConnection = <AmqpConnection>(<unknown>new Connection())
            const amqpListener = new AmqpListener(amqpConnection, logger)

            connectionMock.createChannel.mockResolvedValue(new Channel())
            channelMock.bindQueue.mockRejectedValue(expectedError)

            await amqpListener.listenQueue('queueName', async () => {})

            await expect(async () => {
                await amqpListener.bindQueueToExchange('queueName', 'exchangeName')
            }).rejects.toEqual(expectedError)

            expect(logger.debug).toHaveBeenCalledWith('Binding queue - queueName to exchange exchangeName with routing key [*]')
        })
    })

    describe('method: `getStatus`', () => {
        it('should successfully get listener status', () => {
            const amqpConnection = <AmqpConnection>(<unknown>new Connection())
            const amqpListener = new AmqpListener(amqpConnection, logger)

            connectionMock.createChannel.mockResolvedValue(new Channel())

            expect(amqpListener.getStatus()).toEqual(ConnectionStatus.Connected)
        })
    })

    describe('method: `onMessageCallback`', () => {
        it('should successfully handle message in case data exists', async () => {
            const callback = jest.fn()
            const amqpConnection = <AmqpConnection>(<unknown>new Connection())
            const amqpListener = new AmqpListener(amqpConnection, logger)

            connectionMock.createChannel.mockResolvedValue(new Channel())
            callback.mockImplementationOnce((response) => {
                response.done({ key: 'value' })
            })
            sendMessageMock.mockImplementationOnce((onMessageCallback) => {
                onMessageCallback(validMessage)
            })

            await amqpListener.listenQueue('queueName', callback)

            expect(channelMock.publish).toHaveBeenCalledWith(
                '',
                validMessage.properties.replyTo,
                Buffer.from(JSON.stringify({ key: 'value' })),
                {
                    correlationId: validMessage.properties.correlationId,
                },
            )
            expect(channelMock.ack).toHaveBeenCalledWith(validMessage, false)
        })

        it('should successfully handle message in case there is no data in message', async () => {
            const callback = jest.fn()
            const amqpConnection = <AmqpConnection>(<unknown>new Connection())
            const amqpListener = new AmqpListener(amqpConnection, logger)

            connectionMock.createChannel.mockResolvedValue(new Channel())
            callback.mockImplementationOnce((response) => {
                response.done(null)
            })
            sendMessageMock.mockImplementationOnce((onMessageCallback) => {
                onMessageCallback(validMessage)
            })

            await amqpListener.listenQueue('queueName', callback)

            expect(channelMock.publish).not.toHaveBeenCalledWith(
                '',
                validMessage.properties.replyTo,
                Buffer.from(JSON.stringify({ key: 'value' })),
                {
                    correlationId: validMessage.properties.correlationId,
                },
            )
            expect(channelMock.ack).toHaveBeenCalledWith(validMessage, false)
        })

        it('should successfully handle message and reject', async () => {
            const callback = jest.fn()
            const amqpConnection = <AmqpConnection>(<unknown>new Connection())
            const amqpListener = new AmqpListener(amqpConnection, logger)

            connectionMock.createChannel.mockResolvedValue(new Channel())
            callback.mockImplementationOnce((response) => {
                response.reject()
            })
            sendMessageMock.mockImplementationOnce((onMessageCallback) => {
                onMessageCallback(validMessage)
            })

            await amqpListener.listenQueue('queueName', callback)

            expect(channelMock.nack).toHaveBeenCalledWith(validMessage)
        })

        it('should fail to handle message in case content is not JSON', async () => {
            const callback = jest.fn()
            const messageWithInvalidContent = { ...validMessage, content: Buffer.from('invalid-json') }
            const amqpConnection = <AmqpConnection>(<unknown>new Connection())
            const amqpListener = new AmqpListener(amqpConnection, logger)

            connectionMock.createChannel.mockResolvedValue(new Channel())
            callback.mockImplementationOnce((response) => {
                response.reject()
            })
            sendMessageMock.mockImplementationOnce((onMessageCallback) => {
                onMessageCallback(messageWithInvalidContent)
            })

            await amqpListener.listenQueue('queueName', callback)

            expect(logger.error).toHaveBeenCalledWith('Error while parse message content', messageWithInvalidContent)
            expect(channelMock.ack).toHaveBeenCalledWith(messageWithInvalidContent, false)
        })
    })
})
