import { QueueMessage } from './providers/rabbitmq'

export type MessageHandler = (msg: QueueMessage | null) => Promise<void>
