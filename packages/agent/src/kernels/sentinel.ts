import { SENTINEL } from './types.js'

export function markerFor(nonce: string): string {
  return `\n${SENTINEL}${nonce} `
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Splits a stream at a per-exec sentinel line. Output is forwarded as it
 * arrives except for a short tail, held back because a sentinel can be cut in
 * half between two reads.
 */
export class SentinelStream {
  private buf: string
  private finished = false
  private readonly re: RegExp
  private readonly keep: number

  constructor(
    private readonly marker: string,
    private readonly onData: (data: string) => void,
    private readonly onEnd: (code: number) => void,
    carry = '',
  ) {
    this.re = new RegExp(escapeRegExp(marker) + '(\\d+)\\n')
    this.keep = marker.length + 12
    this.buf = ''
    if (carry) this.push(carry)
  }

  push(data: string): void {
    this.buf += data
    if (this.finished) return

    const m = this.re.exec(this.buf)
    if (m) {
      // The marker opens with the newline we injected, so slicing at its index
      // drops that newline and nothing the command actually printed.
      const before = this.buf.slice(0, m.index)
      this.buf = this.buf.slice(m.index + m[0].length)
      this.finished = true
      if (before) this.onData(before)
      this.onEnd(Number(m[1]))
      return
    }

    if (this.buf.length > this.keep) {
      const cut = this.buf.length - this.keep
      const out = this.buf.slice(0, cut)
      this.buf = this.buf.slice(cut)
      this.onData(out)
    }
  }

  /** Everything after the sentinel: it belongs to the next exec. */
  carry(): string {
    return this.finished ? this.buf : ''
  }

  /** Flushes what was held back when the process died mid-exec. */
  drain(): void {
    if (this.finished || !this.buf) return
    const out = this.buf
    this.buf = ''
    this.onData(out)
  }

  get done(): boolean {
    return this.finished
  }
}
