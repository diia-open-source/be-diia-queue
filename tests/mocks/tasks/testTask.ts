import { ValidationSchema } from '@diia-inhouse/validators'

import { TaskListener } from '@interfaces/index'

export const TestTaskListenerName = 'testTask'

export class TestTaskListener implements TaskListener {
    name: string

    isDelayed: boolean

    validationRules: ValidationSchema = {
        text: { type: 'string' },
    }

    queueNames?: string[]

    constructor(name?: string, isDelayed = true, queueNames: string[] = []) {
        this.isDelayed = isDelayed
        this.queueNames = queueNames
        this.name = name ?? TestTaskListenerName
    }

    async handler(): Promise<void> {}
}
