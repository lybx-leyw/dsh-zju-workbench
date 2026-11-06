/**
 * Runtime layer contract (#869): what a learner produces while taking a
 * course — conversations, quiz attempts, playback facts. Runtime data does
 * not travel with the document; it is persisted per learner by a
 * `RuntimeStore` (`@openmaic/storage`, Part B of #869) and is exportable as
 * a replay. This module owns only the *envelope* and the skeletons of the
 * core kinds; payload internals are app-owned and injected via generics,
 * exactly like widened scene content on `DocumentStore<TScene>` (#860).
 *
 * Two-level model, deliberately:
 *
 * - A {@link RuntimeSession} is the unit of identity and lifecycle. It owns
 *   the `(stageId, learnerKey, kind)` dimensions and the status ladder. A
 *   document has many sessions — one or more per learner.
 * - A {@link RuntimeRecord} is an ordered fact inside one session. Ordering
 *   is the store-assigned monotonic {@link RuntimeRecord.seq}, never client
 *   timestamps (multiple tabs and clock skew make wall clocks unreliable
 *   for replay). Timestamps are display metadata.
 *
 * Anchors are best-effort: documents are editable, so a `sceneId` /
 * `actionIndex` written yesterday may dangle after today's edit. Consumers
 * (replay, summaries) MUST tolerate missing or stale anchors.
 *
 * Timestamps here are ISO 8601 strings — a deliberate divergence from the
 * document aggregate's epoch-millisecond numbers. The runtime contract
 * standardizes on ISO (#869), so do NOT mix the two encodings when merging a
 * runtime feed with document data: convert at the boundary, never compare a
 * runtime `createdAt` string against a document's numeric timestamp directly.
 *
 * Versioning: a session carries its OWN version field, `runtimeDslVersion`
 * (distinct from a document's `dslVersion`), and rides its OWN version line —
 * `RUNTIME_DSL_VERSION` + `migrateRuntime`, not the document's `DSL_VERSION` +
 * `migrate`. The stamp is **required** on a session: sessions are born stamped
 * at write time and the runtime line has **no unversioned epoch** (nothing
 * legitimately predates this brand-new envelope, unlike real pre-versioning
 * documents). So an unstamped object reaching the runtime line is a bug — a
 * misrouted legacy document or an unstamped producer write — and fails loud
 * (`noRuntimeEpochError`) rather than being lifted like a legacy document. The
 * two lines stamp different envelope fields, so neither ladder reads the other's
 * version — but disjoint fields alone would still let a misrouted session be
 * lifted (as unversioned) on the document line. The cross-line guard in
 * `runLadder` closes this: a runner throws on any aggregate that carries the
 * sibling line's stamp but not its own, surfacing the misroute instead of
 * guessing — and vice versa (see `version.ts`).
 *
 * No runtime dependencies. Pure types + plain data constants only.
 */
import type { RuntimeVersioned } from './version.js';
/**
 * Lifecycle of a session. Records carry no lifecycle of their own — a chat
 * message or an answered question is a fact, not a state machine.
 *
 * - `active`: the learner may still append records.
 * - `completed`: closed normally; eligible for replay export.
 * - `archived`: kept for history but hidden from default listings.
 */
export type RuntimeSessionStatus = 'active' | 'completed' | 'archived';
/** All session statuses, in lifecycle order. */
export declare const RUNTIME_SESSION_STATUSES: readonly ["active", "completed", "archived"];
/** Narrow an unknown value to a valid {@link RuntimeSessionStatus}. */
export declare function isRuntimeSessionStatus(value: unknown): value is RuntimeSessionStatus;
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
export declare function isIsoTimestamp(value: string): boolean;
/**
 * The core runtime kind *names* the contract recognizes — the ones Part B
 * migrates first. `RuntimeSession.kind` is an open `string`, so apps define
 * their own kinds without touching the contract; these are just the recognized
 * ones. Note this is about kind *names*, not skeletons: the DSL ships payload
 * skeletons for `chat` and `quizAttempt` only. `playback` has NO skeleton by
 * design — its payload is app-owned; only the kind name is contract-recognized.
 */
