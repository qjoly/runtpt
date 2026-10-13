import { randomUUID } from 'node:crypto'
import { createWriteStream, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ShellChoice } from '@runtpt/core'
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
  /** Overrides the runbook's shell for `shell` cells only. */
  shell?: ShellChoice | null
  /** Extra variables, above the runbook's `env` but below resolved params. */
  env?: Record<string, string>
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

/**
 * Relative to where the operator actually typed the command, not to the kernel
 * working directory — anchoring on the latter printed paths like `../../../tmp/x`.
 */
function displayPath(target: string): string {
  const relative = path.relative(process.cwd(), target)
  return relative === '' || relative.startsWith('..') ? target : relative
}

/** Prints whole lines as they arrive and returns whatever is still partial. */
function emitLines(buffer: string, log: (line: string) => void): string {
  const parts = buffer.split('\n')
  const rest = parts.pop() ?? ''
  for (const line of parts) log(`    | ${line}`)
  return rest
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

  // Asking to run something that cannot run is a mistake, not a run with nothing
  // in it. Exiting 0 on "0 ok, 0 failed" reads like the procedure went fine.
  if (runbook.cells.length === 0) {
    const inert = runbook.inertFences.length
    throw new HeadlessError(
      inert > 0
        ? `${displayPath(runbookPath)} has no executable cells, but ${inert} fence${inert > 1 ? 's' : ''} ` +
          `of a known kernel. It sets \`cells: tagged\`, so only fences carrying \`run\` become cells. ` +
          `Add \`run\` to the ones you mean to execute, or drop the setting to arm them all.`
        : `${displayPath(runbookPath)} has no executable cells.`,
      2,
    )
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

  let pendingLine = ''

  const pool = new KernelPool({
    cwd: sessionCwd,
    env: { ...runbook.settings.env, ...opts.env, ...resolved.values },
  })
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
      ...(opts.shell ? { shellOverride: opts.shell } : {}),
      ...(opts.env ? { extraEnv: opts.env } : {}),
      ...(opts.defaultTimeoutMs ? { defaultTimeoutMs: opts.defaultTimeoutMs } : {}),
      events: {
        onCellStart(cell, resolvedSource, index, total, resolvedKernel) {
          // Always report what actually runs, never the `shell` alias.
          log(`[${index + 1}/${total}] ${label(cell.id, cell.attrs.name)} (${kernelLabel(resolvedKernel)}) running`)
          emit({ event: 'cellStart', id: cell.id, kernel: resolvedKernel.kernel, interpreter: resolvedKernel.interpreter })
          writer.cell({
            id: cell.id,
            hash: cell.hash,
            kernel: resolvedKernel.kernel,
            source: resolvedSource,
            ...(cell.attrs.name ? { name: cell.attrs.name } : {}),
          })
        },
        onChunk(cell, stream2, data) {
          writer.out({ id: cell.id, stream: stream2, data })
          // Without this a long step shows nothing at all until it exits, and a
          // working command is indistinguishable from a hung one.
          if (!opts.json) {
            pendingLine = emitLines(pendingLine + data, log)
          }
        },
        onDisplay(cell, mime, data, encoding) {
          writer.out({ id: cell.id, stream: 'display', data, mime, ...(encoding ? { encoding } : {}) })
        },
        onCellEnd(cell, outcome, tolerated) {
          if (pendingLine) {
            log(`    | ${pendingLine}`)
            pendingLine = ''
          }
          writer.result({
            id: cell.id,
            status: outcome.status,
            exit: outcome.exit,
            durationMs: outcome.durationMs,
            tolerated,
          })
          const suffix = tolerated ? ' (tolerated: continue-on-error)' : ''
          log(`    → ${outcome.status} exit=${outcome.exit ?? '-'} in ${outcome.durationMs}ms${suffix}`)
          emit({ event: 'cellEnd', id: cell.id, status: outcome.status, exit: outcome.exit, tolerated })
        },
        onCellSkipped(cell, resolvedSource, reason, index, total, resolvedKernel) {
          log(`[${index + 1}/${total}] ${label(cell.id, cell.attrs.name)} skipped: ${reason}`)
          emit({ event: 'cellSkipped', id: cell.id, reason })
          writer.cell({
            id: cell.id,
            hash: cell.hash,
            kernel: resolvedKernel.kernel,
            source: resolvedSource,
            ...(cell.attrs.name ? { name: cell.attrs.name } : {}),
          })
          writer.note(`skipped: ${reason}`, cell.id)
          writer.result({ id: cell.id, status: 'skipped', exit: null, durationMs: 0 })
        },
      },
    })
    writer.footer()
  } finally {
    pool.disposeAll()
    await new Promise<void>((resolve) => stream.end(resolve))
  }

  const exitCode = summary.failed > 0 ? 1 : 0
  log(
    `runtpt: ${summary.ok} ok, ${summary.failed} failed, ${summary.tolerated} tolerated, ` +
    `${summary.skipped} skipped → ${displayPath(outPath)}`,
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

/** For the operator's log only: the recording keeps the bare kernel name. */
function kernelLabel(resolved: { kernel: string; interpreter?: string }): string {
  return resolved.interpreter ? `${resolved.kernel} (${resolved.interpreter})` : resolved.kernel
}

function label(id: string, name?: string): string {
  return name ? `${id} "${name}"` : id
}
