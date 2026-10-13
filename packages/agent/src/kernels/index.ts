import type { KernelId } from '@runtpt/protocol'
import { binaryFor, which } from './detect.js'
import { HttpSession } from './http.js'
import { PythonSession } from './python.js'
import { ShellSession } from './shell.js'
import type { KernelSession } from './types.js'

export * from './types.js'
export * from './detect.js'
export * from './sentinel.js'
export { ShellSession, shellQuote } from './shell.js'
export { PythonSession } from './python.js'
export { HttpSession, parseHttpRequest, type HttpRequestSpec } from './http.js'

export function createSession(
  kernel: KernelId,
  opts: { cwd: string; env?: Record<string, string>; interpreter?: string },
): KernelSession {
  if (kernel === 'http') return new HttpSession()
  // An explicit interpreter must be honoured or refused, never quietly replaced
  // by whatever PATH offers under the same kernel name.
  if (opts.interpreter) {
    const resolved = which(opts.interpreter)
    if (!resolved) throw new Error(`interpreter "${opts.interpreter}" is not executable`)
    return kernel === 'python' ? new PythonSession(resolved, opts) : new ShellSession(kernel, resolved, opts)
  }
  const bin = binaryFor(kernel)
  if (!bin) throw new Error(`kernel "${kernel}" is not available on this machine`)
  if (kernel === 'python') return new PythonSession(bin, opts)
  return new ShellSession(kernel, bin, opts)
}
