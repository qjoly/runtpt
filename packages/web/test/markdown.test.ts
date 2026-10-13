import { describe, expect, it } from 'vitest'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkRehype from 'remark-rehype'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import type { Element, Node, Parent, Root } from 'hast'
import { ALERT_TYPES, alertTypeOf, remarkAlerts } from '../src/ui/alerts.js'
import { SANITIZE_SCHEMA, colorClassOf, rehypeColorClass } from '../src/ui/sanitize.js'
import { buildChecklistIndex, deriveCheckId, mergeChecks, scanChecklist } from '../src/runbook/checklist.js'
import type { CheckRecord } from '@runtpt/format'

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkAlerts)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeRaw)
  .use(rehypeColorClass)
  .use(rehypeSanitize, SANITIZE_SCHEMA)

const render = (markdown: string): Root => processor.runSync(processor.parse(markdown)) as unknown as Root

const elements = (node: Node, tagName: string): Element[] => {
  const found: Element[] = []
  const walk = (n: Node) => {
    if (n.type === 'element' && (n as Element).tagName === tagName) found.push(n as Element)
    if ('children' in n) for (const child of (n as Parent).children) walk(child)
  }
  walk(node)
  return found
}

const text = (node: Node): string => {
  if (node.type === 'text') return (node as { value: string }).value
  if ('children' in node) return (node as Parent).children.map(text).join('')
  return ''
}

describe('github alerts', () => {
  it('detects the five types', () => {
    for (const type of ALERT_TYPES) {
      expect(alertTypeOf(`[!${type.toUpperCase()}]\nbody`)).toBe(type)
    }
  })

  it('leaves a plain blockquote plain', () => {
    expect(alertTypeOf('just a quote')).toBeNull()
    expect(alertTypeOf('[!SOMETHING] else')).toBeNull()
    // The marker must be alone on its line, as GitHub requires.
    expect(alertTypeOf('[!NOTE] inline')).toBeNull()
    expect(elements(render('> a plain quote\n'), 'blockquote').length).toBe(1)
  })

  it('turns a marker into a labelled block and drops the literal text', () => {
    const tree = render('> [!CAUTION]\n> do not do this\n')
    expect(elements(tree, 'blockquote').length).toBe(0)
    const alert = elements(tree, 'div')[0]
    expect(alert?.properties.className).toEqual(['md-alert', 'md-alert-caution'])
    expect(text(tree)).toContain('CAUTION')
    expect(text(tree)).not.toContain('[!CAUTION]')
  })
})

describe('sanitizer', () => {
  it('strips script and event handlers', () => {
    const tree = render('<script>alert(1)</script>\n\n<span onclick="steal()">x</span>\n')
    expect(elements(tree, 'script').length).toBe(0)
    expect(text(tree)).not.toContain('alert(1)')
    expect(elements(tree, 'span')[0]?.properties.onClick).toBeUndefined()
  })

  it('drops javascript: links', () => {
    const tree = render('[go](javascript:alert(1))\n')
    expect(elements(tree, 'a')[0]?.properties.href).toBeUndefined()
  })

  it('keeps details and summary', () => {
    const tree = render('<details>\n<summary>more</summary>\n\nbody\n\n</details>\n')
    expect(elements(tree, 'details').length).toBe(1)
    expect(text(elements(tree, 'summary')[0]!)).toBe('more')
  })

  it('folds a colour style into a palette class instead of keeping style', () => {
    const tree = render('<span style="color:red">danger</span>\n')
    const span = elements(tree, 'span')[0]
    expect(span?.properties.style).toBeUndefined()
    expect(span?.properties.className).toEqual(['md-fg-danger'])
  })

  it('buckets colours it does not know as muted', () => {
    expect(colorClassOf('#0b0')).toBe('md-fg-ok')
    expect(colorClassOf('var(--whatever)')).toBe('md-fg-muted')
  })
})

describe('checklist ids', () => {
  const doc = '# Title\n\n- [ ] Confirm the kluster is down\n- [x] Decide to fail over\n'

  it('is stable across renders of the same text', () => {
    expect(scanChecklist(doc).map((i) => i.id)).toEqual(scanChecklist(doc).map((i) => i.id))
    expect(deriveCheckId('Confirm the kluster is down')).toBe(scanChecklist(doc)[0]!.id)
  })

  it('survives a paragraph inserted above', () => {
    const shifted = 'a new paragraph\n\n' + doc
    expect(scanChecklist(shifted).map((i) => i.id)).toEqual(scanChecklist(doc).map((i) => i.id))
    expect(scanChecklist(shifted)[0]!.line).not.toBe(scanChecklist(doc)[0]!.line)
  })

  it('disambiguates identical labels, document-wide', () => {
    const index = buildChecklistIndex(['- [ ] Check pods\n', '- [ ] Check pods\n- [ ] Check nodes\n'])
    const ids = index.items.map((i) => i.id)
    expect(new Set(ids).size).toBe(3)
    expect(ids[0]).toBe(deriveCheckId('Check pods', 0))
    expect(ids[1]).toBe(deriveCheckId('Check pods', 1))
    // Adding a twin later must not move the first one.
    expect(ids[0]).toBe(scanChecklist('- [ ] Check pods\n')[0]!.id)
  })

  it('ignores task-looking lines inside a fence, and reads the ticked state', () => {
    const items = scanChecklist('- [x] done\n\n```bash\n- [ ] not a task\n```\n')
    expect(items.map((i) => i.text)).toEqual(['done'])
    expect(items[0]!.checked).toBe(true)
  })

  it('normalises whitespace before hashing', () => {
    expect(scanChecklist('-   [ ]   two   words  \n')[0]!.id).toBe(deriveCheckId('two words'))
  })
})

describe('check state merge', () => {
  const record = (id: string, checked: boolean): CheckRecord => ({
    t: 'check',
    id,
    text: id,
    checked,
    at: '2026-01-01T00:00:00.000Z',
  })

  it('pairs records with items and reports the ones no longer in the runbook', () => {
    const items = scanChecklist('- [ ] a\n- [ ] b\n')
    const state = new Map([
      [items[0]!.id, record(items[0]!.id, true)],
      ['chk-gone', record('chk-gone', true)],
    ])
    const { merged, orphans } = mergeChecks(items, state)
    expect(merged[0]!.record?.checked).toBe(true)
    expect(merged[1]!.record).toBeUndefined()
    expect(orphans.map((o) => o.id)).toEqual(['chk-gone'])
  })
})
