import { describe, expect, it } from 'vitest'
import { Redactor, RuntptWriter, readRuntpt, runtptPathFor, type HostRef } from '../src/index.js'

const host: HostRef = { name: 'test', os: 'linux', arch: 'x64', agent: 'runtpt-agent/test', cwd: '/tmp' }

function writer(extra: Partial<ConstructorParameters<typeof RuntptWriter>[0]> = {}) {
  const lines: string[] = []
  const w = new RuntptWriter({
    runbook: { path: 'r.md', sha: 'abc' },
    host,
    runId: 'run-1',
    sink: (line) => lines.push(line),
    ...extra,
  })
  return { w, lines, text: () => lines.join('\n') + '\n' }
}

describe('round trip', () => {
  it('rebuilds a complete run', () => {
    const { w, text } = writer({ params: { CLUSTER: 'staging' } })
    w.header()
    w.cell({ id: 'a', hash: 'sha256:1', kernel: 'bash', source: 'echo hi' })
    w.out({ id: 'a', stream: 'stdout', data: 'hi\n' })
    w.result({ id: 'a', status: 'ok', exit: 0, durationMs: 12 })
    w.note('looked fine', 'a')
    w.footer()

    const rec = readRuntpt(text())
    expect(rec.header?.run.params).toEqual({ CLUSTER: 'staging' })
    expect(rec.header?.runbook.sha).toBe('abc')
    expect(rec.cells).toHaveLength(1)
    expect(rec.cells[0]).toMatchObject({ id: 'a', status: 'ok', exit: 0, durationMs: 12 })
    expect(rec.cells[0]!.outputs[0]!.data).toBe('hi\n')
    expect(rec.notes[0]).toMatchObject({ text: 'looked fine', after: 'a' })
    expect(rec.interrupted).toBe(false)
  })

  it('derives the footer status from the cell outcomes', () => {
    const { w, text } = writer()
    w.header()
    w.cell({ id: 'a', hash: 'h', kernel: 'bash', source: ':' })
    w.result({ id: 'a', status: 'failed', exit: 1, durationMs: 1 })
    w.cell({ id: 'b', hash: 'h', kernel: 'bash', source: ':' })
    w.result({ id: 'b', status: 'skipped', exit: null, durationMs: 0 })
    w.footer()

    expect(readRuntpt(text()).footer).toMatchObject({
      status: 'failed',
      cells: { ok: 0, failed: 1, skipped: 1 },
    })
  })

  it('emits monotonically increasing sequence numbers', () => {
    const { w, lines } = writer()
    w.header()
    w.cell({ id: 'a', hash: 'h', kernel: 'bash', source: ':' })
    w.out({ id: 'a', stream: 'stdout', data: '1' })
    w.out({ id: 'a', stream: 'stderr', data: '2' })
    w.result({ id: 'a', status: 'ok', exit: 0, durationMs: 1 })

    const seqs = lines.map((l) => (JSON.parse(l) as { seq?: number }).seq).filter((s): s is number => s !== undefined)
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b))
    expect(new Set(seqs).size).toBe(seqs.length)
  })

  it('preserves stdout and stderr interleaving', () => {
    const { w, text } = writer()
    w.header()
    w.cell({ id: 'a', hash: 'h', kernel: 'bash', source: ':' })
    w.out({ id: 'a', stream: 'stdout', data: 'one' })
    w.out({ id: 'a', stream: 'stderr', data: 'boom' })
    w.out({ id: 'a', stream: 'stdout', data: 'two' })
    w.result({ id: 'a', status: 'ok', exit: 0, durationMs: 1 })

    expect(readRuntpt(text()).cells[0]!.outputs.map((o) => [o.stream, o.data])).toEqual([
      ['stdout', 'one'],
      ['stderr', 'boom'],
      ['stdout', 'two'],
    ])
  })
})

