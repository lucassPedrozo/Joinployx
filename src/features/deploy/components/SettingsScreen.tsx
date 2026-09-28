import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  KeyRound,
  Loader2,
  LockKeyhole,
  Server,
  ShieldCheck,
  Sparkles,
  XCircle,
} from 'lucide-react'
import { FormField } from '../../../components/ui/FormField'
import { deployApi } from '../../../lib/api'
import type { AccessCheckResult, PanelSettings } from '../../../shared/deploy'

type SettingsScreenProps = {
  /** Primeira execução: não há para onde voltar e o texto é de boas-vindas. */
  isOnboarding: boolean
  onClose: () => void
  onSaved: (settings: PanelSettings) => void
  onError: (error: unknown, title: string) => void
}

const formatExpiration = (value: string | null) => {
  if (!value) return 'sem data de expiração informada'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const days = Math.round((date.getTime() - Date.now()) / 86_400_000)
  const formatted = date.toLocaleDateString('pt-BR', { dateStyle: 'short' })
  if (days < 0) return `expirou em ${formatted}`
  if (days <= 14) return `expira em ${formatted} — faltam ${days} dia(s)`
  return `expira em ${formatted}`
}

const generateKey = () => {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function SettingsScreen({ isOnboarding, onClose, onSaved, onError }: SettingsScreenProps) {
  const [settings, setSettings] = useState<PanelSettings | null>(null)
  const [githubToken, setGithubToken] = useState('')
  const [organization, setOrganization] = useState('')
  const [defaultFtpHost, setDefaultFtpHost] = useState('')
  const [panelAccessToken, setPanelAccessToken] = useState('')
  const [generatedKey, setGeneratedKey] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isChecking, setIsChecking] = useState(false)
  const [checkResult, setCheckResult] = useState<AccessCheckResult | null>(null)

  const load = useCallback(async () => {
    try {
      setIsLoading(true)
      const current = await deployApi.getSettings()
      setSettings(current)
      setOrganization(current.organization)
      setDefaultFtpHost(current.defaultFtpHost)
    } catch (error) {
      onError(error, 'Não foi possível ler as configurações')
    } finally {
      setIsLoading(false)
    }
  }, [onError])

  useEffect(() => {
    void Promise.resolve().then(load)
  }, [load])

  const runCheck = async () => {
    try {
      setIsChecking(true)
      setCheckResult(await deployApi.checkAccess({
        githubToken: githubToken.trim() || undefined,
        organization: organization.trim() || undefined,
      }))
    } catch (error) {
      onError(error, 'Não foi possível validar o acesso')
    } finally {
      setIsChecking(false)
    }
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    try {
      setIsSaving(true)
      const saved = await deployApi.saveSettings({
        ...(githubToken.trim() ? { githubToken: githubToken.trim() } : {}),
        organization: organization.trim(),
        defaultFtpHost: defaultFtpHost.trim(),
        ...(panelAccessToken.trim() ? { panelAccessToken: panelAccessToken.trim() } : {}),
      })
      setSettings(saved)
      setGithubToken('')
      setPanelAccessToken('')
      onSaved(saved)
    } catch (error) {
      onError(error, 'Não foi possível salvar as configurações')
    } finally {
      setIsSaving(false)
    }
  }

  const canSave = Boolean(organization.trim()) && (Boolean(githubToken.trim()) || settings?.githubConfigured)

  if (isLoading) {
    return <main className="loading-page"><Loader2 className="spin" size={28} /><strong>Lendo as configurações…</strong></main>
  }

  return (
    <main className="settings-page">
      <section className="settings-card">
        <header className="settings-header">
          <span className="access-icon"><ShieldCheck size={24} aria-hidden="true" /></span>
          <div>
            <p className="eyebrow">{isOnboarding ? 'Primeiro acesso' : 'Configurações'}</p>
            <h1>{isOnboarding ? 'Configure o painel nesta máquina' : 'Configurações do painel'}</h1>
            <p className="access-description">
              Os valores são gravados em <code>{settings?.envPath}</code>, apenas neste computador.
              O token do GitHub fica no servidor local e nunca é devolvido ao navegador.
            </p>
          </div>
          {isOnboarding ? null : (
            <button type="button" className="button button-secondary" onClick={onClose}>
              <ArrowLeft size={16} aria-hidden="true" />Voltar
            </button>
          )}
        </header>

        <form className="settings-form" onSubmit={handleSubmit} noValidate>
          <FormField
            id="github-token"
            label="Token do GitHub"
            hint={settings?.githubConfigured
              ? `Token atual: ${settings.githubTokenHint}. Deixe em branco para manter.`
              : 'Fine-grained personal access token, com prefixo github_pat_.'}
          >
            <div className="input-control">
              <KeyRound size={18} aria-hidden="true" />
              <input
                id="github-token"
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder={settings?.githubConfigured ? '•••••••• (mantém o atual)' : 'github_pat_…'}
                value={githubToken}
                onChange={(event) => setGithubToken(event.target.value)}
                aria-describedby="github-token-message"
              />
            </div>
          </FormField>

          <div className="form-grid">
            <FormField id="organization" label="Organização do GitHub" hint="Só repositórios dela aparecem no painel.">
              <div className="input-control">
                <Building2 size={18} aria-hidden="true" />
                <input
                  id="organization"
                  type="text"
                  autoComplete="off"
                  placeholder="minha-organizacao"
                  value={organization}
                  onChange={(event) => setOrganization(event.target.value)}
                  aria-describedby="organization-message"
                />
              </div>
            </FormField>

            <FormField id="default-ftp-host" label="Servidor FTP padrão" hint="Opcional. Pré-preenche o campo em repositórios novos.">
              <div className="input-control">
                <Server size={18} aria-hidden="true" />
                <input
                  id="default-ftp-host"
                  type="text"
                  autoComplete="off"
                  placeholder="ftp.hospedagem.com.br"
                  value={defaultFtpHost}
                  onChange={(event) => setDefaultFtpHost(event.target.value)}
                  aria-describedby="default-ftp-host-message"
                />
              </div>
            </FormField>
          </div>

          <FormField
            id="panel-access-token"
            label="Chave de acesso ao painel"
            hint={settings?.panelAccessTokenSet
              ? 'Já definida. Preencha apenas para trocar.'
              : 'Opcional quando o painel escuta só em 127.0.0.1; obrigatória se abrir para a rede.'}
          >
            <div className="input-control">
              <LockKeyhole size={18} aria-hidden="true" />
              <input
                id="panel-access-token"
                type="text"
                autoComplete="off"
                spellCheck={false}
                placeholder={settings?.panelAccessTokenSet ? '•••••••• (mantém a atual)' : 'ao menos 16 caracteres'}
                value={panelAccessToken}
                onChange={(event) => { setPanelAccessToken(event.target.value); setGeneratedKey('') }}
                aria-describedby="panel-access-token-message"
              />
              <button
                type="button"
                className="input-action"
                onClick={() => { const key = generateKey(); setPanelAccessToken(key); setGeneratedKey(key) }}
                aria-label="Gerar chave aleatória"
                title="Gerar chave aleatória"
              >
                <Sparkles size={17} aria-hidden="true" />
              </button>
            </div>
          </FormField>

          {generatedKey ? (
            <p className="settings-generated">
              Guarde esta chave agora — depois de salvar ela não é exibida de novo:
              <code>{generatedKey}</code>
            </p>
          ) : null}

          <div className="settings-network">
            <ShieldCheck size={16} aria-hidden="true" />
            <span>
              O painel escuta em <strong>{settings?.serverHost}:{settings?.port}</strong>.
              Alterar host ou porta exige editar o <code>.env</code> e reiniciar; o resto vale na hora.
            </span>
          </div>

          <div className="settings-actions">
            <button type="button" className="button button-secondary" onClick={runCheck} disabled={isChecking || isSaving}>
              {isChecking ? <Loader2 className="spin" size={16} /> : <ShieldCheck size={16} />}
              {isChecking ? 'Validando…' : 'Testar acesso'}
            </button>
            <button type="submit" className="button button-primary" disabled={!canSave || isSaving}>
              {isSaving ? <Loader2 className="spin" size={16} /> : <CheckCircle2 size={16} />}
              {isSaving ? 'Salvando…' : 'Salvar configurações'}
            </button>
          </div>
        </form>

        {checkResult ? (
          <section className="settings-checks" aria-label="Resultado da validação">
            {checkResult.identity ? (
              <p className="settings-identity">
                Token de <strong>{checkResult.identity.login}</strong> — {formatExpiration(checkResult.identity.tokenExpiresAt)}.
              </p>
            ) : null}
            <ul>
              {checkResult.checks.map((check) => (
                <li key={check.id} className={check.ok ? 'check-ok' : 'check-fail'}>
                  {check.ok ? <CheckCircle2 size={16} aria-hidden="true" /> : <XCircle size={16} aria-hidden="true" />}
                  <span><strong>{check.label}</strong><small>{check.detail}</small></span>
                </li>
              ))}
            </ul>
            <p className="settings-note">
              A validação faz apenas leituras. As permissões de escrita (Contents e Workflows) só são
              exercidas de fato ao salvar a configuração de um repositório.
            </p>
          </section>
        ) : null}
      </section>
    </main>
  )
}
