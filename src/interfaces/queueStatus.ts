import { MessageBrokerServiceType } from './messageBrokerServiceConfig.js'
import { RabbitMQStatus } from './providers/rabbitmq/index.js'

export enum QueueConnectionType {
    Internal = 'internal',
    External = 'external',
}

export type MessageBrokerServicesStatus = Partial<Record<MessageBrokerServiceType, RabbitMQStatus>>

export type QueueStatusByType = Partial<Record<QueueConnectionType, MessageBrokerServicesStatus>>

export type QueueStatus = { rabbit: QueueStatusByType }
