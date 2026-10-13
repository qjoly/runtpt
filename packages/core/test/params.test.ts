import { describe, expect, it } from 'vitest'
import { parseRunbook, placeholdersIn, resolveParams, substitute, undeclaredParams } from '../src/index.js'

describe('resolveParams', () => {
  const specs = [
    { name: 'CLUSTER', secret: false, required: false, default: 'staging' },
    { name: 'TOKEN', secret: true, required: true },
  ]

  it('applies defaults and tracks secrets', () => {
    const r = resolveParams(specs, { TOKEN: 's3cret' })
    expect(r.values).toEqual({ CLUSTER: 'staging', TOKEN: 's3cret' })
    expect(r.secrets).toEqual(['TOKEN'])
    expect(r.missing).toEqual([])
  })

  it('reports a missing required param', () => {
    expect(resolveParams(specs, {}).missing).toEqual(['TOKEN'])
  })

  it('treats an empty string as not provided', () => {
    expect(resolveParams(specs, { CLUSTER: '' }).values.CLUSTER).toBe('staging')
  })

  it('lets an undeclared value through', () => {
    expect(resolveParams(specs, { TOKEN: 'x1234', EXTRA: 'y' }).values.EXTRA).toBe('y')
  })
})

describe('substitute', () => {
  it('replaces placeholders with and without inner spaces', () => {
    expect(substitute('a {{X}} b {{ X }}', { X: '1' })).toBe('a 1 b 1')
  })

  it('leaves an unknown placeholder alone and warns', () => {
    const d: { message: string }[] = []
    expect(substitute('{{ NOPE }}', {}, d as never)).toBe('{{ NOPE }}')
    expect(d).toHaveLength(1)
  })

  it('does not recurse into a substituted value', () => {
    expect(substitute('{{ A }}', { A: '{{ B }}', B: 'boom' })).toBe('{{ B }}')
  })
})

describe('undeclaredParams', () => {
  it('finds placeholders used by cells but never declared', () => {
    const rb = parseRunbook('```bash run\ncurl {{ HOST }}/{{ PATHNAME }}\n```\n')
    expect(undeclaredParams(rb).sort()).toEqual(['HOST', 'PATHNAME'])
  })
})

describe('placeholdersIn', () => {
  it('deduplicates', () => {
    expect(placeholdersIn('{{A}} {{A}} {{B}}')).toEqual(['A', 'B'])
  })
})
