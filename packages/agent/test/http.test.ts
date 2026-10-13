import { describe, expect, it } from 'vitest'
import { parseHttpRequest } from '../src/kernels/http.js'

describe('parseHttpRequest', () => {
  it('parses a method, a URL, headers and a body', () => {
    const spec = parseHttpRequest(
      [
        'POST https://api.example.com/v1/things',
        'Authorization: Bearer abc123',
        'Content-Type: application/json',
        '',
        '{"name": "thing"}',
      ].join('\n'),
    )
    expect(spec.method).toBe('POST')
    expect(spec.url).toBe('https://api.example.com/v1/things')
    expect(spec.headers).toEqual([
      ['Authorization', 'Bearer abc123'],
      ['Content-Type', 'application/json'],
    ])
    expect(spec.body).toBe('{"name": "thing"}')
  })

  it('defaults to GET and tolerates leading blank lines', () => {
    const spec = parseHttpRequest('\n\nhttps://example.com/healthz\n')
    expect(spec.method).toBe('GET')
    expect(spec.url).toBe('https://example.com/healthz')
    expect(spec.headers).toEqual([])
    expect(spec.body).toBeUndefined()
  })

  it('keeps a URL containing a space-separated word out of the method slot', () => {
    const spec = parseHttpRequest('GET https://example.com/a?q=1')
    expect(spec.method).toBe('GET')
    expect(spec.url).toBe('https://example.com/a?q=1')
  })

  it('keeps a multi-line body intact', () => {
    const spec = parseHttpRequest('PUT https://example.com/x\n\nline1\nline2\n')
    expect(spec.body).toBe('line1\nline2')
  })

  it('rejects an empty cell and a malformed header', () => {
    expect(() => parseHttpRequest('   \n')).toThrow(/empty/)
    expect(() => parseHttpRequest('GET https://e.com\nnot-a-header\n')).toThrow(/invalid header/)
  })
})
