import _ from 'lodash'
import { mock } from 'vitest-mock-extended'

import DiiaLogger from '@diia-inhouse/diia-logger'
import { MetricsConfig, MetricsService } from '@diia-inhouse/diia-metrics'

import RabbitMQMetricsService from '@services/metrics'

const defaultMetricsConfig: MetricsConfig = {
    disableDefaultMetrics: true,
    disabled: true,
    pushGateway: {
        isEnabled: true,
        url: 'http://localhost:9091',
    },
}

const loggerMock: DiiaLogger = mock<DiiaLogger>()

export function makeMockMetricsService(metricsConfig?: Partial<MetricsService>): MetricsService {
    const config: MetricsConfig = _.merge(defaultMetricsConfig, metricsConfig)

    return new MetricsService(loggerMock, config, 'TestService')
}

export function makeMockRabbitMQMetricsService(metricsConfig?: Partial<MetricsService>): RabbitMQMetricsService {
    const metrics = makeMockMetricsService(metricsConfig)

    return new RabbitMQMetricsService(metrics)
}
