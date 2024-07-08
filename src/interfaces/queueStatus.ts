import { RabbitMQStatus } from './providers/rabbitmq'

export enum QueueConnectionType {
    Internal = 'internal',
    External = 'external',
}

export type QueueStatusByType = Partial<Record<QueueConnectionType, RabbitMQStatus>>

export type QueueStatus = { rabbit: QueueStatusByType }
