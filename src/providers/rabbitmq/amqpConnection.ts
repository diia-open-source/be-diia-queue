import { EventEmitter } from 'node:events'
import * as os from 'node:os'

import { Channel, ChannelModel, Options, connect } from 'amqplib'

import { Logger } from '@diia-inhouse/types'

import { ConnectionStatus, ReconnectOptions, SocketOptions } from '../../interfaces/providers/rabbitmq/amqpConnection'

const defaultSocketOptions: SocketOptions = {
    clientProperties: {
        hostname: os.hostname(),
    },
}

const defaultReconnectTimeoutMs = 5000

// eslint-disable-next-line unicorn/prefer-event-target
export class AmqpConnection extends EventEmitter {
    private reconnectEnabled = false

    private reconnectTimeout = defaultReconnectTimeoutMs

    private connection?: ChannelModel

    private connectionStatus = ConnectionStatus.Init

    constructor(
        private readonly connectOptions: Options.Connect,
        private readonly logger: Logger,
        private readonly reconnectOptions?: ReconnectOptions,
        private readonly socketOptions: SocketOptions = defaultSocketOptions,
    ) {
        super()

        if (this.reconnectOptions) {
            const { reconnectEnabled, reconnectTimeout } = this.reconnectOptions

            this.reconnectEnabled = reconnectEnabled || this.reconnectEnabled
            this.reconnectTimeout = reconnectTimeout || this.reconnectTimeout
        }
    }

    async connect(): Promise<void> {
        this.connectionStatus = ConnectionStatus.Connecting
        try {
            this.connection = await connect(this.connectOptions, this.socketOptions)
            this.connectionStatus = ConnectionStatus.Connected
            this.logger.info('Connection to RabbitMQ is created')
            this.logger.info('Connection is ready')
            this.emit('ready')

            this.connection?.on('close', async () => {
                this.connectionStatus = ConnectionStatus.Closed
                if (this.reconnectEnabled) {
                    await this.reconnect()
                    this.logger.warn('Successful reconnect')
                } else {
                    this.logger.warn('Reconnect is disabled in config')
                }
            })

            this.connection?.on('error', async (err) => {
                this.logger.error('Connection error', { err })
            })
        } catch (err) {
            this.logger.error('Creating connection to Rabbit MQ error', { err })
            if (this.reconnectEnabled) {
                await this.reconnect()
                this.logger.warn('Successful reconnect')
            } else {
                throw err
            }
        }
    }

    async createChannel(queueName?: string): Promise<Channel> {
        this.logger.info('Creating channel to RabbitMQ...', { queueName })
        if (!this.connection) {
            throw new Error('RabbitMQ connection is not initialized')
        }

        try {
            const channel: Channel = await this.connection.createChannel()

            channel.on('cancel', (consumerTag) => {
                this.logger.info(`Consumer with tag ${consumerTag} was cancelled.`)
            })

            channel.on('close', async () => {
                this.logger.info('Channel was closed.')
            })

            channel.on('error', (err) => {
                this.logger.error('Channel on error', { err })
            })

            this.logger.info('Channel to RabbitMQ is created', { queueName })

            return channel
        } catch (err) {
            this.logger.error('Creating channel to Rabbit MQ error', { err })

            if (this.reconnectEnabled) {
                await this.reconnect()

                return await this.createChannel(queueName)
            }

            throw err
        }
    }

    async reconnect(): Promise<void> {
        this.connectionStatus = ConnectionStatus.Reconnecting
        this.logger.info(`Try to reconnect to Rabbit MQ in ${this.reconnectTimeout} ms`)
        await new Promise((resolve) => {
            setTimeout(resolve, this.reconnectTimeout)
        })
        await this.connect()
    }

    async closeConnection(): Promise<void> {
        if (!this.connection) {
            return
        }

        this.connectionStatus = ConnectionStatus.Closing
        await this.connection?.close()
        this.logger.info('Connection was closed')
    }

    getStatus(): ConnectionStatus {
        return this.connectionStatus
    }
}
