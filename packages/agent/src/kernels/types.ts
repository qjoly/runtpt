import type { CellStatus, KernelId } from '@runtpt/protocol'

export interface ExecRequest {
  source: string
  env?: Record<string, string>
  cwd?: string
  timeoutMs?: number
}

export interface ExecSink {
  chunk(stream: 'stdout' | 'stderr', data: string): void
  display?(mime: string, data: string, encoding?: 'base64'): void
}

export interface ExecOutcome {
  status: CellStatus
  exit: number | null
  durationMs: number
}

export interface KernelSession {
  readonly id: KernelId
  start(): Promise<void>
  exec(req: ExecRequest, sink: ExecSink): Promise<ExecOutcome>
  cancel(): void
  /** stdin for interactive cells. */
  write(data: string): void
  restart(): Promise<void>
  dispose(): void
}

export const SENTINEL = '__RUNTPT_END__'

/** Grace between SIGINT and SIGTERM, then between SIGTERM and SIGKILL (FR-E3). */
export const SIGNAL_GRACE_MS = 2000
