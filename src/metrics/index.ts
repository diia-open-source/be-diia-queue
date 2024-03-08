import { Counter } from '@diia-inhouse/diia-metrics'

import { TotalListenerChannelErrorsLabelsMap, TotalMessageHandlerErrorsLabelsMap } from '../interfaces/metrics'

export const totalListenerChannelErrorsMetric = new Counter<TotalListenerChannelErrorsLabelsMap>('listener_channel_errors_total', [
    'queueName',
])

export const totalMessageHandlerErrorsMetrics = new Counter<TotalMessageHandlerErrorsLabelsMap>('message_handler_errors_total', ['event'])
