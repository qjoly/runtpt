/** Record types of a `.runtpt` file. One JSON object per line, UTF-8. */

export const RUNTPT_VERSION = 1

export type CellStatus = 'ok' | 'failed' | 'cancelled' | 'timeout' | 'skipped'

export interface RunbookRef {
  path: string
  /** Git blob sha of the markdown at run time; the anchor for staleness. */
  sha?: string
  repo?: string
  ref?: string
}

export interface HostRef {
  name: string
  os: string
  arch: string
  agent: string
  cwd: string
}

export interface HeaderRecord {
  t: 'header'
  v: number
  runbook: RunbookRef
  run: { id: string; started: string; params?: Record<string, string> }
  host: HostRef
}

export interface CellRecord {
  t: 'cell'
  id: string
  hash: string
  kernel: string
  /** Resolved source: parameters substituted, secrets redacted. */
  source: string
  started: string
  seq: number
  name?: string
}

export interface OutRecord {
  t: 'out'
  id: string
  seq: number
  stream: 'stdout' | 'stderr' | 'display'
  at: string
  data: string
  mime?: string
  encoding?: 'base64'
  /** Set instead of `data` when the payload was spilled to the side directory. */
  ref?: string
}

export interface ResultRecord {
  t: 'result'
  id: string
  seq: number
  status: CellStatus
  exit: number | null
  duration_ms: number
  ended: string
}

export interface NoteRecord {
  t: 'note'
  at: string
  text: string
  after?: string
}

export interface FooterRecord {
  t: 'footer'
  ended: string
  status: 'ok' | 'failed' | 'cancelled'
  cells: { ok: number; failed: number; skipped: number }
}

export type RuntptRecord =
  | HeaderRecord
  | CellRecord
  | OutRecord
  | ResultRecord
  | NoteRecord
  | FooterRecord

/** Unknown record types must survive a round-trip rather than be dropped. */
export interface UnknownRecord {
  t: string
  [key: string]: unknown
}

export type AnyRecord = RuntptRecord | UnknownRecord

export function isKnownRecord(r: AnyRecord): r is RuntptRecord {
  return ['header', 'cell', 'out', 'result', 'note', 'footer'].includes(r.t)
}
