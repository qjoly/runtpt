import { renderToStaticMarkup } from 'react-dom/server'
import type { Slide } from '@runtpt/core'
import { AssetProvider, type AssetContextValue } from '../assets/context.js'
import { Markdown } from '../ui/Markdown.js'
import { OutputView } from '../runbook/OutputView.js'
import type { CellState } from '../runbook/useRunner.js'
import { stepsOf } from './slides.js'

/** Same-origin stylesheets only, which is all of ours, in dev and in a build. */
function collectCss(): string {
  const parts: string[] = []
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) parts.push(rule.cssText)
    } catch {
      // Cross-origin sheet: nothing we can read, nothing we need.
    }
  }
  return parts.join('\n')
}

const NAV_SCRIPT = `
const slides = [...document.querySelectorAll('.slide')]
let at = 0
const show = () => slides.forEach((s, i) => s.classList.toggle('current', i === at))
addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') at = Math.min(at + 1, slides.length - 1)
  else if (e.key === 'ArrowLeft' || e.key === 'PageUp') at = Math.max(at - 1, 0)
  else return
  e.preventDefault()
  show()
})
show()
`

export function exportDeck(args: {
  title: string
  slides: Slide[]
  states: Record<string, CellState>
  resolve: (source: string) => string
  /** Images already in the cache are inlined; the rest fall back to their alt text. */
  assets: AssetContextValue | null
  /** Pinned into the export: the file must not follow the reader's own choice. */
  theme: string
}): string {
  const tree = (
    <div className="deck export">
      {args.slides.map((slide) => (
        <section key={slide.index} className="slide">
          <div className="slide-inner">
            {stepsOf(slide)
              .flat()
              .map((block, i) => {
                if (block.kind === 'prose') return <Markdown key={i} text={block.markdown} />
                if (block.kind !== 'cell') return null
                const state = args.states[block.cell.id]
                return (
                  <div key={i} className="slide-cell">
                    <pre className="source">{args.resolve(block.cell.source)}</pre>
                    {state && <OutputView chunks={state.chunks} />}
                    {state && (
                      <div className="cell-foot">
                        <span className={`status ${state.phase}`}>{state.phase}</span>
                        {state.exit !== null && <span className="meta">exit {state.exit}</span>}
                      </div>
                    )}
                  </div>
                )
              })}
          </div>
        </section>
      ))}
    </div>
  )

  const body = renderToStaticMarkup(
    args.assets ? <AssetProvider value={{ ...args.assets, mode: 'export' }}>{tree}</AssetProvider> : tree,
  )

  return `<!doctype html>
<html lang="en" data-theme="${escapeAttr(args.theme)}"><head><meta charset="utf-8"><title>${escapeHtml(args.title)}</title>
<style>${collectCss()}
body { margin: 0; background: var(--bg); color: var(--fg); }
.deck.export .slide { display: none; }
.deck.export .slide.current { display: flex; }
</style></head>
<body class="exported-deck">${body}<script>${NAV_SCRIPT}</script></body></html>`
}

function escapeAttr(text: string): string {
  return escapeHtml(text).replace(/"/g, '&quot;')
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] ?? c)
}

export function downloadDeck(name: string, html: string): void {
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
}
