export interface ThemeInfo {
  id: string
  label: string
  /** How the theme describes itself in the picker, one line. */
  about: string
}

export const THEMES: ThemeInfo[] = [
  { id: 'default', label: 'Dark', about: 'the original, dense and low-glare' },
  { id: 'light', label: 'Light', about: 'paper tones for a lit room' },
  { id: 'high-contrast', label: 'High contrast', about: 'black ground, AAA body text' },
  { id: 'gruvbox', label: 'Gruvbox', about: 'warm retro terminal' },
  { id: 'nord', label: 'Nord', about: 'cool and flat' },
]

export const THEME_IDS: string[] = THEMES.map((t) => t.id)

/** What `system` resolves to in each direction. */
export const DARK_THEME = 'default'
export const LIGHT_THEME = 'light'

export const THEME_KEY = 'runtpt.theme'

export type ThemeChoice = string

export function isThemeId(value: unknown): value is string {
  return typeof value === 'string' && THEME_IDS.includes(value)
}

export function isThemeChoice(value: unknown): boolean {
  return value === 'system' || isThemeId(value)
}

export function themeLabel(id: string): string {
  return THEMES.find((t) => t.id === id)?.label ?? id
}
