import { HttpStatusCode } from '@diia-inhouse/types'
import { ValidationSchema } from '@diia-inhouse/validators'

import { ExchangeName } from './messageBrokerServiceConfig.js'

/**
 * Options for {@link ExternalCommunicator.receiveDirect}.
 */
export interface ReceiveDirectOps {
    /**
     * Forwarded in the message meta; consumed by `AGateway` to route the
     * request to a specific registry API version.
     */
    registryApiVersion?: string
    /**
     * Override the target exchange. Defaults to the exchange resolved from the
     * external queue configuration for the given event.
     */
    exchangeName?: ExchangeName
    /**
     * Schema describing the **inner** `response` payload. The validator wraps
     * it with the envelope shape (`event`, `payload.uuid`, `payload.error`,
     * `meta.date`, etc.) automatically — so pass just the fields you expect
     * inside `response`, not the envelope itself.
     *
     * Null is acceptable only for legacy use cases.
     */
    validationRules: ValidationSchema | null
    /** Bypass response caching on the subscriber side if configured. */
    ignoreCache?: boolean
    /**
     * Override the default direct-response timeout (ms). Falls back to the
     * publisher's configured `directResponseTimeout` (10s by default).
     */
    timeout?: number
    /**
     * Defaults to a freshly generated `randomUUID()` when omitted.
     */
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
