import { useEffect, useState } from 'react'
import type { DirEntry } from '@runtpt/protocol'
import { Modal } from '../ui/Modal.js'
import { GithubSignIn } from '../github/GithubSignIn.js'
import { RepoPicker } from '../github/RepoPicker.js'
import { getFile, parseBlobUrl } from '../github/api.js'
import type { AgentApi } from '../agent/useAgent.js'
import type { GithubApi } from '../github/useGithub.js'
import { DEMO_RECORDING, DEMO_RUNBOOK } from '../demo/bundled.js'
import type { LoadedDoc } from '../types.js'

type Tab = 'github' | 'url' | 'agent' | 'file' | 'demo'

interface Props {
  github: GithubApi
  agent: AgentApi
  onOpen: (doc: LoadedDoc) => void
  onOpenRecording: (text: string, label: string) => void
  onClose: () => void
  initialTab?: Tab
}

function AgentBrowser({ agent, onOpen, onOpenRecording }: Omit<Props, 'github' | 'onClose'>) {
  const [path, setPath] = useState('.')
  const [entries, setEntries] = useState<DirEntry[]>([])
  const [parent, setParent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (agent.status !== 'paired') return
    agent
      .listDir(path)
      .then((dir) => {
        setEntries(dir.entries)
        setParent(dir.parent)
        setError(null)
      })
      .catch((err: Error) => setError(err.message))
  }, [agent, path])

  if (agent.status !== 'paired') return <p className="hint">Pair an agent to browse its working directory.</p>

  const open = async (entry: DirEntry) => {
    try {
      const doc = await agent.open(entry.path)
      if (entry.name.endsWith('.runtpt')) onOpenRecording(doc.content, entry.path)
      else
        onOpen({
          source: { origin: 'agent', path: doc.path, label: doc.path, writable: true },
          text: doc.content,
        })
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <div className="stack">
      <div className="row">
        <code className="grow">{path}</code>
        {parent && (
          <button className="ghost small" onClick={() => setPath(parent)}>
            ← up
          </button>
        )}
      </div>
      {error && <p className="error">{error}</p>}
      <div className="scroll-list">
        {entries
          .filter((e) => e.dir || /\.(md|markdown|runtpt)$/i.test(e.name))
          .map((entry) => (
            <button
              key={entry.path}
              className="list-row"
              onClick={() => (entry.dir ? setPath(entry.path) : void open(entry))}
            >
              <span>
                {entry.dir ? '📁 ' : ''}
                {entry.name}
              </span>
              <span className="meta">{entry.dir ? 'directory' : `${entry.size ?? 0} B`}</span>
            </button>
          ))}
      </div>
    </div>
  )
}

function UrlTab({ token, onOpen, onOpenRecording }: { token: string | null } & Pick<Props, 'onOpen' | 'onOpenRecording'>) {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const go = async () => {
    const location = parseBlobUrl(value)
    if (!location) {
      setError('Not a GitHub blob URL. Expected github.com/<owner>/<repo>/blob/<ref>/<path>.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const file = await getFile(location.owner, location.repo, location.path, location.ref, token)
      if (location.path.endsWith('.runtpt')) {
        onOpenRecording(file.text, `${location.owner}/${location.repo}/${location.path}`)
      } else {
        onOpen({
          source: {
            origin: 'github',
            path: location.path,
            label: `${location.owner}/${location.repo}@${location.ref}/${location.path}`,
            sha: file.sha,
            repo: { owner: location.owner, name: location.repo, ref: location.ref },
            writable: token !== null,
          },
          text: file.text,
        })
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack">
      <p className="hint">Paste a GitHub blob URL. Public repositories open without a token, read-only.</p>
      <div className="row">
        <input
          className="grow"
          autoFocus
          placeholder="https://github.com/owner/repo/blob/main/runbooks/incident.md"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void go()
          }}
        />
        <button className="primary" disabled={busy || !value.trim()} onClick={() => void go()}>
          Open
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  )
}

export function OpenPanel({ github, agent, onOpen, onOpenRecording, onClose, initialTab }: Props) {
  const [tab, setTab] = useState<Tab>(initialTab ?? (github.token ? 'github' : 'url'))

  return (
    <Modal title="Open a runbook" onClose={onClose} wide>
      <nav className="tabs">
        {(['github', 'url', 'agent', 'file', 'demo'] as Tab[]).map((name) => (
          <button key={name} className={tab === name ? 'tab active' : 'tab'} onClick={() => setTab(name)}>
            {name === 'url' ? 'From a URL' : name === 'agent' ? 'Agent disk' : name === 'file' ? 'Local file' : name === 'demo' ? 'Demo' : 'GitHub'}
          </button>
        ))}
      </nav>

      <div className="tab-body">
        {tab === 'github' &&
          (github.token ? (
            <RepoPicker token={github.token} onOpen={onOpen} onOpenRecording={onOpenRecording} />
          ) : (
            <GithubSignIn github={github} />
          ))}

        {tab === 'url' && <UrlTab token={github.token} onOpen={onOpen} onOpenRecording={onOpenRecording} />}

        {tab === 'agent' && <AgentBrowser agent={agent} onOpen={onOpen} onOpenRecording={onOpenRecording} />}

        {tab === 'file' && (
          <div className="stack">
            <p className="hint">
              A <code>.md</code> opens as a runbook, a <code>.runtpt</code> as a replay. Dropping a file anywhere in the
              window works too.
            </p>
            <input
              type="file"
              accept=".md,.markdown,.runtpt"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (!file) return
                void file.text().then((text) => {
                  if (file.name.endsWith('.runtpt')) onOpenRecording(text, file.name)
                  else
                    onOpen({
                      source: { origin: 'upload', path: file.name, label: file.name, writable: false },
                      text,
                    })
                })
              }}
            />
          </div>
        )}

        {tab === 'demo' && (
          <div className="stack">
            <p className="hint">Bundled with the app, so there is always something to look at.</p>
            <div className="row">
              <button className="primary" onClick={() => onOpen(DEMO_RUNBOOK)}>
                Open examples/hello.md
              </button>
              <button className="ghost" onClick={() => onOpenRecording(DEMO_RECORDING, 'examples/hello.runtpt')}>
                Replay examples/hello.runtpt
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
