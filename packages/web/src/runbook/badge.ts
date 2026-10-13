import type { Cell, ResolvedKernel } from '@runtpt/core'
import type { KernelId } from '@runtpt/protocol'

export interface KernelBadge {
  /** What will actually run. */
  kernel: KernelId
  /** The alias the cell declared, when it did not pin a kernel. */
  from?: 'shell'
  interpreter?: string
  title: string
}

/**
 * The badge must never claim a kernel the cell did not get. A `shell` cell shows
 * the derivation (`shell → zsh`) so the alias stays visible after it resolves.
 */
export function kernelBadge(cell: Pick<Cell, 'kernel'>, resolved: ResolvedKernel): KernelBadge {
  const origin =
    cell.kernel === 'shell'
      ? `shell, resolved to ${resolved.kernel} for this session`
      : `${resolved.kernel}, pinned by the cell`
  return {
    kernel: resolved.kernel,
    ...(cell.kernel === 'shell' ? { from: 'shell' as const } : {}),
    ...(resolved.interpreter ? { interpreter: resolved.interpreter } : {}),
    title: resolved.interpreter ? `${origin} — ${resolved.interpreter}` : origin,
  }
}

/** Flat form of the badge, for tests and for anywhere a node is overkill. */
export function badgeLabel(badge: KernelBadge): string {
  const label = badge.from ? `${badge.from} → ${badge.kernel}` : badge.kernel
  return label.toUpperCase()
}
