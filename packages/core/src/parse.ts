import { parse as parseYaml } from 'yaml'
import type { KernelId } from '@runtpt/protocol'
import { isKernel, parseInfoString } from './attrs.js'
import { parseShellChoice } from './kernel.js'
import { cellHash } from './hash.js'
import {
  COVER_LAYOUTS,
  DEFAULT_SETTINGS,
  type CoverLayout,
  type Block,
  type Cell,
  type CellKernel,
  type InertFence,
  type Diagnostic,
  type ParamSpec,
  type Runbook,
  type RuntptSettings,
} from './model.js'

const FENCE_RE = /^( {0,3})(`{3,}|~{3,})(.*)$/
const NOTES_RE = /^<!--\s*notes:\s*([\s\S]*?)-->\s*$/
const DIRECTIVE_RE = /^<!--\s*runtpt:([a-z-]+)(?:\s+([^>]*?))?\s*-->\s*$/

interface FrontmatterResult {
  data: Record<string, unknown> | null
  raw: string | null
  bodyStartLine: number
}

function extractFrontmatter(lines: string[], diagnostics: Diagnostic[]): FrontmatterResult {
  if (lines[0]?.trim() !== '---') return { data: null, raw: null, bodyStartLine: 0 }

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim()
    if (line === '---' || line === '...') {
      const raw = lines.slice(1, i).join('\n')
      try {
        const data = parseYaml(raw) as unknown
        return {
          data: typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {},
          raw,
          bodyStartLine: i + 1,
        }
      } catch (err) {
        diagnostics.push({ level: 'error', message: `Invalid frontmatter: ${(err as Error).message}`, line: 1 })
        return { data: null, raw, bodyStartLine: i + 1 }
      }
    }
  }
  diagnostics.push({ level: 'warn', message: 'Frontmatter opened but never closed', line: 1 })
  return { data: null, raw: null, bodyStartLine: 0 }
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function readParams(value: unknown, diagnostics: Diagnostic[]): ParamSpec[] {
  if (!Array.isArray(value)) return []
  const params: ParamSpec[] = []

  for (const entry of value) {
    if (typeof entry === 'string') {
      params.push({ name: entry, secret: false, required: true })
      continue
    }
    if (typeof entry !== 'object' || entry === null) continue
    const o = entry as Record<string, unknown>
    const name = asString(o.name)
    if (!name) {
      diagnostics.push({ level: 'warn', message: 'Parameter without a name, ignored' })
      continue
    }
    const def = o.default === undefined ? undefined : String(o.default)
    params.push({
      name,
      secret: o.secret === true,
      // A parameter with a default never blocks a run.
      required: o.required === undefined ? def === undefined : o.required === true,
      ...(asString(o.prompt) ? { prompt: asString(o.prompt)! } : {}),
      ...(def !== undefined ? { default: def } : {}),
      ...(Array.isArray(o.options) ? { options: o.options.map(String) } : {}),
    })
  }
  return params
}

function readSettings(fm: Record<string, unknown> | null, diagnostics: Diagnostic[]): RuntptSettings {
  const settings: RuntptSettings = {
    ...DEFAULT_SETTINGS,
    shell: { ...DEFAULT_SETTINGS.shell },
    env: {},
    interpreters: {},
    params: [],
    presentation: { ...DEFAULT_SETTINGS.presentation },
  }
  if (!fm) return settings

  const raw = fm.runtpt
  if (typeof raw !== 'object' || raw === null) return settings
  const o = raw as Record<string, unknown>

  const cells = asString(o.cells)
  if (cells === 'all' || cells === 'tagged') settings.cells = cells
  else if (cells) diagnostics.push({ level: 'warn', message: `Unknown cells mode "${cells}", keeping "${settings.cells}"` })

  const shell = asString(o.shell)
  if (shell) settings.shell = parseShellChoice(shell, diagnostics)

  if (typeof o.interpreters === 'object' && o.interpreters !== null) {
    for (const [name, value] of Object.entries(o.interpreters as Record<string, unknown>)) {
      if (!isKernel(name) || name === 'shell') {
        diagnostics.push({ level: 'warn', message: `No kernel named "${name}" to give an interpreter to` })
        continue
      }
      settings.interpreters[name as KernelId] = String(value)
    }
  }

  const cwd = asString(o.cwd)
  if (cwd) settings.cwd = cwd

  if (typeof o.env === 'object' && o.env !== null) {
    for (const [k, v] of Object.entries(o.env as Record<string, unknown>)) {
      settings.env[k] = String(v)
    }
  }

  settings.params = readParams(o.params, diagnostics)

  if (typeof o.presentation === 'object' && o.presentation !== null) {
    const p = o.presentation as Record<string, unknown>
    const theme = asString(p.theme)
    if (theme) settings.presentation.theme = theme
    const slides = asString(p.slides)
    if (slides === 'auto' || slides === 'hr' || slides === 'h1' || slides === 'h2') {
      settings.presentation.slides = slides
    }
    else if (slides) diagnostics.push({ level: 'warn', message: `Unknown slide mode "${slides}"` })

    const cover = asString(p.cover)
    if (cover && (COVER_LAYOUTS as string[]).includes(cover)) settings.presentation.cover = cover as CoverLayout
    else if (cover) {
      diagnostics.push({ level: 'warn', message: `Unknown cover layout "${cover}", keeping "${settings.presentation.cover}"` })
    }

    const image = asString(p.image)
    if (image) settings.presentation.image = image
  }

  return settings
}

/** Derived ids are short but collision-checked against the whole document. */
function assignId(cell: Omit<Cell, 'id' | 'explicitId' | 'index'>, taken: Set<string>, diagnostics: Diagnostic[]): {
  id: string
  explicitId: boolean
} {
  const explicit = cell.attrs.id
  if (explicit) {
    if (taken.has(explicit)) {
      diagnostics.push({ level: 'error', message: `Duplicate cell id "${explicit}"`, line: cell.startLine })
      let n = 2
      while (taken.has(`${explicit}-${n}`)) n++
      return { id: `${explicit}-${n}`, explicitId: true }
    }
    return { id: explicit, explicitId: true }
  }

  const digest = cell.hash.slice(7, 13)
  let candidate = `${cell.kernel}-${digest}`
  let n = 2
  while (taken.has(candidate)) candidate = `${cell.kernel}-${digest}-${n++}`
  return { id: candidate, explicitId: false }
}

/**
 * Line-oriented scanner rather than a full CommonMark AST: the agent needs this
 * in headless mode, prose is handed to the renderer untouched, and fence rules
 * are the only syntax runtpt actually has to understand.
 */
export function parseRunbook(source: string, diagnostics: Diagnostic[] = []): Runbook {
  const lines = source.split('\n')
  const fm = extractFrontmatter(lines, diagnostics)
  const settings = readSettings(fm.data, diagnostics)

  const blocks: Block[] = []
  const cells: Cell[] = []
  const inertFences: InertFence[] = []
  let declaresRuntpt = fm.data !== null && typeof fm.data.runtpt === 'object' && fm.data.runtpt !== null
  const taken = new Set<string>()

  let prose: string[] = []
  let proseStart = fm.bodyStartLine

  const flushProse = (endLine: number) => {
    if (prose.join('').trim() === '') {
      prose = []
      return
    }
    blocks.push({ kind: 'prose', markdown: prose.join('\n'), startLine: proseStart, endLine })
    prose = []
  }

  for (let i = fm.bodyStartLine; i < lines.length; i++) {
    const line = lines[i]!

    const notes = NOTES_RE.exec(line.trim())
    if (notes) {
      flushProse(i)
      blocks.push({ kind: 'notes', text: notes[1]!.trim(), startLine: i, endLine: i })
      proseStart = i + 1
      continue
    }

    const directive = DIRECTIVE_RE.exec(line.trim())
    if (directive) {
      flushProse(i)
      blocks.push({
        kind: 'directive',
        name: directive[1]!,
        startLine: i,
        endLine: i,
        ...(directive[2] ? { arg: directive[2].trim() } : {}),
      })
      proseStart = i + 1
      continue
    }

    const fence = FENCE_RE.exec(line)
    if (!fence) {
      // A multi-line notes comment: swallow until it closes.
      if (/^<!--\s*notes:/.test(line.trim())) {
        const start = i
        const buffer: string[] = [line]
        while (i + 1 < lines.length && !/-->/.test(lines[i]!)) {
          i++
          buffer.push(lines[i]!)
        }
        const joined = buffer.join('\n')
        const m = NOTES_RE.exec(joined.trim())
        flushProse(start)
        blocks.push({ kind: 'notes', text: m ? m[1]!.trim() : joined, startLine: start, endLine: i })
        proseStart = i + 1
        continue
      }
      prose.push(line)
      continue
    }

    const indent = fence[1]!.length
    const marker = fence[2]!
    const info = fence[3]!.trim()
    const char = marker[0]!

    // Backtick fences cannot carry a backtick in their info string.
    if (char === '`' && info.includes('`')) {
      prose.push(line)
      continue
    }

    const body: string[] = []
    let closed = false
    let j = i + 1
    for (; j < lines.length; j++) {
      const candidate = lines[j]!
      const closing = new RegExp(`^ {0,3}${char === '`' ? '`' : '~'}{${marker.length},}\\s*$`)
      if (closing.test(candidate)) {
        closed = true
        break
      }
      body.push(indent > 0 ? candidate.replace(new RegExp(`^ {0,${indent}}`), '') : candidate)
    }
    if (!closed) {
      diagnostics.push({ level: 'warn', message: 'Unclosed fence, treated as prose', line: i + 1 })
      prose.push(line)
      continue
    }

    const parsed = parseInfoString(info, diagnostics, i + 1)
    if (parsed.hasAttrs && isKernel(parsed.lang)) declaresRuntpt = true
    const executable = isKernel(parsed.lang) && (parsed.hasAttrs || settings.cells === 'all')
    const sourceText = body.join('\n')

    if (!executable) {
      if (isKernel(parsed.lang)) inertFences.push({ kernel: parsed.lang, line: i + 1 })
      // Verbatim means the original lines: `body` has been de-indented for the
      // cell path, and re-emitting it between still-indented fence markers broke
      // the markdown that followed an indented snippet.
      prose.push(...lines.slice(i, j + 1))
      i = j
      continue
    }

    flushProse(i)
    const partial = {
      kernel: parsed.lang as CellKernel,
      source: sourceText,
      hash: cellHash(sourceText),
      attrs: parsed.attrs,
      info,
      startLine: i + 1,
      endLine: j + 1,
    }
    const { id, explicitId } = assignId(partial, taken, diagnostics)
    taken.add(id)

    const cell: Cell = { ...partial, id, explicitId, index: cells.length }
    cells.push(cell)
    blocks.push({ kind: 'cell', cell })

    i = j
    proseStart = i + 1
  }
  flushProse(lines.length)

  for (const cell of cells) {
    for (const dep of cell.attrs.depends) {
      if (!taken.has(dep)) {
        diagnostics.push({
          level: 'error',
          message: `Cell "${cell.id}" depends on unknown cell "${dep}"`,
          line: cell.startLine,
        })
      }
    }
  }

  const title = asString(fm.data?.title) ?? firstHeading(blocks)

  return {
    settings,
    frontmatter: fm.data,
    frontmatterRaw: fm.raw,
    blocks,
    cells,
    declaresRuntpt,
    inertFences,
    source,
    diagnostics,
    ...(title ? { title } : {}),
  }
}

function firstHeading(blocks: Block[]): string | undefined {
  for (const block of blocks) {
    if (block.kind !== 'prose') continue
    const m = /^#\s+(.+)$/m.exec(block.markdown)
    if (m) return m[1]!.trim()
  }
  return undefined
}
