import { HttpStatusCode } from '@diia-inhouse/types'
import { ValidationSchema } from '@diia-inhouse/validators'

import { EventBusListener } from './eventBus'
import { EventName, Topic } from './queueConfig'

export type EventListeners = Partial<Record<EventName, EventBusListener>>

export interface ReceiveOps {
    timeout?: number
    async?: boolean
    requestUuid?: string
    ignoreCache?: boolean
    retry?: boolean
}

export interface ReceiveDirectOps {
    topic?: Topic
    validationRules?: ValidationSchema
    ignoreCache?: boolean
    retry?: boolean
    timeout?: number
}

export interface ExternalCommunicatorResponseError {
    http_code: HttpStatusCode
    message?: string
    data?: Record<string, unknown>
}

export interface ExternalCommunicatorSuccessResponse<T> {
    uuid: string
    response: T
    error: never
}

export interface ExternalCommunicatorFailureResponse {
    uuid: string
    error?: ExternalCommunicatorResponseError
    response: never
}

export type ExternalCommunicatorResponse<T> = ExternalCommunicatorSuccessResponse<T> | ExternalCommunicatorFailureResponse
