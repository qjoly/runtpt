import { describe, expect, it } from 'vitest'
import { buildSlides, parseRunbook, visibleBlocks } from '../src/index.js'

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
