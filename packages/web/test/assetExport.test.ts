import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { AssetProvider, type AssetContextValue } from '../src/assets/context.js'
import { AssetStore, type AssetBytes } from '../src/assets/store.js'
import { Markdown } from '../src/ui/Markdown.js'

const png: AssetBytes = { mime: 'image/png', base64: 'AAAA', bytes: 3 }
const fakeUrls = { create: () => 'blob:fake', revoke: () => {} }

async function exportMarkup(markdown: string, loaded: string[]): Promise<string> {
  const store = new AssetStore(async () => png, fakeUrls)
  for (const path of loaded) store.request(path)
  await vi.waitFor(() => expect(loaded.every((p) => store.get(p)?.status === 'ready')).toBe(true))

  const value: AssetContextValue = { store, runbookPath: 'docs/runbook.md', mode: 'export' }
  return renderToStaticMarkup(
    createElement(AssetProvider, { value, children: createElement(Markdown, { text: markdown }) }),
  )
}

describe('static export', () => {
  it('inlines an image it already loaded', async () => {
    const html = await exportMarkup('![a diagram](diagram.png)', ['docs/diagram.png'])
    expect(html).toContain('src="data:image/png;base64,AAAA"')
    expect(html).toContain('alt="a diagram"')
  })

  it('degrades an image it never loaded to its alt text', async () => {
    const html = await exportMarkup('![a diagram](diagram.png)', [])
    expect(html).not.toContain('<img')
    expect(html).toContain('a diagram')
  })

  it('leaves an external image alone', async () => {
    const html = await exportMarkup('![remote](https://example.com/a.png)', [])
    expect(html).toContain('src="https://example.com/a.png"')
  })

  it('refuses a path that climbs out of the root', async () => {
    const html = await exportMarkup('![escape](../../etc/passwd)', [])
    expect(html).not.toContain('<img')
  })
})
