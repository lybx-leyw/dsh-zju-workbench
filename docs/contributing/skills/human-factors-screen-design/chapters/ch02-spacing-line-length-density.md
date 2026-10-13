# Chapter 2 — Spacing, line length, and display density

**Core idea.** The sources specify spacing twice, in two incompatible notations: as a **fraction of
character size** (stroke widths, percent of height, percent of width) for glyph-level gaps, and as a
**count of character cells** (spaces, character widths, blank lines) for layout-level gaps. Both are
usable, but they answer different questions and must not be averaged together. Separately, **display
density and line length are different quantities**: density is how much of the character-cell grid is
inked, line length is how far the eye travels to find the next line. Confusing them is the most
common serious layout error in this material.

---

## Character spacing (tracking)

Two notations, and they are not interchangeable.

| Requirement | Value | Source |
|---|---|---|
| Horizontal separation between characters or symbols | **10–65 % of character or symbol width** | NUREG-0700 Rev.1 §1.3.1-7 |
| Horizontal separation between characters or symbols | **25–60 % of character or symbol height** | NUREG-0700 Rev.4 §1.3.1-7 |
| Minimum, screen text | **≥1 stroke width or pixel, 2 preferred** (FAA); **≥10 % of character height** (FAA, second figure) | FAA HF-STD-001B §5.3.1.7.7, §5.6.2.5.6.1 |
| Minimum, equipment labels | **1 stroke width** | MIL-STD-1472G §5.4.6.3.9; FAA HF-STD-001B §5.4.1.2.3.7; NUREG-0700 Rev.4 §11.4.1.5-7 |
| Standards-derived floor, by typeface; and the recommendation | 1 pixel or 0.2 character width (NASA-STD-3000); stroke width (HFES 2007, sans serif); stroke width or 1 pixel (ISO 2001, sans serif); 1 pixel (HFES 2007 and ISO 2001, serif). **Recommended: 0.25–0.6 of a character width** (HFES) | NASA HIDH §10.3.2.7.6 |
| Degraded-viewing floor | **≥25 % of character height** | NUREG-0700 Rev.1 §1.3.1-7; Rev.4 §1.3.1-7 |

**Where the sources disagree, and the resolution.** Rev.1 measures the gap against character
**width**; Rev.4, on the same guideline number, measures it against character **height**. Those
differ physically: at a permitted fixed-spacing ratio of 1:0.7 (Rev.4 §1.3.1-5), 25 % of height is
a larger gap than 25 % of width. **Prefer Rev.4**: it is native digital text while Rev.1 arrives
through an OCR layer (`CROSS-SOURCE-REGISTER.md` §9), and its band (25–60 %) and floor (25 %) agree
with each other, whereas Rev.1's 10 % lower bound sits below NASA's HFES recommendation of 0.25
character width. **FAA also contradicts itself** (register §8): §5.3.1.7.7 gives one stroke width
or pixel while §5.6.2.5.6.1 gives ≥10 % of character height for the same requirement. At a stroke
width of 1/12 to 1/6 of height, 10 % of height falls at or below the low end of that range, so the
two nearly agree; **take whichever is larger for the font in hand**. NASA's 0.25–0.6 character
width is a *recommendation* rather than a floor, so it conflicts with neither.

**Degraded conditions that force the wider value** (NUREG-0700 Rev.1 §1.3.1-7, Rev.4 §1.3.1-7).
Use ≥25 % of character height if **any** of these holds. Check the list literally: several describe
ordinary web conditions.

1. character width < 85 % of height (condensed faces);
2. character luminance < 12 ft-L;
3. luminance contrast < 88 %;
4. display more than 35° left or right of the straight-ahead line of sight;
5. visual angle subtended by character or symbol height < 15 arcmin.

Conditions 2 and 5 mean **any text sized near Chapter 1's legibility floor also needs the wider
tracking**. Size and spacing are not independent budgets.

