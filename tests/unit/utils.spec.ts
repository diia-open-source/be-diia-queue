import * as Utils from '@src/utils'

import { InternalEvent, QueueConfigType } from '@interfaces/queueConfig'

describe('Utils', () => {
    describe('method: `collectEventBusListeners`', () => {
        it('should successfully collect event bus listeners', () => {
            const eventListener = {
                event: InternalEvent.AuthUserLogOut,
            }

            expect(Utils.collectEventBusListeners([eventListener])).toEqual({
                [eventListener.event]: eventListener,
            })
        })
    })

    describe('method: `validateAndGetQueueConfigs`', () => {
        it('should successfully validate and get queue configs for specific service', () => {
            expect(Utils.validateAndGetQueueConfigs('Auth', QueueConfigType.Internal)).toBeDefined()
        })

        it('should fail to validate and get queue configs in case it is not implemented for specific service', () => {
            expect(() => {
                Utils.validateAndGetQueueConfigs('some-service', QueueConfigType.Internal)
            }).toThrow(new Error(`Service queue config type [${QueueConfigType.Internal}] is not implemented`))
        })
    })
})
