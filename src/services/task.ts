import { Logger, OnInit } from '@diia-inhouse/types'

import { MessageHandler, MessagePayload, SubscribeOptions, TaskListener, TaskQueue } from '../interfaces'
import { RabbitMQProvider } from '../providers/rabbitmq'

import { EventMessageHandler } from './eventMessageHandler'

export class Task implements TaskQueue, OnInit {
    constructor(
        private readonly queueProvider: RabbitMQProvider,
        private readonly taskList: TaskListener[],
        private readonly eventMessageHandler: EventMessageHandler,
        private readonly logger: Logger,
    ) {}

    private readonly tasksMap: Map<string, TaskListener> = new Map()

    async onInit(): Promise<void> {
        await this.queueProvider.init?.()
        if (!this.taskList.length) {
            return
        }

        this.logger.info('Start Tasks listener initialization')

        for (const task of this.taskList) {
            await this.subscribeTask(task)

            this.tasksMap.set(task.name, task)
        }
    }

    subscribe(taskName: string, messageHandler: MessageHandler, options?: SubscribeOptions): Promise<boolean> {
        return this.queueProvider.subscribeTask(this.getTaskQueueName(taskName), messageHandler, options)
    }

    publish(taskName: string, payload: MessagePayload, delay?: number): Promise<boolean> {
        if (delay) {
            const task = this.tasksMap.get(taskName)
            if (task && !task.isDelayed) {
                throw new Error('Delay option could be used only with delayed tasks')
            }
        }

        const queueName = this.getTaskQueueName(taskName)

        return this.queueProvider.publishTask(queueName, payload, delay)
    }

    private async subscribeTask(task: TaskListener): Promise<void> {
        await this.subscribe(task.name, this.eventMessageHandler.eventListenerMessageHandler.bind(this.eventMessageHandler, task), {
            delayed: task.isDelayed || false,
        })
    }

    private getTaskQueueName(taskName: string): string {
        return `TasksQueue${this.capitalizeFirstLetter(this.queueProvider.getServiceName())}[${taskName}]`
    }

    private capitalizeFirstLetter(s: string): string {
        return s
            .split('-')
            .map((str: string) => str.charAt(0).toUpperCase() + str.slice(1))
            .join('')
    }
}
