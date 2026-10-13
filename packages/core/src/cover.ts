import type { Slide } from './model.js'
import { visibleBlocks } from './slides.js'

/** Longest a line of standfirst prose may be before it reads as body copy. */
const MAX_PARAGRAPH_CHARS = 240
const MAX_PARAGRAPHS = 2

const H1 = /^#\s+\S/
const ANY_HEADING = /^#{1,6}\s/
const LIST = /^\s{0,3}(?:[-*+]\s|\d+[.)]\s)/
const QUOTE = /^\s{0,3}>/
const FENCE = /^\s{0,3}(?:`{3,}|~{3,})/
const BREAK = /^ {0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/
const TABLE = /\|/
const IMAGE = /!\[/
const HTML = /<[a-z!/]/i

/**
 * True when a slide is a title and nothing more: one `#` heading, then at most
 * two short paragraphs. Anything else a deck can put on a slide — a cell, a
 * list, a table, a second heading, a code fence, an image — is content, and
 * content is not a cover. This is what `cover: auto` consults, so the rule is
 * deliberately narrow: a deck only gets a cover when it clearly wanted one.
 */
export function isCoverSlide(slide: Slide): boolean {
  const blocks = visibleBlocks(slide)
  if (blocks.length === 0) return false
  if (blocks.some((block) => block.kind !== 'prose')) return false

  const lines = blocks
    .map((block) => (block.kind === 'prose' ? block.markdown : ''))
    .join('\n')
    .split('\n')

  let seenH1 = false
  const paragraphs: string[] = []
  let current: string[] = []

  const flush = (): void => {
    if (current.length > 0) paragraphs.push(current.join(' ').trim())
    current = []
  }

  for (const line of lines) {
    const text = line.trim()
    if (text === '') {
      flush()
      continue
    }
    if (FENCE.test(line) || BREAK.test(line) || LIST.test(line) || QUOTE.test(line)) return false
    if (TABLE.test(text) || IMAGE.test(text) || HTML.test(text)) return false

    if (ANY_HEADING.test(text)) {
      if (seenH1 || !H1.test(text) || paragraphs.length > 0 || current.length > 0) return false
      seenH1 = true
      continue
    }
    current.push(text)
  }
  flush()

  if (!seenH1) return false
  if (paragraphs.length > MAX_PARAGRAPHS) return false
  return paragraphs.every((p) => p.length <= MAX_PARAGRAPH_CHARS)
}
