import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_AGENT_PORT,
  PROTOCOL_VERSION,
  parseServerMessage,
  type ClientMessage,
  type DirMsg,
  type DocumentMsg,
  type HostInfo,
  type KernelId,
  type KernelInfo,
  type SavedMsg,
  type ServerMessage,
} from '@runtpt/protocol'

export type AgentStatus = 'disconnected' | 'connecting' | 'paired' | 'denied' | 'error'

export interface RunRequest {
  runId: string
  cellId: string
  kernel: KernelId
  source: string
  env?: Record<string, string>
  cwd?: string
  timeoutMs?: number
  /** Resolved by the browser: the agent picks nothing. */
  interpreter?: string
}

export type AgentEvent = ServerMessage

export interface AgentApi {
  status: AgentStatus
  host: HostInfo | null
  kernels: KernelInfo[]
  message: string | null
  url: string
  pairing: string
  connect: (url: string, pairing: string) => void
  disconnect: () => void
  run: (req: RunRequest) => void
  cancel: (runId: string, cellId: string) => void
  listDir: (path: string) => Promise<DirMsg>
  open: (path: string) => Promise<DocumentMsg>
  save: (path: string, content: string, append?: boolean) => Promise<SavedMsg>
  restart: (kernel: KernelId) => void
  redact: (values: Record<string, string>) => void
  subscribe: (fn: (event: AgentEvent) => void) => () => void
}

const DEFAULT_URL = `ws://127.0.0.1:${DEFAULT_AGENT_PORT}`
const STORED_PAIRING = 'runtpt.agent'

interface Pending {
  resolve: (msg: ServerMessage) => void
  reject: (err: Error) => void
}

/** Reads `#agent=ws://…&pairing=…`, the link the agent CLI prints on startup. */
function readHashLink(): { url: string; pairing: string } | null {
  const hash = window.location.hash.replace(/^#/, '')
  if (!hash) return null
  const params = new URLSearchParams(hash)
  const pairing = params.get('pairing')
  if (!pairing) return null
  return { url: params.get('agent') ?? DEFAULT_URL, pairing }
}

/**
 * The link is a fact about this page load, not about a render, so it is consumed
 * once at import time. Reading it inside the effect loses it on the second pass
 * of a StrictMode remount, which left the app showing "no agent" in dev.
 */
const HASH_LINK = readHashLink()
if (HASH_LINK) history.replaceState(null, '', window.location.pathname + window.location.search)

let counter = 0
const nextId = (): string => `r${++counter}-${Date.now().toString(36)}`

export function useAgent(): AgentApi {
  const [status, setStatus] = useState<AgentStatus>('disconnected')
  const [host, setHost] = useState<HostInfo | null>(null)
  const [kernels, setKernels] = useState<KernelInfo[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [url, setUrl] = useState(DEFAULT_URL)
  const [pairing, setPairing] = useState('')

  const socket = useRef<WebSocket | null>(null)
  const pending = useRef(new Map<string, Pending>())
  const listeners = useRef(new Set<(event: AgentEvent) => void>())

  const send = useCallback((msg: ClientMessage) => {
    const ws = socket.current
    if (!ws || ws.readyState !== WebSocket.OPEN) throw new Error('Agent is not connected')
    ws.send(JSON.stringify(msg))
  }, [])

  const request = useCallback(
    <T extends ServerMessage>(build: (id: string) => ClientMessage): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        const id = nextId()
        pending.current.set(id, { resolve: resolve as (m: ServerMessage) => void, reject })
        try {
          send(build(id))
        } catch (err) {
          pending.current.delete(id)
          reject(err as Error)
        }
        window.setTimeout(() => {
          if (pending.current.delete(id)) reject(new Error('Agent did not answer in time'))
        }, 15_000)
      }),
    [send],
  )

  const connect = useCallback(
    (nextUrl: string, nextPairing: string) => {
      socket.current?.close()
      setUrl(nextUrl)
      setPairing(nextPairing)
      setStatus('connecting')
      setMessage(null)

      let ws: WebSocket
      try {
        ws = new WebSocket(nextUrl)
      } catch (err) {
        setStatus('error')
        setMessage((err as Error).message)
        return
      }
      socket.current = ws

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            t: 'hello',
            v: PROTOCOL_VERSION,
            pairing: nextPairing,
            client: 'runtpt-web/0.1.0',
          }),
        )
      }

      ws.onmessage = (event) => {
        const msg = parseServerMessage(String(event.data))
        if (!msg) return

        switch (msg.t) {
          case 'welcome':
            setStatus('paired')
            setHost(msg.host)
            setKernels(msg.kernels)
            setMessage(null)
            localStorage.setItem(STORED_PAIRING, JSON.stringify({ url: nextUrl, pairing: nextPairing }))
            break
          case 'denied':
            setStatus('denied')
            setMessage(msg.message)
            localStorage.removeItem(STORED_PAIRING)
            break
          case 'dir':
          case 'document':
          case 'saved': {
            const waiting = pending.current.get(msg.id)
            if (waiting) {
              pending.current.delete(msg.id)
              waiting.resolve(msg)
            }
            break
          }
          case 'error': {
            if (msg.id) {
              const waiting = pending.current.get(msg.id)
              if (waiting) {
                pending.current.delete(msg.id)
                waiting.reject(new Error(msg.message))
              }
            }
            break
          }
          default:
            break
        }
        for (const fn of listeners.current) fn(msg)
      }

      ws.onerror = () => {
        setMessage('Could not reach the agent on ' + nextUrl)
      }

      ws.onclose = () => {
        if (socket.current === ws) socket.current = null
        setStatus((prev) => (prev === 'denied' ? prev : 'disconnected'))
        setHost(null)
        setKernels([])
      }
    },
    [],
  )

  // Hash link wins; otherwise reuse the pairing from a previous session.
  useEffect(() => {
    if (HASH_LINK) {
      connect(HASH_LINK.url, HASH_LINK.pairing)
      return
    }
    const stored = localStorage.getItem(STORED_PAIRING)
    if (!stored) return
    try {
      const parsed = JSON.parse(stored) as { url?: string; pairing?: string }
      if (parsed.pairing) connect(parsed.url ?? DEFAULT_URL, parsed.pairing)
    } catch {
      localStorage.removeItem(STORED_PAIRING)
    }
  }, [connect])

  useEffect(() => () => socket.current?.close(), [])

  return useMemo<AgentApi>(
    () => ({
      status,
      host,
      kernels,
      message,
      url,
      pairing,
      connect,
      disconnect: () => {
        localStorage.removeItem(STORED_PAIRING)
        socket.current?.close()
        socket.current = null
        setStatus('disconnected')
      },
      run: (req) => send({ t: 'run', ...req }),
      cancel: (runId, cellId) => send({ t: 'cancel', runId, cellId }),
      listDir: (path) => request<DirMsg>((id) => ({ t: 'listDir', id, path })),
      open: (path) => request<DocumentMsg>((id) => ({ t: 'open', id, path })),
      save: (path, content, append) =>
        request<SavedMsg>((id) => ({ t: 'save', id, path, content, ...(append ? { append: true } : {}) })),
      restart: (kernel) => send({ t: 'restart', kernel }),
      redact: (values) => {
        const names = Object.keys(values)
        if (names.length === 0) return
        send({ t: 'redact', names, values: names.map((n) => values[n] ?? '') })
      },
      subscribe: (fn) => {
        listeners.current.add(fn)
        return () => listeners.current.delete(fn)
      },
    }),
    [status, host, kernels, message, url, pairing, connect, send, request],
  )
}
