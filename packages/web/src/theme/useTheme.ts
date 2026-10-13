import { useCallback, useEffect, useState } from 'react'
import { DARK_THEME, LIGHT_THEME, THEME_KEY, isThemeChoice, isThemeId, type ThemeChoice } from './themes.js'

const LIGHT_QUERY = '(prefers-color-scheme: light)'

function systemTheme(): string {
  return typeof window !== 'undefined' && window.matchMedia?.(LIGHT_QUERY).matches ? LIGHT_THEME : DARK_THEME
}

export function resolveTheme(choice: ThemeChoice): string {
  return choice === 'system' ? systemTheme() : isThemeId(choice) ? choice : systemTheme()
}

function readChoice(): ThemeChoice {
  try {
    const saved = window.localStorage.getItem(THEME_KEY)
    if (isThemeChoice(saved)) return saved as ThemeChoice
  } catch {
    // Private mode or a blocked origin: the operator just gets `system`.
  }
  return 'system'
}

export interface ThemeState {
  /** What the operator picked, which may be `system`. */
  choice: ThemeChoice
  /** The theme actually on <html> right now. */
  active: string
  /** What this machine asks for, whether or not the operator follows it. */
  system: string
  setChoice: (next: ThemeChoice) => void
}

export function useTheme(): ThemeState {
  const [choice, setChoiceState] = useState<ThemeChoice>(readChoice)
  const [active, setActive] = useState<string>(() => resolveTheme(readChoice()))
  const [system, setSystem] = useState<string>(systemTheme)

  useEffect(() => {
    const next = resolveTheme(choice)
    setActive(next)
    document.documentElement.dataset.theme = next
  }, [choice])

  // The OS preference is watched even when unused: the picker names it.
  useEffect(() => {
    const query = window.matchMedia?.(LIGHT_QUERY)
    if (!query) return
    const onChange = () => setSystem(systemTheme())
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    if (choice !== 'system') return
    setActive(system)
    document.documentElement.dataset.theme = system
  }, [choice, system])

  const setChoice = useCallback((next: ThemeChoice) => {
    setChoiceState(next)
    try {
      window.localStorage.setItem(THEME_KEY, next)
    } catch {
      // Not persisting is survivable; refusing to switch is not.
    }
  }, [])

  return { choice, active, system, setChoice }
}

/**
 * A deck may name a theme in its frontmatter. `default` is what the parser
 * reports when the frontmatter said nothing, so it cannot be told apart from
 * silence and is treated as "leave the operator alone".
 */
export function deckTheme(requested: string | undefined, operator: string): { theme: string; warning: string | null } {
  if (!requested || requested === 'default') return { theme: operator, warning: null }
  if (isThemeId(requested)) return { theme: requested, warning: null }
  return { theme: operator, warning: `Unknown presentation theme "${requested}" — using ${operator}.` }
}
