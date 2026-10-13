#!/usr/bin/env node
/**
 * Compiles the agent into a standalone binary with Bun, so installing runtpt
 * does not mean installing Node first (NFR-5).
 *
 *   node scripts/bundle.mjs                 the host platform, into dist/
 *   node scripts/bundle.mjs --all           every release target
 *   node scripts/bundle.mjs --target <t>    one named target
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { parseArgs } from 'node:util'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const entry = path.join(root, 'packages/agent/dist/cli.js')
const outDir = path.join(root, 'dist')

/** Bun's target name, and the triple mise's github backend matches on. */
const TARGETS = [
  { bun: 'bun-darwin-arm64', triple: 'aarch64-apple-darwin' },
  { bun: 'bun-darwin-x64', triple: 'x86_64-apple-darwin' },
  { bun: 'bun-linux-x64', triple: 'x86_64-unknown-linux-gnu' },
  { bun: 'bun-linux-arm64', triple: 'aarch64-unknown-linux-gnu' },
]

function hostTarget() {
  const os = process.platform === 'darwin' ? 'darwin' : 'linux'
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  const found = TARGETS.find((t) => t.bun === `bun-${os}-${arch}`)
  if (!found) throw new Error(`no release target for ${process.platform}/${process.arch}`)
  return found
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

/** The binary is useless without the UI, so the web build is part of bundling. */
function prepare() {
  execFileSync(npm, ['run', 'build', '-w', '@runtpt/web'], { stdio: 'inherit', cwd: root })
  execFileSync(process.execPath, [path.join(root, 'scripts/embed-web.mjs')], { stdio: 'inherit', cwd: root })
  execFileSync(npm, ['run', 'build', '-w', '@runtpt/agent'], { stdio: 'inherit', cwd: root })
}

function build(target, version) {
  const binary = path.join(outDir, target.triple, 'runtpt')
  mkdirSync(path.dirname(binary), { recursive: true })
  execFileSync(
    'bun',
    ['build', '--compile', `--target=${target.bun}`, entry, '--outfile', binary],
    { stdio: 'inherit', cwd: root },
  )
  console.log(`  ${path.relative(root, binary)}  ${(statSync(binary).size / 1024 / 1024).toFixed(1)} MB`)

  const archive = path.join(outDir, `runtpt-${version}-${target.triple}.tar.gz`)
  execFileSync('tar', ['-czf', archive, '-C', path.dirname(binary), 'runtpt'], { stdio: 'inherit' })
  console.log(`  ${path.relative(root, archive)}`)
  return archive
}

const { values } = parseArgs({
  options: { all: { type: 'boolean' }, target: { type: 'string' } },
  allowPositionals: false,
})

const version = JSON.parse(readFileSync(path.join(root, 'packages/agent/package.json'), 'utf8')).version

let targets
if (values.all) targets = TARGETS
else if (values.target) {
  const found = TARGETS.find((t) => t.triple === values.target || t.bun === values.target)
  if (!found) {
    console.error(`unknown target "${values.target}". Known: ${TARGETS.map((t) => t.triple).join(', ')}`)
    process.exit(2)
  }
  targets = [found]
} else targets = [hostTarget()]

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
console.log(`runtpt ${version} — building ${targets.length} target(s)`)
prepare()
for (const target of targets) build(target, version)
