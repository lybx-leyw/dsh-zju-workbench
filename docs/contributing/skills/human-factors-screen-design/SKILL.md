---
name: human-factors-screen-design
description: "Engineering guidance for screen content and interface design, distilled from US Government human factors standards (FAA HF-STD-001B, NASA HIDH, MIL-STD-1472G, NUREG-0700, FAA-HF-STD-010A, FHWA-HRT-16-060) and WCAG 2.2. Use when choosing text size, spacing, contrast, colour, target sizes, layout density, response-time budgets or alert coding, or when designing defaults and adjustment ranges for user-configurable settings."
---

# Human factors for screen design

**Sources**: 8 US Government / open standards (public domain unless noted) | **Rules extracted**: 4,469 | **Chapters**: 10 | **Generated**: 2026-10-12

Every number here is traceable to a section of a named standard. Where sources disagree, the
disagreement is recorded rather than averaged away — see [CROSS-SOURCE-REGISTER.md](CROSS-SOURCE-REGISTER.md).

## How to use this skill

- **Without arguments** — read the Core Rules below; they cover most decisions.
- **With a topic** — ask about `text size`, `contrast`, `defaults`, `alerts`, `targets`,
  `response time`, `reading in motion`, `spacing`, `menus`, or `accessibility`; the matching
  chapter is loaded.
- **With a chapter** — ask for `ch07`; that file is loaded.
- **Quick numbers** — `cheatsheet.md`. **Implementable techniques** — `patterns.md`.
  **Terminology** — `glossary.md`.

---

## Core rules

### 1. Express text size as visual angle, not points or pixels

Six sources independently require this, because arcmin survives a change of screen, resolution,
or viewing distance. **This is the single most important rule in the skill.**

| Reading task | Requirement |
|---|---|
| Legibility floor | **16 arcmin** |
| Comfortable reading | 20–22 arcmin preferred |
| Must be read **rapidly** | **24 arcmin** |
| Groups of characters | max 45 arcmin |

```
size_mm = 2 × distance_mm × tan( radians(arcmin/60) / 2 )
size_px = size_mm / (25.4 / ppi)
```

At 600 mm / 96 ppi, 20 arcmin ≈ **13 px of cap height** (not font size — that runs ~1.3–1.5 ×
larger). MIL-STD states the same requirement as millimetres at 710 mm, scaled by `D/710`.

### 2. Contrast: 4.5:1 body, 3:1 large and non-text

- Body text **4.5:1** (AA), **7:1** enhanced (AAA)
- Large text (≥18 pt, or 14 pt bold) **3:1** (AA), 4.5:1 (AAA)
- UI components, icons, graphical objects **3:1** against adjacent colours
- Ergonomics standards agree: 3:1 minimum, **7:1 preferred**

### 3. Colour must never be the only channel

Every source requires redundancy with shape, text, position, or luminance — this is the rule
that protects colour-vision-deficient users. **Colour counts differ by purpose**: 4–7 when
meaning must be *remembered*, ≤9 with a legend, ≤24 for pure discrimination.

### 4. Defaults are a workload-reduction contract

MIL-STD-1472G §5.2.2.4.5: defaults shall be **used** (to reduce workload), **displayed
automatically** in their fields, acceptable by a **single keystroke**, replaceable **without
changing the default definition**, generatable **from operational experience**, and allow
defaulting **all entries** or **up to the next required entry**.

- **Destructive actions are never the default** (NUREG: destructive print defaults to **NO**)
- Default button **leftmost/topmost**, only one; initial focus **on the default**
- Instance ≠ template: editing a value must not silently rewrite the default
- Adjustment range generous: luminance **≥50:1**, illumination continuously or **≥30 increments**,
  time limits **≥10 × the default**; brightness and volume **logarithmically** scaled
- **Not user-adjustable**: alarm loudness, caution/warning levels, status/coding colours

### 5. Response time — consistency beats speed

| Action | Desirable | Max |
|---|---|---|
| Key/discrete input | 0.1 s | 0.1 s |
| Direct manipulation | **≤0.25 s** | 0.25 s |
| Simple inquiry | 1.0 s | 2.0 s |
| Complex inquiry | 2.0 s | 5–10 s |
| Loading | <6 s | 15–60 s |

Feedback: **≥1 s** busy · **≥2 s** progress · **>15 s** inform the user the delay is long ·
**>60 s** countdown showing time remaining. (Note: 15 s is the *informing* threshold and 60 s
the *countdown* threshold — they are different promises, not two figures for one.)

**The commonly missed rule:** variability ≤**5 %** in 0–2 s, **10 %** at 2–5 s, **15 %** beyond.
A steady 1.0 s beats a 0.2–1.8 s spread, because users build a model from consistency.

### 6. Update and flash rates

- Values the user must read reliably: **not faster than once per second**
- Rate-of-change or gross values: **2–5 per second**
- Indicator flash: 3–5/s, must **fail steady**
- **Public-facing content: ≤3 flashes/second** — WCAG overrides the ergonomics figures here,
  because the older numbers assume a medically screened operator population
- Auto-moving content lasting **>5 s** alongside other content must be **pausable**

### 7. Targets and spacing

