import { EventBusListener } from '@interfaces/index'
import { EventName } from '@interfaces/queueConfig'

export class ReceiveDirectEventListener implements EventBusListener {
    constructor(readonly event: EventName) {}

    async handler(): Promise<{ data: string }> {
        return {
            data: 'test',
        }
    }
}
