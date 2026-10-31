/**
 * DSL version + migration registry.
 *
 * The DSL version is independent of the npm package version: it identifies the
 * shape of the *serialized* slide contract so that persisted documents can be
 * migrated forward as the schema evolves. A package release can bump for
 * code/API reasons (new exports, refactors) without touching the serialized
 * shape — in which case {@link DSL_VERSION} stays put; conversely the first
 * breaking change to the on-disk shape bumps {@link DSL_VERSION} and appends a
 * migration, regardless of where the package version happens to be.
 *
 * This module owns the *mechanism*: the ordered {@link DSL_MIGRATIONS} ladder,
 * plus the pure {@link migrate} runner that walks a document from whatever
 * version it was written at up to {@link DSL_VERSION}. It carries no runtime
 * dependency, and — like every migration transform — is pure and idempotent.
 *
 * The migratable unit (a {@link Stage} aggregate, a single Scene row, or a
 * bundle of them) is deliberately left open: the runner only needs the
 * {@link DSL_VERSION_KEY} envelope field to read the current version and stamp
 * the new one. Which aggregate carries that field is decided when a normalized
 * store first consumes this pipeline.
 *
 * ---
 *
 * RELEASE RULE, ENFORCED: changing {@link DSL_VERSION} or
 * {@link RUNTIME_DSL_VERSION} requires **an increase of this package's npm
 * version that the dependents' caret range will NOT admit**.
 * `scripts/check-package-version-bumps.mjs` fails the merge if it does not.
 *
 * `@openmaic/storage`, `@openmaic/renderer` and `@openmaic/importer` depend on
 * this package as `workspace:^`, published as a caret. Anything that caret
 * admits reaches them with no release of their own, so the required increase is
 * exactly the one it does not admit:
 *
 * - while this package is `0.x`, `^0.5.1` admits `0.5.x`, so a **MINOR**;
 * - once it reaches `1.0.0`, `^1.4.2` admits minors as well, so a **MAJOR**.
 *
 * The rule is stated as "escapes the caret" rather than as a fixed level
 * because the level changes at the 1.0 boundary — a rule that said MINOR would
 * quietly stop being sufficient exactly when this package matured.
 *
 * Independence from the npm version, described above, is about which way the
 * two numbers may move *apart*: a package release may leave the format alone.
 * The reverse is constrained, for the reason just given.
 *
 * Shipping a format change inside the caret would deliver it silently. The same
 * published `storage` version, resolved against two different admitted dsl
 * versions, would write and then refuse to read the same rows — storage
 * compares these constants by value and rejects anything stamped newer than it
 * knows.
 */
/**
 * Current version of the serialized slide contract.
 *
 * Changing it requires a package version increase that the dependents' caret
 * does not admit; see the module docstring.
 */
export declare const DSL_VERSION: "0.3.0";
export type DslVersion = typeof DSL_VERSION;
/**
 * The version a document is treated as when it carries no {@link DSL_VERSION_KEY}
 * stamp: everything written before the version field existed. The first
 * {@link DSL_MIGRATIONS} entry lifts these legacy documents forward.
 *
 * A **document-line-only** concept. The runtime line has no unversioned epoch —
 * its envelope is brand new and stamped at write time, so it lifts nothing (see
 * {@link RUNTIME_DSL_MIGRATIONS} / {@link noRuntimeEpochError}). This constant
 * therefore names the document line's legacy origin; the runtime runner passes
 * `null` for its legacy version instead of reusing it.
 */
export declare const UNVERSIONED_DSL_VERSION: "0.0.0";
/**
 * The first shipped serialized-contract version — a **pinned literal**, not the
 * moving {@link DSL_VERSION}. Migration endpoints must be immutable: they name a
 * fixed point in the ladder, so they cannot reference `DSL_VERSION` (which moves
 * every time the shape changes). It diverged from `DSL_VERSION` when the first
 * real shape change (the `audioUrl` abolition) appended a step from here.
 */
export declare const INITIAL_DSL_VERSION: "0.1.0";
/**
 * Envelope property that carries the serialized-contract version on a document.
 * Named so producers / stores stamp the same field the runner reads.
 */
