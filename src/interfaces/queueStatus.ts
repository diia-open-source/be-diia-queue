import { RabbitMQStatus } from './providers/rabbitmq'

import { QueueConnectionType } from '.'

export type QueueStatusByType = Partial<Record<QueueConnectionType, RabbitMQStatus>>

export type QueueStatus = { rabbit: QueueStatusByType }
