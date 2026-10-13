# Cheatsheet

Decision rules and thresholds, in the order you would reach for them. Every number is
traceable to a section of a named standard; see [SOURCES.md](SOURCES.md) for the source
documents, and the per-chapter citations for where each figure comes from.

**The one rule that governs all the others:** the sources specify display requirements in
**visual angle (minutes of arc)**, not points or pixels, because visual angle is the only
form that survives a change of screen, resolution, or viewing distance. Compute it.

---

## Decide text size

| Reading task | Minimum | Preferred | Maximum |
|---|---|---|---|
| Text that need only be legible | **16 arcmin** | — | — |
| Comfortable reading / long strings | 16 arcmin | **20–22 arcmin** | 30 arcmin |
| Must be read **rapidly** | **24 arcmin** | — | 30 arcmin |
| Individual glyphs, icons | 20 arcmin | **24–35 arcmin** | 35 arcmin |
| Non-contextual groups of characters | — | — | 45 arcmin |
| Embedded in a symbol | 10 arcmin | — | — |
| Text where **colour is critical** | 20–30 arcmin | 45 arcmin | — |

**Convert:**

```
size_mm = 2 × distance_mm × tan( radians(arcmin/60) / 2 )
size_px = size_mm / (25.4 / ppi)
```

Worked, at 600 mm and 96 ppi: 16′ = 2.8 mm = **10.6 px cap height**; 20′ = 3.5 mm =
**13.2 px**; 24′ = 4.2 mm = **15.8 px**. Remember this is **cap height**, not `font-size` —
font size runs ~1.3–1.5 × larger.

**Other typography rules:** stroke width **1/12–1/6** of height (thicker for light-on-dark);
height:width **1:0.7–1:0.9** for fixed spacing; **≤2 fonts per screen**; labels ≤3 words in
UPPER CASE, >3 words in mixed case; mixed case reads faster than all-caps; avoid thin strokes
and unusual letterforms, especially at low contrast.

---

## Decide spacing and density

| Property | Rule |
|---|---|
| Line height | **≥1.5 ×** font size (must survive user override) |
| Paragraph spacing | **≥2 ×** font size |
| Letter spacing | **≥0.12 ×** font size |
| Word spacing | **≥0.16 ×** font size |
| Line length (measure) | **50–80 characters**; ≤80 (40 CJK); 52–78 fastest |
| Packing density | **≤50 %**; alphanumeric displays **≤25 %** |
| Highlighting | **≤10 %** of displayed information |
| Text alignment | **not justified** |
| Form spacing ratio | label→field **1** : column→column **3** : group→group **5** |

---

## Decide contrast and colour

| Requirement | Value |
|---|---|
| Body text | **4.5:1** minimum (AA); **7:1** enhanced (AAA) |
| Large text (≥18 pt, or 14 pt bold) | **3:1** minimum (AA); **4.5:1** (AAA) |
| UI components, icons, graphical objects | **3:1** against adjacent colours |
| Ergonomics standards' floor / preferred | 3:1 minimum; **7:1 preferred**; 2:1 floor at max ambient |
| Colour difference, search targets | **ΔE*uv-sc ≥ 28** |
| Colour difference, adjacent colours | **ΔE*ab ≥ 9.9** |
| Colour count — meaning must be **remembered** | **4–7** |
| Colour count — discriminable with a legend | **≤9** (search degrades above 9) |
| Colour count — pure discrimination | ≤24, verify ΔE |

**Non-negotiable:** colour must **never** be the only channel. Pair it with shape, pattern,
text, position, or luminance. Avoid red+green pairs; avoid colours >650 nm for protanopes.

