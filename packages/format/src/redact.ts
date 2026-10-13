/** Below this length a secret matches too much unrelated output to be useful. */
export const MIN_REDACTABLE = 4

/**
 * Redaction happens before anything is written or sent, so a `.runtpt` on disk
 * is never more revealing than what was displayed.
 */
export class Redactor {
  private entries: { value: string; name: string }[] = []

  /** Returns false when the value was refused, so the caller can warn. */
  add(name: string, value: string): boolean {
    // Very short values would redact half the output; not worth the false positives.
    if (value.length < MIN_REDACTABLE) return false
    if (this.entries.some((e) => e.value === value && e.name === name)) return true
    this.entries.push({ name, value })
    // Longest first, so an overlapping shorter secret cannot split a longer one.
    this.entries.sort((a, b) => b.value.length - a.value.length)
    return true
  }

  /** Names whose value was too short to be redacted safely. */
  addAll(values: Record<string, string>): string[] {
    const refused: string[] = []
    for (const [name, value] of Object.entries(values)) {
      if (!this.add(name, value)) refused.push(name)
    }
    return refused
  }

  clear(): void {
    this.entries = []
  }

  get size(): number {
    return this.entries.length
  }

  apply(text: string): string {
    if (this.entries.length === 0) return text
    let out = text
    for (const { name, value } of this.entries) {
      out = out.split(value).join(`«redacted:${name}»`)
    }
    return out
  }
}
