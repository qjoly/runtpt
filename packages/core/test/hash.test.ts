import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { sha256 } from '../src/hash.js'

const reference = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')

describe('sha256', () => {
  it('matches node:crypto on the usual edge cases', () => {
    for (const input of ['', 'a', 'abc', 'echo hi', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'x'.repeat(1000)]) {
      expect(sha256(input), `input length ${input.length}`).toBe(reference(input))
    }
  })

  it('handles multi-byte characters', () => {
    const input = 'kubectl get pods — café ☕️ 日本語'
    expect(sha256(input)).toBe(reference(input))
  })
})
