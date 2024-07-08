import { EventBus } from '../services/eventBus'
import { EventMessageHandler } from '../services/eventMessageHandler'
import { EventMessageValidator } from '../services/eventMessageValidator'
import { ExternalCommunicator } from '../services/externalCommunicator'
import { ExternalCommunicatorChannel } from '../services/externalCommunicatorChannel'
import { ExternalEventBus } from '../services/externalEventBus'
import { Queue } from '../services/queue'
import { ScheduledTask } from '../services/scheduledTask'
import { Task } from '../services/task'

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
