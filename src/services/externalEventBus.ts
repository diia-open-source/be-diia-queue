import Logger from '@diia-inhouse/diia-logger'
import { EnvService } from '@diia-inhouse/env'
import { ErrorType, ExternalCommunicatorError } from '@diia-inhouse/errors'
import { HttpStatusCode, OnInit } from '@diia-inhouse/types'

import constants from '../constants'
import {
    EventBusListener,
    ExchangeType,
    ExternalEventBusQueue,
    Message,
    MessageBrokerServiceEventsListener,
    MessagePayload,
    PublishDirectOptions,
    PublishExternalEventOptions,
    PublishOptions,
    PublishingResult,
    QueueMessageMetaData,
    QueueName,
    QueueTypes,
} from '../interfaces'
import { ExchangeName, ExchangeOptions, QueueOptions } from '../interfaces/messageBrokerServiceConfig'
import { EventName } from '../interfaces/queueConfig'
import { RabbitMQProvider } from '../providers/rabbitmq'
import Communicator from './communicator'
import { EventCommunicator } from './eventCommunicator'
import { EventMessageHandler } from './eventMessageHandler'

export class ExternalEventBus extends Communicator implements ExternalEventBusQueue, OnInit {
    private readonly eventCommunicator: EventCommunicator

    private readonly publishEventsSet: Set<EventName>

    private readonly subscribeEventsSet: Set<EventName>

    private readonly exchangePrefixName = 'TopicExternal'

    private readonly eventQueueMap: Map<EventName, QueueName> = new Map()

    constructor(
        logger: Logger,
        systemServiceName: string,
        private readonly envService: EnvService,
        queueProvider: RabbitMQProvider,
        externalEventListenerList: EventBusListener[],
        eventMessageHandler: EventMessageHandler,
        hostName: string,
    ) {
        super(logger, queueProvider, hostName, systemServiceName)

        const {
            rabbit: { custom },
            service: { publish = [], subscribe = [] },
        } = this.queueProvider.getConfig()

        if (custom?.responseRoutingKeyPrefix && !this.envService.isLocal() && !this.envService.isTest()) {
            throw new Error('Response routing key could be used only on local env')
        }

        this.publishEventsSet = new Set(publish)
        this.subscribeEventsSet = new Set(subscribe)

        this.eventQueueMap = this.buildEventQueueMap()

        this.eventCommunicator = new EventCommunicator(logger, queueProvider, eventMessageHandler, externalEventListenerList)
    }

    static BuildRequestRoutingKey(eventName: string): string {
        return `queue.${constants.PROJECT_NAME}.${eventName}.req`
    }

    static BuildResponseRoutingKey(eventName: EventName, portalEvents: string[] = []): string {
        const queuePrefix = ExternalEventBus.prepareQueuePrefix(eventName, portalEvents)

        return `${queuePrefix}.${eventName}.res`
    }

    private static prepareQueuePrefix(event: EventName, portalEvents: string[] = []): string {
        if (portalEvents.includes(event)) {
            return `queue.${constants.PORTAL_NAME}`
        }

        return `queue.${constants.PROJECT_NAME}`
    }

    async publish(eventName: EventName, payload: MessagePayload, options?: PublishOptions): Promise<PublishingResult> {
        const message = this.getPublishMessage(eventName, payload, options)

        const routingKey = this.getPublishRoutingKey(eventName)

        return await this.publishEventToExchange(eventName, message, { ...options, routingKey })
    }

    async publishDirect<T>(eventName: EventName, payload: MessagePayload, options: PublishDirectOptions = {}): Promise<T> {
        const { exchangeName: customExchangeName } = options

        const exchangeName = customExchangeName ?? this.eventNameToExchangeNameMap.get(eventName)
        if (!exchangeName) {
            throw new ExternalCommunicatorError(
                `Exchange name for event ${eventName} is not defined`,
                HttpStatusCode.INTERNAL_SERVER_ERROR,
                { event: eventName, customExchangeName },
                ErrorType.Unoperated,
            )
        }

        const routingKey: string = ExternalEventBus.BuildRequestRoutingKey(eventName)

        const { data } = this.getPublishMessage(eventName, payload, options)

        return await this.queueProvider.publishExternalDirect(data, exchangeName, routingKey, options)
    }

    protected getUnicastListeners(): MessageBrokerServiceEventsListener[] {
        return this.eventCommunicator.getUnicastListeners()
    }

    protected getExchangeNameWithSuffix(topic: ExchangeName): string {
        return `${this.exchangePrefixName}${topic}`
    }