- Web/app: **24 × 24 CSS px** (AA), 44 × 44 (AAA)
- Touch: **≥9.5 mm** general, **≥15 mm** gloved/industrial; no accuracy benefit past ~22 mm
- Spacing exception: an undersized target conforms if a 24 px circle centred on it does not
  intersect another's (WCAG 2.5.8) — **the hit area is what matters, not the visible glyph**
- Line height **≥1.5 ×** font size; paragraph **≥2 ×**; letter **≥0.12 ×**; word **≥0.16 ×**
- Measure **50–80 characters**; packing density **≤50 %** (≤25 % alphanumeric);
  highlighting **≤10 %** of displayed information

### 8. Reading while moving — a genuine gap

These sources place readers at fixed workstations. **They do not contain words-per-minute
versus movement-speed data, glance duration, or dwell time.** What does transfer: the update
ceilings above, minimum display duration, and WCAG's pausability requirement. The relevant
literature (Dudek 2006; Lerner et al. 2009) is cited by these documents but not summarised in
them, and was not obtained. See Ch 4 before quoting any movement-speed number.

### 9. A default the user cannot see is not a default

Display it in the field, not in a placeholder, tooltip, or help text. Placeholders vanish on
focus and are unreliable for assistive technology.

---

## Chapter index

| # | Chapter | Covers |
|---|---|---|
| [ch01](chapters/ch01-text-size-legibility.md) | Text size and legibility | arcmin, conversion, stroke width, case, font choice |
| [ch02](chapters/ch02-spacing-line-length-density.md) | Spacing, line length, density | leading, measure, packing density, grouping |
| [ch03](chapters/ch03-contrast-luminance-colour.md) | Contrast, luminance, colour | ratios, polarity, ΔE, CVD, dimming law |
| [ch04](chapters/ch04-reading-in-motion-and-dynamic-display.md) | Reading in motion | update rates, scrolling, flash, freeze, the gap |
| [ch05](chapters/ch05-response-time-and-feedback.md) | Response time and feedback | latency budgets, variability, feedback ladder |
| [ch06](chapters/ch06-targets-layout-workstation.md) | Targets, layout, geometry | target sizes, separation, viewing geometry |
| [ch07](chapters/ch07-user-adjustable-parameters-and-defaults.md) | Adjustable parameters and defaults | the default contract, ranges, what must not be adjustable |
| [ch08](chapters/ch08-alerts-warnings-messages.md) | Alerts, warnings, messages | priority, redundancy, audio, dialog structure |
| [ch09](chapters/ch09-navigation-menus-forms.md) | Navigation, menus, forms | breadth/depth, labels, form spacing, errors |
| [ch10](chapters/ch10-accessibility-consistency.md) | Accessibility and consistency | timing, input flexibility, consistency, motion |

## Topic index

- **Accessibility** → ch10, ch06
- **Alerts / alarms** → ch08, ch03
- **Colour / colour coding** → ch03, ch08
- **Contrast** → ch03, ch01
- **Defaults / initial values** → ch07, ch09
- **Density / layout** → ch02, ch06
- **Errors / validation** → ch09, ch08
- **Flash / blink / flicker** → ch04, ch08
- **Font / typography** → ch01, ch02
- **Forms / data entry** → ch09, ch07
- **Latency / response time** → ch05, ch04
- **Menus / navigation** → ch09, ch06
- **Reading in motion / movement** → ch04
- **Scrolling / paging** → ch04, ch09
- **Spacing / leading / measure** → ch02
- **Targets / touch / hit area** → ch06
- **Text size / arcmin** → ch01
- **Update rate / auto-refresh** → ch04
- **Viewing distance / geometry** → ch06, ch01
- **WCAG criteria** → ch10, ch02, ch03, ch06

## Supporting files

- [cheatsheet.md](cheatsheet.md) — all thresholds and decision rules on one page
- [patterns.md](patterns.md) — implementable techniques with trade-offs
- [glossary.md](glossary.md) — terminology as the sources define it

Also in this folder:

- [CROSS-SOURCE-REGISTER.md](CROSS-SOURCE-REGISTER.md) — where the 8 sources
  disagree, why, and which to prefer. **Read this before quoting a number in a context the
  sources did not write for.**
- [SOURCES.md](SOURCES.md) — provenance, licence basis, and SHA-256 for every source document.

---

## Scope and limits

**Well covered:** normative display requirements — sizes in visual angle, contrast ratios,
spacing minima, colour limits, latencies, target dimensions, adjustment ranges, default
behaviour.

**Weakly covered, and why:**

- **Reading while physically moving** — the sources assume a seated operator. See rule 8.
- **Post-2015 paradigms** — multi-touch, gesture, responsive layout, dark mode, OLED, variable
  refresh. WCAG 2.2 is the only current source; where a rule assumes a CRT at a fixed distance,
  that assumption is stated rather than silently applied.
- **Numbers that live only in figures** — e.g. NASA HIDH Figure 10.3-16 (character height in
  arcmin) and Figure 10.5-1 (minimum control spacing) are absent from text extraction. Figures
  10.4-18 and MIL-STD Figure 3 *were* recovered.
- **Menus deeper than 3–4 levels**, which modern web navigation routinely exceeds. The chapters
  say where the rule stops binding and what principle survives.

**This is design guidance, not a compliance certificate.** These documents assume expert
human-factors judgement — the FAA standard says so in its own foreword. Applying a number to
the wrong context is a real failure mode; the register exists to make that harder.
