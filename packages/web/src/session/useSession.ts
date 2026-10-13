import { useCallback, useMemo, useState } from 'react'
import type { ShellChoice } from '@runtpt/core'
import { liveVars, newVar, sessionEnv, sessionSecrets, type SessionVar } from './vars.js'

export interface SessionApi {
  vars: SessionVar[]
  add: () => void
  update: (id: string, patch: Partial<SessionVar>) => void
  remove: (id: string) => void
  /** Exported rows, keyed. */
  env: Record<string, string>
  secrets: Record<string, string>
  count: number
  /** Null means "whatever the runbook says". */
  shellOverride: ShellChoice | null
  setShellOverride: (choice: ShellChoice | null) => void
}

/**
 * Deliberately held in React state and nowhere else: a session variable may hold
 * a token, so it must not survive the tab in localStorage or in the document.
 */
export function useSession(): SessionApi {
  const [vars, setVars] = useState<SessionVar[]>([])
  const [shellOverride, setShellOverride] = useState<ShellChoice | null>(null)

  const add = useCallback(() => setVars((prev) => [...prev, newVar()]), [])
  const update = useCallback(
    (id: string, patch: Partial<SessionVar>) =>
      setVars((prev) => prev.map((v) => (v.id === id ? { ...v, ...patch } : v))),
    [],
  )
  const remove = useCallback((id: string) => setVars((prev) => prev.filter((v) => v.id !== id)), [])

  const env = useMemo(() => sessionEnv(vars), [vars])
  const secrets = useMemo(() => sessionSecrets(vars), [vars])

  return useMemo(
    () => ({
      vars,
      add,
      update,
      remove,
      env,
      secrets,
      count: liveVars(vars).length,
      shellOverride,
      setShellOverride,
    }),
    [vars, add, update, remove, env, secrets, shellOverride],
  )
}
