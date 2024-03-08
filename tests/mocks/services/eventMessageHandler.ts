import { randomUUID } from 'crypto'

import { QueueMessage } from '@interfaces/index'
import { InternalEvent } from '@interfaces/queueConfig'

export const validMessage: QueueMessage = {
    data: {
        event: InternalEvent.AuthUserLogOut,
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
