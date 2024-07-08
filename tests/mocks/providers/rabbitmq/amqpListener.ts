import { randomUUID } from 'node:crypto'

import { ConsumeMessage } from 'amqplib'

export const validMessage: ConsumeMessage = {
    content: Buffer.from(JSON.stringify({ key: 'value' })),
    fields: {
        consumerTag: 'amq.ctag-NwvV8sVg94TU6dW7tNDlzg',
        deliveryTag: 1,
        exchange: 'exchange',
        redelivered: false,
        routingKey: 'routingKey',
    },
    properties: {
        appId: randomUUID(),
        clusterId: randomUUID(),
        contentEncoding: 'utf8',
        contentType: 'application/json',
        correlationId: randomUUID(),
        deliveryMode: 0,
        expiration: 18000,
        headers: {},
        messageId: randomUUID(),
        priority: 0,
        replyTo: 'replyTo',
        timestamp: Date.now(),
        type: 'message',
        userId: randomUUID(),
    },
}
