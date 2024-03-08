import { ValidationSchema } from '@diia-inhouse/validators'

import { TaskListener } from '@interfaces/index'

export type PromiseWithResolver = Promise<void> & { resolve?: () => void }

export class TestTask implements TaskListener {
    promiseWithResolver: PromiseWithResolver | undefined

    name = 'testTask'

    isDelayed = true

    validationRules: ValidationSchema = {
        text: { type: 'string' },
    }

    async handler(): Promise<void> {
        this?.promiseWithResolver?.resolve?.()
    }

    getPromiseWithResolver(): PromiseWithResolver {
        if (this.promiseWithResolver) {
            return this.promiseWithResolver
        }

        let resolve: () => void = () => null
        const promise: PromiseWithResolver = new Promise((_resolve: () => void) => {
            resolve = _resolve
        })

        promise.resolve = resolve

        this.promiseWithResolver = promise

        return promise
    }
}

export default TestTask
