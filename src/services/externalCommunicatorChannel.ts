import { CacheService } from '@diia-inhouse/redis'

import { EventName } from '../interfaces/queueConfig'

export class ExternalCommunicatorChannel {
    constructor(private readonly cache: CacheService | undefined) {}

    getChannel(event: EventName, requestUuid: string): string {
        this.assertChannelAvailability()

        return `external_communicator_channel_${event}_${requestUuid}`
    }

    async isChannelActive(channel: string): Promise<boolean> {
        this.assertChannelAvailability()

        return Boolean(await this.cache.get(this.getActiveChannelKey(channel)))
    }

    async saveActiveChannel(channel: string, timeout: number): Promise<void> {
        this.assertChannelAvailability()

        await this.cache.set(this.getActiveChannelKey(channel), 'true', Math.floor(timeout / 1000))
    }

    private getActiveChannelKey(channel: string): string {
        return `active_${channel}`
    }

    private assertChannelAvailability(): void | never {
        if (!this.cache) {
            throw new Error('Cache service is not provided for the ExternalCommunicatorChannel service')
        }
    }
}
