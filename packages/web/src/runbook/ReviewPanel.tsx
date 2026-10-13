import type { Runbook } from '@runtpt/core'
import { Modal } from '../ui/Modal.js'
import type { Runner } from './useRunner.js'

interface Props {
  runbook: Runbook
  runner: Runner
  origin: string
  onClose: () => void
  onConfirm: () => void
}

/** Section 9: a runbook from a repository you do not own gets read before it runs. */
export function ReviewPanel({ runbook, runner, origin, onClose, onConfirm }: Props) {
  return (
    <Modal title="Review before running" onClose={onClose} wide>
      <div className="stack">
        <p className="warn-box">
          This runbook comes from <strong>{origin}</strong>. These are the {runbook.cells.length} commands it will run
          on your machine, with your parameters already substituted.
        </p>
        <div className="review-list">
          {runbook.cells.map((cell) => (
            <div key={cell.id} className="review-item">
              <div className="cell-head">
                <span className={`kernel k-${cell.kernel}`}>{cell.kernel}</span>
                <span className="cell-id">{cell.attrs.name ?? cell.id}</span>
                {cell.attrs.hidden && <span className="chip">hidden</span>}
                {cell.attrs.confirm && <span className="chip warn">confirm</span>}
              </div>
              <pre className="source">{runner.resolve(cell)}</pre>
            </div>
          ))}
        </div>
        <div className="row end">
          <button className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" onClick={onConfirm}>
            I read it, run all
          </button>
        </div>
      </div>
    </Modal>
  )
}
