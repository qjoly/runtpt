import type { CellAttrs, CellKernel, Diagnostic, OutputHint } from './model.js'

export const KERNELS: CellKernel[] = ['shell', 'bash', 'sh', 'zsh', 'python', 'http']

const KNOWN_KEYS = new Set([
  'run', 'id', 'name', 'timeout', 'depends', 'continue-on-error',
  'confirm', 'hidden', 'cwd', 'output', 'interactive', 'interpreter',
])

const OUTPUT_HINTS = new Set(['text', 'json', 'table', 'chart'])

export interface InfoString {
  lang: string
  attrs: CellAttrs
  /** True when at least one runtpt attribute was present. */
  hasAttrs: boolean
}

/** `30s`, `500ms`, `2m`, or a bare number of seconds. */
export function parseDuration(text: string): number | null {
  const m = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/.exec(text.trim())
  if (!m) return null
  const value = Number(m[1])
  switch (m[2]) {
    case 'ms': return value
    case 'm': return value * 60_000
    case 'h': return value * 3_600_000
    default: return value * 1000
  }
}

/**
 * Splits an info string into tokens, honouring double quotes so
 * `name="check the nodes"` survives.
 */
function tokenize(info: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quoted = false

  for (const char of info) {
    if (char === '"') {
      quoted = !quoted
      continue
    }
    if (!quoted && /\s/.test(char)) {
      if (current) tokens.push(current)
      current = ''
      continue
    }
    current += char
  }
  if (current) tokens.push(current)
  return tokens
}

export function parseInfoString(info: string, diagnostics: Diagnostic[] = [], line?: number): InfoString {
  const tokens = tokenize(info)
  const lang = (tokens.shift() ?? '').toLowerCase()

  const attrs: CellAttrs = {
    run: false,
    depends: [],
    continueOnError: false,
    confirm: false,
    hidden: false,
    interactive: false,
    unknown: {},
  }
  let hasAttrs = false

  for (const token of tokens) {
    const eq = token.indexOf('=')
    const key = (eq === -1 ? token : token.slice(0, eq)).toLowerCase()
    const value = eq === -1 ? true : token.slice(eq + 1)

    if (!KNOWN_KEYS.has(key)) {
      attrs.unknown[key] = value
      diagnostics.push({ level: 'warn', message: `Unknown cell attribute "${key}"`, line })
      hasAttrs = true
      continue
    }
    hasAttrs = true

    switch (key) {
      case 'run':
        attrs.run = true
        break
      case 'id':
        if (typeof value === 'string') attrs.id = value
        break
      case 'name':
        if (typeof value === 'string') attrs.name = value
        break
      case 'timeout': {
        if (typeof value !== 'string') break
        const ms = parseDuration(value)
        if (ms === null) diagnostics.push({ level: 'warn', message: `Invalid timeout "${value}"`, line })
        else attrs.timeoutMs = ms
        break
      }
      case 'depends':
        if (typeof value === 'string') {
          attrs.depends = value.split(',').map((s) => s.trim()).filter(Boolean)
        }
        break
      case 'continue-on-error':
        attrs.continueOnError = true
        break
      case 'confirm':
        attrs.confirm = true
        break
      case 'hidden':
        attrs.hidden = true
        break
      case 'cwd':
        if (typeof value === 'string') attrs.cwd = value
        break
      case 'output':
        if (typeof value === 'string' && OUTPUT_HINTS.has(value)) attrs.output = value as OutputHint
        else diagnostics.push({ level: 'warn', message: `Invalid output hint "${String(value)}"`, line })
        break
      case 'interactive':
        attrs.interactive = true
        break
      case 'interpreter':
        if (typeof value === 'string' && value !== '') attrs.interpreter = value
        else diagnostics.push({ level: 'warn', message: 'interpreter= needs a path', line })
        break
    }
  }

  return { lang, attrs, hasAttrs }
}

export function isKernel(lang: string): lang is CellKernel {
  return (KERNELS as string[]).includes(lang)
}
