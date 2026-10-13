import { useState } from 'react'
import { runtptPathFor } from '@runtpt/format'
import { Modal } from '../ui/Modal.js'
import type { AgentApi } from '../agent/useAgent.js'
import type { DocSource } from '../types.js'

interface Props {
  source: DocSource
  runtpt: string
  agent: AgentApi
  canCommit: boolean
  onCommit: () => void
  onNote: (text: string) => void
  onClose: () => void
}

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/x-ndjson' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
}

export function SavePanel({ source, runtpt, agent, canCommit, onCommit, onNote, onClose }: Props) {
  const sidecar = runtptPathFor(source.path)
  const [saved, setSaved] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState('')

  const saveToDisk = async () => {
    setError(null)
    try {
      const result = await agent.save(sidecar, runtpt)
      setSaved(result.path)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const lines = runtpt ? runtpt.trimEnd().split('\n').length : 0

  return (
    <Modal title="Save the run" onClose={onClose} wide>
      <div className="stack">
        <p className="hint">
          {lines} records, {new Blob([runtpt]).size} bytes. The markdown is untouched: outputs only ever live in the
          side-car.
        </p>

        <div className="field">
          <span className="field-label">Add a note to the recording</span>
          <div className="row">
            <input
              value={note}
              placeholder="What the numbers above actually mean…"
              onChange={(e) => setNote(e.target.value)}
            />
            <button
              className="ghost"
              disabled={!note.trim()}
              onClick={() => {
                onNote(note.trim())
                setNote('')
              }}
            >
              Add note
            </button>
          </div>
        </div>

        <div className="row wrap">
          <button className="primary" onClick={() => download(sidecar.split('/').pop() ?? 'run.runtpt', runtpt)}>
            Download
          </button>
          <button className="ghost" disabled={agent.status !== 'paired'} onClick={() => void saveToDisk()}>
            Save next to the runbook ({sidecar})
          </button>
          <button className="ghost" disabled={!canCommit} onClick={onCommit}>
            Commit to GitHub
          </button>
        </div>

        {saved && <p className="ok-box">Written to {saved}</p>}
        {error && <p className="error">{error}</p>}
        {!canCommit && <p className="hint">Committing needs a GitHub token and a runbook opened from a repository.</p>}

        <details>
          <summary>Preview the .runtpt</summary>
          <pre className="out stdout preview">{runtpt}</pre>
        </details>
      </div>
    </Modal>
  )
}
