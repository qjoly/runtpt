import { memo } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import type { Element } from 'hast'
import { Image } from './Image.js'
import { remarkAlerts } from './alerts.js'
import { SANITIZE_SCHEMA, rehypeColorClass } from './sanitize.js'
import type { ChecklistItem } from '../runbook/checklist.js'

export interface ChecklistView {
  itemAt: (line: number) => ChecklistItem | undefined
  checked: (item: ChecklistItem) => boolean
  /** ISO timestamp of the recorded tick, when there is one. */
  at?: (item: ChecklistItem) => string | undefined
  note?: (item: ChecklistItem) => string | undefined
  readOnly: boolean
  onToggle?: (item: ChecklistItem, checked: boolean) => void
}

const REMARK = [remarkGfm, remarkAlerts]
const REHYPE = [rehypeRaw, rehypeColorClass, [rehypeSanitize, SANITIZE_SCHEMA]] as never

const isTask = (node: Element | undefined): boolean => {
  const className = node?.properties?.className
  return Array.isArray(className) && className.includes('task-list-item')
}

const BASE: Components = {
  img: ({ src, alt, title }) => <Image src={src} alt={alt} title={title} />,
}

function checklistComponents(view: ChecklistView): Components {
  return {
    ...BASE,
    // The generated checkbox is replaced wholesale by the interactive one below.
    input: () => null,
    li: ({ node, children, className, ...rest }) => {
      const line = node?.position?.start.line
      const item = isTask(node) && line !== undefined ? view.itemAt(line) : undefined
      if (!item) {
        return (
          <li className={className} {...rest}>
            {children}
          </li>
        )
      }
      const at = view.at?.(item)
      const note = view.note?.(item)
      return (
        <li className={`${className ?? ''} check-item`.trim()} {...rest}>
          <label title={at ? `ticked ${new Date(at).toLocaleString()}` : undefined}>
            <input
              type="checkbox"
              checked={view.checked(item)}
              disabled={view.readOnly}
              onChange={(event) => view.onToggle?.(item, event.target.checked)}
            />
            <span className="check-label">{children}</span>
          </label>
          {at && <span className="meta check-at">{new Date(at).toLocaleTimeString()}</span>}
          {note && <span className="chip">{note}</span>}
        </li>
      )
    },
  }
}

/** Memoised: react-markdown re-parses on every render, and a focus change re-renders the page. */
export const Markdown = memo(function Markdown({ text, checklist }: { text: string; checklist?: ChecklistView }) {
  return (
    <div className="prose">
      <ReactMarkdown
        remarkPlugins={REMARK}
        rehypePlugins={REHYPE}
        components={checklist ? checklistComponents(checklist) : BASE}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
})