export declare const DSL_VERSION_KEY: "dslVersion";
/**
 * Envelope property that carries the serialized-contract version on a runtime
 * session. Mechanically **disjoint** from {@link DSL_VERSION_KEY}: the two
 * version lines stamp different fields, so neither ladder can read, consume, or
 * corrupt the other's stamp.
 *
 * Disjoint keys are necessary but **not sufficient** to protect misrouted
 * data: an object carrying only this key still *lacks* {@link DSL_VERSION_KEY},
 * so the document runner would read it as {@link UNVERSIONED_DSL_VERSION} and
 * walk its legacy ladder over the session — stamping a foreign field and, once
 * a real transform lands, mangling the payload. The cross-line guard in
 * {@link runLadder} closes this: a runner whose own stamp is absent but whose
 * sibling's stamp is present **throws** rather than guessing. See that function
 * for the three-case semantics.
 */
export declare const RUNTIME_DSL_VERSION_KEY: "runtimeDslVersion";
/**
 * A document that may carry a DSL contract-version stamp. `@openmaic/dsl` does
 * not bind this to a specific aggregate (see the module note) — it is the
 * minimal envelope the {@link migrate} runner reads and writes.
 */
export interface DslVersioned {
    /** Serialized-contract version this document was written at. Absent on legacy data. */
    dslVersion?: string;
}
/**
 * A runtime aggregate that **may** carry a runtime-contract version stamp — the
 * envelope-layer type the readers ({@link runtimeDslVersionOf}), predicate
 * ({@link needsRuntimeMigration}), and runner ({@link migrateRuntime}) operate
 * over, all of which accept `unknown` and tolerate an absent stamp at the type
 * level. The runtime counterpart of {@link DslVersioned}, stamped by
 * {@link migrateRuntime} on a **different** envelope field
 * ({@link RUNTIME_DSL_VERSION_KEY}) so the two version lines are
 * byte-distinguishable, not convention-separated.
 *
 * The field is optional *here* because this is the "may carry" envelope view.
 * For a {@link RuntimeSession} the stamp is **required** — sessions are born
 * stamped, there is no unversioned epoch (see {@link RUNTIME_DSL_VERSION}), so an
 * absent `runtimeDslVersion` is only a transient in-memory state before the
 * producer stamps it, never a stored one; a stored session without it is a bug
 * the runtime-line functions and {@link RuntimeSession}'s required override both
 * reject.
 */
export interface RuntimeVersioned {
    /**
     * Runtime-contract version this aggregate was written at. Optional on this
     * envelope view; {@link RuntimeSession} overrides it to required (born stamped,
     * no legacy epoch).
     */
    runtimeDslVersion?: string;
}
/**
 * A pure, synchronous transform from one DSL version to the next. Migrations
 * MUST NOT have side effects and MUST NOT depend on any runtime library. They
 * receive and return the whole document; the runner stamps the `to` version, so
 * a transform need only reshape the payload.
 */
export interface DslMigration {
    /** Version this migration upgrades *from*. */
    from: string;
    /** Version this migration upgrades *to*. */
    to: string;
    /** Pure upgrade transform. */
    migrate: (doc: unknown) => unknown;
}
/**
 * Ordered migration ladder. Each entry's `to` is the next entry's `from`, and
 * the last entry's `to` is {@link DSL_VERSION} (both checked by a test). Every
 * `from` / `to` is a **pinned literal** — never the moving `DSL_VERSION`
 * constant — so appending a future step can't retroactively re-target an
 * existing one.
 *
 * The first entry stamps legacy (pre-`dslVersion`) documents up to
 * {@link INITIAL_DSL_VERSION}. It is intentionally a no-op *transform*: bringing
 * `Action` into the contract (#811) and adding validators (#817) did not alter
 * any serialized document, so the on-disk shape at that point already *was*
 * 0.1.0. The entry exists to wire the pipeline end to end and to give real
 * documents a version stamp to migrate forward from.
 *
 * The second entry stamps the 0.2.0 `audioUrl` abolition. It is a pure stamp
 * like the first: only the app-side reference converter may remove the field,
 * because only it can tell a live handle from a dead one -- see
 * {@link stampAudioUrlAbolition}.
 *
 * The third entry is the ladder's first real payload transform: it strips the
 * stray `rotate` / `height` fields legacy runtimes could persist onto `line`
 * elements, which the 1.0.0 closed canvas schema rejects -- see
 * {@link stripLegacyLineRotateHeight}.
 */
