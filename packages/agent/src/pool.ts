import { sessionKey } from '@runtpt/core'
import type { KernelId } from '@runtpt/protocol'
import { createSession } from './kernels/index.js'
import type { KernelSession } from './kernels/types.js'

/** What a caller asks the pool for: a kernel, optionally pinned to one binary. */
export interface KernelTarget {
  kernel: KernelId
  interpreter?: string
}

/** One session per kernel *and* interpreter, created on first use and kept until shutdown. */
export class KernelPool {
  private readonly sessions = new Map<string, KernelSession>()

  constructor(private readonly opts: { cwd: string; env?: Record<string, string> }) {}

  async get(target: KernelTarget): Promise<KernelSession> {
    const key = sessionKey(target)
    const existing = this.sessions.get(key)
    if (existing) return existing
    const session = createSession(target.kernel, {
      ...this.opts,
      ...(target.interpreter ? { interpreter: target.interpreter } : {}),
    })
    this.sessions.set(key, session)
    await session.start()
    return session
  }

  peek(target: KernelTarget): KernelSession | undefined {
    return this.sessions.get(sessionKey(target))
  }

  async restart(target: KernelTarget): Promise<void> {
    const existing = this.sessions.get(sessionKey(target))
    if (!existing) return
    await existing.restart()
  }

  /** Called when a browser session ends: its variables must not outlive it. */
  clearInjectedEnv(): void {
    for (const session of this.sessions.values()) session.clearInjectedEnv()
  }

  disposeAll(): void {
    for (const session of this.sessions.values()) session.dispose()
    this.sessions.clear()
  }
}
