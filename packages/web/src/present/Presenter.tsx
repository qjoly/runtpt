import { useEffect, useRef, useState } from 'react'
import { Markdown } from '../ui/Markdown.js'
import { openChannel, type PresentMessage, type PresenterState } from './channel.js'

function elapsed(from: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - from) / 1000))
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
  const ss = String(seconds % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

/** Second window, synced over a BroadcastChannel. It never renders the deck itself. */
export function Presenter() {
  const [state, setState] = useState<PresenterState | null>(null)
  const [now, setNow] = useState(Date.now())
  const channel = useRef<BroadcastChannel | null>(null)

  useEffect(() => {
    const ch = openChannel((msg: PresentMessage) => {
      if (msg.t === 'state') setState(msg)
      else if (msg.t === 'closed') setState(null)
    })
    channel.current = ch
    ch.postMessage({ t: 'ping' } satisfies PresentMessage)
    const timer = window.setInterval(() => setNow(Date.now()), 500)
    return () => {
      window.clearInterval(timer)
      ch.close()
    }
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight' || event.key === ' ') channel.current?.postMessage({ t: 'next' })
      else if (event.key === 'ArrowLeft') channel.current?.postMessage({ t: 'prev' })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!state) {
    return (
      <div className="presenter empty">
        <p>Waiting for a presentation. Press P in the main window.</p>
      </div>
    )
  }

  return (
    <div className="presenter">
      <header className="presenter-bar">
        <strong>{state.title || 'runtpt'}</strong>
        <span className="spacer" />
        <span className="meta">
          slide {state.index + 1}/{state.total}
          {state.steps > 1 && ` · reveal ${state.step + 1}/${state.steps}`}
        </span>
        <span className="timer">{elapsed(state.startedAt, now)}</span>
      </header>

      <div className="presenter-grid">
        <section className="presenter-current">
          <h3>Current</h3>
          <Markdown text={state.currentMarkdown} />
        </section>
        <section className="presenter-next">
          <h3>Next {state.nextTitle && <span className="meta">{state.nextTitle}</span>}</h3>
          <Markdown text={state.nextMarkdown || '_end of the deck_'} />
        </section>
        <section className="presenter-notes">
          <h3>Notes</h3>
          {state.notes.length === 0 ? (
            <p className="hint">No speaker notes on this slide.</p>
          ) : (
            state.notes.map((note, i) => <Markdown key={i} text={note} />)
          )}
        </section>
      </div>

      <footer className="presenter-foot">
        <button className="ghost" onClick={() => channel.current?.postMessage({ t: 'prev' })}>
          ← Previous
        </button>
        <button className="primary" onClick={() => channel.current?.postMessage({ t: 'next' })}>
          Next →
        </button>
      </footer>
    </div>
  )
}
