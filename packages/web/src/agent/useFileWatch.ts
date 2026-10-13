import { useEffect, useState } from 'react'
import type { AgentApi } from './useAgent.js'
import type { DocSource } from '../types.js'

/**
 * Reports that the open file moved under us. Only agent-backed documents are
 * followed: a GitHub document would mean polling the API, which costs rate
 * limit to answer a question nobody asked.
 */
export function useFileWatch(agent: AgentApi, source: DocSource, generation: number): boolean {
  const [changed, setChanged] = useState(false)
  const watchable = source.origin === 'agent' && agent.status === 'paired'
  const path = source.path

  useEffect(() => {
    setChanged(false)
    if (!watchable) return

    let subscription: string | null = null
    let dropped = false

    const unsubscribe = agent.subscribe((event) => {
      if (event.t === 'changed' && subscription !== null && event.id === subscription) setChanged(true)
    })

    agent
      .watch(path)
      .then((msg) => {
        // The document moved on while the agent was answering.
        if (dropped) agent.unwatch(msg.id)
        else subscription = msg.id
      })
      .catch(() => {
        /* No watcher: the operator keeps the manual reload. */
      })

    return () => {
      dropped = true
      unsubscribe()
      if (subscription !== null) {
        try {
          agent.unwatch(subscription)
        } catch {
          /* The socket is gone; so is the watcher. */
        }
      }
    }
  }, [agent, generation, path, watchable])

  return changed
}
