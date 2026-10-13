import { describe, expect, it } from 'vitest'
import { parseRunbook, type Diagnostic } from '../src/index.js'

describe('frontmatter', () => {
  it('reads runtpt settings and params', () => {
    const rb = parseRunbook(`---
title: Rotate certs
runtpt:
  shell: zsh
  env:
    KUBECONFIG: /tmp/kc
  params:
    - name: CLUSTER
      default: staging
    - name: TOKEN
      secret: true
  presentation:
    slides: h2
    theme: dark
---

Body.
`)
    expect(rb.title).toBe('Rotate certs')
    expect(rb.settings.shell).toEqual({ kernel: 'zsh' })
    expect(rb.settings.env.KUBECONFIG).toBe('/tmp/kc')
    expect(rb.settings.presentation).toEqual({ slides: 'h2', theme: 'dark' })
    expect(rb.settings.params).toEqual([
      { name: 'CLUSTER', secret: false, required: false, default: 'staging' },
      { name: 'TOKEN', secret: true, required: true },
    ])
  })

  it('falls back to the first h1 when no title is declared', () => {
    expect(parseRunbook('# Hello\n\ntext').title).toBe('Hello')
  })

  it('reports invalid yaml without throwing', () => {
    const rb = parseRunbook('---\n: : :\n---\n\nbody')
    expect(rb.diagnostics.some((d) => d.level === 'error')).toBe(true)
    expect(rb.blocks.length).toBeGreaterThan(0)
  })

  it('treats an unclosed frontmatter as prose', () => {
    const rb = parseRunbook('---\ntitle: x\n\nbody')
    expect(rb.frontmatter).toBeNull()
    expect(rb.diagnostics.some((d) => /never closed/.test(d.message))).toBe(true)
  })
})

describe('cell detection', () => {
  it('leaves a bare fence inert', () => {
    const rb = parseRunbook('```bash\necho hi\n```\n')
    expect(rb.cells).toHaveLength(0)
    expect(rb.blocks[0]).toMatchObject({ kind: 'prose' })
    expect((rb.blocks[0] as { markdown: string }).markdown).toContain('echo hi')
  })

  it('activates a fence carrying the run flag', () => {
    const rb = parseRunbook('```bash run\necho hi\n```\n')
    expect(rb.cells).toHaveLength(1)
    expect(rb.cells[0]!.kernel).toBe('bash')
    expect(rb.cells[0]!.source).toBe('echo hi')
  })

  it('activates a fence carrying any runtpt attribute', () => {
    const rb = parseRunbook('```bash id=a\necho hi\n```\n')
    expect(rb.cells).toHaveLength(1)
    expect(rb.cells[0]!.id).toBe('a')
  })

  it('ignores a non-kernel language even with attributes', () => {
    const rb = parseRunbook('```rust run\nfn main() {}\n```\n')
    expect(rb.cells).toHaveLength(0)
  })

  it('handles tilde fences and indented fences', () => {
    const rb = parseRunbook('  ~~~bash run\n  echo hi\n  ~~~\n')
    expect(rb.cells).toHaveLength(1)
    expect(rb.cells[0]!.source).toBe('echo hi')
  })

  it('does not treat a longer inner fence as a close', () => {
    const rb = parseRunbook('```bash run\ncat <<EOF\n``\nEOF\n```\n')
    expect(rb.cells).toHaveLength(1)
    expect(rb.cells[0]!.source).toContain('``')
  })

  it('keeps an unclosed fence as prose and warns', () => {
    const rb = parseRunbook('```bash run\necho hi\n')
    expect(rb.cells).toHaveLength(0)
    expect(rb.diagnostics.some((d) => /Unclosed fence/.test(d.message))).toBe(true)
  })
})

describe('cell identity', () => {
  it('derives a stable id from the content hash', () => {
    const a = parseRunbook('```bash run\necho hi\n```\n').cells[0]!
    const b = parseRunbook('```bash run\necho hi\n```\n').cells[0]!
    expect(a.id).toBe(b.id)
    expect(a.explicitId).toBe(false)
    expect(a.id).toMatch(/^bash-[0-9a-f]{6}$/)
  })

  it('changes the derived id when the source changes', () => {
    const a = parseRunbook('```bash run\necho hi\n```\n').cells[0]!
    const b = parseRunbook('```bash run\necho ho\n```\n').cells[0]!
    expect(a.id).not.toBe(b.id)
  })

  it('disambiguates two identical cells', () => {
    const rb = parseRunbook('```bash run\necho hi\n```\n\ntext\n\n```bash run\necho hi\n```\n')
    expect(rb.cells[0]!.id).not.toBe(rb.cells[1]!.id)
  })

  it('reports a duplicate explicit id instead of silently merging', () => {
    const rb = parseRunbook('```bash id=a\n1\n```\n\n```bash id=a\n2\n```\n')
    expect(rb.diagnostics.some((d) => /Duplicate cell id/.test(d.message))).toBe(true)
    expect(rb.cells[1]!.id).toBe('a-2')
  })
})

describe('attributes', () => {
  it('parses the full attribute set', () => {
    const rb = parseRunbook(
      '```bash run id=x name="check the nodes" timeout=90s depends=a,b continue-on-error confirm hidden cwd=./infra output=json interactive\n:\n```\n',
    )
    expect(rb.cells[0]!.attrs).toMatchObject({
      run: true,
      id: 'x',
      name: 'check the nodes',
      timeoutMs: 90_000,
      depends: ['a', 'b'],
      continueOnError: true,
      confirm: true,
      hidden: true,
      cwd: './infra',
      output: 'json',
      interactive: true,
    })
  })

  it('warns on an unknown attribute but keeps it', () => {
    const d: Diagnostic[] = []
    const rb = parseRunbook('```bash run wat=1\n:\n```\n', d)
    expect(rb.cells[0]!.attrs.unknown).toEqual({ wat: '1' })
    expect(d.some((x) => /Unknown cell attribute/.test(x.message))).toBe(true)
  })

  it('warns on an unresolvable dependency', () => {
    const rb = parseRunbook('```bash id=a depends=nope\n:\n```\n')
    expect(rb.diagnostics.some((d) => /unknown cell "nope"/.test(d.message))).toBe(true)
  })
})

describe('notes and directives', () => {
  it('extracts single-line and multi-line speaker notes', () => {
    const rb = parseRunbook('text\n\n<!-- notes: one -->\n\n<!-- notes:\ntwo\nlines\n-->\n\nmore\n')
    const notes = rb.blocks.filter((b) => b.kind === 'notes')
    expect(notes).toHaveLength(2)
    expect((notes[0] as { text: string }).text).toBe('one')
    expect((notes[1] as { text: string }).text).toBe('two\nlines')
  })

  it('extracts runtpt directives', () => {
    const rb = parseRunbook('a\n\n<!-- runtpt:pause -->\n\n<!-- runtpt:checkpoint before-restart -->\n')
    const directives = rb.blocks.filter((b) => b.kind === 'directive')
    expect(directives).toMatchObject([{ name: 'pause' }, { name: 'checkpoint', arg: 'before-restart' }])
  })
})
