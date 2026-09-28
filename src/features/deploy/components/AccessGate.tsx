import { useState, type FormEvent } from 'react'
import { KeyRound, LockKeyhole } from 'lucide-react'

type AccessGateProps = {
  message?: string
  onSubmit: (token: string) => Promise<void>
}

export function AccessGate({ message, onSubmit }: AccessGateProps) {
  const [token, setToken] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!token.trim()) return
    setIsSubmitting(true)
    await onSubmit(token.trim()).finally(() => setIsSubmitting(false))
  }

  return (
    <main className="access-page">
      <section className="access-card">
        <span className="access-icon"><LockKeyhole size={24} aria-hidden="true" /></span>
        <p className="eyebrow">Acesso restrito</p>
        <h1>Entre no painel de deploy</h1>
        <p className="access-description">Use a chave definida no servidor. Ela permanece somente nesta aba do navegador.</p>
        <form onSubmit={handleSubmit} className="access-form">
          <label htmlFor="access-token">Chave de acesso</label>
          <div className="input-control">
            <KeyRound size={18} aria-hidden="true" />
            <input
              id="access-token"
              type="password"
              autoComplete="current-password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="Informe a chave do painel"
              aria-describedby={message ? 'access-error' : undefined}
              aria-invalid={Boolean(message)}
              autoFocus
            />
          </div>
          <p id="access-error" className={`field-message ${message ? 'error' : ''}`}>{message ?? '\u00a0'}</p>
          <button type="submit" className="button button-primary" disabled={!token.trim() || isSubmitting}>
            {isSubmitting ? 'Validando…' : 'Acessar painel'}
          </button>
        </form>
      </section>
    </main>
  )
}
