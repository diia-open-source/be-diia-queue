import { EventName, ExternalEvent } from './events'
import { QueueName } from './queues'
import { InternalTopic, Topic } from './topics'

export enum QueueConfigType {
    Internal = 'internal',
    External = 'external',
}

export interface InternalServiceConfig {
    subscribe?: QueueName[]
    publish?: InternalTopic[]
}

export interface ExternalServiceConfig {
    publish: ExternalEvent[]
    subscribe: ExternalEvent[]
}

export type ServiceConfigByConfigType = InternalServiceConfig | ExternalServiceConfig

export interface ServiceConfig {
    [QueueConfigType.Internal]: Record<string, InternalServiceConfig>
    [QueueConfigType.External]: Record<string, ExternalServiceConfig>
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
