import type { Cell, ResolvedKernel } from '@runtpt/core'
import { kernelBadge } from './badge.js'

const basename = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

/** Short enough to read at a glance in a page full of cells; honest about aliases. */
export function KernelBadge({ cell, resolved }: { cell: Pick<Cell, 'kernel'>; resolved: ResolvedKernel }) {
  const badge = kernelBadge(cell, resolved)
  // `/bin/zsh` under a `zsh` badge says nothing twice; `/usr/bin/python3.12` does.
  const tail = badge.interpreter ? basename(badge.interpreter) : ''
  const interpreterName = tail && tail !== badge.kernel ? tail : null
  return (
    <span className={`kernel k-${badge.kernel} ${badge.from ? 'derived' : ''}`} title={badge.title}>
      {badge.from && (
        <>
          <span className="kernel-from">{badge.from}</span>
          <span className="kernel-arrow">→</span>
        </>
      )}
      {badge.kernel}
      {interpreterName && <span className="kernel-path">{interpreterName}</span>}
    </span>
  )
}
