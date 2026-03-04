import { Channel, ConsumeMessage, Message } from 'amqplib'
import { Options } from 'amqplib/properties'

import { ApiError, ErrorType } from '@diia-inhouse/errors'
import { Logger } from '@diia-inhouse/types'

import { LabelUnknown, MessageHandler, NackOptions, QueueOptions, RecreateChannelOptions } from '../../interfaces'
import { ConsumerOptions } from '../../interfaces/messageBrokerServiceConfig'
import { Headers, QueueMessage, QueueMessageData } from '../../interfaces/providers/rabbitmq'
import { ConnectionStatus } from '../../interfaces/providers/rabbitmq/amqpConnection'
import { QueueName } from '../../interfaces/queueConfig'
import { totalListenerChannelErrorsMetric } from '../../metrics'
import RabbitMQMetricsService from '../../services/metrics'
import { AmqpConnection } from './amqpConnection'

export class AmqpListener {
    private readonly infiniteRecreateChannelTriesCount = 0

    private readonly defaultRecreateChannelOptions: RecreateChannelOptions = {
        maxTries: 6,
        timeout: 1000,
        backoffCoefficient: 2,
    }

    private readonly defaultPrefetchCount: number = 1

    private queuesChannelsMap: Map<QueueName, Channel> = new Map()

    private queueRecreateChannelTriesMap: Map<QueueName, number> = new Map()

    private readonly defaultNackOptions: NackOptions = new NackOptions(true, false)

    private queuesCallbacksMap: Map<QueueName, MessageHandler> = new Map()

    private queueConsumerOptionsMap: Map<QueueName, ConsumerOptions> = new Map()

    private queueConsumerTagsMap: Map<QueueName, string[]> = new Map()

    // in case when we receive a null message, we don't know how-to ack it, and emulate this message.
    // nothing changes cause previously this case had not been handled
    private readonly nullMessage: Message = { fields: { deliveryTag: 'unknown' } } as unknown as Message

    constructor(
        private connection: AmqpConnection,
        private readonly logger: Logger,
        private readonly rabbitMQMetrics: RabbitMQMetricsService,
        private readonly queuesOptions: QueueOptions[] = [],
        private readonly systemServiceName: string,
    ) {
        for (const queueOptions of this.queuesOptions) {
            const { name: queueName, consumerOptions: { prefetchCount, ...consumerOpts } = {} } = queueOptions

            this.queueRecreateChannelTriesMap.set(queueName, 0)
            this.queueConsumerOptionsMap.set(queueName, { ...consumerOpts, prefetchCount: prefetchCount ?? this.defaultPrefetchCount })
        }
    }

    async init(): Promise<void> {
        this.connection.on('ready', async () => {
            // in case if reconnect happened
            const tasks = Array.from(this.queuesChannelsMap.keys()).map(async (queueName: string) => {
                await this.createChannelAndListenQueue(queueName)
            })

            await Promise.all(tasks)
        })
    }

    async cancelQueue(queueName: QueueName): Promise<void> {
        const channel = this.getQueueChannel(queueName)
        const consumerTags = this.queueConsumerTagsMap.get(queueName) || []

        for await (const consumerTag of consumerTags) {
            await channel?.cancel(consumerTag)
        }
    }

    async listenQueue(queueName: QueueName, callback: MessageHandler): Promise<void | never> {
        this.logger.debug(`Start listen queue [${queueName}]`)

        try {
            this.saveQueueCallback(queueName, callback)

            await this.createChannelAndListenQueue(queueName)
        } catch (err) {
            this.logger.error(`Error while start listen queue [${queueName}]`, { err })
            throw err
        }
    }

    getStatus(): ConnectionStatus {
        return this.connection.getStatus()
    }

    private ackMsg(channel: Channel, message: Message | null, allUpTo = false): void {
        const msg = message ?? this.nullMessage

        return channel.ack(msg, allUpTo)
    }

    private nackMsg(channel: Channel, message: Message, nackOptions: NackOptions): void {
        const { requeue = true, allUpTo = false } = nackOptions

        return channel.nack(message, allUpTo, requeue)
    }

    private async createChannelAndListenQueue(queueName: QueueName): Promise<void> {
        const channel = await this.connection.createChannel(queueName)

        const consumerOptions = this.getConsumerOptions(queueName) || {}

        const { consumerTag: preferredConsumerTag, prefetchCount = this.defaultPrefetchCount } = consumerOptions

        await channel.prefetch(prefetchCount)

        const callback = this.onMessageCallback(queueName, channel, consumerOptions)

        channel.on('error', async (err) => {
            totalListenerChannelErrorsMetric.increment({ queueName })
            this.logger.warn('Recreating listener channel because an error has been occurred', { err, queueName })
            await this.handleChannelError(queueName, consumerOptions)
        })

        try {
            const { consumerTag } = await channel.consume(queueName, callback, { consumerTag: preferredConsumerTag })

            this.saveConsumerTag(queueName, consumerTag)

            this.logger.info(`Start consuming queue [${queueName}] with consumerTag [${consumerTag}]`)
        } catch (err) {
            this.logger.error('Failed to consume queue', { err, queueName })
            await this.handleChannelError(queueName, consumerOptions)
        }

        await this.saveChannel(queueName, channel)
    }

    private saveQueueCallback(queueName: QueueName, callback: MessageHandler): void {
        this.queuesCallbacksMap.set(queueName, callback)
    }

