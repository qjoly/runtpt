import { statSync, watch as fsWatch, type FSWatcher, type Stats } from 'node:fs'
import { promises as fs } from 'node:fs'
import path from 'node:path'

export interface WatchHandle {
  close: () => void
}

export interface WatchOptions {
  /** Events arriving closer together than this collapse into one notification. */
  debounceMs?: number
}

const DEFAULT_DEBOUNCE_MS = 120

/**
 * Watches the *directory* rather than the file. Editors save by writing a
 * temporary file and renaming it over the target, which replaces the inode: a
 * watcher bound to the file itself would keep reporting on a path nobody reads
 * any more, and would miss every later save.
 */
export function watchFile(target: string, onChange: () => void, opts: WatchOptions = {}): WatchHandle {
  const dir = path.dirname(target)
  const name = path.basename(target)
  const debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS

  let timer: NodeJS.Timeout | null = null
  let closed = false
  let watcher: FSWatcher | null = null

  // macOS replays the directory's existing entries when a watch opens, so an
  // event alone is not evidence of a change; the file's own stamp is.
  const stamp = (stats: Stats): string => `${stats.mtimeMs}:${stats.size}:${stats.ino}`
  let seen: string | null = null
  try {
    seen = stamp(statSync(target))
  } catch {
    seen = null
  }

  const settle = async () => {
    timer = null
    if (closed) return
    // Mid-rename the path briefly does not exist; only a file that is back on
    // disk is a change worth reporting.
    let current: string
    try {
      current = stamp(await fs.stat(target))
    } catch {
      return
    }
    if (current === seen) return
    seen = current
    if (!closed) onChange()
  }

  const bump = (changed: string | null) => {
    if (closed) return
    if (changed !== null && changed !== name) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void settle(), debounceMs)
    timer.unref?.()
  }

  try {
    watcher = fsWatch(dir, (_event, filename) => bump(filename === null ? null : path.basename(String(filename))))
    watcher.on('error', () => {
      /* The directory went away; the subscription simply stops reporting. */
    })
  } catch {
    watcher = null
  }

  return {
    close: () => {
      closed = true
      if (timer) clearTimeout(timer)
      timer = null
      watcher?.close()
      watcher = null
    },
  }
}

/** One connection's subscriptions, so a closed socket cannot leak watchers. */
export class WatchRegistry {
  private readonly handles = new Map<string, WatchHandle>()

  get size(): number {
    return this.handles.size
  }

  add(id: string, target: string, onChange: () => void, opts?: WatchOptions): void {
    this.remove(id)
    this.handles.set(id, watchFile(target, onChange, opts))
  }

  remove(id: string): void {
    this.handles.get(id)?.close()
    this.handles.delete(id)
  }

  clear(): void {
    for (const handle of this.handles.values()) handle.close()
    this.handles.clear()
  }
}
