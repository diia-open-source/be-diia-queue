import { randomUUID } from 'node:crypto'

import { QueueMessage } from '@interfaces/index'

export const validMessage: QueueMessage = {
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
    done: jest.fn(),
    properties: {
        appId: randomUUID(),
        clusterId: randomUUID(),
        // eslint-disable-next-line unicorn/text-encoding-identifier-case
        contentEncoding: 'utf-8',
        contentType: 'application/json',
        correlationId: randomUUID(),
        deliveryMode: 'direct',
        expiration: 1800,
        headers: {},
        messageId: randomUUID(),
        priority: 'hight',
        replyTo: randomUUID(),
        timestamp: Date.now(),
        type: 'type',
        userId: randomUUID(),
    },
    reject: jest.fn(),
    id: randomUUID(),
}
