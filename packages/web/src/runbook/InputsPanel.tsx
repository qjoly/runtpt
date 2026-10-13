import { useState } from 'react'
import type { Runbook } from '@runtpt/core'
import { Modal } from '../ui/Modal.js'
import type { SessionApi } from '../session/useSession.js'
import { ParamsTab } from './ParamsPanel.js'
import { VariablesTab } from './VariablesTab.js'
import type { Runner } from './useRunner.js'

export type InputsTab = 'params' | 'vars'

interface Props {
  runbook: Runbook
  runner: Runner
  session: SessionApi
  initialTab: InputsTab
  onClose: () => void
  /** Confirming resumes whatever the operator was trying to run. */
  onConfirm: () => void
}

export function InputsPanel({ runbook, runner, session, initialTab, onClose, onConfirm }: Props) {
  const specs = runbook.settings.params
  const [tab, setTab] = useState<InputsTab>(specs.length === 0 ? 'vars' : initialTab)
  const blocked = runner.missingParams.length > 0

  return (
    <Modal title="Inputs" onClose={onClose}>
      <div className="tabs">
        {specs.length > 0 && (
          <button className={`tab ${tab === 'params' ? 'active' : ''}`} onClick={() => setTab('params')}>
            Parameters {runner.missingParams.length > 0 && <span className="chip warn">{runner.missingParams.length}</span>}
          </button>
        )}
        <button className={`tab ${tab === 'vars' ? 'active' : ''}`} onClick={() => setTab('vars')}>
          Variables {session.count > 0 && <span className="chip">{session.count}</span>}
        </button>
      </div>

      {tab === 'params' ? (
        <ParamsTab specs={specs} runner={runner} />
      ) : (
        <VariablesTab frontmatter={runbook.settings.env} params={runner.values} session={session} />
      )}

      <div className="row end modal-actions">
        <button
          className="primary"
          disabled={blocked}
          onClick={() => {
            runner.markParamsAnswered()
            onConfirm()
          }}
        >
          Use these values
        </button>
      </div>
    </Modal>
  )
}
