import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'
import type { Notice } from '../deploy.types'

export function NoticeBanner({ notice, onClose }: { notice: Notice; onClose: () => void }) {
  const Icon = notice.kind === 'success' ? CheckCircle2 : notice.kind === 'info' ? Info : AlertTriangle
  return (
    <section className={`notice notice-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
      <Icon size={20} aria-hidden="true" />
      <div><strong>{notice.title}</strong><p>{notice.message}</p></div>
      <button type="button" className="icon-button" onClick={onClose} aria-label="Fechar aviso"><X size={16} /></button>
    </section>
  )
}
