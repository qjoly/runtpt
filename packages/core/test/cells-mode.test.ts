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

  it('defaults to tagged, so an unannotated document stays inert', () => {
    const rb = parseRunbook(DOC.replace('  cells: all\n', ''))
    expect(rb.cells).toHaveLength(0)
  })

  it('still honours per-cell attributes in all mode', () => {
    const rb = parseRunbook('---\nruntpt:\n  cells: all\n---\n\n```bash id=named timeout=5s\n:\n```\n')
    expect(rb.cells[0]!.id).toBe('named')
    expect(rb.cells[0]!.attrs.timeoutMs).toBe(5000)
  })

  it('warns on an unknown mode rather than silently arming every fence', () => {
    const rb = parseRunbook('---\nruntpt:\n  cells: everything\n---\n\n```bash\n:\n```\n')
    expect(rb.settings.cells).toBe('tagged')
    expect(rb.cells).toHaveLength(0)
    expect(rb.diagnostics.some((d) => /Unknown cells mode/.test(d.message))).toBe(true)
  })
})
