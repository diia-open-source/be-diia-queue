import { defineConfig, base } from '@diia-inhouse/oxc-config/oxlint'

export default defineConfig({
    ...base,
    rules: {
        ...base.rules,
        'vitest/require-mock-type-parameters': 'off',
        'eslint/no-restricted-imports': 'off',
    },
})
