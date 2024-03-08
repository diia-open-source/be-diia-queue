import { RabbitMQConfig } from '@interfaces/index'

export const validRabbitMQConfig: RabbitMQConfig = {
    connection: {
        heartbeat: 60,
        hostname: 'hostname',
        locale: 'est',
        password: 'password',
        port: 5672,
        protocol: 'amqp',
        username: 'guest',
        vhost: '/',
    },
    listenerOptions: {
        prefetchCount: 10,
    },
    assertExchanges: false,
    custom: {
        responseRoutingKeyPrefix: 'diia',
    },
    reconnectOptions: {
        reconnectEnabled: true,
        reconnectTimeout: 1800,
    },
    socketOptions: {
        clientProperties: {
            prop: 'value',
        },
    },
}
