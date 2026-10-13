import { useState } from 'react'
import { DEFAULT_AGENT_PORT } from '@runtpt/protocol'
import { Modal } from '../ui/Modal.js'
import type { AgentApi } from './useAgent.js'

const COMMAND = 'npx @runtpt/agent serve'

function Copyable({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="copyable">
      <code>{text}</code>
      <button
        className="ghost small"
        onClick={() => {
          void navigator.clipboard?.writeText(text)
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1200)
        }}
      >
        {copied ? 'copied' : 'copy'}
      </button>
    </div>
  )
}

export function AgentPanel({ agent, onClose }: { agent: AgentApi; onClose: () => void }) {
  const [url, setUrl] = useState(agent.url)
  const [pairing, setPairing] = useState(agent.pairing)

  if (agent.status === 'paired' && agent.host) {
    return (
      <Modal title="Agent" onClose={onClose}>
        <div className="stack">
          <dl className="facts">
            <dt>host</dt>
            <dd>{agent.host.name}</dd>
            <dt>system</dt>
            <dd>
              {agent.host.os} / {agent.host.arch}
            </dd>
            <dt>working directory</dt>
            <dd>
              <code>{agent.host.cwd}</code>
            </dd>
            <dt>agent</dt>
            <dd>{agent.host.agent}</dd>
          </dl>

          <div className="kernels">
            {agent.kernels.map((kernel) => (
              <div key={kernel.id} className={`kernel-row ${kernel.available ? '' : 'off'}`}>
                <span className={`kernel k-${kernel.id}`}>{kernel.id}</span>
                <span className="meta">{kernel.available ? (kernel.detail ?? 'available') : 'not detected'}</span>
                {kernel.available && (
                  <button className="ghost small" onClick={() => agent.restart(kernel.id)}>
                    Restart
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="row end">
            <button className="danger" onClick={agent.disconnect}>
              Disconnect
            </button>
          </div>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title="Connect a local agent" onClose={onClose} wide>
      <div className="stack">
        <p className="hint">
          Cells never run in the browser. They run on your machine, through an agent you start yourself, in the
          directory you choose. It listens on loopback only and refuses every connection without the pairing code it
          prints.
        </p>

        <ol className="steps">
          <li>
            <p>In the directory holding your runbooks, run:</p>
            <Copyable text={COMMAND} />
          </li>
          <li>
            <p>
              The agent prints a link like <code>http://localhost:5173/#agent=…&amp;pairing=…</code>. Open it and you
              are paired. Or paste the code here:
            </p>
            <div className="row">
              <input
                className="grow"
                value={pairing}
                placeholder="pairing code"
                autoFocus
                onChange={(e) => setPairing(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && pairing.trim()) agent.connect(url, pairing.trim())
                }}
              />
              <button className="primary" disabled={!pairing.trim()} onClick={() => agent.connect(url, pairing.trim())}>
                {agent.status === 'connecting' ? 'Connecting…' : 'Pair'}
              </button>
            </div>
            <details>
              <summary>Agent is not on the default port?</summary>
              <input className="grow" value={url} onChange={(e) => setUrl(e.target.value)} />
              <p className="hint">Default is ws://127.0.0.1:{DEFAULT_AGENT_PORT}</p>
            </details>
          </li>
        </ol>

        {agent.status === 'denied' && <p className="error">Pairing refused: {agent.message}</p>}
        {agent.status !== 'denied' && agent.message && <p className="error">{agent.message}</p>}

        <p className="hint">
          Without an agent you can still read any runbook, replay a <code>.runtpt</code>, and present. Only execution
          needs pairing.
        </p>
      </div>
    </Modal>
  )
}
