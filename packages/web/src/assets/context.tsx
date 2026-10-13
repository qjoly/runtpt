import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import type { AgentApi } from '../agent/useAgent.js'
import type { DocSource } from '../types.js'
import { assetFetcher } from './fetchers.js'
import { resolveAssetPath } from './resolve.js'
import { AssetStore, type AssetEntry } from './store.js'

export interface AssetContextValue {
  store: AssetStore
  /** The runbook's own path: relative image paths are read against its directory. */
  runbookPath: string
  /** Static export renders from the cache, with no network and no object URLs. */
  mode: 'live' | 'export'
}

export const AssetContext = createContext<AssetContextValue | null>(null)

export const useAssets = (): AssetContextValue | null => useContext(AssetContext)

/**
 * One store per document. The store survives the switch in and out of
 * presentation mode, so an image already fetched is not fetched again.
 */
export function useAssetContext(source: DocSource, token: string | null, agent: AgentApi): AssetContextValue {
  const key = `${source.origin}:${source.repo?.owner}/${source.repo?.name}@${source.repo?.ref}:${source.path}:${source.sha ?? ''}`

  // Read through a ref: the agent may pair, or the token arrive, long after the
  // store was built, and that must not strand the images.
  const deps = useRef({ source, token, agent })
  deps.current = { source, token, agent }

  const store = useMemo(
    () => new AssetStore((path) => assetFetcher(deps.current.source, deps.current)(path)),
    [key],
  )

  useEffect(() => () => store.clear(), [store])

  return useMemo(() => ({ store, runbookPath: source.path, mode: 'live' as const }), [store, source.path])
}

export function AssetProvider({ value, children }: { value: AssetContextValue; children: ReactNode }) {
  return <AssetContext.Provider value={value}>{children}</AssetContext.Provider>
}

export interface ResolvedAsset {
  /** Null when the source is external, empty, or climbs out of the root. */
  path: string | null
  entry: AssetEntry | undefined
  retry: () => void
}

export function useAsset(src: string): ResolvedAsset {
  const assets = useAssets()
  const store = assets?.store ?? null
  const path = useMemo(
    () => (assets ? resolveAssetPath(assets.runbookPath, src) : null),
    [assets, src],
  )

  const subscribe = useMemo(
    () => (listener: () => void) => (store ? store.subscribe(listener) : () => {}),
    [store],
  )
  const read = () => (store && path ? store.get(path) : undefined)
  const entry = useSyncExternalStore(subscribe, read, read)

  useEffect(() => {
    if (store && path) store.request(path)
  }, [store, path])

  const retry = useCallback(() => {
    if (!store || !path) return
    store.forget(path)
    store.request(path)
  }, [store, path])

  return { path, entry, retry }
}