**WCAG 1.4.12 is a different measurement.** It requires content to survive the user setting letter
spacing to **≥0.12 × the font size** (WCAG 2.2, 1.4.12, AA). That is *added* tracking over the
font's own default gap, while the NUREG, MIL-STD and NASA figures are *total* separation, so the
two cannot be compared arithmetically. WCAG's value is a robustness requirement: content need not
use it, only survive it.

```css
body { letter-spacing: normal; }             /* 25–60% of height is the font's own business */
code, .coded-id { letter-spacing: 0.02em; }  /* separate confusable glyphs, not house style */
/* What must not break: letter-spacing 0.12em; word-spacing 0.16em; line-height 1.5;
   margin-block-end 2em. Never set a fixed height that clips any of these. */
```

---

## Word spacing

| Requirement | Value | Source |
|---|---|---|
| Minimum, displayed text | **1 character width (capital `N` for proportional spacing)**; must additionally **exceed the inter-character spacing** | NUREG-0700 Rev.1 §1.2.1-15; Rev.4 §1.2.1-15 |
| Minimum, screen text | **≥1 character width, or the width of capital `N`** | FAA HF-STD-001B §5.6.2.5.6.2 |
| Minimum, labels | **≈ the width of one normal-width character** (not `I` or `1`) | FAA HF-STD-001B §5.4.1.2.3.8 |
| Minimum, equipment labels | **≥1 character width** (except `I` or `1`) | MIL-STD-1472G §5.4.6.3.10 |
| Standards-derived | 1 letter width (NASA-STD-3000); **> letter spacing and ≥0.5 letter width** (HFES 2007); 1 letter width (ISO 2001) | NASA HIDH §10.3.2.7.8 |
| WCAG robustness floor | **≥0.16 × the font size** | WCAG 2.2, 1.4.12 (AA) |

**The one rule to carry: word spacing must exceed letter spacing.** NASA states it (HFES:
greater than the letter spacing and at least 0.5 letter width, §10.3.2.7.8) and NUREG-0700 Rev.4
states it (§1.2.1-15). Word boundaries are perceptible only relative to the gaps inside words, so
**raising tracking without raising the word gap destroys the boundary it meant to clarify**. In
CSS, either leave both at the font's defaults or raise both together so the ratio holds; never
set `word-spacing` alone.

---

## Line spacing (leading)

The sources split into two families and the difference is large enough to matter.

**Family A — the screen-text rule.** Inter-line spacing as a gap proportional to stroke width or
character height. **Family B — the label rule.** Inter-line spacing as a fraction of character
height, stated only in the label/placard clusters of three standards.

| Family | Requirement | Value | Source |
|---|---|---|---|
| A | Screen text, binding rule | **≥2 stroke widths or 15 % of character height, whichever is greater** | NUREG-0700 Rev.1 §1.2.1-16; Rev.4 §1.2.1-16; FAA HF-STD-001B §5.6.2.5.6.3 |
| A | Screen text, preferred | **≥2 stroke widths or pixels; 50–100 % of character height preferred** | FAA HF-STD-001B §5.3.1.7.8 |
| A | HFES recommendation; absolute floor | **0.15 of the letter height**; absolute floor **1 pixel** between lines including ascenders, descenders and diacritics | NASA HIDH §10.3.2.7.7 |
| B | Line spacing, labels and panel labels | **≈ one-half character height** (spacing in points = **0.50 ×** font size in points; **½** in MIL-STD) | FAA HF-STD-001B §5.4.1.2.3.9; MIL-STD-1472G §5.4.6.3.11; NUREG-0700 Rev.1 §7.5.6-6, Rev.4 §11.4.1.5-7 |

