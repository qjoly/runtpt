import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_SETTINGS,
  buildPlan,
  resolveKernel,
  resolveParams,
  shouldSkip,
  substitute,
  type Cell,
  type CellOutcome,
  type ResolvedKernel,
  type Runbook,
} from '@runtpt/core'
import { Redactor, RuntptWriter, type RunRecording } from '@runtpt/format'
import type { CellStatus, HostInfo } from '@runtpt/protocol'
import type { AgentApi } from '../agent/useAgent.js'
import type { SessionApi } from '../session/useSession.js'
import { mergeRunEnv } from '../session/vars.js'
import { runbookRefOf, type DocSource } from '../types.js'

export type CellPhase = 'idle' | 'running' | CellStatus

export interface OutChunk {
  stream: 'stdout' | 'stderr' | 'display'
  data: string
  mime?: string
  encoding?: 'base64'
}

export interface CellState {
  phase: CellPhase
  chunks: OutChunk[]
  exit: number | null
  durationMs: number | null
  startedAt: string | null
  /** Skip reason, agent error, or "replayed from a recording". */
  note: string | null
  /** What this output was actually produced by, so a later shell change cannot rewrite history. */
  ran: ResolvedKernel | null
}

export interface ConfirmRequest {
  cell: Cell
  resolved: string
  decide: (go: boolean) => void
}

const EMPTY: CellState = {
  phase: 'idle',
  chunks: [],
  exit: null,
  durationMs: null,
  startedAt: null,
  note: null,
  ran: null,
}

export interface Runner {
  states: Record<string, CellState>
  stateOf: (cellId: string) => CellState
  params: Record<string, string>
  setParam: (name: string, value: string) => void
  setParams: (values: Record<string, string>) => void
  missingParams: string[]
  paramsAnswered: boolean
  markParamsAnswered: () => void
  values: Record<string, string>
  resolve: (cell: Cell) => string
  resolveText: (source: string) => string
  runCell: (cell: Cell) => Promise<CellPhase>
  runAll: () => Promise<void>
  cancel: () => void
  busy: boolean
  runningCellId: string | null
  confirmRequest: ConfirmRequest | null
  replayCell: (cell: Cell) => boolean
  addNote: (text: string, after?: string) => void
  runtptText: string
  hasRecord: boolean
  reset: () => void
  error: string | null
}

const BROWSER_HOST: HostInfo = {
  name: 'browser',
  os: typeof navigator === 'undefined' ? 'unknown' : navigator.platform || 'unknown',
  arch: 'unknown',
  agent: 'runtpt-web/0.1.0',
  cwd: '',
}

