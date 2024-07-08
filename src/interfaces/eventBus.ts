import { ValidationError } from '@diia-inhouse/errors'
import { ValidationSchema } from '@diia-inhouse/validators'

import { MessageHandler } from './messageHandler'
import { PublishInternalEventOptions, SubscribeOptions } from './options'
import { MessagePayload, QueueMessageMetaData } from './providers/rabbitmq'
import { EventName, QueueName } from './queueConfig/configs'

export interface EventBusQueue {
    subscribe(subscriptionName: QueueName, messageHandler: MessageHandler, options?: SubscribeOptions): Promise<boolean>

    publish(eventName: EventName, message: MessagePayload, options?: PublishInternalEventOptions): Promise<boolean>
}

export interface EventBusListener {
    event: EventName
    /** @deprecated use receive direct mechanism */
    isSync?: boolean
    validationRules?: ValidationSchema
    validationErrorHandler?(error: ValidationError, uuid: string): Promise<void>
    getServiceCode?(payload: unknown): string
    handler?(payload: unknown, meta: QueueMessageMetaData): Promise<unknown | void>
}
