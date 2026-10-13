import { isStale, type Cell, type Runbook } from '@runtpt/core'
import type { CellRun, NoteRecord, RunRecording } from '@runtpt/format'
import { useMemo } from 'react'
import { Markdown, type ChecklistView } from '../ui/Markdown.js'
import { buildChecklistIndex, lineIndexOf, mergeChecks } from '../runbook/checklist.js'
import { OutputView } from '../runbook/OutputView.js'
import type { OutChunk } from '../runbook/useRunner.js'

interface Props {
  recording: RunRecording
  runbook: Runbook | null
  label: string
  onLoadRunbook?: () => void
}

const toChunks = (run: CellRun): OutChunk[] =>
  run.outputs.map((o) => ({
    stream: o.stream,
    data: o.ref ? `[payload stored in the side directory: ${o.ref}]` : o.data,
    ...(o.mime ? { mime: o.mime } : {}),
    ...(o.encoding ? { encoding: o.encoding } : {}),
  }))

function Notes({ notes }: { notes: NoteRecord[] }) {
  if (notes.length === 0) return null
  return (
    <div className="notes">
      {notes.map((note, i) => (
        <blockquote key={i} className="operator-note">
          <span className="meta">{new Date(note.at).toLocaleString()}</span>
          {note.text}
        </blockquote>
      ))}
    </div>
  )
}

function RecordedCell({
  run,
  cell,
  stale,
  hasRunbook,
}: {
  run: CellRun
  cell?: Cell
  stale: boolean
  /** Without a runbook nothing can be "missing" from it, so the chip would lie. */
  hasRunbook: boolean
}) {
  return (
    <section className={`cell recorded ${run.status}`}>
      <header className="cell-head">
        <span className={`kernel k-${run.kernel}`}>{run.kernel}</span>
        <span className="cell-id">{run.name ?? run.id}</span>
        {stale && (
          <span className="chip stale" title="The cell source changed since this run">
            stale
          </span>
        )}
        {!cell && hasRunbook && <span className="chip">no longer in the runbook</span>}
        <span className="spacer" />
        <span className={`status ${run.status}`}>{run.status}</span>
        {run.exit !== null && <span className="meta">exit {run.exit}</span>}
        {run.durationMs !== null && <span className="meta">{run.durationMs} ms</span>}
        <span className="meta">{new Date(run.started).toLocaleTimeString()}</span>
      </header>
      <pre className="source">{run.source}</pre>
      {stale && cell && (
        <details className="stale-diff">
          <summary>The runbook now says something else</summary>
          <pre className="source raw">{cell.source}</pre>
        </details>
      )}
      <OutputView chunks={toChunks(run)} />
    </section>
  )
}

