import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readRuntpt } from '../src/index.js'

describe('examples/hello.runtpt', () => {
  const rec = readRuntpt(
    readFileSync(fileURLToPath(new URL('../../../examples/hello.runtpt', import.meta.url)), 'utf8'),
  )

  it('is a complete, uninterrupted run', () => {
    expect(rec.interrupted).toBe(false)
    expect(rec.truncated).toBe(false)
    expect(rec.unknown).toEqual([])
  })

  it('exposes the documented header metadata', () => {
    expect(rec.header).toMatchObject({
      runbook: { path: 'examples/hello.md' },
      run: { params: { CLUSTER: 'staging' } },
      host: { name: 'mocha-jump' },
    })
  })

  it('binds the output and the note to their cell', () => {
    expect(rec.cells[0]!.status).toBe('ok')
    expect(rec.cells[0]!.outputs[0]!.data).toContain('node-1   Ready')
    expect(rec.notes[0]!.after).toBe('check-nodes')
  })
})
