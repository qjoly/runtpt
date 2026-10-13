import type { KernelId } from '@runtpt/protocol'
import type { ExecOutcome, ExecRequest, ExecSink, KernelSession } from './types.js'

export interface HttpRequestSpec {
  method: string
  url: string
  headers: [string, string][]
  body?: string
}

const METHODS = new Set([
  'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'TRACE', 'CONNECT',
])

/**
 * `METHOD url`, then header lines, then a blank line, then the body.
 * Pure: the tests exercise it without touching the network.
 */
export function parseHttpRequest(source: string): HttpRequestSpec {
  const lines = source.split('\n')
  let i = 0
  while (i < lines.length && lines[i]!.trim() === '') i++

  const first = (lines[i] ?? '').trim()
  if (first === '') throw new Error('empty http cell')
  i++

  const space = first.indexOf(' ')
  let method = 'GET'
  let url = first
  if (space > 0) {
    const head = first.slice(0, space)
    if (METHODS.has(head.toUpperCase())) {
      method = head.toUpperCase()
      url = first.slice(space + 1).trim()
    }
  }
  if (url === '') throw new Error('http cell has no URL')

  const headers: [string, string][] = []
  for (; i < lines.length; i++) {
    const line = lines[i]!
    if (line.trim() === '') { i++; break }
    if (line.trimStart().startsWith('#')) continue
    const colon = line.indexOf(':')
    if (colon <= 0) throw new Error(`invalid header line: ${line.trim()}`)
    headers.push([line.slice(0, colon).trim(), line.slice(colon + 1).trim()])
  }

  const body = lines.slice(i).join('\n').replace(/\s+$/, '')
  return { method, url, headers, ...(body !== '' ? { body } : {}) }
}

function prettyBody(text: string, contentType: string | null): string {
  if (!text) return ''
  if (contentType && /json/i.test(contentType)) {
    try {
      return JSON.stringify(JSON.parse(text), null, 2)
    } catch {
      return text
    }
  }
  return text
}

/** Stateless by nature, but it implements the same interface as the others. */
export class HttpSession implements KernelSession {
  readonly id: KernelId = 'http'
  private controller: AbortController | null = null

  async start(): Promise<void> {}

  async exec(req: ExecRequest, sink: ExecSink): Promise<ExecOutcome> {
    const startedAt = Date.now()
    let spec: HttpRequestSpec
    try {
      spec = parseHttpRequest(req.source)
    } catch (err) {
      sink.chunk('stderr', `${(err as Error).message}\n`)
      return { status: 'failed', exit: 1, durationMs: Date.now() - startedAt }
    }

    const controller = new AbortController()
    this.controller = controller
    let timedOut = false
    const timer = req.timeoutMs && req.timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true
          controller.abort(new Error('timeout'))
        }, req.timeoutMs)
      : null
    timer?.unref()

    try {
      const res = await fetch(spec.url, {
        method: spec.method,
        headers: spec.headers,
        ...(spec.body !== undefined ? { body: spec.body } : {}),
        signal: controller.signal,
      })
      const text = await res.text()
      const lines = [`${res.status} ${res.statusText}`.trim()]
      for (const [key, value] of res.headers) lines.push(`${key}: ${value}`)
      sink.chunk('stdout', lines.join('\n') + '\n\n')

      const body = prettyBody(text, res.headers.get('content-type'))
      if (body) sink.chunk('stdout', body.endsWith('\n') ? body : body + '\n')

      return {
        status: res.ok ? 'ok' : 'failed',
        exit: res.ok ? 0 : 1,
        durationMs: Date.now() - startedAt,
      }
    } catch (err) {
      const aborted = controller.signal.aborted
      sink.chunk('stderr', `${(err as Error).message}\n`)
      return {
        status: aborted ? (timedOut ? 'timeout' : 'cancelled') : 'failed',
        exit: null,
        durationMs: Date.now() - startedAt,
      }
    } finally {
      if (timer) clearTimeout(timer)
      this.controller = null
    }
  }

  cancel(): void {
    this.controller?.abort(new Error('cancelled'))
  }

  write(): void {}

  async restart(): Promise<void> {
    this.cancel()
  }

  clearInjectedEnv(): void {
    // Nothing persists between requests, so there is nothing to forget.
  }

  dispose(): void {
    this.cancel()
  }
}
