import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { parseRunbook, type Cell } from '@runtpt/core'
import { readRuntpt, type RunRecording } from '@runtpt/format'
import { useAgent } from './agent/useAgent.js'
import { AgentPanel } from './agent/AgentPanel.js'
import { useGithub } from './github/useGithub.js'
import { CommitDialog } from './github/CommitDialog.js'
import { getFile } from './github/api.js'
import { OpenPanel } from './open/OpenPanel.js'
import { RunbookView } from './runbook/RunbookView.js'
import { ParamsPanel } from './runbook/ParamsPanel.js'
import { ReviewPanel } from './runbook/ReviewPanel.js'
import { SavePanel } from './runbook/SavePanel.js'
import { useRunner } from './runbook/useRunner.js'
import { ReplayView } from './replay/ReplayView.js'
import { Present } from './present/Present.js'
import { Shortcuts } from './ui/Shortcuts.js'
import { DEMO_RUNBOOK } from './demo/bundled.js'
import type { LoadedDoc } from './types.js'

type Panel = 'open' | 'signin' | 'agent' | 'params' | 'save' | 'commit' | 'review' | 'shortcuts' | null

export function App() {
  const agent = useAgent()
  const github = useGithub()

  const [doc, setDoc] = useState<LoadedDoc>(DEMO_RUNBOOK)
  const [recording, setRecording] = useState<RunRecording | null>(null)
  const [recordingLabel, setRecordingLabel] = useState('')
  const [view, setView] = useState<'run' | 'replay'>('run')
  const [panel, setPanel] = useState<Panel>(null)
  const [presenting, setPresenting] = useState(false)
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const runbook = useMemo(() => (doc ? parseRunbook(doc.text) : null), [doc])
  const runner = useRunner(runbook, doc?.source ?? null, agent, recording)

  const canRun = agent.status === 'paired'
  const paramsPending = runbook !== null && runbook.settings.params.length > 0 && !runner.paramsAnswered

  const openDoc = useCallback((next: LoadedDoc) => {
    setDoc(next)
    setView('run')
    setPanel(null)
    setFocusedId(null)
  }, [])

  const openRecording = useCallback((text: string, label: string) => {
    setRecording(readRuntpt(text))
    setRecordingLabel(label)
    setView('replay')
    setPanel(null)
  }, [])

  // The replay's own runbook, pulled from the repository the header points at.
  const loadRecordedRunbook = useCallback(async () => {
    const ref = recording?.header?.runbook
    if (!ref?.repo) return
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
  }, [github.token, recording])

  // What the operator asked for before the parameters interrupted them. Without
  // this, filling the modal silently dropped the click that opened it.
  const resumeAfterParams = useRef<(() => void) | null>(null)
  const askParams = useCallback((resume: () => void) => {
    resumeAfterParams.current = resume
    setPanel('params')
  }, [])

  const runAllNow = useCallback(() => {
    const owner = doc.source.repo?.owner
    const foreign = doc.source.origin === 'github' && owner !== undefined && owner !== github.user?.login
    if (foreign) {
      setPanel('review')
      return
    }
    void runner.runAll()
  }, [doc.source, github.user, runner])

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
  }, [move, panel, presenting, runFocused, runner, startRunAll, view])

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
      <Present
        runbook={runbook}
        runner={runner}
        canRun={canRun}
        canReplay={(cellId) => recording?.byId.has(cellId) ?? false}
        onRun={runOne}
        onExit={() => setPresenting(false)}
      />
    )
  }

  const agentLabel =
    agent.status === 'paired' ? (agent.host?.name ?? 'agent') : agent.status === 'connecting' ? 'connecting…' : 'no agent'

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">runtpt</span>
        <span className="doc-label" title={doc.source.label}>
          {doc.source.label}
          {!doc.source.writable && <span className="chip">read-only</span>}
        </span>

        <span className="spacer" />

        {runbook && runbook.settings.params.length > 0 && view === 'run' && (
          <button className="ghost small" onClick={() => setPanel('params')}>
            Params {paramsPending ? '•' : ''}
          </button>
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
        <button className={`chip-button ${agent.status}`} onClick={() => setPanel('agent')}>
          {agentLabel}
        </button>
        <button className="chip-button" onClick={() => setPanel('signin')}>
          {github.user ? github.user.login : 'sign in'}
        </button>
        <button className="ghost small" onClick={() => setPanel('shortcuts')} aria-label="Keyboard shortcuts">
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
            runbook={runbook}
            label={recordingLabel}
            onLoadRunbook={recording.header?.runbook.repo ? () => void loadRecordedRunbook() : undefined}
          />
        ) : runbook ? (
          <RunbookView
            runbook={runbook}
            runner={runner}
            recording={recording}
            canRun={canRun}
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
      {panel === 'params' && runbook && (
        <ParamsPanel
          specs={runbook.settings.params}
          runner={runner}
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
          origin={doc.source.label}
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
      {panel === 'shortcuts' && <Shortcuts onClose={() => setPanel(null)} />}
    </div>
  )
}
