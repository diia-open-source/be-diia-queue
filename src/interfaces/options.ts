import { Options } from 'amqplib'

export interface ListenerOptions {
    queueOptions?: Options.AssertQueue
    prefetchCount?: number
}

export interface PublishDirectOptions {
    timeout?: number
    ignoreCache?: boolean
    retry?: boolean
}

export interface PublishOptions {
    publishTimeout?: number
    throwOnPublishTimeout?: boolean
}

export interface PublishInternalEventOptions extends PublishOptions {
    routingKey?: string
}

export interface SubscribeOptions {
    routingKey?: string
    queueSuffix?: string
    listener?: ListenerOptions
    delayed?: boolean
}

export interface PublishExternalEventOptions extends PublishOptions, PublishDirectOptions {}
