import { EventBusListener } from '@interfaces/index'
import { ExternalEvent } from '@interfaces/queueConfig'

export class NotificationSendTargetEventListener implements EventBusListener {
    readonly event: ExternalEvent = ExternalEvent.NotificationTopicSubscribeTarget

    async handler(): Promise<{ data: string }> {
        return {
            data: 'test',
        }
    }
}
