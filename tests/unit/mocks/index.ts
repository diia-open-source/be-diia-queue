import { AsyncLocalStorage } from 'node:async_hooks'

import { mock } from 'vitest-mock-extended'

import Logger from '@diia-inhouse/diia-logger'
import { AppValidator } from '@diia-inhouse/validators'

import { EventMessageHandler, QueueContext } from '@src/index'

import { EventMessageValidator } from '@services/eventMessageValidator'

export const logger = mock<Logger>()

export const eventListener = {
    handler: vi.fn(),
    event: 'acquirersOfferRequestHasDeleted',
    validationRules: undefined,
    isSync: false,
    validationErrorHandler: vi.fn(),
}

export const appValidator = mock<AppValidator>({ validate: vi.fn() })

export const eventMessageValidator = mock<EventMessageValidator>({
    validateEventMessage: vi.fn(),
    validateSyncedEventMessage: vi.fn(),
})

export const asyncLocalStorage = mock<AsyncLocalStorage<QueueContext>>({ run: vi.fn() })

export const eventMessageHandler = new EventMessageHandler(eventMessageValidator, asyncLocalStorage, logger)
