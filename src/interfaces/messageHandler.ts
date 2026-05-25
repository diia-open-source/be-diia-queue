import { QueueMessage } from './providers/rabbitmq/index.js'

export type MessageHandler = (msg: QueueMessage) => Promise<void>
