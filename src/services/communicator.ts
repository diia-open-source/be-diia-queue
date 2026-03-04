import Logger from '@diia-inhouse/diia-logger'
import { InternalServerError } from '@diia-inhouse/errors'

import {
    BindOptions,
    ExchangeName,
    ExchangeOptions,
    Message,
    MessageBrokerServiceConfig,
    MessageBrokerServiceEventsListener,
    MessageBrokerServiceListener,
    MessageData,
    MessageHandler,
    MessagePayload,
    PublishOptions,
    PublishingResult,
    QueueMessageData,
    QueueMessageMetaData,
    QueueOptions,
} from '../interfaces'
import { EventName, QueueName } from '../interfaces/queueConfig'
import { RabbitMQProvider } from '../providers/rabbitmq'
import { getConsumerTag } from '../utils'
import OptionsBuilder from './optionsBuilder'

export default abstract class Communicator {
    protected readonly optionsBuilder: OptionsBuilder

    protected eventNameToExchangeNameMap: Map<EventName, ExchangeName> = new Map()

    private queueBindToMap: Map<QueueName, BindOptions[]> = new Map()

    private exchangesMap: Map<ExchangeName, ExchangeOptions> = new Map()

    private serviceConfig: MessageBrokerServiceConfig = {
        exchangesOptions: [],
        queuesOptions: [],
    }

    protected constructor(
        protected readonly logger: Logger,
        protected readonly queueProvider: RabbitMQProvider,
        protected readonly hostName: string,
        protected readonly systemServiceName: string,
    ) {
        const { queuesOptions = [] } = this.queueProvider.getMessageBrokerServiceConfig()
        for (const { name: queueName, bindTo } of queuesOptions) {
            this.queueBindToMap.set(queueName, bindTo)
        }

        this.optionsBuilder = new OptionsBuilder(this.queueProvider)
    }

    async onInit(): Promise<void> {
        await this.init()
    }

    async onDestroy(): Promise<void> {
        const { queuesOptions } = this.serviceConfig

        const queueNames = queuesOptions.map(({ name }) => name)

        await this.unsubscribeFromQueues(queueNames)
    }

    async subscribeToQueues(listeners: MessageBrokerServiceEventsListener[]): Promise<void> {
        for await (const listener of listeners) {
            const {
                eventNames,
                queueOptions: { name: queueName },
            } = listener

            try {
                // eslint-disable-next-line unicorn/consistent-destructuring
                await this.subscribe(queueName, listener.handler)

                this.logger.info(
                    `${this.constructor.name} service listener [${eventNames ? eventNames.join(' ') : queueName}] is initialized successfully`,
                )
            } catch (err) {
                this.logger.error(`Failed to initialize ${this.constructor.name} service`, { err })
                throw err
            }
        }
    }

    async subscribe(queueName: QueueName, messageHandler: MessageHandler): Promise<boolean> {
        return await this.queueProvider.subscribe(queueName, messageHandler)
    }

    async unsubscribeFromQueues(queueNames: string[]): Promise<void> {
        for await (const queueName of queueNames) {
            await this.unsubscribe(queueName)
        }
    }

    async unsubscribe(queueName: QueueName): Promise<void> {
        await this.queueProvider.unsubscribe(queueName)
    }

    async publishToQueue(queueName: QueueName, messageData: MessageData, options?: PublishOptions): Promise<PublishingResult> {
        const bindTo: BindOptions[] = [...(this.queueBindToMap.get(queueName) ?? [])]
        if (bindTo.length === 0) {
            const message = `Not found bind options for queue [${queueName}]`

            this.logger.error(message)

            throw new InternalServerError(message)
        }

        const queueMessageData = this.getPublishQueueMessageData(messageData.event, messageData.payload)

        for await (const bindOptions of bindTo) {
            const { exchangeName, routingKey } = bindOptions

            await this.queueProvider.publish(queueMessageData, exchangeName, routingKey, options)
        }
    }

    async publishToExchange(
        exchangeName: ExchangeName,
        routingKey: string,
        messageData: MessageData | Message,
        options?: PublishOptions,
    ): Promise<PublishingResult> {
        if (!this.exchangesMap.has(exchangeName)) {
            const message = `Not found exchange [${exchangeName}]`

            this.logger.error(message)

            throw new InternalServerError(message)
        }

        const message =
            messageData instanceof Message ? messageData.data : this.getPublishQueueMessageData(messageData.event, messageData.payload)

        return await this.queueProvider.publish(message, exchangeName, routingKey, options)
    }

    async publishEventToExchange(
        eventName: EventName,
        payload: MessagePayload | Message,
        options?: PublishOptions,
    ): Promise<PublishingResult> {
        const exchangeName = this.eventNameToExchangeNameMap.get(eventName)
        if (!exchangeName) {
            const message = `Exchange for event [${eventName}] is not defined`

            this.logger.error(message)

            throw new InternalServerError(message)
        }

        const { routingKey, ...opts } = options || {}

        const message = payload instanceof Message ? payload.data : this.getPublishQueueMessageData(eventName, payload)

        return await this.queueProvider.publish(message, exchangeName, routingKey, opts)
    }

