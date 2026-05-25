import { EventBus } from '../services/eventBus.js'
import { EventMessageHandler } from '../services/eventMessageHandler.js'
import { EventMessageValidator } from '../services/eventMessageValidator.js'
import { ExternalCommunicator } from '../services/externalCommunicator.js'
import { ExternalEventBus } from '../services/externalEventBus.js'
import { Queue } from '../services/queue.js'
import { ScheduledTask } from '../services/scheduledTask.js'
import { Task } from '../services/task.js'

export type CommonQueueDeps = {
    queue: Queue
    eventMessageHandler: EventMessageHandler
    eventMessageValidator: EventMessageValidator
}

export type InternalQueueDeps = {
    eventBus?: EventBus
    task?: Task
    /**
     * @deprecated use pkg-workflow entities instead
     */
    scheduledTask?: ScheduledTask
}

export type ExternalQueueDeps = {
    externalEventBus: ExternalEventBus
    external: ExternalCommunicator
}

export type QueueDeps = CommonQueueDeps & InternalQueueDeps & ExternalQueueDeps
