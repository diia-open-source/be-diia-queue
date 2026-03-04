import { ExchangeName, MessageBrokerServicesConfig } from '../messageBrokerServiceConfig'

export type EventName = string

export type QueueName = string

export enum QueueConfigType {
    Internal = 'internal',
    External = 'external',
}

export interface InternalServiceConfig {
    subscribe?: QueueName[]
    publish?: ExchangeName[]
}

export interface ExternalServiceConfig {
    /**
     * add an event to this field only in cases when you don't need to await a response to an event;
     * in other cases, use the *receiveDirect* mechanism
     * */
    publish?: EventName[]
    subscribe: EventName[]
}

export type ServiceConfigByConfigType = InternalServiceConfig | ExternalServiceConfig

export interface ServiceConfig {
    /**
     * @deprecated no need to set the internal service queues config, because it is used nowhere.
     * it should be deleted from a service config
     * */
    [QueueConfigType.Internal]?: InternalServiceConfig
    [QueueConfigType.External]?: ExternalServiceConfig
}

export type QueueConfigByQueueName = {
    [k in QueueName]: {
        topics: ExchangeName[]
    }
}

export type QueueConfig = Record<QueueConfigType.Internal, QueueConfigByQueueName>

export type TopicConfigByConfigType = {
    [k in ExchangeName]: {
        events: EventName[]
    }
}

export type TopicConfig = Record<QueueConfigType, TopicConfigByConfigType>

export type ServiceRulesConfig = {
    topicsConfig: TopicConfig
    queuesConfig: QueueConfig
    portalEvents?: EventName[]
    servicesConfig?: ServiceConfig
    messageBrokerServices?: MessageBrokerServicesConfig
}
