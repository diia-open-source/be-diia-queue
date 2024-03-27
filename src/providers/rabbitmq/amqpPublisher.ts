import { EventEmitter } from 'events'

import { Channel, Options, Replies } from 'amqplib'
import { randomUUID as uuid } from 'node:crypto'

import { Logger } from '@diia-inhouse/types'

import constants from '../../constants'
import { ConnectionStatus, ExchangeType, PublishOptions, QueueMessageData } from '../../interfaces'
import { MessageHeaders, PublishToExchangeParams } from '../../interfaces/providers/rabbitmq/amqpPublisher'

import { AmqpConnection } from './amqpConnection'

const { APP_ID } = constants

export class AmqpPublisher {
    readonly defaultExchangeType: ExchangeType = ExchangeType.Topic

    private channel: Channel

    private eventEmitter: EventEmitter

    private readonly defaultExchangeOptions: Options.AssertExchange = {
        durable: true,
        autoDelete: false,
    }

    constructor(
        private readonly connection: AmqpConnection,
        private readonly logger: Logger,
        private readonly timeout = 10000,
    ) {}

    async init(): Promise<void> {
        await this.createChannel()

        this.connection.on('ready', async () => {
            // in case if reconnect happened
            await this.createChannel()
        })
    }

    private async createChannel(): Promise<void> {
        this.channel = await this.connection.createChannel()
        this.eventEmitter = new EventEmitter()
        this.eventEmitter.setMaxListeners(0)
        await this.channel.consume(
            'amq.rabbitmq.reply-to',
            (msg) => {
                this.eventEmitter.emit(msg.properties.correlationId, JSON.parse(msg.content.toString('utf8')))
            },
            { noAck: true },
        )
    }

    async publishToExchange(params: PublishToExchangeParams): Promise<boolean> {
        const {
            eventName,
            message,
            exchangeName,
            routingKey = constants.DEFAULT_ROUTING_KEY,
            responseRoutingKey,
            headers,
            options,
        } = params
        if (!eventName || !exchangeName || !message) {
            this.logger.error(
                `Invalid event name [${eventName}] or exchange name [${exchangeName}] or message [${JSON.stringify(message)}]`,
            )

            return false
        }

        const eventMessage: QueueMessageData = AmqpPublisher.prepareQueueMessageData(eventName, responseRoutingKey, message, options)

        return await this.publish(eventMessage, exchangeName, routingKey, headers)
    }

    async publishToExchangeDirect<T>(params: PublishToExchangeParams): Promise<T> {
        const {
            eventName,
            message,
            exchangeName,
            routingKey = constants.DEFAULT_ROUTING_KEY,
            responseRoutingKey,
            headers,
            options,
        } = params
        const timeout: number = options?.timeout || this.timeout
        if (!eventName || !exchangeName || !message) {
            throw Error(`Invalid event name [${eventName}] or exchange name [${exchangeName}] or message [${JSON.stringify(message)}]`)
        }

        const eventMessage: QueueMessageData = AmqpPublisher.prepareQueueMessageData(eventName, responseRoutingKey, message, options)

        return await this.publishDirect(eventMessage, exchangeName, routingKey, timeout, headers)
    }

    private static prepareQueueMessageData(
        eventName: string,
        responseRoutingKey: string,
        message: unknown,
        options?: PublishOptions,
    ): QueueMessageData {
        const eventMessage: QueueMessageData = {
            event: eventName,
            payload: message,
            meta: {
                date: new Date(),
            },
        }
        if (responseRoutingKey) {
            eventMessage.meta.responseRoutingKey = responseRoutingKey
        }

        if (options?.ignoreCache) {
            eventMessage.meta.ignoreCache = options.ignoreCache
        }

        return eventMessage
    }

    private publishDirect<T>(
        eventMessage: QueueMessageData,
        exchangeName: string,
        routingKey: string,
        timeoutMs: number,
        headers?: unknown,
    ): Promise<T> {
        const correlationId = uuid()

        this.logger.io(`Publish direct event: ${eventMessage.event}`, { routingKey, eventMessage, correlationId })
        const publishOptions = AmqpPublisher.defaultPublishOptions(headers)

        publishOptions.replyTo = 'amq.rabbitmq.reply-to'
        publishOptions.correlationId = correlationId

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.eventEmitter.removeAllListeners(correlationId)
                reject(new Error('Time out for external event: ' + eventMessage.event))
            }, timeoutMs)

            this.eventEmitter.once(correlationId, (args) => {
                clearTimeout(timeout)
                resolve(args)
            })
            try {
                this.channel.publish(exchangeName, routingKey, Buffer.from(JSON.stringify(eventMessage)), publishOptions)
            } catch (err) {
                reject(err)
            }
        })
    }

    private async publish(
        eventMessage: QueueMessageData,
        exchangeName: string,
        routingKey: string,
        headers?: MessageHeaders,
    ): Promise<boolean> {
        const delay = headers?.['x-delay']

        this.logger.io(`Publish event: ${eventMessage.event}`, { routingKey, eventMessage, delay })
        const publishOptions = AmqpPublisher.defaultPublishOptions(headers)

        return this.channel.publish(exchangeName, routingKey, Buffer.from(JSON.stringify(eventMessage)), publishOptions)
    }

    private static defaultPublishOptions(headers?: unknown): Options.Publish {
        return {
            contentEncoding: 'utf-8',
            contentType: 'application/json',
            // if true, the message will be returned if it is not routed to a queue
            // i.e., if there are no bindings that match its routing key
            // meaning persistent
            deliveryMode: 2,
            // an arbitrary identifier for the originating application
            appId: APP_ID,
            // if true, the message will be returned if it is not routed to a queue
            // (i.e., if there are no bindings that match its routing key).
            mandatory: true,
            timestamp: Date.now(), // a timestamp for the message
            headers,
        }
    }

    async checkExchange(
        exchangeName: string,
        exchangeType: ExchangeType = this.defaultExchangeType,
        options: Options.AssertExchange = {},
    ): Promise<Replies.AssertExchange> {
        try {
            return await this.channel.assertExchange(exchangeName, exchangeType, { ...this.defaultExchangeOptions, ...options })
        } catch (err) {
            this.logger.error(`Error while assert exchange [${exchangeName}]`)
            throw err
        }
    }

    getStatus(): ConnectionStatus {
        return this.connection.getStatus()
    }
}
