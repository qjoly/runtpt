import type { Block, ProseBlock, Runbook, Slide, SlideMode } from './model.js'

const HR_RE = /^ {0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/
const H1_RE = /^#\s+(.+)$/
const H2_RE = /^##\s+(.+)$/
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/

/** A break marker inside a code snippet is part of the snippet, not a slide boundary. */
function outsideFences(markdown: string): boolean[] {
  const lines = markdown.split('\n')
  const flags: boolean[] = []
  let open: string | null = null

  for (const line of lines) {
    const fence = FENCE_RE.exec(line)
    if (open === null && fence) {
      open = fence[1]![0]!
      flags.push(false)
      continue
    }
    if (open !== null) {
      flags.push(false)
      if (new RegExp(`^ {0,3}${open === '`' ? '`' : '~'}{3,}\\s*$`).test(line)) open = null
      continue
    }
    flags.push(true)
  }
  return flags
}

interface Counts {
  hr: number
  h1: number
  h2: number
}

function countMarkers(blocks: Block[]): Counts {
  const counts: Counts = { hr: 0, h1: 0, h2: 0 }
  for (const block of blocks) {
    if (block.kind !== 'prose') continue
    const lines = block.markdown.split('\n')
    const live = outsideFences(block.markdown)
    lines.forEach((line, i) => {
      if (!live[i]) return
      if (HR_RE.test(line)) counts.hr++
      else if (H2_RE.test(line)) counts.h2++
      else if (H1_RE.test(line)) counts.h1++
    })
  }
  return counts
}

/**
 * What `auto` resolves to. A divider is an explicit instruction, so it wins.
 * Otherwise sections become slides, preferring the level that actually repeats:
 * a README with one `#` title and ten `##` splits on the `##`.
 */
export function resolveSlideMode(runbook: Runbook): Exclude<SlideMode, 'auto'> {
  const declared = runbook.settings.presentation.slides
  if (declared !== 'auto') return declared

  const counts = countMarkers(runbook.blocks)
  if (counts.hr > 0) return 'hr'
  if (counts.h2 > 1) return 'h2'
  if (counts.h1 > 1) return 'h1'
  return 'hr'
}

interface Segment {
  blocks: Block[]
  title?: string
}

export function buildSlides(runbook: Runbook): Slide[] {
  const mode = resolveSlideMode(runbook)
  const segments: Segment[] = []
  let current: Segment = { blocks: [] }

  const push = (): void => {
    const hasContent =
      current.blocks.some((b) => b.kind !== 'prose') ||
      current.blocks.some((b) => b.kind === 'prose' && b.markdown.trim() !== '')
    if (hasContent || current.title) segments.push(current)
    current = { blocks: [] }
  }

  for (const block of runbook.blocks) {
    if (block.kind !== 'prose') {
      current.blocks.push(block)
      continue
    }

    const lines = block.markdown.split('\n')
    const live = outsideFences(block.markdown)
    let buffer: string[] = []
    let start = block.startLine

    const flush = (endLine: number): void => {
      if (buffer.join('').trim() === '') {
        buffer = []
        return
      }
      current.blocks.push({ kind: 'prose', markdown: buffer.join('\n'), startLine: start, endLine })
      buffer = []
      start = endLine
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!

      if (live[i] && mode === 'hr' && HR_RE.test(line)) {
        flush(block.startLine + i)
        push()
        continue
      }

      const heading = live[i] ? (mode === 'h1' ? H1_RE.exec(line) : mode === 'h2' ? H2_RE.exec(line) : null) : null
      if (heading) {
        flush(block.startLine + i)
        push()
        current.title = heading[1]!.trim()
      }
      buffer.push(line)
    }
    flush(block.endLine)
  }
  push()

  return segments.map((segment, index) => ({
    index,
    blocks: segment.blocks.filter((b) => b.kind !== 'notes'),
    notes: segment.blocks
      .filter((b): b is Extract<Block, { kind: 'notes' }> => b.kind === 'notes')
      .map((b) => b.text),
    ...(segment.title ? { title: segment.title } : {}),
  }))
}

/** Cells marked `hidden` are setup steps, not slide content. */
export function visibleBlocks(slide: Slide): Block[] {
  return slide.blocks.filter((b) => !(b.kind === 'cell' && b.cell.attrs.hidden))
}

export type { ProseBlock }
