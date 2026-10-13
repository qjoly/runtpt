import { visibleBlocks, type Block, type Slide } from '@runtpt/core'

/** `<!-- runtpt:pause -->` splits a slide into incremental reveals. */
export function stepsOf(slide: Slide): Block[][] {
  const steps: Block[][] = [[]]
  for (const block of visibleBlocks(slide)) {
    if (block.kind === 'directive' && block.name === 'pause') {
      steps.push([])
      continue
    }
    steps[steps.length - 1]!.push(block)
  }
  return steps.filter((step, i) => i === 0 || step.length > 0)
}

export function blocksUpTo(slide: Slide, step: number): Block[] {
  const steps = stepsOf(slide)
  return steps.slice(0, step + 1).flat()
}

export function slideMarkdown(slide: Slide | undefined): string {
  if (!slide) return ''
  return visibleBlocks(slide)
    .map((block) => {
      if (block.kind === 'prose') return block.markdown
      if (block.kind === 'cell') return '```' + block.cell.kernel + '\n' + block.cell.source + '\n```'
      return ''
    })
    .join('\n\n')
    .trim()
}