**Where the sources disagree, and the resolution.** 15 % versus 50 % is a factor of more than
three, and the register does not record it. It is a **domain plus unit disagreement**. The 15 %
figure is a *gap* between the descender line of one row and the ascender line of the next, and
NUREG and FAA both add the qualifier that it is **"in addition to"** the space required for
upper-case accent marks and lower-case descenders (NUREG-0700 Rev.1 §1.2.1-16; FAA HF-STD-001B
§5.6.2.5.6.3), so as a total line pitch it is character height **plus** 15 % **plus** whatever
the diacritics need. The 50 % figure appears only where the source is discussing **equipment
labels, placards and panel markings**: MIL-STD §5.4.6.3.11 sits in its "Design of label
characters" cluster, FAA §5.4.1.2.3.9 likewise, and NUREG's is in its panel-label section
`7.5.6`. MIL-STD-1472G records **no paragraph-spacing rule** and no prose line-spacing rule for
screens.

**Use ≥15 % for prose and data rows on screen; use one-half character height for standalone
labels and control markings.** Never apply the 50 % label rule to every row of a data table; it
halves the visible rows and buys nothing the row-scanning cue does not buy better. **FAA's own
note is the tiebreaker between the families:** *"The interline spacing recommended for text
displayed on terminals is greater than that recommended for printed material"* (§5.6.2.5.6.3
Discussion).

**Both families agree that leading must be computed upward from the *material* the font contains,
not from a bare em value.** NUREG-0700 Rev.1 §1.3.1-6 gives the concrete form: raise vertical
height **upward by two dot positions** for diacritics and **downward by at least one, preferably
two or more, dot positions** for lower-case descenders. A `line-height` that clips accents or
descenders under `overflow: hidden` violates both families.

**WCAG's contribution, and why it cannot be converted.** 1.4.12 requires the layout to survive
**line height ≥1.5 × the font size**; 1.4.8 (AAA) requires a mechanism for **leading at least
space-and-a-half within paragraphs** and **paragraph spacing ≥1.5 × the line spacing**. These are
different units from the 15 % figure: NUREG and FAA measure a *gap* between the descender line and
the next ascender line, while CSS `line-height` measures a *total line box* already containing the
glyph body. The gap criterion is a floor on the space between glyph extents, not a target for
`line-height`. **NASA cautions against over-tuning:** once characters do not overlap, spacing has
little effect on reading rate (NASA HIDH §10.3.2.7.1, Figure 10.3-15, S. T. Chung), and that study
font's default vertical spacing was **2.6 x-height**.

```css
/* WCAG 1.4.12 floor, and it also clears the 15 %-gap criterion, which the font's own metrics
   already supply. Do not shrink table rows below the prose value: FAA notes that terminal
   interline spacing must exceed print's. */
p, table.data td { line-height: 1.5; }
```

---

## Line length (measure)

| Requirement | Value | Source |
|---|---|---|
| Minimum for continuous text | **≥50 characters per line**; **50–80 produce no difference in reading time**, while <50 is slower | NUREG-0700 Rev.1 §1.2.1-12; Rev.4 §1.2.1-12 |
| Default text-window width; continuously scrolling text at a user-set rate | **50–80 characters**; **52–78 give the fastest performance** | NUREG-0700 Rev.1 §2.5.6-11; Rev.4 §2.5.2-11 |
| Text that must be **scanned while scrolled** | **≤35 characters across** | NUREG-0700 Rev.4 §2.5.1.3-7 |
| Maximum, AAA | **≤80 characters or glyphs (40 if CJK)** | WCAG 2.2, 1.4.8 (AAA) |
| Minimum lines shown at once; minimum text-window height | **≥4 lines** | NUREG-0700 Rev.1 §1.2.1-11, §2.5.6-10; Rev.4 §1.2.1-11, §2.5.2-10 |
| Glyph width once the line exceeds 80 characters | height:width **≥1:0.5**; for **≤80 characters**, **1:0.7 to 1:0.9** | FAA HF-STD-001B §5.6.2.5.6.10 |
| Printed body text, 8–12 pt | **14–36 picas** (a pica is 0.17 in / 4.23 mm) | FAA HF-STD-001B §5.13.3.3.2.1 |