const newRunId = (): string => `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

export function useRunner(
  runbook: Runbook | null,
  source: DocSource | null,
  agent: AgentApi,
  recording: RunRecording | null,
  session: SessionApi,
): Runner {
  const [states, setStates] = useState<Record<string, CellState>>({})
  const [params, setParamsState] = useState<Record<string, string>>({})
  const [paramsAnswered, setParamsAnswered] = useState(false)
  const [busy, setBusy] = useState(false)
  const [runningCellId, setRunningCellId] = useState<string | null>(null)
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [runtptText, setRuntptText] = useState('')

  const lines = useRef<string[]>([])
  const writer = useRef<RuntptWriter | null>(null)
  const redactor = useRef(new Redactor())
  const active = useRef<{ runId: string; cellId: string } | null>(null)
  const abort = useRef(false)
  const buffer = useRef(new Map<string, OutChunk[]>())
  const flushTimer = useRef<number | null>(null)

  // Defaults come from the declared params; the user only overrides.
  useEffect(() => {
    if (!runbook) return
    const defaults: Record<string, string> = {}
    for (const spec of runbook.settings.params) if (spec.default !== undefined) defaults[spec.name] = spec.default
    setParamsState(defaults)
    setParamsAnswered(runbook.settings.params.length === 0)
    setStates({})
    lines.current = []
    writer.current = null
    redactor.current = new Redactor()
    setRuntptText('')
  }, [runbook])

  const resolved = useMemo(
    () => resolveParams(runbook?.settings.params ?? [], params),
    [runbook, params],
  )

  // Secrets must be known to the agent and to the local redactor before any write.
  useEffect(() => {
    redactor.current.clear()
    const secretValues: Record<string, string> = {}
    for (const name of resolved.secrets) {
      const value = resolved.values[name]
      if (value) secretValues[name] = value
    }
    Object.assign(secretValues, session.secrets)
    redactor.current.addAll(secretValues)
    if (agent.status === 'paired' && Object.keys(secretValues).length > 0) {
      try {
        agent.redact(secretValues)
      } catch {
        // Not fatal: local redaction still applies to everything we write.
      }
    }
  }, [resolved, agent, session.secrets])

  const patch = useCallback((cellId: string, next: Partial<CellState>) => {
    setStates((prev) => ({ ...prev, [cellId]: { ...(prev[cellId] ?? EMPTY), ...next } }))
  }, [])

  const flush = useCallback(() => {
    flushTimer.current = null
    const pending = buffer.current
    if (pending.size === 0) return
    buffer.current = new Map()
    setStates((prev) => {
      const next = { ...prev }
      for (const [cellId, chunks] of pending) {
        const current = next[cellId] ?? EMPTY
        next[cellId] = { ...current, chunks: current.chunks.concat(chunks) }
      }
      return next
    })
    setRuntptText(lines.current.join('\n') + (lines.current.length ? '\n' : ''))
  }, [])

  const push = useCallback(
    (cellId: string, chunk: OutChunk) => {
      const list = buffer.current.get(cellId)
      if (list) list.push(chunk)
      else buffer.current.set(cellId, [chunk])
      if (flushTimer.current === null) flushTimer.current = window.setTimeout(flush, 40)
    },
    [flush],
  )

  const ensureWriter = useCallback((): RuntptWriter | null => {
    if (writer.current) return writer.current
    if (!source) return null
    const w = new RuntptWriter({
      runbook: runbookRefOf(source),
      host: agent.host ?? BROWSER_HOST,
      runId: newRunId(),
      params: resolved.values,
      redactor: redactor.current,
      sink: (line) => lines.current.push(line),
    })
    w.header()
    writer.current = w
    setRuntptText(lines.current.join('\n') + '\n')
    return w
  }, [source, agent.host, resolved.values])

  const runCell = useCallback(
    (cell: Cell): Promise<CellPhase> => {
      if (agent.status !== 'paired') {
        setError('No agent connected. Pair one to run cells.')
        return Promise.resolve('idle')
      }
      const w = ensureWriter()
      const runId = newRunId()
      const text = substitute(cell.source, resolved.values)
      const startedAt = new Date().toISOString()
      const kernel = resolveKernel(cell, runbook?.settings ?? DEFAULT_SETTINGS, session.shellOverride)

      w?.cell({
        id: cell.id,
        hash: cell.hash,
        kernel: kernel.kernel,
        source: text,
        started: startedAt,
        ...(cell.attrs.name ? { name: cell.attrs.name } : {}),
      })

      setError(null)
      setRunningCellId(cell.id)
      active.current = { runId, cellId: cell.id }
      patch(cell.id, {
        phase: 'running',
        chunks: [],
        exit: null,
        durationMs: null,
        startedAt,
        note: null,
        ran: kernel,
      })

      return new Promise<CellPhase>((done) => {
        const unsubscribe = agent.subscribe((event) => {
          if ('runId' in event && event.runId !== runId) return
          switch (event.t) {
            case 'chunk': {
              const data = redactor.current.apply(event.data)
              push(cell.id, { stream: event.stream, data })
              w?.out({ id: cell.id, stream: event.stream, data, at: event.at })
              break
            }
            case 'display': {
              push(cell.id, {
                stream: 'display',
                data: event.data,
                mime: event.mime,
                ...(event.encoding ? { encoding: event.encoding } : {}),
              })
              w?.out({
                id: cell.id,
                stream: 'display',
                data: event.data,
                at: event.at,
                mime: event.mime,
                ...(event.encoding ? { encoding: event.encoding } : {}),
              })
              break
            }
            case 'result': {
              unsubscribe()
              flush()
              active.current = null
              setRunningCellId(null)
              patch(cell.id, {
                phase: event.status,
                exit: event.exit,
                durationMs: event.durationMs,
              })
              w?.result({
                id: cell.id,
                status: event.status,
                exit: event.exit,
                durationMs: event.durationMs,
                ended: event.endedAt,
              })
              setRuntptText(lines.current.join('\n') + '\n')
              done(event.status)
              break
            }
            case 'error': {
              if (event.cellId && event.cellId !== cell.id) break
              unsubscribe()
              flush()
              active.current = null
              setRunningCellId(null)
              setError(event.message)
              patch(cell.id, { phase: 'failed', note: event.message })
              w?.result({ id: cell.id, status: 'failed', exit: null, durationMs: 0 })
              done('failed')
              break
            }
            default:
              break
          }
        })

        const cwd = cell.attrs.cwd ?? runbook?.settings.cwd
        try {
          agent.run({
            runId,
            cellId: cell.id,
            kernel: kernel.kernel,
            source: text,
            env: mergeRunEnv(runbook?.settings.env ?? {}, session.env, resolved.values),
            ...(kernel.interpreter ? { interpreter: kernel.interpreter } : {}),
            ...(cwd ? { cwd } : {}),
            ...(cell.attrs.timeoutMs ? { timeoutMs: cell.attrs.timeoutMs } : {}),
          })
        } catch (err) {
          unsubscribe()
          active.current = null
          setRunningCellId(null)
          setError((err as Error).message)
          patch(cell.id, { phase: 'failed', note: (err as Error).message })
          done('failed')
        }
      })
    },
    [agent, ensureWriter, flush, patch, push, resolved.values, runbook, session.env, session.shellOverride],
  )

  const askConfirm = useCallback(
    (cell: Cell): Promise<boolean> =>
      new Promise<boolean>((decideDone) => {
        setConfirmRequest({
          cell,
          resolved: substitute(cell.source, resolved.values),
          decide: (go) => {
            setConfirmRequest(null)
            decideDone(go)
          },
        })
      }),
    [resolved.values],
  )

  const runAll = useCallback(async () => {
    if (!runbook || busy) return
    if (agent.status !== 'paired') {
      setError('No agent connected. Pair one to run cells.')
      return
    }
    const plan = buildPlan(runbook)
    const outcomes = new Map<string, CellOutcome>()
    abort.current = false
    setBusy(true)
    const w = ensureWriter()

    try {
      for (const step of plan.steps) {
        if (abort.current) break
        const { cell } = step

        const skip = shouldSkip(step, outcomes)
        if (skip) {
          outcomes.set(cell.id, 'skipped')
          patch(cell.id, { phase: 'skipped', note: `Skipped: ${skip}`, chunks: [] })
          w?.cell({
            id: cell.id,
            hash: cell.hash,
            kernel: resolveKernel(cell, runbook.settings, session.shellOverride).kernel,
            source: substitute(cell.source, resolved.values),
          })
          w?.result({ id: cell.id, status: 'skipped', exit: null, durationMs: 0 })
          continue
        }

        if (cell.attrs.confirm) {
          const go = await askConfirm(cell)
          if (!go) {
            outcomes.set(cell.id, 'skipped')
            patch(cell.id, { phase: 'skipped', note: 'Skipped: not confirmed', chunks: [] })
            w?.cell({
            id: cell.id,
            hash: cell.hash,
            kernel: resolveKernel(cell, runbook.settings, session.shellOverride).kernel,
            source: substitute(cell.source, resolved.values),
          })
            w?.result({ id: cell.id, status: 'skipped', exit: null, durationMs: 0 })
            continue
          }
        }

        const status = await runCell(cell)
        outcomes.set(cell.id, status === 'idle' || status === 'running' ? 'failed' : status)
        if (status !== 'ok' && !cell.attrs.continueOnError) break
      }
    } finally {
      w?.footer()
      setRuntptText(lines.current.join('\n') + '\n')
      setBusy(false)
    }
  }, [agent.status, askConfirm, busy, ensureWriter, patch, resolved.values, runbook, runCell, session.shellOverride])

  const cancel = useCallback(() => {
    abort.current = true
    confirmRequest?.decide(false)
    const current = active.current
    if (!current) return
    try {
      agent.cancel(current.runId, current.cellId)
    } catch {
      // The socket is already gone; the cell will never report anyway.
    }
  }, [agent, confirmRequest])

  /** Demo fallback: pull a cell's output from a loaded recording instead of running it. */
  const replayCell = useCallback(
    (cell: Cell): boolean => {
      const recorded = recording?.byId.get(cell.id)
      if (!recorded) return false
      patch(cell.id, {
        phase: recorded.status === 'running' ? 'failed' : recorded.status,
        chunks: recorded.outputs.map((o) => ({
          stream: o.stream,
          data: o.data,
          ...(o.mime ? { mime: o.mime } : {}),
          ...(o.encoding ? { encoding: o.encoding } : {}),
        })),
        exit: recorded.exit,
        durationMs: recorded.durationMs,
        startedAt: recorded.started,
        note: 'Replayed from a recording, not executed',
        ran: null,
      })
      return true
    },
    [patch, recording],
  )

  const addNote = useCallback(
    (text: string, after?: string) => {
      const w = ensureWriter()
      w?.note(text, after)
      setRuntptText(lines.current.join('\n') + '\n')
    },
    [ensureWriter],
  )

  const reset = useCallback(() => {
    setStates({})
    lines.current = []
    writer.current = null
    setRuntptText('')
    setError(null)
  }, [])

  return {
    states,
    stateOf: (cellId) => states[cellId] ?? EMPTY,
    params,
    setParam: (name, value) => setParamsState((prev) => ({ ...prev, [name]: value })),
    setParams: (values) => setParamsState(values),
    missingParams: resolved.missing,
    paramsAnswered,
    markParamsAnswered: () => setParamsAnswered(true),
    values: resolved.values,
    resolve: (cell) => substitute(cell.source, resolved.values),
    resolveText: (text) => substitute(text, resolved.values),
    runCell,
    runAll,
    cancel,
    busy,
    runningCellId,
    confirmRequest,
    replayCell,
    addNote,
    runtptText,
    hasRecord: runtptText.length > 0,
    reset,
    error,
  }
}
