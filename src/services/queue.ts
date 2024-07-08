import { AsyncLocalStorage } from 'node:async_hooks'

import { HealthCheckResult, HttpStatusCode, Logger, OnHealthCheck } from '@diia-inhouse/types'

import { ConnectionStatus, QueueConnectionConfig, QueueContext } from '../interfaces'
import { QueueConfigType } from '../interfaces/queueConfig'
import { QueueStatus } from '../interfaces/queueStatus'
import { RabbitMQProvider } from '../providers/rabbitmq'

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

        const queueStatuses = [internalQueueStatus, externalQueueStatus].filter(Boolean).flatMap((status) => Object.values(status))

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

        const {
            internal,
            serviceRulesConfig: { queuesConfig, servicesConfig, topicsConfig, internalEvents },
        } = this.connectionConfig

        this.internalQueue = new RabbitMQProvider(
            this.serviceName,
            internal,
            servicesConfig[QueueConfigType.Internal],
            topicsConfig[QueueConfigType.Internal],
            [],
            internalEvents,
            QueueConfigType.Internal,
            this.logger,
            this.asyncLocalStorage,
            queuesConfig[QueueConfigType.Internal],
        )

        return this.internalQueue
    }

    getExternalQueue(): RabbitMQProvider {
        if (this.externalQueue) {
            return this.externalQueue
        }

        const {
            external,
            serviceRulesConfig: { portalEvents, servicesConfig, topicsConfig, internalEvents },
        } = this.connectionConfig

        this.externalQueue = new RabbitMQProvider(
            this.serviceName,
            external,
            servicesConfig[QueueConfigType.External],
            topicsConfig[QueueConfigType.External],
            portalEvents,
            internalEvents,
            QueueConfigType.External,
            this.logger,
            this.asyncLocalStorage,
        )

        return this.externalQueue
    }
}
