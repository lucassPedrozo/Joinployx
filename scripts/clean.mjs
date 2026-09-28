import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'

const generatedPaths = [
  'dist',
  'dist-server',
  'dist-electron',
  'node_modules/.tmp',
]

await Promise.all(
  generatedPaths.map((path) => rm(resolve(process.cwd(), path), { recursive: true, force: true }))
)

console.log('Artefatos gerados removidos.')
