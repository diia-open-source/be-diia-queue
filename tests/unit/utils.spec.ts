import * as Utils from '@src/utils'

describe('Utils', () => {
    describe('method: `collectEventBusListeners`', () => {
        it('should successfully collect event bus listeners', () => {
            const eventListener = {
                event: 'authUserLogOut',
            }

            expect(Utils.collectEventBusListeners([eventListener])).toEqual({
                [eventListener.event]: eventListener,
            })
        })
    })
})
