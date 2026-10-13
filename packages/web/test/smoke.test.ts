import { describe, expect, it } from 'vitest'
import { parseRunbook, buildSlides } from '@runtpt/core'
import { readRuntpt } from '@runtpt/format'
import { readFileSync } from 'node:fs'
import { stepsOf, slideMarkdown } from '../src/present/slides.js'
import { parseBlobUrl } from '../src/github/api.js'

const md = readFileSync(new URL('../../../examples/hello.md', import.meta.url), 'utf8')
const rt = readFileSync(new URL('../../../examples/hello.runtpt', import.meta.url), 'utf8')

describe('web helpers', () => {
  it('parses the bundled demo', () => {
    const book = parseRunbook(md)
    expect(book.cells.map((c) => c.id)).toEqual(['check-nodes', 'check-pods', 'health'])
    const slides = buildSlides(book)
    expect(slides.length).toBeGreaterThan(1)
    expect(stepsOf(slides[1]!).length).toBe(1)
    expect(slideMarkdown(slides[1]!)).toContain('kubectl')
  })

  it('reads the bundled recording', () => {
    const rec = readRuntpt(rt)
    expect(rec.header?.runbook.path).toBe('examples/hello.md')
    expect(rec.byId.get('check-nodes')?.outputs.length).toBe(1)
    expect(rec.interrupted).toBe(false)
  })

  it('parses blob urls', () => {
    expect(parseBlobUrl('https://github.com/qjoly/ops/blob/main/run/a.md')).toEqual({
      owner: 'qjoly', repo: 'ops', ref: 'main', path: 'run/a.md',
    })
    expect(parseBlobUrl('qjoly/ops/run/a.md@dev')?.ref).toBe('dev')
  })
})
