import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { buildSlides, parseRunbook, type PresentationSettings } from '@runtpt/core'
import { describe, expect, it, vi } from 'vitest'
import { AssetProvider, type AssetContextValue } from '../src/assets/context.js'
import { AssetStore, type AssetBytes } from '../src/assets/store.js'
import { Cover, coverStyleOf, withImage } from '../src/present/Cover.js'

const settings = (over: Partial<PresentationSettings> = {}): PresentationSettings => ({
  theme: 'default',
  slides: 'auto',
  cover: 'auto',
  ...over,
})

const slideZero = (source: string) => buildSlides(parseRunbook(source))[0]

describe('cover resolution', () => {
  const title = slideZero('# Title\n\nA sentence.\n')
  const sections = slideZero('## One\n\nBody.\n\n## Two\n')

  it('dresses a title-like slide 0 under auto', () => {
    expect(coverStyleOf(settings(), title)).toBe('center')
  })

  it('leaves a deck that opens on sections alone', () => {
    expect(coverStyleOf(settings(), sections)).toBeNull()
  })

  it('honours an explicit layout even on a busy slide', () => {
    expect(coverStyleOf(settings({ cover: 'band' }), sections)).toBe('band')
  })

  it('opts out on none', () => {
    expect(coverStyleOf(settings({ cover: 'none' }), title)).toBeNull()
  })

  it('falls back to center for the picture layouts with no picture', () => {
    expect(withImage('split', false)).toBe('center')
    expect(withImage('full', false)).toBe('center')
    expect(withImage('band', false)).toBe('band')
    expect(withImage('split', true)).toBe('split')
  })
})

const svg: AssetBytes = { mime: 'image/svg+xml', base64: 'PHN2Zy8+', bytes: 6 }
const fakeUrls = { create: () => 'blob:fake', revoke: () => {} }

async function coverMarkup(image: string | undefined, loaded: string[]): Promise<string> {
  const store = new AssetStore(async () => svg, fakeUrls)
  for (const path of loaded) store.request(path)
  await vi.waitFor(() => expect(loaded.every((p) => store.get(p)?.status === 'ready')).toBe(true))

  const value: AssetContextValue = { store, runbookPath: 'examples/covers.md', mode: 'export' }
  return renderToStaticMarkup(
    createElement(AssetProvider, {
      value,
      children: createElement(Cover, { style: 'split', image, children: createElement('h1', null, 'Title') }),
    }),
  )
}

describe('cover in the static export', () => {
  it('inlines the cover image as a data URL', async () => {
    const html = await coverMarkup('assets/hero.svg', ['examples/assets/hero.svg'])
    expect(html).toContain('cover cover-split')
    expect(html).toContain('src="data:image/svg+xml;base64,PHN2Zy8+"')
    expect(html).toContain('data-kind="vector"')
  })

  it('degrades to the text cover when the image never loaded', async () => {
    const html = await coverMarkup('assets/hero.svg', [])
    expect(html).toContain('cover cover-center')
    expect(html).not.toContain('<img')
    expect(html).toContain('Title')
  })

  it('degrades when the deck names no image at all', async () => {
    const html = await coverMarkup(undefined, [])
    expect(html).toContain('cover cover-center')
    expect(html).not.toContain('<img')
  })
})
