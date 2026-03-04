import { Options } from 'amqplib'

interface BaseBindOptions {
    exchangeName: string
    routingKey?: string
}

export interface BindOptions extends BaseBindOptions {
    bind?: boolean
}

export interface UnbindOptions extends BaseBindOptions {
    unbind?: boolean
}

export interface RecreateChannelOptions {
    timeout?: number
    maxTries?: number
    backoffCoefficient?: number
}

export interface ConsumerOptions {
    consumerTag?: string
    prefetchCount?: number
    recreateChannelOptions?: RecreateChannelOptions
}

export type ExchangeName = string

export enum ExchangeType {
    Direct = 'direct',
    Fanout = 'fanout',
    Topic = 'topic',
    Headers = 'headers',
    /**
     * @deprecated the RabbitMQ plugin that supports delayed messages is deprecated and should be removed in the future
     */
    XDelayedMessage = 'x-delayed-message',
}

export interface ExchangeOptions {
    name: ExchangeName
    type?: ExchangeType
    declare?: boolean
    /**
     * @deprecated the RabbitMQ plugin that supports delayed messages is deprecated and should be removed in the future
     */
    delayed?: boolean
    options?: Options.AssertExchange
    bindTo?: BindOptions[]
}

export const MessageBrokerExternalServiceTypes = ['externalEventBus'] as const

export type MessageBrokerExternalServiceType = (typeof MessageBrokerExternalServiceTypes)[number]

export const MessageBrokerInternalServiceTypes = ['task', 'eventBus', 'scheduledTask'] as const

export type MessageBrokerInternalServiceType = (typeof MessageBrokerInternalServiceTypes)[number]

export const MessageBrokerGeneralServiceTypes = ['general'] as const

export type MessageBrokerGeneralServiceType = (typeof MessageBrokerGeneralServiceTypes)[number]

export type MessageBrokerServiceType = MessageBrokerExternalServiceType | MessageBrokerInternalServiceType | MessageBrokerGeneralServiceType

export interface MessageBrokerServiceConfig {
    queuesOptions: QueueOptions[]
    exchangesOptions: ExchangeOptions[]
}

export const emptyMessageBrokerServiceConfig: MessageBrokerServiceConfig = {
    queuesOptions: [],
    exchangesOptions: [],
}

export type MessageBrokerServicesConfig = {
    [k in MessageBrokerServiceType]?: MessageBrokerServiceConfig
}

export const QueueTypes = {
    Quorum: 'quorum',
    Classic: 'classic',
} as const

type QueueType = (typeof QueueTypes)[keyof typeof QueueTypes]

export interface BaseQueueOptions {
    type?: QueueType
    options?: Options.AssertQueue
}

export interface RedeclareQueueOptions extends BaseQueueOptions {
    redeclare?: boolean
}

export interface QueueOptions extends BaseQueueOptions {
    name: string
    declare?: boolean
    bindTo: BindOptions[]
    unbindFrom?: UnbindOptions[]
    consumerOptions?: ConsumerOptions
    redeclareOptions?: RedeclareQueueOptions
}
