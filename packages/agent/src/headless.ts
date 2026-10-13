import { randomUUID } from 'node:crypto'
import { createWriteStream, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseRunbook, resolveParams } from '@runtpt/core'
import { Redactor, RuntptWriter, runtptPathFor } from '@runtpt/format'
import { KernelPool } from './pool.js'
import { runPlan, type RunSummary } from './runner.js'
import { AGENT_VERSION } from './server.js'

export class HeadlessError extends Error {
  constructor(message: string, readonly exitCode: number) {
    super(message)
  }
}

export interface HeadlessOptions {
  runbookPath: string
  out?: string
  params?: Record<string, string>
  cwd?: string
  defaultTimeoutMs?: number
  /** Without it, `confirm` cells are skipped: CI must not run what a human was meant to approve. */
  yes?: boolean
  json?: boolean
  log?: (line: string) => void
}

export interface HeadlessResult {
  outPath: string
  summary: RunSummary
  exitCode: number
}

export async function runHeadless(opts: HeadlessOptions): Promise<HeadlessResult> {
  const log = opts.log ?? ((line: string) => process.stderr.write(line + '\n'))
  const runbookPath = path.resolve(opts.runbookPath)
  let source: string
  try {
    source = await fs.readFile(runbookPath, 'utf8')
  } catch {
    throw new HeadlessError(`cannot read runbook: ${opts.runbookPath}`, 2)
  }

  const runbook = parseRunbook(source)
  for (const d of runbook.diagnostics) {
    if (d.level === 'error') throw new HeadlessError(`${runbookPath}: ${d.message}`, 2)
  }

  const resolved = resolveParams(runbook.settings.params, opts.params ?? {})
  if (resolved.missing.length > 0) {
    throw new HeadlessError(
      `missing required parameter(s): ${resolved.missing.join(', ')} — pass them with --param NAME=value`,
      2,
    )
  }

  const redactor = new Redactor()
  for (const name of resolved.secrets) {
    const value = resolved.values[name]
    if (!value) continue
    // Silently failing to redact is worse than not offering the feature.
    if (!redactor.add(name, value)) {
      log(`runtpt: warning: ${name} is too short to redact safely; it will appear in the recording`)
    }
  }
  const outPath = path.resolve(opts.out ?? runtptPathFor(runbookPath))
  await fs.mkdir(path.dirname(outPath), { recursive: true })
  const stream = createWriteStream(outPath, { encoding: 'utf8' })

  const base = path.resolve(opts.cwd ?? process.cwd())
  const sessionCwd = runbook.settings.cwd ? path.resolve(base, runbook.settings.cwd) : base
  const emit = (event: Record<string, unknown>): void => {
    if (opts.json) process.stdout.write(JSON.stringify(event) + '\n')
  }

  const writer = new RuntptWriter({
    runbook: { path: path.relative(base, runbookPath) || path.basename(runbookPath) },
    host: {
      name: os.hostname(),
      os: process.platform,
      arch: process.arch,
      agent: `runtpt-agent/${AGENT_VERSION}`,
      cwd: sessionCwd,
    },
    runId: randomUUID(),
    params: resolved.values,
    redactor,
    sink: (line) => stream.write(line + '\n'),
  })

  const pool = new KernelPool({ cwd: sessionCwd, env: { ...runbook.settings.env, ...resolved.values } })
  writer.header()
  if (runbook.title) log(`runtpt: ${runbook.title}`)

  let summary: RunSummary
  try {
    summary = await runPlan({
      runbook,
      params: resolved.values,
      pool,
      cwd: base,
      allowConfirm: opts.yes === true,
      ...(opts.defaultTimeoutMs ? { defaultTimeoutMs: opts.defaultTimeoutMs } : {}),
      events: {
        onCellStart(cell, resolvedSource, index, total) {
          log(`[${index + 1}/${total}] ${label(cell.id, cell.attrs.name)} (${cell.kernel}) running`)
          emit({ event: 'cellStart', id: cell.id, kernel: cell.kernel })
          writer.cell({
            id: cell.id,
            hash: cell.hash,
            kernel: cell.kernel,
            source: resolvedSource,
            ...(cell.attrs.name ? { name: cell.attrs.name } : {}),
          })
        },
        onChunk(cell, stream2, data) {
          writer.out({ id: cell.id, stream: stream2, data })
        },
        onDisplay(cell, mime, data, encoding) {
          writer.out({ id: cell.id, stream: 'display', data, mime, ...(encoding ? { encoding } : {}) })
        },
        onCellEnd(cell, outcome, tolerated) {
          writer.result({
            id: cell.id,
            status: outcome.status,
            exit: outcome.exit,
            durationMs: outcome.durationMs,
          })
          const suffix = tolerated ? ' (tolerated: continue-on-error)' : ''
          log(`    → ${outcome.status} exit=${outcome.exit ?? '-'} in ${outcome.durationMs}ms${suffix}`)
          emit({ event: 'cellEnd', id: cell.id, status: outcome.status, exit: outcome.exit, tolerated })
        },
        onCellSkipped(cell, resolvedSource, reason, index, total) {
          log(`[${index + 1}/${total}] ${label(cell.id, cell.attrs.name)} skipped: ${reason}`)
          emit({ event: 'cellSkipped', id: cell.id, reason })
          writer.cell({
            id: cell.id,
            hash: cell.hash,
            kernel: cell.kernel,
            source: resolvedSource,
            ...(cell.attrs.name ? { name: cell.attrs.name } : {}),
          })
          writer.note(`skipped: ${reason}`, cell.id)
          writer.result({ id: cell.id, status: 'skipped', exit: null, durationMs: 0 })
        },
      },
    })
    writer.footer(summary.failed > 0 ? 'failed' : 'ok')
  } finally {
    pool.disposeAll()
    await new Promise<void>((resolve) => stream.end(resolve))
  }

  const exitCode = summary.failed > 0 ? 1 : 0
  log(
    `runtpt: ${summary.ok} ok, ${summary.failed} failed, ${summary.tolerated} tolerated, ` +
    `${summary.skipped} skipped → ${path.relative(base, outPath) || outPath}`,
  )
  emit({
    event: 'done',
    ok: summary.ok,
    failed: summary.failed,
    tolerated: summary.tolerated,
    skipped: summary.skipped,
    out: outPath,
    exitCode,
  })
  return { outPath, summary, exitCode }
}

function label(id: string, name?: string): string {
  return name ? `${id} "${name}"` : id
}
