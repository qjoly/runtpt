import { describe, expect, it } from 'vitest'
import {
  parseRunbook,
  parseShellChoice,
  resolveKernel,
  sessionKey,
  type Diagnostic,
  type ShellChoice,
} from '../src/index.js'

describe('parseShellChoice', () => {
  it('accepts a bare name', () => {
    expect(parseShellChoice('zsh')).toEqual({ kernel: 'zsh' })
  })

  it('keeps a path and derives the dialect from its basename', () => {
    expect(parseShellChoice('/opt/homebrew/bin/bash')).toEqual({
      kernel: 'bash',
      path: '/opt/homebrew/bin/bash',
    })
  })

  it('assumes POSIX semantics for an interpreter it does not know, and says so', () => {
    const d: Diagnostic[] = []
    expect(parseShellChoice('/usr/bin/fish', d)).toEqual({ kernel: 'sh', path: '/usr/bin/fish' })
    expect(d[0]!.message).toMatch(/assuming POSIX sh/)
  })

  it('warns on an unknown bare name rather than trusting it as a path', () => {
    const d: Diagnostic[] = []
    expect(parseShellChoice('fish', d)).toEqual({ kernel: 'bash' })
    expect(d[0]!.message).toMatch(/Unknown shell/)
  })
})

describe('frontmatter', () => {
  it('reads a shell path and per-kernel interpreters', () => {
    const rb = parseRunbook(`---
runtpt:
  shell: /opt/homebrew/bin/zsh
  interpreters:
    python: /usr/bin/python3.12
---

body
`)
    expect(rb.settings.shell).toEqual({ kernel: 'zsh', path: '/opt/homebrew/bin/zsh' })
    expect(rb.settings.interpreters.python).toBe('/usr/bin/python3.12')
  })

  it('rejects an interpreter for a kernel that does not exist', () => {
    const rb = parseRunbook('---\nruntpt:\n  interpreters:\n    perl: /usr/bin/perl\n---\n\nx\n')
    expect(rb.diagnostics.some((d) => /No kernel named "perl"/.test(d.message))).toBe(true)
  })
})

describe('resolveKernel', () => {
  const settings = parseRunbook('---\nruntpt:\n  shell: zsh\n---\n\nx\n').settings

  it('resolves a shell cell to the runbook shell', () => {
    const cell = parseRunbook('```shell run\n:\n```\n').cells[0]!
    expect(resolveKernel(cell, settings)).toEqual({ kernel: 'zsh', inherited: true })
  })

  it('lets a session override win over the runbook', () => {
    const cell = parseRunbook('```shell run\n:\n```\n').cells[0]!
    const override: ShellChoice = { kernel: 'sh', path: '/bin/sh' }
    expect(resolveKernel(cell, settings, override)).toEqual({
      kernel: 'sh',
      interpreter: '/bin/sh',
      inherited: true,
    })
  })

  it('never lets an override touch a cell that pinned its kernel', () => {
    const cell = parseRunbook('```bash run\n:\n```\n').cells[0]!
    expect(resolveKernel(cell, settings, { kernel: 'zsh' })).toEqual({
      kernel: 'bash',
      inherited: false,
    })
  })

  it('applies a per-kernel interpreter from the frontmatter', () => {
    const rb = parseRunbook('---\nruntpt:\n  interpreters:\n    python: /usr/bin/python3.12\n---\n\n```python run\n:\n```\n')
    expect(resolveKernel(rb.cells[0]!, rb.settings)).toMatchObject({
      kernel: 'python',
      interpreter: '/usr/bin/python3.12',
    })
  })

  it('lets a cell attribute beat the runbook setting', () => {
    const rb = parseRunbook('---\nruntpt:\n  interpreters:\n    python: /usr/bin/python3.12\n---\n\n```python run interpreter=/usr/bin/python3.9\n:\n```\n')
    expect(resolveKernel(rb.cells[0]!, rb.settings).interpreter).toBe('/usr/bin/python3.9')
  })

  it('lets a shell cell pin its own interpreter', () => {
    const cell = parseRunbook('```shell run interpreter=/bin/dash\n:\n```\n').cells[0]!
    expect(resolveKernel(cell, settings).interpreter).toBe('/bin/dash')
  })
})

describe('sessionKey', () => {
  it('separates two interpreters of the same kernel', () => {
    expect(sessionKey({ kernel: 'bash', inherited: false })).toBe('bash')
    expect(sessionKey({ kernel: 'bash', interpreter: '/opt/homebrew/bin/bash', inherited: false }))
      .toBe('bash:/opt/homebrew/bin/bash')
  })
})

describe('cell identity', () => {
  it('does not change when the session shell changes', () => {
    const a = parseRunbook('```shell run\necho hi\n```\n').cells[0]!
    expect(a.id).toMatch(/^shell-/)
  })
})
