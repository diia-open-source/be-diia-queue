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

    async receiveDirect<T>(event: string, request: unknown = {}, ops: ReceiveDirectOps): Promise<T> {
        const { exchangeName, validationRules, ignoreCache, retry, timeout, registryApiVersion, requestUuid = randomUUID() } = ops

        const payload: MessagePayload = { uuid: requestUuid, request }

        const options: PublishDirectOptions = { ignoreCache, retry, timeout, exchangeName, registryApiVersion }
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
