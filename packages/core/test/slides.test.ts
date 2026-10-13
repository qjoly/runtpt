import { describe, expect, it } from 'vitest'
import { buildSlides, parseRunbook, resolveSlideMode, visibleBlocks } from '../src/index.js'

describe('buildSlides', () => {
  it('splits on thematic breaks by default', () => {
    const slides = buildSlides(parseRunbook('one\n\n---\n\ntwo\n\n---\n\nthree\n'))
    expect(slides).toHaveLength(3)
    expect(slides.map((s) => s.index)).toEqual([0, 1, 2])
  })

  it('splits on headings when configured', () => {
    const rb = parseRunbook(`---
runtpt:
  presentation:
    slides: h2
---

# Deck

intro

## First

a

## Second

b
`)
    const slides = buildSlides(rb)
    expect(slides.map((s) => s.title)).toEqual([undefined, 'First', 'Second'])
  })

  it('keeps a cell inside the slide it belongs to', () => {
    const rb = parseRunbook('one\n\n```bash run\n:\n```\n\n---\n\ntwo\n')
    const slides = buildSlides(rb)
    expect(slides).toHaveLength(2)
    expect(slides[0]!.blocks.some((b) => b.kind === 'cell')).toBe(true)
    expect(slides[1]!.blocks.some((b) => b.kind === 'cell')).toBe(false)
  })

  it('attaches speaker notes to their slide and keeps them out of the blocks', () => {
    const rb = parseRunbook('one\n\n<!-- notes: say this -->\n\n---\n\ntwo\n')
    const slides = buildSlides(rb)
    expect(slides[0]!.notes).toEqual(['say this'])
    expect(slides[0]!.blocks.every((b) => b.kind !== 'notes')).toBe(true)
    expect(slides[1]!.notes).toEqual([])
  })

  it('does not emit an empty leading slide', () => {
    const slides = buildSlides(parseRunbook('\n\n---\n\nonly\n'))
    expect(slides).toHaveLength(1)
  })

  it('does not mistake a frontmatter delimiter for a slide break', () => {
    const rb = parseRunbook('---\ntitle: T\n---\n\nonly\n')
    expect(buildSlides(rb)).toHaveLength(1)
  })
})

describe('visibleBlocks', () => {
  it('drops hidden setup cells', () => {
    const rb = parseRunbook('```bash run hidden\n:\n```\n\n```bash run\n:\n```\n')
    const slide = buildSlides(rb)[0]!
    expect(slide.blocks.filter((b) => b.kind === 'cell')).toHaveLength(2)
    expect(visibleBlocks(slide).filter((b) => b.kind === 'cell')).toHaveLength(1)
  })
})

describe('auto slide mode', () => {
  const modeOf = (doc: string) => resolveSlideMode(parseRunbook(doc))

  it('prefers a divider, because it was written on purpose', () => {
    expect(modeOf('a\n\n---\n\n## b\n\n## c\n')).toBe('hr')
  })

  it('falls back to the heading level that repeats', () => {
    expect(modeOf('# Title\n\nintro\n\n## One\n\na\n\n## Two\n\nb\n')).toBe('h2')
    expect(modeOf('# A\n\na\n\n# B\n\nb\n')).toBe('h1')
  })

  it('does not split a document with a single section', () => {
    expect(buildSlides(parseRunbook('# Only\n\ntext\n'))).toHaveLength(1)
  })

  it('turns a document with headings and no divider into a deck', () => {
    const slides = buildSlides(parseRunbook('# Title\n\nintro\n\n## One\n\na\n\n## Two\n\nb\n'))
    expect(slides.map((s) => s.title)).toEqual([undefined, 'One', 'Two'])
  })

  it('still honours an explicit mode', () => {
    expect(modeOf('---\nruntpt:\n  presentation:\n    slides: h1\n---\n\n## a\n\n## b\n')).toBe('h1')
  })

  // A yaml snippet left in the prose carries `---` of its own, and it used to
  // cut the deck in three.
  it('ignores a break inside a fenced snippet', () => {
    const doc = '# P\n\nstep\n\n```yaml\n---\na: 1\n---\nb: 2\n```\n\ntext\n'
    expect(modeOf(doc)).toBe('hr')
    expect(buildSlides(parseRunbook(doc))).toHaveLength(1)
  })

  it('ignores a heading-looking comment inside a fenced snippet', () => {
    const doc = '# P\n\n```text\n## not a section\n## nor this\n```\n\nprose\n'
    expect(modeOf(doc)).toBe('hr')
    expect(buildSlides(parseRunbook(doc))).toHaveLength(1)
  })

  it('counts a tilde-fenced snippet too', () => {
    expect(modeOf('# P\n\n~~~yaml\n---\n~~~\n\ntext\n')).toBe('hr')
  })
})
