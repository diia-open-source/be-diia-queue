import { Options } from 'amqplib'

import { ReconnectOptions, SocketOptions } from '@interfaces/index'

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
