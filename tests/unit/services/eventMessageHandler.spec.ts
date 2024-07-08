import { randomUUID } from 'node:crypto'

import { ValidationError } from '@diia-inhouse/errors'

import { validMessage } from '../../mocks/services/eventMessageHandler'
import {
    asyncLocalStorage,
    eventListener,
    eventMessageHandler,
    eventMessageValidator,
    channel as externalChannel,
    logger,
    pubSubService,
} from '../mocks'

describe('EventMessageHandler', () => {
    describe('method: `eventListenersMessageHandler`', () => {
        it('should return undefined for empty response', async () => {
            const eventListeners = {
                acquirersOfferRequestHasDeleted: eventListener,
            }

            expect(await eventMessageHandler.eventListenersMessageHandler(eventListeners, null)).toBeUndefined()
        })

        it('should call validMessage.done', async () => {
            jest.spyOn(asyncLocalStorage, 'run').mockImplementationOnce(async (_ctx, runner) => {
                await runner()
            })

            const eventListeners = {
                acquirersOfferRequestHasDeleted: eventListener,
            }

            expect(await eventMessageHandler.eventListenersMessageHandler(eventListeners, validMessage)).toBeUndefined()

            expect(logger.info).toHaveBeenCalledWith(`No listener for the event [authUserLogOut]`)
            expect(validMessage.done).toHaveBeenCalledWith()
        })
    })

    describe('method: `eventListenerMessageHandler`', () => {
        it('should skip to handle message in case listener was not provided', async () => {
            jest.spyOn(asyncLocalStorage, 'run').mockImplementationOnce(async (_ctx, runner) => {
                await runner()
            })

            await eventMessageHandler.eventListenerMessageHandler(undefined, validMessage)

            expect(logger.info).toHaveBeenCalledWith(`No listener for the event [authUserLogOut]`)
            expect(validMessage.done).toHaveBeenCalledWith()
        })

        describe('listener.isSync === true', () => {
            const channel = randomUUID()

            it('should skip to run event listener message handler in case payload uuid is not provided', async () => {
                const message = {
                    ...validMessage,
                    data: {
                        ...validMessage.data,
                        payload: {
                            key: 'value',
                        },
                    },
                }

                jest.spyOn(asyncLocalStorage, 'run').mockImplementationOnce(async (_ctx, runner) => {
                    await runner()
                })
                eventListener.isSync = true

                await eventMessageHandler.eventListenerMessageHandler(eventListener, message)

                expect(logger.error).toHaveBeenCalledWith('Missing uuid in the message payload')
                expect(validMessage.done).toHaveBeenCalledWith()
            })

            it('should skip to run event listener message handler in case message is invalid', async () => {
                const thrownError = new Error('Invalid input message format')
                const { data, done } = validMessage
                const {
                    event,
                    payload: { uuid },
                } = data
                const validationRules = {}

                jest.spyOn(asyncLocalStorage, 'run').mockImplementationOnce(async (_ctx, runner) => {
                    await runner()
                })
                eventListener.isSync = true
                jest.spyOn(externalChannel, 'getChannel').mockReturnValueOnce(channel)
                jest.spyOn(externalChannel, 'isChannelActive').mockResolvedValueOnce(false)
                jest.spyOn(eventMessageValidator, 'validateSyncedEventMessage').mockImplementationOnce(() => {
                    throw thrownError
                })

                await eventMessageHandler.eventListenerMessageHandler(eventListener, validMessage)

                expect(externalChannel.getChannel).toHaveBeenCalledWith(event, uuid)
                expect(externalChannel.isChannelActive).toHaveBeenCalledWith(channel)
                expect(eventMessageValidator.validateSyncedEventMessage).toHaveBeenCalledWith(data, validationRules)
                expect(logger.error).toHaveBeenCalledWith(`Message in a wrong format was received from a synced event: ${event}`, {
                    err: thrownError,
                })
                expect(done).toHaveBeenCalledWith()
            })

            it('should skip to run event listener message handler in case message payload contains error', async () => {
                const payloadError = new Error('Internal error')
                const message = {
                    ...validMessage,
                    data: {
                        ...validMessage.data,
                        payload: {
                            ...validMessage.data.payload,
                            error: payloadError,
                        },
                    },
                }
                const { data } = message
                const {
                    event,
                    payload: { uuid },
                } = data
                const validationRules = {}

                jest.spyOn(asyncLocalStorage, 'run').mockImplementationOnce(async (_ctx, runner) => {
                    await runner()
                })
                eventListener.isSync = true
                jest.spyOn(externalChannel, 'getChannel').mockReturnValueOnce(channel)
                jest.spyOn(externalChannel, 'isChannelActive').mockResolvedValueOnce(false)
                jest.spyOn(eventMessageValidator, 'validateSyncedEventMessage').mockReturnValueOnce()

                await eventMessageHandler.eventListenerMessageHandler(eventListener, message)

                expect(externalChannel.getChannel).toHaveBeenCalledWith(event, uuid)
                expect(externalChannel.isChannelActive).toHaveBeenCalledWith(channel)
                expect(eventMessageValidator.validateSyncedEventMessage).toHaveBeenCalledWith(data, validationRules)
                expect(logger.error).toHaveBeenCalledWith(`Error received for a synced event: ${event}`, payloadError)
                expect(validMessage.done).toHaveBeenCalledWith()
            })

            it('should just log error in case event message handler rejects', async () => {
                const rejectedError = new Error('Internal error')
                const { data, done } = validMessage
                const {
                    event,
                    payload: { uuid },
                    meta,
                } = data
                const { payload } = data
                const validationRules = {}

                jest.spyOn(asyncLocalStorage, 'run').mockImplementationOnce(async (_ctx, runner) => {
                    await runner()
                })
                eventListener.isSync = true
                jest.spyOn(externalChannel, 'getChannel').mockReturnValueOnce(channel)
                jest.spyOn(externalChannel, 'isChannelActive').mockResolvedValueOnce(false)
                jest.spyOn(eventMessageValidator, 'validateSyncedEventMessage').mockReturnValueOnce()
                eventListener.handler.mockRejectedValueOnce(rejectedError)

                await eventMessageHandler.eventListenerMessageHandler(eventListener, validMessage)

                expect(externalChannel.getChannel).toHaveBeenCalledWith(event, uuid)
                expect(externalChannel.isChannelActive).toHaveBeenCalledWith(channel)
                expect(eventMessageValidator.validateSyncedEventMessage).toHaveBeenCalledWith(data, validationRules)
                expect(eventListener.handler).toHaveBeenCalledWith(payload, meta)
                expect(logger.error).toHaveBeenCalledWith(`Failed to handle the synced event [${event}] with payload`, {
                    err: rejectedError,
                })
                expect(done).toHaveBeenCalledWith()
            })

            it('should successfully handle event message', async () => {
                const { data, done } = validMessage
                const {
                    event,
                    payload: { uuid },
                    meta,
                } = data
                const { payload } = data
                const validationRules = {}

                jest.spyOn(asyncLocalStorage, 'run').mockImplementationOnce(async (_ctx, runner) => {
                    await runner()
                })
                eventListener.isSync = true
                jest.spyOn(externalChannel, 'getChannel').mockReturnValueOnce(channel)
                jest.spyOn(externalChannel, 'isChannelActive').mockResolvedValueOnce(false)
                jest.spyOn(eventMessageValidator, 'validateSyncedEventMessage').mockReturnValueOnce()
                eventListener.handler.mockResolvedValueOnce({})

                await eventMessageHandler.eventListenerMessageHandler(eventListener, validMessage)

                expect(externalChannel.getChannel).toHaveBeenCalledWith(event, uuid)
                expect(externalChannel.isChannelActive).toHaveBeenCalledWith(channel)
                expect(eventMessageValidator.validateSyncedEventMessage).toHaveBeenCalledWith(data, validationRules)
                expect(eventListener.handler).toHaveBeenCalledWith(payload, meta)
                expect(done).toHaveBeenCalledWith()
            })

            it('should successfully publish message in case channel is active', async () => {
                const { data, done } = validMessage
                const {
                    event,
                    payload: { uuid },
                } = data

                jest.spyOn(asyncLocalStorage, 'run').mockImplementationOnce(async (_ctx, runner) => {
                    await runner()
                })
                eventListener.isSync = true
                jest.spyOn(externalChannel, 'getChannel').mockReturnValueOnce(channel)
                jest.spyOn(externalChannel, 'isChannelActive').mockResolvedValueOnce(true)
                jest.spyOn(pubSubService, 'publish').mockResolvedValueOnce(1)

                await eventMessageHandler.eventListenerMessageHandler(eventListener, validMessage)

                expect(externalChannel.getChannel).toHaveBeenCalledWith(event, uuid)
                expect(externalChannel.isChannelActive).toHaveBeenCalledWith(channel)
                expect(pubSubService.publish).toHaveBeenCalledWith(channel, data)
                expect(done).toHaveBeenCalledWith()
            })
        })

        describe('listener.isSync === false', () => {
            it('should successfully run event listener message handler', async () => {
                jest.spyOn(asyncLocalStorage, 'run').mockImplementationOnce(async (_ctx, runner) => {
                    await runner()
                })
                eventListener.handler.mockResolvedValue({ success: true })
                eventListener.isSync = false
                await eventMessageHandler.eventListenerMessageHandler(eventListener, validMessage)
                expect(validMessage.done).toHaveBeenCalledWith({
                    event: validMessage.data.event,
                    meta: {
                        date: expect.any(Date),
                    },
                    payload: {
                        uuid: validMessage.data.payload.uuid,
                        response: { success: true },
                    },
                })
            })

            it('should successfully run event listener message rejected', async () => {
                jest.spyOn(asyncLocalStorage, 'run').mockImplementationOnce(async (_ctx, runner) => {
                    await runner()
                })
                eventListener.handler.mockRejectedValueOnce(new ValidationError())
                eventListener.validationErrorHandler.mockResolvedValueOnce({
                    catch: jest.fn(),
                })
                eventListener.isSync = false
                await eventMessageHandler.eventListenerMessageHandler(eventListener, validMessage)
                expect(validMessage.done).toHaveBeenCalledWith({
                    event: validMessage.data.event,
                    meta: {
                        date: expect.any(Date),
                    },
                    payload: {
                        uuid: validMessage.data.payload.uuid,
                        error: {
                            http_code: 422,
                            message: 'Parameter validation error',
                            data: { errors: null },
                        },
                    },
                })
            })
        })
    })
})