    private getQueueCallback(queueName: QueueName): MessageHandler {
        const callback = this.queuesCallbacksMap.get(queueName)
        if (!callback) {
            const errMsg = `Failed to find callback by queue name [${queueName}]`

            this.logger.error(errMsg)

            throw new Error('Error')
        }

        return callback
    }

    private async saveChannel(queueName: QueueName, channel: Channel): Promise<void> {
        try {
            const oldChannel = this.getQueueChannel(queueName)

            await oldChannel?.close()

            this.queuesChannelsMap.set(queueName, channel)
        } catch (err) {
            this.logger.error('Failed to close prev channel', { err, queueName })
        }
    }

    private onMessageCallback(
        queueName: QueueName,
        channel: Channel,
        consumerOptions: ConsumerOptions,
    ): (message: ConsumeMessage | null) => unknown {
        const callback = this.getQueueCallback(queueName)

        return async (message: ConsumeMessage | null): Promise<unknown> => {
            const startTime = process.hrtime.bigint()

            if (message === null) {
                this.rabbitMQMetrics.collectResponseTotalMetric(
                    startTime,
                    LabelUnknown,
                    LabelUnknown,
                    this.systemServiceName,
                    ErrorType.Unoperated,
                )

                await this.handleChannelError(queueName, consumerOptions)

                return
            }

            this.queueRecreateChannelTriesMap.set(queueName, 0)

            const [messageData, err] = this.parseMessage(message)

            const source = message?.properties.headers?.[Headers.sentFrom] || LabelUnknown
            const eventName = messageData?.event || LabelUnknown

            this.rabbitMQMetrics.collectCommunicationsTotalMetric(eventName, source, this.systemServiceName, 'inbound', queueName)

            if (err || !messageData) {
                this.rabbitMQMetrics.collectResponseTotalMetric(startTime, eventName, source, this.systemServiceName, ErrorType.Unoperated)

                return this.ackMsg(channel, message)
            }

            const response = this.prepareResponse(message, messageData, channel)

            try {
                const result = await callback(response)

                this.rabbitMQMetrics.collectResponseTotalMetric(startTime, eventName, source, this.systemServiceName)

                return result
            } catch (err) {
                const errorType = err instanceof ApiError ? err.getType() : ErrorType.Unoperated

                this.rabbitMQMetrics.collectResponseTotalMetric(startTime, eventName, source, this.systemServiceName, errorType)

                throw err
            }
        }
    }

    private async handleChannelError(queueName: QueueName, consumerOptions: ConsumerOptions): Promise<void> {
        const {
            recreateChannelOptions: {
                timeout = this.defaultRecreateChannelOptions.timeout!,
                maxTries = this.defaultRecreateChannelOptions.maxTries!,
                backoffCoefficient = this.defaultRecreateChannelOptions.backoffCoefficient!,
            } = {},
        } = consumerOptions

        const recreateChannelTriesCounter = (this.queueRecreateChannelTriesMap.get(queueName) || 0) + 1

        this.queueRecreateChannelTriesMap.set(queueName, recreateChannelTriesCounter)

        if (maxTries !== this.infiniteRecreateChannelTriesCount && recreateChannelTriesCounter >= maxTries) {
            throw new Error(`Max recreate channel tries reached [${recreateChannelTriesCounter}] for queue [${queueName}]`)
        }

        const waitingTime = timeout * backoffCoefficient * recreateChannelTriesCounter

        await new Promise((resolve) => setTimeout(resolve, waitingTime))

        await this.createChannelAndListenQueue(queueName)
    }

    private parseMessage(message: ConsumeMessage | null): [QueueMessageData | null, unknown | null] {
        try {
            const content = message?.content.toString() || ''

            return [JSON.parse(content), null]
        } catch (err) {
            this.logger.error('Error while parse message content', message)

            return [null, err]
        }
    }

    private prepareResponse(message: ConsumeMessage, messageData: QueueMessageData, channel: Channel): QueueMessage {
        const done = (data?: QueueMessageData): void => this.finishResponseProcessing(message, channel, data)

        return {
            done,
            id: message?.properties.messageId,
            data: messageData,
            properties: message?.properties,
            reject: (nackOptions: NackOptions = this.defaultNackOptions): void => {
                this.nackMsg(channel, message, nackOptions)
            },
        }
    }

    private finishResponseProcessing(message: ConsumeMessage, channel: Channel, data?: QueueMessageData): void {
        const { replyTo, correlationId } = message.properties

        if (data && replyTo && correlationId) {
            const json = JSON.stringify(data)
            const content = Buffer.from(json)

            const options: Options.Publish = {
                correlationId,
                headers: {
                    [Headers.handledBy]: this.systemServiceName,
                },
            }

            const exchangeName = ''
            const routingKey = replyTo

            channel.publish(exchangeName, routingKey, content, options)
        } else if (!data && replyTo && correlationId) {
            this.logger.warn('Reply to and correlationId headers found but no reply data specified')
        }

        this.ackMsg(channel, message)
    }

    private getConsumerOptions(queueName: QueueName): ConsumerOptions | undefined {
        const consumerOptions = this.queueConsumerOptionsMap.get(queueName)
        if (!consumerOptions) {
            this.logger.error(`Not found queue [${queueName}] consumer options`)

            return
        }

        return consumerOptions
    }

    private getQueueChannel(queueName: QueueName): Channel | undefined {
        return this.queuesChannelsMap.get(queueName)
    }

    private saveConsumerTag(queueName: QueueName, consumerTag: string): void {
        const tags = this.queueConsumerTagsMap.get(queueName) || []

        this.queueConsumerTagsMap.set(queueName, [...tags, consumerTag])
    }
}
