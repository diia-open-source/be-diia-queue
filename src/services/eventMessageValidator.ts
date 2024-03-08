import { AppValidator, ValidationSchema } from '@diia-inhouse/validators'

import { QueueMessageData } from '../interfaces'

export class EventMessageValidator {
    readonly metaValidationSchema: ValidationSchema = {
        date: { type: 'date', convert: true },
        traceId: { type: 'string', optional: true },
    }

    constructor(private readonly validator: AppValidator) {}

    validateEventMessage(data: QueueMessageData, payloadValidationSchema: ValidationSchema = {}): void | never {
        const validationSchema: ValidationSchema = {
            event: { type: 'string' },
            payload: { type: 'object', props: payloadValidationSchema },
            meta: {
                type: 'object',
                props: this.metaValidationSchema,
            },
        }

        this.validator.validate(data, validationSchema)
    }

    validateSyncedEventMessage(data: QueueMessageData, responseValidationSchema?: ValidationSchema): void | never {
        const validation: ValidationSchema = {
            uuid: { type: 'uuid' },
            error: {
                type: 'object',
                optional: true,
                props: {
                    http_code: { type: 'number' },
                    message: { type: 'string', optional: true },
                    data: { type: 'object', optional: true },
                },
            },
        }
        if (responseValidationSchema) {
            validation.response = { type: 'object', optional: true, props: responseValidationSchema }
        }

        this.validateEventMessage(data, validation)
    }
}
