import { describe, expect, it } from 'vitest'
import { buildPlan, isStale, parseRunbook, shouldSkip, type CellOutcome } from '../src/index.js'

const cell = (id: string, depends = '') =>
  '```bash id=' + id + (depends ? ' depends=' + depends : '') + '\n:\n```\n\n'

describe('buildPlan', () => {
  it('keeps document order when nothing depends on anything', () => {
    const rb = parseRunbook(cell('a') + cell('b') + cell('c'))
    expect(buildPlan(rb).steps.map((s) => s.cell.id)).toEqual(['a', 'b', 'c'])
  })

  it('moves a dependency ahead of its dependent', () => {
    const rb = parseRunbook(cell('a', 'c') + cell('b') + cell('c'))
    expect(buildPlan(rb).steps.map((s) => s.cell.id)).toEqual(['c', 'a', 'b'])
  })

  it('pulls in dependencies of a partial selection', () => {
    const rb = parseRunbook(cell('a') + cell('b', 'a'))
    expect(buildPlan(rb, ['b']).steps.map((s) => s.cell.id)).toEqual(['a', 'b'])
  })

  it('reports a cycle instead of hanging', () => {
    const rb = parseRunbook(cell('a', 'b') + cell('b', 'a'))
    const plan = buildPlan(rb)
    expect(plan.diagnostics.some((d) => /cycle/.test(d.message))).toBe(true)
    expect(plan.steps).toHaveLength(2)
  })

  it('ignores a dependency on a cell that does not exist', () => {
    const rb = parseRunbook(cell('a', 'ghost'))
    expect(buildPlan(rb).steps[0]!.requires).toEqual([])
  })
})

describe('shouldSkip', () => {
  const rb = parseRunbook(cell('a') + cell('b', 'a'))
  const step = buildPlan(rb).steps[1]!

  it('skips when the dependency failed', () => {
    const outcomes = new Map<string, CellOutcome>([['a', 'failed']])
    expect(shouldSkip(step, outcomes)).toMatch(/failed/)
  })

  it('skips when the dependency never ran', () => {
    expect(shouldSkip(step, new Map())).toMatch(/has not run/)
  })

  it('proceeds when the dependency succeeded', () => {
    expect(shouldSkip(step, new Map<string, CellOutcome>([['a', 'ok']]))).toBeNull()
  })
})

describe('isStale', () => {
  const c = parseRunbook(cell('a')).cells[0]!

  it('is false with no recording', () => {
    expect(isStale(c, undefined)).toBe(false)
  })

  it('is false when the hash matches', () => {
    expect(isStale(c, c.hash)).toBe(false)
  })

  it('is true when the source drifted', () => {
    expect(isStale(c, 'sha256:deadbeef')).toBe(true)
  })
})
