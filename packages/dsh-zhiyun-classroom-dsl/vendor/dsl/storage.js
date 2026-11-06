/**
 * The asset-storage seam the DSL owns the *shape* of.
 *
 * Large binaries (generated images / audio / video) never live inside a DSL
 * document — a document embeds only a stable {@link AssetRef}, and a
 * {@link StorageProvider} resolves that ref to a URL at render time. The
 * indirection is what keeps a document portable: a raw URL would bake in a
 * particular provider and an expiry assumption, so it cannot travel with the
 * document to another runtime. `@openmaic/renderer` already consumes resolved
 * URLs via its media slots; the set of refs a document touches, with per-asset
 * metadata, is enumerated as its asset manifest by `./asset-manifest.ts`.
 * ZIP and video consume that enumeration; PPTX walks slide elements directly
 * while sharing the same resolver and resolution semantics. The reserved
 * future `@openmaic/exporter` package can build on the same contract.
 *
 * The DSL owns only the minimal `put` / `resolve` / `remove` interface.
 * Concrete backends — IndexedDB + object URLs in the browser, object storage /
 * CDN on a server — live in `@openmaic/storage`, keeping this package
 * dependency- and DOM-free. Implementations may offer richer registry
 * operations (for example an atomic byte replacement behind a stable ref)
 * without the DSL contract growing them.
 */
export {};
//# sourceMappingURL=storage.js.map