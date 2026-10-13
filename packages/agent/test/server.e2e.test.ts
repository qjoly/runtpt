import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from '@runtpt/protocol'
import { WebSocket } from 'ws'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { which } from '../src/kernels/detect.js'
import { AgentServer } from '../src/server.js'

const describeShell = which('bash') ? describe : describe.skip

class Client {
  readonly messages: ServerMessage[] = []
  private readonly waiters: { match: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] = []

  constructor(private readonly ws: WebSocket) {
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString()) as ServerMessage
      this.messages.push(msg)
      for (let i = this.waiters.length - 1; i >= 0; i--) {
        const waiter = this.waiters[i]!
        if (waiter.match(msg)) {
          this.waiters.splice(i, 1)
          waiter.resolve(msg)
        }
      }
    })
  }

  static async connect(port: number, origin?: string): Promise<Client> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, origin ? { origin } : {})
    const client = new Client(ws)
    await new Promise((resolve, reject) => {
      ws.once('open', resolve)
      ws.once('error', reject)
    })
    return client
  }

  send(msg: ClientMessage): void {
    this.ws.send(JSON.stringify(msg))
  }

  wait<T extends ServerMessage['t']>(t: T, timeoutMs = 5000): Promise<Extract<ServerMessage, { t: T }>> {
    const found = this.messages.find((m) => m.t === t)
    if (found) return Promise.resolve(found as Extract<ServerMessage, { t: T }>)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for "${t}"`)), timeoutMs)
      this.waiters.push({
        match: (m) => m.t === t,
        resolve: (m) => {
          clearTimeout(timer)
          resolve(m as Extract<ServerMessage, { t: T }>)
        },
      })
    })
  }

  close(): void {
    this.ws.close()
  }
}

describeShell('AgentServer', () => {
  let server: AgentServer
  let root: string

  beforeEach(async () => {
    root = mkdtempSync(path.join(os.tmpdir(), 'runtpt-agent-'))
    writeFileSync(path.join(root, 'runbook.md'), '# hi\n')
    server = new AgentServer({ port: 0, root })
    await server.start()
  })

  afterEach(async () => {
    await server.close()
  })

  const paired = async (): Promise<Client> => {
    const client = await Client.connect(server.port)
    client.send({ t: 'hello', v: PROTOCOL_VERSION, pairing: server.pairing, client: 'test' })
    await client.wait('welcome')
    return client
  }

  it('denies a wrong pairing code', async () => {
    const client = await Client.connect(server.port)
    client.send({ t: 'hello', v: PROTOCOL_VERSION, pairing: 'WRONG-CODE', client: 'test' })
    const denied = await client.wait('denied')
    expect(denied.reason).toBe('pairing')
  })

  it('denies a disallowed origin', async () => {
    const client = await Client.connect(server.port, 'https://evil.example.com')
    const denied = await client.wait('denied')
    expect(denied.reason).toBe('origin')
  })

  it('announces its host and kernels after a valid hello', async () => {
    const client = await paired()
    const welcome = await client.wait('welcome')
    expect(welcome.v).toBe(PROTOCOL_VERSION)
    expect(welcome.host.cwd).toBe(path.resolve(root))
    expect(welcome.kernels.map((k) => k.id)).toContain('bash')
    client.close()
  })

  it('lists and opens inside the root, and refuses anything outside', async () => {
    const client = await paired()
    client.send({ t: 'listDir', id: '1', path: '.' })
    const dir = await client.wait('dir')
    expect(dir.entries.map((e) => e.name)).toContain('runbook.md')

    client.send({ t: 'open', id: '2', path: 'runbook.md' })
    expect((await client.wait('document')).content).toBe('# hi\n')

    client.send({ t: 'open', id: '3', path: '../../../etc/passwd' })
    expect((await client.wait('error')).message).toMatch(/outside the agent root/)
    client.close()
  })

  it('saves, then appends', async () => {
    const client = await paired()
    client.send({ t: 'save', id: '1', path: 'out/run.runtpt', content: 'a\n' })
    await client.wait('saved')
    client.send({ t: 'save', id: '2', path: 'out/run.runtpt', content: 'b\n', append: true })
    await new Promise((r) => setTimeout(r, 50))
    expect(readFileSync(path.join(root, 'out', 'run.runtpt'), 'utf8')).toBe('a\nb\n')
    client.close()
  })

  it('runs a cell and streams both streams before the result', async () => {
    const client = await paired()
    client.send({
      t: 'run',
      runId: 'r1',
      cellId: 'c1',
      kernel: 'bash',
      source: 'echo out; echo err >&2; exit 1',
    })
    const result = await client.wait('result')
    expect(result.status).toBe('failed')
    expect(result.exit).toBe(1)
    const chunks = client.messages.filter((m) => m.t === 'chunk')
    expect(chunks.map((c) => c.data).join('')).toContain('out\n')
    expect(chunks.some((c) => c.stream === 'stderr' && c.data.includes('err'))).toBe(true)
    client.close()
  })

  it('redacts declared secrets from the wire and from what it writes', async () => {
    const client = await paired()
    client.send({ t: 'redact', values: ['hunter2000'], names: ['TOKEN'] })
    client.send({ t: 'run', runId: 'r1', cellId: 'c1', kernel: 'bash', source: 'echo "token=hunter2000"' })
    await client.wait('result')
    const text = client.messages.filter((m) => m.t === 'chunk').map((c) => c.data).join('')
    expect(text).not.toContain('hunter2000')
    expect(text).toContain('«redacted:TOKEN»')

    client.send({ t: 'save', id: '9', path: 'leak.txt', content: 'hunter2000\n' })
    await client.wait('saved')
    expect(readFileSync(path.join(root, 'leak.txt'), 'utf8')).toBe('«redacted:TOKEN»\n')
    client.close()
  })

  it('restarts a kernel on demand', async () => {
    const client = await paired()
    client.send({ t: 'run', runId: 'r1', cellId: 'c1', kernel: 'bash', source: 'export KEEP=1' })
    await client.wait('result')
    client.send({ t: 'restart', kernel: 'bash' })
    const state = await client.wait('kernelState')
    expect(['restarting', 'ready']).toContain(state.state)
    client.close()
  })

  describe('readAsset', () => {
    // A real one-pixel PNG, so no binary fixture has to live in the repo.
    const PNG = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    )

    it('returns an image as base64 with its mime type', async () => {
      writeFileSync(path.join(root, 'diagram.png'), PNG)
      const client = await paired()
      client.send({ t: 'readAsset', id: 'a1', path: 'diagram.png' })
      const asset = await client.wait('asset')
      client.close()

      expect(asset).toMatchObject({ mime: 'image/png', encoding: 'base64', bytes: PNG.length })
      expect(Buffer.from(asset.data, 'base64')).toEqual(PNG)
    })

    it('resolves a path relative to the runbook inside the root', async () => {
      mkdirSync(path.join(root, 'assets'), { recursive: true })
      writeFileSync(path.join(root, 'assets/diagram.png'), PNG)
      const client = await paired()
      client.send({ t: 'readAsset', id: 'a2', path: 'assets/diagram.png' })
      const asset = await client.wait('asset')
      client.close()
      expect(asset.path).toBe('assets/diagram.png')
    })

    it('refuses a path escaping the root', async () => {
      const client = await paired()
      client.send({ t: 'readAsset', id: 'a3', path: '../../etc/hosts' })
      const err = await client.wait('error')
      client.close()
      expect(err.id).toBe('a3')
    })

    it('refuses an asset over the requested ceiling', async () => {
      writeFileSync(path.join(root, 'big.png'), Buffer.alloc(2048))
      const client = await paired()
      client.send({ t: 'readAsset', id: 'a4', path: 'big.png', maxBytes: 1024 })
      const err = await client.wait('error')
      client.close()
      expect(err.message).toMatch(/over the 1024 byte limit/)
    })

    it('does not guess a mime type it does not know', async () => {
      writeFileSync(path.join(root, 'notes.bin'), Buffer.from([1, 2, 3]))
      const client = await paired()
      client.send({ t: 'readAsset', id: 'a5', path: 'notes.bin' })
      const asset = await client.wait('asset')
      client.close()
      expect(asset.mime).toBe('application/octet-stream')
    })
  })
})
