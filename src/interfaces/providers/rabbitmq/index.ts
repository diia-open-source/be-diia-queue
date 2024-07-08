import * as amqp from 'amqplib'

import { AmqpConnection } from '../../../providers/rabbitmq/amqpConnection'
import { ListenerOptions } from '../../options'
import { EventName } from '../../queueConfig'

import { ConnectOptions, ConnectionStatus, ReconnectOptions, SocketOptions } from './amqpConnection'

export * from './amqpConnection'

export * from './amqpPublisher'

export interface RabbitMQConfigCustomParams {
    responseRoutingKeyPrefix?: string
}

export interface RabbitMQConfig {
    connection: ConnectOptions
    socketOptions?: SocketOptions
    reconnectOptions?: ReconnectOptions
    custom?: RabbitMQConfigCustomParams
    assertExchanges?: boolean // for the external config only
    listenerOptions: ListenerOptions
}

export enum ConnectionClientType {
    Listener = 'listener',
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
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface QueueMessageData<T = any> {
    event: EventName | string
    payload: T
    meta: QueueMessageMetaData
}

export type MessageProperties = amqp.MessageProperties

export interface QueueMessage {
    id?: unknown
    data: QueueMessageData
    properties: MessageProperties
    done: (data?: unknown) => void
    reject: () => void
}

export interface RabbitMQStatus {
    listener: ConnectionStatus
    publisher: ConnectionStatus
}
