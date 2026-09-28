import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { parse } from 'yaml'
import {
  readTemplateVersion,
  renderWorkflow,
  WORKFLOW_TEMPLATE_VERSION,
  type WorkflowScripts,
} from './workflow-render.ts'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (relativePath: string) => readFileSync(resolve(projectRoot, relativePath), 'utf8')

const scripts: WorkflowScripts = {
  __DETECT_PACKAGE_MANAGER__: read('workflows/scripts/detect-package-manager.sh'),
  __INSTALL_AND_BUILD__: read('workflows/scripts/install-and-build.sh'),
  __RESOLVE_BUILD_OUTPUT__: read('workflows/scripts/resolve-build-output.sh'),
}

const buildTemplate = read('workflows/build.yml')
const deployTemplate = read('workflows/deploy-via-ftp.yml')

test('resolve todos os placeholders dos dois templates', () => {
  for (const template of [buildTemplate, deployTemplate]) {
    const rendered = renderWorkflow(template, scripts, { branch: 'main' })
    assert.equal(/__[A-Z_]+__/.test(rendered), false)
  }
})

test('falha quando um placeholder não tem substituição', () => {
  assert.throws(
    () => renderWorkflow(deployTemplate, {}, { branch: 'main' }),
    /placeholder não resolvido/
  )
})

test('aplica a branch informada em todas as ocorrências', () => {
  const rendered = renderWorkflow(buildTemplate, scripts, { branch: 'producao' })
  assert.equal(rendered.includes('__DEFAULT_BRANCH__'), false)
  assert.equal(rendered.split('- producao').length - 1 >= 2, true)
})

test('inclui o gatilho de push somente quando o deploy automático é pedido', () => {
  const manual = renderWorkflow(deployTemplate, scripts, { branch: 'main', autoDeploy: false })
  const automatic = renderWorkflow(deployTemplate, scripts, { branch: 'main', autoDeploy: true })

  assert.equal(/^\s{2}push:$/m.test(manual), false)
  assert.equal(/^\s{2}push:$/m.test(automatic), true)
  assert.equal(automatic.includes('      - main'), true)
})

test('mantém os scripts indentados dentro do bloco run', () => {
  const rendered = renderWorkflow(deployTemplate, scripts, { branch: 'main' })
  const lines = rendered.split('\n')
  const start = lines.findIndex((line) => line.includes('set -euo pipefail'))

  assert.notEqual(start, -1)
  assert.equal(lines[start].startsWith('          '), true)

  // Nenhuma linha do script pode escapar para a coluna zero: isso quebraria o
  // YAML e é exatamente o erro que a substituição precisa evitar.
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index]
    if (!line.trim()) continue
    if (/^ {6}- name:/.test(line)) break
    assert.equal(/^\s/.test(line), true, `linha sem indentação: ${line}`)
  }
})

test('não deixa tabulações nem CRLF no YAML gerado', () => {
  const rendered = renderWorkflow(deployTemplate, scripts, { branch: 'main', autoDeploy: true })
  assert.equal(rendered.includes('\t'), false)
  assert.equal(rendered.includes('\r'), false)
})

test('o YAML gerado continua válido depois da substituição dos scripts', () => {
  for (const [name, template] of [['build', buildTemplate], ['deploy', deployTemplate]] as const) {
    for (const autoDeploy of [false, true]) {
      const document = parse(renderWorkflow(template, scripts, { branch: 'main', autoDeploy }))
      assert.equal(typeof document.name, 'string', name)
      const job = Object.values(document.jobs)[0] as { steps: Array<Record<string, unknown>> }
      assert.equal(Array.isArray(job.steps), true, name)
      assert.equal(job.steps.length > 0, true, name)
    }
  }
})

test('os scripts chegam íntegros dentro do bloco run', () => {
  const document = parse(renderWorkflow(deployTemplate, scripts, { branch: 'main' }))
  const job = Object.values(document.jobs)[0] as { steps: Array<{ id?: string; run?: string }> }
  const step = job.steps.find((item) => item.id === 'build-output')

  assert.ok(step?.run)
  assert.equal(step.run.trim(), scripts.__RESOLVE_BUILD_OUTPUT__.replace(/\r\n/g, '\n').trim())
})

test('o envio por FTP usa a pasta detectada, e não um caminho fixo', () => {
  const document = parse(renderWorkflow(deployTemplate, scripts, { branch: 'main' }))
  const job = Object.values(document.jobs)[0] as { steps: Array<{ uses?: string; with?: Record<string, string> }> }
  const upload = job.steps.find((item) => item.uses?.startsWith('SamKirkland/FTP-Deploy-Action'))

  assert.ok(upload)
  assert.equal(upload.with?.['local-dir'], '${{ steps.build-output.outputs.dist-dir }}/')
  assert.equal(upload.with?.server, '${{ secrets.FTP_SERVER }}')
  assert.equal(upload.with?.['server-dir'], '${{ steps.config.outputs.server-dir }}')
})

test('nenhum host de hospedagem fica fixo no template de deploy', () => {
  assert.equal(/^\s+server:\s*[a-z0-9][a-z0-9.-]*\.[a-z]{2,}\s*$/mi.test(deployTemplate), false)
})

test('os templates carregam o marcador de versão', () => {
  for (const template of [buildTemplate, deployTemplate]) {
    assert.equal(readTemplateVersion(template), WORKFLOW_TEMPLATE_VERSION)
  }
})

test('a versão sobrevive à renderização e é lida de volta', () => {
  const rendered = renderWorkflow(deployTemplate, scripts, { branch: 'main', autoDeploy: true })
  assert.equal(readTemplateVersion(rendered), WORKFLOW_TEMPLATE_VERSION)
})

test('um workflow sem marcador é reconhecido como desatualizado', () => {
  assert.equal(readTemplateVersion('name: Deploy via FTP\non:\n  workflow_dispatch:\n'), null)
})

test('o resumo distingue publicação concluída de falha', () => {
  const document = parse(renderWorkflow(deployTemplate, scripts, { branch: 'main' }))
  const job = Object.values(document.jobs)[0] as { steps: Array<{ id?: string; name?: string; run?: string; env?: Record<string, string> }> }

  // O resumo depende do desfecho do envio; sem o id não há como consultá-lo.
  const upload = job.steps.find((step) => step.name === 'Upload via FTP')
  assert.equal(upload?.id, 'upload')

  const summary = job.steps.find((step) => step.name === 'Publication summary')
  assert.equal(summary?.env?.UPLOAD_OUTCOME, '${{ steps.upload.outcome }}')
  assert.match(summary?.run ?? '', /Publicacao nao concluida/)
  assert.match(summary?.run ?? '', /Publicacao concluida/)
})

test('o resumo lê os valores do ambiente, não interpolados no shell', () => {
  const document = parse(renderWorkflow(deployTemplate, scripts, { branch: 'main' }))
  const job = Object.values(document.jobs)[0] as { steps: Array<{ name?: string; run?: string }> }
  const summary = job.steps.find((step) => step.name === 'Publication summary')

  // Interpolar ${{ }} dentro do corpo do run mistura dados com código.
  assert.equal(/\$\{\{/.test(summary?.run ?? ''), false)
})
