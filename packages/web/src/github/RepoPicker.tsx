import { useEffect, useMemo, useState } from 'react'
import { getFile, listBranches, listMarkdown, listRepos, type GhBranch, type GhRepo, type GhTreeEntry } from './api.js'
import type { LoadedDoc } from '../types.js'

interface Props {
  token: string
  onOpen: (doc: LoadedDoc) => void
  onOpenRecording: (text: string, label: string) => void
}

export function RepoPicker({ token, onOpen, onOpenRecording }: Props) {
  const [repos, setRepos] = useState<GhRepo[] | null>(null)
  const [repo, setRepo] = useState<GhRepo | null>(null)
  const [branches, setBranches] = useState<GhBranch[]>([])
  const [ref, setRef] = useState('')
  const [entries, setEntries] = useState<GhTreeEntry[] | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listRepos(token).then(setRepos).catch((err: Error) => setError(err.message))
  }, [token])

  // The same box filters repositories and then files. Typing a repository name
  // to find it left that word filtering the file list, where it matches almost
  // nothing: searching "runtpt" then opening qjoly/runtpt hid every .md.
  useEffect(() => {
    setFilter('')
  }, [repo])

  useEffect(() => {
    if (!repo) return
    setRef(repo.default_branch)
    listBranches(repo.owner.login, repo.name, token).then(setBranches).catch(() => setBranches([]))
  }, [repo, token])

  useEffect(() => {
    if (!repo || !ref) return
    setEntries(null)
    setError(null)
    setTruncated(false)
    listMarkdown(repo.owner.login, repo.name, ref, token)
      .then((listing) => {
        setEntries(listing.entries)
        setTruncated(listing.truncated)
      })
      .catch((err: Error) => setError(err.message))
  }, [repo, ref, token])

  const grouped = useMemo(() => {
    if (!repos) return []
    const byOwner = new Map<string, GhRepo[]>()
    const needle = repo ? '' : filter.toLowerCase()
    for (const item of repos) {
      if (needle && !item.full_name.toLowerCase().includes(needle)) continue
      const list = byOwner.get(item.owner.login)
      if (list) list.push(item)
      else byOwner.set(item.owner.login, [item])
    }
    return [...byOwner.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [repos, filter, repo])

  const visible = useMemo(() => {
    if (!entries) return []
    const needle = filter.toLowerCase()
    return entries.filter((e) => !needle || e.path.toLowerCase().includes(needle)).slice(0, 400)
  }, [entries, filter])

  const open = async (entry: GhTreeEntry) => {
    if (!repo) return
    setBusy(true)
    setError(null)
    try {
      const file = await getFile(repo.owner.login, repo.name, entry.path, ref, token)
      if (entry.path.endsWith('.runtpt')) {
        onOpenRecording(file.text, `${repo.full_name}/${entry.path}`)
      } else {
        onOpen({
          source: {
            origin: 'github',
            path: entry.path,
            label: `${repo.full_name}@${ref}/${entry.path}`,
            sha: file.sha,
            repo: { owner: repo.owner.login, name: repo.name, ref },
            writable: repo.permissions?.push !== false,
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

  if (!repo) {
    return (
      <div className="stack">
        <input placeholder="Filter repositories…" value={filter} onChange={(e) => setFilter(e.target.value)} autoFocus />
        {error && <p className="error">{error}</p>}
        {!repos && <p className="hint">Loading repositories…</p>}
        <div className="scroll-list">
          {grouped.map(([owner, items]) => (
            <div key={owner}>
              <div className="group-head">{owner}</div>
              {items.map((item) => (
                <button key={item.full_name} className="list-row" onClick={() => setRepo(item)}>
                  <span>{item.name}</span>
                  <span className="meta">
                    {item.private ? 'private' : 'public'} · {item.default_branch}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="stack">
      <div className="row">
        <button className="ghost small" onClick={() => { setRepo(null); setEntries(null); setFilter('') }}>
          ← repositories
        </button>
        <strong>{repo.full_name}</strong>
        <select value={ref} onChange={(e) => setRef(e.target.value)}>
          {branches.length === 0 && <option value={ref}>{ref}</option>}
          {branches.map((b) => (
            <option key={b.name} value={b.name}>
              {b.name}
            </option>
          ))}
        </select>
      </div>
      <input placeholder="Filter files…" value={filter} onChange={(e) => setFilter(e.target.value)} autoFocus />
      {error && <p className="error">{error}</p>}
      {!entries && <p className="hint">Loading the tree…</p>}
      {entries && entries.length === 0 && <p className="hint">No markdown in this branch.</p>}
      {truncated && (
        <p className="warn-box">
          GitHub cut this listing short, so some files are missing from it. Paste the
          file&apos;s URL in <em>From a URL</em> to open it directly.
        </p>
      )}
      <div className="scroll-list">
        {visible.map((entry) => (
          <button key={entry.path} className="list-row" disabled={busy} onClick={() => void open(entry)}>
            <span>{entry.path}</span>
            <span className="meta">{entry.path.endsWith('.runtpt') ? 'recording' : 'runbook'}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
