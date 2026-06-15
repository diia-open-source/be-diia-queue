import { Options } from 'amqplib'

import { RecreateChannelOptions } from './messageBrokerServiceConfig.js'

export interface PublisherOptions {
    /**
     * @deprecated use directResponseTimeout instead. Applies to RPC direct response wait only, not publish drain.
     */
    timeout?: number
    /**
     * Timeout (ms) for publish drain / backpressure wait
     * @default 10000
     */
    publishTimeout?: number
    /**
     * Reply-to queue name for RPC direct responses
     * @default amq.rabbitmq.reply-to
     */
    replyToQueueName?: string
    /**
     * Timeout (ms) for direct response
     * @default 10000
     */
    directResponseTimeout?: number
}

export interface ListenerOptions {
    queueOptions?: Options.AssertQueue
    prefetchCount?: number
    recreateChannelOptions?: RecreateChannelOptions
}

export interface PublishMessageOptions {
    /**
     * How to handle publish drain / backpressure wait timeout:
     * - `true` — reject with `InternalServerError` (`Message publish timeout exceeded`)
     * - `false` — log the error, resolve, and record publish metrics with `ErrorType.Unoperated`
     * @default true
     */
    throwOnPublishTimeout?: boolean
    /**
     * Timeout (ms) for publish drain / backpressure wait
     * @default 10000
     */
    publishTimeout?: number
}

export interface PublishDirectMessageOptions {
    /**
     * Timeout (ms) for direct response
     * @default 10000
     */
    responseTimeout?: number
    /**
     * Timeout (ms) for publish drain / backpressure wait
     * @default 10000
     */
    publishTimeout?: number
}

export interface PublishDirectOptions {
    /**
     * Override the target exchange. Defaults to the exchange resolved from the
     * external queue configuration for the given event.
     * @default undefined
     */
    exchangeName?: string
    /**
     * Timeout (ms) for direct response
     * @default 10000
     */
    timeout?: number
    /**
     * Whether to ignore cache
     * @default false
     */
    ignoreCache?: boolean
    /**
     * Registry API version
     * @default undefined
     */
    registryApiVersion?: string
    /**
     * Timeout (ms) for publish drain / backpressure wait
     * @default 10000
     */
    publishTimeout?: number
}

export interface PublishOptions extends PublishMessageOptions {
    /**
     * Delay (ms) before message delivery
     * @default undefined
     * @deprecated rabbitmq version 4.x does not support delays
     */
    delay?: number

    /**
     * Routing key for message routing
     * @default undefined
     */
    routingKey?: string
}

export interface SubscribeOptions {
    routingKey?: string
    listener?: ListenerOptions
    /**
     * @deprecated the RabbitMQ plugin that supports delayed messages is deprecated and should be removed in the future
     */
    delayed?: boolean
}
