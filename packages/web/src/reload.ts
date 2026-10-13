import { getFile } from './github/api.js'
import { DEMO_RUNBOOK } from './demo/bundled.js'
import type { AgentApi } from './agent/useAgent.js'
import type { DocSource, LoadedDoc } from './types.js'

export function reloadRefusal(source: DocSource): string | null {
  if (source.origin !== 'upload') return null
  return 'A dropped file has no source to re-read. Open it from the agent or from GitHub to reload it.'
}

/**
 * Re-reads the open document from wherever it came from. It throws rather than
 * returning a half-document: the caller must be able to keep the current one.
 */
export async function refetchDoc(source: DocSource, agent: AgentApi, token: string | null): Promise<LoadedDoc> {
  switch (source.origin) {
    case 'bundled':
      return { source: { ...source }, text: DEMO_RUNBOOK.text }

    case 'agent': {
      if (agent.status !== 'paired') throw new Error('No agent connected, so this file cannot be re-read.')
      const file = await agent.open(source.path)
      return { source: { ...source }, text: file.content }
    }

    case 'github': {
      const repo = source.repo
      if (!repo) throw new Error('This document does not record which repository it came from.')
      const file = await getFile(repo.owner, repo.name, source.path, repo.ref, token)
      // The sha anchors staleness; leaving the old one would make every later
      // comparison lie about which revision is on screen.
      return { source: { ...source, sha: file.sha }, text: file.text }
    }

    case 'upload':
      throw new Error(reloadRefusal(source) ?? 'This document cannot be reloaded.')
  }
}
