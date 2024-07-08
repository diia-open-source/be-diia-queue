/* eslint-disable unicorn/prefer-event-target */
const connectMock = jest.fn()

jest.mock('amqplib', () => ({ connect: connectMock }))

import { EventEmitter } from 'node:events'

import { connectOptions, reconnectOptions, socketOptions } from '../../../mocks/providers/rabbitmq/amqpConnection'

import { AmqpConnection } from '@src/providers/rabbitmq/amqpConnection'

import { logger } from '@tests/unit/mocks'

import { ConnectionStatus } from '@interfaces/index'

class Connection extends EventEmitter {
    async createChannel(): Promise<EventEmitter> {
        return new EventEmitter()
    }

    async close(): Promise<void> {
        return
    }
}

describe('AmqpConnection', () => {
    describe('method: `connect`', () => {
        it('should successfully create amqp connection', async () => {
            const connection = new Connection()
            const amqpConnection = new AmqpConnection(connectOptions, logger, reconnectOptions, socketOptions)

            connectMock.mockResolvedValue(connection)
            jest.spyOn(amqpConnection, 'emit').mockReturnThis()

            await amqpConnection.connect()

            expect(amqpConnection.emit).toHaveBeenCalledWith('ready')
            expect(logger.info).toHaveBeenCalledWith('Connection to RabbitMQ is created')
            expect(logger.info).toHaveBeenCalledWith('Connection is ready')
        })

        it('should successfully create connection and then properly handle error event', async () => {
            const errorToHandle = new Error('Unable to proceed operation')
            const connection = new Connection()
            const amqpConnection = new AmqpConnection(connectOptions, logger, reconnectOptions, socketOptions)

            connectMock.mockResolvedValue(connection)
            jest.spyOn(amqpConnection, 'emit').mockReturnThis()

            await amqpConnection.connect()

            connection.emit('error', errorToHandle)

            expect(amqpConnection.emit).toHaveBeenCalledWith('ready')
            expect(logger.info).toHaveBeenCalledWith('Connection to RabbitMQ is created')
            expect(logger.info).toHaveBeenCalledWith('Connection is ready')
            expect(logger.error).toHaveBeenCalledWith('Connection error', errorToHandle)
        })

        it('should successfully create connection and then properly handle close event when reconnect is disabled', async () => {
            const connection = new Connection()
            const amqpConnection = new AmqpConnection(connectOptions, logger, { reconnectEnabled: false }, socketOptions)

            connectMock.mockResolvedValue(connection)
            jest.spyOn(amqpConnection, 'emit').mockReturnThis()

            await amqpConnection.connect()

            connection.emit('close')

            expect(amqpConnection.emit).toHaveBeenCalledWith('ready')
            expect(logger.info).toHaveBeenCalledWith('Connection to RabbitMQ is created')
            expect(logger.info).toHaveBeenCalledWith('Connection is ready')
            expect(logger.warn).toHaveBeenCalledWith('Reconnect is disabled in config')
        })
    })

    describe('method: `createChannel`', () => {
        it('should successfully create channel', async () => {
            const amqpConnection = new AmqpConnection(connectOptions, logger, { reconnectEnabled: false }, socketOptions)

            connectMock.mockResolvedValue(new Connection())

            await amqpConnection.connect()

            expect(await amqpConnection.createChannel('test')).toBeInstanceOf(EventEmitter)
            expect(logger.info).toHaveBeenCalledWith('Creating channel to RabbitMQ...', { queueName: 'test' })
            expect(logger.info).toHaveBeenCalledWith('Channel to RabbitMQ is created', { queueName: 'test' })
        })

        describe('event handlers', () => {
            it('should properly handle close event', async () => {
                const amqpConnection = new AmqpConnection(connectOptions, logger, { reconnectEnabled: false }, socketOptions)

                connectMock.mockResolvedValue(new Connection())

                await amqpConnection.connect()

                const channel = await amqpConnection.createChannel('test')

                channel.emit('close')

                expect(channel).toBeInstanceOf(EventEmitter)
                expect(logger.info).toHaveBeenCalledWith('Channel was closed.')
                expect(logger.info).toHaveBeenCalledWith('Creating channel to RabbitMQ...', { queueName: 'test' })
                expect(logger.info).toHaveBeenCalledWith('Channel to RabbitMQ is created', { queueName: 'test' })
            })

            it('should properly handle error event', async () => {
                const expectedError = new Error('Unable to transmit data')
                const amqpConnection = new AmqpConnection(connectOptions, logger, { reconnectEnabled: false }, socketOptions)

                connectMock.mockResolvedValue(new Connection())

                await amqpConnection.connect()

                const channel = await amqpConnection.createChannel('test')

                channel.emit('error', expectedError)

                expect(channel).toBeInstanceOf(EventEmitter)
                expect(logger.error).toHaveBeenCalledWith('Channel on error', { err: expectedError })
                expect(logger.info).toHaveBeenCalledWith('Creating channel to RabbitMQ...', { queueName: 'test' })
                expect(logger.info).toHaveBeenCalledWith('Channel to RabbitMQ is created', { queueName: 'test' })
            })
        })
    })

    describe('method: `reconnect`', () => {
        it('should successfully reconnect', async () => {
            const amqpConnection = new AmqpConnection(connectOptions, logger, reconnectOptions, socketOptions)

            connectMock.mockResolvedValue(new Connection())

            await amqpConnection.connect()

            jest.spyOn(amqpConnection, 'connect').mockResolvedValue()

            await amqpConnection.reconnect()

            expect(amqpConnection.getStatus()).toEqual(ConnectionStatus.Reconnecting)
            expect(logger.info).toHaveBeenCalledWith(`Try to reconnect to Rabbit MQ in ${reconnectOptions.reconnectTimeout} ms`)
            expect(amqpConnection.connect).toHaveBeenCalledWith()
        })
    })

    describe('method: `closeConnection`', () => {
        it('should successfully close connection', async () => {
            const amqpConnection = new AmqpConnection(connectOptions, logger, reconnectOptions, socketOptions)

            connectMock.mockResolvedValue(new Connection())

            await amqpConnection.connect()
            await amqpConnection.closeConnection()

            expect(amqpConnection.getStatus()).toEqual(ConnectionStatus.Closing)
            expect(logger.info).toHaveBeenCalledWith('Connection was closed')
        })

        it('should skip to close connection in case it was not connected previously', async () => {
            const amqpConnection = new AmqpConnection(connectOptions, logger, reconnectOptions, socketOptions)

            connectMock.mockResolvedValue(new Connection())

            await amqpConnection.closeConnection()

            expect(amqpConnection.getStatus()).not.toEqual(ConnectionStatus.Closing)
        })
    })
})
