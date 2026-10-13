import { useEffect, useState } from 'react'
import { runtptPathFor } from '@runtpt/format'
import { Modal } from '../ui/Modal.js'
import type { DocSource } from '../types.js'
import { createBranch, getFileSha, getRepo, putFile } from './api.js'

interface Props {
  source: DocSource
  token: string
  markdown: string
  runtpt: string
  onClose: () => void
}

type Phase = 'form' | 'working' | 'done'

export function CommitDialog({ source, token, markdown, runtpt, onClose }: Props) {
  const repo = source.repo
  const [branch, setBranch] = useState(repo?.ref ?? 'main')
  const [defaultBranch, setDefaultBranch] = useState<string | null>(null)
  const [path, setPath] = useState(runtptPathFor(source.path))
  const [message, setMessage] = useState(`Record a runtpt run of ${source.path}`)
  const [includeMarkdown, setIncludeMarkdown] = useState(false)
  const [acknowledge, setAcknowledge] = useState(false)
  const [newBranch, setNewBranch] = useState(false)
  const [phase, setPhase] = useState<Phase>('form')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  useEffect(() => {
    if (!repo) return
    getRepo(repo.owner, repo.name, token)
      .then((r) => setDefaultBranch(r.default_branch))
      .catch(() => setDefaultBranch(null))
  }, [repo, token])

  if (!repo) {
    return (
      <Modal title="Commit to GitHub" onClose={onClose}>
        <p className="error">This runbook did not come from a GitHub repository.</p>
      </Modal>
    )
  }

  const onDefault = defaultBranch !== null && branch === defaultBranch && !newBranch
  const targetBranch = newBranch ? `runtpt/${path.replace(/[^\w.-]+/g, '-')}-${Date.now().toString(36)}` : branch
  const blocked = onDefault && !acknowledge

  const commit = async () => {
    setPhase('working')
    setError(null)
    try {
      if (newBranch) await createBranch({ owner: repo.owner, repo: repo.name, from: branch, name: targetBranch, token })

      const existing = await getFileSha(repo.owner, repo.name, path, targetBranch, token)
      const first = await putFile({
        owner: repo.owner,
        repo: repo.name,
        path,
        branch: targetBranch,
        message,
        content: runtpt,
        sha: existing,
        token,
      })
      if (includeMarkdown) {
        const mdSha = await getFileSha(repo.owner, repo.name, source.path, targetBranch, token)
        await putFile({
          owner: repo.owner,
          repo: repo.name,
          path: source.path,
          branch: targetBranch,
          message: `${message} (runbook)`,
          content: markdown,
          sha: mdSha,
          token,
        })
      }
      setResult(first.htmlUrl)
      setPhase('done')
    } catch (err) {
      setError((err as Error).message)
      setPhase('form')
    }
  }

  return (
    <Modal title="Commit to GitHub" onClose={onClose} wide>
      {phase === 'done' && result ? (
        <div className="stack">
          <p>Committed to {targetBranch}.</p>
          <a className="button" href={result} target="_blank" rel="noreferrer">
            Open the commit on GitHub
          </a>
        </div>
      ) : (
        <div className="stack">
          <p className="warn-box">
            A <code>.runtpt</code> contains whatever your commands printed. Declared secrets are redacted; anything
            else your output revealed is not. Read it before pushing it to a repository.
          </p>

          <label className="field">
            <span className="field-label">Repository</span>
            <input value={`${repo.owner}/${repo.name}`} readOnly />
          </label>

          <label className="field">
            <span className="field-label">Branch</span>
            <input value={branch} onChange={(e) => setBranch(e.target.value)} />
          </label>

          {onDefault && (
            <div className="warn-box">
              <strong>{branch}</strong> is the default branch of this repository.
              <label className="check">
                <input type="checkbox" checked={newBranch} onChange={(e) => setNewBranch(e.target.checked)} />
                Create a new branch instead (recommended)
              </label>
              {!newBranch && (
                <label className="check">
                  <input type="checkbox" checked={acknowledge} onChange={(e) => setAcknowledge(e.target.checked)} />
                  I understand this commits straight to the default branch
                </label>
              )}
            </div>
          )}
          {newBranch && <p className="hint">New branch: <code>{targetBranch}</code></p>}

          <label className="field">
            <span className="field-label">Path</span>
            <input value={path} onChange={(e) => setPath(e.target.value)} />
          </label>

          <label className="field">
            <span className="field-label">Commit message</span>
            <textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} />
          </label>

          <label className="check">
            <input type="checkbox" checked={includeMarkdown} onChange={(e) => setIncludeMarkdown(e.target.checked)} />
            Also commit the runbook <code>{source.path}</code>
          </label>

          {error && <p className="error">{error}</p>}

          <div className="row end">
            <button className="ghost" onClick={onClose}>
              Cancel
            </button>
            <button className="primary" disabled={blocked || phase === 'working'} onClick={() => void commit()}>
              {phase === 'working' ? 'Committing…' : `Commit to ${targetBranch}`}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
