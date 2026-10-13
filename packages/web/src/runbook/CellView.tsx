import { useEffect, useRef, useState } from 'react'
import type { Cell, ResolvedKernel } from '@runtpt/core'
import { KernelBadge } from './KernelBadge.js'
import { OutputView } from './OutputView.js'
import type { CellState } from './useRunner.js'

interface Props {
  cell: Cell
  state: CellState
  kernel: ResolvedKernel
  resolved: string
  focused: boolean
  canRun: boolean
  canReplay: boolean
  stale?: boolean
  /** Set when the recorded output came from another shell than the one now selected. */
  ranUnder?: string
  onFocus: () => void
  onRun: () => void
  onReplay: () => void
  onCancel: () => void
}

const PHASE_LABEL: Record<string, string> = {
  idle: 'not run',
  running: 'running',
  ok: 'ok',
  failed: 'failed',
  cancelled: 'cancelled',
  timeout: 'timed out',
  skipped: 'skipped',
}

function duration(ms: number | null): string {
  if (ms === null) return ''
  if (ms < 1000) return `${ms} ms`
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`
}

export function CellView({
  cell,
  state,
  kernel,
  resolved,
  focused,
  canRun,
  canReplay,
  stale,
  ranUnder,
  onFocus,
  onRun,
  onReplay,
  onCancel,
}: Props) {
  const [showRaw, setShowRaw] = useState(false)
  const [armed, setArmed] = useState(false)
  const root = useRef<HTMLElement>(null)
  const substituted = resolved !== cell.source

  useEffect(() => {
    if (focused) root.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [focused])

  const running = state.phase === 'running'
  const needsConfirm = cell.attrs.confirm && !armed

  const run = () => {
    if (needsConfirm) {
      setArmed(true)
      return
    }
    setArmed(false)
    onRun()
  }

  return (
    <section
      ref={root}
      className={`cell ${focused ? 'focused' : ''} ${state.phase}`}
      tabIndex={-1}
      onMouseDown={onFocus}
      data-cell-id={cell.id}
    >
      <header className="cell-head">
        <KernelBadge cell={cell} resolved={kernel} />
        <span className="cell-id" title={cell.explicitId ? 'explicit id' : 'id derived from the content hash'}>
          {cell.attrs.name ?? cell.id}
        </span>
        <span className="chips">
          {cell.attrs.depends.length > 0 && <span className="chip">depends: {cell.attrs.depends.join(', ')}</span>}
          {cell.attrs.timeoutMs !== undefined && <span className="chip">timeout {cell.attrs.timeoutMs / 1000}s</span>}
          {cell.attrs.confirm && <span className="chip warn">confirm</span>}
          {cell.attrs.continueOnError && <span className="chip">continue-on-error</span>}
          {cell.attrs.hidden && <span className="chip">hidden</span>}
          {cell.attrs.cwd && <span className="chip">cwd {cell.attrs.cwd}</span>}
          {stale && <span className="chip stale">stale</span>}
          {ranUnder && <span className="chip stale">ran under {ranUnder}</span>}
        </span>
        <span className="spacer" />
        {substituted && (
          <button className="ghost small" onClick={() => setShowRaw((v) => !v)}>
            {showRaw ? 'show resolved' : 'show raw'}
          </button>
        )}
        {running ? (
          <button className="danger small" onClick={onCancel}>
            Cancel
          </button>
        ) : (
          <>
            {canReplay && (
              <button className="ghost small" onClick={onReplay} title="Show the recorded output instead of running">
                Replay
              </button>
            )}
            <button className={needsConfirm ? 'warn small' : 'primary small'} onClick={run} disabled={!canRun}>
              {needsConfirm ? 'Confirm…' : 'Run'}
            </button>
          </>
        )}
      </header>

      <pre className={`source ${showRaw ? 'raw' : ''}`}>{showRaw ? cell.source : resolved}</pre>
      {substituted && !showRaw && <div className="resolved-hint">parameters substituted — this is what will run</div>}
      {needsConfirm && <div className="resolved-hint warn">this cell asks for a confirmation before it runs</div>}

      <footer className="cell-foot">
        <span className={`status ${state.phase}`}>{PHASE_LABEL[state.phase] ?? state.phase}</span>
        {state.exit !== null && <span className="meta">exit {state.exit}</span>}
        {state.durationMs !== null && <span className="meta">{duration(state.durationMs)}</span>}
        {state.startedAt && <span className="meta">{new Date(state.startedAt).toLocaleTimeString()}</span>}
        {state.note && <span className="meta note">{state.note}</span>}
      </footer>

      <OutputView chunks={state.chunks} />
    </section>
  )
}
