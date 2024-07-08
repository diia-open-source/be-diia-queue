import { randomUUID } from 'node:crypto'

import { ExternalCommunicatorChannel } from '../../../src/index'
import { cacheService } from '../mocks'

describe(`${ExternalCommunicatorChannel.name}`, () => {
    const communicatorChannel = new ExternalCommunicatorChannel(cacheService)

    describe('method: `getChannel`', () => {
        it('should successfully get channel', () => {
            const eventName = 'acquirerDocumentRequest'
            const requestUuid = randomUUID()

            expect(communicatorChannel.getChannel(eventName, requestUuid)).toBe(`external_communicator_channel_${eventName}_${requestUuid}`)
        })
    })

    describe('method: `isChannelActive`', () => {
        it('should successfully define is channel active', async () => {
            const channel = randomUUID()

            jest.spyOn(cacheService, 'get').mockResolvedValue('true')

            expect(await communicatorChannel.isChannelActive(channel)).toBeTruthy()
            expect(cacheService.get).toHaveBeenCalledWith(`active_${channel}`)
        })
    })

    describe('method: `saveActiveChannel`', () => {
        it('should successfully save active channel', async () => {
            const channel = randomUUID()

            jest.spyOn(cacheService, 'set').mockResolvedValue('OK')

            expect(await communicatorChannel.saveActiveChannel(channel, 1000)).toBeUndefined()
            expect(cacheService.set).toHaveBeenCalledWith(`active_${channel}`, 'true', 1)
        })
    })
})
