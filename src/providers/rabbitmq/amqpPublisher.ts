import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'

import { Channel, Options } from 'amqplib'
import { ConsumeMessage } from 'amqplib/properties'

import { ErrorType, ExternalCommunicatorError, InternalServerError } from '@diia-inhouse/errors'
import { HttpStatusCode, Logger } from '@diia-inhouse/types'

import constants from '../../constants'
import { ExchangeName } from '../../interfaces/messageBrokerServiceConfig'
import { LabelUnknown } from '../../interfaces/metrics'
import { PublisherOptions } from '../../interfaces/options'
import { Headers, QueueMessageData } from '../../interfaces/providers/rabbitmq'
import { ConnectionStatus } from '../../interfaces/providers/rabbitmq/amqpConnection'
import { DirectResponse, MessageHeaders, PublishingResult } from '../../interfaces/providers/rabbitmq/amqpPublisher'
import RabbitMQMetricsService from '../../services/metrics'
import { AmqpConnection } from './amqpConnection'

const { APP_ID, DEFAULT_ROUTING_KEY, REPLY_TO_QUEUE_NAME } = constants

export class AmqpPublisher {
    private readonly defaultPublishOptions: Options.Publish = {
        // eslint-disable-next-line unicorn/text-encoding-identifier-case
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
    }

    private rpcChannel?: Channel

    private regularChannel?: Channel

    private readonly replyToQueueName: string = REPLY_TO_QUEUE_NAME

    private eventEmitter?: EventEmitter

    private readonly directResponseTimeout: number = 10000

    constructor(
        private readonly connection: AmqpConnection,
        private readonly logger: Logger,
        private readonly rabbitMQMetrics: RabbitMQMetricsService,
        private readonly systemServiceName: string,
        options: PublisherOptions = {},
    ) {
        this.directResponseTimeout = options.timeout || this.directResponseTimeout
        this.replyToQueueName = options.replyToQueueName || REPLY_TO_QUEUE_NAME
    }

    async init(): Promise<void> {
        await this.createRpcChannel()
        await this.createRegularChannel()

        this.connection.on('ready', async () => {
            // in case if reconnect happened
            await this.createRpcChannel()
            await this.createRegularChannel()
        })
    }

    async publishToExchange(
        exchangeName: ExchangeName,
        message: QueueMessageData,
        headers: MessageHeaders,
        routingKey = DEFAULT_ROUTING_KEY,
    ): Promise<PublishingResult> {
        const { event, payload } = message

        const startTime = process.hrtime.bigint()
        const route = event
        const source = this.systemServiceName
        const destination = LabelUnknown

        try {
            if (!event || !exchangeName || !payload) {
                const message = `Invalid event name [${event}] or exchange name [${exchangeName}] or payload [${JSON.stringify(payload)}]`

                this.logger.error(message)

                throw new InternalServerError(message)
            }

            const publishOptions = this.getPublishOptions(headers)

            this.logger.info(`Publish event: ${event}`, { routingKey, delay: headers['x-delay'] })
            this.logger.io('Event message', message)

            this.publishMessage(message, exchangeName, routingKey, publishOptions)
            this.collectMetrics(startTime, route, source, destination)
        } catch (err) {
            this.logger.error('Error while publishing event', { err, exchangeName, routingKey })

            this.collectMetrics(startTime, route, source, destination, ErrorType.Unoperated)

            throw err
        }
    }

    async publishToExchangeDirect<T>(
        exchangeName: ExchangeName,
        message: QueueMessageData,
        headers: MessageHeaders,
        routingKey = DEFAULT_ROUTING_KEY,
        responseTimeoutMs = this.directResponseTimeout,
    ): Promise<T> {
        const startTime = process.hrtime.bigint()

        const route = message.event
        const source = this.systemServiceName

        let errorType = undefined
        let destination = LabelUnknown

        try {
            const {
                body,
                headers: { [Headers.handledBy]: handledBy },
            } = await this.receiveDirectResponse<T>(exchangeName, message, headers, routingKey, responseTimeoutMs)

            destination = handledBy || destination

            return body
        } catch (err) {
            this.logger.error('Failed to receive a direct response', { err, exchangeName, routingKey })

            errorType = ErrorType.Unoperated

            throw err
        } finally {
            this.collectMetrics(startTime, route, source, destination, errorType)
        }
    }

    getStatus(): ConnectionStatus {
        return this.connection.getStatus()
    }

