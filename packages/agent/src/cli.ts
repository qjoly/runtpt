#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { DEFAULT_AGENT_PORT } from '@runtpt/protocol'
import { parseDuration, parseShellChoice, type Diagnostic, type ShellChoice } from '@runtpt/core'
import { HeadlessError, runHeadless } from './headless.js'
import { AgentServer, AGENT_VERSION } from './server.js'

const USAGE = `runtpt ${AGENT_VERSION}

  runtpt serve [options]            pair with the web app and execute its cells
    --port <n>        default ${DEFAULT_AGENT_PORT}
    --root <dir>      directory the agent is allowed to read and write (default: cwd)
    --origin <url>    extra allowed browser origin (repeatable)
    --web <url>       web app base URL (default: http://localhost:5173)
    --no-open         do not print the ready-to-click URL

  runtpt run <runbook.md> [options] headless run, writes a .runtpt
    --out <file>      output file (default: <runbook>.runtpt)
    --param K=V       parameter value (repeatable)
    --env K=V         extra environment variable (repeatable); wins over the
                      runbook's env, loses to --param
    --shell <name|path>  interpreter for \`shell\` cells; cells that named
                      their own kernel are untouched
    --cwd <dir>       working directory for the kernels
    --timeout <dur>   default per-cell timeout, e.g. 5m
    --yes             also run cells marked \`confirm\`
    --json            machine-readable events on stdout
`

async function main(argv: string[]): Promise<number> {
  const command = argv[0]
  if (command === undefined || command === '--help' || command === '-h' || command === 'help') {
    process.stdout.write(USAGE)
    return command === undefined ? 1 : 0
  }
  if (command === '--version' || command === '-v') {
    process.stdout.write(`${AGENT_VERSION}\n`)
    return 0
  }
  const rest = argv.slice(1)
  // parseArgs rejects unknown options, so --help has to be caught before it.
  if (rest.includes('--help') || rest.includes('-h')) {
    process.stdout.write(USAGE)
    return 0
  }
  if (command === 'serve') return await serve(rest)
  if (command === 'run') return await run(rest)

  process.stderr.write(`runtpt: unknown command "${command}"\n\n${USAGE}`)
  return 2
}

async function serve(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      port: { type: 'string' },
      root: { type: 'string' },
      origin: { type: 'string', multiple: true },
      web: { type: 'string' },
      open: { type: 'boolean', default: true },
    },
    allowNegative: true,
    allowPositionals: false,
  })

  const port = values.port ? Number(values.port) : DEFAULT_AGENT_PORT
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    process.stderr.write(`runtpt: invalid port "${values.port}"\n`)
    return 2
  }

  const server = new AgentServer({
    port,
    ...(values.root ? { root: values.root } : {}),
    ...(values.origin ? { origins: values.origin } : {}),
  })

  try {
    await server.start()
  } catch (err) {
    process.stderr.write(`runtpt: cannot listen on 127.0.0.1:${port} — ${(err as Error).message}\n`)
    return 1
  }

  const ws = `ws://127.0.0.1:${server.port}`
  const web = (values.web ?? 'http://localhost:5173').replace(/\/+$/, '')
  const link = `${web}/#agent=${encodeURIComponent(ws)}&pairing=${encodeURIComponent(server.pairing)}`

  const lines = [
    '',
    '  runtpt agent ready',
    '',
    `  root      ${server.root}`,
    `  listening ${ws}  (loopback only)`,
    `  pairing   ${server.pairing}`,
    '',
  ]
  if (values.open) lines.push(`  open      ${link}`, '')
  lines.push('  Ctrl-C to stop. Cells run as you, in the directory above.', '')
  process.stdout.write(lines.join('\n'))

  await new Promise<void>((resolve) => {
    const stop = (): void => {
      process.stdout.write('\nruntpt: shutting down\n')
      void server.close().then(resolve)
    }
    process.on('SIGINT', stop)
    process.on('SIGTERM', stop)
  })
  return 0
}

async function run(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      out: { type: 'string' },
      param: { type: 'string', multiple: true },
      env: { type: 'string', multiple: true },
      shell: { type: 'string' },
      cwd: { type: 'string' },
      timeout: { type: 'string' },
      yes: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
    },
    allowPositionals: true,
  })

  const runbookPath = positionals[0]
  if (!runbookPath) {
    process.stderr.write('runtpt: run needs a runbook path\n')
    return 2
  }

  const params: Record<string, string> = {}
  for (const pair of values.param ?? []) {
    const eq = pair.indexOf('=')
    if (eq <= 0) {
      process.stderr.write(`runtpt: --param expects NAME=value, got "${pair}"\n`)
      return 2
    }
    params[pair.slice(0, eq)] = pair.slice(eq + 1)
  }

  const env: Record<string, string> = {}
  for (const pair of values.env ?? []) {
    const eq = pair.indexOf('=')
    if (eq <= 0) {
      process.stderr.write(`runtpt: --env expects NAME=value, got "${pair}"\n`)
      return 2
    }
    env[pair.slice(0, eq)] = pair.slice(eq + 1)
  }

  let shell: ShellChoice | undefined
  if (values.shell) {
    const diagnostics: Diagnostic[] = []
    shell = parseShellChoice(values.shell, diagnostics)
    for (const d of diagnostics) process.stderr.write(`runtpt: ${d.message}\n`)
  }

  let defaultTimeoutMs: number | undefined
  if (values.timeout) {
    const ms = parseDuration(values.timeout)
    if (ms === null) {
      process.stderr.write(`runtpt: invalid timeout "${values.timeout}"\n`)
      return 2
    }
    defaultTimeoutMs = ms
  }

  try {
    const result = await runHeadless({
      runbookPath,
      params,
      ...(values.out ? { out: values.out } : {}),
      ...(Object.keys(env).length > 0 ? { env } : {}),
      ...(shell ? { shell } : {}),
      ...(values.cwd ? { cwd: values.cwd } : {}),
      ...(defaultTimeoutMs !== undefined ? { defaultTimeoutMs } : {}),
      yes: values.yes,
      json: values.json,
    })
    return result.exitCode
  } catch (err) {
    if (err instanceof HeadlessError) {
      process.stderr.write(`runtpt: ${err.message}\n`)
      return err.exitCode
    }
    process.stderr.write(`runtpt: ${(err as Error).message}\n`)
    return 1
  }
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code
  })
  .catch((err: unknown) => {
    process.stderr.write(`runtpt: ${(err as Error).message}\n`)
    process.exitCode = 1
  })
