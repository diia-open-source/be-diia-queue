import { HttpStatusCode } from '@diia-inhouse/types'
import { ValidationSchema } from '@diia-inhouse/validators'

import { ExchangeName } from './messageBrokerServiceConfig'

export interface ReceiveDirectOps {
    registryApiVersion?: string
    exchangeName?: ExchangeName
    validationRules: ValidationSchema | null
    ignoreCache?: boolean
    retry?: boolean
    timeout?: number
    requestUuid?: string
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
