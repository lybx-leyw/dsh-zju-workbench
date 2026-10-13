# Chapter 1 — Text size and legibility

**Core idea.** Every authoritative source in this set specifies text size as a **visual
angle in minutes of arc at the expected viewing distance**, never as a fixed point or pixel
size. Size in points is meaningless without knowing how far away the reader is. Convert
once, at design time, from a stated reference distance — and choose the size from the
*reading task*, not from a single magic number.

---

## Minimum size

Six sources converge on essentially the same requirement expressed three different ways.

| Requirement | Value | Source |
|---|---|---|
| Legibility floor, text that need only be legible | **16 arcmin** | FAA HF-STD-001B §5.3.1.9; ANSI 1988 |
| Preferred for reading | **20–22 arcmin** | FAA HF-STD-001B §5.3.1.9; ANSI 1988 |
| Text that must be read **rapidly** | **24 arcmin** | FAA HF-STD-001B §5.3.1.9 |
| Maximum for readability | **24 arcmin** | FAA HF-STD-001B §5.3.1.9 |
| Maximum, non-contextual groups of characters | **45 arcmin** | FAA HF-STD-001B §5.3.1.9 |
| VDU text or labels | **≥16 arcmin (4.7 mrad)**, max 24 arcmin (7 mrad), 20–22 preferred, ≤45 in groups | NUREG-0700 Rev.1 §1.3.1-4 |
| Minimum, as a distance formula | **15 arcmin = distance × 0.004** | NUREG-0700 Rev.1 §7.5.6-1 |
| Preferred, as a distance formula | **20 arcmin = distance × 0.006** | NUREG-0700 Rev.1 §7.5.6-1 |
| Acuity floor (absolute) | **5 arcmin** | NASA HIDH |
| Optimal reading width | **24–42 arcmin** | NASA HIDH |

MIL-STD-1472G expresses the same requirement in millimetres at a **710 mm (28 in)**
reference distance, with an explicit scaling instruction — *multiply the values by
D / 710 mm*:

| Marking class | Low lighting (≤3.5 cd/m²) | Normal lighting (>3.5 cd/m²) |
|---|---|---|
| Critical, position variable (e.g. counter numerals) | 5.0–8.0 mm | 3.0–5.0 mm |
| Critical, position fixed (e.g. scale numerals, emergency instructions) | 4.0–8.0 mm | 2.5–5.0 mm |
| Non-critical (identification labels, familiarisation markings) | 2.5–5.0 mm | 2.5–5.0 mm |

**These agree.** Converting MIL-STD's millimetres to arcmin at its own 710 mm reference:

```
2.5 mm ÷ 710 mm ≈ 12.1 arcmin        5.0 mm ≈ 24.2 arcmin
3.0 mm          ≈ 14.5 arcmin        8.0 mm ≈ 38.7 arcmin
4.0 mm          ≈ 19.4 arcmin
```

So its 2.5–5.0 mm band is ≈12–24 arcmin, and its 5.0–8.0 mm low-light band is
≈24–39 arcmin. Both land inside the band the aviation and nuclear documents give. The
standards are consistent; only the notation differs.

---

## Converting to pixels

Fix a reference viewing distance, then convert. Exact form and the small-angle shortcut
agree to within 0.1 % across the ranges here.

```
angle_arcmin = 2 × atan( size / (2 × distance) ) × (180/π) × 60     # exact
angle_arcmin ≈ size / distance × 3437.75                            # shortcut, size << distance

size_mm = 2 × distance_mm × tan( radians(arcmin/60) / 2 )
size_px = size_mm / (25.4 / ppi)
```

**Worked example — desktop monitor, 600 mm viewing distance, 96 ppi:**

| Target | Arcmin | Cap height (mm) | Cap height (px) |
|---|---|---|---|
| Legibility floor | 16 | 2.79 | 10.6 |
| Preferred reading | 20 | 3.49 | 13.2 |
| Preferred upper | 22 | 3.84 | 14.5 |
| Rapid reading / max | 24 | 4.19 | 15.8 |

