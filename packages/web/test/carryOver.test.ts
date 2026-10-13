import { parseRunbook } from '@runtpt/core'
import { describe, expect, it } from 'vitest'
import { carryOverChecks, carryOverStates, type CellIdentity } from '../src/runbook/carryOver.js'
import { buildChecklistIndex } from '../src/runbook/checklist.js'

interface Out {
  phase: string
  text: string
}

const cellsOf = (markdown: string): CellIdentity[] =>
  parseRunbook(markdown).cells.map((cell) => ({ id: cell.id, hash: cell.hash }))

const ran = (ids: string[]): Record<string, Out> =>
  Object.fromEntries(ids.map((id) => [id, { phase: 'ok', text: `output of ${id}` }]))

describe('carryOverStates', () => {
  const before: CellIdentity[] = [
    { id: 'keep', hash: 'h1' },
    { id: 'edit', hash: 'h2' },
    { id: 'gone', hash: 'h3' },
  ]

  it('keeps a cell whose id and hash are both unchanged', () => {
    const after: CellIdentity[] = [{ id: 'keep', hash: 'h1' }]
    const carry = carryOverStates(ran(['keep', 'edit', 'gone']), before, after)
    expect(carry.states.keep).toEqual({ phase: 'ok', text: 'output of keep' })
  })

  it('clears a cell whose hash changed under the same id', () => {
    const after: CellIdentity[] = [
      { id: 'keep', hash: 'h1' },
      { id: 'edit', hash: 'CHANGED' },
    ]
    const carry = carryOverStates(ran(['keep', 'edit']), before, after)
    expect(carry.states.edit).toBeUndefined()
    expect(carry.cleared).toEqual(['edit'])
    expect(Object.keys(carry.states)).toEqual(['keep'])
  })

  it('does not flag an edited cell that never produced anything', () => {
    const after: CellIdentity[] = [{ id: 'edit', hash: 'CHANGED' }]
    const carry = carryOverStates(ran(['keep']), before, after)
    expect(carry.cleared).toEqual([])
  })

  it('drops a cell that left the document', () => {
    const after: CellIdentity[] = [{ id: 'keep', hash: 'h1' }]
    const carry = carryOverStates(ran(['keep', 'gone']), before, after)
    expect(carry.dropped).toEqual(['gone'])
    expect(carry.states.gone).toBeUndefined()
  })

  it('reports a new cell and leaves it empty', () => {
    const after: CellIdentity[] = [
      { id: 'keep', hash: 'h1' },
      { id: 'fresh', hash: 'h9' },
    ]
    const carry = carryOverStates(ran(['keep']), before, after)
    expect(carry.added).toEqual(['fresh'])
    expect(carry.states.fresh).toBeUndefined()
  })

  it('keeps everything when the document did not actually move', () => {
    const carry = carryOverStates(ran(['keep', 'edit', 'gone']), before, before)
    expect(Object.keys(carry.states).sort()).toEqual(['edit', 'gone', 'keep'])
    expect(carry.cleared).toEqual([])
    expect(carry.dropped).toEqual([])
    expect(carry.added).toEqual([])
  })

  it('applies the same rule to the ids core derives from the source', () => {
    const v1 = '# Book\n\n```bash\necho one\n```\n\n```bash\necho two\n```\n'
    const v2 = '# Book\n\n```bash\necho one\n```\n\n```bash\necho TWO\n```\n'
    const before2 = cellsOf(v1)
    const after2 = cellsOf(v2)
    const states = ran(before2.map((c) => c.id))

    const carry = carryOverStates(states, before2, after2)
    expect(Object.keys(carry.states)).toEqual([before2[0]!.id])
    // The edited cell's id is content-derived, so it leaves and a new one arrives.
    expect(carry.dropped).toEqual([before2[1]!.id])
    expect(carry.added).toEqual([after2[1]!.id])
  })

  it('clears rather than drops when the id is explicit and the body changed', () => {
    const v1 = '# Book\n\n```bash id=check\necho one\n```\n'
    const v2 = '# Book\n\n```bash id=check\necho ONE\n```\n'
    const before2 = cellsOf(v1)
    const after2 = cellsOf(v2)
    const carry = carryOverStates(ran(['check']), before2, after2)
    expect(carry.cleared).toEqual(['check'])
    expect(carry.dropped).toEqual([])
    expect(carry.added).toEqual([])
  })
})

describe('carryOverChecks', () => {
  const idsOf = (markdown: string) => buildChecklistIndex([markdown]).items.map((item) => item.id)

  it('keeps a tick whose item survived the reload', () => {
    const ids = idsOf('- [ ] drain the node\n- [ ] page the on-call\n')
    const ticks = { [ids[0]!]: { t: 'check' as const, id: ids[0]!, text: 'drain the node', checked: true, at: 'now' } }
    const kept = carryOverChecks(ticks, idsOf('- [ ] drain the node\n'))
    expect(kept[ids[0]!]?.checked).toBe(true)
  })

  it('drops a tick whose label was reworded', () => {
    const ids = idsOf('- [ ] drain the node\n')
    const ticks = { [ids[0]!]: { t: 'check' as const, id: ids[0]!, text: 'drain the node', checked: true, at: 'now' } }
    expect(carryOverChecks(ticks, idsOf('- [ ] drain the nodes\n'))).toEqual({})
  })
})
