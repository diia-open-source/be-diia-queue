import { PublicServiceCode } from '@diia-inhouse/types'

import { PublishOptions } from '../../index'
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
    serviceCode?: PublicServiceCode
    'x-delay'?: number
}

export interface PublishToExchangeParams {
    eventName: EventName | string
    message: MessagePayload
    exchangeName: string
    routingKey?: string
    responseRoutingKey?: string
    headers: MessageHeaders
    options?: PublishOptions
}
