import { type AsyncLocalStorage } from 'async_hooks'
import { EventEmitter } from 'events'

import { isEmpty, merge } from 'lodash'
import { v4 } from 'uuid'

import { Logger } from '@diia-inhouse/types'

import {
    ConnectionClientType,
    ConnectionList,
    ConnectionStatus,
    ExchangeType,
    ListenerOptions,
    MessageHandler,
    MessagePayload,
    PublishOptions,
    QueueContext,
    RabbitMQConfig,
    RabbitMQStatus,
    SubscribeOptions,
} from '../../interfaces'
import { MessageHeaders, PublishToExchangeParams } from '../../interfaces/providers/rabbitmq/amqpPublisher'
import {
    EventName,
    ExternalEvent,
    ExternalServiceConfig,
    ExternalTopic,
    InternalEvent,
    InternalQueueName,
    InternalServiceConfig,
    InternalTopic,
    QueueConfigByQueueName,
    QueueConfigType,
    ScheduledTaskEvent,
    ScheduledTaskQueueName,
    ServiceConfigByConfigType,
    Topic,
    TopicConfigByConfigType,
} from '../../interfaces/queueConfig'

import { AmqpConnection } from './amqpConnection'
import { AmqpListener } from './amqpListener'
import { AmqpPublisher } from './amqpPublisher'

export class RabbitMQProvider extends EventEmitter {
    private initializingLock?: Promise<void>

    private listener: AmqpListener

    private publisher: AmqpPublisher

    private connectionList: ConnectionList = {
        [ConnectionClientType.Listener]: {},
        [ConnectionClientType.Publisher]: {},
    }

    private readonly projectName: string = 'diia'

    private readonly portalName: string = 'portal'

    private eventNameToTopicMap: Map<EventName, Topic> = new Map()

    private internalEvents: EventName[] = [].concat(Object.values(InternalEvent)).concat(Object.values(ScheduledTaskEvent))

    private externalPublishEventsSet: Set<ExternalEvent>

    private externalSubscribeEventsSet: Set<ExternalEvent>

    private assertExternalExchanges?: boolean

    constructor(
        private readonly serviceName: string,
        private readonly rabbitmqConfig: RabbitMQConfig,
        private readonly serviceConfig: ServiceConfigByConfigType,
        private readonly topicsConfig: TopicConfigByConfigType,
        private readonly type: QueueConfigType,
        private readonly logger: Logger,
        private readonly asyncLocalStorage?: AsyncLocalStorage<QueueContext>,
        private readonly queuesConfig?: QueueConfigByQueueName,
    ) {
        super()

        Object.keys(this.topicsConfig).forEach((topicName: Topic) => {
            this.topicsConfig[topicName].events.forEach((eventName: EventName) => {
                this.eventNameToTopicMap.set(eventName, topicName)
            })
        })
        if (this.type === QueueConfigType.External) {
            const config: ExternalServiceConfig = <ExternalServiceConfig>this.serviceConfig

            this.externalPublishEventsSet = new Set(config?.publish)
            this.externalSubscribeEventsSet = new Set(config?.subscribe)
            this.assertExternalExchanges = rabbitmqConfig.assertExchanges
        }
    }

    getServiceName(): string {
        return this.serviceName
    }

    getConfig(): RabbitMQConfig {
        return this.rabbitmqConfig
    }

    async init(listenerOptions?: ListenerOptions): Promise<void> {
        if (this.initializingLock) {
            return await this.initializingLock
        }

        this.initializingLock = new Promise((resolve: () => void) =>
            Promise.all([this.setListener(listenerOptions), this.setPublisher()]).then(() => resolve()),
        )

        await this.initializingLock

        this.emit('initialized')
    }

    async subscribe(
        subscriptionName: InternalQueueName | ScheduledTaskQueueName,
        messageHandler: MessageHandler,
        options?: SubscribeOptions,
    ): Promise<boolean> {
        if (!(<InternalServiceConfig>this.serviceConfig).subscribe?.includes(subscriptionName)) {
            this.logger.error(`Subscription [${subscriptionName}] is not related to the service [${this.serviceName}]`)

            return false
        }

        const queueName: string = this.makeQueueName(subscriptionName, options)

        await this.init(options?.listener)

        await this.listener.listenQueue(queueName, messageHandler)
        if (isEmpty(this.queuesConfig[subscriptionName].topics)) {
            this.logger.info(`Can't find topics for subscription [${subscriptionName}]`)

            return true
        }

        const routingKey: string = options ? options.routingKey : undefined

        await Promise.all(
            this.queuesConfig[subscriptionName].topics.map((topic: InternalTopic) =>
                this.checkAndBindToExchange(topic, queueName, routingKey),
            ),
        )

        return true
    }

