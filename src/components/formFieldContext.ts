import type { ComputedRef, InjectionKey } from 'vue'

export interface FormFieldContext {
  controlId: ComputedRef<string>
  describedBy: ComputedRef<string | undefined>
  invalid: ComputedRef<boolean>
}

export const formFieldKey: InjectionKey<FormFieldContext> = Symbol('form-field')
