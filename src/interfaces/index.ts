import { ValidationError } from '@diia-inhouse/errors'
import { LogData, PublicServiceCode } from '@diia-inhouse/types'
import { ValidationSchema } from '@diia-inhouse/validators'

import { MessagePayload, QueueMessage, QueueMessageMetaData, RabbitMQConfig } from './providers/rabbitmq'
import {
    EventName,
    ExternalEvent,
    ExternalTopic,
    InternalEvent,
    QueueConfigByQueueName,
    QueueName,
    ScheduledTaskEvent,
    ServiceConfigByConfigType,
    TopicConfigByConfigType,
} from './queueConfig'

export * from './providers/rabbitmq'

export * from './deps'

export { QueueConfigType } from './queueConfig'

export interface EventBusQueue {
    subscribe(subscriptionName: QueueName, messageHandler: MessageHandler, options?: SubscribeOptions): Promise<boolean>

    publish(eventName: InternalEvent, message: MessagePayload, routingKey?: string): Promise<boolean>
}

export interface TaskQueue {
    subscribe(taskName: string, messageHandler: MessageHandler, options?: SubscribeOptions): Promise<boolean>

    publish(taskName: string, message: MessagePayload, delay?: number): Promise<boolean>
}

export interface ScheduledTasksQueue {
    subscribe(subscriptionName: QueueName, messageHandler: MessageHandler, options?: SubscribeOptions): Promise<boolean>

    publish(scheduledTaskName: ScheduledTaskEvent, serviceName: string): Promise<boolean>
}

export interface ExternalEventBusQueue {
    subscribe(messageHandler: MessageHandler, options?: SubscribeOptions): Promise<boolean>

    publish(eventName: ExternalEvent, message: MessagePayload, options?: PublishOptions): Promise<boolean>

    publishDirect<T>(eventName: string, message: MessagePayload, topic?: ExternalTopic, options?: PublishOptions): Promise<T>
}

export interface EventBusListener {
    event: EventName
    /** @deprecated use receive direct mechanism */
    isSync?: boolean
    validationRules?: ValidationSchema
    validationErrorHandler?(error: ValidationError, uuid: string): Promise<void>
    getServiceCode?(payload: unknown): PublicServiceCode
    handler?(payload: unknown, meta: QueueMessageMetaData): Promise<unknown | void>
}

export interface TaskListener {
    name: string
    isDelayed?: boolean
    validationRules: ValidationSchema
    getServiceCode?(payload: unknown): PublicServiceCode
    handler(payload: unknown, meta: QueueMessageMetaData): Promise<void>
}

export enum QueueConnectionType {
    Internal = 'internal',
    External = 'external',
}

export type QueueConfig = RabbitMQConfig

export interface InternalQueueConfig extends QueueConfig {
    queueName?: string
    scheduledTaskQueueName?: string
}

export type QueueConnectionConfig = {
    localServiceConfig?: ServiceConfigByConfigType
    [QueueConnectionType.Internal]?: InternalQueueConfig
    [QueueConnectionType.External]?: QueueConfig
}

export interface QueueContext {
    logData?: LogData
}

export interface ListenerOptions {
    prefetchCount?: number
}

export interface SubscribeOptions {
    routingKey?: string
    queueSuffix?: string
    listener?: ListenerOptions
    delayed?: boolean
}

export type MessageHandler = (msg: QueueMessage | null) => Promise<void>

export interface AggregatedQueueConfigs {
    serviceConfig: ServiceConfigByConfigType
    queueConfig: QueueConfigByQueueName
    topicConfig: TopicConfigByConfigType
}

export interface PublishOptions {
    ignoreCache?: boolean
    retry?: boolean
    timeout?: number
}
