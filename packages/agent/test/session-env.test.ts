import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { ShellSession } from '../src/kernels/shell.js'

const BASH = ['/bin/bash', '/usr/bin/bash', '/opt/homebrew/bin/bash'].find((p) => existsSync(p)) ?? '/bin/sh'

const collect = () => {
  const out: string[] = []
  return { sink: { chunk: (_s: 'stdout' | 'stderr', d: string) => out.push(d) }, text: () => out.join('') }
}

describe('injected session variables', () => {
  it('reach the cell', async () => {
    const s = new ShellSession('bash', BASH, { cwd: process.cwd() })
    try {
      const c = collect()
      await s.exec({ source: 'echo "[$TOKEN]"', env: { TOKEN: 'abc123' } }, c.sink)
      expect(c.text()).toContain('[abc123]')
    } finally {
      s.dispose()
    }
  })

  it('stop reaching the next cell once dropped', async () => {
    const s = new ShellSession('bash', BASH, { cwd: process.cwd() })
    try {
      await s.exec({ source: ':', env: { TOKEN: 'abc123' } }, collect().sink)
      const c = collect()
      await s.exec({ source: 'echo "[$TOKEN]"', env: {} }, c.sink)
      expect(c.text()).toContain('[]')
    } finally {
      s.dispose()
    }
  })

  // The promise the UI makes is that closing the tab forgets them. The shell
  // survives the tab, so the agent has to do the forgetting.
  it('are forgotten when the browser session ends', async () => {
    const s = new ShellSession('bash', BASH, { cwd: process.cwd() })
    try {
      await s.exec({ source: ':', env: { TOKEN: 'abc123' } }, collect().sink)
      s.clearInjectedEnv()
      const c = collect()
      await s.exec({ source: 'echo "[$TOKEN]"' }, c.sink)
      expect(c.text()).toContain('[]')
    } finally {
      s.dispose()
    }
  })

  it('leaves what the operator exported alone', async () => {
    const s = new ShellSession('bash', BASH, { cwd: process.cwd() })
    try {
      await s.exec({ source: 'export MINE=kept', env: { TOKEN: 'abc123' } }, collect().sink)
      s.clearInjectedEnv()
      const c = collect()
      await s.exec({ source: 'echo "[$MINE][$TOKEN]"' }, c.sink)
      expect(c.text()).toContain('[kept][]')
    } finally {
      s.dispose()
    }
  })
})