export function ReplayView({ recording, runbook, label, onLoadRunbook }: Props) {
  const header = recording.header
  const notesFor = (id: string) => recording.notes.filter((n) => n.after === id)
  const rendered = new Set<string>()

  const prose = useMemo(
    () => (runbook ? runbook.blocks.map((block) => (block.kind === 'prose' ? block.markdown : '')) : []),
    [runbook],
  )
  const checklist = useMemo(() => {
    const index = buildChecklistIndex(prose)
    const state = recording.checkState
    return {
      views: index.byBlock.map((items): ChecklistView => {
        const byLine = lineIndexOf(items)
        return {
          itemAt: (line) => byLine.get(line),
          checked: (item) => state.get(item.id)?.checked ?? false,
          at: (item) => state.get(item.id)?.at,
          note: (item) => (state.has(item.id) ? undefined : 'not ticked in this run'),
          readOnly: true,
        }
      }),
      ...mergeChecks(index.items, state),
    }
  }, [prose, recording])

  return (
    <article className="document replay">
      <div className="replay-head">
        <h1>{runbook?.title ?? header?.runbook.path ?? label}</h1>
        <dl className="facts">
          <dt>recording</dt>
          <dd>
            <code>{label}</code>
          </dd>
          {header && (
            <>
              <dt>runbook</dt>
              <dd>
                <code>{header.runbook.path}</code>
                {header.runbook.repo && (
                  <span className="meta">
                    {' '}
                    {header.runbook.repo}@{header.runbook.ref}
                  </span>
                )}
                {header.runbook.sha && <span className="meta"> sha {header.runbook.sha.slice(0, 8)}</span>}
              </dd>
              <dt>host</dt>
              <dd>
                {header.host.name} · {header.host.os}/{header.host.arch} · <code>{header.host.cwd}</code>
              </dd>
              <dt>started</dt>
              <dd>{new Date(header.run.started).toLocaleString()}</dd>
              {header.run.params && Object.keys(header.run.params).length > 0 && (
                <>
                  <dt>params</dt>
                  <dd>
                    {Object.entries(header.run.params).map(([k, v]) => (
                      <span key={k} className="chip">
                        {k}={v}
                      </span>
                    ))}
                  </dd>
                </>
              )}
            </>
          )}
          {recording.footer && (
            <>
              <dt>ended</dt>
              <dd>
                {new Date(recording.footer.ended).toLocaleString()} · {recording.footer.status} ·{' '}
                {recording.footer.cells.ok} ok, {recording.footer.cells.failed} failed,{' '}
                {recording.footer.cells.skipped} skipped
              </dd>
            </>
          )}
        </dl>

        {recording.interrupted && (
          <p className="warn-box">
            No footer: this run was interrupted. What follows is everything the agent managed to write.
          </p>
        )}
        {recording.truncated && <p className="warn-box">The last line of the file is incomplete and was dropped.</p>}
        {!runbook && (
          <p className="warn-box">
            The runbook is not loaded, so this is the degraded view: recorded sources and outputs only, no prose.
            {onLoadRunbook && (
              <button className="ghost small" onClick={onLoadRunbook}>
                {recording.header?.runbook.repo ? 'Load it from GitHub' : 'Load it from the agent'}
              </button>
            )}
          </p>
        )}
      </div>

      {runbook
        ? runbook.blocks.map((block, index) => {
            if (block.kind === 'prose')
              return <Markdown key={index} text={prose[index]!} checklist={checklist.views[index]} />
            if (block.kind !== 'cell') return null
            const { cell } = block
            const run = recording.byId.get(cell.id)
            if (!run) {
              return (
                <section key={cell.id} className="cell recorded idle">
                  <header className="cell-head">
                    <span className={`kernel k-${cell.kernel}`}>{cell.kernel}</span>
                    <span className="cell-id">{cell.attrs.name ?? cell.id}</span>
                    <span className="spacer" />
                    <span className="status idle">not in this run</span>
                  </header>
                  <pre className="source">{cell.source}</pre>
                </section>
              )
            }
            rendered.add(cell.id)
            return (
              <div key={cell.id}>
                <RecordedCell run={run} cell={cell} stale={isStale(cell, run.hash)} hasRunbook />
                <Notes notes={notesFor(cell.id)} />
              </div>
            )
          })
        : recording.cells.map((run, i) => (
            <div key={`${run.id}-${i}`}>
              <RecordedCell run={run} stale={false} hasRunbook={false} />
              <Notes notes={notesFor(run.id)} />
            </div>
          ))}

      {runbook &&
        recording.cells
          .filter((run) => !rendered.has(run.id))
          .map((run, i) => (
            <div key={`orphan-${run.id}-${i}`}>
              {/* A runbook is loaded and these are not in it: the chip is the point. */}
              <RecordedCell run={run} stale={false} hasRunbook />
              <Notes notes={notesFor(run.id)} />
            </div>
          ))}

      {checklist.orphans.length > 0 && (
        <section className="cell recorded idle">
          <header className="cell-head">
            <span className="cell-id">ticked items</span>
            {runbook && <span className="chip">no longer in the runbook</span>}
          </header>
          <ul className="prose orphan-checks">
            {checklist.orphans.map((record) => (
              <li key={record.id} className="check-item">
                <label title={new Date(record.at).toLocaleString()}>
                  <input type="checkbox" checked={record.checked} disabled readOnly />
                  <span className="check-label">{record.text}</span>
                </label>
                <span className="meta check-at">{new Date(record.at).toLocaleTimeString()}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Notes notes={recording.notes.filter((n) => !n.after)} />

      {recording.unknown.length > 0 && (
        <details className="diagnostics">
          <summary>{recording.unknown.length} orphan or unknown records</summary>
          <pre className="out stdout">{recording.unknown.map((r) => JSON.stringify(r)).join('\n')}</pre>
        </details>
      )}
    </article>
  )
}
