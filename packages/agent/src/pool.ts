import type { KernelId } from '@runtpt/protocol'
import { createSession } from './kernels/index.js'
import type { KernelSession } from './kernels/types.js'

/** One session per kernel id, created on first use and kept until shutdown. */
export class KernelPool {
  private readonly sessions = new Map<KernelId, KernelSession>()

  constructor(private readonly opts: { cwd: string; env?: Record<string, string> }) {}

  async get(kernel: KernelId): Promise<KernelSession> {
    const existing = this.sessions.get(kernel)
    if (existing) return existing
    const session = createSession(kernel, this.opts)
    this.sessions.set(kernel, session)
    await session.start()
    return session
  }

  peek(kernel: KernelId): KernelSession | undefined {
    return this.sessions.get(kernel)
  }

  async restart(kernel: KernelId): Promise<void> {
    const existing = this.sessions.get(kernel)
    if (!existing) return
    await existing.restart()
  }

  disposeAll(): void {
    for (const session of this.sessions.values()) session.dispose()
    this.sessions.clear()
  }
}
