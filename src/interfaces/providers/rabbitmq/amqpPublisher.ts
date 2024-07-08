import { PublishDirectOptions } from '../../options'
import { EventName } from '../../queueConfig'

export enum ExchangeType {
    Direct = 'direct',
    Fanout = 'fanout',
    Topic = 'topic',
    Headers = 'headers',
    XDelayedMessage = 'x-delayed-message',
}

export type MessagePayload = unknown

export interface MessageHeaders {
    traceId: string
    serviceCode?: string
    'x-delay'?: number
}

export interface PublishToExchangeParams {
    eventName: EventName | string
    message: MessagePayload
    exchangeName: string
    routingKey?: string
    responseRoutingKey?: string
    headers: MessageHeaders
    options?: PublishDirectOptions
}
