import path from 'node:path'
import type { Cell, CellOutcome, ResolvedKernel, Runbook, ShellChoice } from '@runtpt/core'
import { buildPlan, resolveKernel, shouldSkip, substitute } from '@runtpt/core'
import type { ExecOutcome } from './kernels/types.js'
import type { KernelPool } from './pool.js'

export interface RunnerEvents {
  onCellStart?(cell: Cell, source: string, index: number, total: number, resolved: ResolvedKernel): void
  onChunk?(cell: Cell, stream: 'stdout' | 'stderr', data: string): void
  onDisplay?(cell: Cell, mime: string, data: string, encoding?: 'base64'): void
  onCellEnd?(cell: Cell, outcome: ExecOutcome, tolerated: boolean): void
  onCellSkipped?(
    cell: Cell,
    source: string,
    reason: string,
    index: number,
    total: number,
    resolved: ResolvedKernel,
  ): void
}

export interface RunOptions {
  runbook: Runbook
  params: Record<string, string>
  pool: KernelPool
  cwd: string
  /** Headless runs refuse `confirm` cells unless the operator said so explicitly. */
  allowConfirm?: boolean
  defaultTimeoutMs?: number
  /** Session-level answer to `shell` cells. Cells that pinned a kernel ignore it. */
  shellOverride?: ShellChoice | null
  /** Extra variables, above the runbook's `env` but below resolved params. */
  extraEnv?: Record<string, string>
  only?: string[]
  events?: RunnerEvents
  signal?: AbortSignal
}

export interface RunSummary {
  outcomes: Map<string, CellOutcome>
  ok: number
  /** Failures that make the run fail. */
  failed: number
  /** Failures covered by `continue-on-error` (FR-D6): recorded, but not fatal. */
  tolerated: number
  skipped: number
  aborted: boolean
}

/**
 * The single place where plan semantics live, so a headless CI run and a run
 * driven from the browser cannot drift apart.
 */
export async function runPlan(opts: RunOptions): Promise<RunSummary> {
  const { runbook, params, pool, events } = opts
  const plan = buildPlan(runbook, opts.only)
  const outcomes = new Map<string, CellOutcome>()
  const summary: RunSummary = { outcomes, ok: 0, failed: 0, tolerated: 0, skipped: 0, aborted: false }
  const total = plan.steps.length

  for (let i = 0; i < total; i++) {
    const step = plan.steps[i]!
    const cell = step.cell
    const source = substitute(cell.source, params)
    const resolved = resolveKernel(cell, runbook.settings, opts.shellOverride ?? null)

    const reason = skipReason(step, outcomes, summary.aborted, cell, opts)
    if (reason) {
      outcomes.set(cell.id, 'skipped')
      summary.skipped++
      events?.onCellSkipped?.(cell, source, reason, i, total, resolved)
      continue
    }

    events?.onCellStart?.(cell, source, i, total, resolved)

    let outcome: ExecOutcome
    try {
      const session = await pool.get({
        kernel: resolved.kernel,
        ...(resolved.interpreter ? { interpreter: resolved.interpreter } : {}),
      })
      const env = { ...runbook.settings.env, ...opts.extraEnv, ...params }
      const cwd = cellCwd(opts, cell)
      outcome = await session.exec(
        {
          source,
          env,
          ...(cwd ? { cwd } : {}),
          timeoutMs: cell.attrs.timeoutMs ?? opts.defaultTimeoutMs,
        },
        {
          chunk: (stream, data) => events?.onChunk?.(cell, stream, data),
          display: (mime, data, encoding) => events?.onDisplay?.(cell, mime, data, encoding),
        },
      )
    } catch (err) {
      events?.onChunk?.(cell, 'stderr', `${(err as Error).message}\n`)
      outcome = { status: 'failed', exit: null, durationMs: 0 }
    }

    outcomes.set(cell.id, outcome.status as CellOutcome)
    const tolerated = outcome.status !== 'ok' && cell.attrs.continueOnError
    if (outcome.status === 'ok') summary.ok++
    else if (tolerated) summary.tolerated++
    else {
      summary.failed++
      summary.aborted = true
    }
    events?.onCellEnd?.(cell, outcome, tolerated)
  }

  return summary
}

function skipReason(
  step: { cell: Cell; requires: string[] },
  outcomes: Map<string, CellOutcome>,
  aborted: boolean,
  cell: Cell,
  opts: RunOptions,
): string | null {
  if (opts.signal?.aborted) return 'the run was cancelled'
  if (aborted) return 'an earlier cell failed'
  const dep = shouldSkip(step, outcomes)
  if (dep) return dep
  if (cell.attrs.confirm && !opts.allowConfirm) return 'cell is marked confirm and no confirmation was given'
  return null
}

/** Only `cwd=` on the cell. The runbook-level cwd is where the session starts,
 * and overriding it per cell would undo any `cd` a previous cell did. */
function cellCwd(opts: RunOptions, cell: Cell): string | undefined {
  if (!cell.attrs.cwd) return undefined
  return path.resolve(opts.cwd, cell.attrs.cwd)
}
