import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { AGENT_VERSION } from '../src/server.js'

describe('AGENT_VERSION', () => {
  // It is stamped into every .runtpt header, so a stale constant makes every
  // recording claim the wrong agent. The constant is hand-written; this is the
  // thing that stops it drifting from the package it ships as.
  it('matches the package version', () => {
    const pkg = JSON.parse(
      readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
    ) as { version: string }
    expect(AGENT_VERSION).toBe(pkg.version)
  })
})
