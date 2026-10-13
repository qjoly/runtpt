export type AssetFailure =
  | 'escaped-root'
  | 'not-found'
  | 'too-large'
  | 'no-agent'
  | 'unsupported-source'
  | 'failed'

export interface AssetBytes {
  mime: string
  base64: string
  bytes: number
}

export class AssetError extends Error {
  constructor(
    readonly reason: AssetFailure,
    message: string,
  ) {
    super(message)
    this.name = 'AssetError'
  }
}

export type AssetEntry =
  | { status: 'loading' }
  | { status: 'ready'; url: string; mime: string; base64: string }
  | { status: 'error'; reason: AssetFailure; message: string }

export type AssetFetcher = (path: string) => Promise<AssetBytes>

export interface AssetUrls {
  create: (bytes: AssetBytes) => string
  revoke: (url: string) => void
}

function bytesOf(base64: string): ArrayBuffer {
  const binary = atob(base64.replace(/\s/g, ''))
  const buffer = new ArrayBuffer(binary.length)
  const view = new Uint8Array(buffer)
  for (let i = 0; i < binary.length; i += 1) view[i] = binary.charCodeAt(i)
  return buffer
}

export const objectUrls: AssetUrls = {
  // A blob URL keeps an SVG in its own opaque origin, so it cannot script the app.
  create: (asset) => URL.createObjectURL(new Blob([bytesOf(asset.base64)], { type: asset.mime })),
  revoke: (url) => URL.revokeObjectURL(url),
}

/**
 * One entry per resolved path, shared by every slide that shows the same image.
 * The generation counter lets `clear()` drop results of requests already in the
 * air, which is what happens when the operator opens another document.
 */
export class AssetStore {
  private entries = new Map<string, AssetEntry>()
  private listeners = new Set<() => void>()
  private generation = 0

  constructor(
    private readonly fetcher: AssetFetcher,
    private readonly urls: AssetUrls = objectUrls,
  ) {}

  get(path: string): AssetEntry | undefined {
    return this.entries.get(path)
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  request(path: string): void {
    if (this.entries.has(path)) return
    const generation = this.generation
    this.set(path, { status: 'loading' })
    void this.fetcher(path).then(
      (asset) => {
        if (generation !== this.generation) return
        this.set(path, {
          status: 'ready',
          url: this.urls.create(asset),
          mime: asset.mime,
          base64: asset.base64,
        })
      },
      (err: unknown) => {
        if (generation !== this.generation) return
        const failure = err instanceof AssetError ? err : null
        this.set(path, {
          status: 'error',
          reason: failure?.reason ?? 'failed',
          message: failure?.message ?? (err as Error).message,
        })
      },
    )
  }

  /** Drops one entry so the next request tries again. */
  forget(path: string): void {
    const entry = this.entries.get(path)
    if (!entry) return
    if (entry.status === 'ready') this.urls.revoke(entry.url)
    this.entries.delete(path)
    this.emit()
  }

  /** Revokes every object URL and forgets the cache. */
  clear(): void {
    this.generation += 1
    for (const entry of this.entries.values()) {
      if (entry.status === 'ready') this.urls.revoke(entry.url)
    }
    this.entries.clear()
    this.emit()
  }

  private set(path: string, entry: AssetEntry): void {
    this.entries.set(path, entry)
    this.emit()
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }
}