    async publish(eventName: InternalEvent | ScheduledTaskEvent, message: MessagePayload, routingKey?: string): Promise<boolean> {
        if (!this.internalEvents.includes(eventName)) {
            this.logger.error(`Event [${eventName}] is not implemented`)

            return false
        }

        const exchangeName: InternalTopic = <InternalTopic>this.findTopicNameByEventName(eventName)
        if (!exchangeName) {
            this.logger.error(`Can't find topic name by event [${eventName}]`)

            return false
        }

        if (!(<InternalServiceConfig>this.serviceConfig).publish?.includes(exchangeName)) {
            this.logger.error(`Event [${eventName}] is not allowed to publish by service [${this.serviceName}]`)

            return false
        }

        await this.init()

        try {
            await this.publisher.checkExchange(exchangeName)
        } catch (err) {
            return false
        }

        return await this.publisher.publishToExchange({
            eventName,
            message,
            exchangeName,
            routingKey,
            headers: this.preparePublisherHeaders(),
        })
    }

    async subscribeTask(queueName: string, messageHandler: MessageHandler, options: SubscribeOptions = {}): Promise<boolean> {
        const { listener, delayed } = options

        await this.init(listener)

        await this.listener.listenQueue(queueName, messageHandler)
        if (delayed) {
            await this.publisher.checkExchange(queueName, ExchangeType.XDelayedMessage, {
                arguments: { 'x-delayed-type': this.publisher.defaultExchangeType },
            })
        } else {
            await this.publisher.checkExchange(queueName)
        }

        await this.listener.bindQueueToExchange(queueName, queueName)

        return true
    }

    async publishTask(queueName: string, message: MessagePayload, delay?: number): Promise<boolean> {
        await this.init()

        const params: PublishToExchangeParams = {
            eventName: queueName,
            message,
            exchangeName: queueName,
            headers: this.preparePublisherHeaders(),
        }

        if (delay) {
            params.headers['x-delay'] = delay
        }

        return await this.publisher.publishToExchange(params)
    }

    async subscribeExternal(messageHandler: MessageHandler, options?: SubscribeOptions): Promise<boolean> {
        await this.init(options.listener)

        const config: ExternalServiceConfig | undefined = <ExternalServiceConfig>this.serviceConfig
        const publishEvents: ExternalEvent[] = config?.publish || []
        const subscribeEvents: ExternalEvent[] = config?.subscribe || []
        if (!publishEvents.length && !subscribeEvents.length) {
            this.logger.info('No one external events to listen')

            return
        }

        const responseRoutingKeyPrefix: string | undefined = this.rabbitmqConfig.custom?.responseRoutingKeyPrefix
        const queueByEvent: Map<ExternalEvent, string> = new Map()

        publishEvents.forEach((externalEvent) => {
            queueByEvent.set(externalEvent, this.makeExternalResQueueName(externalEvent, responseRoutingKeyPrefix))
        })
        subscribeEvents.forEach((externalEvent) => {
            queueByEvent.set(externalEvent, this.makeExternalReqQueueName(externalEvent, responseRoutingKeyPrefix))
        })
        const bindTasks: Promise<void>[] = [...queueByEvent.entries()].map(([event, queueName]: [ExternalEvent, string]) =>
            this.bindQueueToExternalExchange(queueName, event, messageHandler),
        )

        await Promise.all(bindTasks)

        return true
    }

    async publishExternalDirect<T>(
        eventName: EventName,
        message: MessagePayload,
        topic?: ExternalTopic,
        options?: PublishOptions,
    ): Promise<T> {
        await this.init()

        const selectedTopic = topic ?? this.findTopicNameByEventName(eventName) ?? ExternalTopic.DirectRPC
        const exchangeName: string = this.prepareExternalTopicName(selectedTopic)
        const routingKey: string = this.prepareExternalReqRoutingKey(eventName)
        const headers = this.preparePublisherHeaders()

        return await this.publisher.publishToExchangeDirect({
            eventName,
            message,
            exchangeName,
            routingKey,
            headers,
            options,
        })
    }

    async publishExternal(eventName: ExternalEvent, message: MessagePayload, options?: PublishOptions): Promise<boolean> {
        const topicName: Topic = this.findTopicNameByEventName(eventName)
        if (!topicName) {
            this.logger.error(`Can't find external topic name for service [${this.serviceName}] and event [${eventName}]`)

            return false
        }

        await this.init()

        const headers = this.preparePublisherHeaders()

        const exchangeName: string = this.prepareExternalTopicName(topicName)
        if (this.externalPublishEventsSet.has(eventName)) {
            const routingKey: string = this.prepareExternalReqRoutingKey(eventName)

            const { responseRoutingKeyPrefix } = this.rabbitmqConfig.custom || {}
            const responseRoutingKey: string | undefined =
                responseRoutingKeyPrefix && this.makeExternalResQueueName(eventName, responseRoutingKeyPrefix)

            return await this.publisher.publishToExchange({
                eventName,
                message,
                exchangeName,
                routingKey,
                responseRoutingKey,
                headers,
                options,
            })
        }

        if (this.externalSubscribeEventsSet.has(eventName)) {
            const routingKey: string = this.prepareExternalResRoutingKey(eventName)

            return await this.publisher.publishToExchange({
                eventName,
                message,
                exchangeName,
                routingKey,
                headers,
                options,
            })
        }

        this.logger.error(`Can't find event in service config: [${eventName}]`)

        return false
    }

