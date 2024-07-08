import { ValidationSchema } from '@diia-inhouse/validators'

import { MessageHandler } from './messageHandler'
import { PublishDirectOptions, PublishExternalEventOptions, SubscribeOptions } from './options'
import { MessagePayload, QueueMessageMetaData, RabbitMQConfig } from './providers/rabbitmq'
import {
    EventName,
    QueueConfigByQueueName,
    QueueName,
    ServiceConfigByConfigType,
    ServiceRulesConfig,
    Topic,
    TopicConfigByConfigType,
} from './queueConfig'
import { QueueConnectionType } from './queueStatus'

export * from './providers/rabbitmq'

export * from './queueStatus'

export * from './eventBus'

export * from './options'

export * from './messageHandler'

export * from './options'

export * from './queueContext'

export { QueueConfigType } from './queueConfig'

export interface TaskQueue {
    subscribe(taskName: string, messageHandler: MessageHandler, options?: SubscribeOptions): Promise<boolean>

    publish(taskName: string, message: MessagePayload, delay?: number): Promise<boolean>
}

export interface ScheduledTasksQueue {
    subscribe(subscriptionName: QueueName, messageHandler: MessageHandler, options?: SubscribeOptions): Promise<boolean>

    publish(scheduledTaskName: EventName, serviceName: string): Promise<boolean>
}

export interface ExternalEventBusQueue {
    subscribe(messageHandler: MessageHandler, options?: SubscribeOptions): Promise<boolean>

    publish(eventName: EventName, message: MessagePayload, options?: PublishExternalEventOptions): Promise<boolean>

    publishDirect<T>(eventName: string, message: MessagePayload, topic?: Topic, options?: PublishDirectOptions): Promise<T>
}

export interface TaskListener {
    name: string
    isDelayed?: boolean
    validationRules: ValidationSchema
    getServiceCode?(payload: unknown): string
    handler(payload: unknown, meta: QueueMessageMetaData): Promise<void>
}

export type QueueConfig = RabbitMQConfig

export interface InternalQueueConfig extends QueueConfig {
    queueName?: string
    scheduledTaskQueueName?: string
}

export type QueueConnectionConfig = {
    serviceRulesConfig: ServiceRulesConfig
    [QueueConnectionType.Internal]?: InternalQueueConfig
    [QueueConnectionType.External]?: QueueConfig
}

export interface AggregatedQueueConfigs {
    serviceConfig: ServiceConfigByConfigType
    queueConfig: QueueConfigByQueueName
    topicConfig: TopicConfigByConfigType
}
