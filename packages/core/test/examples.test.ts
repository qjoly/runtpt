import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildPlan, buildSlides, parseRunbook, resolveParams, substitute } from '../src/index.js'

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../../../examples/${name}`, import.meta.url)), 'utf8')

describe('examples/hello.md', () => {
  const rb = parseRunbook(read('hello.md'))

  it('parses without errors', () => {
    expect(rb.diagnostics.filter((d) => d.level === 'error')).toEqual([])
  })

  it('finds the three documented cells', () => {
    expect(rb.cells.map((c) => [c.id, c.kernel])).toEqual([
      ['check-nodes', 'bash'],
      ['check-pods', 'bash'],
      ['health', 'http'],
    ])
  })

  it('carries the documented attributes', () => {
    expect(rb.cells[0]!.attrs.timeoutMs).toBe(30_000)
    expect(rb.cells[1]!.attrs.depends).toEqual(['check-nodes'])
  })

  it('resolves its parameter into the http cell', () => {
    const { values } = resolveParams(rb.settings.params, {})
    expect(substitute(rb.cells[2]!.source, values)).toContain('api.staging.example.com')
  })

  it('segments into one slide per h2 as declared', () => {
    expect(buildSlides(rb).map((s) => s.title)).toEqual([undefined, 'Nodes', 'Workloads', 'API reachability'])
  })

  it('keeps the speaker note out of the slide body', () => {
    const slides = buildSlides(rb)
    expect(slides.find((s) => s.title === 'Nodes')!.notes[0]).toContain('VPN')
  })

  it('plans the cells in dependency order', () => {
    expect(buildPlan(rb).steps.map((s) => s.cell.id)).toEqual(['check-nodes', 'check-pods', 'health'])
  })
})
