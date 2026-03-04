import _ from 'lodash'

import Logger from '@diia-inhouse/diia-logger'
import { OnInit } from '@diia-inhouse/types'

import constants from '../constants'
import {
    ExchangeName,
    MessageBrokerServiceEventsListener,
    MessageBrokerServiceListener,
    MessageData,
    MessageHandler,
    MessagePayload,
    PublishingResult,
    QueueTypes,
    TaskListener,
    TaskQueue,
} from '../interfaces'
import { BindOptions, ConsumerOptions, ExchangeOptions, QueueOptions } from '../interfaces/messageBrokerServiceConfig'
import { RabbitMQProvider } from '../providers/rabbitmq'
import Communicator from './communicator'
import { EventMessageHandler } from './eventMessageHandler'

export class Task extends Communicator implements TaskQueue, OnInit {
    private queueNamePrefix = 'TasksQueue'

    private taskNameExchangesOptionsMap: Map<string, ExchangeOptions[]> = new Map()

    constructor(
        private readonly serviceName: string,
        systemServiceName: string,
        queueProvider: RabbitMQProvider,
        private readonly taskList: TaskListener[],
        private readonly eventMessageHandler: EventMessageHandler,
        logger: Logger,
        hostName: string,
    ) {
        super(logger, queueProvider, hostName, systemServiceName)
    }

    async onInit(): Promise<void> {
        const { queuesOptions, exchangesOptions } = await this.init()

        const queuesOptionsMap = _.keyBy<QueueOptions>(queuesOptions, 'name')
        const exchangesOptionsMap = _.keyBy<ExchangeOptions>(exchangesOptions, 'name')

        for (const task of this.taskList) {
            const { name: taskName, isDelayed = false, queueNames = [] } = task

            if (queueNames.length === 0) {
                const queueName = this.defineQueueNameByTaskName(taskName, isDelayed, queuesOptionsMap, exchangesOptionsMap)

                queueNames.push(queueName)
            }

            const exchangesOptions: ExchangeOptions[] = []

            for (const queueName of queueNames) {
                const queueOptions = queuesOptionsMap[queueName]
                if (!queueOptions) {
                    this.logger.error(`Not found queue options by name (${queueName}) for task service`)
                    continue
                }

                const { bindTo } = queueOptions

                const options = this.defineExchangesOptions(queueName, isDelayed, bindTo, exchangesOptionsMap)

                exchangesOptions.push(...options)
            }

            this.taskNameExchangesOptionsMap.set(taskName, exchangesOptions)
        }
    }

    async publish(taskName: string, payload: MessagePayload, delay?: number): Promise<PublishingResult> {
        const exchangesOptions = this.taskNameExchangesOptionsMap.get(taskName)
        if (!exchangesOptions || exchangesOptions.length === 0) {
            throw new Error(`Not found task [${taskName}] exchanges options`)
        }

        for await (const exchangeOptions of exchangesOptions) {
            const { name: exchangeName, delayed } = exchangeOptions

            if (delay && !delayed) {
                const logMessage = 'Delay option could be used only with delayed tasks'

                this.logger.error(logMessage, { exchangeName, taskName })
                throw new Error(logMessage)
            }

            const message: MessageData = {
                payload,
                event: this.getQueueName(taskName),
            }

            await this.publishToExchange(exchangeName, constants.DEFAULT_ROUTING_KEY, message, { delay })
        }
    }

    protected getProducerExchangesOptions(): ExchangeOptions[] {
        return []
    }

    protected getMulticastListeners(): MessageBrokerServiceListener[] {
        return []
    }