export declare const DSL_MIGRATIONS: readonly DslMigration[];
/**
 * Current version of the serialized *runtime* contract (#869) — the on-disk
 * shape of a {@link RuntimeSession}, NOT the slide document.
 *
 * This is a **deliberately separate version line** from {@link DSL_VERSION},
 * and the separation is mechanical, not by convention: a {@link RuntimeSession}
 * stamps its version on {@link RUNTIME_DSL_VERSION_KEY}, a distinct envelope
 * field from the document's {@link DSL_VERSION_KEY}. The two ladders version
 * independent serialized shapes, so a change to the document (Stage/Scene) shape
 * must never force — or, worse, accidentally *consume* — a runtime step, and
 * vice versa. A `DslMigration` body is an arbitrary whole-document transform;
 * if runtime sessions rode `DSL_MIGRATIONS`, a future real Stage/Scene migration
 * authored against the document shape would run over a `RuntimeSession` and
 * could corrupt or throw.
 *
 * The disjoint stamp fields keep each ladder from reading the other's version,
 * but they do not by themselves stop a misrouted aggregate from being lifted on
 * the wrong line (it simply reads as unversioned there). The cross-line guard in
 * {@link runLadder} closes this: a runner **throws** on any aggregate that
 * carries the *sibling* line's stamp but not its own, so a misrouted document
 * migration surfaces as an error instead of stamping a foreign `dslVersion`
 * onto a runtime session.
 *
 * Unlike {@link DSL_VERSION}, this line has **no unversioned epoch**. Real
 * pre-versioning *documents* exist, so the document line lifts an unstamped
 * document from {@link UNVERSIONED_DSL_VERSION}; nothing legitimately predates
 * the runtime envelope, and the future `RuntimeStore` stamps this version at
 * write time. So an object reaching a runtime-line function *without* a stamp is
 * not legacy data — it is a misrouted legacy document or an unstamped producer
 * write, and fails loud (see {@link noRuntimeEpochError}) rather than being
 * lifted. {@link RUNTIME_DSL_MIGRATIONS} accordingly ships empty.
 *
 * Like {@link DSL_VERSION}, changing this requires a package version increase
 * that the dependents' caret does not admit; see the module docstring for why.
 */
export declare const RUNTIME_DSL_VERSION: "0.1.0";
export type RuntimeDslVersion = typeof RUNTIME_DSL_VERSION;
/**
 * The first shipped runtime-contract version — a **pinned literal**, not the
 * moving {@link RUNTIME_DSL_VERSION} (see {@link INITIAL_DSL_VERSION} for why
 * migration endpoints must be immutable). Equal to `RUNTIME_DSL_VERSION` today;
 * the two diverge the moment the runtime shape first changes.
 *
 * The runtime line **starts here**, not at an unversioned epoch: there is no
 * pre-versioning runtime data to lift, so {@link RUNTIME_DSL_MIGRATIONS} ships
 * empty and this pinned version is the `from` of the first real step appended
 * when the runtime shape first changes.
 */
export declare const INITIAL_RUNTIME_DSL_VERSION: "0.1.0";
/**
 * Ordered migration ladder for the runtime contract, wholly independent of
 * {@link DSL_MIGRATIONS}. Same invariants when non-empty (contiguous chain, last
 * `to` === {@link RUNTIME_DSL_VERSION}, every endpoint a **pinned literal**), but
 * — unlike the document ladder — it starts **empty**, with NO legacy-lift entry.
 *
 * The runtime line has **no unversioned epoch**. Its envelope is a brand-new
 * contract: the future `RuntimeStore` stamps {@link RUNTIME_DSL_VERSION} at write
 * time, so nothing legitimately predates {@link INITIAL_RUNTIME_DSL_VERSION} and
 * there is no pre-versioning runtime data to lift. An unstamped object reaching
 * {@link migrateRuntime} is therefore a bug, not legacy data, and fails loud (see
 * {@link noRuntimeEpochError}) rather than being lifted by a no-op first entry.
 *
 * The first real runtime shape change bumps {@link RUNTIME_DSL_VERSION} and
 * appends a step from the pinned {@link INITIAL_RUNTIME_DSL_VERSION} to the new
 * version — the same append discipline as {@link DSL_MIGRATIONS}, just without a
 * pre-seeded legacy row. An empty ladder is fully functional: a session already
 * stamped at {@link RUNTIME_DSL_VERSION} early-returns from {@link migrateRuntime}
 * as current, and a session stamped at some unknown older version hits the
 * "no migration path" fail-loud.
 */
export declare const RUNTIME_DSL_MIGRATIONS: readonly DslMigration[];
/**
 * A well-formed `x.y.z` version: exactly three non-negative integer parts.
 *
 * Exported so the envelope validators can reject a present-but-malformed version
 * stamp (either line's — `dslVersion` or `runtimeDslVersion`) at their boundary
 * — the same well-formedness rule that {@link dslVersionOf} /
 * {@link runtimeDslVersionOf} / {@link migrate} / {@link migrateRuntime} enforce
 * by throwing — rather than letting a bad stamp pass a mere `typeof` check and
 * blow up downstream.
 */