**Where the sources disagree, and the resolution.** NUREG gives **≥50, no upper bound**, and says
50–80 produces no reading-time difference; WCAG 1.4.8 sets **≤80**. Compatible, and the register
records them side by side (§7): NUREG's floor is a reading-speed rule, WCAG's ceiling a
line-tracking rule. **The intersection, 50–80, is the band to design in**; 52–78 is the sub-band
with the fastest measured performance. The one place NUREG goes below 50 is not a contradiction:
Rev.4 §2.5.1.3-7 requires **≤35 characters** for text the user must *scan while it is scrolling*,
and says explicitly that this applies only to that case, since displays where the user alternates
between scrolling and reading may have wider columns. Scanning a moving target is a different task
and does not license short columns for prose. That rule is also **Rev.4-only**.

**A limitation of the sources, not a hidden rule:** MIL-STD sets **no characters-per-line maximum**
(it constrains column separation and tells you to hyphenate on small screens; MIL-STD-1472G gaps
section), FAA's on-screen material gives **no characters-per-line value** either, and
FHWA-HRT-16-060 contains **no line-length, stroke-width or arcmin figure at all**, stating that
operators are unlikely to have time to read sentences of text on monitors (Guideline 58). For a
line-length rule, NUREG and WCAG are the only authorities here.

**Do not compute the measure in pixels.** Every source states it in **characters**, and `ch` is the
only unit that follows a proportional font. A 700 px column is ~100 characters at 12 px and ~55 at
22 px.

```css
.prose        { max-width: 70ch; }  /* inside 50–80; 70 also sits in the 52–78 fastest band */
.reading-aaa  { max-width: 80ch; }  /* WCAG 1.4.8 ceiling; both satisfy NUREG §1.2.1-12 */
.log-scroller { max-width: 35ch; min-height: 4lh; }   /* §2.5.1.3-7 + §1.2.1-11, §2.5.2-10 */
```

---

## Display density

**Density is a different quantity from line length.** Density is the proportion of the
character-cell grid filled with ink; line length is the distance the eye travels from the end
of one line to the start of the next. This distinction is real and is recorded in the register
(§7). A dense screen can have a perfectly good measure, and a sparse screen can have a
terrible one.

| Requirement | Value | Source |
|---|---|---|
| Packing density ceiling | **≤50 %** | NUREG-0700 Rev.1 §1.1-11 |
| Displays consisting largely of alphanumerics; largely of graphics | **≤25 %**; graphics **may be more dense** (no figure given) | NUREG-0700 Rev.1 §1.1-11 |
| Text display screen density (ratio of characters to blank spaces) | **≤60 %** | FAA HF-STD-001B §5.6.1.1.3 |
| Highlighting budget, displays of normal conditions | **≤10 % of the display information** | NUREG-0700 Rev.1 §1.3.10-2 |
| Quiet zone around critical information | **≥1 blank character line above and below**; **≥2 blank character spaces left and right** | MIL-STD-1472G §5.2.2.2.2 |
| Alarm tile display matrix | **max 50 alarms per matrix**; fewer preferred | NUREG-0700 Rev.1 §4.5.7.1-5 |

**Use 25 % for screens that are mostly text, 50 % as the general ceiling, and treat 60 % as a hard
maximum.** The 60/50 gap is not a contradiction: FAA's 60 % is a *ratio of characters to blank
characters* on a text display (FAA HF-STD-001B §5.6.1.1.3), a cell-count measurement, while
NUREG's is a **packing density** qualified by content type, holding alphanumerics to 25 % because
dense text is the worst case for search (NUREG-0700 Rev.1 §1.1-11). The register records the
numbers (§7) but not this reason.

**Distribution is part of the rule, and density is a defence rather than a cap.** Unused area must
be **distributed to separate logical groups**, not piled on one side, and content too dense for one
frame must be **partitioned into separately displayable pages** (NUREG-0700 Rev.1 §1.1-11). As the
information on a display increases, so does the time to find a given piece of it (NASA HIDH
§10.6.2); NASA names the specific error, that the belief that minimising clicks justifies a large
amount of information on one display "often results in severely cluttered displays" that force
serial search and raise error risk under stress (NASA HIDH §10.6.5). FAA's version: only
information essential to the user at a given time should be present (FAA HF-STD-001B §5.6.1.1.2),
using the **fewest lines or objects** (NUREG-0700 Rev.1 §1.1-8).

