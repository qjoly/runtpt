import { describe, expect, it } from 'vitest'
import { buildSlides, isCoverSlide, parseRunbook } from '../src/index.js'

const firstSlide = (source: string) => buildSlides(parseRunbook(source))[0]!

describe('isCoverSlide', () => {
  it('accepts a title alone', () => {
    expect(isCoverSlide(firstSlide('# Shipping on Fridays\n'))).toBe(true)
  })

  it('accepts a title and two short paragraphs', () => {
    expect(
      isCoverSlide(firstSlide('# Shipping on Fridays\n\nWhy we stopped.\n\nAnd what we do instead.\n\n---\n\n## Next\n')),
    ).toBe(true)
  })

  it('refuses a third paragraph', () => {
    expect(isCoverSlide(firstSlide('# Title\n\nOne.\n\nTwo.\n\nThree.\n'))).toBe(false)
  })

  it('refuses a paragraph long enough to be body copy', () => {
    expect(isCoverSlide(firstSlide(`# Title\n\n${'word '.repeat(60)}\n`))).toBe(false)
  })

  it('refuses a slide carrying a cell', () => {
    expect(isCoverSlide(firstSlide('# Title\n\nIntro.\n\n```bash\nuptime\n```\n'))).toBe(false)
  })

  it('refuses a deck that starts straight into sections', () => {
    expect(isCoverSlide(firstSlide('## First section\n\nBody.\n\n## Second section\n'))).toBe(false)
  })

  it('refuses a list, a table and an image', () => {
    expect(isCoverSlide(firstSlide('# Title\n\n- one\n- two\n'))).toBe(false)
    expect(isCoverSlide(firstSlide('# Title\n\n| a | b |\n| - | - |\n'))).toBe(false)
    expect(isCoverSlide(firstSlide('# Title\n\n![logo](logo.svg)\n'))).toBe(false)
  })

  it('refuses a second heading', () => {
    expect(isCoverSlide(firstSlide('# Title\n\nIntro.\n\n### Detail\n'))).toBe(false)
  })

  it('refuses prose with no title at all', () => {
    expect(isCoverSlide(firstSlide('Just a sentence.\n'))).toBe(false)
  })
})

describe('cover settings', () => {
  const settingsOf = (yaml: string) => parseRunbook(`---\nruntpt:\n  presentation:\n${yaml}---\n\n# T\n`)

  it('defaults to auto with no image', () => {
    const rb = parseRunbook('# T\n')
    expect(rb.settings.presentation.cover).toBe('auto')
    expect(rb.settings.presentation.image).toBeUndefined()
  })

  it('reads a layout and an image path', () => {
    const rb = settingsOf('    cover: split\n    image: assets/hero.svg\n')
    expect(rb.settings.presentation.cover).toBe('split')
    expect(rb.settings.presentation.image).toBe('assets/hero.svg')
  })

  it('warns on an unknown layout and keeps the default', () => {
    const rb = settingsOf('    cover: parallax\n')
    expect(rb.settings.presentation.cover).toBe('auto')
    expect(rb.diagnostics.some((d) => d.level === 'warn' && d.message.includes('parallax'))).toBe(true)
    expect(rb.diagnostics.some((d) => d.level === 'error')).toBe(false)
  })
})
