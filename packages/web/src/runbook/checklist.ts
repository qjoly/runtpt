import { sha256 } from '@runtpt/core'
import type { CheckRecord } from '@runtpt/format'

export interface ChecklistItem {
  id: string
  /** The label as written, whitespace-normalised. */
  text: string
  /** 1-based line inside the markdown block it was scanned from. */
  line: number
  /** What the document itself says, before any operator tick. */
  checked: boolean
  /** 0 for the first item carrying this label in the document. */
  occurrence: number
}

const TASK_RE = /^ {0,8}(?:[-*+]|\d{1,9}[.)])\s+\[([ xX])\]\s+(.+)$/
const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/

export function normaliseLabel(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * Position-independent so that inserting a paragraph above an item leaves its id
 * alone; the occurrence suffix only moves when a twin label appears before it.
 */
export function deriveCheckId(text: string, occurrence = 0): string {
  const digest = sha256(normaliseLabel(text)).slice(0, 12)
  return occurrence === 0 ? `chk-${digest}` : `chk-${digest}-${occurrence + 1}`
}

/** `counts` is shared across the blocks of one document so twins are numbered document-wide. */
export function scanChecklist(markdown: string, counts = new Map<string, number>()): ChecklistItem[] {
  const items: ChecklistItem[] = []
  let fence: string | null = null

  markdown.split('\n').forEach((line, index) => {
    const fenceMatch = FENCE_RE.exec(line)
    if (fenceMatch) {
      const marker = fenceMatch[1]!
      if (fence === null) fence = marker[0]!
      else if (marker[0] === fence) fence = null
      return
    }
    if (fence !== null) return

    const match = TASK_RE.exec(line)
    if (!match) return
    const text = normaliseLabel(match[2]!)
    const occurrence = counts.get(text) ?? 0
    counts.set(text, occurrence + 1)
    items.push({
      id: deriveCheckId(text, occurrence),
      text,
      line: index + 1,
      checked: match[1] !== ' ',
      occurrence,
    })
  })

  return items
}

export interface ChecklistIndex {
  items: ChecklistItem[]
  /** Same length and order as the markdowns handed in. */
  byBlock: ChecklistItem[][]
}

export function buildChecklistIndex(markdowns: string[]): ChecklistIndex {
  const counts = new Map<string, number>()
  const byBlock = markdowns.map((markdown) => (markdown ? scanChecklist(markdown, counts) : []))
  return { items: byBlock.flat(), byBlock }
}

export function lineIndexOf(items: ChecklistItem[]): Map<number, ChecklistItem> {
  return new Map(items.map((item) => [item.line, item]))
}

export interface MergedCheck {
  item: ChecklistItem
  record?: CheckRecord
}

export interface ChecklistMerge {
  merged: MergedCheck[]
  /** Ticked in the recording, absent from the runbook as it stands now. */
  orphans: CheckRecord[]
}

export function mergeChecks(items: ChecklistItem[], state: Map<string, CheckRecord>): ChecklistMerge {
  const seen = new Set<string>()
  const merged = items.map((item) => {
    seen.add(item.id)
    const record = state.get(item.id)
    return record ? { item, record } : { item }
  })
  const orphans = [...state.values()].filter((record) => !seen.has(record.id))
  return { merged, orphans }
}
