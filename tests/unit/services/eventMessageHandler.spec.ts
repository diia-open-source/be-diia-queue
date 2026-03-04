import { mock } from 'vitest-mock-extended'

import { ValidationError } from '@diia-inhouse/errors'

import { EventBusListener, NackOptions, QueueMessageData } from '@src/interfaces'

import { TestEventBusListener } from '@mocks/eventBusListeners/eventBusListeners'
import { getExpectedMsgData } from '@mocks/providers/rabbitmq/amqpPublisher'

import { queueMessage, validMessage } from '../../mocks/services/eventMessageHandler'
import { asyncLocalStorage, eventListener, eventMessageHandler, eventMessageValidator, logger } from '../mocks'

describe('EventMessageHandler', () => {
    describe('method: `eventListenersMessageHandler`', () => {
        it('should return undefined for empty response', async () => {
            // Arrange
            const eventListeners = {
                acquirersOfferRequestHasDeleted: eventListener,
            }

            // Act
            const result = await eventMessageHandler.eventListenersMessageHandler(eventListeners, null)

            // Assert
            expect(result).toBeUndefined()
        })

        it('should call validMessage.done', async () => {
            // Arrange
            vi.spyOn(asyncLocalStorage, 'run').mockImplementationOnce(async (_ctx, runner) => {
                await runner()
            })

            const eventListeners = {
                acquirersOfferRequestHasDeleted: eventListener,
            }

            // Act
            const result = await eventMessageHandler.eventListenersMessageHandler(eventListeners, validMessage)

            // Assert
            expect(result).toBeUndefined()
            expect(logger.info).toHaveBeenCalledWith(`Not found listener for the event [${validMessage.data.event}]`)
            expect(validMessage.done).toHaveBeenCalledWith()
        })
    })

    describe('method: `eventListenerMessageHandler`', () => {
        it('should skip to handle message in case listener was not provided', async () => {
            // Arrange
            vi.spyOn(asyncLocalStorage, 'run').mockImplementationOnce(async (_ctx, runner) => {
                await runner()
            })

            // Act
            await eventMessageHandler.eventListenerMessageHandler(undefined, validMessage)

            // Assert
            expect(logger.info).toHaveBeenCalledWith(`Not found listener for the event [${validMessage.data.event}]`)
            expect(validMessage.done).toHaveBeenCalledWith()
        })

        describe('listener.isSync === false', () => {
            it('should successfully run event listener message handler', async () => {
                // Arrange
                vi.spyOn(asyncLocalStorage, 'run').mockImplementationOnce(async (_ctx, runner) => {
                    await runner()
                })
                eventListener.handler.mockResolvedValue({ success: true })
                eventListener.isSync = false

                // Act
                await eventMessageHandler.eventListenerMessageHandler(eventListener, validMessage)

                // Assert
                const expectedMessage: QueueMessageData = {
                    event: validMessage.data.event,
                    meta: {
                        date: expect.any(Date),
                    },
                    payload: {
                        uuid: validMessage.data.payload.uuid,
                        response: { success: true },
                    },
                }

                expect(validMessage.done).toHaveBeenCalledWith(expectedMessage)
            })

            it('should successfully run event listener message rejected', async () => {
                // Arrange
                vi.spyOn(asyncLocalStorage, 'run').mockImplementationOnce(async (_ctx, runner) => {
                    await runner()
                })
                eventListener.handler.mockRejectedValueOnce(new ValidationError())
                eventListener.validationErrorHandler.mockResolvedValueOnce({
                    catch: vi.fn(),
                })
                eventListener.isSync = false

                // Act
                await eventMessageHandler.eventListenerMessageHandler(eventListener, validMessage)

                // Assert
                const expectedMessage: QueueMessageData = {
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
                }

                expect(validMessage.done).toHaveBeenCalledWith(expectedMessage)
            })
        })

        describe('nack message', () => {
            it('should not nack message if direct mechanism is used', async () => {
                // Arrange
                vi.spyOn(asyncLocalStorage, 'run').mockImplementationOnce(async (_ctx, runner) => {
                    await runner()
                })

                const nackOptions = new NackOptions()
                const listener = new TestEventBusListener([], nackOptions)

                const error = new Error('TestError')

                vi.spyOn(listener, 'handler').mockRejectedValueOnce(error)

                // Act
                await eventMessageHandler.eventListenerMessageHandler(listener, validMessage)

                // Assert
                expect(validMessage.reject).not.toHaveBeenCalledWith()

                const expectedPayload = {
                    uuid: validMessage.data.payload.uuid,
                    error: {
                        data: {},
                        http_code: 500,
                        message: error.message,
                    },
                }
                const expectedMsgData = getExpectedMsgData(validMessage.data.event, expectedPayload)

                expect(validMessage.done).toHaveBeenCalledWith(expectedMsgData)
            })
            it('should nack message if listener has nack options as property', async () => {
                // Arrange
                vi.spyOn(asyncLocalStorage, 'run').mockImplementationOnce(async (_ctx, runner) => {
                    await runner()
                })

                const nackOptions = new NackOptions()
                const listener = new TestEventBusListener([], nackOptions)

                const error = new Error('TestError')

                vi.spyOn(listener, 'handler').mockRejectedValueOnce(error)

                // Act
                await eventMessageHandler.eventListenerMessageHandler(listener, queueMessage)

                // Assert
                expect(validMessage.done).not.toHaveBeenCalledWith()
                expect(validMessage.reject).toHaveBeenCalledWith(nackOptions)
            })
            it('should nack message if listener handler returns nack options', async () => {
                // Arrange
                vi.spyOn(asyncLocalStorage, 'run').mockImplementationOnce(async (_ctx, runner) => {
                    await runner()
                })

                const listener = mock<EventBusListener>()

                const nackOptions = new NackOptions()

                listener.handler.mockResolvedValue(nackOptions)

                // Act
                await eventMessageHandler.eventListenerMessageHandler(listener, queueMessage)

                // Assert
                expect(validMessage.done).not.toHaveBeenCalledWith()
                expect(validMessage.reject).toHaveBeenCalledWith(nackOptions)
            })
            it('should nack with requeue false if validator returns error', async () => {
                // Arrange
                vi.spyOn(asyncLocalStorage, 'run').mockImplementationOnce(async (_ctx, runner) => {
                    await runner()
                })

                const listener = mock<EventBusListener>()

                vi.spyOn(eventMessageValidator, 'validateEventMessage').mockImplementationOnce(() => {
                    throw new Error('TestError')
                })

                // Act
                await eventMessageHandler.eventListenerMessageHandler(listener, queueMessage)

                // Assert
                expect(validMessage.done).not.toHaveBeenCalledWith()

                const nackOptions: NackOptions = {
                    requeue: false,
                    allUpTo: false,
                }

                expect(validMessage.reject).toHaveBeenCalledWith(nackOptions)
            })
        })
    })
})