export type CoreRuntimeKind = 'chat' | 'quizAttempt' | 'playback';
/** All core runtime kinds. */
export declare const CORE_RUNTIME_KINDS: readonly ["chat", "quizAttempt", "playback"];
/** Narrow an unknown value to a valid {@link CoreRuntimeKind}. */
export declare function isCoreRuntimeKind(value: unknown): value is CoreRuntimeKind;
/**
 * The unit of learner-runtime identity and lifecycle. Sessions are keyed by
 * `(stageId, learnerKey)` plus a `kind`; a learner may hold several sessions
 * of the same kind on one stage (e.g. repeated quiz attempts).
 *
 * Extends {@link RuntimeVersioned} but **overrides its stamp to required**: a
 * session carries a `runtimeDslVersion` serialized-contract stamp — a DIFFERENT
 * envelope field from a document's `dslVersion`. Sessions are **born stamped**:
 * producers write `RUNTIME_DSL_VERSION` at creation and there is no unversioned
 * epoch on the runtime line (nothing legitimately predates the envelope), so a
 * stored session always carries the stamp; an absent one is a transient
 * in-memory state at most, never valid stored data. Stamping + migrate-on-read
 * run on the runtime line only: a session is migrated by `migrateRuntime`,
 * independent of the document's `DSL_VERSION` / `migrate`. The two stamps live on
 * distinct fields so neither ladder reads the other's; the cross-line guard in
 * `runLadder` turns a misrouted migration into a loud error rather than
 * corruption — a runner throws on any aggregate stamped on the sibling line but
 * not its own — while a wholly-unstamped object hitting the runtime line throws
 * `noRuntimeEpochError` (no legacy lift), and `validateRuntimeSession` rejects
 * both a missing `runtimeDslVersion` and a stray `dslVersion` at the door
 * (see `version.ts`).
 */
export interface RuntimeSession extends RuntimeVersioned {
    id: string;
    /**
     * Runtime-contract version this session was written at. Required: sessions are
     * born stamped with `RUNTIME_DSL_VERSION`; the runtime line has no unversioned
     * epoch, so this narrows {@link RuntimeVersioned}'s optional field to mandatory.
     */
    runtimeDslVersion: string;
    /** {@link CoreRuntimeKind} or an app-defined kind. */
    kind: string;
    stageId: string;
    /**
     * Opaque principal string — the DSL does not own auth. Deployments choose
     * the shape (an anonymous device key, an account id, …); stores treat it
     * as an exact-match partition key.
     */
    learnerKey: string;
    status: RuntimeSessionStatus;
    /** ISO 8601. */
    createdAt: string;
    /** ISO 8601. */
    updatedAt: string;
}
/**
 * The set of values a {@link RuntimeRecord.payload} may hold: any value EXCEPT
 * `undefined`. `null` is deliberately included — it is a legal stored payload an
 * app may deliberately persist, and {@link validateRuntimeRecord} accepts it.
 *
 * `NonNullable<unknown>` is `{}` (every non-nullish value) without the banned
 * bare-`{}` literal; unioning `null` back in yields "anything but `undefined`".
 * This aligns the static type with the runtime validator, which rejects
 * `payload: undefined` but accepts `null` — a plain `unknown` payload would let
 * `payload: undefined` type-check yet fail at append time.
 */
export type RuntimePayload = NonNullable<unknown> | null;
/**
 * One ordered fact inside a session. Identity, learner and lifecycle live on
 * the parent {@link RuntimeSession}; the record carries only ordering,
 * anchoring, and the app-owned payload.
 */