**The highlighting budget is the density rule most worth reviving.** On normal-condition displays,
limit highlighting to **≤10 % of the display information**; past that point highlighting stops
being distinctive (NUREG-0700 Rev.1 §1.3.10-2). Corollaries: a method must be used **consistently**
and never for both emergency and normal conditions (§1.3.10-3); highlighting must be **removed when
it loses relevance**, so an error highlight goes when the error is corrected (§1.3.10-4); emphasis
works best **sparingly**, against an otherwise uniform display (§1.3.10-1 cluster). FAA agrees
qualitatively: *"The size and number of areas highlighted shall be minimized"* (§5.6.6.3.9), and
colour and flashing "should be used sparingly and judiciously" (§5.6.6.1.8). **Limitations:** the
10 % figure is NUREG-only and therefore single-source, and two related rules depend on density
rather than setting it, and **size coding should only be used at low item density**
(FAA HF-STD-001B §5.6.6.7.1), capped at **three** size codes (§5.6.6.7.2).

---

## Padding, margins, and clear space

| Requirement | Value | Source |
|---|---|---|
| Minimum clearance around a character or word, inside a border | **≥0.5 character height** | FAA HF-STD-001B §5.4.1.2.3.17; MIL-STD-1472G §5.4.6.5 |
| Upper limit on that clearance | must not make the label appear **"lost" within a large expanse of background** | MIL-STD-1472G §5.4.6.5; FAA HF-STD-001B §5.4.1.2.3.17 |
| Legend border width | **≥ the width of the letter `H`** of the selected font | MIL-STD-1472G §5.2.3.14.12 |
| Label-to-label separation | **≥2 standard character spaces**; menu-bar category labels **≥2 standard character widths** | NUREG-0700 Rev.1 §1.3.3-6, §2.2.2-9; Rev.4 §1.3.3-6; FAA HF-STD-001B §5.6.2.11.4.14 |
| Horizontal check-box separation | **3 spaces** between each box | FAA HF-STD-001B §5.6.13.7.9 |
| Title/header to body; frame identification to body | **≥1 blank line** | FAA HF-STD-001B §5.6.2.5.5.4; MIL-STD-1472G §5.2.2.2.4.n(5), §5.2.2.2.4.o(6); NUREG-0700 Rev.1 §1.1-5, §1.1-6 |

**The 0.5-character-height clearance is the most transferable padding number in this set.** Two
independent standards state it (FAA §5.4.1.2.3.17, MIL-STD §5.4.6.5), and it scales with type size,
which is what an accessible padding value should do (`padding: 0.5em`). The paired **upper** bound
matters too: over-padding a label until it floats in empty space is a defect, not a virtue.
MIL-STD's legend rule makes the same point in border terms: a legend's border is at least as thick
as the letter `H` of the font inside it, so a badge border should be roughly `0.12em`.

**Limitation:** the sources give no page margin for screens. The only margin figure in the set is
FAA's **printed** rule (§5.13.3.2.1.2, §5.13.3.2.1.3): margins **≥1 in (2.54 cm)** on all sides for
pages 8.5 × 11 in or larger, plus **0.5 in (1.3 cm)** extra on the left for binding. That is a sheet
of paper, not a viewport; do not carry it to a CSS `padding`.

---

## Grouping and column separation

Spacing is the primary grouping mechanism in this literature, and the sources are unusually
specific about how much.

