import { Counter } from '@diia-inhouse/diia-metrics'

import { TotalListenerChannelErrorsLabelsMap } from '../interfaces/metrics'

export const totalListenerChannelErrorsMetric = new Counter<TotalListenerChannelErrorsLabelsMap>('listener_channel_errors_total', [
    'queueName',
])
