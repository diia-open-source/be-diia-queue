import { Counter, MetricsService, RequestMechanism, RequestStatus } from '@diia-inhouse/diia-metrics'
import { TotalRequestsLabelsMap } from '@diia-inhouse/diia-metrics/dist/types/interfaces/metrics'
import { ErrorType } from '@diia-inhouse/errors'

import { CommunicationDirection, CommunicationsTotalLabelsMap, Metrics, communicationsTotalLabelsMap } from '../interfaces/metrics'

export default class RabbitMQMetricsService {
    private readonly communicationsTotalMetric = new Counter<CommunicationsTotalLabelsMap>(
        Metrics.CommunicationsTotal,
        communicationsTotalLabelsMap,
        'Total rabbitmq communications made by service',
    )

    constructor(private metrics: MetricsService) {}

    collectResponseTotalMetric(startTime: bigint, route: string, source: string, destination: string, errorType?: ErrorType): void | never {
        const labels: TotalRequestsLabelsMap = {
            route,
            source,
            ...(errorType ? { errorType } : {}),
            destination,
            mechanism: RequestMechanism.Rabbitmq,
            status: errorType ? RequestStatus.Failed : RequestStatus.Successful,
        }

        const finishTime = process.hrtime.bigint()
        const delta = finishTime - startTime

        this.metrics.responseTotalTimerMetric.observeSeconds(labels, delta)
    }

    collectCommunicationsTotalMetric(
        event: string,
        source: string,
        destination: string,
        direction: CommunicationDirection,
        queue?: string,
    ): void {
        const labels: CommunicationsTotalLabelsMap = {
            event,
            source,
            destination,
            direction,
            ...(queue ? { queue } : {}),
        }

        this.communicationsTotalMetric.increment(labels, 1)
    }

    collectRequestTotalMetric(startTime: bigint, route: string, source: string, destination: string, errorType?: ErrorType): void {
        const finishTime = process.hrtime.bigint()
        const delta = finishTime - startTime

        const labels: TotalRequestsLabelsMap = {
            route,
            source,
            destination,
            mechanism: RequestMechanism.Rabbitmq,
            status: errorType ? RequestStatus.Failed : RequestStatus.Successful,
            ...(errorType ? { errorType } : {}),
        }

        this.metrics.totalTimerMetric.observeSeconds(labels, delta)
    }
}