| Requirement | Value | Source |
|---|---|---|
| Table column separation | **≥3 spaces** (MIL-STD, FAA); **≥2 character widths** when no vertical rules are used (NUREG) | MIL-STD-1472G §5.2.2.4.6.k; FAA HF-STD-001B §5.6.2.10.7; NUREG-0700 Rev.1 §1.2.2-6 |
| Table column separation, general | must be **greater than any internal spaces within a tabulated data item** | NUREG-0700 Rev.1 §1.2.2-6 |
| Table row scanning cue | **blank line after every fifth row**; alarm lists: **blank row every 4 or 5 messages** | FAA HF-STD-001B §5.6.2.10.7; NUREG-0700 Rev.1 §1.2.2-7, §2.2.5-17, §4.5.7.2-3 |
| Column widths and spacing | **uniform and consistent within a table and from one table to another**; extra space permitted only to separate superheading groups | MIL-STD-1472G §5.2.2.4.6.j; NUREG-0700 Rev.1 §1.2.2-5 |
| Field label to data entry area | **≥1 character space** | NUREG-0700 Rev.1 §1.2.3-6 |
| Longest data field in one column to rightmost label in the adjacent column | **≥3 spaces** (vertical rules may substitute under space constraints) | NUREG-0700 Rev.1 §1.2.3-7 |
| Labels of similar length; labels of widely varying length | left-justify **both** labels and data fields, **1 space** between the longest label and the data-field column; **right-justify labels, left-justify data**, **1 space** between each | NUREG-0700 Rev.1 §1.2.3-8, §1.2.3-9 |
| Between groups of data fields | **≥5 spaces** | NUREG-0700 Rev.1 §1.2.3-17 |
| Label indent under a heading on the line above; label column to an adjacent heading | **≥5 spaces** from the start of the heading; **≥3 blank spaces** | NUREG-0700 Rev.1 §1.2.3-18, §1.2.3-19 |
| Bar spacing for comparison; bar graph bars; histograms | **less than the bar width** (contiguously if an alternating bright/dark banding appears); adjacent bars **not more than one bar width apart**; bars **contiguous** for histograms | NUREG-0700 Rev.1 §1.2.4-3; MIL-STD-1472G §5.2.2.5.2.b(8), §5.2.2.5.2.b(9) |

**Where the sources disagree, and the resolution.** MIL-STD and FAA say **≥3 spaces**; NUREG says
**≥2 character widths** when columns are not separated by vertical lines. Same order of magnitude,
different notation, and NUREG's rule is conditional on the absence of rules. NUREG adds the
constraint that does the real work: the gap must exceed the widest internal run of whitespace in any
cell, which is what stops adjacent columns merging. **Use the larger of the two.**

**Note the deliberate exception to consistency.** Column and row spacing must be consistent *except*
that extra space between superheadings may show which columns belong under one heading (NUREG-0700
Rev.1 §1.2.2-5). Inconsistent spacing is a defect; *hierarchically consistent* spacing is the point.
FAA's **printed** guidance gives a transferable vertical-rhythm scale: with one unit as the base,
**two units between paragraphs, four between a subheading and a paragraph, and eight between a major
heading and a subheading** (§5.13.3.2.3.1), leftmost position for the highest level and successively
lower levels indented (§5.13.3.2.3.2).

**Grouping mechanism and order.** Groups separate by **blanks, spacing lines, or colour**
(MIL-STD-1472G §5.2.2.2.6.b). Group *contents* follow this order: (1) natural order or sequence;
(2) importance, critical or immediately actionable items **at the top**; (3) function; (4) frequency,
more-used items at the top (§5.2.2.2.6.a). Visual flow runs **left-to-right or top-to-bottom**
(§5.2.2.2.5.d), and the **last few lines of every display are reserved** for status and error
messages, prompts and command entry (§5.2.2.2.4.k). NASA states the payoff: good spacing "increases
readability, decreases task completion time, and reduces visual fatigue" (NASA HIDH §10.5.4.4).

---

## Paragraphs, justification, and wrapping

