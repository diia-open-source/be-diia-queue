import { Options } from 'amqplib'

import { RecreateChannelOptions } from './messageBrokerServiceConfig'

export interface PublisherOptions {
    timeout?: number
    replyToQueueName?: string
}

export interface ListenerOptions {
    queueOptions?: Options.AssertQueue
    prefetchCount?: number
    recreateChannelOptions?: RecreateChannelOptions
}

export interface PublishDirectOptions {
    exchangeName?: string
    timeout?: number
    ignoreCache?: boolean
    retry?: boolean
    registryApiVersion?: string
}

export interface PublishOptions {
    /**
     * Delay (ms) before message delivery
     * @default undefined
     */
    delay?: number

    /**
     * Routing key for message routing
     * @default undefined
     */
    routingKey?: string

    /**
     * Timeout (ms) for publish operation
     * @default Infinity
     */
    publishTimeout?: number

    /**
     * Whether to throw error on timeout (true) or return false (false)
     * @default true
     */
    throwOnPublishTimeout?: boolean
}

export interface SubscribeOptions {
    routingKey?: string
    listener?: ListenerOptions
    /**
     * @deprecated the RabbitMQ plugin that supports delayed messages is deprecated and should be removed in the future
     */
    delayed?: boolean
}

export interface PublishExternalEventOptions extends PublishOptions, PublishDirectOptions {}
