import Logger from '@diia-inhouse/diia-logger'
import { ValidationSchema } from '@diia-inhouse/validators'

import { EventBusListener, QueueMessageMetaData } from '@interfaces/index'
import { EventName } from '@interfaces/queueConfig'

export class ReceiveEventListener implements EventBusListener {
    readonly isSync = true

    readonly validationRules: ValidationSchema = {
        data: { type: 'string' },
    }

    constructor(
        private readonly logger: Logger,
        readonly event: EventName,
    ) {}

    async handler(payload: unknown, meta: QueueMessageMetaData): Promise<void> {
        this.logger.info('Received payload', { payload, meta })
    }
}