| Requirement | Value | Source |
|---|---|---|
| Text must **not** be justified | no alignment to both margins | WCAG 2.2, 1.4.8 (AAA) |
| Full justification | **slows reading time**; only acceptable if achieved by variable spacing that keeps constant proportional differences between and within words | NUREG-0700 Rev.1 §1.2.1-15; Rev.4 §1.2.1-15 |
| Default justification; options offered to the user | **left-justified** with consistent spacing between words; **left, right, center, and full** offered as options | FAA HF-STD-001B §5.6.2.4.3.6, §5.6.2.4.3.7; NUREG-0700 Rev.1 §2.6.1-6 |
| Paragraph separation, displayed text | **≥1 blank line** | NUREG-0700 Rev.1 §1.2.1-17; Rev.4 §1.2.1-17; FAA HF-STD-001B §5.6.2.5.6.4 |
| Paragraph spacing as a WCAG robustness/AAA mechanism | **≥2 × the font size** (1.4.12); **≥1.5 × the line spacing** (1.4.8) | WCAG 2.2, 1.4.12 (AA), 1.4.8 (AAA) |
| Indentation | text displays must be **consistent in the use of indentation** (indent paragraphs or not) | NUREG-0700 Rev.4 §1.2.1-18 |
| Hyphenation | default **no hyphenation**; policy **minimal**, keeping each word entirely on one line even at the cost of a more ragged right margin; hyphenate at line breaks on small screens **to avoid variable-length lines** | FAA HF-STD-001B §5.6.2.4.3.9; NUREG-0700 Rev.1 §1.2.1-13, Rev.4 §1.2.1-13; MIL-STD-1472G §5.2.3.3.3, §5.2.3.4.3 |
| Automatic word wrap | **shall** be provided at the right margin for entry/editing of unformatted text, **with user override** | MIL-STD-1472G §5.2.2.4.3.g–h |
| Alignment of labels | left when label lengths are similar; **right** when lengths are mixed; wrapping "increases recognition and response times and should be avoided whenever possible" | NASA HIDH §10.11.5.4 |
| Column justification; entry justification | alphabetic columns **left**; numeric columns **decimal-point justified**, or **right** if no decimal point. Entry: alphanumeric left; integer numeric right; decimal numeric decimal-point | NUREG-0700 Rev.1 §1.2.2-9, §1.2.2-10; MIL-STD-1472G §5.2.2.4.6.h; FAA HF-STD-001B §5.6.2.3.6 |
| Group heading position | **centred above** the labels it applies to | NUREG-0700 Rev.1 §1.2.3-16 |

**Where the sources disagree, and the resolution — justification.** A genuine three-way split the
register does not record. **WCAG 1.4.8 (AAA)** requires a *mechanism* for text **not justified**,
because justification introduces uneven word spacing. **NUREG-0700** supplies the rationale:
constant inter-word spacing is easier to read and outweighs an even right margin, and **full
justification slows reading time** (§1.2.1-15, both revisions), with uneven spacing handicapping
poor readers more than good ones. **FAA HF-STD-001B** permits full justification in **printed**
documentation (§5.13.3.3.4.1), while its **screen** rules default to left justification and offer
full justification as a **user option** (§5.6.2.4.3.6, §5.6.2.4.3.7).

**Resolution:** compatible once the unit is fixed. NUREG measures reading time at a fixed measure,
WCAG protects the user who chooses no justification, FAA permits the option. **Ship `text-align:
left`, never justify by default, and never justify at a narrow measure**, where NUREG's uneven word
gaps are worst. A full-justification toggle satisfies FAA §5.6.2.4.3.7 without violating WCAG 1.4.8,
which asks for a mechanism, not a style.

**Where the sources disagree — hyphenation.** FAA sets the **default to no hyphenation**
(§5.6.2.4.3.9); NUREG calls for **minimal** hyphenation with words kept intact (§1.2.1-13);
MIL-STD, scoped explicitly to **small-screen and handheld displays**, requires hyphenation at line
breaks **to avoid variable-length lines** (§5.2.3.3.3, §5.2.3.4.3). A **domain disagreement about
measure**: at a wide measure hyphenation costs comprehension for no gain, while at a narrow measure
the alternative is a ragged variable-length measure MIL-STD judges worse. **Use `hyphens: none` at
50–80 characters, `hyphens: auto` only inside MIL-STD's scope.**

