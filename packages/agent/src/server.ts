import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Redactor } from '@runtpt/format'
import {
  DEFAULT_AGENT_PORT,
  PROTOCOL_VERSION,
  parseClientMessage,
  type ClientMessage,
  type DirEntry,
  type ServerMessage,
} from '@runtpt/protocol'
import { WebSocketServer, type WebSocket } from 'ws'
import { detectKernels } from './kernels/detect.js'
import { KernelPool, type KernelTarget } from './pool.js'
import { relativeToRoot, resolveInRoot } from './paths.js'

export const AGENT_VERSION = '0.1.0'
const PAIRING_TIMEOUT_MS = 10_000

export interface ServerOptions {
  port?: number
  root?: string
  /** Extra allowed origins on top of loopback. */
  origins?: string[]
  pairing?: string
  env?: Record<string, string>
}

export function generatePairingCode(): string {
  // Crockford-ish alphabet: no vowels, no look-alikes, readable over a call.
  const alphabet = '23456789BCDFGHJKLMNPQRSTVWXZ'
  const bytes = randomBytes(8)
  let code = ''
  for (let i = 0; i < 8; i++) {
    code += alphabet[bytes[i]! % alphabet.length]
    if (i === 3) code += '-'
  }
  return code
}

export function isOriginAllowed(origin: string | undefined, extra: string[] = []): boolean {
  // An opaque origin is what a sandboxed iframe sends: never trust it.
  if (origin === 'null') return false
  // A non-browser client sends no Origin at all; the pairing secret still gates it.
  if (!origin) return true
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return false
  }
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true
  return extra.some((allowed) => {
    try {
      return new URL(allowed).origin === url.origin
    } catch {
      return allowed === origin
    }
  })
}

interface Connection {
  ws: WebSocket
  paired: boolean
  seq: number
  active: Map<string, KernelTarget>
}

export class AgentServer {
  readonly pairing: string
  readonly root: string
  private readonly origins: string[]
  private readonly redactor = new Redactor()
  private readonly pool: KernelPool
  private wss: WebSocketServer | null = null
  private boundPort = 0

  constructor(private readonly opts: ServerOptions = {}) {
    this.pairing = opts.pairing ?? generatePairingCode()
    this.root = path.resolve(opts.root ?? process.cwd())
    this.origins = opts.origins ?? []
    this.pool = new KernelPool({ cwd: this.root, ...(opts.env ? { env: opts.env } : {}) })
  }

  get port(): number {
    return this.boundPort
  }

  async start(): Promise<number> {
    const wss = new WebSocketServer({ host: '127.0.0.1', port: this.opts.port ?? DEFAULT_AGENT_PORT })
    this.wss = wss
    await new Promise<void>((resolve, reject) => {
      wss.once('listening', resolve)
      wss.once('error', reject)
    })
    const address = wss.address()
    this.boundPort = typeof address === 'object' && address ? address.port : (this.opts.port ?? DEFAULT_AGENT_PORT)

    wss.on('connection', (ws, req) => {
      if (!isOriginAllowed(req.headers.origin, this.origins)) {
        send(ws, { t: 'denied', reason: 'origin', message: `origin "${req.headers.origin}" is not allowed` })
        ws.close()
        return
      }
      this.attach(ws)
    })
    return this.boundPort
  }

  private attach(ws: WebSocket): void {
    const conn: Connection = { ws, paired: false, seq: 0, active: new Map() }
    const timer = setTimeout(() => {
      if (conn.paired) return
      send(ws, { t: 'denied', reason: 'pairing', message: 'no valid hello within the pairing window' })
      ws.close()
    }, PAIRING_TIMEOUT_MS)
    timer.unref()

    ws.on('message', (raw) => {
      const msg = parseClientMessage(raw.toString())
      if (!msg) {
        send(ws, { t: 'error', message: 'malformed message' })
        return
      }
      if (!conn.paired && msg.t !== 'hello') {
        send(ws, { t: 'denied', reason: 'pairing', message: 'hello first' })
        ws.close()
        return
      }
      void this.handle(conn, msg, timer)
    })
    ws.on('close', () => {
      clearTimeout(timer)
      for (const [, target] of conn.active) this.pool.peek(target)?.cancel()
      conn.active.clear()
      // The shell outlives the tab; the variables the tab injected must not.
      this.redactor.clear()
      this.pool.clearInjectedEnv()
    })
  }

