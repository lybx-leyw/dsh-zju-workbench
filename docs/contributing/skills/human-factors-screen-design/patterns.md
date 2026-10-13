# Patterns

Implementable techniques that satisfy the constraints in `cheatsheet.md` and the chapters.
Each pattern states **when to use it and what it costs**, because most of these are
trade-offs rather than free wins.

---

## Compute type size from viewing distance

**When to use:** any interface whose viewing distance is known or predictable — a desktop app,
a kiosk, a control console, a wall display. Not for a general web page, where distance is
unknown (use WCAG resize/reflow rules there instead).

**How:**
```
arcmin_target = 20                     # comfortable reading; 24 if the text must be read fast
mm_per_px     = 25.4 / ppi
cap_mm        = 2 * distance_mm * tan(radians(arcmin_target/60) / 2)
cap_px        = cap_mm / mm_per_px
font_size_px  = cap_px * font_metric_ratio     # typically 1.3–1.5, measure per font
```
Set the result as a CSS custom property and derive scale from it, so the whole type scale
moves together when the reference distance changes.

**Trade-offs:** more accurate than a fixed scale, but it needs a real reference distance and a
per-font metric ratio. If you cannot state the distance, you cannot use this pattern — fall
back to WCAG's resizing requirements and a sane default.

---

## Derive the whole scale from one arcmin value

**When to use:** establishing a type scale you will keep.

**How:** pick 20 arcmin for body, then set the scale by *ratio steps* rather than by adding
pixels. Because arcmin requirements differ by task (16 legible / 20–22 reading / 24 rapid),
map those onto the scale explicitly:
- captions and secondary text: 16 arcmin (legibility floor, never below)
- body: 20–22 arcmin
- time-critical or glanced values: 24 arcmin
- headings: scale up from body by your chosen ratio

**Trade-offs:** a ratio-based scale can produce fractional pixels; round consistently rather
than snapping each step independently, or the scale develops uneven gaps.

---

## Extend the hit area beyond the visible glyph

**When to use:** icon buttons, close buttons, table row actions, small toggles — anywhere the
visual design wants a small target.

**How:** keep the glyph small, add padding to reach the required target, and let the padding be
the click target. WCAG's spacing exception makes this normative: an undersized target conforms
if a 24 px circle centred on it does not intersect another target's circle. In CSS, pad the
button rather than the icon, and use a pseudo-element overlay if layout prevents padding.

**Trade-offs:** generous padding increases perceived whitespace and can make dense toolbars
feel loose. In dense data tables, the spacing exception is often the only way to conform.

---

## Derive status colour without making colour the channel

**When to use:** every status, severity, category, or validation state.

**How:** define the state semantically first, then attach **at least two** perceivable channels
to it:
- an icon or shape that differs (not just a differently-coloured dot)
- a text label, always present (not tooltip-only)
- optionally colour, using a hue that also differs in **luminance**, so it survives greyscale
  and the common colour-vision deficiencies

**Trade-offs:** more visual weight per state. In dense tables, an icon plus text can be too
wide; the text can move to a header or tooltip **only if** an icon plus shape still carries it.

---

## Logarithmic adjustment for perceptual quantities

**When to use:** brightness, volume, opacity-like controls — anything the user perceives as a
magnitude.

**How:** store a linear value but map it through a logarithmic or power curve for the control
position, so equal slider movements produce equal *perceived* change. NASA requires continuous
logarithmic dimming for exactly this reason. Orient the control so up/right/clockwise means
brighter or louder.

**Trade-offs:** the numeric readout no longer matches the physical value, which confuses some
users. Show a percentage rather than a raw value.

---

## Instance versus template for defaults

**When to use:** any editable field that ships with a default.

**How:** keep two distinct values — the **template** default (the definition) and the
**instance** value (what this user typed now). MIL-STD-1472G §5.2.2.4.5(d) requires that
replacing the value during a transaction must not change the definition. On submit, persist the
instance; only update the template if the user explicitly says "save as my default".