**Read that table carefully — it is the single most useful output of this chapter.** A
20-arcmin requirement at a typical desktop distance is only about **13 px of cap height**.
Most design systems default to a 16 px *font size*, which includes ascender and descender
space, so its cap height is roughly 11 px — slightly *under* the preferred band but above
the legibility floor. The practical lesson is not "use tiny text"; it is that the
requirement is **not satisfied by habit** and must be computed per context. At a 1000 mm
kiosk distance the same 20 arcmin demands ≈21 px of cap height; on a phone held at 300 mm
it demands ≈6.5 px, which is why phone text at 16 px equivalent is comfortable.

**Do not confuse cap height with font size.** Arcmin requirements govern the height of the
*character*. `font-size` in CSS and points includes internal leading, so the numeric font
size must be meaningfully larger than the computed cap height — commonly by a factor of
~1.3–1.5 depending on the font's metrics.

---

## Case, font, and stroke

- **Uppercase is slower and less legible.** MIL-STD-1472G: labels shorter than three words
  **shall** be upper case only; labels longer than three words **shall** be upper and lower
  case. NUREG-0700 Rev.1 §1.3.11: upper case should be reserved for items intended to
  attract attention (labels, titles) or where lower case loses legibility (e.g. no true
  descenders). Set long strings in mixed case.
- **Bold is not a free emphasis channel.** FHWA-HRT-16-060 reports (citing Bernard et al.
  2013) that **bold text reduces reading speed both centrally and in the periphery** —
  with the periphery operationalised as 10° from the central display. Use bold sparingly.
- **Avoid thin strokes and unfamiliar letterforms.** WCAG 2.2, definition of *large scale
  (text)*, Note 1: fonts with *extraordinarily thin strokes* or unusual features that reduce
  the familiarity of their letter forms are harder to read, **especially at lower contrast**.
  Stroke weight and contrast are coupled, not independent.
- **Stroke width relative to height.** The sources disagree on the exact fraction, and both
  bands are quoted rather than silently merged:
  - **1/12 to 1/6** of character height — NASA HIDH (HFES basis); equivalently ≈8–17 %
  - **10 to 12.5 %** of character height — FAA HF-STD-001B (two clusters give 1/12–1/6 and
    10–12.5 % for the same requirement)
  - **>1/12** of character height (floor) — NUREG-0700 Rev.1
  - **0.0834 to 0.1667** of the pixel count used for height — MIL-STD-1472G §5.2.2.4.1.e
    (≈1/12 to 1/6, i.e. the same band)
  - **0.1667 to 0.125** (= 1/6 to 1/8) for light markings on dark backgrounds, and
    **0.1667 to 0.1429** (= 1/6 to 1/7) for black on white — MIL-STD-1472G §5.4.6.3.7

  The consistent signal: **stroke width should scale with height and sit around 1/12 to 1/6
  of it**, with *thicker* strokes for light-on-dark. The polarity dependence is a real,
  actionable finding.
- **Width-to-height ratio.** NUREG-0700 Rev.1 §1.3.15: for fixed (non-proportional)
  presentations, height-to-width ratio should be between **1:0.7 and 1:0.9**; for
  proportionally spaced presentations a ratio closer to 1:1 is permitted for some characters
  (e.g. M and W). MIL-STD-1472G gives 3:2 (height:width) for rocker-switch illuminated
  characters. Prefer a proportional font and do not force a ratio.
- **Font style.** NUREG-0700 Rev.1 §1.3.12: use a clearly legible font with true ascenders
  and descenders, uniform stroke width, and uniform aspect ratio. Avoid script and highly
  stylised faces — specifically those with extended serifs, internal patterns or stripes,
  that are italicised, screened, shadowed, or distorted to look handwritten. FAA
  HF-STD-001B: **at most two fonts per screen**; prefer sans-serif for screen display.
- **Character distinguishability.** NUREG-0700 Rev.1 §1.3.13: for a given font it should be
  possible to distinguish **X/K, T/Y, I/L, I/1, O/Q, S/5, U/V**. Choose fonts and sizes that
  keep these pairs apart — this is the practical reason to avoid condensed and very light
  weights, and the reason a mono font is a poor choice for prose but a good one for codes.
  NUREG-0700 **Rev.4 §1.3.1-x** extends the list with **O/0**, which is the pair that matters
  most in code and identifier contexts.

---

## Rev.4 confirms the ladder, and adds the pixel and distance forms

