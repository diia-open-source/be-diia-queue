import { Channel, ConsumeMessage, Message, Options, Replies } from 'amqplib'

import { Logger } from '@diia-inhouse/types'

import constants from '../../constants'
import { ConnectionStatus, ListenerOptions, QueueMessage, QueueMessageData } from '../../interfaces'
import { QueueCallback, QueueChannelAndOptions } from '../../interfaces/providers/rabbitmq/amqpListener'
import { totalListenerChannelErrorsMetric } from '../../metrics'

import { AmqpConnection } from './amqpConnection'

const defaultQueueOptions: Options.AssertQueue = {
    durable: false,
}

export class AmqpListener {
    private prefetchCount: number

    private queuesChannels: Map<string, QueueChannelAndOptions> = new Map()

    private queueCallback: Map<string, QueueCallback> = new Map()

    constructor(
        private connection: AmqpConnection,
        private readonly logger: Logger,
        options?: ListenerOptions,
    ) {
        this.prefetchCount = options?.prefetchCount || 1
    }

    async init(): Promise<void> {
        this.connection.on('ready', async () => {
            // in case if reconnect happened
            const tasks = Array.from(this.queuesChannels.keys()).map(async (queueName: string) => {
                const queueOptions = this.getQueueOptions(queueName)

                await this.createChannelAndListenQueue(queueName, queueOptions)
            })

            await Promise.all(tasks)
        })
    }

    async listenQueue(
        queueName: string,
        callback: QueueCallback,
        queueOptions: Options.AssertQueue = defaultQueueOptions,
    ): Promise<void | never> {
        this.logger.debug(`Start listen queue [${queueName}]`)

        try {
            this.saveQueueCallback(queueName, callback)

            await this.createChannelAndListenQueue(queueName, queueOptions)
        } catch (err) {
            this.logger.error(`Error while start listen queue [${queueName}]`)
            throw err
        }
    }

    async bindQueueToExchange(
        queueName: string,
        exchangeName: string,
        routingKey: string = constants.DEFAULT_ROUTING_KEY,
    ): Promise<Replies.Empty> {
        try {
            this.logger.debug(`Binding queue - ${queueName} to exchange ${exchangeName} with routing key [${routingKey}]`)
            const channel = this.getChannel(queueName)

            return await channel.bindQueue(queueName, exchangeName, routingKey)
        } catch (err) {
            this.logger.error(`Error while binding queue [${queueName}] to exchange [${exchangeName}]`, { err })
            throw err
        }
    }

    getStatus(): ConnectionStatus {
        return this.connection.getStatus()
    }

    private ackMsg(channel: Channel, message: Message, allUpTo = false): void {
        return channel.ack(message, allUpTo)
    }

    private nackMsg(channel: Channel, message: Message): void {
        return channel.nack(message)
    }

    private async createChannelAndListenQueue(queueName: string, queueOptions: Options.AssertQueue): Promise<void> {
        const channel = await this.connection.createChannel()

        await channel.assertQueue(queueName, queueOptions)
        await this.setPrefetchCount(channel)

        const callback = this.getQueueCallback(queueName)

        await channel.consume(queueName, this.onMessageCallback(channel, callback))
        try {
            await this.queuesChannels.get(queueName)?.channel?.close()
        } catch (err) {
            this.logger.error('Failed to close prev channel', { err, queueName })
        }

        this.saveChannel(queueName, channel, queueOptions)
        channel.on('error', async (err) => {
            totalListenerChannelErrorsMetric.increment({ queueName })
            this.logger.warn('Recreating listener channel with queue on error...', { err, queueName, queueOptions })
            await this.createChannelAndListenQueue(queueName, queueOptions)
        })
    }

    private async setPrefetchCount(channel: Channel): Promise<Replies.Empty> {
        return await channel.prefetch(this.prefetchCount)
    }

    private saveQueueCallback(queueName: string, callback: QueueCallback): void {
        this.queueCallback.set(queueName, callback)
    }

    private getQueueCallback(queueName: string): QueueCallback {
        const callback = this.queueCallback.get(queueName)
        if (!callback) {
            const errMsg = `Failed to find callback by queue name [${queueName}]`

            this.logger.error(errMsg)

            throw new Error()
        }

        return callback
    }

    private getChannel(queueName: string): Channel | never {
        const { channel } = this.queuesChannels.get(queueName)
        if (!channel) {
            const errMsg = `Failed to find channel by queue name [${queueName}]`

            this.logger.error(errMsg)

            throw new Error()
        }

        return channel
    }

    private getQueueOptions(queueName: string): Options.AssertQueue | never {
        const { queueOptions } = this.queuesChannels.get(queueName)
        if (!queueOptions) {
            const errMsg = `Failed to find queueOptions by queue name [${queueName}]`

            this.logger.error(errMsg)

            throw new Error()
        }

        return queueOptions
    }

    private saveChannel(queueName: string, channel: Channel, queueOptions: Options.AssertQueue): void {
        this.queuesChannels.set(queueName, { channel, queueOptions })
    }

    private onMessageCallback(channel: Channel, callback: QueueCallback): (message: ConsumeMessage) => unknown {
        return (message: ConsumeMessage): unknown => {
            /**
             * Message example
             * { fields:
                { consumerTag: 'amq.ctag-NwvV8sVg94TU6dW7tNDlzg',
                    deliveryTag: 226,
                    redelivered: true,
                    exchange: '',
                    routingKey: 'QueueUser' },
                properties:
                { contentType: undefined,
                    contentEncoding: undefined,
                    headers: {},
                    deliveryMode: 1,
                    priority: undefined,
                    correlationId: undefined,
                    replyTo: undefined,
                    expiration: undefined,
                    messageId: undefined,
                    timestamp: undefined,
                    type: undefined,
                    userId: undefined,
                    appId: undefined,
                    clusterId: undefined },
                content: <Buffer 7b 22 74 65 73 74 22 3a 20 66 61 6c 73 65 7d> }
             */
            let messageContent: QueueMessageData
            try {
                messageContent = JSON.parse(message.content.toString())
            } catch {
                this.logger.error('Error while parse message content', message)

                return this.ackMsg(channel, message)
            }

            const response: QueueMessage = {
                id: message.properties.messageId,
                data: messageContent,
                properties: message.properties,
                done: (data?: unknown): void => {
                    const { replyTo, correlationId } = message.properties
                    if (data && replyTo && correlationId) {
                        channel.publish('', replyTo, Buffer.from(JSON.stringify(data)), { correlationId })
                    } else if (!data && replyTo && correlationId) {
                        this.logger.warn('Reply to and correlationId headers found but no reply data specified')
                    }

                    this.ackMsg(channel, message)
                },
                reject: (): void => {
                    this.nackMsg(channel, message)
                },
            }

            return callback(response)
        }
    }
}
