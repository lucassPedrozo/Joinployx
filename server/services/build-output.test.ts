import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const scriptPath = resolve(projectRoot, 'workflows/scripts/resolve-build-output.sh')

const hasBash = spawnSync('bash', ['-c', 'exit 0'], { encoding: 'utf8' }).status === 0

type Fixture = Record<string, string>

const createProject = (files: Fixture) => {
  const root = mkdtempSync(resolve(tmpdir(), 'joinployx-build-'))
  for (const [relativePath, content] of Object.entries(files)) {
    const target = resolve(root, relativePath)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content)
  }
  return root
}

const runScript = (root: string, env: Record<string, string> = {}) => {
  const outputFile = resolve(root, 'github-output.txt')
  writeFileSync(outputFile, '')

  const result = spawnSync('bash', [scriptPath], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, GITHUB_OUTPUT: outputFile, GITHUB_STEP_SUMMARY: '', ...env },
  })

  const outputs = Object.fromEntries(
    readFileSync(outputFile, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const separator = line.indexOf('=')
        return [line.slice(0, separator), line.slice(separator + 1)] as const
      })
  )

  return { ...result, outputs }
}

const page = '<!doctype html><html><body><div id="root"></div><script src="/assets/index.js"></script></body></html>'

test('escolhe dist quando o build é um SPA estático plano', { skip: !hasBash }, () => {
  const root = createProject({ 'dist/index.html': page, 'dist/assets/index.js': 'console.log(1)' })
  try {
    const result = runScript(root)
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.outputs['dist-dir'], 'dist')
    assert.equal(result.outputs['server-bundle'], '')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('escolhe dist/client quando o build gera client + server', { skip: !hasBash }, () => {
  const root = createProject({
    'dist/client/index.html': page,
    'dist/client/assets/index.js': 'console.log(1)',
    'dist/server/index.js': 'export default null',
  })
  try {
    const result = runScript(root)
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.outputs['dist-dir'], 'dist/client')
    assert.equal(result.outputs['server-bundle'], 'dist/server')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('reconhece o layout build/client do react-router', { skip: !hasBash }, () => {
  const root = createProject({
    'build/client/index.html': page,
    'build/server/index.js': 'export default null',
  })
  try {
    const result = runScript(root)
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.outputs['dist-dir'], 'build/client')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('reconhece a exportação estática em out/', { skip: !hasBash }, () => {
  const root = createProject({ 'out/index.html': page })
  try {
    const result = runScript(root)
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.outputs['dist-dir'], 'out')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('cria o fallback de rotas para SPA', { skip: !hasBash }, () => {
  const root = createProject({ 'dist/index.html': page })
  try {
    const result = runScript(root)
    assert.equal(result.status, 0, result.stderr)
    assert.equal(readFileSync(resolve(root, 'dist/404.html'), 'utf8'), page)
    assert.match(readFileSync(resolve(root, 'dist/.htaccess'), 'utf8'), /RewriteRule \. \/index\.html/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('respeita SPA_FALLBACK=false', { skip: !hasBash }, () => {
  const root = createProject({ 'dist/index.html': page })
  try {
    const result = runScript(root, { SPA_FALLBACK: 'false' })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.outputs['dist-dir'], 'dist')
    assert.throws(() => readFileSync(resolve(root, 'dist/.htaccess'), 'utf8'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('honra PUBLISH_DIR quando informado', { skip: !hasBash }, () => {
  const root = createProject({ 'dist/index.html': page, 'publico/index.html': page })
  try {
    const result = runScript(root, { PUBLISH_DIR: './publico/' })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.outputs['dist-dir'], 'publico')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('falha quando PUBLISH_DIR tenta escapar do repositório', { skip: !hasBash }, () => {
  const root = createProject({ 'dist/index.html': page })
  try {
    const result = runScript(root, { PUBLISH_DIR: '../fora' })
    assert.notEqual(result.status, 0)
    assert.match(result.stdout, /caminho relativo/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('falha quando nenhum build foi gerado', { skip: !hasBash }, () => {
  const root = createProject({ 'package.json': '{}' })
  try {
    const result = runScript(root)
    assert.notEqual(result.status, 0)
    assert.match(result.stdout, /Nenhuma pasta de build/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('recusa um index.html que ainda aponta para o código-fonte', { skip: !hasBash }, () => {
  const root = createProject({
    'dist/index.html': '<!doctype html><script type="module" src="/src/main.tsx"></script>',
  })
  try {
    const result = runScript(root)
    assert.notEqual(result.status, 0)
    assert.match(result.stdout, /codigo-fonte/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('explica que um build SSR não tem site estático para publicar', { skip: !hasBash }, () => {
  // Reproduz o layout do TanStack Start + Nitro: assets em .output/public,
  // worker em .output/server e nenhum index.html em lugar nenhum.
  const root = createProject({
    '.output/nitro.json': '{}',
    '.output/public/_headers': '/*\n  X-Frame-Options: DENY',
    '.output/public/assets/index-abc.js': 'console.log(1)',
    '.output/server/index.mjs': 'export default {}',
  })
  try {
    const result = runScript(root)
    assert.notEqual(result.status, 0)
    assert.match(result.stdout, /renderizado no servidor/)
    assert.match(result.stdout, /prerender ou modo SPA/)
    // O conselho antigo não serve aqui e não deve mais aparecer.
    assert.equal(/defina a variavel de repositorio PUBLISH_DIR/.test(result.stdout), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('o diagnóstico mostra dois níveis das pastas de build', { skip: !hasBash }, () => {
  const root = createProject({ '.output/public/assets/index-abc.js': 'console.log(1)' })
  try {
    const result = runScript(root)
    assert.notEqual(result.status, 0)
    // Sem o segundo nível não daria para ver que public/ não tem index.html.
    assert.match(result.stdout, /\.output.public/)
    assert.match(result.stdout, /assets/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('aceita o shell do TanStack Start em modo SPA', { skip: !hasBash }, () => {
  // Com nitro desligado e spa.enabled, o build emite _shell.html no lugar de
  // index.html; sem isto o repositório precisaria de um script próprio.
  const root = createProject({
    'dist/_shell.html': page,
    'dist/assets/index-abc.js': 'console.log(1)',
  })
  try {
    const result = runScript(root)
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.outputs['dist-dir'], 'dist')
    assert.equal(readFileSync(resolve(root, 'dist/index.html'), 'utf8'), page)
    assert.equal(readFileSync(resolve(root, 'dist/404.html'), 'utf8'), page)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('um index.html existente tem precedência sobre o shell', { skip: !hasBash }, () => {
  const real = '<!doctype html><title>real</title>'
  const root = createProject({ 'dist/index.html': real, 'dist/_shell.html': page })
  try {
    const result = runScript(root)
    assert.equal(result.status, 0, result.stderr)
    assert.equal(readFileSync(resolve(root, 'dist/index.html'), 'utf8'), real)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
