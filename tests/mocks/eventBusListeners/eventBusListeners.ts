import { EventBusListener, NackOptions } from '@src/interfaces'

export const TestEventBusListenerName = 'test-event'

export class TestEventBusListener implements EventBusListener {
    constructor(
        public queueNames?: string[],
        public nackOptions?: NackOptions,
        public event = TestEventBusListenerName,
    ) {}

    async handler(): Promise<unknown | void> {
        return
    }
}