**Dimming:** must be continuous and **logarithmic** (Weber's Law), with up/right/clockwise =
brighter. Do not implement as opacity or naive RGB multiplication.

---

## Decide motion, update, and reading-while-moving

| Property | Rule |
|---|---|
| Values the user must read reliably | **not updated more than once per second** |
| Rate-of-change or gross values | **2–5 times per second** |
| Auto-moving/blinking/scrolling content | pausable if it starts automatically, lasts **>5 s**, and runs in parallel with other content |
| Auto-updating content | must be pausable **or** its frequency controllable |
| Flash rate — public / unknown population | **≤3 flashes per second**, hard (WCAG) |
| Flash rate — screened operator population | 2–5 Hz, ≥50 % ON; indicators 3–5/s |
| Text blink | 1/3–1 Hz at ~70 % on/off |
| Seizure-prohibited band | 15–20 Hz |
| Key repeat | 500 ms hold → ~10 chars/s, **must be adjustable** |
| Display freeze | provide freeze + **single-action** resume + a visible freeze label |

**Honest gap:** genuine *speed-vs-reading-time* data (words per minute at a given movement
speed, glance duration, dwell time) is **not in this source set**. These sources put readers at
fixed workstations. What transfers: minimum display duration, the update ceilings above, and
pausability. See Ch 4.

---

## Decide response time

| Action | Desirable | Acceptable maximum |
|---|---|---|
| Key / discrete input | **0.1 s** | 0.1 s |
| Pointer, XY entry | 0.2 s | 0.2–1.0 s |
| Direct manipulation | **≤0.25 s** | 0.25 s |
| Menu appears on selection | 0.5 s | — |
| Data on request / simple inquiry | 1.0 s | 2.0 s |
| Page turn | 0.5–1.0 s | — |
| Error feedback | 0.2–2.0 s | 2–4 s |
| Complex inquiry | 2.0 s | 5–10 s |
| Loading / file update | <6 s | 15–60 s |

**Show feedback at:** ~0.1 s nothing needed · **≥1 s** busy indicator · **≥2 s** progress ·
**10–15 s** countdown · **>15 s** completion signal.

**The rule people forget:** response time must be **consistent**. Variability ≤**5 %** in the
0–2 s band, **10 %** at 2–5 s, **15 %** beyond. A steady 1.0 s beats a 0.2–1.8 s spread,
because the user builds a model from it.

---

## Decide target sizes

| Context | Size | Separation |
|---|---|---|
| General web/app (WCAG AA) | **24 × 24 CSS px** (=6.35 mm) | 24 px circles must not intersect |
| General web/app (WCAG AAA) | **44 × 44 CSS px** (=11.6 mm) | — |
| Touch, general (NASA) | **≥9.5 mm**; no benefit beyond **22 mm** | **≥3.2 mm** dead space |
| Touch, gloved / industrial (MIL-STD) | **≥15 × 15 mm**; **+5 mm with gloves** | **≥3 mm** (max 6 mm) |

**Pick by modality and environment, not by which number looks most authoritative.** And note
the upper bound: past ~22 mm, bigger targets do not improve accuracy.

**Spacing exception (WCAG 2.5.8):** an undersized target still conforms if a 24 px circle
centred on it does not intersect another target's circle. **The accessible target is the hit
area, not the visible glyph.**

---

## Decide defaults and adjustability

**MIL-STD-1472G §5.2.2.4.5 is the contract.** Defaults shall:

1. be **used** — the stated purpose is *to reduce user workload*;
2. be **displayed automatically** in their fields at transaction start;
3. be acceptable with a **single keystroke**;
4. be **replaceable without changing the default definition** (instance ≠ template);
5. be **generatable from operational experience** when the designer cannot predefine one;
6. allow defaulting **all entries**, or **up to the next required entry**.

**Placement and safety:**

- Default button: **leftmost/topmost**, and **only one** default.
- Initial focus/cursor: **on the default option** (both keyboard and pointer).
- **Destructive actions are never the default** (NUREG: a destructive print option defaults to **NO**).
- Show the default so the user can **review and confirm** it. A default the user cannot see is
  hidden state, not a default.

**How much range:**

| Parameter | Range |
|---|---|
| Display luminance | **≥50:1** adjustability range |
| Illumination steps | continuously adjustable **or ≥30 increments** full-bright → off |
| Time limit (WCAG 2.2.1) | adjustable over **≥10 × the default**; extension ≥20 s, ≥10 times |
| Volume | bounded — never inaudible, never > ceiling |
| Brightness/volume scaling | **logarithmic**, not linear |

**When continuous vs fixed:** MIL-STD Table XXIII ties it to condition of use — continuous
where dark adaptation is needed or desirable, fixed or continuous where it is not, and **fixed**
where there may be exposure to bright flashes.

**What must NOT be user-adjustable:** alarm loudness (NUREG); caution/warning levels (NASA);
status and coding colours (FAA — assigned at installation). **Safety-critical signals are not
preferences.**

**Restorability:** provide an easy return to default colour scheme, zoom, and icon locations;
restore defaults at end of session.

---

## Decide alerts

| Property | Rule |
|---|---|
| Priority levels | **≤4** |
| Flash for indicators | 3–5 flashes/s, **must fail steady** |
| Public-facing flash | **≤3/s** (WCAG overrides) |
| Alarm bright state | **≥100 %** brighter; only **2 brightness levels** |
| Alert light vs other indicators | **≥3 ×** brighter |
| Audio frequency | 200–5,000 Hz, preferably **500–3,000 Hz** |
| Audio level | **10 dB(A) above ambient in quiet areas (below 45 dBA); 20 dB(A) in noisy areas**; cap **95 dB(A)**; 115 dB(A) only for extreme danger, and **never above 115 dB(A)** |
| Alarm SNR | **13 dB** above masked threshold (ISO 7731) or 15 dB(A) |
| Absolutely identifiable tones | **≤4** (max 5–6); ≤4 learned abstract alarms |
| Sound ceiling (NASA) | 85 dB(A) orbit / 115 dB(A) launch-entry |
| Flash/pulse rate coding | ≤3 rates, **1–8 pulses/s** |
| Alarm matrix size | **≤50 alarms**; blank row every **4–5** messages |

**Redundancy is mandatory:** never colour alone, never flash alone. Alerts must remain
identifiable when the attention-getting channel fails.

---

## Decide menus and forms

| Property | Rule |
|---|---|
| Options per menu | **4–8** target; 3–10 permissible; avoid <3; **never 1** |
| Mutually exclusive choice | radio buttons ≤6; menu ≤10; scrolling menu >10 |
| Menu bar | ≤10 options + Help; must extend full window width |
| Hierarchy depth | **≤3–4** selections; broad-and-shallow preferred |
| Cascading submenus | **≤1 level** |
| Scrolling menu search | provide when ≥50 options |
| Destructive commands | **last** in the menu |
| Opposing actions | **never adjacent** |
| Option pointing area | label + **half a character** around it |
| Double-click interval | **700 ms** |
| Numeric columns | **decimal-point justified** |

---

## Anti-pattern checklist

Fast scan for the failures these sources most directly prohibit.

- [ ] Font size specified in px/pt with **no reference viewing distance**
- [ ] Container heights fixed so text **clips** when spacing or zoom increases
- [ ] Contrast below **4.5:1** for body text; icons/borders below **3:1**
- [ ] Colour as the **only** channel for status, series, or validation
- [ ] >**9** colours carrying meaning; >**10 %** of the screen highlighted
- [ ] Values the user must read **updating more than once per second**
- [ ] Auto-moving or auto-updating content with **no pause control**
- [ ] Any flashing above **3/s** in a public-facing product
- [ ] Response-time **variability** exceeding 5 %/10 %/15 % by band
- [ ] A delay over ~1 s with **no feedback**
- [ ] Pointer targets under **24 × 24 CSS px**; touch targets under **9.5 mm**
- [ ] Drag as the **only** way to do something
- [ ] Text baked into **images**
- [ ] Tooltips that vanish when you try to **reach them**
- [ ] A **destructive action as the default**, or a default that is not shown
- [ ] A user's edit silently **rewritten into the default**
- [ ] **Alarm loudness or warning levels** left user-adjustable
- [ ] Session timeout that **discards** the user's work
- [ ] Error messages that **auto-dismiss** before the user acts
- [ ] Requiring the user to **remember** the mode, or query the system to learn it
- [ ] Hamburger-only primary navigation on desktop

---

## Source quick map

| Need | Best source |
|---|---|
| Hard numbers for text on screen | **FAA-HF-STD-010A** Table 5.6-I (arcmin, ANSI/HFES + ISO 9241 derived) |
| Modern screen/UI review criteria | **NUREG-0700 Rev.4** |
| Defaults, ranges, adjustability | **FAA HF-STD-001B §10**, **MIL-STD-1472G §5.2.2.4.5**, NUREG Rev.1 |
| Normative `shall` statements | **MIL-STD-1472G** |
| Underlying rationale | **NASA HIDH** Ch.10 |
| Web-normative criteria | **WCAG 2.2** |
| Dense monitoring dashboards | **FHWA-HRT-16-060** |
| Where sources disagree | **[CROSS-SOURCE-REGISTER.md](CROSS-SOURCE-REGISTER.md)** |
