import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const envPath = resolve(projectRoot, '.env')
const examplePath = resolve(projectRoot, '.env.example')

const REQUIRED = ['GITHUB_TOKEN', 'GITHUB_ORG']

// Mesmo parser do servidor, para o diagnóstico daqui bater com o de lá.
const parseEnv = (content) => {
  const entries = {}
  for (const line of content.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const trimmed = line.trim().replace(/^export\s+/, '')
    if (!trimmed || trimmed.startsWith('#')) continue
    const separator = trimmed.indexOf('=')
    if (separator < 1) continue
    const key = trimmed.slice(0, separator).trim()
    if (/^[A-Z_][A-Z0-9_]*$/i.test(key)) {
      entries[key] = trimmed.slice(separator + 1).trim().replace(/^(['"])([\s\S]*)\1$/, '$2')
    }
  }
  return entries
}

if (!existsSync(envPath)) {
  if (!existsSync(examplePath)) {
    console.error('.env.example não encontrado. O repositório está incompleto.')
    process.exit(1)
  }

  // Sempre UTF-8 sem BOM: um BOM aqui faria a primeira variável ser ignorada.
  writeFileSync(envPath, readFileSync(examplePath, 'utf8').replace(/^\uFEFF/, ''), 'utf8')
  console.log('.env criado a partir de .env.example.')
} else {
  console.log('.env já existe; nada foi sobrescrito.')
}

const env = parseEnv(readFileSync(envPath, 'utf8'))
const missing = REQUIRED.filter((key) => !env[key] || env[key].startsWith('replace_with'))

console.log('')
console.log(`Arquivo: ${envPath}`)

if (missing.length === 0) {
  console.log('Configuração completa. Rode "npm run build" e depois "npm start".')
} else {
  console.log(`Falta configurar: ${missing.join(', ')}.`)
  console.log('')
  console.log('Você não precisa editar o arquivo à mão:')
  console.log('  1. npm run build && npm start')
  console.log('  2. abra http://localhost:4173 nesta máquina')
  console.log('  3. preencha o token do GitHub e a organização na tela de configuração')
  console.log('')
  console.log('O token fine-grained precisa destas permissões nos repositórios da organização:')
  console.log('  Metadata: leitura | Contents, Workflows, Secrets, Actions: leitura e escrita')
}

console.log('')
console.log('O painel escuta apenas em 127.0.0.1 por padrão. Para abrir à rede local,')
console.log('defina SERVER_HOST e PANEL_ACCESS_TOKEN no .env e reinicie.')
