/**
 * Wire protocol between the browser and the local agent.
 *
 * Transport is a loopback WebSocket. Every frame is a JSON object with a `t`
 * discriminator. The browser orchestrates; the agent knows nothing about
 * document semantics beyond "run this source with this kernel".
 */

export const PROTOCOL_VERSION = 1
export const DEFAULT_AGENT_PORT = 7777

export type KernelId = 'bash' | 'sh' | 'zsh' | 'python' | 'http'

export interface KernelInfo {
  id: KernelId
  available: boolean
  /** Interpreter path or version string, when it could be detected. */
  detail?: string
  /** Resolved absolute path, when the agent found one on PATH. */
  path?: string
}

export interface HostInfo {
  name: string
  os: string
  arch: string
  agent: string
  cwd: string
}

/* ------------------------------------------------------------------ */
/* Browser → agent                                                     */
/* ------------------------------------------------------------------ */

export interface HelloMsg {
  t: 'hello'
  v: number
  /** Pairing secret printed by the agent on startup. */
  pairing: string
  client: string
}

export interface ListDirMsg {
  t: 'listDir'
  id: string
  path: string
}

export interface OpenMsg {
  t: 'open'
  id: string
  path: string
}

export interface SaveMsg {
  t: 'save'
  id: string
  path: string
  content: string
  /** Append instead of truncating — used for incremental .runtpt writes. */
  append?: boolean
}

export interface RunMsg {
  t: 'run'
  runId: string
  cellId: string
  kernel: KernelId
  /** Source after parameter substitution. */
  source: string
  env?: Record<string, string>
  cwd?: string
  timeoutMs?: number
  /**
   * Explicit interpreter path. Sessions are keyed by kernel *and* interpreter,
   * so two bash paths are two independent shells.
   */
  interpreter?: string
}

export interface CancelMsg {
  t: 'cancel'
  runId: string
  cellId: string
}

export interface StdinMsg {
  t: 'stdin'
  runId: string
  cellId: string
  data: string
}

export interface RestartMsg {
  t: 'restart'
  kernel: KernelId
  interpreter?: string
}

/** Tell the agent which values must never reach disk or the wire. */
export interface RedactMsg {
  t: 'redact'
  values: string[]
  /** Parallel array of placeholder names, same length as `values`. */
  names: string[]
}

export type ClientMessage =
  | HelloMsg
  | ListDirMsg
  | OpenMsg
  | SaveMsg
  | RunMsg
  | CancelMsg
  | StdinMsg
  | RestartMsg
  | RedactMsg

/* ------------------------------------------------------------------ */
/* Agent → browser                                                     */
/* ------------------------------------------------------------------ */

export interface WelcomeMsg {
  t: 'welcome'
  v: number
  host: HostInfo
  kernels: KernelInfo[]
}

export interface DeniedMsg {
  t: 'denied'
  reason: 'pairing' | 'origin' | 'version' | 'busy'
  message: string
}

export interface DirEntry {
  name: string
  path: string
  dir: boolean
  size?: number
}

export interface DirMsg {
  t: 'dir'
  id: string
  path: string
  parent: string | null
  entries: DirEntry[]
}

export interface DocumentMsg {
  t: 'document'
  id: string
  path: string
  content: string
}

export interface SavedMsg {
  t: 'saved'
  id: string
  path: string
}

export interface ChunkMsg {
  t: 'chunk'
  runId: string
  cellId: string
  seq: number
  stream: 'stdout' | 'stderr'
  at: string
  data: string
}

export interface DisplayMsg {
  t: 'display'
  runId: string
  cellId: string
  seq: number
  at: string
  mime: string
  encoding?: 'base64'
  data: string
}

export type CellStatus = 'ok' | 'failed' | 'cancelled' | 'timeout' | 'skipped'

export interface ResultMsg {
  t: 'result'
  runId: string
  cellId: string
  seq: number
  status: CellStatus
  exit: number | null
  durationMs: number
  endedAt: string
}

export interface ErrorMsg {
  t: 'error'
  id?: string
  runId?: string
  cellId?: string
  message: string
}

export interface KernelStateMsg {
  t: 'kernelState'
  kernel: KernelId
  state: 'starting' | 'ready' | 'restarting' | 'dead'
  detail?: string
  interpreter?: string
}

export type ServerMessage =
  | WelcomeMsg
  | DeniedMsg
  | DirMsg
  | DocumentMsg
  | SavedMsg
  | ChunkMsg
  | DisplayMsg
  | ResultMsg
  | ErrorMsg
  | KernelStateMsg

/* ------------------------------------------------------------------ */
/* Guards                                                              */
/* ------------------------------------------------------------------ */

const CLIENT_TYPES = new Set([
  'hello', 'listDir', 'open', 'save', 'run', 'cancel', 'stdin', 'restart', 'redact',
])

export function parseClientMessage(raw: string): ClientMessage | null {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) return null
  const t = (value as { t?: unknown }).t
  if (typeof t !== 'string' || !CLIENT_TYPES.has(t)) return null
  return value as ClientMessage
}

export function parseServerMessage(raw: string): ServerMessage | null {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) return null
  if (typeof (value as { t?: unknown }).t !== 'string') return null
  return value as ServerMessage
}
