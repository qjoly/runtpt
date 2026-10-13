export const PRESENT_CHANNEL = 'runtpt-present'

export interface PresenterState {
  t: 'state'
  index: number
  total: number
  step: number
  steps: number
  title: string
  nextTitle: string
  currentMarkdown: string
  nextMarkdown: string
  notes: string[]
  startedAt: number
}

export type PresentMessage = PresenterState | { t: 'ping' } | { t: 'next' } | { t: 'prev' } | { t: 'closed' }

export function openChannel(onMessage: (msg: PresentMessage) => void): BroadcastChannel {
  const channel = new BroadcastChannel(PRESENT_CHANNEL)
  channel.onmessage = (event: MessageEvent<PresentMessage>) => onMessage(event.data)
  return channel
}
