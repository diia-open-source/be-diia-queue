import { AggregatedQueueConfigs, EventBusListener } from './interfaces'
import { EventListeners } from './interfaces/externalCommunicator'
import { QueueConfigByQueueName, QueueConfigType, ServiceConfigByConfigType, TopicConfigByConfigType } from './interfaces/queueConfig'
import { queuesConfig, servicesConfig, topicsConfig } from './queueConfig/configs'

export function collectEventBusListeners(eventBusListeners: EventBusListener[]): EventListeners {
    const eventListeners: EventListeners = {}

    eventBusListeners.forEach((listener) => {
        eventListeners[listener.event] = listener
    })

    return eventListeners
}

export function validateAndGetQueueConfigs(
    serviceName: string,
    queueConfigType: QueueConfigType,
    localServicesConfig?: ServiceConfigByConfigType,
): AggregatedQueueConfigs | never {
    let serviceConfig: ServiceConfigByConfigType = servicesConfig?.[queueConfigType]?.[serviceName]
    const queueConfig: QueueConfigByQueueName = queuesConfig?.[queueConfigType]
    const topicConfig: TopicConfigByConfigType = topicsConfig?.[queueConfigType]

    if (localServicesConfig) {
        serviceConfig = localServicesConfig?.[queueConfigType]
    }

    if (!serviceConfig || !topicsConfig || (queueConfigType === QueueConfigType.Internal && !queuesConfig)) {
        const errorMessage = `Service queue config type [${queueConfigType}] is not implemented`

        throw Error(errorMessage)
    }

    return { serviceConfig, queueConfig, topicConfig }
}
