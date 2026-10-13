import type { Blockquote, Paragraph, Root, RootContent, Text } from 'mdast'

export const ALERT_TYPES = ['note', 'tip', 'important', 'warning', 'caution'] as const
export type AlertType = (typeof ALERT_TYPES)[number]

const MARKER_RE = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(\r?\n|$)/

export const ALERT_CLASSES = [
  'md-alert',
  'md-alert-title',
  ...ALERT_TYPES.map((type) => `md-alert-${type}`),
]

/** The leading `[!TYPE]` line of a GitHub alert, or null for an ordinary quote. */
export function alertTypeOf(blockquoteText: string): AlertType | null {
  const first = blockquoteText.replace(/^\s*>?[ \t]?/, '')
  const match = MARKER_RE.exec(first)
  return match ? (match[1]!.toLowerCase() as AlertType) : null
}

const label = (type: AlertType): string => type.toUpperCase()

function stripMarker(paragraph: Paragraph): AlertType | null {
  const first = paragraph.children[0]
  if (!first || first.type !== 'text') return null
  const match = MARKER_RE.exec(first.value)
  if (!match) return null

  const rest = first.value.slice(match[0].length)
  if (rest === '') paragraph.children.shift()
  else (first as Text).value = rest
  return match[1]!.toLowerCase() as AlertType
}

function titleNode(type: AlertType): Paragraph {
  return {
    type: 'paragraph',
    data: { hProperties: { className: ['md-alert-title'] } },
    children: [{ type: 'text', value: label(type) }],
  }
}

function transform(node: Root | RootContent): void {
  if (node.type === 'blockquote') {
    const quote = node as Blockquote
    const head = quote.children[0]
    if (head?.type === 'paragraph') {
      const type = stripMarker(head)
      if (type) {
        if (head.children.length === 0) quote.children.shift()
        quote.children.unshift(titleNode(type))
        quote.data = {
          ...quote.data,
          hName: 'div',
          hProperties: { className: ['md-alert', `md-alert-${type}`] },
        }
      }
    }
  }
  if ('children' in node) for (const child of node.children) transform(child as RootContent)
}

/**
 * Written here rather than pulled in: the published plugins ship GitHub's own
 * class names, octicon SVGs and stylesheet, none of which match this palette.
 */
export function remarkAlerts() {
  return (tree: Root): void => transform(tree)
}
