/**
 * Redaction happens before anything is written or sent, so a `.runtpt` on disk
 * is never more revealing than what was displayed.
 */
export class Redactor {
  private entries: { value: string; name: string }[] = []

  add(name: string, value: string): void {
    // Very short values would redact half the output; not worth the false positives.
    if (value.length < 4) return
    if (this.entries.some((e) => e.value === value && e.name === name)) return
    this.entries.push({ name, value })
    // Longest first, so an overlapping shorter secret cannot split a longer one.
    this.entries.sort((a, b) => b.value.length - a.value.length)
  }

  addAll(values: Record<string, string>): void {
    for (const [name, value] of Object.entries(values)) this.add(name, value)
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
