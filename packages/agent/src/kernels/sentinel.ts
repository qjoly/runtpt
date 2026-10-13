import { SENTINEL } from './types.js'

export function markerFor(nonce: string): string {
  return `\n${SENTINEL}${nonce} `
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Splits a stream at a per-exec sentinel line. Output is forwarded as it
 * arrives, holding back only the bytes that could still turn out to be the
 * start of the sentinel.
 */
export class SentinelStream {
  private buf: string
  private finished = false
  private readonly re: RegExp

  constructor(
    private readonly marker: string,
    private readonly onData: (data: string) => void,
    private readonly onEnd: (code: number) => void,
    carry = '',
  ) {
    this.re = new RegExp(escapeRegExp(marker) + '(\\d+)\\n')
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

    // Holding back a fixed-size tail meant a command printing less than that
    // never streamed at all: six short lines stayed invisible until it exited.
    // Only a suffix that could still grow into the sentinel has to wait.
    const keep = this.pendingMarkerPrefix()
    if (this.buf.length > keep) {
      const out = this.buf.slice(0, this.buf.length - keep)
      this.buf = this.buf.slice(this.buf.length - keep)
      this.onData(out)
    }
  }

  /** Length of the longest buffer suffix that is a prefix of the marker. */
  private pendingMarkerPrefix(): number {
    const max = Math.min(this.buf.length, this.marker.length - 1)
    for (let n = max; n > 0; n--) {
      if (this.buf.endsWith(this.marker.slice(0, n))) return n
    }
    return 0
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