    private async createRegularChannel(): Promise<void> {
        this.regularChannel = await this.connection.createChannel()
    }

    private async createRpcChannel(): Promise<void> {
        this.rpcChannel = await this.connection.createChannel(this.replyToQueueName)
        this.rpcChannel?.on('error', async () => await this.createRpcChannel())

        // eslint-disable-next-line unicorn/prefer-event-target
        this.eventEmitter = new EventEmitter()
        this.eventEmitter?.setMaxListeners(0)

        const consumeOptions: Options.Consume = { noAck: true }

        await this.rpcChannel?.consume(this.replyToQueueName, this.listenReplyToQueue.bind(this), consumeOptions)
    }

    private listenReplyToQueue(msg: ConsumeMessage | null): void {
        if (!msg) {
            this.logger.error('Consumed direct message is null')

            return
        }

        const body = JSON.parse(msg.content.toString('utf8'))
        const headers = msg.properties.headers || {}

        this.eventEmitter?.emit<DirectResponse>(msg.properties.correlationId, { body, headers })
    }

    private publishMessage(
        eventMessage: QueueMessageData,
        exchangeName: string,
        routingKey: string,
        publishOptions: Options.Publish,
    ): PublishingResult {
        if (!this.regularChannel) {
            throw new Error('Publishing message is denied, channel is not initialized')
        }

        return this.publish(eventMessage, exchangeName, routingKey, publishOptions, this.regularChannel)
    }

    private publishRequest(
        eventMessage: QueueMessageData,
        exchangeName: string,
        routingKey: string,
        publishOptions: Options.Publish,
    ): PublishingResult {
        if (!this.rpcChannel) {
            throw new Error('Publishing RPC request is denied, channel is not initialized')
        }

        return this.publish(eventMessage, exchangeName, routingKey, publishOptions, this.rpcChannel)
    }

    private publish(
        eventMessage: QueueMessageData,
        exchangeName: string,
        routingKey: string,
        publishOptions: Options.Publish,
        channel: Channel,
    ): PublishingResult {
        const data = JSON.stringify(eventMessage)
        const content = Buffer.from(data)

        const isPublishingSuccessful = channel.publish(exchangeName, routingKey, content, publishOptions)
        if (!isPublishingSuccessful) {
            throw new InternalServerError('Message has not been published')
        }
    }

    private getPublishOptions(headers?: object, extraOpts: Options.Publish = {}): Options.Publish {
        return {
            ...this.defaultPublishOptions,
            timestamp: Date.now(), // a timestamp for the message
            ...extraOpts,
            headers: {
                ...headers,
                [Headers.sentFrom]: this.systemServiceName,
            },
        }
    }

    private async receiveDirectResponse<T>(
        exchangeName: ExchangeName,
        message: QueueMessageData,
        headers: MessageHeaders,
        routingKey = DEFAULT_ROUTING_KEY,
        responseTimeoutMs = this.directResponseTimeout,
    ): Promise<DirectResponse<T>> {
        const { event, payload } = message

        if (!event || !exchangeName || !payload) {
            throw new Error(`Invalid event name [${event}] or exchange name [${exchangeName}] or payload [${JSON.stringify(payload)}]`)
        }

        const correlationId = randomUUID()

        const publishOptions = this.getPublishOptions(headers, {
            correlationId,
            replyTo: this.replyToQueueName,
        })

        this.logger.info(`Publish direct event: ${event}`, { routingKey, correlationId, eventUuid: payload.uuid })
        this.logger.io('Direct event message', message)

        return await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.eventEmitter?.removeAllListeners(correlationId)
                reject(new ExternalCommunicatorError(`Time out for external event: ${event}`, HttpStatusCode.GATEWAY_TIMEOUT))
            }, responseTimeoutMs)

            this.eventEmitter?.once<DirectResponse>(correlationId, (args: DirectResponse<T>) => {
                clearTimeout(timeout)
                this.logger.io('Direct event response message', args.body)

                return resolve(args)
            })
            try {
                this.publishRequest(message, exchangeName, routingKey, publishOptions)
            } catch (err) {
                reject(err)
            }
        })
    }

    private collectMetrics(startTime: bigint, route: string, source: string, destination: string, errorType?: ErrorType): void {
        this.rabbitMQMetrics.collectCommunicationsTotalMetric(route, source, destination, 'outbound')
        this.rabbitMQMetrics.collectRequestTotalMetric(startTime, route, source, destination, errorType)
    }
}
