import { describe, expect, it } from 'vitest'
import { parseRunbook } from '../src/index.js'

const DOC = `---
title: A procedure
runtpt:
  cells: all
---

- [ ] Scale the workloads down

  \`\`\`bash
  kubectl scale sts mssql --replicas=0
  \`\`\`

Illustrative, not a command:

\`\`\`yaml
apiVersion: v1
kind: Instance
\`\`\`

\`\`\`diff
-  mode: "continuous"
+  mode: "oneshot"
\`\`\`

\`\`\`python
print("still a kernel")
\`\`\`
`

describe('cells: all', () => {
  it('makes a bare fence of a known kernel executable', () => {
    const rb = parseRunbook(DOC)
    expect(rb.cells.map((c) => c.kernel)).toEqual(['bash', 'python'])
  })

  it('leaves non-kernel fences alone, whatever the mode', () => {
    const rb = parseRunbook(DOC)
    const prose = rb.blocks.filter((b) => b.kind === 'prose').map((b) => (b as { markdown: string }).markdown).join('\n')
    expect(prose).toContain('apiVersion: v1')
    expect(prose).toContain('mode: "oneshot"')
  })

  it('keeps a fence indented inside a list item', () => {
    const rb = parseRunbook(DOC)
    expect(rb.cells[0]!.source).toBe('kubectl scale sts mssql --replicas=0')
  })

  it('is the default, so a runbook written as plain markdown just runs', () => {
    const rb = parseRunbook(DOC.replace('  cells: all\n', ''))
    expect(rb.settings.cells).toBe('all')
    expect(rb.cells.map((c) => c.kernel)).toEqual(['bash', 'python'])
  })

  it('can be opted out of, for a document that merely contains commands', () => {
    const rb = parseRunbook(DOC.replace('cells: all', 'cells: tagged'))
    expect(rb.cells).toHaveLength(0)
    expect(rb.inertFences).toHaveLength(2)
  })

  it('still arms a tagged fence in tagged mode', () => {
    const rb = parseRunbook('---\nruntpt:\n  cells: tagged\n---\n\n```bash run\n:\n```\n\n```bash\n:\n```\n')
    expect(rb.cells).toHaveLength(1)
    expect(rb.inertFences).toHaveLength(1)
  })

  it('still honours per-cell attributes in all mode', () => {
    const rb = parseRunbook('---\nruntpt:\n  cells: all\n---\n\n```bash id=named timeout=5s\n:\n```\n')
    expect(rb.cells[0]!.id).toBe('named')
    expect(rb.cells[0]!.attrs.timeoutMs).toBe(5000)
  })

  it('warns on an unknown mode and keeps the default', () => {
    const rb = parseRunbook('---\nruntpt:\n  cells: everything\n---\n\n```bash\n:\n```\n')
    expect(rb.settings.cells).toBe('all')
    expect(rb.diagnostics.some((d) => /Unknown cells mode/.test(d.message))).toBe(true)
  })
})

describe('inertFences', () => {
  const TAGGED = '---\nruntpt:\n  cells: tagged\n---\n\n'

  it('counts the fences a tagged document left behind', () => {
    const rb = parseRunbook(TAGGED + '```bash\n:\n```\n\n```yaml\na: 1\n```\n\n```python\npass\n```\n')
    expect(rb.cells).toHaveLength(0)
    expect(rb.inertFences.map((f) => f.kernel)).toEqual(['bash', 'python'])
  })

  it('is empty under the default, where nothing is left behind', () => {
    expect(parseRunbook('```bash\n:\n```\n').inertFences).toHaveLength(0)
  })

  it('does not count a fence that is not a kernel', () => {
    expect(parseRunbook(TAGGED + '```json\n{}\n```\n').inertFences).toHaveLength(0)
  })

  it('reports where each one is', () => {
    const rb = parseRunbook(TAGGED + 'intro\n\n```bash\n:\n```\n')
    expect(rb.inertFences[0]!.line).toBe(8)
  })
})

describe('declaresRuntpt', () => {
  it('is false for documentation that merely contains commands', () => {
    expect(parseRunbook('# Install\n\n```bash\nbrew install thing\n```\n').declaresRuntpt).toBe(false)
  })

  it('is true when the frontmatter carries a runtpt block', () => {
    expect(parseRunbook('---\nruntpt:\n  shell: zsh\n---\n\ntext\n').declaresRuntpt).toBe(true)
  })

  it('is true when any fence carries an attribute', () => {
    expect(parseRunbook('```bash run\n:\n```\n').declaresRuntpt).toBe(true)
    expect(parseRunbook('```bash id=x\n:\n```\n').declaresRuntpt).toBe(true)
  })

  it('ignores an attribute on a fence that is not a kernel', () => {
    expect(parseRunbook('```json run\n{}\n```\n').declaresRuntpt).toBe(false)
  })

  it('is not fooled by a frontmatter without a runtpt block', () => {
    expect(parseRunbook('---\ntitle: Notes\n---\n\n```bash\n:\n```\n').declaresRuntpt).toBe(false)
  })
})
