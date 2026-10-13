import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { parseRunbook, type Cell } from '@runtpt/core'
import { readRuntpt, type RunRecording } from '@runtpt/format'
import { useAgent } from './agent/useAgent.js'
import { useFileWatch } from './agent/useFileWatch.js'
import { AssetProvider, useAssetContext } from './assets/context.js'
import { AgentPanel } from './agent/AgentPanel.js'
import { useGithub } from './github/useGithub.js'
import { CommitDialog } from './github/CommitDialog.js'
import { getFile } from './github/api.js'
import { OpenPanel } from './open/OpenPanel.js'
import { RunbookView } from './runbook/RunbookView.js'
import { InputsPanel, type InputsTab } from './runbook/InputsPanel.js'
import { ReviewPanel, type ReviewReason } from './runbook/ReviewPanel.js'
import { SavePanel } from './runbook/SavePanel.js'
import { useRunner } from './runbook/useRunner.js'
import { ReplayView } from './replay/ReplayView.js'
import { Present } from './present/Present.js'
import { Shortcuts } from './ui/Shortcuts.js'
import { useTheme } from './theme/useTheme.js'
import { useSession } from './session/useSession.js'
import { ShellPanel } from './session/ShellPanel.js'
import { DEMO_RUNBOOK } from './demo/bundled.js'
import { refetchDoc, reloadRefusal } from './reload.js'
import type { LoadedDoc } from './types.js'

type Panel = 'open' | 'signin' | 'agent' | 'shell' | 'inputs' | 'save' | 'commit' | 'review' | 'shortcuts' | null

