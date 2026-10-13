import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { THEME_IDS } from '../src/theme/themes.js'
import { deckTheme } from '../src/theme/useTheme.js'

const css = readFileSync(new URL('../src/styles/themes.css', import.meta.url), 'utf8')
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')

/** Variables per selector block, which is all the structure this file has. */
function blocks(): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>()
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const match of stripped.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const vars = new Map<string, string>()
    for (const decl of (match[2] ?? '').matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      vars.set(decl[1] as string, (decl[2] as string).trim())
    }
    for (const selector of (match[1] as string).split(',')) {
      const name = selector.trim()
      if (vars.size > 0) out.set(name, vars)
    }
  }
  return out
}

const byTheme = (id: string) => blocks().get(`[data-theme='${id}']`)

describe('theme tokens', () => {
  it('ships every theme the picker and the pre-paint script advertise', () => {
    const declared = THEME_IDS
    for (const id of declared) expect(byTheme(id), `missing [data-theme='${id}'] block`).toBeDefined()

    const inline = html.match(/var known = \[([^\]]*)\]/)?.[1] ?? ''
    const known = inline.split(',').map((s) => s.trim().replace(/'/g, '')).filter(Boolean)
    expect(known).toEqual(declared)
  })

  it('defines the full token set in every theme', () => {
    const reference = byTheme('default')
    expect(reference).toBeDefined()
    const expected = [...(reference as Map<string, string>).keys()].sort()

    for (const id of THEME_IDS) {
      const vars = byTheme(id) as Map<string, string>
      const missing = expected.filter((name) => !vars.has(name))
      const extra = [...vars.keys()].filter((name) => !expected.includes(name))
      expect({ id, missing, extra }).toEqual({ id, missing: [], extra: [] })
    }
  })

  it('keeps :root identical to the default theme', () => {
    const root = blocks().get(':root') as Map<string, string>
    const dark = byTheme('default') as Map<string, string>
    expect([...root.entries()]).toEqual([...dark.entries()])
  })

  it('leaves no literal colour outside themes.css', () => {
    for (const file of ['base.css', 'app.css', 'cell.css', 'present.css']) {
      const text = readFileSync(new URL(`../src/styles/${file}`, import.meta.url), 'utf8')
      expect({ file, hits: text.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(/g) ?? [] }).toEqual({ file, hits: [] })
    }
  })
})

// WCAG 2.1 relative luminance.
function luminance(hex: string): number {
  const h = hex.replace('#', '')
  const channels = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
  const linear = channels.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * (linear[0] as number) + 0.7152 * (linear[1] as number) + 0.0722 * (linear[2] as number)
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

/** Foreground tokens that carry words, against the surface they sit on. */
const TEXT_PAIRS: [string, string][] = [
  ['--fg', '--bg'],
  ['--fg', '--bg-raised'],
  ['--fg-dim', '--bg'],
  ['--fg-dim', '--bg-raised'],
  ['--prose-fg', '--bg'],
  ['--code-fg', '--bg-sunken'],
  ['--term-fg', '--term-bg'],
  ['--term-err-fg', '--term-bg'],
  ['--ok', '--bg-raised'],
  ['--warn', '--bg-raised'],
  ['--bad', '--bg-raised'],
  ['--stale', '--bg-raised'],
  ['--accent', '--bg-raised'],
  ['--on-accent', '--accent-dim'],
  ['--kernel-fg', '--kernel-bg'],
  ['--kernel-python-fg', '--kernel-python-bg'],
  ['--kernel-http-fg', '--kernel-http-bg'],
  ['--danger-fg', '--danger-bg'],
  ['--warn-fg', '--warn-bg'],
  ['--ok-fg', '--ok-bg'],
]

/**
 * Borders and status edges at the 3:1 bar for non-text UI. Only the themes that
 * promise accessibility are held to it: `default` draws its hairlines at 1.6:1
 * on purpose and reproducing it exactly matters more than lifting it here.
 */
const STRICT_THEMES = ['light', 'high-contrast']

const UI_PAIRS: [string, string][] = [
  ['--line-strong', '--bg'],
  ['--accent', '--bg'],
  ['--ok', '--bg'],
  ['--warn', '--bg'],
  ['--bad', '--bg'],
  ['--stale', '--bg'],
]

describe('theme contrast', () => {
  for (const id of THEME_IDS) {
    it(`${id}: text at 4.5:1 and UI at 3:1`, () => {
      const vars = byTheme(id) as Map<string, string>
      const value = (name: string) => vars.get(name) as string

      for (const [fg, bg] of TEXT_PAIRS) {
        expect(contrast(value(fg), value(bg)), `${id}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5)
      }
      if (!STRICT_THEMES.includes(id)) return
      for (const [fg, bg] of UI_PAIRS) {
        expect(contrast(value(fg), value(bg)), `${id}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(3)
      }
    })
  }

  it('high-contrast clears 7:1 on body text', () => {
    const vars = byTheme('high-contrast') as Map<string, string>
    expect(contrast(vars.get('--fg') as string, vars.get('--bg') as string)).toBeGreaterThanOrEqual(7)
    expect(contrast(vars.get('--prose-fg') as string, vars.get('--bg') as string)).toBeGreaterThanOrEqual(7)
    expect(contrast(vars.get('--fg-dim') as string, vars.get('--bg') as string)).toBeGreaterThanOrEqual(7)
  })
})

describe('deck theme', () => {
  it('leaves the operator alone when the frontmatter said nothing', () => {
    expect(deckTheme('default', 'gruvbox')).toEqual({ theme: 'gruvbox', warning: null })
    expect(deckTheme(undefined, 'light')).toEqual({ theme: 'light', warning: null })
  })

  it('honours a named theme', () => {
    expect(deckTheme('nord', 'light')).toEqual({ theme: 'nord', warning: null })
  })

  it('falls back with a diagnostic rather than crashing', () => {
    const { theme, warning } = deckTheme('neon-dreams', 'light')
    expect(theme).toBe('light')
    expect(warning).toContain('neon-dreams')
  })
})
