import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { RunRecording } from '@runtpt/format'
import { readRuntpt } from '@runtpt/format'
import { describe, expect, it } from 'vitest'
import { runHeadless, type HeadlessOptions } from '../src/headless.js'
import { which } from '../src/kernels/detect.js'

const bash = which('bash')
const sh = which('sh')
const zsh = which('zsh')

const describeShell = bash && sh ? describe : describe.skip

function workspace(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'runtpt-shell-'))
}

async function run(
  dir: string,
  body: string,
  opts: Partial<HeadlessOptions> = {},
): Promise<RunRecording> {
  const runbookPath = path.join(dir, 'runbook.md')
  writeFileSync(runbookPath, body, 'utf8')
  const out = path.join(dir, 'run.runtpt')
  await runHeadless({ runbookPath, out, log: () => {}, ...opts })
  return readRuntpt(readFileSync(out, 'utf8'))
}

function stdout(recording: RunRecording, id: string): string {
  const outputs = recording.byId.get(id)?.outputs ?? []
  return outputs.filter((o) => o.stream === 'stdout').map((o) => o.data).join('')
}

describeShell('shell alias and interpreters', () => {
  it('runs a shell cell under the shell the runbook configured', async () => {
    const dir = workspace()
    const recording = await run(dir, [
      '---',
      'runtpt:',
      '  shell: sh',
      '---',
      '',
      '```shell run id=alias',
      'echo "$0"',
      '```',
      '',
    ].join('\n'))

    expect(stdout(recording, 'alias').trim()).toBe(sh)
    // The recording must name what ran, not the alias.
    expect(recording.byId.get('alias')?.kernel).toBe('sh')
  })

  it('lets --shell redirect a shell cell', async () => {
    if (!zsh) return
    const dir = workspace()
    const recording = await run(
      dir,
      ['---', 'runtpt:', '  shell: bash', '---', '', '```shell run id=alias', 'echo "$0"', '```', ''].join('\n'),
      { shell: { kernel: 'zsh' } },
    )

    expect(stdout(recording, 'alias')).toContain(zsh)
    expect(recording.byId.get('alias')?.kernel).toBe('zsh')
  })

  it('leaves a cell that pinned its kernel alone when --shell is given', async () => {
    const dir = workspace()
    const recording = await run(
      dir,
      ['```bash run id=pinned', 'echo "$0"', '```', ''].join('\n'),
      { shell: { kernel: 'sh', path: sh! } },
    )

    expect(stdout(recording, 'pinned').trim()).toBe(bash)
    expect(recording.byId.get('pinned')?.kernel).toBe('bash')
  })

  it('spawns the interpreter a cell asked for', async () => {
    const dir = workspace()
    const recording = await run(dir, [
      '```bash run id=default',
      'echo "$0"',
      '```',
      '',
      `\`\`\`bash run id=pinned interpreter=${sh}`,
      'echo "$0"',
      '```',
      '',
    ].join('\n'))

    expect(stdout(recording, 'default').trim()).toBe(bash)
    expect(stdout(recording, 'pinned').trim()).toBe(sh)
  })

  it('gives two interpreters of the same kernel two independent sessions', async () => {
    const dir = workspace()
    const twin = path.join(dir, 'bash-twin')
    symlinkSync(bash!, twin)

    const recording = await run(dir, [
      `\`\`\`bash run id=first interpreter=${bash}`,
      'export RUNTPT_SPLIT=yes',
      'echo first',
      '```',
      '',
      `\`\`\`bash run id=second depends=first interpreter=${twin}`,
      'echo "[${RUNTPT_SPLIT:-absent}]"',
      '```',
      '',
    ].join('\n'))

    expect(recording.byId.get('first')?.status).toBe('ok')
    expect(stdout(recording, 'second').trim()).toBe('[absent]')
  })

  it('merges --env above the runbook env and below the parameters', async () => {
    const dir = workspace()
    const recording = await run(
      dir,
      [
        '---',
        'runtpt:',
        '  env:',
        '    RUNTPT_FROM: frontmatter',
        '  params:',
        '    - name: RUNTPT_PARAM',
        '      default: from-param',
        '---',
        '',
        '```bash run id=env',
        'echo "$RUNTPT_FROM $RUNTPT_ONLY_FLAG $RUNTPT_PARAM"',
        '```',
        '',
      ].join('\n'),
      { env: { RUNTPT_FROM: 'from-flag', RUNTPT_ONLY_FLAG: 'flag', RUNTPT_PARAM: 'from-flag' } },
    )

    expect(stdout(recording, 'env').trim()).toBe('from-flag flag from-param')
  })
})