export function App() {
  const agent = useAgent()
  const github = useGithub()
  const session = useSession()
  const theme = useTheme()

  const [doc, setDoc] = useState<LoadedDoc>(DEMO_RUNBOOK)
  const [recording, setRecording] = useState<RunRecording | null>(null)
  const [recordingLabel, setRecordingLabel] = useState('')
  const [reviewReason, setReviewReason] = useState<ReviewReason>('foreign')
  const [view, setView] = useState<'run' | 'replay'>('run')
  const [panel, setPanel] = useState<Panel>(null)
  const [inputsTab, setInputsTab] = useState<InputsTab>('params')
  const [presenting, setPresenting] = useState(false)
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [reloading, setReloading] = useState(false)
  // Bumped on every successful reload so the "changed on disk" flag starts over.
  const [generation, setGeneration] = useState(0)

  const runbook = useMemo(() => (doc ? parseRunbook(doc.text) : null), [doc])
  const runner = useRunner(runbook, doc?.source ?? null, agent, recording, session)
  const assets = useAssetContext(doc.source, github.token, agent)

  const canRun = agent.status === 'paired'
  const paramsPending = runbook !== null && runbook.settings.params.length > 0 && !runner.paramsAnswered

  const openDoc = useCallback((next: LoadedDoc) => {
    setDoc(next)
    setView('run')
    setPanel(null)
    setFocusedId(null)
    setGeneration((n) => n + 1)
  }, [])

  const changedOnDisk = useFileWatch(agent, doc.source, generation)
  const refusal = reloadRefusal(doc.source)

  /**
   * Explicit only. Nothing here runs on a watcher event: a document swapped
   * under a half-finished procedure is how an operator loses their place.
   */
  const reload = useCallback(async () => {
    if (reloading) return
    if (refusal) {
      setToast(refusal)
      return
    }
    if (runner.busy || runner.runningCellId) {
      setToast('A cell is running. Stop it (c) or wait for it to finish, then reload.')
      return
    }
    setReloading(true)
    try {
      const next = await refetchDoc(doc.source, agent, github.token)
      setDoc(next)
      setGeneration((n) => n + 1)
      setToast(null)
    } catch (err) {
      // The document on screen is untouched; only the attempt failed.
      setToast(`Reload failed: ${(err as Error).message}`)
    } finally {
      setReloading(false)
    }
  }, [agent, doc.source, github.token, refusal, reloading, runner.busy, runner.runningCellId])

  const openRecording = useCallback((text: string, label: string) => {
    setRecording(readRuntpt(text))
    setRecordingLabel(label)
    setView('replay')
    setPanel(null)
  }, [])

  // The replay's own runbook, pulled from the repository the header points at.
  const loadRecordedRunbook = useCallback(async () => {
    const ref = recording?.header?.runbook
    if (!ref) return

    if (!ref.repo) {
      // A recording read off the agent's disk: its runbook is a sibling there.
      if (agent.status !== 'paired') return
      try {
        const file = await agent.open(ref.path)
        setDoc({
          source: { origin: 'agent', path: ref.path, label: ref.path, writable: true },
          text: file.content,
        })
      } catch (err) {
        setToast((err as Error).message)
      }
      return
    }

    const [owner, name] = ref.repo.split('/')
    if (!owner || !name) return
    try {
      const file = await getFile(owner, name, ref.path, ref.ref ?? 'HEAD', github.token)
      setDoc({
        source: {
          origin: 'github',
          path: ref.path,
          label: `${ref.repo}@${ref.ref ?? 'HEAD'}/${ref.path}`,
          sha: file.sha,
          repo: { owner, name, ref: ref.ref ?? 'HEAD' },
          writable: github.token !== null,
        },
        text: file.text,
      })
    } catch (err) {
      setToast((err as Error).message)
    }
  }, [agent, github.token, recording])

  // What the operator asked for before the parameters interrupted them. Without
  // this, filling the modal silently dropped the click that opened it.
  const resumeAfterParams = useRef<(() => void) | null>(null)
  const askParams = useCallback((resume: () => void) => {
    resumeAfterParams.current = resume
    setInputsTab('params')
    setPanel('inputs')
  }, [])

  const openInputs = useCallback((tab: InputsTab) => {
    setInputsTab(tab)
    setPanel('inputs')
  }, [])

  const runAllNow = useCallback(() => {
    const owner = doc.source.repo?.owner
    const foreign = doc.source.origin === 'github' && owner !== undefined && owner !== github.user?.login
    // A document that never declared itself a runbook is documentation that
    // happens to contain commands. Your own README is the dangerous case: it is
    // not foreign, and it is full of installation lines nobody meant to run.
    const undeclared = runbook !== null && !runbook.declaresRuntpt
    if (foreign || undeclared) {
      setReviewReason(foreign ? 'foreign' : 'undeclared')
      setPanel('review')
      return
    }
    void runner.runAll()
  }, [doc.source, github.user, runbook, runner])

  /**
   * A recording only belongs to the document it names. Rendering it over
   * whatever happens to be open produced a page of "not in this run" cells
   * describing a runbook the operator never ran.
   */
  const recordedRunbook = useMemo(() => {
    if (!recording) return runbook
    const recorded = recording.header?.runbook.path
    if (!recorded) return runbook
    return recorded === doc.source.path ? runbook : null
  }, [doc.source.path, recording, runbook])

  const canLoadRecordedRunbook =
    recordedRunbook === null &&
    recording !== null &&
    (recording.header?.runbook.repo !== undefined || agent.status === 'paired')

    const startRunAll = useCallback(() => {
    if (!runbook) return
    if (paramsPending) {
      askParams(runAllNow)
      return
    }
    runAllNow()
  }, [askParams, paramsPending, runAllNow, runbook])

  // Every path to a run goes through here, so a missing parameter always asks first.
  const runOne = useCallback(
    (cell: Cell) => {
      const go = () => {
        setFocusedId(cell.id)
        void runner.runCell(cell)
      }
      if (paramsPending) {
        askParams(go)
        return
      }
      go()
    },
    [askParams, paramsPending, runner],
  )

  const runFocused = useCallback(
    (moveOn: boolean) => {
      if (!runbook) return
      const index = runbook.cells.findIndex((c) => c.id === focusedId)
      const cell = runbook.cells[index === -1 ? 0 : index]
      if (!cell) return
      runOne(cell)
      if (moveOn) {
        const next = runbook.cells[(index === -1 ? 0 : index) + 1]
        if (next) setFocusedId(next.id)
      }
    },
    [focusedId, runOne, runbook],
  )

  const move = useCallback(
    (delta: number) => {
      if (!runbook || runbook.cells.length === 0) return
      const index = runbook.cells.findIndex((c) => c.id === focusedId)
      const target = runbook.cells[Math.min(Math.max((index === -1 ? -1 : index) + delta, 0), runbook.cells.length - 1)]
      if (target) setFocusedId(target.id)
    },
    [focusedId, runbook],
  )

  useEffect(() => {
    if (presenting) return
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      if (event.key === '?') {
        setPanel('shortcuts')
        return
      }
      if (panel) return

      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        startRunAll()
        return
      }
      switch (event.key) {
        case 'Enter':
          event.preventDefault()
          runFocused(event.shiftKey)
          break
        case 'j':
        case 'ArrowDown':
          move(1)
          break
        case 'k':
        case 'ArrowUp':
          move(-1)
          break
        case 'c':
          runner.cancel()
          break
        case 'o':
          setPanel('open')
          break
        case 'r':
          if (view === 'run') void reload()
          break
        case 'v':
          if (view === 'run' && runbook) openInputs('vars')
          break
        case 's':
          if (runner.hasRecord) setPanel('save')
          break
        case 'P':
        case 'p':
          if (view === 'run') setPresenting(true)
          break
        default:
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [move, openInputs, panel, presenting, reload, runbook, runFocused, runner, startRunAll, view])

  useEffect(() => {
    const onDrop = (event: DragEvent) => {
      event.preventDefault()
      const file = event.dataTransfer?.files?.[0]
      if (!file) return
      void file.text().then((text) => {
        if (file.name.endsWith('.runtpt')) openRecording(text, file.name)
        else openDoc({ source: { origin: 'upload', path: file.name, label: file.name, writable: false }, text })
      })
    }
    const onDragOver = (event: DragEvent) => event.preventDefault()
    window.addEventListener('drop', onDrop)
    window.addEventListener('dragover', onDragOver)
    return () => {
      window.removeEventListener('drop', onDrop)
      window.removeEventListener('dragover', onDragOver)
    }
  }, [openDoc, openRecording])

  // A finished "run all" is exactly when someone wants to do something with the record.
  const wasBusy = useRef(false)
  useEffect(() => {
    if (wasBusy.current && !runner.busy && runner.hasRecord) setPanel((open) => open ?? 'save')
    wasBusy.current = runner.busy
  }, [runner.busy, runner.hasRecord])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 4000)
    return () => window.clearTimeout(timer)
  }, [toast])

  if (presenting && runbook) {
    return (
      <AssetProvider value={assets}>
        <Present
          runbook={runbook}
          runner={runner}
          canRun={canRun}
          canReplay={(cellId) => recording?.byId.has(cellId) ?? false}
          operatorTheme={theme.active}
          onRun={runOne}
          onExit={() => setPresenting(false)}
        />
      </AssetProvider>
    )
  }

  const agentLabel =
    agent.status === 'paired' ? (agent.host?.name ?? 'agent') : agent.status === 'connecting' ? 'connecting…' : 'no agent'

  const shellChoice = session.shellOverride ?? runbook?.settings.shell ?? { kernel: 'bash' as const }
  const shellTitle =
    agent.status === 'paired'
      ? `shell cells run ${shellChoice.kernel}${session.shellOverride ? ' (session override)' : ' (from the runbook)'}`
      : 'No agent connected — only the agent knows which shells exist on this machine'

  return (
    <AssetProvider value={assets}>
      <div className="app">
        <header className="topbar">
          <span className="brand">runtpt</span>
          <span className="doc-label" title={doc.source.label}>
            {doc.source.label}
            {!doc.source.writable && <span className="chip">read-only</span>}
          </span>
          <span className="doc-actions">
            <button
              className={`chip-button reload ${changedOnDisk ? 'changed' : ''}`}
              onClick={() => void reload()}
              disabled={reloading || refusal !== null}
              title={refusal ?? 'Re-read this document from where it came from (r)'}
              aria-label="Reload this document"
            >
              {reloading ? '…' : '\u21bb'} reload
            </button>
            {changedOnDisk && (
              <span className="chip stale" title="The file moved on disk. Nothing was reloaded.">
                changed on disk
              </span>
            )}
          </span>

          <span className="spacer" />

          {runbook && view === 'run' && (
            <span className="seg" aria-label="Inputs to this run">
              {runbook.settings.params.length > 0 && (
                <button className="small" onClick={() => openInputs('params')}>
                  Params {paramsPending ? '•' : ''}
                </button>
              )}
              <button className="small" onClick={() => openInputs('vars')} title="Session environment variables (v)">
                Vars {session.count > 0 && <span className="chip">{session.count}</span>}
              </button>
            </span>
          )}
          {view === 'run' && (
            <>
              {runner.busy ? (
                <button className="danger small" onClick={runner.cancel}>
                  Stop
                </button>
              ) : (
                <button className="primary small" onClick={startRunAll} disabled={!canRun}>
                  Run all
                </button>
              )}
              <button className="ghost small" onClick={() => setPresenting(true)}>
                Present
              </button>
              <button className="ghost small" disabled={!runner.hasRecord} onClick={() => setPanel('save')}>
                Save
              </button>
            </>
          )}
          {recording && (
            <button className="ghost small" onClick={() => setView(view === 'replay' ? 'run' : 'replay')}>
              {view === 'replay' ? 'Back to the runbook' : 'Replay'}
            </button>
          )}
          <button className="ghost small" onClick={() => setPanel('open')}>
            Open
          </button>
          <span className={`seg round ${agent.status}`}>
            <button
              className={`chip-button shell-chip ${agent.status === 'paired' ? '' : 'muted'}`}
              title={shellTitle}
              onClick={() => setPanel('shell')}
            >
              <span className="meta">shell</span>
              {shellChoice.kernel}
            </button>
            <button className={`chip-button ${agent.status}`} onClick={() => setPanel('agent')}>
              {agentLabel}
            </button>
          </span>
          <button className="chip-button" onClick={() => setPanel('signin')}>
            {github.user ? github.user.login : 'sign in'}
          </button>
          <button className="ghost small" onClick={() => setPanel('shortcuts')} aria-label="Preferences and shortcuts">
            ?
          </button>
        </header>

        {agent.status !== 'paired' && view === 'run' && (
          <div className="banner">
            <span>
              No agent is connected, so nothing can run. Start one with <code>npx @runtpt/agent serve</code>.
            </span>
            <button className="primary small" onClick={() => setPanel('agent')}>
              Pair an agent
            </button>
          </div>
        )}

        {runner.reloadSummary && view === 'run' && <div className="banner">{runner.reloadSummary}</div>}
        {runner.error && <div className="banner error-banner">{runner.error}</div>}
        {toast && <div className="banner error-banner">{toast}</div>}

        {runner.confirmRequest && (
          <div className="banner confirm-banner">
            <span>
              <strong>{runner.confirmRequest.cell.attrs.name ?? runner.confirmRequest.cell.id}</strong> asks for a
              confirmation:
              <code className="inline-source">{runner.confirmRequest.resolved.split('\n')[0]}</code>
            </span>
            <button className="ghost small" onClick={() => runner.confirmRequest?.decide(false)}>
              Skip
            </button>
            <button className="primary small" onClick={() => runner.confirmRequest?.decide(true)}>
              Run it
            </button>
          </div>
        )}

        <main className="page">
          {view === 'replay' && recording ? (
            <ReplayView
              recording={recording}
              runbook={recordedRunbook}
              label={recordingLabel}
              onLoadRunbook={canLoadRecordedRunbook ? () => void loadRecordedRunbook() : undefined}
            />
          ) : runbook ? (
            <RunbookView
              runbook={runbook}
              runner={runner}
              recording={recording}
              canRun={canRun}
              shellOverride={session.shellOverride}
              focusedId={focusedId}
              onFocus={setFocusedId}
              onRunCell={runOne}
            />
          ) : null}
        </main>

        {(panel === 'open' || panel === 'signin') && (
          <OpenPanel
            github={github}
            agent={agent}
            onOpen={openDoc}
            onOpenRecording={openRecording}
            onClose={() => setPanel(null)}
            {...(panel === 'signin' ? { initialTab: 'github' as const } : {})}
          />
        )}
        {panel === 'agent' && <AgentPanel agent={agent} onClose={() => setPanel(null)} />}
        {panel === 'shell' && (
          <ShellPanel
            settings={runbook?.settings ?? null}
            agent={agent}
            session={session}
            onClose={() => setPanel(null)}
            onPair={() => setPanel('agent')}
          />
        )}
        {panel === 'inputs' && runbook && (
          <InputsPanel
            runbook={runbook}
            runner={runner}
            session={session}
            initialTab={inputsTab}
            onClose={() => {
              // Backing out of the modal abandons the run that opened it.
              resumeAfterParams.current = null
              setPanel(null)
            }}
            onConfirm={() => {
              setPanel(null)
              const resume = resumeAfterParams.current
              resumeAfterParams.current = null
              resume?.()
            }}
          />
        )}
        {panel === 'review' && runbook && (
          <ReviewPanel
            runbook={runbook}
            runner={runner}
            reason={reviewReason}
            origin={doc.source.label}
            shellOverride={session.shellOverride}
            onClose={() => setPanel(null)}
            onConfirm={() => {
              setPanel(null)
              void runner.runAll()
            }}
          />
        )}
        {panel === 'save' && (
          <SavePanel
            source={doc.source}
            runtpt={runner.runtptText}
            agent={agent}
            canCommit={Boolean(github.token && doc.source.repo)}
            onCommit={() => setPanel('commit')}
            onNote={(text) => runner.addNote(text, focusedId ?? undefined)}
            onClose={() => setPanel(null)}
          />
        )}
        {panel === 'commit' && github.token && (
          <CommitDialog
            source={doc.source}
            token={github.token}
            markdown={doc.text}
            runtpt={runner.runtptText}
            onClose={() => setPanel(null)}
          />
        )}
        {panel === 'shortcuts' && <Shortcuts theme={theme} onClose={() => setPanel(null)} />}
      </div>
    </AssetProvider>
  )
}