export declare function isWellFormedDslVersion(v: string): boolean;
/**
 * Read the serialized *document* contract version a document was written at,
 * from its {@link DSL_VERSION_KEY} envelope field. An authoritative read: it
 * applies every envelope rule — unstamped, malformed-stamp, and the cross-line
 * throw on an ambiguous envelope — so callers reporting a version never claim
 * one for data {@link migrate} refuses to touch (see {@link versionOf}).
 */
export declare function dslVersionOf(doc: unknown): string;
/**
 * Read the serialized *runtime* contract version a session was written at, from
 * its {@link RUNTIME_DSL_VERSION_KEY} envelope field — the runtime-line
 * counterpart of {@link dslVersionOf}, reading a disjoint field. Same rules,
 * including the cross-line throw on an ambiguous envelope (see
 * {@link versionOf}), with **one difference**: the runtime line has no
 * unversioned epoch, so an unstamped object (not a non-object — those still read
 * as {@link UNVERSIONED_DSL_VERSION}) **throws** {@link noRuntimeEpochError}
 * rather than reading as `0.0.0`. Sessions are stamped with
 * {@link RUNTIME_DSL_VERSION} at write time; an unstamped one here is a misrouted
 * legacy document or an unstamped producer write, both bugs.
 */
export declare function runtimeDslVersionOf(doc: unknown): string;
/**
 * True when `doc` is a migratable document written at an older version than
 * {@link DSL_VERSION}. The document-line predicate (counterpart:
 * {@link needsRuntimeMigration}, which reads the runtime envelope field). It
 * mirrors {@link migrate} on every input — `false` for a non-object, the same
 * cross-line-guard throw for an ambiguous envelope — so the two never disagree
 * (a caller looping `while (needsMigration(x)) x = migrate(x)` always
 * terminates or fails loud on the same input). Throws on an object carrying a
 * malformed stamp (see {@link dslVersionOf}).
 */
export declare function needsMigration(doc: unknown): boolean;
/**
 * True when `doc` is a runtime session written at an older version than
 * {@link RUNTIME_DSL_VERSION}. The runtime-line counterpart of
 * {@link needsMigration}: it reads {@link RUNTIME_DSL_VERSION_KEY} and pairs with
 * {@link migrateRuntime}, so a `while (needsRuntimeMigration(x)) x = migrateRuntime(x)`
 * loop always terminates or fails loud on the same input — on a misrouted
 * document-line aggregate both the predicate and the runner throw the same
 * cross-line-guard error. Pairing {@link needsMigration} with
 * {@link migrateRuntime} (or vice versa) once the lines diverge would spin or
 * silently skip — always pair a predicate with its own line's runner. Throws on
 * a malformed stamp, and — because the runtime line has **no unversioned
 * epoch** — on a wholly-unstamped object (a misrouted legacy document or an
 * unstamped producer write; see {@link noRuntimeEpochError}). Non-objects still
 * answer `false`, as on the document line.
 */
export declare function needsRuntimeMigration(doc: unknown): boolean;
export declare function migrate(doc: unknown): unknown;
/**
 * Migrate a {@link RuntimeSession} forward to {@link RUNTIME_DSL_VERSION},
 * walking {@link RUNTIME_DSL_MIGRATIONS} and stamping
 * {@link RUNTIME_DSL_VERSION_KEY}.
 *
 * The exact counterpart of {@link migrate} on the runtime version line —
 * idempotent, forward-compatible, fail-loud, pure, non-objects returned as-is —
 * but pinned to the runtime ladder, target version, and envelope field. Runtime
 * state is stamped and migrated on read through *this* function, never
 * {@link migrate}, so the document and runtime shapes evolve without either
 * ladder consuming the other's data.
 *
 * **No unversioned epoch.** Unlike {@link migrate}, this line does not lift an
 * unstamped object: sessions are born stamped with {@link RUNTIME_DSL_VERSION}
 * at write time, so a wholly-unstamped object here is a misrouted legacy
 * document or an unstamped producer write and **throws** {@link noRuntimeEpochError}
 * (passed `legacyVersion = null`). Non-objects are still returned unchanged, as
 * on the document line — they are not migratable aggregates.
 */
export declare function migrateRuntime(doc: unknown): unknown;
//# sourceMappingURL=version.d.ts.map