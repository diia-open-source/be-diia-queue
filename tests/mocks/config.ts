import _ from 'lodash'
import { PartialDeep } from 'type-fest'

import constants from '@src/constants'
import {
    BindOptions,
    DeclareOptions,
    ExchangeOptions,
    ExchangeType,
    ExportConfig,
    MessageBrokerServiceConfig,
    MessageBrokerServicesConfig,
    QueueConfigType,
    QueueConnectionConfig,
    QueueConnectionType,
    QueueOptions,
    QueueTypes,
    RabbitMQConfig,
} from '@src/interfaces'
import { getConsumerTag } from '@src/utils'

import { ServiceRulesConfig } from '@interfaces/queueConfig'

export const defaultServiceRulesConfig: ServiceRulesConfig = {
    servicesConfig: {
        [QueueConfigType.Internal]: {},
        [QueueConfigType.External]: {
            subscribe: [],
        },
    },
    topicsConfig: {
        [QueueConfigType.Internal]: {},
        [QueueConfigType.External]: {},
    },
    queuesConfig: {
        [QueueConfigType.Internal]: {},
    },
}

export function getServiceRulesConfig(messageBrokerServices?: MessageBrokerServicesConfig): ServiceRulesConfig {
    return {
        queuesConfig: {
            [QueueConfigType.Internal]: {},
        },
        servicesConfig: {
            [QueueConfigType.Internal]: {},
            [QueueConfigType.External]: { subscribe: [] },
        },
        topicsConfig: {
            [QueueConfigType.Internal]: {},
            [QueueConfigType.External]: {},
        },
        messageBrokerServices,
    }
}

export function getConnectOptions(messageBrokerServicesConfig?: MessageBrokerServicesConfig): QueueConnectionConfig {
    return {
        internal: { ...getRabbitMQConfig() },
        external: { ...getRabbitMQConfig() },
        serviceRulesConfig: getServiceRulesConfig(messageBrokerServicesConfig),
    }
}

export function getConfig(declareOptions?: DeclareOptions): QueueConnectionConfig {
    return {
        serviceRulesConfig: getServiceRulesConfig(),
        [QueueConnectionType.Internal]: getRabbitMQConfig(declareOptions),
    }
}

export function getExportConfig(exportConfig: PartialDeep<ExportConfig> = {}): ExportConfig {
    const { rabbit: { declareOptions } = {} } = exportConfig

    return _.merge<ExportConfig, PartialDeep<ExportConfig>>(
        {
            topics: {},
            queues: {},
            service: {},
            portalEvents: [],
            rabbit: getRabbitMQConfig(declareOptions),
        },
        exportConfig,
    )
}

export function getRabbitMQConfig(declareOptions: DeclareOptions = {}): RabbitMQConfig {
    const { assertExchanges = false, assertQueues = false } = declareOptions

    return {
        connection: {
            heartbeat: 60,
            hostname: '127.0.0.1',
            locale: 'est',
            password: 'guest',
            port: 5672,
            protocol: 'amqp',
            username: 'guest',
            vhost: '/',
        },
        listenerOptions: {
            prefetchCount: 5,
        },
        declareOptions: {
            assertQueues,
            assertExchanges,
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
}

export function getExchangeOptions(opts: Partial<ExchangeOptions> = {}): ExchangeOptions {
    const { options, type, declare, name, delayed, bindTo = [] } = opts

    return {
        declare: declare ?? true,
        bindTo: getBindTo(bindTo),
        name: name ?? 'TestExchange',
        type: type ?? ExchangeType.Topic,
        ...(delayed ? { delayed } : {}),
        ...(options ? { options } : {}),
    }
}

export function getBindOptions(opts: Partial<BindOptions> = {}): BindOptions {
    const { name } = getExchangeOptions()

    const { bind, routingKey, exchangeName } = opts

    return {
        bind: bind ?? true,
        exchangeName: exchangeName ?? name,
        routingKey: routingKey ?? constants.DEFAULT_ROUTING_KEY,
    }
}

export function getBindTo(partialBindTo: Partial<BindOptions>[] = [{}]): BindOptions[] | undefined {
    const bindTo: BindOptions[] = []

    for (const bindOptions of partialBindTo) {
        bindTo.push(getBindOptions(bindOptions))
    }

    return bindTo.length > 0 ? bindTo : undefined
}

export function getQueueOptions(opts: Partial<QueueOptions> = {}, serviceName?: string, hostName?: string): QueueOptions {
    const { options, bindTo = [], declare = true, redeclareOptions, name = 'TestQueue', type = QueueTypes.Quorum, consumerOptions } = opts

    const consumerTag = serviceName && hostName ? getConsumerTag(serviceName, hostName) : undefined

    return {
        name: name,
        type: type,
        declare: declare,
        options: options,
        redeclareOptions,
        bindTo: getBindTo(bindTo),
        consumerOptions: {
            recreateChannelOptions: {},
            consumerTag,
            ...consumerOptions,
        },
    }
}

export function getMessageBrokerServiceConfig(
    config: Partial<MessageBrokerServiceConfig> = {},
    serviceName?: string,
): MessageBrokerServiceConfig {
    const { queuesOptions, exchangesOptions } = config

    return {
        exchangesOptions: exchangesOptions ?? [getExchangeOptions()],
        queuesOptions: queuesOptions ?? [getQueueOptions({}, serviceName)],
    }
}
