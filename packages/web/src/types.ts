import type { RunbookRef } from '@runtpt/format'

export type DocOrigin = 'bundled' | 'github' | 'agent' | 'upload'

export interface RepoRef {
  owner: string
  name: string
  ref: string
}

/** Where the markdown in front of the user came from, and what may be done to it. */
export interface DocSource {
  origin: DocOrigin
  /** Repository-relative or filesystem path, used to name the side-car. */
  path: string
  label: string
  /** Blob sha of the markdown when it was opened: the staleness anchor. */
  sha?: string
  repo?: RepoRef
  writable: boolean
}

export interface LoadedDoc {
  source: DocSource
  text: string
}

export function runbookRefOf(source: DocSource): RunbookRef {
  return {
    path: source.path,
    ...(source.sha ? { sha: source.sha } : {}),
    ...(source.repo ? { repo: `${source.repo.owner}/${source.repo.name}`, ref: source.repo.ref } : {}),
  }
}