**Trade-offs:** more state to manage, and users sometimes *expect* their last entry to become
the new default. If you offer that, make it an explicit, visible action rather than an
implicit side effect.

---

## Never make a destructive action the default

**When to use:** every confirmation dialog, dialog with a default button, and settings panel
with a dangerous option.

**How:** focus starts on the safe option; the dangerous option is not the initial selection;
if an option is destructive (delete, discard, overwrite, print-to-destructive-device), its
default is the negative form (NUREG requires a destructive print option to default to **NO**).
Where the action is irreversible, require explicit confirmation rather than an easy default.

**Trade-offs:** adds a step to frequent destructive workflows. For high-frequency, trivially
reversible actions (archive vs delete), the "safe default" cost may not be worth it — but
irreversible ones never qualify for the shortcut.

---

## Show the default so it can be confirmed

**When to use:** every field with a default.

**How:** put the value **in the field**, not in a placeholder, tooltip, or help text. A
placeholder disappears on focus and is unreadable to some assistive technology; MIL-STD
requires defaults to be *displayed automatically in their appropriate data fields*, and
acceptance to be **one keystroke**.

**Trade-offs:** pre-filled fields require validation to handle "accepted the wrong default".
Mitigate with clear labels and input validation rather than by emptying the form.

---

## Feedback ladder for latency

**When to use:** every operation whose duration is not bounded and near-zero.

**How:** attach feedback to measured thresholds rather than guessing:
- **<0.1 s** — no indicator; anything shown would flicker
- **≥1 s** — busy indicator; keep the rest of the UI responsive
- **≥2 s** — determinate progress if you can estimate, indeterminate if not
- **≥10–15 s** — countdown or explicit "this will take a while" plus a completion signal
- **>15 s** — completion signal required

Use optimistic UI only for actions that essentially always succeed; for destructive or
validating actions, show pending state instead.

**Trade-offs:** optimistic UI feels fastest and is wrong the moment the server rejects. It also
tends to *increase* response-time variability, which is itself a violation — the user's model
of the system is built from consistency, not from peak speed.

---

## Stabilise response time, do not just minimise it

**When to use:** any interaction where the user will do the same thing repeatedly.

**How:** cap variability within the bands the sources give (≤5 % in 0–2 s, ≤10 % at 2–5 s,
≤15 % beyond). In practice: prefetch the likely next state, cache query costs, avoid
first-request-cold paths, and if an operation is unavoidably variable, add a deliberate floor so
the fast cases do not stand out.

**Trade-offs:** adding artificial delay feels wrong, and for one-shot actions it is. It earns
its cost in high-repetition flows where the user is timing themselves against the system.

---

## Honour reduced-motion as a first-class path

**When to use:** any animation, parallax, scroll effect, or auto-playing motion.

**How:** implement `@media (prefers-reduced-motion: reduce)` as a real alternative that
preserves meaning — not a global `animation: none` that removes state communication. Where
motion carried information (a transition showing where a panel came from), replace it with an
instant state change plus a static cue. WCAG 2.3.3 requires interaction-triggered motion to be
disableable; WCAG 2.2.2 requires auto-moving content to be pausable if it lasts more than five
seconds and runs alongside other content.

**Trade-offs:** two code paths, and the reduced path is easy to let rot. Test it in CI.

---

## Pausable live regions

**When to use:** live dashboards, tickers, feeds, auto-refreshing tables — anything that updates
without the user asking.

**How:** provide an explicit pause/play control, and make pausing genuinely stop the data
movement rather than just the animation. Cap update frequency for values the user must read
reliably at **once per second**; use 2–5/s only for rate-of-change or gross-value indicators.
For values that update while being read, consider freezing the display on hover/focus so the
number cannot change mid-read.

**Trade-offs:** a paused dashboard drifts from reality, so the paused state must be visibly
indicated and should show the age of the data. Freeze-on-hover can feel unresponsive if applied
too broadly.

---

## Redundant channel for the attention cue

**When to use:** alerts, warnings, and errors.