  private async handle(conn: Connection, msg: ClientMessage, timer: NodeJS.Timeout): Promise<void> {
    switch (msg.t) {
      case 'hello': {
        if (msg.pairing !== this.pairing) {
          send(conn.ws, { t: 'denied', reason: 'pairing', message: 'wrong pairing code' })
          conn.ws.close()
          return
        }
        if (msg.v !== PROTOCOL_VERSION) {
          send(conn.ws, {
            t: 'denied',
            reason: 'version',
            message: `agent speaks protocol v${PROTOCOL_VERSION}, client speaks v${msg.v}`,
          })
          conn.ws.close()
          return
        }
        conn.paired = true
        clearTimeout(timer)
        send(conn.ws, {
          t: 'welcome',
          v: PROTOCOL_VERSION,
          host: {
            name: os.hostname(),
            os: process.platform,
            arch: process.arch,
            agent: `runtpt-agent/${AGENT_VERSION}`,
            cwd: this.root,
          },
          kernels: detectKernels(),
        })
        return
      }

      case 'listDir':
        return this.listDir(conn, msg.id, msg.path)

      case 'open': {
        const target = resolveInRoot(this.root, msg.path)
        if (!target) return this.deny(conn, msg.id, msg.path)
        try {
          const content = await fs.readFile(target, 'utf8')
          send(conn.ws, { t: 'document', id: msg.id, path: relativeToRoot(this.root, target), content })
        } catch (err) {
          send(conn.ws, { t: 'error', id: msg.id, message: `cannot open: ${(err as Error).message}` })
        }
        return
      }

      case 'save': {
        const target = resolveInRoot(this.root, msg.path)
        if (!target) return this.deny(conn, msg.id, msg.path)
        try {
          const content = this.redactor.apply(msg.content)
          await fs.mkdir(path.dirname(target), { recursive: true })
          if (msg.append) await fs.appendFile(target, content, 'utf8')
          else await fs.writeFile(target, content, 'utf8')
          send(conn.ws, { t: 'saved', id: msg.id, path: relativeToRoot(this.root, target) })
        } catch (err) {
          send(conn.ws, { t: 'error', id: msg.id, message: `cannot save: ${(err as Error).message}` })
        }
        return
      }

      case 'run':
        return this.run(conn, msg)

      case 'cancel': {
        const target = conn.active.get(key(msg.runId, msg.cellId))
        if (target) this.pool.peek(target)?.cancel()
        return
      }

      case 'stdin': {
        const target = conn.active.get(key(msg.runId, msg.cellId))
        if (target) this.pool.peek(target)?.write(msg.data)
        return
      }

      case 'restart': {
        // The browser resolved the alias already; what arrives here is the
        // concrete kernel, plus the interpreter that identifies the session.
        const target: KernelTarget = {
          kernel: msg.kernel,
          ...(msg.interpreter ? { interpreter: msg.interpreter } : {}),
        }
        const state = { kernel: msg.kernel, ...(msg.interpreter ? { interpreter: msg.interpreter } : {}) }
        send(conn.ws, { t: 'kernelState', ...state, state: 'restarting' })
        try {
          await this.pool.restart(target)
          send(conn.ws, { t: 'kernelState', ...state, state: 'ready' })
        } catch (err) {
          send(conn.ws, { t: 'kernelState', ...state, state: 'dead', detail: (err as Error).message })
        }
        return
      }

      case 'redact': {
        this.redactor.clear()
        for (let i = 0; i < msg.values.length; i++) {
          const value = msg.values[i]
          if (value === undefined) continue
          this.redactor.add(msg.names[i] ?? 'SECRET', value)
        }
        return
      }
    }
  }

  private deny(conn: Connection, id: string, requested: string): void {
    send(conn.ws, { t: 'error', id, message: `path "${requested}" is outside the agent root` })
  }

