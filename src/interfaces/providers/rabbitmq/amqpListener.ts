import { Channel, Options } from 'amqplib'

import { QueueMessage } from '.'

export interface QueueChannelAndOptions {
    channel: Channel
    queueOptions: Options.AssertQueue
}

export type QueueCallback = (msg: QueueMessage | null) => unknown
