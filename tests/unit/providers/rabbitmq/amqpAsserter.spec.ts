import { Channel, Replies } from 'amqplib'
import { describe } from 'vitest'
import { mock } from 'vitest-mock-extended'

import { RandomUtils } from '@diia-inhouse/utils'

import constants from '@src/constants'
import { ExchangeOptions, QueueOptions, QueueTypes } from '@src/interfaces'
import { AmqpAsserter } from '@src/providers/rabbitmq/amqpAsserter'
import { AmqpConnection } from '@src/providers/rabbitmq/amqpConnection'

import { getExchangeOptions, getQueueOptions } from '@mocks/config'

import { AmqpConnectionMock, ChannelMock, connectionMock, sendMessageMock } from '@tests/mocks/providers/rabbitmq/amqpConnection'
import { validMessage } from '@tests/mocks/providers/rabbitmq/amqpListener'
import { logger } from '@tests/unit/mocks'

describe('AmqpAsserter', () => {
    const defaultDeclareOptions = {
        assertQueues: true,
        assertExchanges: true,
    }

    describe('method: `init`', () => {
        it('should successfully initialize amqp asserter', async () => {
            // Arrange
            const amqpConnection = mock<AmqpConnection>()
            const channel = mock<Channel>()
            const spiedCreateChannel = amqpConnection.createChannel.mockResolvedValue(channel)

            const amqpAsserter = new AmqpAsserter(amqpConnection, logger, defaultDeclareOptions)

            // Act
            await amqpAsserter.init()

            // Assert
            expect(spiedCreateChannel).toHaveBeenCalled()
        })

        it('should successfully initialize amqp publisher and emit received message', async () => {
            const amqpConnection = new AmqpConnectionMock() as unknown as AmqpConnection
            const amqpAsserter = new AmqpAsserter(amqpConnection, logger, defaultDeclareOptions)

            connectionMock.createChannel.mockResolvedValue(new ChannelMock())
            sendMessageMock.mockImplementationOnce((sendMessageCallback) => {
                sendMessageCallback(validMessage)
            })

            await amqpAsserter.init()

            amqpConnection.emit('ready')
            await new Promise((resolve) => {
                // do not complete test case until ready event is handled
                setTimeout(resolve, 0)
            })

            expect(connectionMock.createChannel).toHaveBeenCalledWith()
        })
    })

    describe('method: `assertExchange`', () => {
        it('should successfully check exchange', async () => {
            // Arrange
            const exchangeOptions = { name: 'exchangeName' }
            const expectedAssertExchange: Replies.AssertExchange = { exchange: exchangeOptions.name }
            const channel = mock<Channel>()

            channel.assertExchange.mockResolvedValue(expectedAssertExchange)

            const amqpConnection = mock<AmqpConnection>()

            amqpConnection.createChannel.mockResolvedValue(channel)

            const amqpAsserter = new AmqpAsserter(amqpConnection, logger, defaultDeclareOptions)

            // Act
            await amqpAsserter.init()
            const assertingExchangePromise = await amqpAsserter.assertExchange(exchangeOptions)

            // Assert
            expect(assertingExchangePromise).toEqual(expectedAssertExchange)
        })

        it('should fail to check exchange', async () => {
            // Arrange
            const exchangeName = 'exchangeName'
            const exchangeOptions = { name: exchangeName }
            const expectedError = new Error('Unable to assert exchange')

            const channel = mock<Channel>()

            channel.assertExchange.mockRejectedValueOnce(expectedError)

            const amqpConnection = mock<AmqpConnection>()

            amqpConnection.createChannel.mockResolvedValue(channel)

            const amqpAsserter = new AmqpAsserter(amqpConnection, logger, defaultDeclareOptions)

            // Act
            await amqpAsserter.init()
            const assertingPromise = amqpAsserter.assertExchange(exchangeOptions)

            // Assert
            await expect(assertingPromise).rejects.toEqual(expectedError)
        })
    })

    describe('method: `bindQueueToExchange`', () => {
        it('should successfully bind queue to exchange', async () => {
            // Arrange
            const channel = mock<Channel>()

            const amqpConnection = mock<AmqpConnection>()

            amqpConnection.createChannel.mockResolvedValue(channel)

            const amqpAsserter = new AmqpAsserter(amqpConnection, logger, defaultDeclareOptions)

            // Act
            await amqpAsserter.init()

            await amqpAsserter.bindQueueToExchange('queueName', { exchangeName: 'exchangeName' })

            // Assert
            expect(channel.bindQueue).toHaveBeenCalledWith('queueName', 'exchangeName', '*')
            expect(logger.info).toHaveBeenCalledWith('Queue [queueName] has been bound with exchange [exchangeName] by routing key [*]')
        })

        it('should fail to bind queue to exchange in case channel does not exist', async () => {
            // Arrange
            const expectedError = new Error('Error')

            const channel = mock<Channel>()

            channel.bindQueue.mockRejectedValueOnce(expectedError)

            const amqpConnection = mock<AmqpConnection>()

            amqpConnection.createChannel.mockResolvedValue(channel)

            const amqpAsserter = new AmqpAsserter(amqpConnection, logger, defaultDeclareOptions)

            // Act
            await amqpAsserter.init()
            const bindingPromise = amqpAsserter.bindQueueToExchange('queueName', { exchangeName: 'exchangeName' })

            // Assert
            await expect(bindingPromise).rejects.toEqual(expectedError)
            expect(logger.error).toHaveBeenCalledWith(
                'Error while binding queue [queueName] to exchange [exchangeName] by routing key [*]',
                { err: expectedError },
            )
        })
    })

    describe('method: `unbindQueueFromExchange`', () => {
        const queueName = 'queueName'
        const exchangeName = 'exchangeName'

        it('should successfully unbind queue from exchange', async () => {
            // Arrange
            const channel = mock<Channel>()

            const amqpConnection = mock<AmqpConnection>()

            amqpConnection.createChannel.mockResolvedValue(channel)

            const amqpAsserter = new AmqpAsserter(amqpConnection, logger, defaultDeclareOptions)

            // Act
            await amqpAsserter.init()

            await amqpAsserter.unbindQueueFromExchange(queueName, { exchangeName, unbind: true })

            // Assert
            expect(channel.unbindQueue).toHaveBeenCalledWith(queueName, exchangeName, constants.DEFAULT_ROUTING_KEY)
            expect(logger.info).toHaveBeenCalledWith(
                `Queue [${queueName}] has been unbound from exchange [${exchangeName}] by routing key [${constants.DEFAULT_ROUTING_KEY}]`,
            )
        })

        it('should fail to unbind queue from exchange in case channel does not exist', async () => {
            // Arrange
            const expectedError = new Error('Error')

            const channel = mock<Channel>()

            channel.unbindQueue.mockRejectedValueOnce(expectedError)

            const amqpConnection = mock<AmqpConnection>()

            amqpConnection.createChannel.mockResolvedValue(channel)

            const amqpAsserter = new AmqpAsserter(amqpConnection, logger, defaultDeclareOptions)

            // Act
            await amqpAsserter.init()
            const unbindingPromise = amqpAsserter.unbindQueueFromExchange(queueName, { exchangeName, unbind: true })

            // Assert
            await expect(unbindingPromise).rejects.toEqual(expectedError)
            expect(logger.error).toHaveBeenCalledWith(
                `Error while unbinding queue [${queueName}] from exchange [${exchangeName}] by routing key [${constants.DEFAULT_ROUTING_KEY}]`,
                { err: expectedError },
            )
        })
    })

    describe('method: `bindExchangeToExchange`', () => {
        it('should successfully bind exchange to exchange', async () => {
            // Arrange
            const channel = mock<Channel>()

            const amqpConnection = mock<AmqpConnection>()

            amqpConnection.createChannel.mockResolvedValue(channel)

            const amqpAsserter = new AmqpAsserter(amqpConnection, logger, defaultDeclareOptions)

            const relatedExchangeOptions = getExchangeOptions({
                name: 'relatedExchangeName',
            })
            const exchangeOptions = getExchangeOptions({ name: 'exchangeName', bindTo: [{ exchangeName: relatedExchangeOptions.name }] })

            const exchangesOptions: ExchangeOptions[] = [exchangeOptions, relatedExchangeOptions]

            // Act
            await amqpAsserter.init(exchangesOptions)

            // Assert
            expect(channel.bindExchange).toHaveBeenCalledWith(exchangeOptions.name, relatedExchangeOptions.name, '*')
        })
    })

    describe(`method ${AmqpAsserter.prototype.declareQueues.name}`, () => {
        describe('redeclare queues', () => {
            it('should create alternate exchanges only for appropriate queue', async () => {
                // Arrange
                // Arrange
                const amqpConnection = mock<AmqpConnection>()

                amqpConnection.createChannel.mockResolvedValue(mock<Channel>())

                const amqpAsserter = new AmqpAsserter(amqpConnection, logger, defaultDeclareOptions)

                const usedExchangeOptions: ExchangeOptions = getExchangeOptions({ name: `TestUsedExchange-${RandomUtils.generateUUID()}` })
                const unusedExchangeOptions: ExchangeOptions = getExchangeOptions({
                    name: `TestUnusedExchange-${RandomUtils.generateUUID()}`,
                })

                const queueOptions: QueueOptions = getQueueOptions({
                    name: `TestQueue-${RandomUtils.generateUUID()}`,
                    bindTo: [{ exchangeName: usedExchangeOptions.name, bind: true }],
                    redeclareOptions: {
                        redeclare: true,
                        type: QueueTypes.Quorum,
                        options: {
                            durable: true,
                        },
                    },
                })

                const assertExchangeMock = vi
                    .spyOn(amqpAsserter, 'assertExchange')
                    .mockResolvedValue({ exchange: usedExchangeOptions.name })

                // Act
                await amqpAsserter.declareQueues([queueOptions], [usedExchangeOptions, unusedExchangeOptions])

                // Assert
                expect(assertExchangeMock).toHaveBeenCalledExactlyOnceWith({
                    ...usedExchangeOptions,
                    name: `${usedExchangeOptions.name}${AmqpAsserter.PrefixAlternate}`,
                })
            })
        })
    })
})
