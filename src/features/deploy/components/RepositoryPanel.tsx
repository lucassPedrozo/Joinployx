import { useState } from 'react'
import { ChevronDown, FolderTree, GitBranch, Globe2, KeyRound, LockKeyhole, Server, Settings2, Sliders, UserRound } from 'lucide-react'
import { FormField } from '../../../components/ui/FormField'
import type { PublicationSettings, RepoOption } from '../../../shared/deploy'
import type { ValidationErrors } from '../deploy.types'

type RepositoryPanelProps = {
  repos: RepoOption[]
  selectedRepo?: RepoOption
  selectedRepoId: string
  settings: PublicationSettings
  showPassword: boolean
  errors: ValidationErrors
  isLoading: boolean
  onRepoChange: (id: string) => void
  onSettingsChange: (patch: Partial<PublicationSettings>) => void
  onTogglePassword: () => void
  formatDate: (value?: string) => string
}

export function RepositoryPanel(props: RepositoryPanelProps) {
  const {
    repos, selectedRepo, selectedRepoId, settings, showPassword,
    errors, isLoading, onRepoChange, onSettingsChange, onTogglePassword, formatDate,
  } = props
  const [showAdvanced, setShowAdvanced] = useState(false)

  const remotePreview = settings.serverDir.trim()
    || (settings.domain.trim() ? `domains/${settings.domain.trim()}/public_html` : 'domains/<domínio>/public_html')

  return (
    <section className="panel configuration-panel" aria-labelledby="configuration-title">
      <div className="panel-heading">
        <span className="step-badge">1</span>
        <div><p className="panel-kicker">Configuração</p><h2 id="configuration-title">Origem e credenciais</h2></div>
      </div>

      <FormField
        id="repository"
        label="Repositório"
        error={errors.repo}
        hint="Apenas repositórios da organização configurada são exibidos."
      >
        <div className="input-control select-control">
          <GitBranch size={18} aria-hidden="true" />
          <select
            id="repository"
            value={selectedRepoId}
            onChange={(event) => onRepoChange(event.target.value)}
            disabled={isLoading}
            aria-invalid={Boolean(errors.repo)}
            aria-describedby="repository-message"
          >
            <option value="">{isLoading ? 'Carregando repositórios…' : 'Selecione um repositório'}</option>
            {repos.map((repo) => <option key={repo.id} value={repo.id}>{repo.fullName}</option>)}
          </select>
          <ChevronDown className="select-chevron" size={18} aria-hidden="true" />
        </div>
      </FormField>

      <div className={`repository-card ${selectedRepo ? 'is-selected' : ''}`} aria-live="polite">
        <div className="repository-card-main">
          <span className="repository-icon"><GitBranch size={18} aria-hidden="true" /></span>
          <div>
            <strong>{selectedRepo?.fullName ?? 'Nenhum repositório selecionado'}</strong>
            <p>{selectedRepo ? `Branch padrão: ${selectedRepo.defaultBranch}` : 'Selecione uma origem para continuar'}</p>
          </div>
        </div>
        {selectedRepo ? (
          <div className="repository-meta">
            <span className="privacy-badge">{selectedRepo.private ? 'Privado' : 'Público'}</span>
            <span>Atualizado {formatDate(selectedRepo.updatedAt)}</span>
          </div>
        ) : <span className="repository-placeholder">Aguardando seleção</span>}
      </div>

      <div className="section-divider" />

      <div className="subsection-heading">
        <span className="step-badge">2</span>
        <div><h3>Dados de publicação</h3><p>Enviados à API e gravados como GitHub Actions secrets.</p></div>
      </div>

      <div className="form-grid">
        <FormField id="domain" label="Domínio" error={errors.domain} hint="Sem https:// ou caminhos adicionais.">
          <div className="input-control">
            <Globe2 size={18} aria-hidden="true" />
            <input id="domain" type="text" inputMode="url" autoComplete="off" placeholder="meusite.com.br" value={settings.domain} onChange={(event) => onSettingsChange({ domain: event.target.value })} aria-invalid={Boolean(errors.domain)} aria-describedby="domain-message" />
          </div>
        </FormField>
        <FormField id="ftp-server" label="Servidor FTP" error={errors.ftpServer} hint="Host da hospedagem, sem ftp:// nem barra.">
          <div className="input-control">
            <Server size={18} aria-hidden="true" />
            <input id="ftp-server" type="text" autoComplete="off" placeholder="ftp.hospedagem.com.br" value={settings.ftpServer} onChange={(event) => onSettingsChange({ ftpServer: event.target.value })} aria-invalid={Boolean(errors.ftpServer)} aria-describedby="ftp-server-message" />
          </div>
        </FormField>
        <FormField id="ftp-login" label="Login FTP" error={errors.ftpLogin} hint="Usuário fornecido pelo servidor de hospedagem.">
          <div className="input-control">
            <UserRound size={18} aria-hidden="true" />
            <input id="ftp-login" type="text" autoComplete="username" placeholder="usuario@exemplo" value={settings.ftpLogin} onChange={(event) => onSettingsChange({ ftpLogin: event.target.value })} aria-invalid={Boolean(errors.ftpLogin)} aria-describedby="ftp-login-message" />
          </div>
        </FormField>
        <FormField id="ftp-password" label="Senha FTP" error={errors.ftpPassword} hint="A senha nunca é salva no navegador.">
          <div className="input-control">
            <LockKeyhole size={18} aria-hidden="true" />
            <input id="ftp-password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" placeholder="••••••••" value={settings.ftpPassword} onChange={(event) => onSettingsChange({ ftpPassword: event.target.value })} aria-invalid={Boolean(errors.ftpPassword)} aria-describedby="ftp-password-message" />
            <button type="button" className="input-action" onClick={onTogglePassword} aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}><KeyRound size={17} aria-hidden="true" /></button>
          </div>
        </FormField>
      </div>

      <label className="switch-row">
        <input type="checkbox" checked={settings.autoDeploy} onChange={(event) => onSettingsChange({ autoDeploy: event.target.checked })} />
        <span>
          <strong>Publicar automaticamente a cada push</strong>
          <small>Adiciona o gatilho de push na branch padrão ao workflow de deploy.</small>
        </span>
      </label>

      <button
        type="button"
        className="disclosure-button"
        onClick={() => setShowAdvanced((current) => !current)}
        aria-expanded={showAdvanced}
        aria-controls="advanced-settings"
      >
        <Settings2 size={16} aria-hidden="true" />
        Opções avançadas
        <ChevronDown size={16} className={showAdvanced ? 'chevron-open' : ''} aria-hidden="true" />
      </button>

      <div id="advanced-settings" className="advanced-settings" hidden={!showAdvanced}>
        <div className="form-grid">
          <FormField id="server-dir" label="Pasta remota" error={errors.serverDir} hint={`Padrão: ${remotePreview}`}>
            <div className="input-control">
              <FolderTree size={18} aria-hidden="true" />
              <input id="server-dir" type="text" autoComplete="off" placeholder="domains/meusite.com.br/public_html" value={settings.serverDir} onChange={(event) => onSettingsChange({ serverDir: event.target.value })} aria-invalid={Boolean(errors.serverDir)} aria-describedby="server-dir-message" />
            </div>
          </FormField>
          <FormField id="ftp-port" label="Porta" error={errors.port} hint="Vazio usa a porta 21.">
            <div className="input-control">
              <Sliders size={18} aria-hidden="true" />
              <input id="ftp-port" type="text" inputMode="numeric" autoComplete="off" placeholder="21" value={settings.port} onChange={(event) => onSettingsChange({ port: event.target.value })} aria-invalid={Boolean(errors.port)} aria-describedby="ftp-port-message" />
            </div>
          </FormField>
          <FormField id="ftp-protocol" label="Protocolo" hint="Automático testa FTPS e só usa FTP simples se necessário.">
            <div className="input-control select-control">
              <LockKeyhole size={18} aria-hidden="true" />
              <select id="ftp-protocol" value={settings.protocol} onChange={(event) => onSettingsChange({ protocol: event.target.value as PublicationSettings['protocol'] })} aria-describedby="ftp-protocol-message">
                <option value="auto">Automático (recomendado)</option>
                <option value="ftps">FTPS explícito</option>
                <option value="ftps-legacy">FTPS implícito</option>
                <option value="ftp">FTP simples</option>
              </select>
              <ChevronDown className="select-chevron" size={18} aria-hidden="true" />
            </div>
          </FormField>
          <FormField id="build-env" className="span-full field-textarea" label="Variáveis de build" error={errors.buildEnv} hint="Uma por linha, no formato CHAVE=valor. Gravadas como secret e usadas apenas durante o build.">
            <textarea
              id="build-env"
              className="textarea-control"
              rows={4}
              spellCheck={false}
              placeholder={'VITE_SUPABASE_URL=https://xxx.supabase.co\nVITE_SUPABASE_ANON_KEY=...'}
              value={settings.buildEnv}
              onChange={(event) => onSettingsChange({ buildEnv: event.target.value })}
              aria-invalid={Boolean(errors.buildEnv)}
              aria-describedby="build-env-message"
            />
          </FormField>
        </div>
      </div>
    </section>
  )
}