export interface RuntimeRecord<TPayload extends RuntimePayload = RuntimePayload> {
    id: string;
    /** Parent {@link RuntimeSession.id}. */
    sessionId: string;
    /**
     * Per-session monotonic sequence, assigned by the store on append. The
     * sole replay ordering key — never order by timestamp.
     */
    seq: number;
    /** Best-effort anchor into the document timeline; may dangle after edits. */
    sceneId?: string;
    /** Best-effort anchor; index into the anchored scene's actions. */
    actionIndex?: number;
    /**
     * App-defined sub-anchor below the scene/action granularity (e.g. a quiz
     * question id or a PBL microtask id). Opaque to the DSL.
     */
    subAnchor?: string;
    /** ISO 8601. Display metadata only — see {@link RuntimeRecord.seq}. */
    createdAt: string;
    /** App-owned payload; validation is injected per kind, like scene content. */
    payload: TPayload;
}
/**
 * The shape a producer hands to a store's `append`: a {@link RuntimeRecord}
 * minus its `seq`. Ordering is store-owned — `seq` is the per-session monotonic
 * key the store assigns on append and cannot be supplied by the caller — so the
 * creation type omits it structurally rather than trusting producers to leave
 * it out (and to leave it consistent across concurrent appenders).
 */
export type RuntimeRecordInit<TPayload extends RuntimePayload = RuntimePayload> = Omit<RuntimeRecord<TPayload>, 'seq'>;
/** Speaker roles the replay renderer can rely on for `chat` records. */
export type ChatRuntimeRole = 'user' | 'assistant' | 'system';
/** All chat roles. */
export declare const CHAT_RUNTIME_ROLES: readonly ["user", "assistant", "system"];
/** Narrow an unknown value to a valid {@link ChatRuntimeRole}. */
export declare function isChatRuntimeRole(value: unknown): value is ChatRuntimeRole;
/**
 * Minimal payload skeleton for `chat` records — just enough structure for a
 * replay renderer (who spoke, what text). Apps extend with their own fields
 * (attachments, tool traces, …) by intersection.
 */
export interface ChatMessageSkeleton {
    role: ChatRuntimeRole;
    content: string;
}
/**
 * Narrow an unknown value to a {@link ChatMessageSkeleton}: an object whose
 * `role` is a recognized {@link ChatRuntimeRole} and whose `content` is a
 * string. Structural subset only — app-added fields are ignored, matching how
 * apps extend the skeleton by intersection. Pure, no runtime deps.
 */
export declare function isChatMessageSkeleton(value: unknown): value is ChatMessageSkeleton;
/**
 * Phases of a quiz attempt. Mirrors the lifecycle the browser app expresses
 * today by creating/deleting storage keys (draft → submitted → reviewed),
 * made explicit so downstream consumers can reason about *when* and *in
 * which attempt* an answer was given.
 */
export type QuizAttemptPhase = 'draft' | 'submitted' | 'reviewed';
/** All quiz attempt phases, in lifecycle order. */
export declare const QUIZ_ATTEMPT_PHASES: readonly ["draft", "submitted", "reviewed"];
/** Narrow an unknown value to a valid {@link QuizAttemptPhase}. */
export declare function isQuizAttemptPhase(value: unknown): value is QuizAttemptPhase;
/**
 * Minimal payload skeleton for `quizAttempt` records. Answers are keyed by
 * question id; grading detail and scoring algorithms are app-owned.
 */
export interface QuizAttemptSkeleton {
    phase: QuizAttemptPhase;
    answers: Record<string, unknown>;
}
/**
 * Narrow an unknown value to a {@link QuizAttemptSkeleton}: an object whose
 * `phase` is a recognized {@link QuizAttemptPhase} and whose `answers` is a
 * plain object (the id→answer map — not an array or null). Structural subset
 * only; the answer values themselves stay app-owned. Pure, no runtime deps.
 */
export declare function isQuizAttemptSkeleton(value: unknown): value is QuizAttemptSkeleton;
//# sourceMappingURL=runtime.d.ts.map