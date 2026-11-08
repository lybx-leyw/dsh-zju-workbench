# dsh-pages — design

English | [中文](<DESIGN-ZH.md>) · [User guide](<README.md>)

## 1. Current architecture

The shell adds parallel navigation and product-page content through an ordinary `shell.overlay` registration. That registration declares and owns a new root-scoped, keyed child slot, `page.content`. The authorized owner renders the selected key; contributing plugins register content into that slot through the original slots service.

```text
Native DSH root (unchanged and continuously mounted)
└─ shell.overlay
   └─ dsh-pages shell (owns its own child declaration)
      ├─ persistent navigation rail
      └─ page.content[key = active page] / built-in manager
```

This is visual composition, not native-tree relocation. The shell does not replace the native root component, redeclare native children, rewrite native keys, reparent native DOM, or remount the native root. `home` reveals the workbench already beneath the shell; it is not a second rendering of DSH. A product page covers the native workbench's content area.

A reversible stylesheet scopes native `#root` left padding with `:has([data-dsh-pages-shell])`. The live rail width drives both navigation and content geometry. Removing the shell removes its layout rule; no native root field needs restoration.

### Modules and entry points

- [page-shell.jsx](<src/page-shell.jsx>): shell presentation and `installPageShell` installation.
- [pages-service.js](<src/pages-service.js>): `createPages`, built-in metadata registrations, state/service wiring, and browser preferences.
- [state.js](<src/state.js>): page identity, selection, arrangement, pinning, width, and snapshots.
- [page-manager.jsx](<src/page-manager.jsx>): management UI over the same registry.
- [preferences.js](<src/preferences.js>): validated browser-local preference storage.
- [client.jsx](<src/client.jsx>): client entry; `apply` and `applyWithConfig` install the same shell.

## 2. Slot ownership and settings

Native slot declarations remain with their native owners. The shell does not take over the `slots` service or claim a namespace for the native tree. Product metadata and slot content are separate contributions; both must be disposed by their contributing plugin. A metadata registration alone does not supply page content.

Settings remain in the native settings panel. Settings contributions are child slots owned by that panel; an unrelated shell cannot render them merely by knowing their names. There is no replacement settings page or settings entry on this rail, and no promise that arbitrary third-party UI has been verified.

## 3. Navigation model

The built-ins are DSH workbench (`home`) and Page manager (`pages`), registered into the same page registry as other pages. They are not a separate navigation state machine. The configured home and manager identities must differ.

The shell owns **navigation and the active-page lifecycle, never page layout**. It allocates a bare full-bleed region for the active page; everything inside that region belongs to the page: headings, toolbars, back links, readable-width columns, empty states, icons. A shell that supplied a default icon, a "back to workbench" button, or a centred content column was deciding page-level UI for every page at once, which is exactly what forces complex pages into a shell-shaped box.

A page contributes its icon as part of its registration — an `icon` component, or a `glyph` string for packages without an icon library. The shell renders what the page declared and substitutes nothing, so a missing icon stays visible instead of being masked by a look-alike default.

Keyboard handling follows the same boundary: the shell closes its own rail popover on Escape and otherwise leaves focus containment, tab order, and Escape to the page. A page with an editor, a dialog, or a "leave this page" gesture owns all three.

The three explicit groups are `top`, `overflow` (recycle), and `bottom`. Recycling is a user arrangement choice, not automatic eviction caused by limited rail space. Nonempty `overflow` displays **…**, so recycled pages remain reachable. The manager itself can be recycled and reopened there.

Pinning is independent state: a recycled page retains `region: 'overflow'`, with `pinned` and `pinOrder` controlling its extra shortcut after **…** in the top group. It remains listed in the recycle group. Unpinning removes that shortcut without promoting the page into `top`. Normal ordering and pin ordering must not be conflated; `promotePage` is an arrangement action, not the pin-state authority.

