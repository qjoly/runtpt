import type { Cell, Diagnostic, Runbook } from './model.js'

export interface PlanStep {
  cell: Cell
  /** Ids that must have succeeded before this cell may run. */
  requires: string[]
}

export interface RunPlan {
  steps: PlanStep[]
  diagnostics: Diagnostic[]
}

/**
 * Document order, adjusted so a cell never precedes a cell it depends on.
 * A cycle is reported and broken by falling back to document order, because
 * refusing to run the whole runbook over one bad `depends` is worse.
 */
export function buildPlan(runbook: Runbook, only?: string[]): RunPlan {
  const diagnostics: Diagnostic[] = []
  const byId = new Map(runbook.cells.map((c) => [c.id, c]))
  const selected = only ? new Set(only) : null

  const ordered: Cell[] = []
  const state = new Map<string, 'visiting' | 'done'>()

  const visit = (cell: Cell, trail: string[]): void => {
    const current = state.get(cell.id)
    if (current === 'done') return
    if (current === 'visiting') {
      diagnostics.push({
        level: 'error',
        message: `Dependency cycle: ${[...trail, cell.id].join(' → ')}`,
        line: cell.startLine,
      })
      return
    }
    state.set(cell.id, 'visiting')
    for (const dep of cell.attrs.depends) {
      const target = byId.get(dep)
      if (target) visit(target, [...trail, cell.id])
    }
    state.set(cell.id, 'done')
    ordered.push(cell)
  }

  for (const cell of runbook.cells) {
    if (selected && !selected.has(cell.id)) continue
    visit(cell, [])
  }

  const steps = ordered.map((cell) => ({
    cell,
    requires: cell.attrs.depends.filter((d) => byId.has(d)),
  }))

  return { steps, diagnostics }
}

export type CellOutcome = 'ok' | 'failed' | 'cancelled' | 'timeout' | 'skipped'

/**
 * A cell is skipped when any dependency did not finish `ok`. The caller owns
 * the outcome map so this stays usable from the browser and from the CLI.
 */
export function shouldSkip(step: PlanStep, outcomes: Map<string, CellOutcome>): string | null {
  for (const dep of step.requires) {
    const outcome = outcomes.get(dep)
    if (outcome === undefined) return `dependency "${dep}" has not run`
    if (outcome !== 'ok') return `dependency "${dep}" ${outcome}`
  }
  return null
}

/** True when a prior run's recorded hash no longer matches the current cell. */
export function isStale(cell: Cell, recordedHash: string | undefined): boolean {
  return recordedHash !== undefined && recordedHash !== cell.hash
}
