import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import type { KernelId } from '@runtpt/protocol'
import { SentinelStream, markerFor } from './sentinel.js'
import { SENTINEL, SIGNAL_GRACE_MS, type ExecOutcome, type ExecRequest, type ExecSink, type KernelSession } from './types.js'

export function shellQuote(value: string): string {
  return `'` + value.replace(/'/g, `'\\''`) + `'`
}

interface Pending {
  resolve(outcome: ExecOutcome): void
  startedAt: number
  stdout: SentinelStream
  stderr: SentinelStream
  reason: 'cancelled' | 'timeout' | null
  timers: NodeJS.Timeout[]
  settled: boolean
}

/**
 * One long-lived shell per kernel and interpreter, so `cd` and exported variables survive from
 * one cell to the next (FR-E4). Command boundaries and exit codes come back
 * through a sentinel line printed on both streams.
 */
export class ShellSession implements KernelSession {
  private proc: ChildProcessWithoutNullStreams | null = null
  private pending: Pending | null = null
  private carryOut = ''
  private carryErr = ''
  private dead = false

  constructor(
    readonly id: KernelId,
    /** Absolute path of the interpreter to spawn: two paths are two sessions. */
    readonly interpreter: string,
    private readonly opts: { cwd: string; env?: Record<string, string> },
  ) {}

  async start(): Promise<void> {
    if (this.proc) return
    const child = spawn(this.interpreter, [], {
      cwd: this.opts.cwd,
      env: { ...process.env, ...this.opts.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      // Own process group: a cancel can reach the running command without
      // going through the shell.
      detached: true,
    })
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (d: string) => this.pending?.stdout.push(d))
    child.stderr.on('data', (d: string) => this.pending?.stderr.push(d))
    child.on('exit', (code, signal) => this.onExit(code, signal))
    child.on('error', () => this.onExit(null, null))
    this.proc = child
    this.dead = false

    // A trapped signal is reset to its default in children, so the shell keeps
    // running while the cell it spawned is the one that dies.
    child.stdin.write(`trap ':' INT\ntrap ':' TERM\n`)
    await new Promise((r) => setImmediate(r))
  }

  /**
   * A cell calling `exit` takes the whole session with it. Rather than losing
   * the information, the interpreter's own exit status becomes the cell's.
   */
  private onExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.dead = true
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

  /** Keys this session exported on runtpt's behalf, not the operator's. */
  private injected = new Set<string>()

  clearInjectedEnv(): void {
    if (this.injected.size === 0 || !this.proc) return
    const names = [...this.injected].join(' ')
    this.injected.clear()
    try {
      this.proc.stdin?.write(`unset ${names}\n`)
    } catch {
      // A dead shell has nothing left to leak.
    }
  }

  async exec(req: ExecRequest, sink: ExecSink): Promise<ExecOutcome> {
    if (this.pending) throw new Error('shell session is busy')
    if (!this.proc) await this.start()
    const proc = this.proc
    if (!proc) return { status: 'failed', exit: null, durationMs: 0 }

    const nonce = randomBytes(12).toString('hex')
    const marker = markerFor(nonce)
    // A variable dropped from the panel must stop reaching the next cell.
    const stale = [...this.injected].filter((k) => !(k in (req.env ?? {})))
    this.injected = new Set(Object.keys(req.env ?? {}))

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

      proc.stdin.write(buildScript(req, nonce, stale))

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
      p.timers.push(setTimeout(() => {
        if (p.settled) return
        this.signal('SIGKILL')
      }, SIGNAL_GRACE_MS))
    }, SIGNAL_GRACE_MS))
  }

  private signal(sig: NodeJS.Signals): void {
    const pid = this.proc?.pid
    if (!pid) return
    try {
      process.kill(-pid, sig)
    } catch {
      try { process.kill(pid, sig) } catch { /* already gone */ }
    }
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

  get alive(): boolean {
    return this.proc !== null && !this.dead
  }
}

/** Plain POSIX shell: `sh` is dash on most Linux boxes, so no bashisms here. */
function buildScript(req: ExecRequest, nonce: string, stale: string[] = []): string {
  const lines: string[] = []
  if (stale.length > 0) lines.push(`unset ${stale.join(' ')}`)
  for (const [key, value] of Object.entries(req.env ?? {})) {
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) lines.push(`export ${key}=${shellQuote(value)}`)
  }
  if (req.cwd) {
    // Running in the wrong directory is worse than failing, hence the guard.
    lines.push(`__rt_prev=$PWD`)
    lines.push(`if cd ${shellQuote(req.cwd)}; then`)
    lines.push(req.source)
    lines.push(`__rt_code=$?`)
    lines.push(`cd "$__rt_prev" 2>/dev/null`)
    lines.push(`else __rt_code=1; fi`)
  } else {
    lines.push(req.source)
    lines.push(`__rt_code=$?`)
  }
  const emit = `printf '\\n${SENTINEL}%s %d\\n' ${shellQuote(nonce)} "$__rt_code"`
  lines.push(emit)
  lines.push(`${emit} >&2`)
  return lines.join('\n') + '\n'
}
