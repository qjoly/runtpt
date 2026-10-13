import { describe, expect, it, vi } from 'vitest'
import { isExternal, resolveAssetPath } from '../src/assets/resolve.js'
import { AssetStore, type AssetBytes, type AssetUrls } from '../src/assets/store.js'
import { mimeOf } from '../src/assets/mime.js'

describe('isExternal', () => {
  it('passes through every remote scheme', () => {
    expect(isExternal('http://example.com/a.png')).toBe(true)
    expect(isExternal('https://example.com/a.png')).toBe(true)
    expect(isExternal('data:image/png;base64,AAAA')).toBe(true)
    expect(isExternal('blob:https://example.com/abc')).toBe(true)
    expect(isExternal('//cdn.example.com/a.png')).toBe(true)
  })

  it('keeps document-relative paths for us to resolve', () => {
    expect(isExternal('a.png')).toBe(false)
    expect(isExternal('./a.png')).toBe(false)
    expect(isExternal('../assets/a.png')).toBe(false)
    expect(isExternal('/assets/a.png')).toBe(false)
  })
})

describe('resolveAssetPath', () => {
  it('resolves a sibling file', () => {
    expect(resolveAssetPath('docs/runbook.md', 'a.png')).toBe('docs/a.png')
    expect(resolveAssetPath('docs/runbook.md', './a.png')).toBe('docs/a.png')
  })

  it('resolves a runbook sitting at the root', () => {
    expect(resolveAssetPath('runbook.md', 'img/a.png')).toBe('img/a.png')
  })

  it('climbs as long as it stays inside the root', () => {
    expect(resolveAssetPath('docs/deep/runbook.md', '../assets/a.png')).toBe('docs/assets/a.png')
    expect(resolveAssetPath('docs/runbook.md', '../assets/a.png')).toBe('assets/a.png')
  })

  it('refuses to climb out of the root', () => {
    expect(resolveAssetPath('docs/runbook.md', '../../etc/passwd')).toBeNull()
    expect(resolveAssetPath('runbook.md', '../secret.png')).toBeNull()
  })

  it('treats a leading slash as the repository root', () => {
    expect(resolveAssetPath('docs/deep/runbook.md', '/assets/a.png')).toBe('assets/a.png')
  })

  it('decodes percent escapes and drops query and fragment', () => {
    expect(resolveAssetPath('docs/runbook.md', 'my%20image.png')).toBe('docs/my image.png')
    expect(resolveAssetPath('docs/runbook.md', 'a.png?v=2')).toBe('docs/a.png')
    expect(resolveAssetPath('docs/runbook.md', 'a.png#top')).toBe('docs/a.png')
  })

  it('returns null for external and empty sources', () => {
    expect(resolveAssetPath('docs/runbook.md', 'https://example.com/a.png')).toBeNull()
    expect(resolveAssetPath('docs/runbook.md', '   ')).toBeNull()
  })
})

const fakeUrls: AssetUrls = { create: (asset) => `url:${asset.base64}`, revoke: () => {} }
const png: AssetBytes = { mime: 'image/png', base64: 'AAAA', bytes: 3 }

describe('AssetStore', () => {
  it('fetches a path once however many components ask', async () => {
    const fetcher = vi.fn(async () => png)
    const store = new AssetStore(fetcher, fakeUrls)

    store.request('docs/a.png')
    store.request('docs/a.png')
    await vi.waitFor(() => expect(store.get('docs/a.png')?.status).toBe('ready'))
    store.request('docs/a.png')

    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('notifies subscribers and keeps the failure reason', async () => {
    const store = new AssetStore(async () => {
      throw new Error('boom')
    }, fakeUrls)
    const seen = vi.fn()
    store.subscribe(seen)

    store.request('a.png')
    await vi.waitFor(() => expect(store.get('a.png')?.status).toBe('error'))
    expect(store.get('a.png')).toMatchObject({ reason: 'failed', message: 'boom' })
    expect(seen).toHaveBeenCalled()
  })

  it('revokes its urls and drops answers that arrive after a clear', async () => {
    const revoke = vi.fn()
    let release: (() => void) | null = null
    const store = new AssetStore(
      () => new Promise<AssetBytes>((resolve) => (release = () => resolve(png))),
      { create: fakeUrls.create, revoke },
    )

    store.request('a.png')
    await vi.waitFor(() => expect(release).not.toBeNull())
    store.clear()
    release!()
    await Promise.resolve()

    expect(store.get('a.png')).toBeUndefined()
  })

  it('revokes the urls of loaded assets when cleared', async () => {
    const revoke = vi.fn()
    const store = new AssetStore(async () => png, { create: fakeUrls.create, revoke })
    store.request('a.png')
    await vi.waitFor(() => expect(store.get('a.png')?.status).toBe('ready'))

    store.clear()
    expect(revoke).toHaveBeenCalledWith('url:AAAA')
  })
})

describe('mimeOf', () => {
  it('reads the extension and falls back to octet-stream', () => {
    expect(mimeOf('a/b.PNG')).toBe('image/png')
    expect(mimeOf('a/b.svg')).toBe('image/svg+xml')
    expect(mimeOf('a/b.psd')).toBe('application/octet-stream')
  })
})
