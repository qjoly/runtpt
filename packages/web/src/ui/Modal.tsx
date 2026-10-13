import { useEffect, type ReactNode } from 'react'

interface Props {
  title: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
}

export function Modal({ title, onClose, children, wide }: Props) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className={wide ? 'modal modal-wide' : 'modal'}
        role="dialog"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h2>{title}</h2>
          <button className="ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}
