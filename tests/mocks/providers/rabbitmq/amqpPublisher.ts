import { randomUUID } from 'crypto'

import { PublishToExchangeParams } from '@interfaces/index'

export { validMessage } from '../../../mocks/providers/rabbitmq/amqpListener'

export const validPublishToExchangeParams: PublishToExchangeParams = {
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
