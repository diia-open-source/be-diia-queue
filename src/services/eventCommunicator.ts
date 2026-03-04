import _ from 'lodash'

import Logger from '@diia-inhouse/diia-logger'

import {
    BindOptions,
    EventBusListener,
    EventName,
    ExchangeName,
    ExchangeOptions,
    MessageBrokerServiceEventsListener,
    MessageBrokerServiceListener,
    QueueName,
    QueueOptions,
} from '../interfaces'
import { RabbitMQProvider } from '../providers'
import * as Utils from '../utils'
import { EventMessageHandler } from './eventMessageHandler'

export class EventCommunicator {
    constructor(
        private readonly logger: Logger,
        private readonly queueProvider: RabbitMQProvider,
        private readonly eventMessageHandler: EventMessageHandler,
        protected readonly listenerList: EventBusListener[] = [],
    ) {}

    getMulticastListeners(
        queuesOptions: QueueOptions[],
        exchangesOptions: ExchangeOptions[],
        eventQueueMap: Map<EventName, QueueName> = new Map(),
    ): MessageBrokerServiceEventsListener[] {
        const eventListeners = Utils.collectEventBusListeners(this.listenerList)
        const eventsHandler = this.eventMessageHandler.eventListenersMessageHandler.bind(this.eventMessageHandler, eventListeners)

        const listeners: MessageBrokerServiceListener[] = []

        for (const queueOptions of queuesOptions) {
            const { name: queueName } = queueOptions

            const eventNames = this.defineEventNamesByQueueName(queueName, eventQueueMap)

            const listener: MessageBrokerServiceEventsListener = {
                eventNames,
                queueOptions,
                exchangesOptions,
                handler: eventsHandler,
            }

            listeners.push(listener)
        }

        return listeners
    }

    getUnicastListeners(): MessageBrokerServiceEventsListener[] {
        const listeners: MessageBrokerServiceEventsListener[] = []

        const { queuesOptions, exchangesOptions } = this.queueProvider.getMessageBrokerServiceConfig()

        const queuesOptionsMap = _.keyBy<QueueOptions>(queuesOptions, 'name')
        const exchangesOptionsMap = _.keyBy<ExchangeOptions>(exchangesOptions, 'name')

        for (const eventListener of this.listenerList) {
            const { queueNames = [] } = eventListener

            for (const queueName of queueNames) {
                const queueOptions = queuesOptionsMap[queueName]
                if (!queueOptions) {
                    this.logger.error(`Not found queue options by name (${queueName}) for ${this.constructor.name} service`)
                    continue
                }

                const exchangesOptions = this.defineConsumerExchangesOptions(queueName, queueOptions.bindTo, exchangesOptionsMap)

                const eventMessageHandler = this.eventMessageHandler.eventListenerMessageHandler.bind(
                    this.eventMessageHandler,
                    eventListener,
                )

                const listener: MessageBrokerServiceListener = {
                    queueOptions,
                    exchangesOptions,
                    handler: eventMessageHandler,
                }

                listeners.push(listener)
            }
        }

        return listeners
    }

    private defineConsumerExchangesOptions(
        queueName: string,
        bindTo: BindOptions[] = [],
        exchangesMap: Record<ExchangeName, ExchangeOptions> = {},
    ): ExchangeOptions[] {
        const exchangesOptions: ExchangeOptions[] = []

        for (const bindOptions of bindTo) {
            const { exchangeName } = bindOptions

            const exchangeOptions = exchangesMap[exchangeName]
            if (!exchangeOptions) {
                this.logger.error(`Not found exchange options by name (${exchangeName}) for ${this.constructor.name} service`)
                continue
            }

            exchangesOptions.push(exchangeOptions)
        }

        if (exchangesOptions.length === 0) {
            this.logger.error(`Not found exchanges options for queue (${queueName}) for ${this.constructor.name} service`)
        }

        return exchangesOptions
    }

    private defineEventNamesByQueueName(queueName: QueueName, eventQueueMap: Map<EventName, QueueName>): EventName[] {
        if (eventQueueMap.size === 0) {
            return this.listenerList.map(({ event }) => event)
        }

        const eventNames: EventName[] = []

        for (const [eventName, eventQueueName] of eventQueueMap) {
            if (eventQueueName === queueName) {
                eventNames.push(eventName)
            }
        }

        return eventNames
    }
}
