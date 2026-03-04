/* eslint-disable unicorn/prefer-event-target */
import { EventEmitter } from 'node:events'

import { Channel, Options } from 'amqplib'
import { Replies } from 'amqplib/properties'
import { describe, expect } from 'vitest'
import { mock } from 'vitest-mock-extended'

import { AmqpConnection } from '@src/providers/rabbitmq/amqpConnection'
import { AmqpListener } from '@src/providers/rabbitmq/amqpListener'

import { makeMockRabbitMQMetricsService } from '@tests/mocks/services/metricsService'
import { logger } from '@tests/unit/mocks'

import { ConnectionStatus, QueueOptions } from '@interfaces/index'

import { Headers } from '../../../../src/interfaces/providers/rabbitmq'
import { validMessage } from '../../../mocks/providers/rabbitmq/amqpListener'

const channelMock = {
    assertQueue: vi.fn(),
    prefetch: vi.fn(),
    publish: vi.fn(),
    bindQueue: vi.fn(),
    ack: vi.fn(),
    nack: vi.fn(),
    cancel: vi.fn(),
}

const sendMessageMock = vi.fn()
const systemServiceName = 'test-service-name'

class MockChannel extends EventEmitter {
    async assertQueue(...args: unknown[]): Promise<unknown> {
        return channelMock.assertQueue(...args)
    }

    async consume(queueName: string, onMessageCallback: CallableFunction): Promise<Replies.Consume> {
        sendMessageMock(onMessageCallback)

        return { consumerTag: queueName }
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

    async cancel(...args: unknown[]): Promise<unknown> {
        return channelMock.cancel(...args)
    }
}

const connectionMock = {
    createChannel: vi.fn(),
}

class Connection extends EventEmitter {
    async createChannel(): Promise<unknown> {
        return connectionMock.createChannel()
    }

