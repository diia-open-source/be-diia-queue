import { AsyncLocalStorage } from 'node:async_hooks'

import Logger from '@diia-inhouse/diia-logger'
import { MetricsService } from '@diia-inhouse/diia-metrics'
import { HealthCheckResult, HttpStatusCode, OnHealthCheck } from '@diia-inhouse/types'

import {
    ConnectionStatus,
    MessageBrokerExternalServiceType,
    MessageBrokerInternalServiceType,
    MessageBrokerServiceConfig,
    MessageBrokerServiceType,
    MessageBrokerServicesConfig,
    MessageBrokerServicesStatus,
    QueueConfigType,
    QueueConnectionConfig,
    QueueConnectionType,
    QueueContext,
    emptyMessageBrokerServiceConfig,
} from '../interfaces'
import { QueueStatus } from '../interfaces/queueStatus'
import { RabbitMQProvider } from '../providers/rabbitmq'

export class Queue implements OnHealthCheck {
    private readonly internalRabbitMQProvidersMap: Map<MessageBrokerInternalServiceType, RabbitMQProvider> = new Map()
    private readonly externalRabbitMQProvidersMap: Map<MessageBrokerExternalServiceType, RabbitMQProvider> = new Map()

    constructor(
        private readonly systemServiceName: string,
        private readonly metrics: MetricsService,
        private readonly connectionConfig: QueueConnectionConfig,
        private readonly asyncLocalStorage: AsyncLocalStorage<QueueContext>,
        private readonly logger: Logger,
    ) {}

    async onHealthCheck(): Promise<HealthCheckResult<QueueStatus>> {
        const status = this.getProvidersStatus()

        return {
            status,
            details: {
                rabbit: {
                    internal: this.getProvidersStatusDetails(this.internalRabbitMQProvidersMap),
                    external: this.getProvidersStatusDetails(this.externalRabbitMQProvidersMap),
                },
            },
        }
    }

    makeInternalRabbitMQProvider(serviceType: MessageBrokerInternalServiceType): RabbitMQProvider {
        const provider = this.internalRabbitMQProvidersMap.get(serviceType)
        if (provider) {
            return provider
        }

        const {
            internal: rabbitMQConfig,
            serviceRulesConfig: { queuesConfig, servicesConfig = {}, topicsConfig, messageBrokerServices },
        } = this.connectionConfig

        if (!rabbitMQConfig) {
            throw new Error(`External rabbitMQ config is not provided`)
        }

        const messageBrokerServiceConfig = this.getMessageBrokerServiceConfig(serviceType, messageBrokerServices)

        const serviceConfig = servicesConfig[QueueConnectionType.Internal] || {}

        const rabbitMQProvider = new RabbitMQProvider(
            this.systemServiceName,
            rabbitMQConfig,
            serviceConfig,
            topicsConfig[QueueConnectionType.Internal],
            [],
            this.logger,
            this.metrics,
            this.asyncLocalStorage,
            queuesConfig[QueueConfigType.Internal],
            messageBrokerServiceConfig,
        )

        this.internalRabbitMQProvidersMap.set(serviceType, rabbitMQProvider)

        return rabbitMQProvider
    }

    makeExternalRabbitMQProvider(serviceType: MessageBrokerExternalServiceType): RabbitMQProvider {
        const provider = this.externalRabbitMQProvidersMap.get(serviceType)
        if (provider) {
            return provider
        }

        const {
            external: rabbitMQConfig,
            serviceRulesConfig: { servicesConfig = {}, topicsConfig, portalEvents = [], messageBrokerServices },
        } = this.connectionConfig

        if (!rabbitMQConfig) {
            throw new Error(`External rabbitMQ config is not provided`)
        }

        const messageBrokerServiceConfig = this.getMessageBrokerServiceConfig(serviceType, messageBrokerServices)

        const serviceConfig = servicesConfig[QueueConnectionType.External] || {}

        const rabbitMQProvider = new RabbitMQProvider(
            this.systemServiceName,
            rabbitMQConfig,
            serviceConfig,
            topicsConfig[QueueConnectionType.External],
            portalEvents,
            this.logger,
            this.metrics,
            this.asyncLocalStorage,
            {},
            messageBrokerServiceConfig,
        )

        this.externalRabbitMQProvidersMap.set(serviceType, rabbitMQProvider)

        return rabbitMQProvider
    }

    private getProvidersStatus(): HttpStatusCode {
        for (const provider of this.internalRabbitMQProvidersMap.values()) {
            const { listener: listenerStatus, publisher: publisherStatus } = provider.getStatus()

            if (publisherStatus !== ConnectionStatus.Connected) {
                return HttpStatusCode.SERVICE_UNAVAILABLE
            }

            if (listenerStatus !== undefined && listenerStatus !== ConnectionStatus.Connected) {
                return HttpStatusCode.SERVICE_UNAVAILABLE
            }
        }

        return HttpStatusCode.OK
    }

    private getProvidersStatusDetails(providersMap: Map<MessageBrokerServiceType, RabbitMQProvider>): MessageBrokerServicesStatus {
        const details: MessageBrokerServicesStatus = {}

        for (const [serviceType, provider] of providersMap) {
            details[serviceType] = provider.getStatus()
        }

        return details
    }

    private getMessageBrokerServiceConfig(
        serviceType: MessageBrokerServiceType,
        messageBrokerServices: MessageBrokerServicesConfig | undefined,
    ): MessageBrokerServiceConfig | undefined {
        const serviceConfig = messageBrokerServices?.[serviceType] || emptyMessageBrokerServiceConfig
        const generalConfig = messageBrokerServices?.['general'] || emptyMessageBrokerServiceConfig

        return {
            queuesOptions: [...serviceConfig.queuesOptions, ...generalConfig.queuesOptions],
            exchangesOptions: [...serviceConfig.exchangesOptions, ...generalConfig.exchangesOptions],
        }
    }
}
