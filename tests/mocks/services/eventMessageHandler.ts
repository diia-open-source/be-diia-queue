import { randomUUID } from 'node:crypto'

import { QueueMessage } from '@interfaces/index'

export const queueMessage: QueueMessage = {
    data: {
        event: 'authUserLogOut',
        meta: {
            date: new Date(),
        },
        payload: {
            uuid: randomUUID(),
            key: 'value',
        },
    },
    done: vi.fn(),
    properties: {
        appId: randomUUID(),
        clusterId: randomUUID(),
        // eslint-disable-next-line unicorn/text-encoding-identifier-case
        contentEncoding: 'utf-8',
        contentType: 'application/json',
        correlationId: undefined,
        deliveryMode: 'direct',
        expiration: 1800,
        headers: {},
        messageId: randomUUID(),
        priority: 'high',
        replyTo: undefined,
        timestamp: Date.now(),
        type: 'type',
        userId: randomUUID(),
    },
    reject: vi.fn(),
    id: randomUUID(),
}

export const validMessage: QueueMessage = {
    ...queueMessage,
    properties: {
        ...queueMessage.properties,
        replyTo: randomUUID(),
        correlationId: randomUUID(),
    },
}