    getStatus(): ConnectionStatus {
        return ConnectionStatus.Connected
    }
}

describe(`${AmqpListener.name}`, () => {
    const metricsService = makeMockRabbitMQMetricsService()

    const defaultQueueName = 'queueName'
    const defaultConsumerTag = 'consumerTag'
    const defaultQueueOptions: QueueOptions = {
        bindTo: [],
        name: defaultQueueName,
        consumerOptions: {
            prefetchCount: 1,
            consumerTag: defaultConsumerTag,
        },
    }
    const defaultQueuesOptions: QueueOptions[] = [defaultQueueOptions]

    describe(`method ${AmqpListener.prototype.init.name}`, () => {
        it('should successfully initialize', async () => {
            const amqpConnection = new Connection() as unknown as AmqpConnection
            const amqpListener = new AmqpListener(amqpConnection, logger, metricsService, defaultQueuesOptions, systemServiceName)

            connectionMock.createChannel.mockResolvedValue(new MockChannel())

            await amqpListener.listenQueue(defaultQueueName, async () => {})
            await amqpListener.init()
            amqpConnection.emit('ready')
            await new Promise((resolve) => {
                // do not complete test case until ready event is handled
                setTimeout(resolve, 0)
            })

            expect(channelMock.prefetch).toHaveBeenCalledWith(1)
        })
    })

    describe(`method: ${AmqpListener.prototype.listenQueue.name}`, () => {
        it('should successfully attach callback for queue listening', async () => {
            const amqpConnection = new Connection() as unknown as AmqpConnection
            const amqpListener = new AmqpListener(amqpConnection, logger, metricsService, defaultQueuesOptions, systemServiceName)

            connectionMock.createChannel.mockResolvedValue(new MockChannel())

            await amqpListener.listenQueue(defaultQueueName, async () => {})

            expect(channelMock.prefetch).toHaveBeenCalledWith(1)
        })
        it('should successfully attach callback for queue listening with consumer tag', async () => {
            // Arrange
            const channel = mock<Channel>()
            const amqpConnection = mock<AmqpConnection>()

            amqpConnection.createChannel.mockResolvedValue(channel)

            const spyConsume = channel.consume.mockResolvedValue({ consumerTag: defaultConsumerTag })

            const amqpListener = new AmqpListener(amqpConnection, logger, metricsService, defaultQueuesOptions, systemServiceName)

            // Act
            await amqpListener.listenQueue(defaultQueueName, async () => {})
            // Assert

            expect(spyConsume).toHaveBeenCalledWith(defaultQueueName, expect.any(Function), { consumerTag: defaultConsumerTag })
        })
    })

    describe(`method: ${AmqpListener.prototype.cancelQueue.name}`, () => {
        it('should successfully cancel queue consuming', async () => {
            // Arrange
            const amqpConnection = new Connection() as unknown as AmqpConnection
            const amqpListener = new AmqpListener(amqpConnection, logger, metricsService, defaultQueuesOptions, systemServiceName)

            connectionMock.createChannel.mockResolvedValue(new MockChannel())

            // Act
            await amqpListener.listenQueue(defaultQueueName, async () => {})
            await amqpListener.cancelQueue(defaultQueueName)

            // Assert
            const consumerTagName = defaultQueueName

            expect(channelMock.cancel).toHaveBeenCalledWith(consumerTagName)
        })
    })

    describe('method: `getStatus`', () => {
        it('should successfully get listener status', () => {
            const amqpConnection = new Connection() as unknown as AmqpConnection
            const amqpListener = new AmqpListener(amqpConnection, logger, metricsService, [], systemServiceName)

            connectionMock.createChannel.mockResolvedValue(new MockChannel())

            expect(amqpListener.getStatus()).toEqual(ConnectionStatus.Connected)
        })
    })

    describe('method: `onMessageCallback`', () => {
        it('should successfully handle message in case data exists', async () => {
            // Arrange
            const callback = vi.fn()
            const amqpConnection = new Connection() as unknown as AmqpConnection
            const amqpListener = new AmqpListener(amqpConnection, logger, metricsService, defaultQueuesOptions, systemServiceName)

            const data = { key: 'value' }

            connectionMock.createChannel.mockResolvedValue(new MockChannel())
            callback.mockImplementationOnce((response) => {
                response.done(data)
            })
            sendMessageMock.mockImplementationOnce((onMessageCallback) => {
                onMessageCallback(validMessage)
            })

            // Act
            await amqpListener.listenQueue(defaultQueueName, callback)

            // Assert
            const expectedPublishOptions: Options.Publish = {
                correlationId: validMessage.properties.correlationId,
                headers: {
                    [Headers.handledBy]: systemServiceName,
                },
            }

            expect(channelMock.publish).toHaveBeenCalledWith(
                '',
                validMessage.properties.replyTo,
                Buffer.from(JSON.stringify(data)),
                expectedPublishOptions,
            )
            expect(channelMock.ack).toHaveBeenCalledWith(validMessage, false)
        })

        it('should successfully handle message in case there is no data in message', async () => {
            // Arrange
            const callback = vi.fn()
            const amqpConnection = new Connection() as unknown as AmqpConnection
            const amqpListener = new AmqpListener(amqpConnection, logger, metricsService, defaultQueuesOptions, systemServiceName)

            connectionMock.createChannel.mockResolvedValue(new MockChannel())
            callback.mockImplementationOnce((response) => {
                response.done(null)
            })
            sendMessageMock.mockImplementationOnce((onMessageCallback) => {
                onMessageCallback(validMessage)
            })

            // Act
            await amqpListener.listenQueue(defaultQueueName, callback)

            // Assert
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
            const callback = vi.fn()
            const amqpConnection = new Connection() as unknown as AmqpConnection
            const amqpListener = new AmqpListener(amqpConnection, logger, metricsService, defaultQueuesOptions, systemServiceName)

            connectionMock.createChannel.mockResolvedValue(new MockChannel())
            callback.mockImplementationOnce((response) => {
                response.reject()
            })
            sendMessageMock.mockImplementationOnce((onMessageCallback) => {
                onMessageCallback(validMessage)
            })

            await amqpListener.listenQueue(defaultQueueName, callback)

            expect(channelMock.nack).toHaveBeenCalledWith(validMessage, false, true)
        })

        it('should fail to handle message in case content is not JSON', async () => {
            const callback = vi.fn()
            const messageWithInvalidContent = { ...validMessage, content: Buffer.from('invalid-json') }
            const amqpConnection = new Connection() as unknown as AmqpConnection
            const amqpListener = new AmqpListener(amqpConnection, logger, metricsService, defaultQueuesOptions, systemServiceName)

            connectionMock.createChannel.mockResolvedValue(new MockChannel())
            callback.mockImplementationOnce((response) => {
                response.reject()
            })
            sendMessageMock.mockImplementationOnce((onMessageCallback) => {
                onMessageCallback(messageWithInvalidContent)
            })

            await amqpListener.listenQueue(defaultQueueName, callback)

            expect(logger.error).toHaveBeenCalledWith('Error while parse message content', messageWithInvalidContent)
            expect(channelMock.ack).toHaveBeenCalledWith(messageWithInvalidContent, false)
        })
        it('should fail if max recreate channel tries is reached', async () => {
            // Arrange
            const callback = vi.fn()
            const amqpConnection = new Connection() as unknown as AmqpConnection

            const maxTries = 1
            const queueOptions: QueueOptions = {
                ...defaultQueueOptions,
                consumerOptions: {
                    ...defaultQueueOptions.consumerOptions,
                    recreateChannelOptions: {
                        maxTries,
                    },
                },
            }

            const amqpListener = new AmqpListener(amqpConnection, logger, metricsService, [queueOptions], systemServiceName)

            const channel = new MockChannel()

            connectionMock.createChannel.mockResolvedValue(channel)

            let error: unknown

            sendMessageMock.mockImplementationOnce(async (onMessageCallback) => {
                try {
                    await onMessageCallback(null)
                } catch (err) {
                    error = err
                }
            })

            // Act
            await amqpListener.listenQueue(defaultQueueName, callback)

            // Assert
            expect(error.toString()).toEqual(`Error: Max recreate channel tries reached [${maxTries}] for queue [${queueOptions.name}]`)
        })
    })
})
