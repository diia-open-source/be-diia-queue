import { EventBusListener } from './interfaces/eventBus'
import { EventListeners } from './interfaces/externalCommunicator'

export function collectEventBusListeners(eventBusListeners: EventBusListener[]): EventListeners {
    const eventListeners: EventListeners = {}

    for (const listener of eventBusListeners) {
        eventListeners[listener.event] = listener
    }

    return eventListeners
}
