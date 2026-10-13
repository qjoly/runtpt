import type { AnyRecord, CellStatus, FooterRecord, HeaderRecord, HostRef, RunbookRef } from './records.js'
import { RUNTPT_VERSION } from './records.js'
import type { Redactor } from './redact.js'

export interface WriterOptions {
  runbook: RunbookRef
  host: HostRef
  runId: string
  params?: Record<string, string>
  redactor?: Redactor
  /** Payloads longer than this are replaced by a blob reference. */
  maxInlineBytes?: number
  /** Called for every emitted line, without the trailing newline. */
  sink: (line: string) => void
  /** Called when a payload is spilled; returns the ref stored in the record. */
  spill?: (data: string, mime: string | undefined) => string
}

const DEFAULT_MAX_INLINE = 256 * 1024

const encoder = new TextEncoder()

/** Isomorphic: this package runs in the agent and in the browser alike. */
function byteLength(text: string): number {
  return encoder.encode(text).length
}

/**
 * Streaming encoder. Records are appended as they happen, which is why a run
 * killed halfway still leaves a readable file.
 */
export class RuntptWriter {
  private seq = 0
  private counts = { ok: 0, failed: 0, skipped: 0, tolerated: 0 }
  private closed = false

  constructor(private readonly opts: WriterOptions) {}

  private emit(record: AnyRecord): void {
    this.opts.sink(JSON.stringify(record))
  }

  private redact(text: string): string {
    return this.opts.redactor ? this.opts.redactor.apply(text) : text
  }

  nextSeq(): number {
    return ++this.seq
  }

  header(startedAt = new Date().toISOString()): void {
    // The params land in the header verbatim, so they go through the redactor
    // like any other payload: a secret passed as a parameter must not be the one
    // place it reaches disk in clear.
    const params = this.opts.params
      ? Object.fromEntries(Object.entries(this.opts.params).map(([k, v]) => [k, this.redact(v)]))
      : undefined

    const header: HeaderRecord = {
      t: 'header',
      v: RUNTPT_VERSION,
      runbook: this.opts.runbook,
      run: { id: this.opts.runId, started: startedAt, ...(params ? { params } : {}) },
      host: this.opts.host,
    }
    this.emit(header)
  }

  cell(args: { id: string; hash: string; kernel: string; source: string; name?: string; started?: string }): void {
    this.emit({
      t: 'cell',
      id: args.id,
      hash: args.hash,
      kernel: args.kernel,
      source: this.redact(args.source),
      started: args.started ?? new Date().toISOString(),
      seq: this.nextSeq(),
      ...(args.name ? { name: args.name } : {}),
    })
  }

  out(args: {
    id: string
    stream: 'stdout' | 'stderr' | 'display'
    data: string
    at?: string
    mime?: string
    encoding?: 'base64'
  }): void {
    const data = args.encoding === 'base64' ? args.data : this.redact(args.data)
    const limit = this.opts.maxInlineBytes ?? DEFAULT_MAX_INLINE
    const oversized = byteLength(data) > limit

    if (oversized && this.opts.spill) {
      this.emit({
        t: 'out',
        id: args.id,
        seq: this.nextSeq(),
        stream: args.stream,
        at: args.at ?? new Date().toISOString(),
        data: '',
        ref: this.opts.spill(data, args.mime),
        ...(args.mime ? { mime: args.mime } : {}),
        ...(args.encoding ? { encoding: args.encoding } : {}),
      })
      return
    }

    this.emit({
      t: 'out',
      id: args.id,
      seq: this.nextSeq(),
      stream: args.stream,
      at: args.at ?? new Date().toISOString(),
      data: oversized ? data.slice(0, limit) + '\n…[truncated by runtpt]' : data,
      ...(args.mime ? { mime: args.mime } : {}),
      ...(args.encoding ? { encoding: args.encoding } : {}),
    })
  }

  result(args: {
    id: string
    status: CellStatus
    exit: number | null
    durationMs: number
    ended?: string
    /** Set for a `continue-on-error` cell: it failed, but the run is still fine. */
    tolerated?: boolean
  }): void {
    if (args.status === 'ok') {
      this.counts.ok++
    } else if (args.status === 'skipped') {
      this.counts.skipped++
    } else {
      this.counts.failed++
      if (args.tolerated) this.counts.tolerated++
    }

    this.emit({
      t: 'result',
      id: args.id,
      seq: this.nextSeq(),
      status: args.status,
      exit: args.exit,
      duration_ms: args.durationMs,
      ended: args.ended ?? new Date().toISOString(),
    })
  }

  note(text: string, after?: string): void {
    this.emit({
      t: 'note',
      at: new Date().toISOString(),
      text: this.redact(text),
      ...(after ? { after } : {}),
    })
  }

  check(args: { id: string; text: string; checked: boolean; at?: string }): void {
    this.emit({
      t: 'check',
      id: args.id,
      text: this.redact(args.text),
      checked: args.checked,
      at: args.at ?? new Date().toISOString(),
    })
  }

  /** Absence of a footer is itself information: the run was interrupted. */
  footer(status?: FooterRecord['status']): void {
    if (this.closed) return
    this.closed = true
    // A tolerated failure must not fail the run (FR-D6), so the default status
    // only looks at the failures nobody asked to carry on past.
    const untolerated = this.counts.failed - this.counts.tolerated
    this.emit({
      t: 'footer',
      ended: new Date().toISOString(),
      status: status ?? (untolerated > 0 ? 'failed' : 'ok'),
      cells: { ...this.counts },
    })
  }

  get stats(): { ok: number; failed: number; skipped: number; tolerated: number } {
    return { ...this.counts }
  }
}
