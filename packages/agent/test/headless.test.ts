import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readRuntpt } from '@runtpt/format'
import { describe, expect, it } from 'vitest'
import { HeadlessError, runHeadless } from '../src/headless.js'
import { which } from '../src/kernels/detect.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const fixture = path.join(here, 'fixtures', 'headless.md')
const repoRoot = path.resolve(here, '..', '..', '..')
const describeShell = which('bash') ? describe : describe.skip

function outFile(): string {
  return path.join(mkdtempSync(path.join(os.tmpdir(), 'runtpt-out-')), 'run.runtpt')
}

describeShell('runHeadless', () => {
  it('records statuses, skips dependents of a failed cell, and redacts secrets', async () => {
    const out = outFile()
    const result = await runHeadless({ runbookPath: fixture, out, log: () => {} })

    const recording = readRuntpt(readFileSync(out, 'utf8'))
    expect(recording.truncated).toBe(false)
    expect(recording.interrupted).toBe(false)
    expect(recording.header?.runbook.path).toContain('headless.md')

    const status = (id: string): string | undefined => recording.byId.get(id)?.status
    expect(status('greet')).toBe('ok')
    expect(status('leaky')).toBe('ok')
    expect(status('boom')).toBe('failed')
    expect(recording.byId.get('boom')?.exit).toBe(4)
    expect(status('orphan')).toBe('skipped')
    expect(status('needs-approval')).toBe('skipped')
    expect(status('last')).toBe('ok')

    const greeting = recording.byId.get('greet')?.outputs.map((o) => o.data).join('')
    expect(greeting).toBe('hello from a cell\n')

    // The failure is recorded but covered by continue-on-error (FR-D6).
    expect(result.exitCode).toBe(0)
    expect(result.summary.tolerated).toBe(1)
    expect(result.summary.skipped).toBe(2)

    const raw = readFileSync(out, 'utf8')
    expect(raw).not.toContain('super-secret-value')
    expect(raw).toContain('«redacted:TOKEN»')
    // The secret stays visible as a name, redacted as a value: a reader should know
    // the run was parameterised without learning what with.
    expect(recording.header?.run.params).toEqual({ GREETING: 'hello', TOKEN: '«redacted:TOKEN»' })

    const skipNote = recording.notes.find((n) => n.after === 'orphan')
    expect(skipNote?.text).toMatch(/dependency "boom" failed/)
    expect(recording.notes.find((n) => n.after === 'needs-approval')?.text).toMatch(/confirm/)
  })

  it('runs confirm cells when the operator opts in', async () => {
    const out = outFile()
    const result = await runHeadless({ runbookPath: fixture, out, yes: true, log: () => {} })
    const recording = readRuntpt(readFileSync(out, 'utf8'))
    expect(recording.byId.get('needs-approval')?.status).toBe('ok')
    expect(result.exitCode).toBe(0)
  })

  it('substitutes parameters passed on the command line', async () => {
    const out = outFile()
    await runHeadless({ runbookPath: fixture, out, params: { GREETING: 'bonjour' }, log: () => {} })
    const recording = readRuntpt(readFileSync(out, 'utf8'))
    expect(recording.byId.get('greet')?.source).toBe('echo "bonjour from a cell"')
  })

  it('exits non-zero when a cell fails without continue-on-error', async () => {
    const out = outFile()
    const result = await runHeadless({
      runbookPath: path.join(here, 'fixtures', 'failing.md'),
      out,
      log: () => {},
    })
    expect(result.exitCode).toBe(1)
    const recording = readRuntpt(readFileSync(out, 'utf8'))
    expect(recording.byId.get('bad')?.status).toBe('failed')
    expect(recording.byId.get('after')?.status).toBe('skipped')
    expect(recording.footer?.status).toBe('failed')
  })

  it('refuses to start when a required parameter is missing', async () => {
    const out = outFile()
    await expect(
      runHeadless({ runbookPath: path.join(here, 'fixtures', 'needs-param.md'), out, log: () => {} }),
    ).rejects.toMatchObject({ exitCode: 2 })
  })

  it('reports a missing runbook with exit code 2', async () => {
    await expect(runHeadless({ runbookPath: '/nope/nothing.md', log: () => {} })).rejects.toBeInstanceOf(
      HeadlessError,
    )
  })

  it('passes the repository self-test', async () => {
    const out = outFile()
    const result = await runHeadless({
      runbookPath: path.join(repoRoot, 'examples', 'selftest.md'),
      out,
      log: () => {},
    })
    expect(result.exitCode).toBe(0)
    const recording = readRuntpt(readFileSync(out, 'utf8'))
    expect(recording.byId.get('read-state')?.status).toBe('ok')
    expect(recording.byId.get('expected-failure')?.exit).toBe(3)
    expect(recording.byId.get('never-runs')?.status).toBe('skipped')
    expect(recording.byId.get('never-runs')?.outputs).toEqual([])
    // stdout and stderr are independent pipes: their relative arrival order is not
    // guaranteed and asserting it made this test flake under load. What the agent
    // does promise is that each stream is captured, whole and unmixed.
    const outputs = recording.byId.get('streams')?.outputs ?? []
    const textOf = (stream: 'stdout' | 'stderr'): string =>
      outputs.filter((o) => o.stream === stream).map((o) => o.data).join('')
    expect(textOf('stdout')).toBe('to stdout\n')
    expect(textOf('stderr')).toBe('to stderr\n')
    expect(recording.byId.get('alias-check')?.status).toBe('ok')
    expect(recording.byId.get('alias-state')?.kernel).toBe('bash')
  })
})

describe('a runbook with nothing to run', () => {
  const write = (name: string, body: string): string => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'runtpt-inert-'))
    const file = path.join(dir, name)
    writeFileSync(file, body)
    return file
  }

  // "0 ok, 0 failed" with exit 0 reads like the procedure went fine.
  it('fails loudly and names the fix when fences were left inert', async () => {
    const file = write('inert.md', '# Procedure\n\n```bash\necho hi\n```\n\n```bash\necho ho\n```\n')
    await expect(runHeadless({ runbookPath: file, log: () => {} })).rejects.toMatchObject({
      exitCode: 2,
      message: expect.stringContaining('2 fences of a known kernel'),
    })
  })

  it('points at the frontmatter opt-in', async () => {
    const file = write('inert2.md', '```bash\n:\n```\n')
    await expect(runHeadless({ runbookPath: file, log: () => {} })).rejects.toMatchObject({
      message: expect.stringContaining('cells: all'),
    })
  })

  it('still fails when there is nothing resembling a cell', async () => {
    const file = write('prose.md', '# Just prose\n\nNothing to run here.\n')
    await expect(runHeadless({ runbookPath: file, log: () => {} })).rejects.toMatchObject({
      exitCode: 2,
      message: expect.stringContaining('no executable cells'),
    })
  })
})
