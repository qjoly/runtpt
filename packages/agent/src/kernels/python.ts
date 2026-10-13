import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import type { KernelId } from '@runtpt/protocol'
import { SentinelStream, markerFor } from './sentinel.js'
import { SENTINEL, SIGNAL_GRACE_MS, type ExecOutcome, type ExecRequest, type ExecSink, type KernelSession } from './types.js'

/**
 * Driver for the persistent interpreter. Cells arrive base64-encoded on one
 * line, which sidesteps every quoting and line-counting question, and the
 * result comes back through the same sentinel the shell kernel uses.
 */
const DRIVER = `
import sys, os, ast, base64, traceback
_g = {'__name__': '__main__'}
while True:
    line = sys.stdin.readline()
    if not line:
        break
    line = line.strip()
    if not line:
        continue
    try:
        nonce, blob = line.split(' ', 1)
        code = base64.b64decode(blob).decode('utf-8')
    except Exception:
        continue
    status = 0
    try:
        tree = ast.parse(code)
        tail = None
        if tree.body and isinstance(tree.body[-1], ast.Expr):
            tail = ast.Expression(tree.body.pop().value)
        exec(compile(tree, '<cell>', 'exec'), _g)
        if tail is not None:
            value = eval(compile(tail, '<cell>', 'eval'), _g)
            if value is not None:
                sys.stdout.write(repr(value) + '\\n')
    except BaseException:
        traceback.print_exc()
        status = 1
    sys.stdout.flush()
    sys.stderr.flush()
    sys.stdout.write('\\n${SENTINEL}%s %d\\n' % (nonce, status))
    sys.stdout.flush()
    sys.stderr.write('\\n${SENTINEL}%s %d\\n' % (nonce, status))
    sys.stderr.flush()
`

interface Pending {
  resolve(outcome: ExecOutcome): void
  startedAt: number
  stdout: SentinelStream
  stderr: SentinelStream
  reason: 'cancelled' | 'timeout' | null
  timers: NodeJS.Timeout[]
  settled: boolean
}

export class PythonSession implements KernelSession {
  readonly id: KernelId = 'python'
  private proc: ChildProcessWithoutNullStreams | null = null
  private pending: Pending | null = null
  private carryOut = ''
  private carryErr = ''

  constructor(
    /** Absolute path of the interpreter, e.g. a specific python3.x. */
    readonly interpreter: string,
    private readonly opts: { cwd: string; env?: Record<string, string> },
  ) {}

  async start(): Promise<void> {
    if (this.proc) return
    const child = spawn(this.interpreter, ['-u', '-c', DRIVER], {
      cwd: this.opts.cwd,
      env: { ...process.env, ...this.opts.env, PYTHONUNBUFFERED: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
    })
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (d: string) => this.pending?.stdout.push(d))
    child.stderr.on('data', (d: string) => this.pending?.stderr.push(d))
    child.on('exit', (code, signal) => this.onExit(code, signal))
    child.on('error', () => this.onExit(null, null))
    this.proc = child
    await new Promise((r) => setImmediate(r))
  }

