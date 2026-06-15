import { randomUUID } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'

import { Channel } from 'amqplib'
import { expect } from 'vitest'
import { mock } from 'vitest-mock-extended'

import { ErrorType, ExternalCommunicatorError, InternalServerError } from '@diia-inhouse/errors'
import { HttpStatusCode } from '@diia-inhouse/types'

import { ConnectionStatus, Headers, PublisherOptions } from '@src/interfaces'
import { AmqpConnection } from '@src/providers/rabbitmq/amqpConnection'
import { AmqpPublisher } from '@src/providers/rabbitmq/amqpPublisher'

import { getConsumeMessageMock } from '@mocks/providers/rabbitmq/amqpListener'

import {
    AmqpConnectionMock,
    ChannelMock,
    channelMock,
    connectionMock,
    sendMessageMock,
} from '@tests/mocks/providers/rabbitmq/amqpConnection'
import { makeMockRabbitMQMetricsService } from '@tests/mocks/services/metricsService'
import { logger } from '@tests/unit/mocks'

import { getExpectedMsgData, validMessage, validPublishToExchangeParams } from '../../../mocks/providers/rabbitmq/amqpPublisher'

vi.mock('node:crypto', () => ({ randomUUID: vi.fn() }))

describe('AmqpPublisher', () => {
    const metricsService = makeMockRabbitMQMetricsService()

    const systemServiceName = 'test-service-name'
    const defaultPublisherOpts: PublisherOptions = {}

    const defaultEventName = 'eventName'
    const defaultExchangeName = 'exchangeName'
    const defaultRoutingKey = 'routingKey'

    const defaultPayload = { key: 'value' }
    const defaultMessage = getExpectedMsgData(defaultEventName, defaultPayload)

    const defaultHeaders = {
        traceId: randomUUID(),
    }

    describe('method: `init`', () => {
        it('should successfully initialize amqp publisher', async () => {
            // Arrange
            const amqpConnection = new AmqpConnectionMock() as unknown as AmqpConnection
            const publisherOpts: PublisherOptions = {
                ...defaultPublisherOpts,
                timeout: 1800,
            }
            const amqpPublisher = new AmqpPublisher(amqpConnection, logger, metricsService, systemServiceName, publisherOpts)

            connectionMock.createChannel.mockResolvedValue(new ChannelMock())

            // Act
            await amqpPublisher.init()

            amqpConnection.emit('ready')
            await sleep()

            // Assert
            expect(connectionMock.createChannel).toHaveBeenCalledWith()
        })

        it('should successfully initialize amqp publisher and emit received defaultMessage', async () => {
            // Arrange
            const amqpConnection = new AmqpConnectionMock() as unknown as AmqpConnection
            const amqpPublisher = new AmqpPublisher(amqpConnection, logger, metricsService, systemServiceName, defaultPublisherOpts)

            connectionMock.createChannel.mockResolvedValue(new ChannelMock())
            sendMessageMock.mockImplementationOnce((sendMessageCallback) => {
                sendMessageCallback(validMessage)
            })

            // Act
            await amqpPublisher.init()

            amqpConnection.emit('ready')
            await sleep()

            // Assert
            expect(connectionMock.createChannel).toHaveBeenCalledWith()
        })
    })

    describe('method: `publishToExchange`', () => {
        it('should successfully publish message to exchange', async () => {
            // Arrange
            const amqpConnection = mock<AmqpConnection>()
            const channel = mock<Channel>()

            channel.consume.mockResolvedValue({ consumerTag: 'testTag' })
            channel.publish.mockReturnValue(true)

            const spiedCreateChannel = amqpConnection.createChannel.mockResolvedValue(channel)

            const amqpPublisher = new AmqpPublisher(amqpConnection, logger, metricsService, systemServiceName, defaultPublisherOpts)

            // Act
            await amqpPublisher.init()
            await amqpPublisher.publishToExchange(defaultExchangeName, defaultMessage, defaultHeaders, defaultRoutingKey)

            // Assert
            expect(channel.publish).toHaveBeenCalledWith(
                defaultExchangeName,
                defaultRoutingKey,
                expect.any(Buffer),
                expect.objectContaining({
                    headers: {
                        [Headers.sentFrom]: systemServiceName,
                    },
                }),
            )
            expect(spiedCreateChannel).toHaveBeenCalled()
            expect(logger.io).toHaveBeenCalledWith('Event message', defaultMessage)
        })

        it.each([
            [
                'no event name',
                {
                    eventName: '',
                    exchangeName: defaultExchangeName,
                    headers: defaultHeaders,
                    routingKey: defaultRoutingKey,
                    payload: defaultPayload,
                },
            ],
            [
                'no exchange name',
                {
                    eventName: defaultEventName,
                    exchangeName: '',
                    headers: defaultHeaders,
                    routingKey: defaultRoutingKey,
                    payload: defaultPayload,
                },
            ],
            [
                'no message',
                {
                    eventName: defaultEventName,
                    exchangeName: '',
                    headers: defaultHeaders,
                    routingKey: defaultRoutingKey,
                    payload: '',
                },
            ],
        ])('should skip to publish message to exchange in case %s', async (_msg, publishToExchangeParams) => {
            // Arrange
            const { eventName, exchangeName, headers, routingKey, payload } = publishToExchangeParams
            const amqpConnection = new AmqpConnectionMock() as unknown as AmqpConnection
            const amqpPublisher = new AmqpPublisher(amqpConnection, logger, metricsService, systemServiceName, defaultPublisherOpts)

            connectionMock.createChannel.mockResolvedValue(new ChannelMock())
            channelMock.publish.mockReturnValue(true)

            await amqpPublisher.init()

            const messageData = getExpectedMsgData(eventName, payload)

            // Act
            const publishingPromise = amqpPublisher.publishToExchange(exchangeName, messageData, headers, routingKey)

            // Assert
            const errorMessage = `Invalid event name [${eventName}] or exchange name [${exchangeName}] or payload [${JSON.stringify(payload)}]`

            await expect(publishingPromise).rejects.toThrow(new InternalServerError(errorMessage))

            expect(logger.error).toHaveBeenCalledWith(errorMessage)
        })

        describe('backpressure handling', () => {
            let channel: ChannelMock
            let amqpConnection: AmqpConnection
            let amqpPublisher: AmqpPublisher

            beforeEach(async () => {
                vi.mocked(channelMock.publish).mockReset()
                channel = new ChannelMock()
                amqpConnection = new AmqpConnectionMock() as unknown as AmqpConnection
                connectionMock.createChannel.mockResolvedValue(channel)
                amqpPublisher = new AmqpPublisher(amqpConnection, logger, metricsService, systemServiceName, defaultPublisherOpts)
                await amqpPublisher.init()
            })

            it('should wait for drain after backpressure without republishing', async () => {
                // Arrange
                channelMock.publish.mockReturnValueOnce(false)

                const publishPromise = amqpPublisher.publishToExchange(
                    defaultExchangeName,
                    defaultMessage,
                    defaultHeaders,
                    defaultRoutingKey,
                    { publishTimeout: 10_000 },
                )

                // Act
                await sleep(0)
                channel.emit('drain')
                await publishPromise

                // Assert
                expect(channelMock.publish).toHaveBeenCalledTimes(1)
                expect(channelMock.publish).toHaveBeenCalledWith(
                    defaultExchangeName,
                    defaultRoutingKey,
                    expect.any(Buffer),
                    expect.objectContaining({
                        headers: expect.objectContaining({
                            traceId: defaultHeaders.traceId,
                        }),
                    }),
                )
                expect(logger.info).toHaveBeenCalledWith('Message published after backpressure', {
                    routingKey: defaultRoutingKey,
                    exchangeName: defaultExchangeName,
                    event: defaultEventName,
                    waitTimeMs: expect.any(Number),
                })
            })

            it('should throw when drain timeout exceeded', async () => {
                // Arrange
                amqpPublisher = new AmqpPublisher(amqpConnection, logger, metricsService, systemServiceName, {
                    publishTimeout: 50,
                })
                await amqpPublisher.init()

                channelMock.publish.mockReturnValue(false)

                // Act & Assert
                await expect(
                    amqpPublisher.publishToExchange(defaultExchangeName, defaultMessage, defaultHeaders, defaultRoutingKey),
                ).rejects.toThrow(new InternalServerError('Message publish timeout exceeded'))
            })

            it('should resolve when drain timeout exceeded and throwOnPublishTimeout is false', async () => {
                // Arrange
                amqpPublisher = new AmqpPublisher(amqpConnection, logger, metricsService, systemServiceName, {
                    publishTimeout: 50,
                })
                await amqpPublisher.init()

                channelMock.publish.mockReturnValue(false)

                // Act
                await amqpPublisher.publishToExchange(defaultExchangeName, defaultMessage, defaultHeaders, defaultRoutingKey, {
                    throwOnPublishTimeout: false,
                })

                // Assert
                expect(logger.error).toHaveBeenCalledWith('Message publish timeout exceeded', expect.anything())
                expect(logger.info).not.toHaveBeenCalledWith('Message published after backpressure', expect.anything())
            })

            it('should reject when channel emits error while waiting for drain', async () => {
                // Arrange
                channelMock.publish.mockReturnValueOnce(false)
                const channelError = new Error('channel error')

                // Act
                const publishPromise = amqpPublisher.publishToExchange(
                    defaultExchangeName,
                    defaultMessage,
                    defaultHeaders,
                    defaultRoutingKey,
                    { publishTimeout: 10_000 },
                )

                // Act
                await sleep(0)
                channel.emit('error', channelError)

                // Assert
                await expect(publishPromise).rejects.toThrow(channelError)
                expect(channelMock.publish).toHaveBeenCalledTimes(1)
            })

            it('should not log backpressure message when publish succeeds immediately', async () => {
                // Arrange
                channelMock.publish.mockReturnValue(true)

                // Act
                await amqpPublisher.publishToExchange(defaultExchangeName, defaultMessage, defaultHeaders, defaultRoutingKey)

                // Assert
                expect(channelMock.publish).toHaveBeenCalledTimes(1)
                expect(logger.info).not.toHaveBeenCalledWith('Message published after backpressure', expect.anything())
            })
        })
    })

    describe('method: `publishToExchangeDirect`', () => {
        const publisherOptions: PublisherOptions = {
            ...defaultPublisherOpts,
            timeout: 5,
        }

        it('should successfully publish to exchange directly', async () => {
            // Arrange
            const correlationId = validMessage.properties.correlationId
            const amqpConnection = new AmqpConnectionMock() as unknown as AmqpConnection
            const amqpPublisher = new AmqpPublisher(amqpConnection, logger, metricsService, systemServiceName, publisherOptions)

            connectionMock.createChannel.mockResolvedValue(new ChannelMock())
            sendMessageMock.mockImplementationOnce((sendMessageCallback) => {
                setTimeout(() => {
                    sendMessageCallback(validMessage)
                }, 0)
            })
            vi.mocked(randomUUID).mockReturnValue(correlationId)
            channelMock.publish.mockReturnValue(true)

            await amqpPublisher.init()

            // Act
            const result = await amqpPublisher.publishToExchangeDirect(
                defaultExchangeName,
                defaultMessage,
                defaultHeaders,
                defaultRoutingKey,
            )

            // Assert
            expect(result).toEqual({ key: 'value' })
            expect(channelMock.publish).toHaveBeenCalled()
        })

        it('should not start response timeout until publish drain completes', async () => {
            // Arrange
            const correlationId = validMessage.properties.correlationId
            const channel = new ChannelMock()
            const amqpConnection = new AmqpConnectionMock() as unknown as AmqpConnection
            const amqpPublisher = new AmqpPublisher(amqpConnection, logger, metricsService, systemServiceName, {
                publishTimeout: 10_000,
            })

            connectionMock.createChannel.mockResolvedValue(channel)
            channelMock.publish.mockReturnValue(false)

            let replyToCallback: CallableFunction

            sendMessageMock.mockImplementationOnce((sendMessageCallback) => {
                replyToCallback = sendMessageCallback
            })
            vi.mocked(randomUUID).mockReturnValue(correlationId)

            await amqpPublisher.init()

            const publishingPromise = amqpPublisher.publishToExchangeDirect(
                defaultExchangeName,
                defaultMessage,
                defaultHeaders,
                defaultRoutingKey,
                { responseTimeout: 50 },
            )

            // Act — past responseTimeout if it started before drain
            await sleep(60)
            channel.emit('drain')
            await sleep(0)
            replyToCallback!(validMessage)

            // Assert
            await expect(publishingPromise).resolves.toEqual({ key: 'value' })
            expect(channelMock.publish).toHaveBeenCalledTimes(1)
        })

        it('should fail to publish to exchange directly on timeout', async () => {
            // Arrange
            const correlationId = validMessage.properties.correlationId
            const amqpConnection = new AmqpConnectionMock() as unknown as AmqpConnection
            const amqpPublisher = new AmqpPublisher(amqpConnection, logger, metricsService, systemServiceName, publisherOptions)

            connectionMock.createChannel.mockResolvedValue(new ChannelMock())
            sendMessageMock.mockImplementationOnce((sendMessageCallback) => {
                sendMessageCallback(validMessage)
            })
            vi.mocked(randomUUID).mockReturnValue(correlationId)
            channelMock.publish.mockReturnValue(true)

            await amqpPublisher.init()

            // Act & Assert
            await expect(
                amqpPublisher.publishToExchangeDirect(defaultExchangeName, defaultMessage, defaultHeaders, defaultRoutingKey, {}),
            ).rejects.toEqual(
                new ExternalCommunicatorError(
                    `Time out for external event: ${validPublishToExchangeParams.eventName}`,
                    HttpStatusCode.GATEWAY_TIMEOUT,
                ),
            )
            expect(channelMock.publish).toHaveBeenCalled()
        })

        it.each([
            [
                'no event name',
                {
                    eventName: '',
                    exchangeName: defaultExchangeName,
                    headers: defaultHeaders,
                    routingKey: defaultRoutingKey,
                    payload: defaultPayload,
                },
            ],
            [
                'no exchange name',
                {
                    eventName: defaultEventName,
                    exchangeName: '',
                    headers: defaultHeaders,
                    routingKey: defaultRoutingKey,
                    payload: defaultPayload,
                },
            ],
            [
                'no message',
                {
                    eventName: defaultEventName,
                    exchangeName: '',
                    headers: defaultHeaders,
                    routingKey: defaultRoutingKey,
                    payload: '',
                },
            ],
        ])('should fail to publish defaultMessage to exchange directly in case %s', async (_msg, publishToExchangeParams) => {
            // Arrange
            const { eventName, exchangeName, headers, routingKey, payload } = publishToExchangeParams
            const amqpConnection = new AmqpConnectionMock() as unknown as AmqpConnection
            const amqpPublisher = new AmqpPublisher(amqpConnection, logger, metricsService, systemServiceName, defaultPublisherOpts)

            connectionMock.createChannel.mockResolvedValue(new ChannelMock())

            await amqpPublisher.init()

            const messageData = getExpectedMsgData(eventName, payload)

            // Act & Assert
            await expect(amqpPublisher.publishToExchangeDirect(exchangeName, messageData, headers, routingKey, {})).rejects.toEqual(
                new Error(`Invalid event name [${eventName}] or exchange name [${exchangeName}] or payload [${JSON.stringify(payload)}]`),
            )
        })
    })

    describe('method: `getStatus`', () => {
        it('should successfully get status', async () => {
            // Arrange
            const amqpConnection = new AmqpConnectionMock() as unknown as AmqpConnection
            const amqpPublisher = new AmqpPublisher(amqpConnection, logger, metricsService, systemServiceName, defaultPublisherOpts)

            connectionMock.createChannel.mockResolvedValue(new ChannelMock())

            await amqpPublisher.init()

            // Act
            const status = amqpPublisher.getStatus()

            // Assert
            expect(status).toEqual(ConnectionStatus.Connected)
        })
    })

    describe('metrics collecting', () => {
        describe('method: publishToExchange', () => {
            it('should collect metrics when a response get successfully', async () => {
                // Arrange
                const amqpConnection = new AmqpConnectionMock() as unknown as AmqpConnection
                const amqpPublisher = new AmqpPublisher(amqpConnection, logger, metricsService, systemServiceName, defaultPublisherOpts)

                const collectTimerTotalMetricMock = vi.spyOn(metricsService, 'collectRequestTotalMetric').mockReturnValueOnce()
                const collectCommunicationsTotalMetricMock = vi
                    .spyOn(metricsService, 'collectCommunicationsTotalMetric')
                    .mockReturnValueOnce()

                connectionMock.createChannel.mockResolvedValue(new ChannelMock())
                channelMock.publish.mockReturnValue(true)

                // Act
                await amqpPublisher.init()

                await amqpPublisher.publishToExchange(defaultExchangeName, defaultMessage, defaultHeaders, defaultRoutingKey)

                // Assert
                const expectedErrorType = undefined
                const expectedDestination = 'unknown'

                expect(collectTimerTotalMetricMock).toHaveBeenCalledWith(
                    expect.any(BigInt),
                    defaultEventName,
                    systemServiceName,
                    expectedDestination,
                    expectedErrorType,
                )
                expect(collectCommunicationsTotalMetricMock).toHaveBeenCalledWith(
                    defaultEventName,
                    systemServiceName,
                    expectedDestination,
                    'outbound',
                )
            })

            it('should collect unoperated metrics when drain timeout exceeded and throwOnPublishTimeout is false', async () => {
                // Arrange
                const amqpConnection = new AmqpConnectionMock() as unknown as AmqpConnection
                const amqpPublisher = new AmqpPublisher(amqpConnection, logger, metricsService, systemServiceName, {
                    publishTimeout: 50,
                })

                const collectTimerTotalMetricMock = vi.spyOn(metricsService, 'collectRequestTotalMetric').mockReturnValueOnce()
                const collectCommunicationsTotalMetricMock = vi
                    .spyOn(metricsService, 'collectCommunicationsTotalMetric')
                    .mockReturnValueOnce()

                connectionMock.createChannel.mockResolvedValue(new ChannelMock())
                channelMock.publish.mockReturnValue(false)

                // Act
                await amqpPublisher.init()

                await amqpPublisher.publishToExchange(defaultExchangeName, defaultMessage, defaultHeaders, defaultRoutingKey, {
                    throwOnPublishTimeout: false,
                })

                // Assert
                const expectedDestination = 'unknown'

                expect(collectTimerTotalMetricMock).toHaveBeenCalledWith(
                    expect.any(BigInt),
                    defaultEventName,
                    systemServiceName,
                    expectedDestination,
                    ErrorType.Unoperated,
                )
                expect(collectCommunicationsTotalMetricMock).toHaveBeenCalledWith(
                    defaultEventName,
                    systemServiceName,
                    expectedDestination,
                    'outbound',
                )
            })

            it('should collect metrics when an error is occurred while getting a response', async () => {
                // Arrange
                const amqpConnection = new AmqpConnectionMock() as unknown as AmqpConnection

                const publisherOptions: PublisherOptions = {
                    ...defaultPublisherOpts,
                    timeout: 1,
                }
                const amqpPublisher = new AmqpPublisher(amqpConnection, logger, metricsService, systemServiceName, publisherOptions)

                const collectTimerTotalMetricMock = vi.spyOn(metricsService, 'collectRequestTotalMetric').mockReturnValueOnce()
                const collectCommunicationsTotalMetricMock = vi
                    .spyOn(metricsService, 'collectCommunicationsTotalMetric')
                    .mockReturnValueOnce()

                const channel = null

                connectionMock.createChannel.mockResolvedValue(channel)
                channelMock.publish.mockRejectedValueOnce(false)

                // Act
                await amqpPublisher.init()

                const publishingPromise = amqpPublisher.publishToExchange(
                    defaultExchangeName,
                    defaultMessage,
                    defaultHeaders,
                    defaultRoutingKey,
                )

                // Assert
                const expectedDestination = 'unknown'
                const expectedErrorType = ErrorType.Unoperated

                await expect(publishingPromise).rejects.toBeInstanceOf(Error)

                expect(collectTimerTotalMetricMock).toHaveBeenCalledWith(
                    expect.any(BigInt),
                    defaultEventName,
                    systemServiceName,
                    expectedDestination,
                    expectedErrorType,
                )
                expect(collectCommunicationsTotalMetricMock).toHaveBeenCalledWith(
                    defaultEventName,
                    systemServiceName,
                    expectedDestination,
                    'outbound',
                )
            })
        })
        describe('method: `publishToExchangeDirect`', () => {
            it('should collect metrics when a response get successfully', async () => {
                // Arrange
                const handledBy = 'externalServiceName'
                const headers = { [Headers.handledBy]: handledBy }
                const message = getConsumeMessageMock({ headers })

                const amqpConnection = new AmqpConnectionMock() as unknown as AmqpConnection
                const amqpPublisher = new AmqpPublisher(amqpConnection, logger, metricsService, systemServiceName, defaultPublisherOpts)

                const collectTimerTotalMetricMock = vi.spyOn(metricsService, 'collectRequestTotalMetric').mockReturnValueOnce()
                const collectCommunicationsTotalMetricMock = vi
                    .spyOn(metricsService, 'collectCommunicationsTotalMetric')
                    .mockReturnValueOnce()

                const channel = new ChannelMock()

                connectionMock.createChannel.mockResolvedValue(channel)

                sendMessageMock.mockImplementationOnce((sendMessageCallback) => {
                    setTimeout(() => sendMessageCallback(message), 0)
                })
                vi.mocked(randomUUID).mockReturnValue(message.properties.correlationId)
                channelMock.publish.mockReturnValue(true)

                // Act
                await amqpPublisher.init()

                await amqpPublisher.publishToExchangeDirect(defaultExchangeName, defaultMessage, defaultHeaders, defaultRoutingKey, {})

                // Assert
                const expectedErrorType = undefined
                const expectedDestination = handledBy

                expect(collectTimerTotalMetricMock).toHaveBeenCalledWith(
                    expect.any(BigInt),
                    defaultEventName,
                    systemServiceName,
                    expectedDestination,
                    expectedErrorType,
                )
                expect(collectCommunicationsTotalMetricMock).toHaveBeenCalledWith(
                    defaultEventName,
                    systemServiceName,
                    expectedDestination,
                    'outbound',
                )
            })

            it('should collect metrics when an error is occurred while getting a response', async () => {
                // Arrange
                const handledBy = 'externalServiceName'
                const headers = { [Headers.handledBy]: handledBy }
                const message = getConsumeMessageMock({ headers })

                const amqpConnection = new AmqpConnectionMock() as unknown as AmqpConnection

                const publisherOptions: PublisherOptions = {
                    ...defaultPublisherOpts,
                    timeout: 1,
                }
                const amqpPublisher = new AmqpPublisher(amqpConnection, logger, metricsService, systemServiceName, publisherOptions)

                const collectTimerTotalMetricMock = vi.spyOn(metricsService, 'collectRequestTotalMetric').mockReturnValueOnce()
                const collectCommunicationsTotalMetricMock = vi
                    .spyOn(metricsService, 'collectCommunicationsTotalMetric')
                    .mockReturnValueOnce()

                const channel = new ChannelMock()

                connectionMock.createChannel.mockResolvedValue(channel)

                sendMessageMock.mockImplementationOnce((sendMessageCallback) => {
                    sendMessageCallback(message)
                })
                vi.mocked(randomUUID).mockReturnValue(message.properties.correlationId)
                channelMock.publish.mockReturnValue(true)

                // Act
                await amqpPublisher.init()

                const publishingPromise = amqpPublisher.publishToExchangeDirect(
                    defaultExchangeName,
                    defaultMessage,
                    defaultHeaders,
                    defaultRoutingKey,
                    {},
                )

                // Assert
                const expectedDestination = 'unknown'
                const expectedErrorType = ErrorType.Unoperated

                await expect(publishingPromise).rejects.toBeInstanceOf(ExternalCommunicatorError)

                expect(collectTimerTotalMetricMock).toHaveBeenCalledWith(
                    expect.any(BigInt),
                    defaultEventName,
                    systemServiceName,
                    expectedDestination,
                    expectedErrorType,
                )
                expect(collectCommunicationsTotalMetricMock).toHaveBeenCalledWith(
                    defaultEventName,
                    systemServiceName,
                    expectedDestination,
                    'outbound',
                )
            })
        })
    })
})
