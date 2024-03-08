import { Options } from 'amqplib'

export interface AmqpConfig {
    protocol?: string
    hostname?: string
    port?: number
    username?: string
    password?: string
    heartbeat?: number
}

export type ConnectOptions = Options.Connect

export interface SocketOptions {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    clientProperties?: Record<string, any>
}

export interface ReconnectOptions {
    reconnectEnabled?: boolean
    reconnectTimeout?: number
}

export enum ConnectionStatus {
    Init = 'init',
    Connecting = 'connecting',
    Connected = 'connected',
    Reconnecting = 'reconnecting',
    Closing = 'closing',
    Closed = 'closed',
    Down = 'down',
}
