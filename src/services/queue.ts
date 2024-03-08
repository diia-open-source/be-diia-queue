import { AsyncLocalStorage } from 'async_hooks'

import { HealthCheckResult, HttpStatusCode, Logger, OnHealthCheck } from '@diia-inhouse/types'

import { ConnectionStatus, QueueConnectionConfig, QueueContext } from '../interfaces'
import { QueueConfigType } from '../interfaces/queueConfig'
import { QueueStatus } from '../interfaces/queueStatus'
import { RabbitMQProvider } from '../providers/rabbitmq'
import * as Utils from '../utils'

export class Queue implements OnHealthCheck {
    private internalQueue: RabbitMQProvider

    private externalQueue: RabbitMQProvider

    constructor(
        private readonly serviceName: string,
        private readonly connectionConfig: QueueConnectionConfig,

        private readonly asyncLocalStorage: AsyncLocalStorage<QueueContext>,
        private readonly logger: Logger,
    ) {}

    async onHealthCheck(): Promise<HealthCheckResult<QueueStatus>> {
        const internalQueueStatus = this.internalQueue?.getStatus()
        const externalQueueStatus = this.externalQueue?.getStatus()

        const queueStatuses = [internalQueueStatus, externalQueueStatus]
            .filter((status) => status)
            .flatMap((status) => Object.values(status))

        const status: HttpStatusCode = queueStatuses.some((s) => s !== ConnectionStatus.Connected)
            ? HttpStatusCode.SERVICE_UNAVAILABLE
            : HttpStatusCode.OK

        return {
            status,
            details: {
                rabbit: {
                    internal: internalQueueStatus,
                    external: externalQueueStatus,
                },
            },
        }
    }

    getInternalQueue(): RabbitMQProvider {
        if (this.internalQueue) {
            return this.internalQueue
        }

        const { internal } = this.connectionConfig
        const { serviceConfig, queueConfig, topicConfig } = Utils.validateAndGetQueueConfigs(this.serviceName, QueueConfigType.Internal)

        this.internalQueue = new RabbitMQProvider(
            this.serviceName,
            internal,
            serviceConfig,
            topicConfig,
            QueueConfigType.Internal,
            this.logger,
            this.asyncLocalStorage,
            queueConfig,
        )

        return this.internalQueue
    }

    getExternalQueue(): RabbitMQProvider {
        if (this.externalQueue) {
            return this.externalQueue
        }

        const { external, localServiceConfig } = this.connectionConfig
        const { serviceConfig, topicConfig } = Utils.validateAndGetQueueConfigs(
            this.serviceName,
            QueueConfigType.External,
            localServiceConfig,
        )

        this.externalQueue = new RabbitMQProvider(
            this.serviceName,
            external,
            serviceConfig,
            topicConfig,
            QueueConfigType.External,
            this.logger,
            this.asyncLocalStorage,
        )

        return this.externalQueue
    }
}