describe('resilience', () => {
  it('reads an interrupted run', () => {
    const { w, text } = writer()
    w.header()
    w.cell({ id: 'a', hash: 'h', kernel: 'bash', source: ':' })
    w.out({ id: 'a', stream: 'stdout', data: 'partial' })

    const rec = readRuntpt(text())
    expect(rec.interrupted).toBe(true)
    expect(rec.cells[0]!.status).toBe('running')
  })

  it('tolerates a truncated last line', () => {
    const { w, text } = writer()
    w.header()
    w.cell({ id: 'a', hash: 'h', kernel: 'bash', source: ':' })
    const rec = readRuntpt(text() + '{"t":"out","id":"a","dat')
    expect(rec.truncated).toBe(true)
    expect(rec.cells).toHaveLength(1)
  })

  it('keeps unknown record types instead of failing', () => {
    const rec = readRuntpt('{"t":"header","v":1}\n{"t":"fromTheFuture","x":1}\n')
    expect(rec.unknown).toHaveLength(1)
    expect(rec.header).not.toBeNull()
  })

  it('parks outputs for an unknown cell id rather than dropping them', () => {
    const rec = readRuntpt('{"t":"out","id":"ghost","seq":1,"stream":"stdout","at":"x","data":"y"}\n')
    expect(rec.unknown).toHaveLength(1)
  })

  it('ignores blank lines', () => {
    expect(readRuntpt('\n\n{"t":"header","v":1}\n\n').header).not.toBeNull()
  })
})

describe('redaction', () => {
  it('redacts secrets from sources, outputs and notes', () => {
    const redactor = new Redactor()
    redactor.add('TOKEN', 'hunter2000')
    const { w, text } = writer({ redactor })
    w.header()
    w.cell({ id: 'a', hash: 'h', kernel: 'bash', source: 'curl -H "auth: hunter2000"' })
    w.out({ id: 'a', stream: 'stdout', data: 'got hunter2000 back' })
    w.note('token was hunter2000')
    w.result({ id: 'a', status: 'ok', exit: 0, durationMs: 1 })

    const raw = text()
    expect(raw).not.toContain('hunter2000')
    expect(raw).toContain('«redacted:TOKEN»')
  })

  it('redacts the longest match first so secrets cannot shadow each other', () => {
    const r = new Redactor()
    r.add('SHORT', 'abcd')
    r.add('LONG', 'abcdefgh')
    expect(r.apply('abcdefgh')).toBe('«redacted:LONG»')
  })

  it('refuses values too short to be worth matching', () => {
    const r = new Redactor()
    r.add('X', 'ab')
    expect(r.apply('ab cd')).toBe('ab cd')
    expect(r.size).toBe(0)
  })
})

describe('oversized payloads', () => {
  it('truncates inline when no spill target is configured', () => {
    const { w, text } = writer({ maxInlineBytes: 32 })
    w.header()
    w.cell({ id: 'a', hash: 'h', kernel: 'bash', source: ':' })
    w.out({ id: 'a', stream: 'stdout', data: 'x'.repeat(500) })
    expect(readRuntpt(text()).cells[0]!.outputs[0]!.data).toContain('[truncated by runtpt]')
  })

  it('spills to a blob reference when it can', () => {
    const spilled: string[] = []
    const { w, text } = writer({
      maxInlineBytes: 32,
      spill: (data) => {
        spilled.push(data)
        return `blob:${spilled.length}`
      },
    })
    w.header()
    w.cell({ id: 'a', hash: 'h', kernel: 'bash', source: ':' })
    w.out({ id: 'a', stream: 'stdout', data: 'x'.repeat(500) })

    const out = readRuntpt(text()).cells[0]!.outputs[0]!
    expect(out.ref).toBe('blob:1')
    expect(out.data).toBe('')
    expect(spilled[0]).toHaveLength(500)
  })

  it('counts bytes, not characters, when deciding to truncate', () => {
    const { w, text } = writer({ maxInlineBytes: 16 })
    w.header()
    w.cell({ id: 'a', hash: 'h', kernel: 'bash', source: ':' })
    w.out({ id: 'a', stream: 'stdout', data: '☕️'.repeat(6) })
    expect(readRuntpt(text()).cells[0]!.outputs[0]!.data).toContain('[truncated by runtpt]')
  })
})

describe('runtptPathFor', () => {
  it('swaps the markdown extension', () => {
    expect(runtptPathFor('runbooks/incident.md')).toBe('runbooks/incident.runtpt')
    expect(runtptPathFor('a/b.markdown')).toBe('a/b.runtpt')
  })

  it('appends when there is no markdown extension', () => {
    expect(runtptPathFor('notes')).toBe('notes.runtpt')
  })
})
