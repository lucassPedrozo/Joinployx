/**
 * Leitura e escrita do arquivo `.env`. São funções puras de texto: quem toca
 * no disco é o `env.ts`, e assim tudo aqui é testável sem efeito colateral.
 */

const KEY_PATTERN = /^[A-Z_][A-Z0-9_]*$/i

const parseEnvLine = (line: string) => {
  // Editores do Windows gravam .env com BOM; sem removê-lo a primeira chave
  // vira "\uFEFFGITHUB_TOKEN" e a variável nunca é carregada.
  const trimmed = line.replace(/^\uFEFF/, '').trim().replace(/^export\s+/, '')
  if (!trimmed || trimmed.startsWith('#')) return null

  const separator = trimmed.indexOf('=')
  if (separator < 1) return null

  const key = trimmed.slice(0, separator).trim()
  const value = trimmed
    .slice(separator + 1)
    .trim()
    .replace(/^(['"])([\s\S]*)\1$/, '$2')

  return KEY_PATTERN.test(key) ? [key, value] as const : null
}

export const parseEnvFile = (content: string) => {
  const entries: Record<string, string> = {}
  for (const line of content.split(/\r?\n/)) {
    const entry = parseEnvLine(line)
    if (entry) entries[entry[0]] = entry[1]
  }
  return entries
}

// Valores simples ficam sem aspas para o arquivo continuar legível; só o que
// poderia ser reinterpretado na releitura é escapado.
const formatValue = (value: string) =>
  /^[A-Za-z0-9_@./:+-]*$/.test(value)
    ? value
    : `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

const matchesKey = (line: string, key: string) =>
  new RegExp(`^\\s*(export\\s+)?${key}\\s*=`, 'i').test(line.replace(/^\uFEFF/, ''))

/**
 * Atualiza chaves preservando comentários, ordem e as demais variáveis.
 * Chaves ausentes são acrescentadas no fim.
 */
export const upsertEnvFile = (content: string, updates: Record<string, string>) => {
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/)
  const pending = new Map(Object.entries(updates))

  const rewritten = lines.map((line) => {
    for (const [key, value] of pending) {
      if (matchesKey(line, key)) {
        pending.delete(key)
        return `${key}=${formatValue(value)}`
      }
    }
    return line
  })

  while (rewritten.length > 0 && rewritten[rewritten.length - 1].trim() === '') {
    rewritten.pop()
  }

  if (pending.size > 0) {
    if (rewritten.length > 0) rewritten.push('')
    for (const [key, value] of pending) {
      rewritten.push(`${key}=${formatValue(value)}`)
    }
  }

  return `${rewritten.join('\n')}\n`
}

/** Dica exibida na interface no lugar do segredo: `github_pat_…a1b2`. */
export const maskSecret = (value: string) => {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (trimmed.length <= 8) return '••••'

  const prefix = trimmed.startsWith('github_pat_') ? 'github_pat_' : trimmed.slice(0, 4)
  return `${prefix}…${trimmed.slice(-4)}`
}