  private async listDir(conn: Connection, id: string, p: string): Promise<void> {
    const target = resolveInRoot(this.root, p === '' ? '.' : p)
    if (!target) return this.deny(conn, id, p)
    try {
      const dirents = await fs.readdir(target, { withFileTypes: true })
      const entries: DirEntry[] = []
      for (const dirent of dirents) {
        if (dirent.name.startsWith('.')) continue
        const full = path.join(target, dirent.name)
        const entry: DirEntry = {
          name: dirent.name,
          path: relativeToRoot(this.root, full),
          dir: dirent.isDirectory(),
        }
        if (!dirent.isDirectory()) {
          try { entry.size = (await fs.stat(full)).size } catch { /* vanished */ }
        }
        entries.push(entry)
      }
      entries.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1))
      const parent = target === this.root ? null : relativeToRoot(this.root, path.dirname(target))
      send(conn.ws, { t: 'dir', id, path: relativeToRoot(this.root, target), parent, entries })
    } catch (err) {
      send(conn.ws, { t: 'error', id, message: `cannot list: ${(err as Error).message}` })
    }
  }

  private async run(conn: Connection, msg: Extract<ClientMessage, { t: 'run' }>): Promise<void> {
    const { runId, cellId } = msg
    const slot = key(runId, cellId)
    if (conn.active.has(slot)) {
      send(conn.ws, { t: 'error', runId, cellId, message: 'this cell is already running' })
      return
    }

    let cwd: string | undefined
    if (msg.cwd) {
      const resolved = resolveInRoot(this.root, msg.cwd)
      if (!resolved) {
        send(conn.ws, { t: 'error', runId, cellId, message: `cwd "${msg.cwd}" is outside the agent root` })
        return
      }
      cwd = resolved
    }

    const target: KernelTarget = {
      kernel: msg.kernel,
      ...(msg.interpreter ? { interpreter: msg.interpreter } : {}),
    }
    conn.active.set(slot, target)
    const startedAt = Date.now()
    try {
      const session = await this.pool.get(target)
      const outcome = await session.exec(
        {
          source: msg.source,
          ...(msg.env ? { env: msg.env } : {}),
          ...(cwd ? { cwd } : {}),
          ...(msg.timeoutMs ? { timeoutMs: msg.timeoutMs } : {}),
        },
        {
          chunk: (stream, data) => {
            send(conn.ws, {
              t: 'chunk',
              runId,
              cellId,
              seq: ++conn.seq,
              stream,
              at: new Date().toISOString(),
              data: this.redactor.apply(data),
            })
          },
          display: (mime, data, encoding) => {
            send(conn.ws, {
              t: 'display',
              runId,
              cellId,
              seq: ++conn.seq,
              at: new Date().toISOString(),
              mime,
              ...(encoding ? { encoding } : {}),
              data: encoding === 'base64' ? data : this.redactor.apply(data),
            })
          },
        },
      )
      send(conn.ws, {
        t: 'result',
        runId,
        cellId,
        seq: ++conn.seq,
        status: outcome.status,
        exit: outcome.exit,
        durationMs: outcome.durationMs,
        endedAt: new Date().toISOString(),
      })
    } catch (err) {
      send(conn.ws, {
        t: 'chunk',
        runId,
        cellId,
        seq: ++conn.seq,
        stream: 'stderr',
        at: new Date().toISOString(),
        data: `${(err as Error).message}\n`,
      })
      send(conn.ws, {
        t: 'result',
        runId,
        cellId,
        seq: ++conn.seq,
        status: 'failed',
        exit: null,
        durationMs: Date.now() - startedAt,
        endedAt: new Date().toISOString(),
      })
    } finally {
      conn.active.delete(slot)
    }
  }

  async close(): Promise<void> {
    this.pool.disposeAll()
    const wss = this.wss
    this.wss = null
    if (!wss) return
    for (const client of wss.clients) client.terminate()
    await new Promise<void>((resolve) => wss.close(() => resolve()))
  }
}

function key(runId: string, cellId: string): string {
  return `${runId}\u0000${cellId}`
}

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg))
}
