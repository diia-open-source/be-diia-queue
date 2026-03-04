import { ValidationError } from '@diia-inhouse/errors'
import { ValidationSchema } from '@diia-inhouse/validators'

import { ExchangeName, ExchangeOptions, QueueOptions } from './messageBrokerServiceConfig'
import { MessageHandler } from './messageHandler'
import { PublishDirectOptions, PublishExternalEventOptions, PublishOptions, SubscribeOptions } from './options'
import { MessageData, NackOptions, QueueMessageMetaData, RabbitMQConfig } from './providers/rabbitmq'
import { MessagePayload, PublishingResult } from './providers/rabbitmq/amqpPublisher'
import { EventName, QueueName, ServiceRulesConfig } from './queueConfig'
import { QueueConnectionType } from './queueStatus'

export * from './providers/rabbitmq'

export * from './providers/rabbitmq/amqpConnection'

export * from './providers/rabbitmq/amqpPublisher'

export * from './queueStatus'

export * from './options'

export * from './messageHandler'

export * from './options'

export * from './queueContext'

export * from './messageBrokerServiceConfig'

export * from './metrics'

export * from './queueConfig'

export * from './externalCommunicator'

export type EventListeners = Partial<Record<EventName, EventBusListener>>

export interface TaskQueue {
    subscribe(queueName: QueueName, messageHandler: MessageHandler, options?: SubscribeOptions): Promise<boolean>

    publish(taskName: string, message: MessagePayload, delay?: number): Promise<PublishingResult>
}

export interface ScheduledTasksQueue {
    subscribe(queueName: QueueName, messageHandler: MessageHandler): Promise<boolean>

    publishToQueue(queueName: QueueName, payload: MessageData): Promise<PublishingResult>

    /** @deprecated
     * - use the publishToExchange method for pushing a message by a routing key
     * - use the publishToQueue method for pushing a message to a queue
     * */
    publish(eventName: EventName, serviceName: string): Promise<PublishingResult>

    publishToExchange(exchangeName: ExchangeName, routingKey: string, payload: MessageData): Promise<PublishingResult>
}

export interface EventBusQueue {
    subscribe(queueName: QueueName, messageHandler: MessageHandler, options?: SubscribeOptions): Promise<boolean>

    /** @deprecated
     * - use the publishToExchange method for pushing a message by a routing key
     * - use the publishToQueue method for pushing a message to a queue
     * */
    publish(publicationName: EventName, message: MessagePayload, options?: PublishOptions): Promise<PublishingResult>

    publishToQueue(queueName: QueueName, payload: MessageData): Promise<PublishingResult>

    publishToExchange(exchangeName: ExchangeName, routingKey: string, payload: MessageData): Promise<PublishingResult>
}

export interface ExternalEventBusQueue {
    subscribe(queueName: QueueName, messageHandler: MessageHandler): Promise<boolean>

    /** @deprecated
     * - use the publishToExchange method for pushing a message by a routing key
     * - use the publishToQueue method for pushing a message to a queue
     * */
    publish(eventName: EventName, message: MessagePayload, options?: PublishExternalEventOptions): Promise<PublishingResult>

    publishDirect<T>(eventName: string, message: MessagePayload, options?: PublishDirectOptions): Promise<T>

    publishToExchange(
        exchangeName: ExchangeName,
        routingKey: string,
        messageData: MessageData,
        options?: PublishOptions,
    ): Promise<PublishingResult>

    publishToQueue(queueName: QueueName, messageData: MessageData): Promise<PublishingResult>
}

export interface Listener {
    queueNames?: string[]
    nackOptions?: NackOptions
    validationRules?: ValidationSchema

    getServiceCode?(payload: unknown): string
}

export interface EventBusListener extends Listener {
    event: EventName
    /** @deprecated use receive direct mechanism */
    isSync?: boolean

    validationErrorHandler?(error: ValidationError, uuid: string): Promise<void>
    handler?(payload: unknown, meta: QueueMessageMetaData): Promise<unknown | void | NackOptions>
}

export interface TaskListener extends Listener {
    name: string
    /**
     * @deprecated the RabbitMQ plugin that supports delayed messages is deprecated and should be removed in the future
     */
    isDelayed?: boolean
    handler(payload: unknown, meta: QueueMessageMetaData): Promise<void | NackOptions>
}

export type QueueConfig = RabbitMQConfig

export interface InternalQueueConfig extends QueueConfig {
    queueName?: string
    /**
     * @deprecated use pkg-workflow entities instead
     */
    scheduledTaskQueueName?: string
}

export type QueueConnectionConfig = {
    serviceRulesConfig: ServiceRulesConfig
    [QueueConnectionType.Internal]?: InternalQueueConfig
    [QueueConnectionType.External]?: QueueConfig
}

export interface MessageBrokerServiceListener {
    handler: MessageHandler
    queueOptions: QueueOptions
    exchangesOptions: ExchangeOptions[]
}

export interface MessageBrokerServiceEventsListener extends MessageBrokerServiceListener {
    eventNames?: string[]
}
