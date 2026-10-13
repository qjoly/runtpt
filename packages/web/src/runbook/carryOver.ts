/**
 * What survives a reload of the document already on screen.
 *
 * A cell's identity is its id; what its recorded output *describes* is its
 * hash. Keeping an output across a hash change would caption a new command with
 * an old result, so only an untouched cell keeps anything.
 */

export interface CellIdentity {
  id: string
  hash: string
}

export interface CarryOver<S> {
  states: Record<string, S>
  /** Survived by id, emptied because the source behind it changed. */
  cleared: string[]
  /** Gone from the document; their output lives on only in the recording. */
  dropped: string[]
  /** Not in the document before the reload. */
  added: string[]
}

export function carryOverStates<S>(
  previous: Record<string, S>,
  before: CellIdentity[],
  after: CellIdentity[],
): CarryOver<S> {
  const hashBefore = new Map(before.map((cell) => [cell.id, cell.hash]))
  const states: Record<string, S> = {}
  const cleared: string[] = []
  const added: string[] = []

  for (const cell of after) {
    const previousHash = hashBefore.get(cell.id)
    if (previousHash === undefined) {
      added.push(cell.id)
      continue
    }
    const state = previous[cell.id]
    if (previousHash === cell.hash) {
      if (state !== undefined) states[cell.id] = state
      continue
    }
    // Only worth flagging when there was something to lose.
    if (state !== undefined) cleared.push(cell.id)
  }

  const survives = new Set(after.map((cell) => cell.id))
  const dropped = Object.keys(previous).filter((id) => !survives.has(id))

  return { states, cleared, dropped, added }
}

/**
 * Checklist ids are derived from the label, so a reworded item is a different
 * id and loses its tick under the same rule that governs cells.
 */
export function carryOverChecks<R>(previous: Record<string, R>, ids: Iterable<string>): Record<string, R> {
  const kept: Record<string, R> = {}
  for (const id of ids) {
    const record = previous[id]
    if (record !== undefined) kept[id] = record
  }
  return kept
}
