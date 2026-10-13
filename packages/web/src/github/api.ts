const API = 'https://api.github.com'

export interface GhUser {
  login: string
  avatar_url: string
  name?: string
}

export interface GhRepo {
  full_name: string
  name: string
  owner: { login: string }
  private: boolean
  default_branch: string
  pushed_at?: string
  permissions?: { push?: boolean }
}

export interface GhBranch {
  name: string
  commit: { sha: string }
}

export interface GhTreeEntry {
  path: string
  type: 'blob' | 'tree' | 'commit'
  sha: string
  size?: number
}

export interface GhFile {
  text: string
  sha: string
  path: string
}

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'GitHubError'
  }
}

async function call<T>(path: string, token: string | null, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    ...((init?.headers as Record<string, string>) ?? {}),
  }
  if (token) headers.authorization = `Bearer ${token}`

  const response = await fetch(path.startsWith('http') ? path : API + path, { ...init, headers })
  if (!response.ok) {
    let detail = `HTTP ${response.status}`
    try {
      const body = (await response.json()) as { message?: string }
      if (body.message) detail = body.message
    } catch {
      // A non-JSON error body is still an error.
    }
    throw new GitHubError(detail, response.status)
  }
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export const getUser = (token: string): Promise<GhUser> => call<GhUser>('/user', token)

export const listRepos = (token: string): Promise<GhRepo[]> =>
  call<GhRepo[]>('/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member', token)

export const getRepo = (owner: string, repo: string, token: string | null): Promise<GhRepo> =>
  call<GhRepo>(`/repos/${owner}/${repo}`, token)

export const listBranches = (owner: string, repo: string, token: string | null): Promise<GhBranch[]> =>
  call<GhBranch[]>(`/repos/${owner}/${repo}/branches?per_page=100`, token)

export interface MarkdownListing {
  entries: GhTreeEntry[]
  /**
   * GitHub caps a recursive tree and says so. Dropping the flag meant a large
   * repository silently listed only part of its files, and a file you knew was
   * there simply did not appear.
   */
  truncated: boolean
}

export async function listMarkdown(
  owner: string,
  repo: string,
  ref: string,
  token: string | null,
): Promise<MarkdownListing> {
  const tree = await call<{ tree: GhTreeEntry[]; truncated: boolean }>(
    `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
    token,
  )
  return {
    entries: tree.tree.filter((e) => e.type === 'blob' && /\.(md|markdown|runtpt)$/i.test(e.path)),
    truncated: tree.truncated === true,
  }
}

function decodeBase64(data: string): string {
  const binary = atob(data.replace(/\n/g, ''))
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

export function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export async function getFile(
  owner: string,
  repo: string,
  path: string,
  ref: string,
  token: string | null,
): Promise<GhFile> {
  const file = await call<{ content?: string; encoding?: string; sha: string; path: string }>(
    `/repos/${owner}/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`,
    token,
  )
  if (!file.content) throw new GitHubError('File has no inline content (too large?)', 415)
  return { text: decodeBase64(file.content), sha: file.sha, path: file.path }
}

/** Returns null when the file does not exist yet, which is the common case. */
export async function getFileSha(
  owner: string,
  repo: string,
  path: string,
  ref: string,
  token: string,
): Promise<string | null> {
  try {
    const file = await call<{ sha: string }>(
      `/repos/${owner}/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`,
      token,
    )
    return file.sha
  } catch (err) {
    if (err instanceof GitHubError && err.status === 404) return null
    throw err
  }
}

export interface CommitResult {
  commitSha: string
  htmlUrl: string
  contentSha: string
}

export async function putFile(args: {
  owner: string
  repo: string
  path: string
  branch: string
  message: string
  content: string
  sha?: string | null
  token: string
}): Promise<CommitResult> {
  const result = await call<{
    commit: { sha: string; html_url: string }
    content: { sha: string }
  }>(`/repos/${args.owner}/${args.repo}/contents/${args.path.split('/').map(encodeURIComponent).join('/')}`, args.token, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message: args.message,
      content: encodeBase64(args.content),
      branch: args.branch,
      ...(args.sha ? { sha: args.sha } : {}),
    }),
  })
  return { commitSha: result.commit.sha, htmlUrl: result.commit.html_url, contentSha: result.content.sha }
}

export async function createBranch(args: {
  owner: string
  repo: string
  from: string
  name: string
  token: string
}): Promise<void> {
  const base = await call<{ object: { sha: string } }>(
    `/repos/${args.owner}/${args.repo}/git/ref/heads/${encodeURIComponent(args.from)}`,
    args.token,
  )
  await call(`/repos/${args.owner}/${args.repo}/git/refs`, args.token, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ref: `refs/heads/${args.name}`, sha: base.object.sha }),
  })
}

export interface BlobLocation {
  owner: string
  repo: string
  ref: string
  path: string
}

/** Accepts a blob URL, a raw.githubusercontent URL, or `owner/repo/path@ref`. */
export function parseBlobUrl(input: string): BlobLocation | null {
  const trimmed = input.trim()
  const blob = /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+)\/(?:blob|raw)\/([^/]+)\/(.+?)(?:[?#].*)?$/.exec(
    trimmed,
  )
  if (blob) return { owner: blob[1]!, repo: blob[2]!, ref: blob[3]!, path: blob[4]! }

  const raw = /^https?:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+?)(?:[?#].*)?$/.exec(trimmed)
  if (raw) return { owner: raw[1]!, repo: raw[2]!, ref: raw[3]!, path: raw[4]! }

  const short = /^([^/\s]+)\/([^/\s]+)\/(.+?)(?:@([^@\s]+))?$/.exec(trimmed)
  if (short) return { owner: short[1]!, repo: short[2]!, ref: short[4] ?? 'HEAD', path: short[3]! }

  return null
}

export interface GhBlob {
  base64: string
  bytes: number
}

/**
 * Binary read through the API rather than raw.githubusercontent, because a
 * private repository only answers to the token. Over 1 MB the contents endpoint
 * stops inlining the bytes, hence the blob fallback.
 */
export async function getBlob(
  owner: string,
  repo: string,
  path: string,
  ref: string,
  token: string | null,
  maxBytes: number,
): Promise<GhBlob> {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/')
  const meta = await call<{ content?: string; encoding?: string; size?: number; sha: string; type?: string }>(
    `/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`,
    token,
  )
  if (meta.type && meta.type !== 'file') throw new GitHubError('Not a file', 415)
  const size = meta.size ?? 0
  if (size > maxBytes) throw new GitHubError(`File is ${size} bytes, over the ${maxBytes} byte limit`, 413)

  if (meta.content && meta.encoding === 'base64') {
    return { base64: meta.content.replace(/\n/g, ''), bytes: size }
  }
  const blob = await call<{ content: string; encoding: string; size: number }>(
    `/repos/${owner}/${repo}/git/blobs/${meta.sha}`,
    token,
  )
  if (blob.encoding !== 'base64') throw new GitHubError('Unexpected blob encoding', 415)
  return { base64: blob.content.replace(/\n/g, ''), bytes: blob.size ?? size }
}