```css
.prose {
  text-align: left;      hyphens: none;      /* WCAG 1.4.8, NUREG §1.2.1-15, FAA §5.6.2.4.3.9 */
  max-width: 80ch;       line-height: 1.5;   /* WCAG 1.4.12 */
  margin-block-end: 2em; overflow-wrap: break-word;   /* WCAG 1.4.12: ≥2 × font size */
}
.narrow-viewport .prose { hyphens: auto; }   /* MIL-STD §5.2.3.3.3 scope */
td.num { font-variant-numeric: tabular-nums; text-align: right; }  /* NUREG §1.2.2-10 */
```

---

## Anti-patterns

- **Treating density and line length as one budget.** A 50 %-dense screen with a 120-character
  measure is two separate defects: density constrains ink in cells, measure constrains eye travel.
- **Averaging 15 % and 50 % into "about a third".** The 15 % rule is a screen-text gap explicitly
  *in addition to* accent and descender space; the 50 % rule is a label rule. No source states the
  average.
- **Applying the label leading rule to a data table.** One-half character height is about placards
  and panel markings; on a 40-row table it halves the visible rows and buys nothing the
  row-scanning cue does not buy better.
- **Full-justifying body text at a narrow measure.** NUREG's reason is that constant word spacing
  is easier to read and the ragged margin is the cheaper price (§1.2.1-15); at a short measure the
  compensating word gaps dominate.
- **Raising tracking without raising word spacing.** NASA and NUREG both require word spacing to
  exceed letter spacing, so a lone letter-gap increase erases the word boundaries it meant to
  protect.
- **Fixing container heights.** Any `height` that clips when `line-height` grows to 1.5,
  letter-spacing to 0.12 em, or word-spacing to 0.16 em fails WCAG 1.4.12, and any container that
  clips descenders also fails NUREG §1.2.1-16's "in addition to" clause.
- **Highlighting over 10 % of a normal-condition display, leaving resolved highlights on, or
  reusing an emergency highlight for normal states.** NUREG §1.3.10-2 through §1.3.10-4 prohibit
  all three; a screen showing yesterday's resolved errors in alarm red trains users to ignore alarm
  red.
- **Setting a pixel `max-width` for prose, or hyphenating at a wide measure.** The measure
  requirement is in characters, and a pixel value silently changes it whenever the base font size
  changes; hyphenation is for MIL-STD's small-screen scope only.
- **Relying on WCAG 1.4.12's numbers as the design.** 1.5 / 2 / 0.12 / 0.16 are what the layout
  must *survive*, not what it should *use*. A page shipping exactly 1.5 leading that clips at 1.6
  is non-conformant in the way that matters.

---

## Connects to

- **Ch 1 (Text size and legibility)** — the degraded-viewing floor for character spacing
  (NUREG-0700 §1.3.1-7) is triggered by the very character heights Chapter 1 derives, so sizing
  text near the legibility floor obliges you to widen the tracking too.
- **Ch 3 (Contrast and colour)** — a luminance contrast below 88 % is one of the five degraded
  conditions that force ≥25 % character spacing, tying the spacing budget to the contrast budget.
- **Ch 6 (Targets and layout)** — icon and target separation figures are the pointer analogue of
  these grouping rules; the alarm-matrix limit and the icon-spacing minima are one grouping problem
  in two notations.
- **Ch 8 (Alerts and messages)** — the blank-row interval for alarm lists and the
  highlighting-consistency rules constrain how alert text is laid out.
- **Ch 9 (Navigation, menus, forms)** — form field spacing applies NUREG-0700 §1.2.3-6 through
  §1.2.3-19 directly.
- `CROSS-SOURCE-REGISTER.md` **§7** records the density and line-length figures and the
  density-versus-measure distinction, but not the character-spacing basis conflict, the
  line-spacing family split, or the justification and hyphenation conflicts reconciled here.
  **§8** covers FAA's *internal* spacing contradiction, a smaller and separate issue; the
  line-spacing family split above is larger and involves three standards.
