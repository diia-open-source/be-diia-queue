import {
    EventBus,
    EventMessageHandler,
    EventMessageValidator,
    ExternalCommunicator,
    ExternalCommunicatorChannel,
    ExternalEventBus,
    Queue,
    ScheduledTask,
    Task,
} from '../services'

export type CommonQueueDeps = {
    queue: Queue
    eventMessageHandler: EventMessageHandler
    eventMessageValidator: EventMessageValidator
    externalChannel: ExternalCommunicatorChannel
}

export type InternalQueueDeps = {
    eventBus?: EventBus
    task?: Task
    scheduledTask?: ScheduledTask
}

export type ExternalQueueDeps = {
    externalEventBus: ExternalEventBus
    external: ExternalCommunicator
}

export type QueueDeps = CommonQueueDeps & InternalQueueDeps & ExternalQueueDeps
