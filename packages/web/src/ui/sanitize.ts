import { defaultSchema } from 'rehype-sanitize'
import type { Element, Parent, Root, RootContent } from 'hast'
import { ALERT_CLASSES } from './alerts.js'

/** Palette classes a `style="color:…"` may be folded into. */
export const COLOR_CLASSES = ['md-fg-danger', 'md-fg-warn', 'md-fg-ok', 'md-fg-accent', 'md-fg-muted'] as const
export type ColorClass = (typeof COLOR_CLASSES)[number]

const NAMED: Array<[RegExp, ColorClass]> = [
  [/^(red|crimson|firebrick|darkred|tomato|indianred)$/i, 'md-fg-danger'],
  [/^(orange|orangered|gold|goldenrod|yellow|darkorange)$/i, 'md-fg-warn'],
  [/^(green|lime|limegreen|seagreen|teal|darkgreen)$/i, 'md-fg-ok'],
  [/^(blue|royalblue|dodgerblue|steelblue|navy|cyan|deepskyblue)$/i, 'md-fg-accent'],
]

function hexChannels(color: string): [number, number, number] | null {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color)?.[1]
  if (!hex) return null
  const full = hex.length === 3 ? [...hex].map((c) => c + c) : [hex.slice(0, 2), hex.slice(2, 4), hex.slice(4, 6)]
  return full.map((c) => parseInt(c, 16)) as [number, number, number]
}

export function colorClassOf(raw: string): ColorClass {
  const color = raw.trim().toLowerCase()
  for (const [re, cls] of NAMED) if (re.test(color)) return cls

  const rgb = hexChannels(color)
  if (!rgb) return 'md-fg-muted'
  const [r, g, b] = rgb
  if (r > g + 40 && r > b + 40) return g > 120 ? 'md-fg-warn' : 'md-fg-danger'
  if (g > r + 40 && g > b + 40) return 'md-fg-ok'
  if (b > r + 40 && b > g + 40) return 'md-fg-accent'
  return 'md-fg-muted'
}

const COLORABLE = new Set(['span', 'b', 'i', 'code', 'sup', 'sub'])

function fold(element: Element): void {
  const style = element.properties?.style
  if (typeof style !== 'string') return
  delete element.properties.style
  if (!COLORABLE.has(element.tagName)) return

  const color = /(?:^|;)\s*color\s*:\s*([^;]+)/i.exec(style)?.[1]
  if (!color) return
  const existing = element.properties.className
  const classes = Array.isArray(existing) ? existing.map(String) : existing ? [String(existing)] : []
  element.properties.className = [...classes, colorClassOf(color)]
}

function walk(node: Root | RootContent): void {
  if (node.type === 'element') fold(node)
  if ('children' in node) for (const child of (node as Parent).children) walk(child as RootContent)
}

/**
 * `style` is dropped by the sanitizer: there is no CSS parser behind it, so
 * `url(javascript:…)` and absolute positioning would ride along with the colour.
 * A colour still carries intent in a procedure — red means danger — so it is
 * folded into a palette class first, and the emphasis survives the attribute.
 */
export function rehypeColorClass() {
  return (tree: Root): void => walk(tree)
}

const INLINE = ['span', 'b', 'i', 'code', 'kbd', 'sup', 'sub', 'br']

/**
 * A runbook is repository content, not a trusted template: anything outside this
 * list is dropped, including every `on*` handler and any non-http(s) URL.
 */
export const SANITIZE_SCHEMA = {
  ...defaultSchema,
  tagNames: [...new Set([...(defaultSchema.tagNames ?? []), 'details', 'summary', 'img', ...INLINE])],
  attributes: {
    ...defaultSchema.attributes,
    details: ['open'],
    summary: [],
    kbd: [],
    br: [],
    span: [['className', ...COLOR_CLASSES]],
    b: [['className', ...COLOR_CLASSES]],
    i: [['className', ...COLOR_CLASSES]],
    sup: [['className', ...COLOR_CLASSES]],
    sub: [['className', ...COLOR_CLASSES]],
    // One entry per attribute: a second `className` definition would never be reached.
    code: [['className', /^language-./, ...COLOR_CLASSES]],
    div: [...(defaultSchema.attributes?.div ?? []), ['className', ...ALERT_CLASSES]],
    p: [...(defaultSchema.attributes?.p ?? []), ['className', ...ALERT_CLASSES]],
    img: ['src', 'alt', 'title'],
    input: [['type', 'checkbox'], 'checked', 'disabled'],
  },
  protocols: {
    ...defaultSchema.protocols,
    src: ['http', 'https'],
    href: ['http', 'https', 'mailto'],
  },
}
