import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'

import { merge } from 'lodash'
import pTimeout from 'p-timeout'

import { MetricsService } from '@diia-inhouse/diia-metrics'
import { InternalServerError } from '@diia-inhouse/errors'
import { Logger } from '@diia-inhouse/types'

import constants from '../../constants'
import { ConnectionStatus, PublishingResult, emptyMessageBrokerServiceConfig } from '../../interfaces'
import { ExchangeOptions, MessageBrokerServiceConfig, QueueOptions } from '../../interfaces/messageBrokerServiceConfig'
import { MessageHandler } from '../../interfaces/messageHandler'
import { PublishDirectOptions, PublishOptions } from '../../interfaces/options'
import {
    ConnectionClientType,
    ConnectionList,
    ExportConfig,
    QueueMessageData,
    RabbitMQConfig,
    RabbitMQStatus,
} from '../../interfaces/providers/rabbitmq'
import { MessageHeaders } from '../../interfaces/providers/rabbitmq/amqpPublisher'
import {
    EventName,
    QueueConfigByQueueName,
    QueueName,
    ServiceConfigByConfigType,
    TopicConfigByConfigType,
} from '../../interfaces/queueConfig'
import { QueueContext } from '../../interfaces/queueContext'
import RabbitMQMetricsService from '../../services/metrics'
import { AmqpAsserter } from './amqpAsserter'
import { AmqpConnection } from './amqpConnection'
import { AmqpListener } from './amqpListener'
import { AmqpPublisher } from './amqpPublisher'

// eslint-disable-next-line unicorn/prefer-event-target
export class RabbitMQProvider extends EventEmitter {
    private initializingLock?: Promise<void>

    private listener?: AmqpListener

    private publisher?: AmqpPublisher

    private asserter?: AmqpAsserter

    private connectionList: ConnectionList = {
        [ConnectionClientType.Listener]: {},
        [ConnectionClientType.Asserter]: {},
        [ConnectionClientType.Publisher]: {},
    }

    private readonly publisherIsNotInitializedErrorMsg = 'Publisher is not initialized'

    private readonly rabbitMQMetricsService: RabbitMQMetricsService

    constructor(
        private readonly systemServiceName: string,
        private readonly rabbitmqConfig: RabbitMQConfig,
        private readonly serviceConfig: ServiceConfigByConfigType,
        private readonly topicsConfig: TopicConfigByConfigType,
        private readonly portalEvents: EventName[],
        private readonly logger: Logger,
        private readonly metrics: MetricsService,
        private readonly asyncLocalStorage?: AsyncLocalStorage<QueueContext>,
        private readonly queuesConfig?: QueueConfigByQueueName,
        private readonly messageBrokerServiceConfig?: MessageBrokerServiceConfig,
    ) {
        super()

        this.rabbitMQMetricsService = new RabbitMQMetricsService(this.metrics)
    }

    getConfig(): ExportConfig {
        return {
            topics: this.topicsConfig,
            rabbit: this.rabbitmqConfig,
            service: this.serviceConfig,
            portalEvents: this.portalEvents,
            queues: this.queuesConfig ?? {},
        }
    }

    getMessageBrokerServiceConfig(): MessageBrokerServiceConfig {
        if (!this.messageBrokerServiceConfig) {
            return {
                queuesOptions: [],
                exchangesOptions: [],
            }
        }

        return this.messageBrokerServiceConfig
    }

    async init(config: MessageBrokerServiceConfig = emptyMessageBrokerServiceConfig): Promise<void> {
        const { queuesOptions, exchangesOptions } = config

        if (this.initializingLock) {
            return await this.initializingLock
        }

        const tasks: Promise<unknown>[] = [this.setPublisher(), this.setAsserter(queuesOptions, exchangesOptions)]

        if (this.rabbitmqConfig.consumerEnabled !== false && queuesOptions.length > 0) {
            tasks.push(this.setListener(queuesOptions))
        }

        this.initializingLock = Promise.all(tasks).then(() =>
            this.logger.info(`RabbitMQ provider has been initialized by options`, { queuesOptions, exchangesOptions }),
        )

        await this.initializingLock

        this.emit('initialized')
    }

    async subscribe(queueName: QueueName, messageHandler: MessageHandler): Promise<boolean> {
        await this.listener?.listenQueue(queueName, messageHandler)

        return true
    }

    async unsubscribe(queueName: QueueName): Promise<void> {
        await this.listener?.cancelQueue(queueName)
    }

