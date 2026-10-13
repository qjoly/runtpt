import type { KernelId } from '@runtpt/protocol'
import type { Cell, Diagnostic, RuntptSettings, ShellChoice } from './model.js'

export const SHELL_KERNELS = ['bash', 'sh', 'zsh'] as const
export type ShellKernel = (typeof SHELL_KERNELS)[number]

function isShellKernel(name: string): name is ShellKernel {
  return (SHELL_KERNELS as readonly string[]).includes(name)
}

/**
 * Accepts either a name (`zsh`) or a path (`/opt/homebrew/bin/bash`). A path
 * keeps its basename as the kernel so the sentinel protocol knows what dialect
 * it is talking to.
 */
export function parseShellChoice(value: string, diagnostics: Diagnostic[] = []): ShellChoice {
  const trimmed = value.trim()
  if (trimmed === '') return { kernel: 'bash' }

  if (!trimmed.includes('/')) {
    if (isShellKernel(trimmed)) return { kernel: trimmed }
    diagnostics.push({ level: 'warn', message: `Unknown shell "${trimmed}", falling back to bash` })
    return { kernel: 'bash' }
  }

  const base = trimmed.slice(trimmed.lastIndexOf('/') + 1)
  if (isShellKernel(base)) return { kernel: base, path: trimmed }

  // An unrecognised interpreter still runs, but we must not pretend to know its
  // dialect: POSIX sh is the assumption least likely to produce silent nonsense.
  diagnostics.push({
    level: 'warn',
    message: `Unrecognised shell "${base}", assuming POSIX sh semantics`,
  })
  return { kernel: 'sh', path: trimmed }
}

export interface ResolvedKernel {
  /** What will actually run. Never the `shell` alias. */
  kernel: KernelId
  /** Explicit interpreter path, when one was configured. */
  interpreter?: string
  /** True when the cell deferred its kernel to the runbook or session default. */
  inherited: boolean
}

/**
 * Turns a cell's declared kernel into the one the agent will start. The UI shows
 * the result, so `shell` cells can say what they resolved to instead of hiding it.
 */
export function resolveKernel(
  cell: Pick<Cell, 'kernel' | 'attrs'>,
  settings: RuntptSettings,
  override?: ShellChoice | null,
): ResolvedKernel {
  if (cell.kernel === 'shell') {
    const choice = override ?? settings.shell
    const interpreter = cell.attrs.interpreter ?? choice.path
    return { kernel: choice.kernel, inherited: true, ...(interpreter ? { interpreter } : {}) }
  }

  const interpreter = cell.attrs.interpreter ?? settings.interpreters[cell.kernel]
  return { kernel: cell.kernel, inherited: false, ...(interpreter ? { interpreter } : {}) }
}

/** Sessions are per interpreter, not per kernel: two bash paths are two shells. */
export function sessionKey(target: Pick<ResolvedKernel, 'kernel' | 'interpreter'>): string {
  return target.interpreter ? `${target.kernel}:${target.interpreter}` : target.kernel
}
