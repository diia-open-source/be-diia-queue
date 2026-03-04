import { MessagePropertyHeaders } from 'amqplib/properties'

import { Headers } from './index'

export type MessagePayload = unknown

export interface MessageHeaders {
    traceId: string
    serviceCode?: string
    'x-delay'?: number
}

export interface DirectResponseHeaders extends MessagePropertyHeaders {
    [Headers.handledBy]?: string
}

export interface DirectResponse<T = unknown> extends MessagePropertyHeaders {
    body: T
    headers: DirectResponseHeaders
}

export type PublishingResult = void | never
