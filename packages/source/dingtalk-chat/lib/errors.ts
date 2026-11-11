/** An expected failure with a stable status; its result is what the CLI prints. */
export class SkillError extends Error {
  readonly status: string
  readonly details: Record<string, unknown>
  constructor(status: string, message: string, details: Record<string, unknown> = {}) {
    super(message)
    this.name = 'SkillError'
    this.status = status
    this.details = details
  }
  result() { return { ok: false as const, status: this.status, message: this.message, ...this.details } }
}
