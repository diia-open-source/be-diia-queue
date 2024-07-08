export type EventName = string

export type QueueName = string

export type Topic = string

export enum QueueConfigType {
    Internal = 'internal',
    External = 'external',
}

export interface InternalServiceConfig {
    subscribe?: QueueName[]
    publish?: Topic[]
}

export interface ExternalServiceConfig {
    publish: EventName[]
    subscribe: EventName[]
}

export type ServiceConfigByConfigType = InternalServiceConfig | ExternalServiceConfig

export interface ServiceConfig {
    [QueueConfigType.Internal]: InternalServiceConfig
    [QueueConfigType.External]: ExternalServiceConfig
}

export type QueueConfigByQueueName = {
    [k in QueueName]?: {
        topics: Topic[]
    }
}

export type QueueConfig = Record<QueueConfigType.Internal, QueueConfigByQueueName>

export type TopicConfigByConfigType = {
    [k in Topic]?: {
        events: EventName[]
    }
}

export type TopicConfig = Record<QueueConfigType, TopicConfigByConfigType>

export type ServiceRulesConfig = {
    servicesConfig: ServiceConfig
    topicsConfig: TopicConfig
    queuesConfig: QueueConfig
    portalEvents: EventName[]
    internalEvents: EventName[]
}
