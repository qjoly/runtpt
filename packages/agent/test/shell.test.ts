import os from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { which } from '../src/kernels/detect.js'
import { ShellSession } from '../src/kernels/shell.js'
import type { ExecOutcome, ExecSink } from '../src/kernels/types.js'

const bash = which('bash')
const describeShell = bash ? describe : describe.skip

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

describeShell('ShellSession', () => {
  let session: ShellSession | null = null

  afterEach(() => {
    session?.dispose()
    session = null
  })

  const open = (): ShellSession => {
    session = new ShellSession('bash', bash!, { cwd: os.tmpdir() })
    return session
  }

  it('keeps exported variables and the working directory across cells', async () => {
    const s = open()
    await s.start()

    const first = collector()
    const a: ExecOutcome = await s.exec({ source: 'export RUNTPT_MARK=42\ncd /\n' }, first)
    expect(a.status).toBe('ok')
    expect(a.exit).toBe(0)

    const second = collector()
    const b = await s.exec({ source: 'echo "$RUNTPT_MARK at $PWD"' }, second)
    expect(b.status).toBe('ok')
    expect(second.out).toBe('42 at /\n')
  })

  it('reports a non-zero exit code', async () => {
    const s = open()
    const sink = collector()
    const outcome = await s.exec({ source: 'echo boom >&2\nfalse' }, sink)
    expect(outcome.status).toBe('failed')
    expect(outcome.exit).toBe(1)
    expect(sink.err).toBe('boom\n')
  })

  it('reports the exit code of a cell that exits the shell', async () => {
    const s = open()
    const outcome = await s.exec({ source: 'exit 7' }, collector())
    expect(outcome.exit).toBe(7)
    expect(outcome.status).toBe('failed')

    // The session comes back for the next cell, state lost but usable.
    const sink = collector()
    expect((await s.exec({ source: 'echo back' }, sink)).status).toBe('ok')
    expect(sink.out).toBe('back\n')
  })

  it('is not fooled by output that looks like the sentinel', async () => {
    const s = open()
    const sink = collector()
    const outcome = await s.exec(
      { source: `printf '__RUNTPT_END__deadbeef 0\\n'\nprintf '\\n__RUNTPT_END__ 99\\n'\nexit 5` },
      sink,
    )
    expect(outcome.exit).toBe(5)
    expect(sink.out).toBe('__RUNTPT_END__deadbeef 0\n\n__RUNTPT_END__ 99\n')
  })

  it('preserves output written without a trailing newline', async () => {
    const s = open()
    const sink = collector()
    await s.exec({ source: `printf 'no newline'` }, sink)
    expect(sink.out).toBe('no newline')
  })

  it('honours a per-cell timeout', async () => {
    const s = open()
    const outcome = await s.exec({ source: 'sleep 30', timeoutMs: 300 }, collector())
    expect(outcome.status).toBe('timeout')
  }, 15000)

  it('cancels a running cell and keeps the session usable', async () => {
    const s = open()
    const sink = collector()
    const running = s.exec({ source: 'echo started\nsleep 30' }, sink)
    await new Promise((r) => setTimeout(r, 300))
    s.cancel()
    expect((await running).status).toBe('cancelled')
    expect(sink.out).toContain('started')

    const after = collector()
    expect((await s.exec({ source: 'echo alive' }, after)).status).toBe('ok')
    expect(after.out).toBe('alive\n')
  }, 15000)

  it('runs a cell in a per-cell directory without moving the session', async () => {
    const s = open()
    await s.exec({ source: 'cd /' }, collector())
    const sink = collector()
    await s.exec({ source: 'pwd', cwd: os.tmpdir() }, sink)
    expect(sink.out.trim()).toBe(os.tmpdir())
    const after = collector()
    await s.exec({ source: 'pwd' }, after)
    expect(after.out.trim()).toBe('/')
  })
})

// `sh` is dash on most Linux distributions, so the sentinel protocol has to
// hold without any bashism.
for (const dialect of ['sh', 'zsh'] as const) {
  const bin = which(dialect)
  const describeDialect = bin ? describe : describe.skip

  describeDialect(`ShellSession (${dialect})`, () => {
    let session: ShellSession | null = null

    afterEach(() => {
      session?.dispose()
      session = null
    })

    const open = (): ShellSession => {
      session = new ShellSession(dialect, bin!, { cwd: os.tmpdir() })
      return session
    }

    it('keeps state across cells and reports exit codes', async () => {
      const s = open()
      await s.start()

      const first = collector()
      expect((await s.exec({ source: 'RUNTPT_MARK=7\nexport RUNTPT_MARK\ncd /' }, first)).status).toBe('ok')

      const second = collector()
      await s.exec({ source: 'echo "$RUNTPT_MARK at $PWD"' }, second)
      expect(second.out).toBe('7 at /\n')

      const third = collector()
      const failed = await s.exec({ source: 'echo nope >&2\nfalse' }, third)
      expect(failed.status).toBe('failed')
      expect(failed.exit).toBe(1)
      expect(third.err).toContain('nope')
    })

    it('spawns the interpreter it was handed', async () => {
      const s = open()
      const sink = collector()
      await s.exec({ source: 'echo "$0"' }, sink)
      expect(sink.out).toContain(bin!)
    })

    it('runs a cell in a per-cell directory without moving the session', async () => {
      const s = open()
      await s.exec({ source: 'cd /' }, collector())
      const sink = collector()
      await s.exec({ source: 'pwd', cwd: os.tmpdir() }, sink)
      expect(sink.out).toContain(os.tmpdir())
      const after = collector()
      await s.exec({ source: 'pwd' }, after)
      expect(after.out.trim()).toBe('/')
    })
  })
}
