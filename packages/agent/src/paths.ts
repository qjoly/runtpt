import { existsSync, realpathSync } from 'node:fs'
import path from 'node:path'

function realOrSelf(target: string): string {
  try {
    return realpathSync(target)
  } catch {
    return target
  }
}

/** Resolves symlinks as far up the path as actually exists on disk. */
function realResolve(target: string): string {
  const missing: string[] = []
  let current = target
  while (!existsSync(current)) {
    const parent = path.dirname(current)
    if (parent === current) return target
    missing.unshift(path.basename(current))
    current = parent
  }
  return missing.length === 0 ? realOrSelf(current) : path.join(realOrSelf(current), ...missing)
}

function contains(base: string, target: string): boolean {
  return target === base || target.startsWith(base.endsWith(path.sep) ? base : base + path.sep)
}

/**
 * The agent's root is the whole of its authority: a browser tab must not be
 * able to read `/etc/shadow` through a crafted path. The resolved form is
 * checked too, so a symlink out of the root — or a write through one — fails.
 */
export function resolveInRoot(root: string, p: string): string | null {
  if (p.includes('\0')) return null
  const base = path.resolve(root)
  const target = path.resolve(base, p)
  if (!contains(base, target)) return null
  if (!contains(realResolve(base), realResolve(target))) return null
  return target
}

/** Paths crossing the wire stay relative, so the layout above the root is never revealed. */
export function relativeToRoot(root: string, target: string): string {
  const rel = path.relative(path.resolve(root), target)
  return rel === '' ? '.' : rel
}
