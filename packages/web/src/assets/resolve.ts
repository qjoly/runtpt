/** Anything with a scheme, or protocol-relative, belongs to the browser, not to us. */
const EXTERNAL = /^(?:[a-z][a-z0-9+.\-]*:|\/\/)/i

export function isExternal(src: string): boolean {
  return EXTERNAL.test(src.trim())
}

function normalise(segments: string[]): string[] | null {
  const out: string[] = []
  for (const segment of segments) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      // Climbing past the root is the one thing we never follow.
      if (out.length === 0) return null
      out.pop()
      continue
    }
    out.push(segment)
  }
  return out
}

/**
 * Resolves a markdown `src` against the directory holding the runbook, in the
 * repository or agent root the runbook itself is relative to. Returns null when
 * the path escapes that root or names nothing.
 */
export function resolveAssetPath(runbookPath: string, src: string): string | null {
  const raw = src.trim()
  if (!raw || isExternal(raw)) return null

  const bare = raw.split(/[?#]/, 1)[0] ?? ''
  let decoded = bare
  try {
    decoded = decodeURIComponent(bare)
  } catch {
    // A stray percent sign is not a reason to drop the image.
  }
  if (!decoded) return null

  // A leading slash means the root, not the machine's filesystem root.
  const base = decoded.startsWith('/') ? [] : (normalise(runbookPath.split('/').slice(0, -1)) ?? [])
  const resolved = normalise([...base, ...decoded.split('/')])
  if (!resolved || resolved.length === 0) return null
  return resolved.join('/')
}
