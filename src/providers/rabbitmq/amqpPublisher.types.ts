import { MessagePropertyHeaders, Options } from 'amqplib'

import { PublishMessageOptions } from '../../interfaces/options.js'
import { Headers } from '../../interfaces/providers/rabbitmq/index.js'

export type MessagePayload = unknown

export interface MessageHeaders {
    traceId: string
    serviceCode?: string
    'x-delay'?: number
}

export type DirectResponseHeaders = MessagePropertyHeaders & {
    [Headers.handledBy]?: string
}

export interface DirectResponse<T = unknown> {
    body: T
    headers: DirectResponseHeaders
}

export type PublishingResult = void

export interface AmqpPublisherPublishOptions {
    channel: Options.Publish
    custom: PublishMessageOptions
}
