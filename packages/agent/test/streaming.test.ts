import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SentinelStream, markerFor } from '../src/kernels/sentinel.js'
import { ShellSession } from '../src/kernels/shell.js'

const NONCE = 'deadbeefdeadbeefdeadbeef'
const BASH = ['/bin/bash', '/usr/bin/bash'].find((p) => existsSync(p)) ?? '/bin/sh'

describe('SentinelStream', () => {
  const collect = () => {
    const seen: string[] = []
    const marker = markerFor(NONCE)
    const stream = new SentinelStream(marker, (d) => seen.push(d), () => seen.push('<end>'))
    return { marker, seen, stream }
  }

  // It used to hold back a fixed tail larger than this whole output, so a
  // command printing a few short lines streamed nothing at all until it exited.
  it('emits a short line before the sentinel ever arrives', () => {
    const { seen, stream } = collect()
    stream.push('step 1\n')
    expect(seen.join('')).toBe('step 1')
  })

  it('keeps streaming line by line', () => {
    const { seen, stream } = collect()
    stream.push('a\n')
    stream.push('b\n')
    stream.push('c\n')
    expect(seen.join('')).toBe('a\nb\nc')
  })

  it('loses nothing once the sentinel closes the exec', () => {
    const { marker, seen, stream } = collect()
    stream.push('a\nb\n')
    stream.push(`${marker}7\n`)
    expect(seen.filter((s) => s !== '<end>').join('')).toBe('a\nb\n')
  })

  it('does not emit a sentinel split across two reads', () => {
    const { marker, seen, stream } = collect()
    const half = Math.floor(marker.length / 2)
    stream.push('out' + marker.slice(0, half))
    expect(seen.join('')).toBe('out')
    stream.push(marker.slice(half) + '0\n')
    expect(seen.filter((s) => s !== '<end>').join('')).toBe('out')
  })

  it('holds back only what could still become a sentinel', () => {
    const { seen, stream } = collect()
    stream.push('plain text with no newline at all')
    expect(seen.join('')).toBe('plain text with no newline at all')
  })
})

describe('a long-running cell', () => {
  it('streams output while it is still running', async () => {
    const session = new ShellSession('bash', BASH, { cwd: process.cwd() })
    const times: number[] = []
    const started = Date.now()
    try {
      await session.exec(
        { source: 'for i in 1 2 3; do echo "tick $i"; sleep 0.4; done' },
        { chunk: () => times.push(Date.now() - started) },
      )
    } finally {
      session.dispose()
    }

    expect(times.length).toBeGreaterThan(1)
    // The first chunk must land long before the command is done, which is the
    // whole promise: a working command is distinguishable from a hung one.
    expect(times[0]!).toBeLessThan(300)
  })
})