**How:** give every alert a **persistent static form** in addition to its attention-getting form.
The source rules require this: alerts must **fail steady** (MIL-STD/NUREG), and WCAG caps flash
at 3/s. Practically: flash or animate to attract, then settle into a static, labelled, iconographic
state that carries the same information. Never let the flash be the only thing that distinguishes
an alert from ordinary content.

**Trade-offs:** two representations to keep in sync, and the static form must be designed to be
noticeable without the animation — which is the hard part, and the point.

---

## One master brightness control

**When to use:** any interface with multiple luminous elements (indicators, panels, charts).

**How:** provide a single master brightness control that scales all tiers together, preserving
the *ratios* between them, rather than per-element brightness controls that let the user flatten
the hierarchy. NASA requires a single master control for exactly this reason; NUREG/MIL-STD
require the ranges and increments. Preserve relationships: if an alert must be ≥3 × brighter
than other indicators, that ratio must hold at every brightness level.

**Trade-offs:** one control cannot serve a user who wants one element dimmer for a specific
reason. Accept that as the cost of not letting the hierarchy be destroyed by accident.

---

## Lock safety-critical parameters from user adjustment

**When to use:** deciding what goes in a settings panel.

**How:** before exposing a setting, ask whether mis-setting it can cause harm or hide a safety
signal. If yes, do not expose it (or expose only a constrained subset). The sources are explicit
that alarm loudness (NUREG), caution/warning levels (NASA), and status/coding colours (FAA) are
**not** user preferences. Offer adjustable *non-critical* channels instead — overall volume for
non-alarm audio, theme for non-status colours.

**Trade-offs:** users sometimes legitimately need to reduce alarm volume in a quiet environment.
The standards' answer is to bound it (never inaudible) rather than to remove the control
entirely — bound the range instead of exposing it fully.

---

## Validate on blur or submit, not on keystroke

**When to use:** any field where a partially-typed value is temporarily invalid.

**How:** validate when the user leaves the field or submits, not on every input event, unless
the validation is a hard constraint the user must satisfy to continue (e.g. character limit).
Keep error messages **until corrected** — MIL-STD requires a computer-detected error to be
continuously displayed until corrected, so do not auto-dismiss on a timer. Preserve the user's
input on failure.

**Trade-offs:** later validation means later feedback, which is worse for complex formats. For
those, validate the *shape* early and the *value* late.

---

## Make state visible rather than remembered

**When to use:** any interface with modes, multi-step flows, or context-dependent actions.

**How:** display the current mode and position continuously. NUREG requires that if an entry's
consequence depends on prior context, a continuous indication of current context is displayed,
and that **the user should not have to query the system to determine the current mode**. Concretely:
label the mode in the UI, show step indicators in multi-step flows, and disable rather than hide
actions that are unavailable in the current mode (with a reason on hover/focus).

**Trade-offs:** persistent state indicators consume space. In dense UIs they get demoted to
icons — which is acceptable only if the icon still distinguishes every mode unambiguously.

---

## Bypass blocks for keyboard and screen-reader navigation

**When to use:** any page with repeated navigation.

**How:** provide a skip link as the first focusable element, use landmark regions, and ensure a
visible focus indicator on every focusable element (WCAG 2.4.7). Keep focus order matching
visual order (WCAG 2.4.3). For single-character shortcuts, provide turn-off, remapping, or
focus-only activation (WCAG 2.1.4).

**Trade-offs:** skip links are visually redundant for mouse users; hide them until focused
rather than removing them, since removing them removes the requirement's satisfaction.

---

## Skeleton screens only where structure is known

**When to use:** content-heavy views with a predictable layout.

**How:** render a skeleton that matches the eventual layout's *shape*, so the page does not
reflow on load. Use it for the 1–2 s band. Do **not** use it where the eventual layout is
unknown — a skeleton that does not match causes a second, worse reflow.

**Trade-offs:** skeletons can feel like padding if the load is fast; showing one for a 200 ms
request makes the app feel *slower* than showing nothing. Gate it on a small delay so fast
responses render directly.
