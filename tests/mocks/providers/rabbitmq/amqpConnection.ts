import { EventEmitter } from 'node:events'

import { Options } from 'amqplib'

import { ConnectionStatus, ReconnectOptions, SocketOptions } from '@interfaces/index'

export const connectOptions: Options.Connect = {
    hostname: 'amqp.host',
    port: 5672,
    username: 'username',
    password: 'password',
}

export const reconnectOptions: ReconnectOptions = {
    reconnectEnabled: true,
    reconnectTimeout: 1,
}

export const socketOptions: SocketOptions = {
    clientProperties: {},
}

export const connectionMock = {
    createChannel: vi.fn(),
}

export const amqpConnection = {
    connect: vi.fn(),
}

// eslint-disable-next-line unicorn/prefer-event-target
export class AmqpConnectionMock extends EventEmitter {
    async connect(): Promise<unknown> {
        return amqpConnection.connect
    }

    async createChannel(): Promise<unknown> {
        return connectionMock.createChannel()
    }

    getStatus(): ConnectionStatus {
        return ConnectionStatus.Connected
    }
}

export const channelMock = {
    assertExchange: vi.fn(),
    prefetch: vi.fn(),
    publish: vi.fn(),
    bindQueue: vi.fn(),
    ack: vi.fn(),
    nack: vi.fn(),
}

export const sendMessageMock = vi.fn()

// eslint-disable-next-line unicorn/prefer-event-target
export class ChannelMock extends EventEmitter {
    async assertExchange(...args: unknown[]): Promise<unknown> {
        return channelMock.assertExchange(...args)
    }

    async consume(_queueName: string, onMessageCallback: CallableFunction): Promise<void> {
        sendMessageMock(onMessageCallback)

        return
    }

    async prefetch(...args: unknown[]): Promise<unknown> {
        return channelMock.prefetch(...args)
    }

    async publish(...args: unknown[]): Promise<unknown> {
        return channelMock.publish(...args)
    }

    async bindQueue(...args: unknown[]): Promise<unknown> {
        return channelMock.bindQueue(...args)
    }

    async ack(...args: unknown[]): Promise<unknown> {
        return channelMock.ack(...args)
    }

    async nack(...args: unknown[]): Promise<unknown> {
        return channelMock.nack(...args)
    }
}
