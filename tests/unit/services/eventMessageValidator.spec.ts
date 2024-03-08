import { appValidator } from '../mocks'

import { EventMessageValidator, QueueMessageData } from '@src/index'

describe('EventMessageValidator', () => {
    describe('method: `validateEventMessage`', () => {
        const eventMessageValidator = new EventMessageValidator(appValidator)
        const date = new Date()

        it('should successfully validate event message', () => {
            const message: QueueMessageData = {
                event: 'event',
                meta: {
                    date,
                },
                payload: {
                    key: 'value',
                },
            }

            const spy = jest.spyOn(appValidator, 'validate')

            eventMessageValidator.validateEventMessage(message, {})

            expect(spy).toHaveBeenCalledWith(message, {
                event: { type: 'string' },
                payload: { type: 'object', props: {} },
                meta: {
                    type: 'object',
                    props: {
                        date: { type: 'date', convert: true },
                        traceId: { type: 'string', optional: true },
                    },
                },
            })
        })
    })
    describe('method: `validateSyncedEventMessage`', () => {
        const eventMessageValidator = new EventMessageValidator(appValidator)
        const date = new Date()

        it('should successfully validate event message', () => {
            const message: QueueMessageData = {
                event: 'event',
                meta: {
                    date,
                },
                payload: {
                    key: 'value',
                },
            }

            const spy = jest.spyOn(appValidator, 'validate')

            eventMessageValidator.validateSyncedEventMessage(message, {})

            expect(spy).toHaveBeenCalledWith(message, {
                event: {
                    type: 'string',
                },
                payload: {
                    type: 'object',
                    props: {
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
                        response: { type: 'object', optional: true, props: {} },
                    },
                },
                meta: {
                    type: 'object',
                    props: {
                        date: { type: 'date', convert: true },
                        traceId: { type: 'string', optional: true },
                    },
                },
            })
        })
    })
})
