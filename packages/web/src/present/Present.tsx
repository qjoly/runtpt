import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildSlides, type Block, type Cell, type Runbook } from '@runtpt/core'
import { useAssets } from '../assets/context.js'
import { Markdown } from '../ui/Markdown.js'
import { OutputView } from '../runbook/OutputView.js'
import type { Runner } from '../runbook/useRunner.js'
import { openChannel, type PresentMessage } from './channel.js'
import { blocksUpTo, slideMarkdown, stepsOf } from './slides.js'
import { downloadDeck, exportDeck } from './deckExport.js'

interface Props {
  runbook: Runbook
  runner: Runner
  canRun: boolean
  canReplay: (cellId: string) => boolean
  onRun: (cell: Cell) => void
  onExit: () => void
}

function SlideCell({
  cell,
  runner,
  focused,
  canRun,
  canReplay,
  onFocus,
  onRun,
}: {
  cell: Cell
  runner: Runner
  focused: boolean
  canRun: boolean
  canReplay: boolean
  onFocus: () => void
  onRun: () => void
}) {
  const state = runner.stateOf(cell.id)
  return (
    <div className={`slide-cell ${focused ? 'focused' : ''} ${state.phase}`} onMouseDown={onFocus}>
      <pre className="source">{runner.resolve(cell)}</pre>
      <div className="slide-cell-bar">
        <span className={`status ${state.phase}`}>{state.phase}</span>
        {state.durationMs !== null && <span className="meta">{state.durationMs} ms</span>}
        <span className="spacer" />
        {state.phase === 'running' ? (
          <button className="danger small" onClick={runner.cancel}>
            Cancel
          </button>
        ) : (
          <>
            {canReplay && (
              <button className="ghost small" onClick={() => runner.replayCell(cell)}>
                Replay (r)
              </button>
            )}
            <button className="primary small" disabled={!canRun} onClick={onRun}>
              Run (⏎)
            </button>
          </>
        )}
      </div>
      <OutputView chunks={state.chunks} dense />
    </div>
  )
}

export function Present({ runbook, runner, canRun, canReplay, onRun, onExit }: Props) {
  const slides = useMemo(() => buildSlides(runbook), [runbook])
  const assets = useAssets()
  const [index, setIndex] = useState(0)
  const [step, setStep] = useState(0)
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [echo, setEcho] = useState(0)
  const channel = useRef<BroadcastChannel | null>(null)
  const startedAt = useRef(Date.now())

  const slide = slides[index]
  const steps = slide ? stepsOf(slide).length : 1
  const blocks: Block[] = slide ? blocksUpTo(slide, step) : []
  const cellsHere = blocks.filter((b): b is Extract<Block, { kind: 'cell' }> => b.kind === 'cell')

  // One key does both jobs: reveal the next step, then move to the next slide.
  const advance = useCallback(
    (delta: number) => {
      const currentSlide = slides[index]
      const count = currentSlide ? stepsOf(currentSlide).length : 1
      const nextStep = step + delta
      if (nextStep >= 0 && nextStep < count) {
        setStep(nextStep)
        return
      }
      const nextIndex = index + delta
      if (nextIndex < 0 || nextIndex >= slides.length) return
      setIndex(nextIndex)
      const target = slides[nextIndex]
      setStep(delta > 0 ? 0 : (target ? stepsOf(target).length - 1 : 0))
      setFocusedId(null)
    },
    [index, slides, step],
  )

  // The channel outlives every navigation: re-opening it would blank the presenter.
  const latestAdvance = useRef(advance)
  latestAdvance.current = advance

  useEffect(() => {
    const ch = openChannel((msg: PresentMessage) => {
      if (msg.t === 'next') latestAdvance.current(1)
      else if (msg.t === 'prev') latestAdvance.current(-1)
      else if (msg.t === 'ping') setEcho((n) => n + 1)
    })
    channel.current = ch
    return () => {
      ch.postMessage({ t: 'closed' } satisfies PresentMessage)
      ch.close()
    }
  }, [])

  useEffect(() => {
    channel.current?.postMessage({
      t: 'state',
      index,
      total: slides.length,
      step,
      steps,
      title: slide?.title ?? runbook.title ?? '',
      nextTitle: slides[index + 1]?.title ?? '',
      currentMarkdown: slideMarkdown(slide),
      nextMarkdown: slideMarkdown(slides[index + 1]),
      notes: slide?.notes ?? [],
      startedAt: startedAt.current,
    } satisfies PresentMessage)
  }, [index, step, steps, slide, slides, runbook.title, echo])

  const focusedCell = cellsHere.find((b) => b.cell.id === focusedId)?.cell ?? cellsHere[0]?.cell

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      switch (event.key) {
        case 'Escape':
          onExit()
          break
        case 'ArrowRight':
        case 'PageDown':
        case ' ':
          event.preventDefault()
          advance(1)
          break
        case 'ArrowLeft':
        case 'PageUp':
          event.preventDefault()
          advance(-1)
          break
        case 'ArrowDown':
        case 'j': {
          const at = cellsHere.findIndex((b) => b.cell.id === focusedCell?.id)
          const next = cellsHere[Math.min(at + 1, cellsHere.length - 1)]
          if (next) setFocusedId(next.cell.id)
          break
        }
        case 'ArrowUp':
        case 'k': {
          const at = cellsHere.findIndex((b) => b.cell.id === focusedCell?.id)
          const prev = cellsHere[Math.max(at - 1, 0)]
          if (prev) setFocusedId(prev.cell.id)
          break
        }
        case 'Enter':
          if (focusedCell && canRun) onRun(focusedCell)
          break
        case 'r':
          if (focusedCell) runner.replayCell(focusedCell)
          break
        case 'c':
          runner.cancel()
          break
        default:
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [advance, canRun, cellsHere, focusedCell, onExit, onRun, runner])

  return (
    <div className="deck" data-theme={runbook.settings.presentation.theme}>
      <div className="deck-bar">
        <span className="meta">
          {index + 1} / {slides.length}
          {steps > 1 && ` · reveal ${step + 1}/${steps}`}
        </span>
        <span className="spacer" />
        <button className="ghost small" onClick={() => window.open(`${location.pathname}#presenter`, 'runtpt-presenter', 'width=900,height=640')}>
          Presenter view
        </button>
        <button
          className="ghost small"
          onClick={() =>
            downloadDeck(
              `${(runbook.title ?? 'deck').replace(/\W+/g, '-').toLowerCase()}.html`,
              exportDeck({
                title: runbook.title ?? 'runtpt deck',
                slides,
                states: runner.states,
                resolve: runner.resolveText,
                assets,
              }),
            )
          }
        >
          Export HTML
        </button>
        <button className="ghost small" onClick={onExit}>
          Exit (Esc)
        </button>
      </div>

      <section className="slide current">
        <div className="slide-inner">
          {blocks.map((block, i) => {
            if (block.kind === 'prose') return <Markdown key={i} text={block.markdown} />
            if (block.kind !== 'cell') return null
            return (
              <SlideCell
                key={block.cell.id}
                cell={block.cell}
                runner={runner}
                canRun={canRun}
                canReplay={canReplay(block.cell.id)}
                focused={focusedCell?.id === block.cell.id}
                onFocus={() => setFocusedId(block.cell.id)}
                onRun={() => onRun(block.cell)}
              />
            )
          })}
        </div>
      </section>
    </div>
  )
}
