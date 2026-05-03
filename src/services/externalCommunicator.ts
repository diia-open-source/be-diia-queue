import { randomUUID } from 'node:crypto'

import Logger from '@diia-inhouse/diia-logger'
import { ExternalCommunicatorError } from '@diia-inhouse/errors'

import { ExternalEventBusQueue, MessagePayload, PublishDirectOptions, QueueMessageData } from '../interfaces'
import { ExternalCommunicatorResponse, ReceiveDirectOps } from '../interfaces/externalCommunicator'
import { EventMessageValidator } from './eventMessageValidator'

export class ExternalCommunicator {
    constructor(
        private readonly externalEventBus: ExternalEventBusQueue,
        private readonly eventMessageValidator: EventMessageValidator,
        private readonly logger: Logger,
    ) {}

    /**
     * Synchronous request/response over the external event bus.
     *
     * Publishes `event` to the configured external exchange wrapped as
     * `{ uuid, request }` and awaits the subscriber's response on the same call.
     * The response envelope is validated against `ops.validationRules`, and any embedded error is rethrown as
     * {@link ExternalCommunicatorError}.
     *
     * Use this when the caller needs the response inline (e.g. a user-facing
     * request that must block on `AGateway`). For fire-and-forget or fan-out
     * flows, use the `default` publish + listener pattern instead.
     *
     * ### Transport
     *
     * Implemented on top of RabbitMQ's
     * [direct reply-to](https://www.rabbitmq.com/docs/direct-reply-to)
     * feature: the publisher consumes the pseudo-queue
     * `amq.rabbitmq.reply-to` and stamps each request with `replyTo` +
     * `correlationId`. The subscriber publishes its response back to that
     * `replyTo` on the default exchange, and this call resolves when the
     * matching `correlationId` arrives. No reply queue is declared per
     * request, so there is no per-call broker setup overhead.
     *
     * ### Response contract
     *
     * The subscriber must respond with an
     * {@link ExternalCommunicatorResponse} envelope:
     *
     * ```ts
     * { uuid: string, response: T, error?: { http_code, message?, data? } }
     * ```
     *
     * On success this method returns **only the `response` field** typed as
     * `T` — the wrapping `uuid` and the envelope itself are not exposed to
     * the caller. Therefore `T` should describe the shape of `response`, not
     * of the full envelope.
     *
     * ### Error contract
     *
     * Errors travel through the same envelope (`error` field on the
     * subscriber's response — this is **not** a transport-level failure),
     * but on the caller side they are surfaced as a thrown
     * {@link ExternalCommunicatorError} instead of being returned. The
     * envelope's `error` payload is mapped onto the exception so no data is
     * lost:
     *
     * - `error.message` → `Error.message` (falls back to `'unknown error'`
     *   when missing).
     * - `error.http_code` → exception's status code (read via `getCode()`).
     * - `error.data` → exception's data bag (read via `getData()`), spread
     *   alongside `event` (the event name) and `httpCode` (a duplicate of
     *   the status code, kept on `data` for downstream consumers).
     *
     * Callers that need to inspect the original status or payload should
     * `catch` the error and read those fields:
     *
     * ```ts
     * try {
     *     await externalCommunicator.receiveDirect<T>(event, req, ops)
     * } catch (err) {
     *     if (err instanceof ExternalCommunicatorError) {
     *         err.getCode() // original error.http_code
     *         err.getData() // { event, httpCode, ...error.data }
     *         err.message   // error.message || 'unknown error'
     *     }
     *     throw err
     * }
     * ```
     *
     * @typeParam T - shape of the successful `response` payload returned by the subscriber.
     * @param event - external event name. Must be declared in
     *     `serviceRulesConfig.topicsConfig[QueueConfigType.External][topicName].events[]`
     *     so the event resolves to an exchange (or pass `ops.exchangeName`
     *     to override the lookup).
     * @param request - payload forwarded to the subscriber. Defaults to `{}`.
     * @param ops - direct-call options. See {@link ReceiveDirectOps}.
     * @returns the subscriber's `response` field, typed as `T`. The envelope's
     *     `uuid` and `error` fields are not returned.
     *
     * @throws {ExternalCommunicatorError} when the subscriber responds with an
     *     `error` envelope. The original `http_code`, `message`, and `data`
     *     fields are preserved on the thrown error.
     * @throws {Error} `'Message in a wrong format was received from a direct channel'`
     *     when `validationRules` are provided and the response fails validation.
     *
     * @example
     * ```ts
     * const result = await externalCommunicator.receiveDirect<{ data: string }>(
     *     'notary.lookup',
     *     { notaryCertificateNumber: '1234', requestId: '-0' },
     *     {
     *         // Describes the inner `response` only; the envelope (uuid,
     *         // error, meta, ...) is wrapped by the validator.
     *         validationRules: { data: { type: 'string' } },
     *         timeout: DurationMs.Second * 5,
     *     },
     * )
     * ```
     */
    async receiveDirect<T>(event: string, request: unknown = {}, ops: ReceiveDirectOps): Promise<T> {
        const { exchangeName, validationRules, ignoreCache, timeout, registryApiVersion, requestUuid = randomUUID() } = ops

        const payload: MessagePayload = { uuid: requestUuid, request }

        const options: PublishDirectOptions = { ignoreCache, timeout, exchangeName, registryApiVersion }
        const externalResponse = await this.externalEventBus.publishDirect<QueueMessageData<ExternalCommunicatorResponse<T>>>(
            event,
            payload,
            options,
        )

        this.logger.debug('External direct response', externalResponse)
        if (validationRules) {
            try {
                this.eventMessageValidator.validateSyncedEventMessage(externalResponse, validationRules)
            } catch (err) {
                const errorMsg = 'Message in a wrong format was received from a direct channel'

                this.logger.error(errorMsg, { err, externalResponse })
                throw new Error(errorMsg)
            }
        }

        const { error, response } = externalResponse.payload

        if (error) {
            this.logger.error(`Error received by an external event ${event}: ${error.http_code} ${error.message}`, { requestUuid })

            const errMsg = error.message || 'unknown error'

            throw new ExternalCommunicatorError(errMsg, error.http_code, { event, httpCode: error.http_code, ...error.data })
        }

        return response
    }
}
