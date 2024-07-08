import { type AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'

import { isEmpty, merge } from 'lodash'
import pTimeout from 'p-timeout'

import { Logger } from '@diia-inhouse/types'

import { MessageHandler } from '../../interfaces/messageHandler'
import {
    ListenerOptions,
    PublishDirectOptions,
    PublishExternalEventOptions,
    PublishInternalEventOptions,
    SubscribeOptions,
} from '../../interfaces/options'
import { ConnectionClientType, ConnectionList, ConnectionStatus, RabbitMQConfig, RabbitMQStatus } from '../../interfaces/providers/rabbitmq'
import { ExchangeType, MessageHeaders, MessagePayload, PublishToExchangeParams } from '../../interfaces/providers/rabbitmq/amqpPublisher'
import {
    EventName,
    ExternalServiceConfig,
    InternalServiceConfig,
    QueueConfigByQueueName,
    QueueConfigType,
    QueueName,
    ServiceConfigByConfigType,
    Topic,
    TopicConfigByConfigType,
} from '../../interfaces/queueConfig'
import { QueueContext } from '../../interfaces/queueContext'

import { AmqpConnection } from './amqpConnection'
import { AmqpListener } from './amqpListener'
import { AmqpPublisher } from './amqpPublisher'

// eslint-disable-next-line unicorn/prefer-event-target
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

    private externalPublishEventsSet: Set<EventName>

    private externalSubscribeEventsSet: Set<EventName>

    private assertExternalExchanges?: boolean

    constructor(
        private readonly serviceName: string,
        private readonly rabbitmqConfig: RabbitMQConfig,
        private readonly serviceConfig: ServiceConfigByConfigType,
        private readonly topicsConfig: TopicConfigByConfigType,
        private readonly portalEvents: EventName[],
        private readonly internalEvents: EventName[],
        private readonly type: QueueConfigType,
        private readonly logger: Logger,
        private readonly asyncLocalStorage?: AsyncLocalStorage<QueueContext>,
        private readonly queuesConfig?: QueueConfigByQueueName,
    ) {
        super()

        for (const topicName of Object.keys(this.topicsConfig)) {
            for (const eventName of this.topicsConfig[topicName].events) {
                this.eventNameToTopicMap.set(eventName, topicName)
            }
        }

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

    async subscribe(subscriptionName: QueueName, messageHandler: MessageHandler, options?: SubscribeOptions): Promise<boolean> {
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
            this.queuesConfig[subscriptionName].topics.map((topic: Topic) => this.checkAndBindToExchange(topic, queueName, routingKey)),
        )

        return true
    }

    async publish(eventName: EventName, message: MessagePayload, options?: PublishInternalEventOptions): Promise<boolean> {
        if (!this.internalEvents.includes(eventName)) {
            this.logger.error(`Event [${eventName}] is not implemented`)

            return false
        }

        const exchangeName: Topic = <Topic>this.findTopicNameByEventName(eventName)
        if (!exchangeName) {
            this.logger.error(`Can't find topic name by event [${eventName}]`)

            return false
        }

        if (!(<InternalServiceConfig>this.serviceConfig).publish?.includes(exchangeName)) {
            this.logger.error(`Event [${eventName}] is not allowed to publish by service [${this.serviceName}]`)

            return false
        }

        const { publishTimeout = Infinity, throwOnPublishTimeout = true, routingKey } = options || {}

        // eslint-disable-next-line no-async-promise-executor
        const publishTask = new Promise<boolean>(async (resolve, reject) => {
            try {
                await this.init()
            } catch (err) {
                return reject(err)
            }

            try {
                await this.publisher.checkExchange(exchangeName)
            } catch {
                return resolve(false)
            }

            try {
                const publishResult = await this.publisher.publishToExchange({
                    eventName,
                    message,
                    exchangeName,
                    routingKey,
                    headers: this.preparePublisherHeaders(),
                })

                return resolve(publishResult)
            } catch (err) {
                return reject(err)
            }
        })

        const timeoutMsg = `Internal event [${eventName}] publish timeout exceed`

        if (throwOnPublishTimeout) {
            return await pTimeout(publishTask, publishTimeout, timeoutMsg)
        }

        return await pTimeout(publishTask, publishTimeout, () => {
            this.logger.error(timeoutMsg, { publishTimeout })

            return false
        })
    }

    async subscribeTask(queueName: string, messageHandler: MessageHandler, options: SubscribeOptions = {}): Promise<boolean> {
        const { listener, delayed } = options

        this.logger.info('Subscribing to the task', { queueName, options })

        await this.init(listener)

        await this.listener.listenQueue(queueName, messageHandler)
        await (delayed
            ? this.publisher.checkExchange(queueName, ExchangeType.XDelayedMessage, {
                  arguments: { 'x-delayed-type': this.publisher.defaultExchangeType },
              })
            : this.publisher.checkExchange(queueName))

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
        const publishEvents: EventName[] = config?.publish || []
        const subscribeEvents: EventName[] = config?.subscribe || []
        if (publishEvents.length === 0 && subscribeEvents.length === 0) {
            this.logger.info('No one external events to listen')

            return
        }

        const responseRoutingKeyPrefix: string | undefined = this.rabbitmqConfig.custom?.responseRoutingKeyPrefix
        const queueByEvent: Map<EventName, string> = new Map()

        for (const externalEvent of publishEvents) {
            queueByEvent.set(externalEvent, this.makeExternalResQueueName(externalEvent, responseRoutingKeyPrefix))
        }

        for (const externalEvent of subscribeEvents) {
            queueByEvent.set(externalEvent, this.makeExternalReqQueueName(externalEvent, responseRoutingKeyPrefix))
        }

        const bindTasks: Promise<void>[] = [...queueByEvent.entries()].map(([event, queueName]: [EventName, string]) =>
            this.bindQueueToExternalExchange(queueName, event, messageHandler),
        )

        await Promise.all(bindTasks)

        return true
    }

    async publishExternalDirect<T>(
        eventName: EventName,
        message: MessagePayload,
        topic?: Topic,
        options?: PublishDirectOptions,
    ): Promise<T> {
        await this.init()

        const selectedTopic = topic ?? this.findTopicNameByEventName(eventName) ?? 'DirectRPC'
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

    async publishExternal(eventName: EventName, message: MessagePayload, options?: PublishExternalEventOptions): Promise<boolean> {
        const topicName: Topic = this.findTopicNameByEventName(eventName)
        if (!topicName) {
            this.logger.error(`Can't find external topic name for service [${this.serviceName}] and event [${eventName}]`)

            return false
        }

        const { publishTimeout = Infinity, throwOnPublishTimeout = true } = options || {}

        // eslint-disable-next-line no-async-promise-executor
        const publishTask = new Promise<boolean>(async (resolve, reject) => {
            try {
                await this.init()
            } catch (err) {
                return reject(err)
            }

            const headers = this.preparePublisherHeaders()
            const exchangeName = this.prepareExternalTopicName(topicName)

            const publishToExchangeParams: PublishToExchangeParams = {
                eventName,
                message,
                exchangeName,
                headers,
                options,
            }

            if (this.externalPublishEventsSet.has(eventName)) {
                const { responseRoutingKeyPrefix } = this.rabbitmqConfig.custom || {}

                publishToExchangeParams.routingKey = this.prepareExternalReqRoutingKey(eventName)
                publishToExchangeParams.responseRoutingKey =
                    responseRoutingKeyPrefix && this.makeExternalResQueueName(eventName, responseRoutingKeyPrefix)
            } else if (this.externalSubscribeEventsSet.has(eventName)) {
                publishToExchangeParams.routingKey = this.prepareExternalResRoutingKey(eventName)
            } else {
                this.logger.error(`Can't find event in service config: [${eventName}]`)

                return resolve(false)
            }

            try {
                const publishResult = await this.publisher.publishToExchange(publishToExchangeParams)

                return resolve(publishResult)
            } catch (err) {
                return reject(err)
            }
        })

        const timeoutMsg = `External event [${eventName}] publish timeout exceed`

        if (throwOnPublishTimeout) {
            return await pTimeout(publishTask, publishTimeout, timeoutMsg)
        }

        return await pTimeout(publishTask, publishTimeout, () => {
            this.logger.error(timeoutMsg, { publishTimeout })

            return false
        })
    }

    getStatus(): RabbitMQStatus {
        return {
            listener: this.listener?.getStatus() || ConnectionStatus.Down,
            publisher: this.publisher?.getStatus() || ConnectionStatus.Down,
        }
    }

    private preparePublisherHeaders(): MessageHeaders {
        const logData = this.asyncLocalStorage?.getStore()?.logData ?? {}
        const traceId = logData?.traceId ?? randomUUID()
        const serviceCode = logData?.serviceCode

        return { traceId, serviceCode }
    }

    private findTopicNameByEventName(eventName: EventName): Topic | undefined {
        return this.eventNameToTopicMap.get(eventName)
    }

    private async setListener(options: ListenerOptions = {}): Promise<AmqpListener> {
        options.queueOptions ??= this.rabbitmqConfig.listenerOptions?.queueOptions
        if (!this.listener) {
            const connection = await this.getConnection(ConnectionClientType.Listener)

            this.listener = new AmqpListener(connection, this.logger, options)
            await this.listener.init()
        }

        return this.listener
    }

    private async setPublisher(): Promise<AmqpPublisher> {
        if (!this.publisher) {
            const connection = await this.getConnection(ConnectionClientType.Publisher)

            this.publisher = new AmqpPublisher(connection, this.logger)
            await this.publisher.init()
        }

        return this.publisher
    }

    private async getConnection(client: ConnectionClientType): Promise<AmqpConnection> {
        if (this.connectionList[client].lock) {
            return await this.connectionList[client].lock
        }

        const connection = new AmqpConnection(
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

    private async bindQueueToExternalExchange(queueName: string, eventName: EventName, messageHandler: MessageHandler): Promise<void> {
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

    private makeExternalReqQueueName(eventName: EventName, prefix?: string): string {
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

    private prepareExternalResRoutingKey(eventName: EventName): string {
        return `${this.prepareExternalQueuePrefix(eventName)}.${eventName}.res`
    }

    private prepareExternalQueuePrefix(event: EventName): string {
        if (this.portalEvents.includes(event)) {
            return `queue.${this.portalName}`
        }

        return `queue.${this.projectName}`
    }
}
