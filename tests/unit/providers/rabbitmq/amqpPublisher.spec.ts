import { randomUUID } from 'node:crypto'

import { Channel } from 'amqplib'
import { ConnectionStatus, Headers, PublisherOptions } from 'src/interfaces'
import { expect } from 'vitest'
import { mock } from 'vitest-mock-extended'

import { ErrorType, ExternalCommunicatorError, InternalServerError } from '@diia-inhouse/errors'
import { HttpStatusCode } from '@diia-inhouse/types'

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
            const amqpConnection = new AmqpConnectionMock() as unknown as AmqpConnection
            const publisherOpts: PublisherOptions = {
                ...defaultPublisherOpts,
                timeout: 1800,
            }
            const amqpPublisher = new AmqpPublisher(amqpConnection, logger, metricsService, systemServiceName, publisherOpts)

            connectionMock.createChannel.mockResolvedValue(new ChannelMock())

            await amqpPublisher.init()

            amqpConnection.emit('ready')
            await new Promise((resolve) => {
                // do not complete test case until ready event is handled
                setTimeout(resolve, 0)
            })

            expect(connectionMock.createChannel).toHaveBeenCalledWith()
        })

        it('should successfully initialize amqp publisher and emit received defaultMessage', async () => {
            const amqpConnection = new AmqpConnectionMock() as unknown as AmqpConnection
            const amqpPublisher = new AmqpPublisher(amqpConnection, logger, metricsService, systemServiceName, defaultPublisherOpts)

            connectionMock.createChannel.mockResolvedValue(new ChannelMock())
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
            // Arrange
            const amqpConnection = mock<AmqpConnection>()
            const channel = mock<Channel>()

            channel.consume.mockResolvedValue({ consumerTag: 'testTag' })
            channel.publish.mockResolvedValue(true)

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
            channelMock.publish.mockResolvedValue(true)

            await amqpPublisher.init()

            const messageData = getExpectedMsgData(eventName, payload)

            // Act
            const publishingPromise = amqpPublisher.publishToExchange(exchangeName, messageData, headers, routingKey)

            // Assert
            const errorMessage = `Invalid event name [${eventName}] or exchange name [${exchangeName}] or payload [${JSON.stringify(payload)}]`

            await expect(publishingPromise).rejects.toThrow(new InternalServerError(errorMessage))

            expect(logger.error).toHaveBeenCalledWith(errorMessage)
        })
    })

    describe('method: `publishToExchangeDirect`', () => {
        const publisherOptions: PublisherOptions = {
            ...defaultPublisherOpts,
            timeout: 5,
        }

        it('should successfully publish to exchange directly', async () => {
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
            channelMock.publish.mockResolvedValue(true)

            await amqpPublisher.init()

            expect(
                await amqpPublisher.publishToExchangeDirect(defaultExchangeName, defaultMessage, defaultHeaders, defaultRoutingKey),
            ).toEqual({ key: 'value' })
            expect(channelMock.publish).toHaveBeenCalled()
        })

        it('should fail to publish to exchange directly on timeout', async () => {
            const correlationId = validMessage.properties.correlationId
            const amqpConnection = new AmqpConnectionMock() as unknown as AmqpConnection
            const amqpPublisher = new AmqpPublisher(amqpConnection, logger, metricsService, systemServiceName, publisherOptions)

            connectionMock.createChannel.mockResolvedValue(new ChannelMock())
            sendMessageMock.mockImplementationOnce((sendMessageCallback) => {
                sendMessageCallback(validMessage)
            })
            vi.mocked(randomUUID).mockReturnValue(correlationId)
            channelMock.publish.mockResolvedValue(true)

            await amqpPublisher.init()

            await expect(
                amqpPublisher.publishToExchangeDirect(defaultExchangeName, defaultMessage, defaultHeaders, defaultRoutingKey),
            ).rejects.toEqual(
                new ExternalCommunicatorError(
                    'Time out for external event: ' + validPublishToExchangeParams.eventName,
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
            const { eventName, exchangeName, headers, routingKey, payload } = publishToExchangeParams
            const amqpConnection = new AmqpConnectionMock() as unknown as AmqpConnection
            const amqpPublisher = new AmqpPublisher(amqpConnection, logger, metricsService, systemServiceName, defaultPublisherOpts)

            connectionMock.createChannel.mockResolvedValue(new ChannelMock())

            await amqpPublisher.init()

            const messageData = getExpectedMsgData(eventName, payload)

            await expect(amqpPublisher.publishToExchangeDirect(exchangeName, messageData, headers, routingKey)).rejects.toEqual(
                new Error(`Invalid event name [${eventName}] or exchange name [${exchangeName}] or payload [${JSON.stringify(payload)}]`),
            )
        })
    })

    describe('method: `getStatus`', () => {
        it('should successfully get status', async () => {
            const amqpConnection = new AmqpConnectionMock() as unknown as AmqpConnection
            const amqpPublisher = new AmqpPublisher(amqpConnection, logger, metricsService, systemServiceName, defaultPublisherOpts)

            connectionMock.createChannel.mockResolvedValue(new ChannelMock())

            await amqpPublisher.init()

            expect(amqpPublisher.getStatus()).toEqual(ConnectionStatus.Connected)
        })
    })

    describe('metrics collecting', async () => {
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
                channelMock.publish.mockResolvedValue(true)

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
                channelMock.publish.mockResolvedValue(true)

                // Act
                await amqpPublisher.init()

                await amqpPublisher.publishToExchangeDirect(defaultExchangeName, defaultMessage, defaultHeaders, defaultRoutingKey)

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
                channelMock.publish.mockResolvedValue(true)

                // Act
                await amqpPublisher.init()

                const publishingPromise = amqpPublisher.publishToExchangeDirect(
                    defaultExchangeName,
                    defaultMessage,
                    defaultHeaders,
                    defaultRoutingKey,
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
