import assert from 'node:assert/strict'
import test from 'node:test'
import { maskSecret, parseEnvFile, upsertEnvFile } from './env-file.ts'

const BOM = String.fromCharCode(0xfeff)

test('atualiza uma chave existente preservando comentários e ordem', () => {
  const original = [
    '# Token do GitHub',
    'GITHUB_TOKEN=antigo',
    '',
    '# Rede',
    'PORT=4173',
  ].join('\n')

  const updated = upsertEnvFile(original, { GITHUB_TOKEN: 'github_pat_novo' })

  assert.equal(updated, [
    '# Token do GitHub',
    'GITHUB_TOKEN=github_pat_novo',
    '',
    '# Rede',
    'PORT=4173',
  ].join('\n') + '\n')
})

test('acrescenta chaves ausentes no fim do arquivo', () => {
  const updated = upsertEnvFile('PORT=4173\n', { GITHUB_ORG: 'acme' })
  assert.equal(updated, 'PORT=4173\n\nGITHUB_ORG=acme\n')
})

test('cria o conteúdo do zero quando o arquivo está vazio', () => {
  const updated = upsertEnvFile('', { GITHUB_ORG: 'acme', PANEL_ACCESS_TOKEN: 'abc' })
  assert.equal(updated, 'GITHUB_ORG=acme\nPANEL_ACCESS_TOKEN=abc\n')
})

test('substitui a linha mesmo com export, espaços ou BOM', () => {
  const original = `${BOM}export  GITHUB_TOKEN = antigo\n`
  assert.equal(upsertEnvFile(original, { GITHUB_TOKEN: 'novo' }), 'GITHUB_TOKEN=novo\n')
})

test('não confunde chaves com prefixo em comum', () => {
  const original = 'GITHUB_ORG=acme\nGITHUB_ORGANIZATION=outro\n'
  const updated = upsertEnvFile(original, { GITHUB_ORG: 'nova' })
  assert.equal(updated, 'GITHUB_ORG=nova\nGITHUB_ORGANIZATION=outro\n')
})

test('escapa apenas valores que seriam reinterpretados na releitura', () => {
  const updated = upsertEnvFile('', { A: 'github_pat_x-1', B: 'com espaço', C: 'aspas"e\\barra' })
  assert.match(updated, /^A=github_pat_x-1$/m)
  assert.match(updated, /^B="com espaço"$/m)

  // O que foi escrito precisa voltar idêntico na leitura.
  const parsed = parseEnvFile(updated)
  assert.equal(parsed.A, 'github_pat_x-1')
  assert.equal(parsed.B, 'com espaço')
  assert.equal(parsed.C.includes('aspas'), true)
})

test('o ciclo escrever e reler preserva os valores', () => {
  const values = { GITHUB_TOKEN: 'github_pat_abc123', GITHUB_ORG: 'acme', DEFAULT_FTP_HOST: 'ftp.exemplo.com.br' }
  assert.deepEqual(parseEnvFile(upsertEnvFile('# início\n', values)), values)
})

test('a máscara mostra o suficiente para identificar sem revelar o segredo', () => {
  assert.equal(maskSecret('github_pat_11AAAAAA0abcdefgh'), 'github_pat_…efgh')
  assert.equal(maskSecret(''), '')
  assert.equal(maskSecret('curta'), '••••')
  assert.equal(maskSecret('github_pat_11AAAAAA0abcdefgh').includes('AAAAAA'), false)
})
