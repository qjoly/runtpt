import { resolveKernel, type Runbook, type ShellChoice } from '@runtpt/core'
import { Modal } from '../ui/Modal.js'
import { KernelBadge } from './KernelBadge.js'
import type { Runner } from './useRunner.js'

export type ReviewReason = 'foreign' | 'undeclared'

interface Props {
  runbook: Runbook
  runner: Runner
  origin: string
  reason: ReviewReason
  shellOverride: ShellChoice | null
  onClose: () => void
  onConfirm: () => void
}

/** Section 9: code you did not write as a runbook gets read before it runs. */
export function ReviewPanel({ runbook, runner, origin, reason, shellOverride, onClose, onConfirm }: Props) {
  return (
    <Modal title="Review before running" onClose={onClose} wide>
      <div className="stack">
        <p className="warn-box">
          {reason === 'foreign' ? (
            <>
              This runbook comes from <strong>{origin}</strong>, which is not yours.
            </>
          ) : (
            <>
              <strong>{origin}</strong> never declared itself a runbook — no <code>runtpt:</code> frontmatter, no
              tagged cell. It is documentation that happens to contain commands.
            </>
          )}{' '}
          These are the {runbook.cells.length} commands it will run on your machine, with your parameters already
          substituted.
        </p>
        <div className="review-list">
          {runbook.cells.map((cell) => (
            <div key={cell.id} className="review-item">
              <div className="cell-head">
                <KernelBadge cell={cell} resolved={resolveKernel(cell, runbook.settings, shellOverride)} />
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