    getStatus(): RabbitMQStatus {
        return {
            listener: this.listener?.getStatus() || ConnectionStatus.Down,
            publisher: this.publisher?.getStatus() || ConnectionStatus.Down,
        }
    }

    private preparePublisherHeaders(): MessageHeaders {
        const logData = this.asyncLocalStorage?.getStore()?.logData ?? {}
        const traceId = logData?.traceId ?? v4()
        const serviceCode = logData?.serviceCode

        return { traceId, serviceCode }
    }

    private findTopicNameByEventName(eventName: EventName): Topic | undefined {
        return this.eventNameToTopicMap.get(eventName)
    }

    private async setListener(options?: ListenerOptions): Promise<AmqpListener> {
        if (!this.listener) {
            const connection: AmqpConnection = await this.getConnection(ConnectionClientType.Listener)

            this.listener = new AmqpListener(connection, this.logger, options)
            await this.listener.init()
        }

        return this.listener
    }

    private async setPublisher(): Promise<AmqpPublisher> {
        if (!this.publisher) {
            const connection: AmqpConnection = await this.getConnection(ConnectionClientType.Publisher)

            this.publisher = new AmqpPublisher(connection, this.logger)
            await this.publisher.init()
        }

        return this.publisher
    }

    private async getConnection(client: ConnectionClientType): Promise<AmqpConnection> {
        if (this.connectionList[client].lock) {
            return await this.connectionList[client].lock
        }

        const connection: AmqpConnection = new AmqpConnection(
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

        this.connectionList[client].lock = new Promise<AmqpConnection>((resolve: (c: AmqpConnection) => void) =>
            connection.connect().then(() => resolve(connection)),
        )

        return await this.connectionList[client].lock
    }

    private async checkAndBindToExchange(topic: string, queueName: string, routingKey?: string): Promise<void> {
        // eslint-disable-next-line no-async-promise-executor
        return await new Promise(async (resolve: () => void) => {
            // queue can't be bind to exchange when no exchange
            await this.publisher.checkExchange(topic)
            await this.listener.bindQueueToExchange(queueName, topic, routingKey)

            return resolve()
        })
    }

    private async bindQueueToExternalExchange(queueName: string, eventName: ExternalEvent, messageHandler: MessageHandler): Promise<void> {
        const topicName: Topic = this.findTopicNameByEventName(eventName)

        if (!topicName) {
            this.logger.error(`Can't find external topic name for service [${this.serviceName}] and event [${eventName}]`)

            return
        }

        const externalTopicName: string = this.prepareExternalTopicName(topicName)
        if (this.assertExternalExchanges) {
            await this.publisher.checkExchange(externalTopicName)
        }

        await this.listener.listenQueue(queueName, messageHandler)
        await this.listener.bindQueueToExchange(queueName, externalTopicName, queueName)
    }

    private makeQueueName(subscriptionName: string, options?: SubscribeOptions): string {
        let queueName: string = subscriptionName
        if (options && options.queueSuffix) {
            queueName = `${subscriptionName}_${options.queueSuffix}`
        }

        return queueName
    }

    private makeExternalResQueueName(eventName: EventName, prefix?: string): string {
        const result = `queue.${this.projectName}.${eventName}.res`
        if (prefix) {
            return `${prefix}.${result}`
        }

        return result
    }

    private makeExternalReqQueueName(eventName: ExternalEvent, prefix?: string): string {
        const result = `${this.prepareExternalQueuePrefix(eventName)}.${eventName}.req`
        if (prefix) {
            return `${prefix}.${result}`
        }

        return result
    }

    private prepareExternalTopicName(topicName: Topic): string {
        return `TopicExternal${topicName}`
    }

    private prepareExternalReqRoutingKey(eventName: string): string {
        return `queue.${this.projectName}.${eventName}.req`
    }

    private prepareExternalResRoutingKey(eventName: ExternalEvent): string {
        return `${this.prepareExternalQueuePrefix(eventName)}.${eventName}.res`
    }

    private prepareExternalQueuePrefix(event: ExternalEvent): string {
        if (
            [
                ExternalEvent.DocumentCovidCertificateProcessing,
                ExternalEvent.DocumentCovidCertificate,
                ExternalEvent.DocumentResidenceCertProcessing,
                ExternalEvent.DocumentResidenceCert,
                ExternalEvent.PublicServiceGetBanksByService,
                ExternalEvent.PublicServiceGetUserCardsByService,
                ExternalEvent.PublicServiceNewsAction,
                ExternalEvent.PublicServiceInvincibilityPointsRating,
                ExternalEvent.PublicServiceInvincibilityPointsReviews,
                ExternalEvent.PublicServiceInvincibilityPointsAllReviews,
            ].includes(event)
        ) {
            return `queue.${this.portalName}`
        }

        return `queue.${this.projectName}`
    }
}
