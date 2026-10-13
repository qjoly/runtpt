import { useMemo } from 'react'
import type { OutChunk } from './useRunner.js'

const MAX_LINES = 2000

interface Segment {
  stream: 'stdout' | 'stderr'
  text: string
}

/** Consecutive chunks of the same stream are one block; display payloads stand alone. */
function segment(chunks: OutChunk[]): { text: Segment[]; rich: OutChunk[] } {
  const text: Segment[] = []
  const rich: OutChunk[] = []
  for (const chunk of chunks) {
    if (chunk.stream === 'display') {
      rich.push(chunk)
      continue
    }
    const last = text[text.length - 1]
    if (last && last.stream === chunk.stream) last.text += chunk.data
    else text.push({ stream: chunk.stream, text: chunk.data })
  }
  return { text, rich }
}

function Rich({ chunk }: { chunk: OutChunk }) {
  const mime = chunk.mime ?? 'text/plain'
  if (mime.startsWith('image/')) {
    const src = chunk.encoding === 'base64' ? `data:${mime};base64,${chunk.data}` : chunk.data
    return <img className="out-image" src={src} alt="cell output" />
  }
  if (mime === 'text/html') return <div className="out-html" dangerouslySetInnerHTML={{ __html: chunk.data }} />
  return <pre className="out stdout">{chunk.data}</pre>
}

export function OutputView({ chunks, dense }: { chunks: OutChunk[]; dense?: boolean }) {
  const { text, rich, hidden } = useMemo(() => {
    const parts = segment(chunks)
    const total = parts.text.reduce((n, s) => n + s.text.split('\n').length, 0)
    if (total <= MAX_LINES) return { ...parts, hidden: 0 }

    // Keep the tail: the end of a command is what the operator is looking at.
    let budget = MAX_LINES
    const kept: Segment[] = []
    for (let i = parts.text.length - 1; i >= 0 && budget > 0; i--) {
      const part = parts.text[i]!
      const lines = part.text.split('\n')
      if (lines.length <= budget) {
        kept.unshift(part)
        budget -= lines.length
      } else {
        kept.unshift({ stream: part.stream, text: lines.slice(lines.length - budget).join('\n') })
        budget = 0
      }
    }
    return { text: kept, rich: parts.rich, hidden: total - MAX_LINES }
  }, [chunks])

  if (chunks.length === 0) return null

  return (
    <div className={dense ? 'output dense' : 'output'}>
      {hidden > 0 && (
        <div className="out-truncated">
          showing the last {MAX_LINES} lines — {hidden} earlier lines are in the .runtpt
        </div>
      )}
      {text.map((part, i) => (
        <pre key={i} className={`out ${part.stream}`}>
          {part.text}
        </pre>
      ))}
      {rich.map((chunk, i) => (
        <Rich key={`r${i}`} chunk={chunk} />
      ))}
    </div>
  )
}
