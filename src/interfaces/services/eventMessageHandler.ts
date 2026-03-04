import { ValidationError } from '@diia-inhouse/errors'

export interface ValidationResult {
    isValid: boolean
    error?: ValidationError
}
