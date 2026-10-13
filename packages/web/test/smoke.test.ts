import { describe, expect, it } from 'vitest'
import { parseRunbook, buildSlides, resolveKernel, type ShellChoice } from '@runtpt/core'
import { readRuntpt } from '@runtpt/format'
import { readFileSync } from 'node:fs'
import { stepsOf, slideMarkdown } from '../src/present/slides.js'
import { parseBlobUrl } from '../src/github/api.js'
import { badgeLabel, kernelBadge } from '../src/runbook/badge.js'
import { keyError, liveVars, mergeRunEnv, sessionEnv, sessionSecrets, shadowedKeys } from '../src/session/vars.js'

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

const ZSH: ShellChoice = { kernel: 'zsh', path: '/bin/zsh' }
const vars = (...rows: [string, string, boolean?][]) =>
  rows.map(([key, value, secret], i) => ({ id: `v${i}`, key, value, secret: secret ?? false }))

describe('kernel badge', () => {
  const settings = parseRunbook('---\nruntpt:\n  shell: bash\n---\n\nx\n').settings
  const cellOf = (fence: string) => parseRunbook('```' + fence + ' run\n:\n```\n').cells[0]!

  it('shows a shell cell as derived, down to the shell it resolved to', () => {
    const cell = cellOf('shell')
    expect(badgeLabel(kernelBadge(cell, resolveKernel(cell, settings, ZSH)))).toBe('SHELL → ZSH')
  })

  it('leaves a pinned cell pinned, whatever the session shell is', () => {
    const cell = cellOf('bash')
    const badge = kernelBadge(cell, resolveKernel(cell, settings, ZSH))
    expect(badgeLabel(badge)).toBe('BASH')
    expect(badge.from).toBeUndefined()
  })

  it('carries the interpreter so the cell can show it', () => {
    const cell = cellOf('python interpreter=/usr/bin/python3.12')
    const badge = kernelBadge(cell, resolveKernel(cell, settings))
    expect(badge.interpreter).toBe('/usr/bin/python3.12')
    expect(badge.title).toContain('/usr/bin/python3.12')
  })
})

describe('session variable keys', () => {
  it('accepts shell-legal names and refuses the rest', () => {
    expect(keyError('TOKEN')).toBeNull()
    expect(keyError('_a1')).toBeNull()
    expect(keyError('')).toBeNull()
    expect(keyError('1A')).toMatch(/not start with a digit/)
    expect(keyError('A-B')).toMatch(/letters, digits/)
    expect(keyError('A B')).not.toBeNull()
  })

  it('blames the row that shadows, not the first one', () => {
    expect(keyError('A', [])).toBeNull()
    expect(keyError('A', ['A'])).toMatch(/Already defined/)
  })

  it('exports only the usable rows, first definition winning', () => {
    const rows = vars(['A', '1'], ['bad key', 'x'], ['', 'y'], ['A', '2'])
    expect(liveVars(rows).map((v) => v.key)).toEqual(['A'])
    expect(sessionEnv(rows)).toEqual({ A: '1' })
  })

  it('registers non-empty secrets only', () => {
    expect(sessionSecrets(vars(['T', 'abc', true], ['E', '', true], ['P', 'plain']))).toEqual({ T: 'abc' })
  })
})

describe('run environment', () => {
  it('layers frontmatter env under session variables under parameters', () => {
    const merged = mergeRunEnv({ NS: 'default', KEEP: '1' }, { NS: 'staging', OWN: 'x' }, { NS: 'prod' })
    expect(merged).toEqual({ NS: 'prod', KEEP: '1', OWN: 'x' })
  })

  it('names the frontmatter keys a later layer takes over', () => {
    const shadow = shadowedKeys({ NS: 'default', KEEP: '1' }, { NS: 'staging' }, { KEEP: '2' })
    expect([...shadow].sort()).toEqual(['KEEP', 'NS'])
  })
})
