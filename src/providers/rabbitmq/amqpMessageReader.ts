import { Message } from 'amqplib'

import { Headers } from '../../interfaces/providers/rabbitmq/index.js'
import { UnroutedMessageFields } from './amqpMessageReader.types.js'
import { ReplyToQueueName } from './amqpPublisher.types.js'

export class AmqpMessageReader {
    private readonly defaultExchangeName = 'default'

    readUnrouted(message: Message): UnroutedMessageFields | undefined {
        // A delayed exchange returns the message immediately while it is still parked, so this is not an unrouted message.
        const isDelayed = message.properties.headers?.['x-delay'] > 0
        if (isDelayed) {
            return
        }

        return {
            event: this.readEventName(message),
            routingKey: this.readRoutingKey(message.fields.routingKey),
            exchangeName: message.fields.exchange || this.defaultExchangeName,
        }
    }

    private readRoutingKey(routingKey?: string): string | undefined {
        if (!routingKey) {
            return
        }

        const isDirectReplyTo = routingKey.startsWith(ReplyToQueueName)
        if (isDirectReplyTo) {
            return ReplyToQueueName
        }

        return routingKey
    }

    private readEventName(message: Message): string | undefined {
        const headerEvent = message.properties.headers?.[Headers.event]
        if (typeof headerEvent === 'string' && headerEvent.length > 0) {
            return headerEvent
        }

        try {
            const { event } = JSON.parse(message.content.toString())

            return typeof event === 'string' && event.length > 0 ? event : undefined
        } catch {
            return
        }
    }
}
