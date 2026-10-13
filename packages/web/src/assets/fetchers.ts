import { MAX_ASSET_BYTES } from '@runtpt/protocol'
import type { AgentApi } from '../agent/useAgent.js'
import { getBlob, GitHubError } from '../github/api.js'
import type { DocSource } from '../types.js'
import { mimeOf } from './mime.js'
import { AssetError, type AssetFetcher } from './store.js'

const MEGABYTES = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`

function githubFetcher(source: DocSource, token: string | null): AssetFetcher {
  const repo = source.repo
  if (!repo) {
    return async () => {
      throw new AssetError('unsupported-source', 'This document is not attached to a repository.')
    }
  }
  return async (path) => {
    try {
      const blob = await getBlob(repo.owner, repo.name, path, repo.ref, token, MAX_ASSET_BYTES)
      return { mime: mimeOf(path), base64: blob.base64, bytes: blob.bytes }
    } catch (err) {
      if (err instanceof GitHubError) {
        if (err.status === 404) {
          throw new AssetError('not-found', `${path} is not in ${repo.owner}/${repo.name}@${repo.ref}.`)
        }
        if (err.status === 413) {
          throw new AssetError('too-large', `${path} is over the ${MEGABYTES(MAX_ASSET_BYTES)} limit.`)
        }
        if (err.status === 401 || err.status === 403) {
          throw new AssetError('failed', `GitHub refused to serve ${path}: sign in with access to this repository.`)
        }
      }
      throw new AssetError('failed', `Could not read ${path}: ${(err as Error).message}`)
    }
  }
}

function agentFetcher(agent: AgentApi): AssetFetcher {
  return async (path) => {
    if (agent.status !== 'paired') {
      throw new AssetError('no-agent', `No agent is connected, so ${path} cannot be read from disk.`)
    }
    try {
      const asset = await agent.readAsset(path)
      return { mime: asset.mime, base64: asset.data, bytes: asset.bytes }
    } catch (err) {
      const message = (err as Error).message
      if (/byte limit/i.test(message)) {
        throw new AssetError('too-large', `${path} is over the ${MEGABYTES(MAX_ASSET_BYTES)} limit.`)
      }
      if (/ENOENT|no such file|outside|refused/i.test(message)) {
        throw new AssetError('not-found', `${path} is not under the agent's root.`)
      }
      throw new AssetError('failed', `Could not read ${path}: ${message}`)
    }
  }
}

export function assetFetcher(source: DocSource, deps: { token: string | null; agent: AgentApi }): AssetFetcher {
  if (source.origin === 'github') return githubFetcher(source, deps.token)
  if (source.origin === 'agent') return agentFetcher(deps.agent)
  const where = source.origin === 'upload' ? 'A dropped file' : 'The bundled demo'
  return async () => {
    throw new AssetError(
      'unsupported-source',
      `${where} carries no images: open the runbook from GitHub or an agent to see them.`,
    )
  }
}
