// Testes unitários com o executor nativo do Node; o esbuild (instalado com o Vite) converte o TypeScript.
import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const pasta = 'tests/unidade'
const arquivos = readdirSync(pasta).filter(nome => nome.endsWith('.test.ts')).map(nome => join(pasta, nome))
const saida = mkdtempSync(join(tmpdir(), 'beauty-testes-'))

try {
  await build({ entryPoints: arquivos, bundle: true, platform: 'node', format: 'esm', outdir: saida, outExtension: { '.js': '.mjs' }, logLevel: 'error' })
  const compilados = readdirSync(saida).map(nome => join(saida, nome))
  const resultado = spawnSync(process.execPath, ['--test', ...compilados], { stdio: 'inherit' })
  process.exitCode = resultado.status ?? 1
} finally {
  rmSync(saida, { recursive: true, force: true })
}