    async publish(
        message: QueueMessageData,
        exchangeName: string,
        routingKey: string = constants.DEFAULT_ROUTING_KEY,
        options?: PublishOptions,
    ): Promise<PublishingResult> {
        const { publishTimeout = Infinity, throwOnPublishTimeout = true, delay } = options || {}

        const publishTask = async (): Promise<PublishingResult> => {
            const headers = this.preparePublisherHeaders(delay)

            if (!this.publisher) {
                throw new Error(this.publisherIsNotInitializedErrorMsg)
            }

            return await this.publisher?.publishToExchange(exchangeName, message, headers, routingKey)
        }

        const timeoutMsg = `Publishing message to ${exchangeName} exchange with ${routingKey} routing key timeout exceed`

        if (throwOnPublishTimeout) {
            return await pTimeout(publishTask(), publishTimeout, timeoutMsg)
        }

        return await pTimeout(publishTask(), publishTimeout, () => {
            this.logger.error(timeoutMsg, { publishTimeout })

            throw new InternalServerError(timeoutMsg)
        })
    }

    async publishExternalDirect<T>(
        message: QueueMessageData,
        exchangeName: string,
        routingKey: string = constants.DEFAULT_ROUTING_KEY,
        options?: PublishDirectOptions,
    ): Promise<T> {
        const headers = this.preparePublisherHeaders()

        if (!this.publisher) {
            throw new Error(this.publisherIsNotInitializedErrorMsg)
        }

        return await this.publisher?.publishToExchangeDirect<T>(exchangeName, message, headers, routingKey, options?.timeout)
    }

    getStatus(): RabbitMQStatus {
        return {
            ...(this.listener ? { listener: this.listener.getStatus() } : {}),
            publisher: this.publisher?.getStatus() ?? ConnectionStatus.Down,
        }
    }

    async makeAMQPConnection(client: ConnectionClientType): Promise<AmqpConnection> {
        return new AmqpConnection(
            this.rabbitmqConfig.connection,
            this.logger,
            this.rabbitmqConfig.reconnectOptions,
            merge(
                {
                    clientProperties: {
                        connectionClientType: client,
                    },
                },
                this.rabbitmqConfig.socketOptions,
            ),
        )
    }

    async makeAMQPListener(queuesOptions: QueueOptions[]): Promise<AmqpListener> {
        const connection = await this.getConnection(ConnectionClientType.Listener)

        return new AmqpListener(connection, this.logger, this.rabbitMQMetricsService, queuesOptions, this.systemServiceName)
    }

    async makeAMQPAsserter(): Promise<AmqpAsserter> {
        const connection = await this.getConnection(ConnectionClientType.Asserter)

        return new AmqpAsserter(connection, this.logger, this.rabbitmqConfig.declareOptions)
    }

    async makeAMQPPublisher(): Promise<AmqpPublisher> {
        const connection = await this.getConnection(ConnectionClientType.Publisher)

        return new AmqpPublisher(connection, this.logger, this.rabbitMQMetricsService, this.systemServiceName)
    }

    private async setListener(queuesOptions: QueueOptions[]): Promise<AmqpListener> {
        if (!this.listener) {
            this.listener = await this.makeAMQPListener(queuesOptions)

            await this.listener?.init()
        }

        return this.listener
    }

    private async setAsserter(queuesOptions: QueueOptions[], exchangesOptions: ExchangeOptions[]): Promise<AmqpAsserter> {
        if (!this.asserter) {
            this.asserter = await this.makeAMQPAsserter()

            await this.asserter.init(exchangesOptions, queuesOptions)
        }

        return this.asserter
    }

    private async setPublisher(): Promise<AmqpPublisher> {
        if (!this.publisher) {
            this.publisher = await this.makeAMQPPublisher()

            await this.publisher?.init()
        }

        return this.publisher
    }

    private async getConnection(client: ConnectionClientType): Promise<AmqpConnection> {
        if (this.connectionList[client].lock) {
            return await this.connectionList[client].lock
        }

        const connection = await this.makeAMQPConnection(client)

        this.connectionList[client].lock = new Promise<AmqpConnection>((resolve: (c: AmqpConnection) => void) =>
            connection.connect().then(() => resolve(connection)),
        )

        return await this.connectionList[client].lock
    }

    private preparePublisherHeaders(delay?: number): MessageHeaders {
        const store = this.asyncLocalStorage?.getStore()
        const logData = store?.logData ?? {}
        const traceId = logData?.traceId ?? randomUUID()
        const serviceCode = logData?.serviceCode

        return {
            traceId,
            serviceCode,
            ...(delay ? { 'x-delay': delay } : {}),
        }
    }
}
