import * as amqp from 'amqplib'

import { ErrorData } from '@diia-inhouse/errors/dist/types/interfaces'

import { AmqpConnection } from '../../../providers/rabbitmq/amqpConnection'
import { BaseQueueOptions } from '../../messageBrokerServiceConfig'
import { ListenerOptions } from '../../options'
import { EventName, QueueConfigByQueueName, ServiceConfigByConfigType, TopicConfigByConfigType } from '../../queueConfig'
import { ConnectOptions, ConnectionStatus, ReconnectOptions, SocketOptions } from './amqpConnection'

export interface RabbitMQConfigCustomParams {
    responseRoutingKeyPrefix?: string
}

export interface DeclareOptions {
    assertQueues?: boolean
    assertExchanges?: boolean
    queuesOptions?: BaseQueueOptions
}

export interface RabbitMQConfig {
    connection: ConnectOptions
    socketOptions?: SocketOptions
    reconnectOptions?: ReconnectOptions
    custom?: RabbitMQConfigCustomParams
    listenerOptions: ListenerOptions
    declareOptions?: DeclareOptions
    /**
     * Whether to create consumer (listener) connections. When `false`, only publisher
     * and asserter connections are established. Defaults to `true`.
     */
    consumerEnabled?: boolean
}

export enum ConnectionClientType {
    Listener = 'listener',
    Asserter = 'asserter',
    Publisher = 'publisher',
}

export type ConnectionList = {
    [k in ConnectionClientType]: {
        lock?: Promise<AmqpConnection>
    }
}

export interface QueueMessageMetaData {
    date: Date
    // TODO(BACK-0): add xid parameter into publish method
    xid?: string
    responseRoutingKey?: string
    ignoreCache?: boolean
    registryApiVersion?: string
}

export interface QueueMessageError {
    data: ErrorData
    message: string
    http_code: number
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface QueueMessageData<T = any> {
    event: EventName | string
    payload: T
    meta: QueueMessageMetaData
}

export type MessageData = Pick<QueueMessageData, 'payload' | 'event'>

export class Message<T = unknown> {
    data: QueueMessageData<T>

    constructor(data: QueueMessageData<T>) {
        this.data = data
    }
}

export type MessageProperties = amqp.MessageProperties

export interface QueueMessage {
    id?: unknown
    data: QueueMessageData
    properties: MessageProperties
    done: (data?: QueueMessageData) => void
    reject: (nackOptions: NackOptions) => void
}

export interface RabbitMQStatus {
    listener?: ConnectionStatus
    publisher: ConnectionStatus
}

export interface ExportConfig {
    queues: QueueConfigByQueueName
    rabbit: RabbitMQConfig
    topics: TopicConfigByConfigType
    service: ServiceConfigByConfigType
    portalEvents: EventName[]
}

export const Headers = {
    sentFrom: 'sent-from',
    handledBy: 'handled-by',
} as const

export class NackOptions {
    constructor(
        /**
         * If requeue is truthy, the server will try to put the message or messages back on the queue or queues from which they came.
         * Defaults to true if not given, so if you want to make sure messages are dead-lettered or discarded, supply false here.
         */
        readonly requeue = true,
        /**
         * If allUpTo is truthy, all outstanding messages prior to and including the given message are rejected. Defaults to false.
         */
        readonly allUpTo = false,
    ) {}
}

export const Arguments = {
    queueType: 'x-queue-type',
    /**
     * @deprecated the RabbitMQ plugin that supports delayed messages is deprecated and should be removed in the future
     */
    delayedType: 'x-delayed-type',
    deliveryLimit: 'x-delivery-limit',
    deadLetterExchange: 'x-dead-letter-exchange',
    deadLetterExchangeRoutingKey: 'x-dead-letter-routing-key',
} as const