    getPublishQueueMessageData(
        eventName: EventName,
        message: MessagePayload,
        partialMeta?: Partial<QueueMessageMetaData>,
    ): QueueMessageData {
        const meta: QueueMessageMetaData = {
            date: new Date(),
            ...partialMeta,
        }

        return {
            meta,
            event: eventName,
            payload: message,
        }
    }

    protected async init(): Promise<MessageBrokerServiceConfig> {
        this.buildEventNameToExchangeNameMap()

        const { rabbit: { consumerEnabled } = {} } = this.queueProvider.getConfig()

        const producerExchangesOptions = this.getProducerExchangesOptions()
        const listeners = consumerEnabled === false ? [] : [...this.getMulticastListeners(), ...this.getUnicastListeners()]

        const serviceConfig = this.getServiceConfig(listeners, producerExchangesOptions)

        this.serviceConfig = serviceConfig

        const { exchangesOptions } = serviceConfig

        this.buildExchangesMap(exchangesOptions)

        await this.queueProvider.init(serviceConfig)

        await this.subscribeToQueues(listeners)

        return serviceConfig
    }

    private buildExchangesMap(exchangesOptions: ExchangeOptions[]): void {
        for (const exchangeOptions of exchangesOptions) {
            const { name } = exchangeOptions

            this.exchangesMap.set(name, exchangeOptions)
        }
    }

    private buildEventNameToExchangeNameMap(): void {
        const { topics } = this.queueProvider.getConfig()

        for (const topic in topics) {
            const { events } = topics[topic]

            const exchangeName = this.getExchangeNameWithSuffix(topic)

            for (const eventName of events) {
                this.eventNameToExchangeNameMap.set(eventName, exchangeName)
            }
        }
    }

    private getServiceConfig(
        listeners: MessageBrokerServiceListener[],
        implicitExchangesOptions: ExchangeOptions[] = [],
    ): MessageBrokerServiceConfig {
        const { queuesOptions, exchangesOptions } = this.unifyServiceConfig(listeners, implicitExchangesOptions)

        return {
            exchangesOptions,
            queuesOptions: queuesOptions.map((queueOptions) => this.enrichQueueConsumerOptions(queueOptions)),
        }
    }

    private unifyServiceConfig(
        listeners: MessageBrokerServiceListener[],
        implicitExchangesOptions: ExchangeOptions[] = [],
    ): MessageBrokerServiceConfig {
        const queuesMap: Map<QueueName, QueueOptions> = new Map()
        const exchangesMap: Map<ExchangeName, ExchangeOptions> = new Map()

        for (const listener of listeners) {
            const { queueOptions, exchangesOptions } = listener

            queuesMap.set(queueOptions.name, queueOptions)

            for (const exchangeOptions of exchangesOptions) {
                exchangesMap.set(exchangeOptions.name, exchangeOptions)
            }
        }

        const { queuesOptions, exchangesOptions: explicitExchangesOptions } = this.queueProvider.getMessageBrokerServiceConfig()

        for (const queueOpts of queuesOptions) {
            if (!queuesMap.has(queueOpts.name)) {
                queuesMap.set(queueOpts.name, queueOpts)
            }
        }

        for (const exchangeOpts of [...explicitExchangesOptions, ...implicitExchangesOptions]) {
            if (!exchangesMap.has(exchangeOpts.name)) {
                exchangesMap.set(exchangeOpts.name, exchangeOpts)
            }
        }

        return {
            queuesOptions: [...queuesMap.values()],
            exchangesOptions: [...exchangesMap.values()],
        }
    }

    private enrichQueueConsumerOptions(queueOptions: QueueOptions): QueueOptions {
        const { prefetchCount: globalPrefetchCount } = this.optionsBuilder.defineConsumerOptionsBasedOnGlobalConfig()

        const {
            prefetchCount = globalPrefetchCount,
            consumerTag = getConsumerTag(this.systemServiceName, this.hostName),
            ...consumerOptions
        } = queueOptions.consumerOptions || {}

        return {
            ...queueOptions,
            consumerOptions: {
                ...consumerOptions,
                consumerTag,
                prefetchCount,
            },
        }
    }

    /**
     * Gets global exchanges options.
     * This method must be overridden by subclasses to provide a more specific implementation.
     * @virtual
     */
    protected abstract getProducerExchangesOptions(): ExchangeOptions[]

    /**
     * Gets unicast event listeners.
     * This method must be overridden by subclasses to provide a more specific implementation.
     * @virtual
     */
    protected abstract getUnicastListeners(): MessageBrokerServiceEventsListener[]

    /**
     * Gets multicast event listeners.
     * This method must be overridden by subclasses to provide a more specific implementation.
     * @virtual
     */
    protected abstract getMulticastListeners(): MessageBrokerServiceEventsListener[]

    /**
     * Gets an exchange name related to a service.
     * This method must be overridden by subclasses to provide a more specific implementation.
     * @virtual
     */
    protected abstract getExchangeNameWithSuffix(exchangeName: ExchangeName): string
}