    protected getUnicastListeners(): MessageBrokerServiceListener[] {
        const listeners: MessageBrokerServiceEventsListener[] = []

        const { queuesOptions, exchangesOptions } = this.queueProvider.getMessageBrokerServiceConfig()

        const queuesOptionsMap = _.keyBy<QueueOptions>(queuesOptions, 'name')
        const exchangesOptionsMap = _.keyBy<ExchangeOptions>(exchangesOptions, 'name')

        for (const task of this.taskList) {
            const { queueNames = [], name: taskName, isDelayed = false } = task

            if (queueNames.length === 0) {
                const queueName = this.defineQueueNameByTaskName(taskName, isDelayed, queuesOptionsMap, exchangesOptionsMap)

                queueNames.push(queueName)
            }

            for (const queueName of queueNames) {
                const queueOptions = queuesOptionsMap[queueName]
                if (!queueOptions) {
                    this.logger.error(`Not found queue options by name (${queueName}) for ${this.constructor.name} service`)
                    continue
                }

                const exchangesOptions = this.defineExchangesOptions(queueName, isDelayed, queueOptions.bindTo, exchangesOptionsMap)

                const handler: MessageHandler = this.eventMessageHandler.eventListenerMessageHandler.bind(this.eventMessageHandler, task)

                const listener: MessageBrokerServiceListener = {
                    handler,
                    queueOptions,
                    exchangesOptions,
                }

                listeners.push(listener)
            }
        }

        return listeners
    }

    protected getExchangeNameWithSuffix(taskName: string): string {
        return this.getQueueName(taskName)
    }

    private defineExchangesOptions(
        queueName: string,
        isExchangeDelayed = false,
        bindTo: BindOptions[] = [],
        exchangesMap: Record<ExchangeName, ExchangeOptions> = {},
    ): ExchangeOptions[] {
        const exchangesOptions: ExchangeOptions[] = []

        for (const bindOptions of bindTo) {
            const { exchangeName } = bindOptions

            const exchangeOptions = exchangesMap[exchangeName]
            if (!exchangeOptions) {
                this.logger.error(`Not found exchange options by name (${exchangeName}) for task service`)
                continue
            }

            exchangesOptions.push(exchangeOptions)
        }

        if (exchangesOptions.length === 0) {
            const globalExchangesOptions = this.defineExchangesOptionsBasedOnGlobalConfig(queueName, isExchangeDelayed)

            exchangesOptions.push(...globalExchangesOptions)
        }

        return exchangesOptions
    }

    private defineQueueOptionsBasedOnGlobalConfig(queueName: string): QueueOptions {
        const {
            rabbit: {
                listenerOptions: { queueOptions } = {},
                declareOptions: { assertQueues, queuesOptions: overrideQueueOptions = {} } = {},
            },
        } = this.queueProvider.getConfig()

        const bindTo: BindOptions[] = [
            {
                bind: assertQueues,
                exchangeName: queueName,
                routingKey: constants.DEFAULT_ROUTING_KEY,
            },
        ]

        return {
            bindTo,
            name: queueName,
            declare: assertQueues,
            options: queueOptions,
            type: QueueTypes.Quorum,
            consumerOptions: this.defineConsumerOptionsBasedOnGlobalConfig(),
            ...overrideQueueOptions,
        }
    }

    private defineExchangesOptionsBasedOnGlobalConfig(exchangeName: string, isExchangeDelayed = false): ExchangeOptions[] {
        const {
            rabbit: { declareOptions: { assertExchanges } = {} },
        } = this.queueProvider.getConfig()

        return [
            {
                name: exchangeName,
                declare: assertExchanges,
                delayed: isExchangeDelayed,
            },
        ]
    }

    private defineConsumerOptionsBasedOnGlobalConfig(): ConsumerOptions {
        const {
            rabbit: { listenerOptions: { prefetchCount } = {} },
        } = this.queueProvider.getConfig()

        return {
            prefetchCount,
        }
    }

    private getQueueName(taskName: string): string {
        if (taskName.includes(this.queueNamePrefix)) {
            return taskName
        }

        return `${this.queueNamePrefix}${this.capitalizeFirstLetter(this.serviceName)}[${taskName}]`
    }

    private capitalizeFirstLetter(s: string): string {
        return s
            .split('-')
            .map((str: string) => str.charAt(0).toUpperCase() + str.slice(1))
            .join('')
    }

    private defineQueueNameByTaskName(
        taskName: string,
        isDelayed: boolean,
        queuesOptionsMap: Record<string, QueueOptions>,
        exchangesOptionsMap: Record<string, ExchangeOptions>,
    ): string {
        const queueName = this.getQueueName(taskName)

        queuesOptionsMap[queueName] = this.defineQueueOptionsBasedOnGlobalConfig(queueName)

        const [exchangeOptions] = this.defineExchangesOptionsBasedOnGlobalConfig(queueName, isDelayed)

        exchangesOptionsMap[exchangeOptions.name] = exchangeOptions

        return queueName
    }
}