NUREG-0700 **Rev.4** (the current revision) restates the character-size ladder independently
and confirms every figure above, so nothing in this chapter rests on a single source:

> "The height of characters in displayed text or labels should be **at least 16 minutes of arc**
> and the **maximum character height should be 22–30 minutes of arc** at the design viewing
> distance… Character heights of **20–22 minutes of arc are preferred** for reading tasks…
> Characters **should not be larger than 45 minutes of arc** when groups of characters are
> displayed." — NUREG-0700 Rev.4 §1.3.1-4

It also gives the conversion in the form the FAA uses (`Height = 6.283·D·(MA)/21600`, i.e. the
arc-length form), and supplies three things the older sources left implicit:

**1. A ready-made distance table** (§12.2.1.1.2-3, `Table 12.5`), minimum / preferred:

| Viewing distance | Minimum height | Preferred height |
|---|---|---|
| 0.71 m (2.33 ft) | 2.84 mm | 4.27 mm |
| 0.91 m (3 ft) | 3.56 mm | 5.49 mm |
| 1.22 m (4 ft) | 4.88 mm | 7.32 mm |
| 1.52 m (5 ft) | 6.10 mm | 9.14 mm |
| 1.83 m (6 ft) | 7.32 mm | 10.97 mm |
| 3.05 m (10 ft) | 12.19 mm | 18.29 mm |
| 6.10 m (20 ft) | 24.38 mm | 36.58 mm |
| 9.14 m (30 ft) | 36.58 mm | 54.86 mm |
| 12.19 m (40 ft) | 48.77 mm | 73.15 mm |

**A discrepancy worth knowing about, because it is a real trap.** The table's "minimum" column
is derived from the source's own multiplier rule, `minimum = distance × 0.004`, which §11.4.1.5-1
and §12.2.1.1.2-3 both label as **15 arcmin**. But 15 arcmin is **0.004363 radians**, not 0.004 —
so the multiplier as printed encodes:

| Source rule | Multiplier | Arcmin it actually encodes | Labelled as |
|---|---|---|---|
| minimum | `distance × 0.004` | **13.75 arcmin** | "15 minutes" |
| preferred | `distance × 0.006` | **20.63 arcmin** | "20 minutes" |

Checked against the table itself, every minimum row lands at **≈13.7 arcmin** and every preferred
row at **≈20.6 arcmin**, consistently across all nine distances — so the table faithfully
implements the multipliers, and the rounding error is in the *labels*, not the arithmetic. The
minimum column is therefore about **8 % smaller than the "15 arcmin" it claims to represent**, and
also below §1.3.1-4's **16 arcmin** floor.

**Practical consequence:** the safe reading of this table is **preferred ≈ 20.6 arcmin** (which
comfortably clears both the 16 and 20 arcmin requirements) and **minimum = do not trust it as a
floor**. If you take the minimum column literally you will size text ~13 % below the 16-arcmin
requirement. Use `distance × 0.00463` for a true 16 arcmin, or simply take the preferred column.

**2. The pixel-matrix floors** (§1.3.1-6) — the minimum raster on which a glyph may be drawn,
which matters when you are choosing bitmap assets, icon glyphs, or a canvas font:

| Element | Minimum matrix |
|---|---|
| General characters | **≥9 px high × 7 px wide** |
| Uppercase letters and numerals | **≥7 px high × 5 px wide** |
| Superscripts, subscripts, fraction numerators | **≥5 px high × 4 px wide** |

If diacritical marks are used, the vertical height must be increased upward by two dot positions.

**3. The "use preferred as minimum" escalation** (§12.2.1.1.2-3):

> "Under less-than-optimal viewing conditions the **preferred values should be used as minima**;
> preferred values also apply to **critical markings for safety-related systems**."

This is the operational rule that resolves much of the apparent latitude in the ladder. The
20–22 arcmin band is "preferred" only under good conditions; as viewing conditions degrade —
glare, vibration, smoke, a moving platform, an older user — **20 arcmin becomes the floor, not
the target.**

### Width-to-height, refined in Rev.4

Rev.4 gives two bands where Rev.1 gave one, and they are for different element classes:

