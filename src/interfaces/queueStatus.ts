import { MessageBrokerServiceType } from './messageBrokerServiceConfig'
import { RabbitMQStatus } from './providers/rabbitmq'

export enum QueueConnectionType {
    Internal = 'internal',
    External = 'external',
}

export type MessageBrokerServicesStatus = Partial<Record<MessageBrokerServiceType, RabbitMQStatus>>

export type QueueStatusByType = Partial<Record<QueueConnectionType, MessageBrokerServicesStatus>>

export type QueueStatus = { rabbit: QueueStatusByType }
