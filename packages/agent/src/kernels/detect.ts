import { accessSync, constants } from 'node:fs'
import path from 'node:path'
import type { KernelId, KernelInfo } from '@runtpt/protocol'

/** PATH lookup without spawning anything, so startup stays cheap. */
export function which(bin: string): string | null {
  if (bin.includes(path.sep)) {
    const absolute = path.resolve(bin)
    try { accessSync(absolute, constants.X_OK); return absolute } catch { return null }
  }
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)
  for (const dir of dirs) {
    const candidate = path.resolve(dir, bin)
    try {
      accessSync(candidate, constants.X_OK)
      return candidate
    } catch { /* keep looking */ }
  }
  return null
}

const BINARIES: Record<KernelId, string | null> = {
  bash: 'bash',
  sh: 'sh',
  zsh: 'zsh',
  python: 'python3',
  http: null,
}

export function binaryFor(kernel: KernelId): string | null {
  const name = BINARIES[kernel]
  return name === null ? null : which(name)
}

export function detectKernels(): KernelInfo[] {
  const infos: KernelInfo[] = []
  for (const kernel of Object.keys(BINARIES) as KernelId[]) {
    if (kernel === 'http') {
      infos.push({ id: 'http', available: typeof fetch === 'function', detail: 'fetch' })
      continue
    }
    // The web UI builds its shell picker from this list, so an unavailable
    // kernel has to be reported as such rather than omitted.
    const resolved = binaryFor(kernel)
    infos.push({
      id: kernel,
      available: resolved !== null,
      ...(resolved ? { detail: resolved, path: resolved } : {}),
    })
  }
  return infos
}
