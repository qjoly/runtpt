import { describe, expect, it } from 'vitest'
import { generatePairingCode, isOriginAllowed } from '../src/server.js'

describe('isOriginAllowed', () => {
  it('allows loopback on any port', () => {
    expect(isOriginAllowed('http://localhost:5173')).toBe(true)
    expect(isOriginAllowed('http://127.0.0.1:4000')).toBe(true)
    expect(isOriginAllowed('https://localhost')).toBe(true)
    expect(isOriginAllowed('http://[::1]:8080')).toBe(true)
  })

  it('refuses anything else unless explicitly allowed', () => {
    expect(isOriginAllowed('https://evil.example.com')).toBe(false)
    expect(isOriginAllowed('http://localhost.evil.com')).toBe(false)
    expect(isOriginAllowed('null')).toBe(false)
    expect(isOriginAllowed('not a url')).toBe(false)
    expect(isOriginAllowed('https://runtpt.dev', ['https://runtpt.dev'])).toBe(true)
    expect(isOriginAllowed('https://runtpt.dev.evil.com', ['https://runtpt.dev'])).toBe(false)
  })

  it('lets a non-browser client through, since pairing still gates it', () => {
    expect(isOriginAllowed(undefined)).toBe(true)
  })
})

describe('generatePairingCode', () => {
  it('is readable and not guessable by shape alone', () => {
    const code = generatePairingCode()
    expect(code).toMatch(/^[2-9BCDFGHJKLMNPQRSTVWXZ]{4}-[2-9BCDFGHJKLMNPQRSTVWXZ]{4}$/)
    expect(generatePairingCode()).not.toBe(code)
  })
})
