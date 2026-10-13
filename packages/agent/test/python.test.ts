import os from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { which } from '../src/kernels/detect.js'
import { PythonSession } from '../src/kernels/python.js'
import type { ExecSink } from '../src/kernels/types.js'

const python = which('python3')
const describePython = python ? describe : describe.skip

function collector(): ExecSink & { out: string; err: string } {
  const sink = {
    out: '',
    err: '',
    chunk(stream: 'stdout' | 'stderr', data: string) {
      if (stream === 'stdout') sink.out += data
      else sink.err += data
    },
  }
  return sink
}

describePython('PythonSession', () => {
  let session: PythonSession | null = null

  afterEach(() => {
    session?.dispose()
    session = null
  })

  const open = (): PythonSession => {
    session = new PythonSession(python!, { cwd: os.tmpdir() })
    return session
  }

  it('keeps the interpreter state across cells', async () => {
    const s = open()
    expect((await s.exec({ source: 'value = 6 * 7' }, collector())).status).toBe('ok')
    const sink = collector()
    await s.exec({ source: 'print(value)' }, sink)
    expect(sink.out).toBe('42\n')
  })

  it('displays the value of a trailing expression, and nothing for None', async () => {
    const s = open()
    const sink = collector()
    await s.exec({ source: '1 + 1' }, sink)
    expect(sink.out).toBe('2\n')

    const quiet = collector()
    await s.exec({ source: 'x = None\nx' }, quiet)
    expect(quiet.out).toBe('')
  })

  it('reports a traceback as a failure without killing the session', async () => {
    const s = open()
    const sink = collector()
    const outcome = await s.exec({ source: 'raise ValueError("nope")' }, sink)
    expect(outcome.status).toBe('failed')
    expect(outcome.exit).toBe(1)
    expect(sink.err).toContain('ValueError: nope')

    const after = collector()
    expect((await s.exec({ source: 'print("still here")' }, after)).status).toBe('ok')
    expect(after.out).toBe('still here\n')
  })
})
