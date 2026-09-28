import assert from 'node:assert/strict'
import test from 'node:test'
import { parseEnvFile } from './env.ts'

test('ignora o BOM gravado por editores do Windows', () => {
  const parsed = parseEnvFile('﻿GITHUB_TOKEN=github_pat_abc\nGITHUB_ORG=Sites\n')
  assert.equal(parsed.GITHUB_TOKEN, 'github_pat_abc')
  assert.equal(parsed.GITHUB_ORG, 'Sites')
})

test('aceita aspas, espaços e o prefixo export', () => {
  const parsed = parseEnvFile([
    '# comentário',
    '',
    '  PANEL_ACCESS_TOKEN = "uma chave"  ',
    "export SERVER_HOST='192.168.0.10'",
    'PORT=4173',
  ].join('\n'))

  assert.equal(parsed.PANEL_ACCESS_TOKEN, 'uma chave')
  assert.equal(parsed.SERVER_HOST, '192.168.0.10')
  assert.equal(parsed.PORT, '4173')
})

test('descarta linhas sem chave válida', () => {
  const parsed = parseEnvFile(['=semchave', 'CHAVE-INVALIDA=1', 'sem_igual', 'VALIDA=1'].join('\n'))
  assert.deepEqual(Object.keys(parsed), ['VALIDA'])
})

test('preserva sinais de igual dentro do valor', () => {
  const parsed = parseEnvFile('BUILD_ENV_FILE=VITE_KEY=abc==\n')
  assert.equal(parsed.BUILD_ENV_FILE, 'VITE_KEY=abc==')
})
