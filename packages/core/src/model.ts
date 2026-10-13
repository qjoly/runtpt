import type { KernelId } from '@runtpt/protocol'

export type OutputHint = 'text' | 'json' | 'table' | 'chart'

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
  /** Attributes we did not recognise, surfaced as warnings but kept. */
  unknown: Record<string, string | true>
}

export interface Cell {
  id: string
  /** False when the id was derived from the content hash. */
  explicitId: boolean
  kernel: KernelId
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

export interface RuntptSettings {
  shell: KernelId
  cwd?: string
  env: Record<string, string>
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

export interface Runbook {
  title?: string
  settings: RuntptSettings
  frontmatter: Record<string, unknown> | null
  frontmatterRaw: string | null
  blocks: Block[]
  cells: Cell[]
  source: string
  diagnostics: Diagnostic[]
}

export const DEFAULT_SETTINGS: RuntptSettings = {
  shell: 'bash',
  env: {},
  params: [],
  presentation: { theme: 'default', slides: 'hr' },
}
