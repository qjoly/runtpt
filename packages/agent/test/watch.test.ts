import { mkdtempSync, renameSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from '@runtpt/protocol'
import { WebSocket } from 'ws'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AgentServer } from '../src/server.js'
import { WatchRegistry, watchFile } from '../src/watch.js'

const DEBOUNCE = 30

function settle(ms = DEBOUNCE * 6): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (predicate()) return resolve()
      if (Date.now() - started > timeoutMs) return reject(new Error('timed out'))
      setTimeout(tick, 10)
    }
    tick()
  })
}

describe('watchFile', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'runtpt-watch-'))
  })

  it('fires on a plain write', async () => {
    const target = path.join(root, 'book.md')
    writeFileSync(target, 'one\n')
    let fired = 0
    const handle = watchFile(target, () => fired++, { debounceMs: DEBOUNCE })
    try {
      writeFileSync(target, 'two\n')
      await waitFor(() => fired > 0)
      expect(fired).toBeGreaterThan(0)
    } finally {
      handle.close()
    }
  })

  it('survives a rename-over save and keeps reporting', async () => {
    const target = path.join(root, 'book.md')
    writeFileSync(target, 'one\n')
    let fired = 0
    const handle = watchFile(target, () => fired++, { debounceMs: DEBOUNCE })
    try {
      const tmp = path.join(root, '.book.md.swp')
      writeFileSync(tmp, 'two\n')
      renameSync(tmp, target)
      await waitFor(() => fired > 0)
      const afterFirst = fired

      // The inode changed under the watcher; a second save must still report.
      const tmp2 = path.join(root, '.book.md.swp2')
      writeFileSync(tmp2, 'three\n')
      renameSync(tmp2, target)
      await waitFor(() => fired > afterFirst)
      expect(fired).toBeGreaterThan(afterFirst)
    } finally {
      handle.close()
    }
  })

  it('stays quiet for a sibling file', async () => {
    const target = path.join(root, 'book.md')
    writeFileSync(target, 'one\n')
    let fired = 0
    const handle = watchFile(target, () => fired++, { debounceMs: DEBOUNCE })
    try {
      writeFileSync(path.join(root, 'other.md'), 'x\n')
      await settle()
      expect(fired).toBe(0)
    } finally {
      handle.close()
    }
  })

  it('reports nothing once closed', async () => {
    const target = path.join(root, 'book.md')
    writeFileSync(target, 'one\n')
    let fired = 0
    const handle = watchFile(target, () => fired++, { debounceMs: DEBOUNCE })
    handle.close()
    writeFileSync(target, 'two\n')
    await settle()
    expect(fired).toBe(0)
  })
})

describe('WatchRegistry', () => {
  it('replaces a subscription reusing an id, and clears them all', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'runtpt-watch-'))
    const a = path.join(root, 'a.md')
    const b = path.join(root, 'b.md')
    writeFileSync(a, '1')
    writeFileSync(b, '1')
    const seen: string[] = []
    const registry = new WatchRegistry()

    registry.add('s1', a, () => seen.push('a'), { debounceMs: DEBOUNCE })
    expect(registry.size).toBe(1)
    registry.add('s1', b, () => seen.push('b'), { debounceMs: DEBOUNCE })
    expect(registry.size).toBe(1)

    writeFileSync(a, '2')
    writeFileSync(b, '2')
    await waitFor(() => seen.length > 0)
    await settle()
    expect(seen.every((x) => x === 'b')).toBe(true)

    registry.clear()
    expect(registry.size).toBe(0)
    const before = seen.length
    writeFileSync(b, '3')
    await settle()
    expect(seen.length).toBe(before)
  })
})

class Client {
  readonly messages: ServerMessage[] = []

  constructor(private readonly ws: WebSocket) {
    ws.on('message', (raw) => this.messages.push(JSON.parse(raw.toString()) as ServerMessage))
  }

  static async connect(port: number): Promise<Client> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
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

  seen<T extends ServerMessage['t']>(t: T): Extract<ServerMessage, { t: T }>[] {
    return this.messages.filter((m) => m.t === t) as Extract<ServerMessage, { t: T }>[]
  }

  close(): void {
    this.ws.close()
  }
}

describe('watch over the protocol', () => {
  let server: AgentServer
  let root: string

  beforeEach(async () => {
    root = mkdtempSync(path.join(os.tmpdir(), 'runtpt-watch-srv-'))
    server = new AgentServer({ port: 0, root, watchDebounceMs: DEBOUNCE })
    await server.start()
  })

  afterEach(async () => {
    await server.close()
  })

  async function paired(): Promise<Client> {
    const client = await Client.connect(server.port)
    client.send({ t: 'hello', v: PROTOCOL_VERSION, pairing: server.pairing, client: 'test' })
    await waitFor(() => client.seen('welcome').length > 0)
    return client
  }

  it('acknowledges then notifies on a write', async () => {
    const target = path.join(root, 'book.md')
    writeFileSync(target, 'one\n')
    const client = await paired()
    client.send({ t: 'watch', id: 'w1', path: 'book.md' })
    await waitFor(() => client.seen('watching').length > 0)
    expect(client.seen('watching')[0]!.path).toBe('book.md')

    writeFileSync(target, 'two\n')
    await waitFor(() => client.seen('changed').length > 0)
    const changed = client.seen('changed')[0]!
    expect(changed.id).toBe('w1')
    expect(changed.path).toBe('book.md')
    client.close()
  })

  it('refuses a path outside the root', async () => {
    const client = await paired()
    client.send({ t: 'watch', id: 'w2', path: '../escape.md' })
    await waitFor(() => client.seen('error').length > 0)
    expect(client.seen('error')[0]!.message).toContain('outside the agent root')
    expect(client.seen('watching').length).toBe(0)
    client.close()
  })

  it('stops notifying after unwatch', async () => {
    const target = path.join(root, 'book.md')
    writeFileSync(target, 'one\n')
    const client = await paired()
    client.send({ t: 'watch', id: 'w3', path: 'book.md' })
    await waitFor(() => client.seen('watching').length > 0)
    client.send({ t: 'unwatch', id: 'w3' })
    await settle()
    writeFileSync(target, 'two\n')
    await settle()
    expect(client.seen('changed').length).toBe(0)
    client.close()
  })

  it('drops the watcher when the socket closes', async () => {
    const target = path.join(root, 'book.md')
    writeFileSync(target, 'one\n')
    const client = await paired()
    client.send({ t: 'watch', id: 'w4', path: 'book.md' })
    await waitFor(() => client.seen('watching').length > 0)
    client.close()
    await settle()
    writeFileSync(target, 'two\n')
    await settle()
    expect(client.seen('changed').length).toBe(0)
  })
})