Rail width is an integer from 40 to 96 pixels, default 64. Updating it changes the live snapshot and layout immediately and saves the explicit preference. Rail icons, including fixed-size plugin icons and the more button, scale by `width / 64`; menu and manager content keep their own sizing.

The service exposes configuration, `getSnapshot`, `subscribe`, `selectPage`, `registerPage`, `setPageRegion`, `setPageOrder`, `promotePage`, `setPagePinned`, and `setRailWidth`. UI consumers subscribe to snapshots rather than maintain another page registry.

## 4. Lifecycle boundaries

- **Native UI:** remains mounted beneath product pages. Covering it does not tear down its React effects, reset panel/session selection, disable plugins, cancel tasks, or revoke global shortcuts.
- **Product content:** the shell renders the active keyed content. Switching away can unmount that page's rendered React subtree and run its component cleanup; it does not dispose the plugin or its metadata/content registrations. Returning may create a fresh component instance.
- **Contributions:** registrations live until their owning effects are disposed. Metadata and content cleanup are independent; a contributor must own both. Removing the active metadata registration selects home. A stale disposer must not remove a newer registration reusing the same id.
- **Shell:** navigation and management share the service lifetime. Removing the installation cleans up its own registrations, subscriptions, and styles, not native domain services or saved preferences.

This is not isolation: all plugins still share Cordis, the document, and application-level portals. Native overlays may extend above the covering page. Focus handling does not make the shell a security boundary or disable document-capture shortcuts. No automatic floating-carrier conversion or owner-close orchestration belongs to this architecture.

## 5. Persistence

Explicit user actions save page arrangement (`region`, `order`), pin state (`pinned`, `pinOrder`), and `railWidth` in `localStorage`. Registration defaults alone do not create saved overrides. Matching live ids receive saved arrangement, including late registrations. Unloading a page retains its preferences for a later registration; stored ids never create missing pages.

The storage key is `dsh-pages:preferences:v1:` plus the URI-encoded JSON array `[navigationSlot, pageSlot, classPrefix, homePage]`. Preferences belong to that product identity, browser profile, and origin, not an account. There is no cross-tab synchronization.

Old version-1 documents are accepted without changing the storage key. Unknown fields, including the retired `exportedSlots` field, are discarded on load and are not written back.

Active selection, native panel/session state, components, DOM, and business data are not persisted by this preference layer. Invalid JSON, unsupported documents, unavailable storage, and quota failures warn and leave in-memory operation available. Clearing the corresponding product key resets saved preferences on the next load.

## 6. Historical approaches — retired, not current contracts

Earlier designs attempted to wrap or shadow a native root registration, preserve owner rendering authority, export sidebar slot views through portals, and move native main content between anchors. Root shadowing encountered duplicate child-slot declaration failures on a real host. These approaches depend on native ownership and mutable implementation details; they are not installed by either current entry point.

Other retired work mapped floating dialogs/menus/popovers into full-page geometry, coordinated owner close/undo behavior, and unmounted native view scopes on page switches. None of those behaviors is a promise of the current shell. In particular, the former claim that leaving home destroys native UI conflicts with the current continuously mounted native root.

Former key-rewriting facades, native-slot export APIs, adapter lease/protocol guarantees, structural rollback mechanisms, host-version compatibility lists, and historical test counts must not be read as current public guarantees. They describe a different implementation, not optional features of this one.

## 7. Compatibility and verification limits

The current integration depends on the host permitting the owned `shell.overlay` child declaration and rendering keyed content, plus the expected root geometry, CSS `:has()` support, and overlay layering. Preserving native ownership avoids a known class of collisions; it does not prove compatibility with every plugin, every global overlay, or every host upgrade.

This document records architecture and boundaries, not a fresh real-device test report. Host upgrades and third-party combinations require separate validation. An upstream supported layout contract could reduce geometry and layering assumptions, but is not a current dependency or implemented feature.