| Element class | Ratio | Source |
|---|---|---|
| Fixed-spacing presentations (general) | height:width between **1:0.6 and 1:0.9** | Rev.4 §1.3.1-5 |
| Proportionally spaced (some characters, e.g. M and W) | closer to **1:1** permitted | Rev.4 §1.3.1-5 |
| Panel **letters** | width:height between **1:1 and 3:5** | Rev.4 §11.4.1.5-5 |
| Panel **numerals** | width:height **3:5**, except "4" (one stroke wider) and "1" (one stroke wide) | Rev.4 §11.4.1.5-5 |

Rev.1's 1:0.7–1:0.9 sits inside Rev.4's wider 1:0.6–1:0.9, so the two revisions are compatible.
Rev.4's stroke-width figure for panel lettering is **1:6 to 1:8** (§11.4.1.5-6), which is thinner
than the 1/12–1/6 general band — another instance of the pattern that **the correct ratio depends
on the element class and polarity**, and why this chapter quotes bands rather than one number.

Rev.4 also adds a rule that matters for data display rather than prose: **more than four digits
should be grouped** and the groups separated by commas, a decimal point, or added space
(§3.2.3-3).

---

## Where the web guidance deliberately differs

**WCAG 2.2 sets no absolute minimum text size at all.** It defines only:

- *large scale (text)* = **≥18 pt, or 14 pt bold**, or an equivalent size for CJK fonts —
  and this exists only to select which contrast ratio applies (3:1 instead of 4.5:1).
  WCAG notes 14 pt and 18 pt are ≈1.2 em / 1.5 em for mainstream body fonts, but that this
  must be verified per font.

This is not an omission. WCAG is written for content whose **viewing distance, device, and
user are all unknown**. Its answer to "how big should text be" is therefore "it must survive
being made bigger":

- **1.4.4 Resize Text (AA)** — text resizable to **200 %** without loss of content or
  functionality.
- **1.4.10 Reflow (AA)** — no two-dimensional scrolling at **320 CSS px** width (equivalent
  to 1280 px at 400 % zoom) or **256 CSS px** height.
- **1.4.12 Text Spacing (AA)** — no loss of content when line height is **≥1.5 ×** font size,
  paragraph spacing **≥2 ×**, letter spacing **≥0.12 ×**, word spacing **≥0.16 ×**.

**Use both.** Choose the default from the arcmin rules for your known context, and satisfy
WCAG's resizing and reflow requirements so the layout survives the user overriding it. A
design carrying only the arcmin numbers is correctly sized and unadjustable; one carrying
only WCAG is adjustable from a bad starting point.

---

## Anti-patterns

- **Specifying `font-size` in points or pixels with no reference viewing distance.** The
  number is then unfalsifiable and untransferable. State the distance or state the angle.
- **Treating "preferred size" as "minimum size".** 16 arcmin is a floor for *legibility*;
  24 arcmin is the floor for *rapid* reading. Using 16 for a value the user must read quickly
  is a defect even though it clears the floor.
- **Scaling text with viewport width alone.** Text size must track *viewing distance*, which
  correlates with but is not identical to viewport size — a 13″ laptop and a 27″ monitor can
  be at the same distance and need the same arcmin, i.e. different pixel sizes.
- **Making bold the default emphasis.** It measurably slows peripheral reading, and it
  competes with weight-based hierarchy.
- **Fixing container heights.** Anything that clips when line-height, letter-spacing, or
  zoom increases fails WCAG 1.4.12 and 1.4.4 — and this is the most commonly failed
  criterion in real component libraries.
- **Assuming the arcmin rule can be satisfied by habit.** Compute it. The computed answer is
  often smaller or larger than the habit.

---

## Connects to

- **Ch 2 (Spacing)** — character spacing, word spacing, line spacing, and line length are the
  second half of legibility; size alone does not make text readable.
- **Ch 3 (Contrast and colour)** — stroke width and contrast interact; WCAG's own definition
  of large text notes that thin strokes hurt most at low contrast.
- **Ch 7 (User-adjustable parameters and defaults)** — how large the *default* should be, and
  how much adjustment to allow, is a separate decision covered there.
- `CROSS-SOURCE-REGISTER.md` §1 — the full reconciliation of character-height figures,
  including between-source unit conversion.
