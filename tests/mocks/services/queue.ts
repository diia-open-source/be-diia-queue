import { validRabbitMQConfig } from '../../mocks/providers/rabbitmq'

import { QueueConfigType, QueueConnectionConfig } from '@interfaces/index'

export const connectOptions: QueueConnectionConfig = {
    serviceRulesConfig: {
        portalEvents: [],
        internalEvents: [],
        queuesConfig: {
            [QueueConfigType.Internal]: {},
        },
        servicesConfig: {
            [QueueConfigType.Internal]: {},
            [QueueConfigType.External]: { publish: [], subscribe: [] },
        },
        topicsConfig: {
            [QueueConfigType.Internal]: {},
            [QueueConfigType.External]: {},
        },
    },
    internal: { ...validRabbitMQConfig },
}
