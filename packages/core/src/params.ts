import type { Diagnostic, ParamSpec, Runbook } from './model.js'

const PLACEHOLDER = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g

export interface ResolvedParams {
  values: Record<string, string>
  /** Names declared `secret: true`; the redactor is fed from this. */
  secrets: string[]
  missing: string[]
}

export function resolveParams(specs: ParamSpec[], provided: Record<string, string>): ResolvedParams {
  const values: Record<string, string> = {}
  const secrets: string[] = []
  const missing: string[] = []

  for (const spec of specs) {
    const given = provided[spec.name]
    const value = given !== undefined && given !== '' ? given : spec.default
    if (value === undefined) {
      if (spec.required) missing.push(spec.name)
      continue
    }
    values[spec.name] = value
    if (spec.secret) secrets.push(spec.name)
  }

  // Values passed in but never declared still reach the cells; refusing them
  // would make ad-hoc overrides impossible.
  for (const [name, value] of Object.entries(provided)) {
    if (!(name in values) && value !== '') values[name] = value
  }

  return { values, secrets, missing }
}

/** `{{ NAME }}` → value. Unknown placeholders are left untouched, and reported. */
export function substitute(
  source: string,
  values: Record<string, string>,
  diagnostics: Diagnostic[] = [],
): string {
  return source.replace(PLACEHOLDER, (match, name: string) => {
    const value = values[name]
    if (value === undefined) {
      diagnostics.push({ level: 'warn', message: `Unresolved placeholder "${name}"` })
      return match
    }
    return value
  })
}

export function placeholdersIn(source: string): string[] {
  const names = new Set<string>()
  for (const m of source.matchAll(PLACEHOLDER)) names.add(m[1]!)
  return [...names]
}

/** Placeholders used in cells but never declared in frontmatter. */
export function undeclaredParams(runbook: Runbook): string[] {
  const declared = new Set(runbook.settings.params.map((p) => p.name))
  const used = new Set<string>()
  for (const cell of runbook.cells) {
    for (const name of placeholdersIn(cell.source)) {
      if (!declared.has(name)) used.add(name)
    }
  }
  return [...used]
}