    protected getProducerExchangesOptions(): ExchangeOptions[] {
        const [exchangesOptions] = this.defineQueuesAndExchangesOptionsBasedOnGlobalConfig()

        return exchangesOptions
    }

    protected override getMulticastListeners(): MessageBrokerServiceEventsListener[] {
        const [exchangesOptions, queuesOptions] = this.defineQueuesAndExchangesOptionsBasedOnGlobalConfig()

        return this.eventCommunicator.getMulticastListeners(queuesOptions, exchangesOptions, this.eventQueueMap)
    }

    private getPublishMessage(eventName: EventName, message: MessagePayload, options?: PublishExternalEventOptions): Message {
        const {
            rabbit: { custom: { responseRoutingKeyPrefix } = {} },
        } = this.queueProvider.getConfig()

        const responseRoutingKey = this.buildResponseQueueName(eventName, responseRoutingKeyPrefix)

        const partialMeta: Partial<QueueMessageMetaData> = {
            ignoreCache: options?.ignoreCache,
            registryApiVersion: options?.registryApiVersion,
            ...(this.publishEventsSet.has(eventName) ? { responseRoutingKey } : {}),
        }

        const data = this.getPublishQueueMessageData(eventName, message, partialMeta)

        return new Message(data)
    }

    private getPublishRoutingKey(eventName: string): string {
        if (this.publishEventsSet.has(eventName)) {
            return ExternalEventBus.BuildRequestRoutingKey(eventName)
        } else if (this.subscribeEventsSet.has(eventName)) {
            const { portalEvents } = this.queueProvider.getConfig()

            return ExternalEventBus.BuildResponseRoutingKey(eventName, portalEvents)
        }

        return ''
    }

    private defineQueuesAndExchangesOptionsBasedOnGlobalConfig(): [ExchangeOptions[], QueueOptions[]] {
        const {
            rabbit: {
                listenerOptions,
                declareOptions: { assertQueues, assertExchanges, queuesOptions: overriddenQueuesOptions = {} } = {},
            },
        } = this.queueProvider.getConfig()

        const queuesOptions: QueueOptions[] = []
        const exchangesMap: Map<ExchangeName, ExchangeOptions> = new Map()

        for (const [eventName, queueName] of this.eventQueueMap.entries()) {
            const exchangeName = this.eventNameToExchangeNameMap.get(eventName)

            if (!exchangeName) {
                this.logger.error(`Can't find external topic name for event [${eventName}]`)

                return [[], []]
            }

            const queueOptions: QueueOptions = {
                name: queueName,
                declare: assertQueues,
                type: QueueTypes.Quorum,
                options: listenerOptions?.queueOptions,
                bindTo: [
                    {
                        bind: assertQueues,
                        routingKey: queueName,
                        exchangeName: exchangeName,
                    },
                ],
                consumerOptions: this.optionsBuilder.defineConsumerOptionsBasedOnGlobalConfig(),
                ...overriddenQueuesOptions,
            }

            queuesOptions.push(queueOptions)

            const exchangeOptions: ExchangeOptions = {
                name: exchangeName,
                type: ExchangeType.Topic,
                declare: assertExchanges,
            }

            exchangesMap.set(exchangeName, exchangeOptions)
        }

        const exchangesOptions = [...exchangesMap.values()]

        return [exchangesOptions, queuesOptions]
    }

    private buildEventQueueMap(): Map<QueueName, EventName> {
        const eventQueueMap: Map<QueueName, EventName> = new Map()

        const {
            service: { publish = [], subscribe = [] },
            rabbit: { custom: { responseRoutingKeyPrefix } = {} },
        } = this.queueProvider.getConfig()

        if (publish.length === 0 && subscribe.length === 0) {
            this.logger.info('No one external events to listen')

            return eventQueueMap
        }

        for (const responseEvent of publish) {
            eventQueueMap.set(responseEvent, this.buildResponseQueueName(responseEvent, responseRoutingKeyPrefix))
        }

        for (const requestEvent of subscribe) {
            eventQueueMap.set(requestEvent, this.buildRequestQueueName(requestEvent, responseRoutingKeyPrefix))
        }

        return eventQueueMap
    }

    private buildResponseQueueName(eventName: EventName, prefix?: string): string {
        const result = `queue.${constants.PROJECT_NAME}.${eventName}.res`
        if (prefix) {
            return `${prefix}.${result}`
        }

        return result
    }

    private buildRequestQueueName(eventName: EventName, prefix?: string): string {
        const { portalEvents } = this.queueProvider.getConfig()

        const result = `${ExternalEventBus.prepareQueuePrefix(eventName, portalEvents)}.${eventName}.req`
        if (prefix) {
            return `${prefix}.${result}`
        }

        return result
    }
}
