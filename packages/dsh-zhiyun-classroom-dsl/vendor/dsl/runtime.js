/** All session statuses, in lifecycle order. */
export const RUNTIME_SESSION_STATUSES = [
    'active',
    'completed',
    'archived',
];
const _runtimeSessionStatusesExhaustive = true;
void _runtimeSessionStatusesExhaustive;
/** Narrow an unknown value to a valid {@link RuntimeSessionStatus}. */
export function isRuntimeSessionStatus(value) {
    return RUNTIME_SESSION_STATUSES.includes(value);
}
/**
 * ISO-8601 shape a runtime timestamp string is required to match:
 * `YYYY-MM-DDTHH:mm:ss`, an optional fractional-second part, and a mandatory
 * zone designator (`Z` or `±hh:mm`). Runtime timestamps are display metadata
 * whose only cross-tab guarantee is a comparable, unambiguous instant, so the
 * zone is not optional here — a zoneless string names no instant.
 *
 * Capture groups feed the component-level range check in {@link isIsoTimestamp}:
 * 1 year, 2 month, 3 day, 4 hour, 5 minute, 6 second, 7 optional offset hours,
 * 8 optional offset minutes (groups 7/8 are undefined for the `Z` form).
 */
const ISO_TIMESTAMP_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/;
/** Days in a Gregorian month, applying the full leap-year rule for February. */
function daysInMonth(year, month) {
    const isLeap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const lengths = [31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return lengths[month - 1];
}
/**
 * True when `value` is a well-formed ISO-8601 timestamp per the runtime
 * contract. The runtime envelope has no generated schema artifact backing it
 * (unlike stage/scene/action), so this pure check is where the documented
 * "ISO 8601" promise on `createdAt` / `updatedAt` is actually enforced.
 *
 * The regex pins the *format* (a lone `Date.parse` accepts many non-ISO forms —
 * bare dates, `'2026/01/01'`, even some free text — so it cannot stand in for a
 * format check) and the mandatory zone designator; its capture groups then feed
 * a purely arithmetic component-range check. We deliberately do NOT touch
 * `Date` at all:
 *
 * - `Date.parse` cannot be used to pin calendar validity, because V8 (the CI
 *   Node engine) does not reject calendar-impossible full datetimes — it
 *   NORMALIZES them to a neighbouring real instant. `'2026-02-30T00:00:00.000Z'`
 *   silently becomes March 2 and `'2026-01-01T24:00:00.000Z'` becomes the next
 *   day, both parsing to a finite number rather than `NaN`, so a `Date.parse`
 *   gate would wave calendar-impossible values through. Its verdicts are also
 *   engine-dependent.
 *
 * The component check therefore validates each field directly: month `1..12`;
 * day `1..daysInMonth` under the full Gregorian leap rule (÷4, except centuries
 * unless ÷400); hour `≤ 23`; minute and second `≤ 59` — leap-second `:60` is
 * deliberately rejected; and for a numeric `±hh:mm` zone, offset hours `≤ 23`
 * and offset minutes `≤ 59`.
 *
 * Pure, no runtime dependencies, no `Date` usage.
 */
export function isIsoTimestamp(value) {
    const m = ISO_TIMESTAMP_RE.exec(value);
    if (!m)
        return false;
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    const hour = Number(m[4]);
    const minute = Number(m[5]);
    const second = Number(m[6]);
    if (month < 1 || month > 12)
        return false;
    if (day < 1 || day > daysInMonth(year, month))
        return false;
    if (hour > 23 || minute > 59 || second > 59)
        return false;
    // Numeric zone offset (`Z` leaves groups 7/8 undefined and is always in range).
    if (m[7] !== undefined) {
        if (Number(m[7]) > 23 || Number(m[8]) > 59)
            return false;
    }
    return true;
}
/** All core runtime kinds. */
export const CORE_RUNTIME_KINDS = [
    'chat',
    'quizAttempt',
    'playback',
];
const _coreRuntimeKindsExhaustive = true;
void _coreRuntimeKindsExhaustive;
/** Narrow an unknown value to a valid {@link CoreRuntimeKind}. */
export function isCoreRuntimeKind(value) {
    return CORE_RUNTIME_KINDS.includes(value);
}
/** All chat roles. */
export const CHAT_RUNTIME_ROLES = [
    'user',
    'assistant',
    'system',
];
const _chatRuntimeRolesExhaustive = true;
void _chatRuntimeRolesExhaustive;
/** Narrow an unknown value to a valid {@link ChatRuntimeRole}. */
export function isChatRuntimeRole(value) {
    return CHAT_RUNTIME_ROLES.includes(value);
}
/**
 * Narrow an unknown value to a {@link ChatMessageSkeleton}: an object whose
 * `role` is a recognized {@link ChatRuntimeRole} and whose `content` is a
 * string. Structural subset only — app-added fields are ignored, matching how
 * apps extend the skeleton by intersection. Pure, no runtime deps.
 */
export function isChatMessageSkeleton(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const v = value;
    return isChatRuntimeRole(v.role) && typeof v.content === 'string';
}
/** All quiz attempt phases, in lifecycle order. */
export const QUIZ_ATTEMPT_PHASES = [
    'draft',
    'submitted',
    'reviewed',
];
const _quizAttemptPhasesExhaustive = true;
void _quizAttemptPhasesExhaustive;
/** Narrow an unknown value to a valid {@link QuizAttemptPhase}. */
export function isQuizAttemptPhase(value) {
    return QUIZ_ATTEMPT_PHASES.includes(value);
}
/**
 * Narrow an unknown value to a {@link QuizAttemptSkeleton}: an object whose
 * `phase` is a recognized {@link QuizAttemptPhase} and whose `answers` is a
 * plain object (the id→answer map — not an array or null). Structural subset
 * only; the answer values themselves stay app-owned. Pure, no runtime deps.
 */
export function isQuizAttemptSkeleton(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const v = value;
    return (isQuizAttemptPhase(v.phase) &&
        typeof v.answers === 'object' &&
        v.answers !== null &&
        !Array.isArray(v.answers) &&
        // Require a plain id→answer record: a Map/Date/class instance would pass the
        // object check but hide its entries from `answers[questionId]` consumers.
        (Object.getPrototypeOf(v.answers) === Object.prototype ||
            Object.getPrototypeOf(v.answers) === null));
}
//# sourceMappingURL=runtime.js.map