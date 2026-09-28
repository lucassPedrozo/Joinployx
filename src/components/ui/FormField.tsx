import type { ReactNode } from 'react'

type FormFieldProps = {
  id: string
  label: string
  error?: string
  hint?: string
  className?: string
  children: ReactNode
}

export function FormField({ id, label, error, hint, className = '', children }: FormFieldProps) {
  return (
    <div className={`field ${className}`.trim()}>
      <label htmlFor={id} className="field-label">{label}</label>
      {children}
      <p id={`${id}-message`} className={`field-message ${error ? 'error' : ''}`} aria-live="polite">
        {error ?? hint ?? '\u00a0'}
      </p>
    </div>
  )
}
