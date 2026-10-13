import { SHELL_KERNELS, type RuntptSettings, type ShellChoice } from '@runtpt/core'
import type { KernelInfo } from '@runtpt/protocol'
import { Modal } from '../ui/Modal.js'
import type { AgentApi } from '../agent/useAgent.js'
import type { SessionApi } from './useSession.js'

interface Props {
  settings: RuntptSettings | null
  agent: AgentApi
  session: SessionApi
  onClose: () => void
  onPair: () => void
}

const isShell = (info: KernelInfo): boolean => (SHELL_KERNELS as readonly string[]).includes(info.id)

function Row({
  name,
  detail,
  selected,
  disabled,
  onPick,
}: {
  name: string
  detail: string
  selected: boolean
  disabled?: boolean
  onPick: () => void
}) {
  return (
    <button
      className={`list-row shell-row ${selected ? 'selected' : ''}`}
      disabled={disabled}
      aria-pressed={selected}
      onClick={onPick}
    >
      <span>{name}</span>
      <span className="meta">{detail}</span>
    </button>
  )
}

export function ShellPanel({ settings, agent, session, onClose, onPair }: Props) {
  const fromRunbook = settings?.shell ?? { kernel: 'bash' as const }
  const available = agent.kernels.filter((k) => isShell(k) && k.available)
  const override = session.shellOverride

  const pick = (choice: ShellChoice | null) => {
    session.setShellOverride(choice)
    onClose()
  }

  return (
    <Modal title="Session shell" onClose={onClose}>
      <div className="stack">
        <p className="hint">
          Applies to <code>shell</code> cells only. A cell that names its shell — <code>bash</code>, <code>zsh</code>,{' '}
          <code>sh</code> — keeps it whatever you choose here.
        </p>

        {agent.status !== 'paired' && (
          <div className="warn-box row between">
            <span>No agent is connected, and only the agent knows which shells exist on this machine.</span>
            <button className="primary small" onClick={onPair}>
              Pair an agent
            </button>
          </div>
        )}

        <div className="scroll-list">
          <div className="group-head">default</div>
          <Row
            name="from the runbook"
            detail={fromRunbook.path ?? fromRunbook.kernel}
            selected={override === null}
            onPick={() => pick(null)}
          />
          <div className="group-head">shells on {agent.host?.name ?? 'the agent'}</div>
          {available.length === 0 ? (
            <div className="list-row empty">
              <span className="meta">
                {agent.status === 'paired' ? 'The agent detected no usable shell.' : 'Connect an agent to see them.'}
              </span>
            </div>
          ) : (
            available.map((kernel) => (
              <Row
                key={kernel.id}
                name={kernel.id}
                detail={kernel.path ?? kernel.detail ?? 'detected'}
                selected={override?.kernel === kernel.id}
                onPick={() => pick({ kernel: kernel.id as ShellChoice['kernel'], ...(kernel.path ? { path: kernel.path } : {}) })}
              />
            ))
          )}
        </div>

        <p className="hint">
          Cells that already ran keep their recorded output. One that ran under another shell is marked, so nothing on
          the page claims a result it did not produce.
        </p>
      </div>
    </Modal>
  )
}
