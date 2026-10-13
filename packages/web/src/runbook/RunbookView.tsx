import { isStale, resolveKernel, sessionKey, type Cell, type Runbook, type ShellChoice } from '@runtpt/core'
import type { RunRecording } from '@runtpt/format'
import { useMemo } from 'react'
import { Markdown, type ChecklistView } from '../ui/Markdown.js'
import { buildChecklistIndex, lineIndexOf } from './checklist.js'
import { CellView } from './CellView.js'
import type { Runner } from './useRunner.js'

interface Props {
  runbook: Runbook
  runner: Runner
  recording: RunRecording | null
  canRun: boolean
  shellOverride: ShellChoice | null
  focusedId: string | null
  onFocus: (id: string) => void
  onRunCell: (cell: Cell) => void
}

export function RunbookView({
  runbook,
  runner,
  recording,
  canRun,
  shellOverride,
  focusedId,
  onFocus,
  onRunCell,
}: Props) {
  const prose = useMemo(
    () => runbook.blocks.map((block) => (block.kind === 'prose' ? block.markdown : '')),
    [runbook],
  )
  const checklist = useMemo(() => buildChecklistIndex(prose).byBlock.map(lineIndexOf), [prose])

  // Stable per block, so moving the focus does not re-parse the whole document.
  const views = useMemo<ChecklistView[]>(
    () =>
      checklist.map((byLine) => ({
        itemAt: (line) => byLine.get(line),
        // The document's own `[x]` is the starting point until the operator touches it.
        checked: (item) => runner.checks[item.id]?.checked ?? item.checked,
        at: (item) => runner.checks[item.id]?.at,
        readOnly: false,
        onToggle: (item, checked) => runner.toggleCheck(item.id, item.text, checked),
      })),
    [checklist, runner.checks, runner.toggleCheck],
  )

  return (
    <article className="document">
      {runbook.diagnostics.length > 0 && (
        <details className="diagnostics">
          <summary>
            {runbook.diagnostics.length} parser {runbook.diagnostics.length === 1 ? 'note' : 'notes'}
          </summary>
          <ul>
            {runbook.diagnostics.map((d, i) => (
              <li key={i} className={d.level}>
                {d.line !== undefined && <span className="meta">line {d.line}</span>} {d.message}
              </li>
            ))}
          </ul>
        </details>
      )}

      {runbook.cells.length === 0 && runbook.inertFences.length > 0 && (
        <p className="warn-box">
          Nothing here can run. {runbook.inertFences.length} code{' '}
          {runbook.inertFences.length === 1 ? 'block looks' : 'blocks look'} runnable, but
          this runbook sets <code>cells: tagged</code>, so only blocks carrying{' '}
          <code>run</code> become cells. Add <code>run</code> to the ones you mean to
          execute, or drop the setting to arm them all.
        </p>
      )}

      {runbook.blocks.map((block, index) => {
        if (block.kind === 'prose') return <Markdown key={index} text={prose[index]!} checklist={views[index]} />
        if (block.kind !== 'cell') return null
        const { cell } = block
        const state = runner.stateOf(cell.id)
        const kernel = resolveKernel(cell, runbook.settings, shellOverride)
        // Changing the session shell must not rewrite a finished run, only label it.
        const drift = state.ran && sessionKey(state.ran) !== sessionKey(kernel) ? state.ran.kernel : undefined
        return (
          <CellView
            key={cell.id}
            cell={cell}
            state={state}
            kernel={kernel}
            resolved={runner.resolve(cell)}
            focused={focusedId === cell.id}
            canRun={canRun && !runner.busy}
            canReplay={recording?.byId.has(cell.id) ?? false}
            stale={isStale(cell, recording?.byId.get(cell.id)?.hash)}
            {...(drift ? { ranUnder: drift } : {})}
            onFocus={() => onFocus(cell.id)}
            onRun={() => onRunCell(cell)}
            onReplay={() => runner.replayCell(cell)}
            onCancel={runner.cancel}
          />
        )
      })}
    </article>
  )
}
