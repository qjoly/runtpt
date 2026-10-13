import { gunzipSync, gzipSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import { AgentServer, isOriginAllowed, type ServerOptions } from '../src/server.js'
import type { EmbeddedAsset } from '../src/web-assets.js'

const asset = (mime: string, body: string): EmbeddedAsset => ({
  mime,
  gzip: gzipSync(Buffer.from(body)).toString('base64'),
})

const FAKE = {
  '/index.html': asset('text/html; charset=utf-8', '<!doctype html><title>runtpt</title>'),
  '/assets/index-abc123.js': asset('text/javascript; charset=utf-8', 'export const x = 1\n'),
}

let server: AgentServer | null = null

async function serve(opts: ServerOptions = {}): Promise<string> {
  server = new AgentServer({ port: 0, assets: FAKE, ...opts })
  await server.start()
  return `http://127.0.0.1:${server.port}`
}

afterEach(async () => {
  await server?.close()
  server = null
})

describe('embedded web server', () => {
  it('serves index.html at the root', async () => {
    const base = await serve()
    const res = await fetch(`${base}/`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
    expect(await res.text()).toContain('<title>runtpt</title>')
  })

  it('serves index.html for an unknown extensionless path', async () => {
    const base = await serve()
    const res = await fetch(`${base}/some/route`)
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('<title>runtpt</title>')
  })

  it('404s a missing file instead of falling back to index.html', async () => {
    const base = await serve()
    const res = await fetch(`${base}/assets/missing-xyz.js`)
    expect(res.status).toBe(404)
    expect(await res.text()).not.toContain('<title>')
  })

  it('caches hashed assets but not the shell', async () => {
    const base = await serve()
    const res = await fetch(`${base}/assets/index-abc123.js`)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toMatch(/immutable/)
  })

  it('sends gzip when accepted and plain bytes when not', async () => {
    const base = await serve()
    // fetch() decodes transparently, so the raw frame is checked with a manual request.
    const packed = await raw(base, '/index.html', 'gzip')
    expect(packed.headers['content-encoding']).toBe('gzip')
    expect(gunzipSync(packed.body).toString()).toContain('<title>runtpt</title>')

    const plain = await raw(base, '/index.html', 'identity')
    expect(plain.headers['content-encoding']).toBeUndefined()
    expect(plain.body.toString()).toContain('<title>runtpt</title>')
  })

  it('refuses anything but GET and HEAD', async () => {
    const base = await serve()
    const res = await fetch(`${base}/`, { method: 'POST' })
    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toContain('GET')
  })

  it('explains itself when no web app was embedded', async () => {
    const base = await serve({ assets: {} })
    const res = await fetch(`${base}/`)
    expect(res.status).toBe(404)
    expect(await res.text()).toMatch(/--web/)
    expect(server?.webEmbedded).toBe(false)
  })

  it('allows its own origin on the websocket', async () => {
    const base = await serve()
    expect(isOriginAllowed(base, [base])).toBe(true)
    expect(isOriginAllowed(`http://localhost:${server?.port}`)).toBe(true)
  })
})

interface RawResponse {
  status: number
  headers: Record<string, string | undefined>
  body: Buffer
}

async function raw(base: string, path: string, encoding: string): Promise<RawResponse> {
  const { get } = await import('node:http')
  const url = new URL(path, base)
  return await new Promise((resolve, reject) => {
    const req = get(
      { hostname: url.hostname, port: url.port, path: url.pathname, headers: { 'accept-encoding': encoding } },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers as Record<string, string | undefined>,
            body: Buffer.concat(chunks),
          }),
        )
      },
    )
    req.on('error', reject)
  })
}
