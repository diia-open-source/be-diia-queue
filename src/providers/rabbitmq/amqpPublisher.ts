import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'

import { Channel, ConsumeMessage, Options } from 'amqplib'

import { ErrorType, ExternalCommunicatorError, InternalServerError } from '@diia-inhouse/errors'
import { HttpStatusCode, Logger } from '@diia-inhouse/types'

import constants from '../../constants.js'
import { ExchangeName } from '../../interfaces/messageBrokerServiceConfig.js'
import { LabelUnknown } from '../../interfaces/metrics/index.js'
import { PublishDirectMessageOptions, PublisherOptions, PublishMessageOptions } from '../../interfaces/options.js'
import { ConnectionStatus } from '../../interfaces/providers/rabbitmq/amqpConnection.js'
import { Headers, QueueMessageData } from '../../interfaces/providers/rabbitmq/index.js'
import RabbitMQMetricsService from '../../services/metrics.js'
import { AmqpConnection } from './amqpConnection.js'
import { AmqpPublisherPublishOptions, DirectResponse, MessageHeaders, PublishingResult } from './amqpPublisher.types.js'

const { APP_ID, DEFAULT_ROUTING_KEY, REPLY_TO_QUEUE_NAME } = constants

export class AmqpPublisher {
    private readonly defaultPublishOptions: Options.Publish = {
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

    private readonly directResponseTimeout: number = 10_000

    private readonly publishTimeout: number = 10_000

    private readonly throwOnPublishTimeout = true

    constructor(
        private readonly connection: AmqpConnection,
        private readonly logger: Logger,
        private readonly rabbitMQMetrics: RabbitMQMetricsService,
        private readonly systemServiceName: string,
        options: PublisherOptions = {},
    ) {
        this.publishTimeout = options.publishTimeout ?? this.publishTimeout
        this.directResponseTimeout = options.directResponseTimeout ?? options.timeout ?? this.directResponseTimeout
        this.replyToQueueName = options.replyToQueueName ?? REPLY_TO_QUEUE_NAME
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
        routingKey: string = DEFAULT_ROUTING_KEY,
        publishMessageOptions: PublishMessageOptions = {},
    ): Promise<PublishingResult> {
        const { event, payload } = message

        const startTime = process.hrtime.bigint()
        const route = event
        const source = this.systemServiceName
        const destination = LabelUnknown

        try {
            if (!event || !exchangeName || !payload) {
                const errorMessage = `Invalid event name [${event}] or exchange name [${exchangeName}] or payload [${JSON.stringify(payload)}]`

                this.logger.error(errorMessage)

                throw new InternalServerError(errorMessage)
            }

            const amqpPublisherPublishOptions = this.getAmqpPublisherPublishOptions(publishMessageOptions, headers)

            this.logger.info(`Publish event: ${event}`, { routingKey, delay: headers['x-delay'] })
            this.logger.io('Event message', message)

            const isPublished = await this.publishMessage(message, exchangeName, routingKey, amqpPublisherPublishOptions)

            this.collectMetrics(startTime, route, source, destination, isPublished ? undefined : ErrorType.Unoperated)
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
        routingKey: string = DEFAULT_ROUTING_KEY,
        publishDirectOptions: PublishDirectMessageOptions = {},
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
            } = await this.receiveDirectResponse<T>(exchangeName, message, headers, routingKey, publishDirectOptions)

            destination = handledBy ?? destination

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
        const response: DirectResponse = { body, headers }

        this.eventEmitter?.emit(msg.properties.correlationId, response)
    }

    private async publishMessage(
        eventMessage: QueueMessageData,
        exchangeName: string,
        routingKey: string,
        amqpPublisherPublishOptions: AmqpPublisherPublishOptions,
    ): Promise<boolean> {
        if (!this.regularChannel) {
            throw new Error('Publishing message is denied, channel is not initialized')
        }

        return await this.publish(eventMessage, exchangeName, routingKey, amqpPublisherPublishOptions, this.regularChannel)
    }

    private async publishRequest(
        eventMessage: QueueMessageData,
        exchangeName: string,
        routingKey: string,
        amqpPublisherPublishOptions: AmqpPublisherPublishOptions,
    ): Promise<PublishingResult> {
        if (!this.rpcChannel) {
            throw new Error('Publishing RPC request is denied, channel is not initialized')
        }

        await this.publish(eventMessage, exchangeName, routingKey, amqpPublisherPublishOptions, this.rpcChannel)
    }

    private async publish(
        eventMessage: QueueMessageData,
        exchangeName: string,
        routingKey: string,
        publishOptions: AmqpPublisherPublishOptions,
        channel: Channel,
    ): Promise<boolean> {
        const { channel: channelPublishOptions, custom: customPublishOptions } = publishOptions

        const content = Buffer.from(JSON.stringify(eventMessage))
        const published = channel.publish(exchangeName, routingKey, content, channelPublishOptions)

        if (published) {
            return true
        }

        const backpressureStartTime = process.hrtime.bigint()

        const logParams = {
            routingKey,
            exchangeName,
            event: eventMessage.event,
        }

        try {
            const hasMessagePublished = await this.waitForDrain(channel, customPublishOptions)

            const waitTimeMs = this.getWaitingTimeMs(backpressureStartTime)

            if (hasMessagePublished) {
                this.logger.info('Message published after backpressure', { ...logParams, waitTimeMs })
            } else {
                this.logger.error('Message publish timeout exceeded', { ...logParams, waitTimeMs })
            }

            return hasMessagePublished
        } catch (err) {
            const waitTimeMs = this.getWaitingTimeMs(backpressureStartTime)

            this.logger.error('Error while waiting for drain', { err, ...logParams, waitTimeMs })

            throw err
        }
    }

    private async waitForDrain(channel: Channel, publishMessageOptions: PublishMessageOptions): Promise<boolean> {
        const { publishTimeout = this.publishTimeout, throwOnPublishTimeout = this.throwOnPublishTimeout } = publishMessageOptions

        const { promise, resolve, reject } = Promise.withResolvers<boolean>()
        let timeoutId: NodeJS.Timeout

        const cleanup = (): void => {
            channel.off('drain', onDrain)
            channel.off('error', onError)
            clearTimeout(timeoutId)
        }

        const onDrain = (): void => {
            resolve(true)
        }

        const onError = (err: Error): void => {
            reject(err)
        }

        channel.once('drain', onDrain)
        channel.once('error', onError)

        timeoutId = setTimeout(() => {
            if (throwOnPublishTimeout) {
                reject(new InternalServerError('Message publish timeout exceeded'))
            } else {
                resolve(false)
            }
        }, publishTimeout)

        try {
            return await promise
        } finally {
            cleanup()
        }
    }

    private getWaitingTimeMs(backpressureStartTime: bigint): number {
        return Number(process.hrtime.bigint() - backpressureStartTime) / 1_000_000
    }

    private getAmqpPublisherPublishOptions(
        customOptions: PublishMessageOptions,
        headers?: object,
        amqpOptions: Options.Publish = {},
    ): AmqpPublisherPublishOptions {
        return {
            channel: {
                ...this.defaultPublishOptions,
                timestamp: Date.now(), // a timestamp for the message
                ...amqpOptions,
                headers: {
                    ...headers,
                    [Headers.sentFrom]: this.systemServiceName,
                },
            },
            custom: {
                ...customOptions,
            },
        }
    }

    private async receiveDirectResponse<T>(
        exchangeName: ExchangeName,
        message: QueueMessageData,
        headers: MessageHeaders,
        routingKey: string = DEFAULT_ROUTING_KEY,
        publishDirectOptions: PublishDirectMessageOptions,
    ): Promise<DirectResponse<T>> {
        const { event, payload } = message

        if (!event || !exchangeName || !payload) {
            throw new Error(`Invalid event name [${event}] or exchange name [${exchangeName}] or payload [${JSON.stringify(payload)}]`)
        }

        const correlationId = randomUUID()

        const publishMessageOptions: PublishMessageOptions = {
            ...publishDirectOptions,
            throwOnPublishTimeout: true,
        }
        const amqpPublishOptions: Options.Publish = {
            correlationId,
            replyTo: this.replyToQueueName,
        }
        const amqpPublisherPublishOptions = this.getAmqpPublisherPublishOptions(publishMessageOptions, headers, amqpPublishOptions)

        this.logger.info(`Publish direct event: ${event}`, { routingKey, correlationId, eventUuid: payload.uuid })
        this.logger.io('Direct event message', message)

        const { promise, resolve, reject } = Promise.withResolvers<DirectResponse<T>>()
        let timeoutId: NodeJS.Timeout

        const cleanup = (): void => {
            clearTimeout(timeoutId)
            this.eventEmitter?.removeAllListeners(correlationId)
        }

        const onResponse = (args: DirectResponse<T>): void => {
            this.logger.info(`Received direct event response: ${event}`, { traceId: headers.traceId })
            this.logger.io(`Direct event response message`, { body: args.body, traceId: headers.traceId })
            resolve(args)
        }

        this.eventEmitter?.once(correlationId, onResponse)

        try {
            await this.publishRequest(message, exchangeName, routingKey, amqpPublisherPublishOptions)

            const responseTimeout = publishDirectOptions.responseTimeout ?? this.directResponseTimeout

            timeoutId = setTimeout(() => {
                reject(new ExternalCommunicatorError(`Time out for external event: ${event}`, HttpStatusCode.GATEWAY_TIMEOUT))
            }, responseTimeout)

            return await promise
        } finally {
            cleanup()
        }
    }

    private collectMetrics(startTime: bigint, route: string, source: string, destination: string, errorType?: ErrorType): void {
        this.rabbitMQMetrics.collectCommunicationsTotalMetric(route, source, destination, 'outbound')
        this.rabbitMQMetrics.collectRequestTotalMetric(startTime, route, source, destination, errorType)
    }
}
