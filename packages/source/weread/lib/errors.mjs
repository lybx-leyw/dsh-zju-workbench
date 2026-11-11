export class SkillError extends Error {
  constructor(code, message, details = {}) { super(message); this.code = code; this.details = details }
  publicResult() { return { ok: false, status: this.code, message: this.message, ...(this.details.public ?? this.details) } }
}
