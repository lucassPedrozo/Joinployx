export type WorkflowRenderOptions = {
  branch: string
  autoDeploy?: boolean
}

/** Scripts embutidos nos blocos `run: |`, indexados pelo placeholder do YAML. */
export type WorkflowScripts = Record<string, string>

const scriptPlaceholderPattern = /^([ \t]*)(__[A-Z_]+__)[ \t]*$/gm

// Os scripts vivem em arquivos .sh para poderem ser lintados e testados; aqui
// eles são embutidos no YAML respeitando a indentação do bloco.
const indentScript = (script: string, indent: string) =>
  script
    .replace(/\r\n/g, '\n')
    .replace(/\s+$/, '')
    .split('\n')
    .map((line) => (line.trim() ? `${indent}${line}` : ''))
    .join('\n')

const renderAutoDeployTrigger = (branch: string, autoDeploy: boolean) =>
  autoDeploy ? `\n  push:\n    branches:\n      - ${branch}\n\n` : '\n'

export const renderWorkflow = (
  template: string,
  scripts: WorkflowScripts,
  options: WorkflowRenderOptions
) => {
  const rendered = template
    .replace(/\r\n/g, '\n')
    .replace('__AUTO_DEPLOY_TRIGGER__\n', renderAutoDeployTrigger(options.branch, options.autoDeploy ?? false))
    .replaceAll('__DEFAULT_BRANCH__', options.branch)
    .replace(scriptPlaceholderPattern, (match, indent: string, placeholder: string) => {
      const script = scripts[placeholder]
      return script ? indentScript(script, indent) : match
    })

  const leftover = rendered.match(/__[A-Z_]+__/)
  if (leftover) {
    throw new Error(`Template de workflow com placeholder não resolvido: ${leftover[0]}`)
  }

  return rendered
}

/**
 * Bump a cada mudança relevante nos templates. O painel compara este valor com
 * o marcador gravado no repositório para avisar quando o workflow está velho.
 */
export const WORKFLOW_TEMPLATE_VERSION = '5'

export const readTemplateVersion = (content: string) =>
  content.match(/^#\s*joinvix-deploy-template:\s*(\S+)\s*$/m)?.[1] ?? null