  /**
   * A cell calling `exit` takes the whole session with it. Rather than losing
   * the information, the interpreter's own exit status becomes the cell's.
   */
  private onExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.proc = null
    this.carryOut = ''
    this.carryErr = ''
    const p = this.pending
    if (!p || p.settled) return
    p.stdout.drain()
    p.stderr.drain()
    if (p.reason === 'timeout') this.settle(p, 'timeout', null)
    else if (p.reason === 'cancelled') this.settle(p, 'cancelled', null)
    else if (signal !== null) this.settle(p, 'failed', null)
    else this.settle(p, code === 0 ? 'ok' : 'failed', code)
  }

  private settle(p: Pending, status: ExecOutcome['status'], exit: number | null): void {
    if (p.settled) return
    p.settled = true
    for (const t of p.timers) clearTimeout(t)
    if (this.pending === p) this.pending = null
    p.resolve({ status, exit, durationMs: Date.now() - p.startedAt })
  }

  /** Keys this session set on runtpt's behalf, not the operator's. */
  private injected = new Set<string>()

  clearInjectedEnv(): void {
    if (this.injected.size === 0) return
    this.pendingUnset = [...this.injected]
    this.injected.clear()
  }

  /** Applied on the next cell: the interpreter only runs when we feed it one. */
  private pendingUnset: string[] = []

  async exec(req: ExecRequest, sink: ExecSink): Promise<ExecOutcome> {
    if (this.pending) throw new Error('python session is busy')
    if (!this.proc) await this.start()
    const proc = this.proc
    if (!proc) return { status: 'failed', exit: null, durationMs: 0 }

    const nonce = randomBytes(12).toString('hex')
    const marker = markerFor(nonce)
    const stale = [...this.pendingUnset, ...[...this.injected].filter((k) => !(k in (req.env ?? {})))]
    this.pendingUnset = []
    this.injected = new Set(Object.keys(req.env ?? {}))
    const prelude = preludeFor(req, stale)

    return await new Promise<ExecOutcome>((resolve) => {
      const pending: Pending = {
        resolve,
        startedAt: Date.now(),
        reason: null,
        timers: [],
        settled: false,
        stdout: null as unknown as SentinelStream,
        stderr: null as unknown as SentinelStream,
      }
      let exit: number | null = null
      let endedOut = false
      let endedErr = false

      const finish = (): void => {
        if (!endedOut || !endedErr) return
        this.carryOut = pending.stdout.carry()
        this.carryErr = pending.stderr.carry()
        const status: ExecOutcome['status'] =
          pending.reason === 'timeout' ? 'timeout'
          : pending.reason === 'cancelled' ? 'cancelled'
          : exit === 0 ? 'ok'
          : 'failed'
        this.settle(pending, status, exit)
      }

      pending.stdout = new SentinelStream(
        marker,
        (d) => sink.chunk('stdout', d),
        (code) => { exit = code; endedOut = true; finish() },
        this.carryOut,
      )
      pending.stderr = new SentinelStream(
        marker,
        (d) => sink.chunk('stderr', d),
        () => { endedErr = true; finish() },
        this.carryErr,
      )
      this.carryOut = ''
      this.carryErr = ''
      this.pending = pending

      const payload = Buffer.from(prelude + req.source, 'utf8').toString('base64')
      proc.stdin.write(`${nonce} ${payload}\n`)

      if (req.timeoutMs && req.timeoutMs > 0) {
        pending.timers.push(setTimeout(() => this.interrupt(pending, 'timeout'), req.timeoutMs))
      }
    })
  }

  private interrupt(p: Pending, reason: 'cancelled' | 'timeout'): void {
    if (p.settled) return
    p.reason = reason
    this.signal('SIGINT')
    p.timers.push(setTimeout(() => {
      if (p.settled) return
      this.signal('SIGTERM')
      p.timers.push(setTimeout(() => { if (!p.settled) this.signal('SIGKILL') }, SIGNAL_GRACE_MS))
    }, SIGNAL_GRACE_MS))
  }

  private signal(sig: NodeJS.Signals): void {
    const pid = this.proc?.pid
    if (!pid) return
    try { process.kill(-pid, sig) } catch { try { process.kill(pid, sig) } catch { /* gone */ } }
  }

  cancel(): void {
    if (this.pending) this.interrupt(this.pending, 'cancelled')
  }

  write(data: string): void {
    this.proc?.stdin.write(data)
  }

  async restart(): Promise<void> {
    this.dispose()
    await this.start()
  }

  dispose(): void {
    const proc = this.proc
    this.proc = null
    this.pending = null
    this.carryOut = ''
    this.carryErr = ''
    if (!proc?.pid) return
    try { proc.stdin.end() } catch { /* closed */ }
    try { process.kill(-proc.pid, 'SIGKILL') } catch { proc.kill('SIGKILL') }
  }
}

/** Per-cell env and cwd, applied inside the interpreter rather than per process. */
function preludeFor(req: ExecRequest, stale: string[] = []): string {
  const lines: string[] = []
  const env = Object.entries(req.env ?? {})
  if (env.length > 0 || req.cwd || stale.length > 0) lines.push('import os as _rt_os')
  for (const key of stale) lines.push(`_rt_os.environ.pop(${JSON.stringify(key)}, None)`)
  for (const [key, value] of env) {
    lines.push(`_rt_os.environ[${JSON.stringify(key)}] = ${JSON.stringify(value)}`)
  }
  if (req.cwd) lines.push(`_rt_os.chdir(${JSON.stringify(req.cwd)})`)
  return lines.length > 0 ? lines.join('\n') + '\n' : ''
}
