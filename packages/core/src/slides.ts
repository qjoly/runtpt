import type { Block, Runbook, Slide } from './model.js'

const HR_RE = /^ {0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/
const H1_RE = /^#\s+(.+)$/
const H2_RE = /^##\s+(.+)$/

interface Segment {
  blocks: Block[]
  title?: string
}

/**
 * Splits prose on the configured boundary. Cells are never split, and a cell
 * block simply joins whichever slide is currently open.
 */
export function buildSlides(runbook: Runbook): Slide[] {
  const mode = runbook.settings.presentation.slides
  const segments: Segment[] = []
  let current: Segment = { blocks: [] }

  const push = () => {
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
    let buffer: string[] = []
    let start = block.startLine

    const flush = (endLine: number) => {
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

      if (mode === 'hr' && HR_RE.test(line)) {
        flush(block.startLine + i)
        push()
        continue
      }

      const heading = mode === 'h1' ? H1_RE.exec(line) : mode === 'h2' ? H2_RE.exec(line) : null
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
    notes: segment.blocks.filter((b): b is Extract<Block, { kind: 'notes' }> => b.kind === 'notes').map((b) => b.text),
    ...(segment.title ? { title: segment.title } : {}),
  }))
}

/** Cells marked `hidden` are setup steps, not slide content. */
export function visibleBlocks(slide: Slide): Block[] {
  return slide.blocks.filter((b) => !(b.kind === 'cell' && b.cell.attrs.hidden))
}
