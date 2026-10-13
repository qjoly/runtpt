import type {
  AnyRecord,
  CellRecord,
  CellStatus,
  FooterRecord,
  HeaderRecord,
  NoteRecord,
  OutRecord,
  ResultRecord,
} from './records.js'

/** One cell's worth of recorded execution, assembled from the raw records. */
export interface CellRun {
  id: string
  hash: string
  kernel: string
  source: string
  name?: string
  started: string
  outputs: OutRecord[]
  status: CellStatus | 'running'
  exit: number | null
  durationMs: number | null
  ended: string | null
}

export interface RunRecording {
  header: HeaderRecord | null
  cells: CellRun[]
  byId: Map<string, CellRun>
  notes: NoteRecord[]
  footer: FooterRecord | null
  /** Records whose type we do not know; kept so a round-trip loses nothing. */
  unknown: AnyRecord[]
  /** True when the file ends without a footer: the run never completed. */
  interrupted: boolean
  /** A trailing partial line, which a reader must tolerate. */
  truncated: boolean
}

/**
 * Parses JSON Lines. Unknown record types and unknown fields are ignored rather
 * than fatal, and a half-written last line is dropped, not thrown.
 */
export function parseRecords(text: string): { records: AnyRecord[]; truncated: boolean } {
  const records: AnyRecord[] = []
  const lines = text.split('\n')
  let truncated = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim()
    if (line === '') continue
    try {
      const value = JSON.parse(line) as unknown
      if (typeof value === 'object' && value !== null && typeof (value as AnyRecord).t === 'string') {
        records.push(value as AnyRecord)
      }
    } catch {
      // Only the final line may legitimately be incomplete.
      if (i === lines.length - 1) truncated = true
    }
  }
  return { records, truncated }
}

export function buildRecording(records: AnyRecord[], truncated = false): RunRecording {
  const rec: RunRecording = {
    header: null,
    cells: [],
    byId: new Map(),
    notes: [],
    footer: null,
    unknown: [],
    interrupted: true,
    truncated,
  }

  for (const r of records) {
    switch (r.t) {
      case 'header':
        rec.header = r as HeaderRecord
        break
      case 'cell': {
        const c = r as CellRecord
        const cell: CellRun = {
          id: c.id,
          hash: c.hash,
          kernel: c.kernel,
          source: c.source,
          started: c.started,
          outputs: [],
          status: 'running',
          exit: null,
          durationMs: null,
          ended: null,
          ...(c.name ? { name: c.name } : {}),
        }
        // A re-run of the same cell replaces the previous attempt in the index
        // but stays in the list, so the full chronology survives.
        rec.cells.push(cell)
        rec.byId.set(c.id, cell)
        break
      }
      case 'out': {
        const o = r as OutRecord
        const target = rec.byId.get(o.id)
        if (target) target.outputs.push(o)
        else rec.unknown.push(r)
        break
      }
      case 'result': {
        const res = r as ResultRecord
        const target = rec.byId.get(res.id)
        if (target) {
          target.status = res.status
          target.exit = res.exit
          target.durationMs = res.duration_ms
          target.ended = res.ended
        } else {
          rec.unknown.push(r)
        }
        break
      }
      case 'note':
        rec.notes.push(r as NoteRecord)
        break
      case 'footer':
        rec.footer = r as FooterRecord
        rec.interrupted = false
        break
      default:
        rec.unknown.push(r)
    }
  }
  return rec
}

export function readRuntpt(text: string): RunRecording {
  const { records, truncated } = parseRecords(text)
  return buildRecording(records, truncated)
}

/** `incident.md` → `incident.runtpt`. */
export function runtptPathFor(runbookPath: string): string {
  return runbookPath.replace(/\.(md|markdown)$/i, '') + '.runtpt'
}
