import { randomUUID } from 'node:crypto'

import { expect } from 'vitest'

import { QueueMessageData, QueueMessageMetaData } from '@src/interfaces'

export { validMessage } from '../../../mocks/providers/rabbitmq/amqpListener'

export const validPublishToExchangeParams = {
    eventName: 'eventName',
    exchangeName: 'exchangeName',
    headers: {
        traceId: randomUUID(),
    },
    message: { key: 'value' },
    options: {
        ignoreCache: true,
    },
    responseRoutingKey: 'responseRoutingKey',
    routingKey: 'routingKey',
}

export function getMsgData(event: string, payload: unknown = {}, meta: Partial<QueueMessageMetaData> = {}): QueueMessageData {
    const { date = new Date(), ...metaData } = meta

    return {
        event,
        payload,
        meta: {
            date,
            ...metaData,
        },
    }
}

export function getExpectedMsgData(event: string, payload: unknown = {}, meta: Partial<QueueMessageMetaData> = {}): QueueMessageData {
    const msgData = getMsgData(event, payload, meta)

    const { date = expect.any(Date), ...metaData } = meta

    return {
        ...msgData,
        meta: {
            date,
            ...metaData,
        },
    }
}
