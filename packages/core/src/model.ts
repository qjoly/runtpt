import type { KernelId } from '@runtpt/protocol'

export type OutputHint = 'text' | 'json' | 'table' | 'chart'

/**
 * `shell` is a document-level alias resolved against the runbook's configured
 * shell. Every other name pins a concrete interpreter, so a cell badged `bash`
 * never turns out to have run zsh.
 */
export type CellKernel = KernelId | 'shell'

export interface ShellChoice {
  kernel: 'bash' | 'sh' | 'zsh'
  /** Explicit interpreter path, when the runbook asked for one. */
  path?: string
}

export interface CellAttrs {
  /** Explicit opt-in flag. A fence with no attribute at all stays inert. */
  run: boolean
  id?: string
  name?: string
  timeoutMs?: number
  depends: string[]
  continueOnError: boolean
  confirm: boolean
  hidden: boolean
  cwd?: string
  output?: OutputHint
  interactive: boolean
  /** Overrides the interpreter for this cell only. */
  interpreter?: string
  /** Attributes we did not recognise, surfaced as warnings but kept. */
  unknown: Record<string, string | true>
}

export interface Cell {
  id: string
  /** False when the id was derived from the content hash. */
  explicitId: boolean
  kernel: CellKernel
  source: string
  hash: string
  attrs: CellAttrs
  info: string
  startLine: number
  endLine: number
  /** Index in `Runbook.cells`. */
  index: number
}

export interface ProseBlock {
  kind: 'prose'
  markdown: string
  startLine: number
  endLine: number
}

export interface CellBlock {
  kind: 'cell'
  cell: Cell
}

export interface NotesBlock {
  kind: 'notes'
  text: string
  startLine: number
  endLine: number
}

export interface DirectiveBlock {
  kind: 'directive'
  name: string
  arg?: string
  startLine: number
  endLine: number
}

export type Block = ProseBlock | CellBlock | NotesBlock | DirectiveBlock

export interface ParamSpec {
  name: string
  prompt?: string
  default?: string
  secret: boolean
  required: boolean
  /** Restricts the input to a fixed set in the UI. */
  options?: string[]
}

export interface PresentationSettings {
  theme: string
  slides: 'hr' | 'h1' | 'h2'
}

/**
 * `tagged` (the default) keeps a plain fence inert, so existing documentation does
 * not become executable by being opened. `all` is the opt-in for a runbook written
 * as ordinary markdown: annotating several hundred fences by hand is not a plan.
 */
export type CellMode = 'tagged' | 'all'

export interface RuntptSettings {
  cells: CellMode
  shell: ShellChoice
  cwd?: string
  env: Record<string, string>
  /** Explicit interpreter path per kernel, e.g. `python: /usr/bin/python3.12`. */
  interpreters: Partial<Record<KernelId, string>>
  params: ParamSpec[]
  presentation: PresentationSettings
}

export interface Diagnostic {
  level: 'warn' | 'error'
  message: string
  line?: number
}

export interface Slide {
  index: number
  blocks: Block[]
  title?: string
  notes: string[]
}

/** A fence of a known kernel that stayed inert because nothing opted it in. */
export interface InertFence {
  kernel: CellKernel
  line: number
}

export interface Runbook {
  title?: string
  settings: RuntptSettings
  frontmatter: Record<string, unknown> | null
  frontmatterRaw: string | null
  blocks: Block[]
  cells: Cell[]
  /** Runnable-looking fences left inert; the reason a runbook can have no cells. */
  inertFences: InertFence[]
  source: string
  diagnostics: Diagnostic[]
}

export const DEFAULT_SETTINGS: RuntptSettings = {
  cells: 'tagged',
  shell: { kernel: 'bash' },
  env: {},
  interpreters: {},
  params: [],
  presentation: { theme: 'default', slides: 'hr' },
}
