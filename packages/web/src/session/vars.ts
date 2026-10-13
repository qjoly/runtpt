/**
 * Session variables: environment entries the operator adds for this tab only.
 * Pure on purpose — the merge order and the key rules are the part worth testing.
 */

export const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

export interface SessionVar {
  id: string
  key: string
  value: string
  /** Masked in the UI, registered with the agent, redacted from the recording. */
  secret: boolean
}

/**
 * Null when the row is usable. `siblings` holds the keys declared *before* this
 * one, so a duplicate is reported on the row that shadows, not on the original.
 */
export function keyError(key: string, siblings: readonly string[] = []): string | null {
  if (key === '') return null
  if (!ENV_KEY_PATTERN.test(key)) return 'Use letters, digits and _, and do not start with a digit'
  if (siblings.includes(key)) return 'Already defined above'
  return null
}

/** The rows that will actually be exported: named, valid, first one wins. */
export function liveVars(vars: readonly SessionVar[]): SessionVar[] {
  const seen = new Set<string>()
  const kept: SessionVar[] = []
  for (const v of vars) {
    if (!ENV_KEY_PATTERN.test(v.key) || seen.has(v.key)) continue
    seen.add(v.key)
    kept.push(v)
  }
  return kept
}

export function sessionEnv(vars: readonly SessionVar[]): Record<string, string> {
  const env: Record<string, string> = {}
  for (const v of liveVars(vars)) env[v.key] = v.value
  return env
}

/** Empty secrets are not worth redacting, and redacting '' would blank everything. */
export function sessionSecrets(vars: readonly SessionVar[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const v of liveVars(vars)) if (v.secret && v.value !== '') out[v.key] = v.value
  return out
}

/** frontmatter `env` < session variables < resolved parameters. */
export function mergeRunEnv(
  frontmatter: Record<string, string>,
  session: Record<string, string>,
  params: Record<string, string>,
): Record<string, string> {
  return { ...frontmatter, ...session, ...params }
}

/** Frontmatter keys a later layer takes over, so the panel can say which. */
export function shadowedKeys(
  frontmatter: Record<string, string>,
  session: Record<string, string>,
  params: Record<string, string> = {},
): Set<string> {
  return new Set(Object.keys(frontmatter).filter((k) => k in session || k in params))
}

let counter = 0
export function newVar(): SessionVar {
  return { id: `v${++counter}`, key: '', value: '', secret: false }
}
