import { EventBusListener, EventListeners } from './interfaces'

export function collectEventBusListeners(eventBusListeners: EventBusListener[]): EventListeners {
    const eventListeners: EventListeners = {}

    for (const listener of eventBusListeners) {
        eventListeners[listener.event] = listener
    }

    return eventListeners
}

export function getConsumerTag(serviceName: string, hostname: string): string {
    return `${serviceName}:${hostname}`
}
