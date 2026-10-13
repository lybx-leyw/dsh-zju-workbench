# Chapter 3 — Contrast, luminance, and colour

**Core idea.** Contrast is specified as a **ratio**, luminance as an **absolute** photometric
quantity, and colour as a **coding channel with a hard budget and a mandatory redundant partner**.
The sources appear to disagree about the contrast number (3:1, 4.5:1, 6:1, 7:1) and about colour
count (4, 7, 9, 11, 24, 30). Both dissolve once you ask *which question the number answers* — and
both have a floor nothing compromises on: **3:1** minimum for text, and **colour never as the only
channel**.

---

## Contrast ratios — one requirement, several numbers

| Requirement | Value | Source |
|---|---|---|
| Text and images of text | **≥4.5:1** | WCAG 2.2 §1.4.3 (AA) |
| Large-scale text (≥18 pt, or 14 pt bold) | **≥3:1** | WCAG 2.2 §1.4.3 (AA) |
| Text, enhanced | **≥7:1** | WCAG 2.2 §1.4.6 (AAA) |
| Large-scale text, enhanced | **≥4.5:1** | WCAG 2.2 §1.4.6 (AAA) |
| Non-text: UI components and their states, parts of graphics needed to understand content | **≥3:1** against adjacent colours | WCAG 2.2 §1.4.11 (AA) |
| Display foreground to background | **>3:1**, **7:1 preferred** | FAA HF-STD-001B §5.3.1.5.9 |
| Text, symbols, icons against **all** backgrounds, at highest expected ambient illumination | **≥3:1** | FAA-HF-STD-010A §5.5 |
| Where backgrounds can vary (overlaid on imagery) | **7:1 recommended** | FAA-HF-STD-010A §5.5 |
| Characters against background | **≥6:1**, **≥10:1 preferred** | MIL-STD-1472G §5.2.1.5.1 |
| Character contrast for optimum legibility | **6:1 to 10:1** | FAA HF-STD-001B §5.6.2.5.6.12 |
| VDU contrast ratio | **>3:1**, **7:1 preferred** | NUREG-0700 Rev.1 §1.5.1-2 |
| **Display screen contrast ratio (current revision)** | **≥6:1**, **10:1 preferred** | NUREG-0700 Rev.4 §11.3.1.4.1-2 |
| Screen under specular illumination from a 1,000 cd/m² source subtending 15° | **≥3:1** | NUREG-0700 Rev.4 §11.3.1.3-2 |
| Screen under 1,000 lx Lambertian ambient (glare) | **≥3:1** | NUREG-0700 Rev.4 §11.3.1.3-3 |
| Display luminance adjustment range | **≥10:1**, preferably **50:1** | NUREG-0700 Rev.4 §11.3.1.4.3-3 |
| Ambient reflection contribution to screen luminance | **≤25 %** | NUREG-0700 Rev.4 §11.3.1.3-4 |
| Default / floor, office conditions | **10** default, **≥3** under all office illumination | NASA HIDH §10.3.2.2.2.8 (citing HFES 2007) |
| Worst symbology at highest ambient light | **not less than 2:1** | FAA HF-STD-001B §5.3.1.5.10 |
| Discomfort threshold | contrasts above **15:1** may cause visual discomfort | FAA HF-STD-001B §5.6.2.5.6.12 (Discussion) |

### Reconciliation

**Three questions, not several answers to one.** *Arbitrary text in unknown conditions* → WCAG's
**4.5:1**, because WCAG cannot assume a display, font, size, or viewing distance. *Text in an
environment you control* → **3:1 minimum, 7:1 preferred** (FAA HF-STD-001B §5.3.1.5.9; NUREG-0700
Rev.1 §1.5.1-2), the 7:1 attributed by FAA-HF-STD-010A §5.5 to ANSI/HFES-200 (2008) and NUREG-0700
(2002). *Characters on a controlled display* → MIL-STD's **6:1 / 10:1** (§5.2.1.5.1) and, in the
current revision, NUREG-0700 Rev.4's **6:1 / 10:1** screen figure (§11.3.1.4.1-2): not a conflict,
because both specify a *known* background. MIL-STD carries **no** general 3:1 text rule — its coverage
note (mined §24) records no figures beyond §5.2.1.5.1, so its 3:1 values are table XII / XXIV
*surface* ratios (§5.2.1.3.6, §5.5.3.2). The **2:1** figure is conditional, not competing
(§5.3.1.5.10): *as the highest ambient light level is reached*, the ratio between the
**lowest-intensity symbology** and the background **shall degrade to not less than 2:1** — with the
escape clause "unless a lower contrast has been manually selected". And there is an **upper bound**
web guidance never states (§5.6.2.5.6.12): legibility may diminish below **3:1**, while contrasts
above **15:1** may cause visual discomfort, so MIL-STD's preferred value is **10:1**, not "as high as
possible". **Domain caveat, stated rather than resolved:** FHWA-HRT-16-060 Guideline 70 asserts there
is *"no standard minimum values due to the differences in each environment when screens are viewed"*,
requiring in-situ verification — a claim about a **large central wall display viewed across a room**,
where the ambient term dominates. For a workstation screen take the ratio rules; for a wall display
take the mandate to measure.

### Rev.4 is stricter than WCAG, and matches MIL-STD

The **current revision of NUREG-0700 changed its answer.** Rev.1 said **>3:1 minimum, 7:1 preferred**
(§1.5.1-2); Rev.4 says the **display screen contrast ratio should be a minimum of 6:1, with 10:1
preferred** (§11.3.1.4.1-2). That is **stricter than WCAG's 4.5:1**, and it lands exactly on
MIL-STD's character-contrast rule — **≥6:1, ≥10:1 preferred** (§5.2.1.5.1). Two independent sources
arriving at the same pair, one of them the current revision of the nuclear-industry review guideline,
is the strongest convergence in this chapter. **Where WCAG 4.5:1 and Rev.4 6:1 disagree they are
answering different questions again:** WCAG sets a floor for unknown content on unknown devices, Rev.4
a screen-level requirement for a controlled console. Neither displaces the other, but if you know the
display and the room, **6:1 is the better floor and 10:1 the better target.**

Three implementable details from Rev.4 §11.3.1.4.1-2 and its neighbours:

1. **The ratio must include ambient light, reflections, and glare.** Rev.4 states the ratio *"should
   include any contributions caused by ambient light, reflections, or glare on the screen"*. A ratio
   computed from CSS foreground and background colours alone therefore **overstates real contrast**,
   because it omits the veiling term ambient light adds to both the black and the white — the same
   mechanism NASA HIDH §10.3.2.2.2.6 quantifies (100:10 becomes 5.5:1 once 10 cd/m² of ambient is
   added). Treat a programmatically computed ratio as an **upper bound** on what the user sees.
2. **It degrades to ≥3:1 in the two defined stress cases** — under **1,000 lx Lambertian ambient
   (glare)** (§11.3.1.3-3) and under **specular illumination from a 1,000 cd/m² source subtending
   15°** (§11.3.1.3-2). The 6:1 figure is for normal conditions; hold **3:1** when a bright source or
   a bright room is in play. Related cap: the ambient contribution to screen luminance from reflection
   should be **≤25 %** of overall screen luminance — *"the image should not appear washed out"*
   (§11.3.1.3-4).
3. **Either polarity is acceptable — until the room gets bright.** Rev.4 states *"Either display
   polarity (dark characters on light background, or light characters on dark background) is
   acceptable"*, **except** that *"when ambient illumination near the display screen is high (greater
   than or 540 lx, or 50.2 fc), dark characters on a light background should be used"*
   (§11.3.1.4.1-2). **540 lx is roughly a well-lit office**, so this threshold is reached in ordinary
   conditions, not only extremes. (The source reads "greater than or 540 lx"; the quantity is legible
   and the value is transcribed verbatim.) This is the **same rule** as MIL-STD's 540 lx polarity
   trigger (§5.2.1.4.6) and FAA HF-STD-001B's 10 lux label rule (§5.4.1.2.3.12) at a third threshold
   — see **Polarity**, below, for the reconciliation and the stroke-width consequence.

### The one contrast requirement a ratio cannot express

**Small characters need more modulation than large ones, and the curve is steep.** Rev.4
§11.3.1.4.1-2 is the only rule in this evidence set that a contrast *ratio* cannot state:

> Small characters (10–17 minutes of arc) should have a minimum luminance modulation (M) of
> **M = 0.3 + 0.07 (20 − S)**, where **S** is the vertical size of the character set in minutes of
> arc, and luminance modulation is **M = (Lmax − Lmin)/(Lmax + Lmin)**.

Because `M = (Lmax − Lmin)/(Lmax + Lmin)` is exactly the Michelson contrast, the required ratio is
`(1 + M)/(1 − M)`:

| Character height (arcmin) | Required M | Equivalent ratio (1+M)/(1−M) |
|---|---|---|
| 10 | 1.00 | unachievable — do not set readable text this small |
| 12 | 0.86 | ≈13.3:1 |
| 14 | 0.72 | ≈6.1:1 |
| 16 | 0.58 | ≈3.8:1 |
| 17 | 0.51 | ≈3.1:1 |
| ≥20 | n/a — the ratio rules govern | — |

**This is the arithmetic form of Ch 1's rule, and it says something Ch 1 alone does not: size and
contrast are not independent knobs.** The formula **diverges at 10 arcmin** — M reaches 1.00, which
no real display can produce — so a character at the 10-arcmin legibility floor is not merely hard to
read, it is *unachievable* at any contrast. Shrinking type raises the contrast it needs, sharply:
17 arcmin needs ≈3.1:1, 14 arcmin ≈6.1:1, 12 arcmin ≈13.3:1. **The practical consequence is that at
readable sizes the screen ratio binds and the modulation rule only bites below about 14 arcmin.** At
16 arcmin the modulation requirement (≈3.8:1) sits *below* Rev.4's own **6:1** screen figure and
below the **4.5:1** WCAG text floor, so a designer who satisfies 6:1 at 16 arcmin has already
satisfied modulation; the requirement binds only in the 12–14 arcmin band, which is precisely where
Ch 1 warns text is under the preferred reading size. **Do not "fix" small text with more contrast —
make it bigger.** Note the limit on this whole family, stated by Rev.4 itself: *"Unusually large or
small characters may lead to erroneous estimates of legibility"* (§1.3.8-8).

### The implementable form

**The standards' ratio is measured luminance:** `CR = Lmax / Lmin` (NUREG-0700 Rev.1 §1.5.1-2;
MIL-STD-1472G §3.3.6, §3.3.20), where CR is one greater than the luminance contrast
`C = (Lmax − Lmin) / Lmin`; FAA-HF-STD-010A §3 defines it as "the ratio of one luminance to a lesser
one", i.e. always ≥1. **WCAG's ratio is computed from sRGB**, which is what makes it implementable
without a photometer. *Gap in this evidence set:* the mined WCAG extraction records thresholds but
**does not reproduce WCAG's relative-luminance formula** — take that from the WCAG specification
itself. Do **not** compute `Lmax/Lmin` on raw sRGB triples; sRGB values are gamma-encoded, not
luminances. The standards use sRGB for the same reason: the FAA palette is published as default
**sRGB** values (§5.13.1), the 24-colour Derefeldt & Swartling table as sRGB triples (Table C.1-I),
the colour-deficiency procedure draws each **sRGB value** on the CIE 1976 UCS diagram (Appendix A.2),
and calibration uses the display's **sRGB-preset state** (Appendix B.4).

**Rule:** 4.5:1 is the unconditional floor for all text (WCAG 2.2 §1.4.3); 3:1 covers large text and
every non-text boundary — focus rings, control borders, icon strokes, chart series edges, which is the
WCAG 2.2 §1.4.11 criterion teams forget; and **where you know the display and the room, use Rev.4's
6:1 floor and 10:1 target instead**, because Rev.4 and MIL-STD agree and both are stricter. Tooling:
`axe`, Lighthouse, `pa11y`, or `@axe-core/cli` in CI plus a contrast calculator in review. All
implement the WCAG sRGB ratio and so verify 1.4.3 / 1.4.6 / 1.4.11 against a *computed* ratio — which,
per the point above, is an **upper bound** on the real on-screen contrast rather than a measurement
of it.

---

## Absolute luminance, cd/m², and display-versus-environment

NASA HIDH §10.3.2.2.2 states the priority: *"The ability of a display to generate large contrasts is
one of the most significant contributors to display quality, and in many respects is more significant
than the peak luminance of the display."* The visual system adapts to average luminance and responds
to changes from the adapted level.

| Quantity | Value | Source |
|---|---|---|
| Brighter of characters or background | **≥35 cd/m²** | MIL-STD-1472G §5.2.1.3.5 |
| Higher-luminance of character or background | **≥10 ft-L (35 cd/m²)**; preferred **23–47 ft-L (80–160 cd/m²)** | NUREG-0700 Rev.1 §1.5.1-7 |
| Higher-luminance of character or background (current revision) | minimum **35 cd/m² (10 ft-L)**, **preferably a minimum of 100 cd/m² (29 ft-L)**; preferred range **80–160 cd/m² (23–47 ft-L)** | NUREG-0700 Rev.4 §11.3.1.4.3-1 |
| Typical maximum (2007): monitors / LCD TV / notebooks | **250–500** / **400–600** / **150–400 cd/m²** | NASA HIDH §10.3.2.2.1.1 |
| Minimum peak white / black level (brightness at max) | **≥200 cd/m²** / **≤2 cd/m²** | FAA-HF-STD-010A §5.16; FAA HF-STD-001B §5.3.1.9.7 |
| Luminance adjustability range | **not less than 50:1** | MIL-STD-1472G §5.2.1.3.1 |
| Dark-adapted colour coding floor / legend dimming floor | **>10 cd/m²** / **~0.1 cd/m²** | MIL-STD-1472G §5.2.2.3.2.k; NASA HIDH §8.7.10 |
| Extreme dark-adaptation floor | **0.000035 cd/m²** and **0.00035 cd/m²** | MIL-STD-1472G §5.5.3.1.6.d |
| Uniformity: centre-to-edge / VDU / panel-to-panel | **≤1.5:1 (LMax:LMin)** / **≤50 %** of centre / **≤1:7** | FAA HF-STD-001B §5.3.1.5.2; NUREG-0700 Rev.1 §1.5.1-8; MIL-STD-1472G §5.2.3.16.5 |
| Non-uniformity at eye position / at ±60° off-axis | **<41 %** / **change ratio ≤0.41** | FAA-HF-STD-010A §5.16 |
| Off-axis contrast change at ±30° | **≤20 %** | FAA HF-STD-001B §5.3.1.5.3 |
| Luminance variation **within** a character | **≤1.5:1** | FAA HF-STD-001B §5.6.2.5.6.11 |
| Display-to-environment luminance mismatch | **≤3:1** | FAA-HF-STD-010A §4.11 |
| Surround luminance, negative / positive polarity | **<10 ×** / **<3 ×** display luminance | FHWA-HRT-16-060 Guideline 53 |
| Surfaces adjacent to the screen | **10 %–100 %** of screen background luminance | MIL-STD-1472G §5.2.1.3.14 |
| Ratio between any two light sources in the field of view | **≤5:1** | MIL-STD-1472G §5.5.3.3.1.b |
| Light source brighter than the display | **none** (except emergency indicators) | FAA HF-STD-001B §5.3.1.5.12; MIL-STD-1472G §5.2.1.3.15 |
| Max-to-min luminance ratio on any surface | **≤10:1** | FAA HF-STD-001B §5.11.4.6.2; MIL-STD-1472G §5.2.1.3.8 |
| Ambient contribution to screen brightness by reflection | **≤25 %** | MIL-STD-1472G §5.2.1.3.16 |

Even *inside a single glyph*, peak luminance should not vary more than 1.5:1 — sub-pixel
antialiasing, gradient text fills, and text masks over photographs all violate its intent. The
±30°/±60° rows are why a wide or curved layout must treat its edges as a lower-contrast region.

**MIL-STD Table XXIII gives luminance by condition of use**, the more useful form (all cd/m²;
MIL-STD-1472G §5.5.3.1.1.c):

| Condition | Luminance | Adjustment |
|---|---|---|
| Indicator reading, dark adaptation necessary | 0.07 – 0.35 | continuous throughout range |
| Indicator reading, dark adaptation desirable | 0.07 – 3.5 | continuous throughout range |
| Chart reading, dark adaptation necessary | 0.35 – 3.5 | continuous throughout range |
| Indicator reading, dark adaptation not necessary | 3.5 – 70 | fixed or continuous |
| Panel monitoring, dark adaptation not necessary | 35 – 70 | fixed or continuous |
| Chart reading, dark adaptation not necessary | 17 – 70 | fixed or continuous |
| Bright flashes / restricted daylight | 35 – 70 | fixed |

**Read the table's shape.** The dark-adapted row is **0.07–0.35 cd/m²**; the daylight row is
**35–70 cd/m²** — a two-order-of-magnitude spread for the same interface. That is why
MIL-STD §5.2.1.3.1 requires a **50:1** range and §5.1.2.1.6 requires continuous adjustment or **≥30
increments** from full bright to full off.

**Three consequences you own in code** (you cannot set cd/m² from JavaScript): (1) **do not ignore
black level** — a display whose black sits far above 2 cd/m² lifts every dark surface and destroys the
ratio you computed; (2) **do not assume peak white is 200 cd/m²** — NASA HIDH §10.3.2.2.2.6 gives the
arithmetic: white 100, black 10, plus **10 cd/m²** of ambient veiling luminance →
`(100+10)/(10+10) = 5.5`, so a dark-room ratio of 10:1 becomes 5.5:1 in a lit office; (3) **prefer
contrast to brightness** when a trade-off appears (NASA HIDH §10.3.2.2.2).

**Display versus environment.** FAA-HF-STD-010A §4.11 supplies the worked example: assuming **88 %**
reflectance for office paper, **38 lux** of ambient produces roughly `38 × 0.88 / π = 10.6 cd/m²` from
white paper, so a 3:1 limit implies a peak white of **no more than 32 cd/m²**. Rationale: *"The
operator will light-adapt to whichever is greater, which can make the others hard to see. In extreme
cases, the operator may see disturbing afterimages."* **The polarity asymmetry is the actionable
part: a light-background UI tolerates only 3× the display luminance in its surroundings; a
dark-background UI tolerates 10×.** A bright theme in a bright room is therefore roughly three times
more sensitive to ambient light — the mechanism behind "dark themes look better in context", as a
numeric argument rather than a taste argument. Do not average the two limit families: FAA's 3:1 and
FHWA's 3×/10× have the same shape but are referenced differently — FAA against *the most luminous
object in the operator's immediate work environment*, FHWA against the *surrounding luminance*.

**Limitation to flag.** Every figure above except the two hardware floors (peak white ≥200 cd/m²,
black ≤2 cd/m², FAA-HF-STD-010A §5.16) is about **emissive hardware**, and none of it is enforceable
or measurable from application code. It is procurement specification language, not a runtime check.

**One numeric conflict the revisions introduce, reported rather than smoothed.** Rev.1 set the
luminance floor at **≥35 cd/m²** and the preferred range at **80–160 cd/m²** (§1.5.1-7). Rev.4 keeps
both but inserts a **second, higher floor** — *"preferably a minimum of 100 cd/m² (29 ft-L)"*
(§11.3.1.4.3-1). So the current revision effectively carries **35 cd/m² as the hard minimum and
100 cd/m² as the preferred minimum**, with the 80–160 cd/m² band retained as the preferred *range*.
Those are three nested bands from one source, and the 80 vs 100 cd/m² pair is the one to watch: a
display sitting at 85 cd/m² satisfies Rev.1's preferred range and Rev.4's hard floor, but misses
Rev.4's preferred minimum. **Design to 100 cd/m² if you can choose the hardware**, because it is the
only figure that satisfies every band in both revisions.

---

## Polarity — dark-on-light versus light-on-dark

| Rule | Statement | Source |
|---|---|---|
| Screen default | text **should** be black on white or light background | FAA HF-STD-001B §5.6.2.5.1.11 |
| Tie-break | if stroke width, modulation, and luminance are approximately equal, **use positive polarity** | FAA HF-STD-001B §5.3.2.1.6 |
| Rationale for the tie-break | *"Reflections are less visible on a bright background than on a dark background."* | FAA HF-STD-001B §5.3.2.1.6 (Discussion) |
| Labels under ambient light | when ambient will be **above 10 lux**, dark on light **shall** be used | FAA HF-STD-001B §5.4.1.2.3.12; MIL-STD-1472G §5.4.6.1 |
| Strong ambient | when ambient is **540 lux or greater**, dark on light **shall** be used rather than light on dark | MIL-STD-1472G §5.2.1.4.6 |
| Legibility | black on white is easier to read than white on black; **black on yellow or white is most effective** | NASA HIDH §10.11.5.1 |
| Dark adaptation | when dark adaptation is required, markings **should** be **white on a dark background** | FAA HF-STD-001B §5.4.1.2.3.14; MIL-STD-1472G §5.4.6.2 |
| Extensive light-on-dark viewing | images **should** be **amber or green** rather than white | FAA HF-STD-001B §5.6.6.2.2.11 |
| VDU | **either polarity is acceptable** if resolution/modulation/luminance/contrast requirements are met; **high ambient → dark on light preferred** | NUREG-0700 Rev.1 §1.5.1-2 |
| VDU (current revision) | **either polarity is acceptable**, **except** when ambient near the screen is **greater than 540 lx (50.2 fc)**, where **dark characters on a light background should be used** | NUREG-0700 Rev.4 §11.3.1.4.1-2 |

### A genuine conflict between two FAA documents

**FAA HF-STD-001B §5.6.2.5.1.11** says text *should* be black on a light background.
**FAA-HF-STD-010A §5.4** says the ATC display background **shall be either black or gray** — black
below **200 lux**, gray at **200 lux or more**. They do not contradict once the domain is restored:

- **FAA-HF-STD-010A is a colour-coding standard** for displays carrying many saturated foreground
  colours over map and weather imagery, where a white background would destroy the palette's contrast
  and saturation. An achromatic **grey of intermediate luminance** is the only surface leaving all
  coded colours readable, and the source says so — *"Gray backgrounds having a luminance that is
  intermediate to those of foreground colors yield better foreground-color recognition than black or
  white backgrounds."*
- **FAA HF-STD-001B is a general display standard for text and labels**, where there is no colour
  coding to preserve and dark-on-light maximises legibility and hides reflections.

**Resolution rule:** if the screen carries a **colour-coded palette that must stay recognisable**, use
achromatic grey (or black in low ambient) and negative polarity. If it carries **mostly text and
labels**, use positive polarity. Decide by what the screen *contains*, never by which source is newer.

**And the stroke-width finding, which corrects a common rule of thumb.**

| Condition | Stroke width as fraction of height | Source |
|---|---|---|
| Black on white/light background | **0.1667 to 0.1429** (≈1/6 to 1/7) | MIL-STD-1472G §5.4.6.3.7.a |
| White on dark background, dark adaptation required | **0.1429 to 0.125** (≈1/7 to 1/8) | MIL-STD-1472G §5.4.6.3.7.b |
| Normal illumination labels | **1/6 to 1/7** of height | FAA HF-STD-001B §5.4.1.2.3.2 |
| Dim illumination labels (white on dark) | **1/7 to 1/8** of height | FAA HF-STD-001B §5.4.1.2.3.3 |
| Screen characters | **1/12 to 1/6**, *"with wider strokes preferred for positive polarity displays"* | FAA HF-STD-001B §5.3.1.7.6 |
| Transilluminated characters | **0.1** of height | MIL-STD-1472G §5.4.6.3.7.c |

**Both sources agree, and they contradict the widely repeated claim that light-on-dark needs
*thicker* strokes.** MIL-STD writes stroke/height, where 1/7 (0.1429) is *thinner* than 1/6 (0.1667)
— so its dark-adaptation range **0.1429–0.125 is thinner**, not thicker, than its normal range
0.1667–0.1429, and FAA says the same in the same direction. For **white-on-dark under dark
adaptation** both prescribe a **thinner** stroke (≈1/7–1/8 vs ≈1/6–1/7): a bright stimulus on a dark
field spreads (irradiation), so a thinner stroke already subtends a thicker apparent line. For
**positive polarity**, FAA HF-STD-001B §5.3.1.7.6 separately says *"wider strokes [are] preferred for
positive polarity displays"* — the **opposite** direction, by a different mechanism. The correct
statement is therefore **not** "light-on-dark needs thicker strokes" but: **positive polarity
tolerates and prefers thicker strokes; negative polarity under dark adaptation requires thinner
ones.** Flag this as a place where a naive summary reverses the source. See
`CROSS-SOURCE-REGISTER.md` §8 for FAA HF-STD-001B's own internal inconsistency (1/12–1/6 vs 10–12.5 %).

---

## Colour coding — the count depends on the question

| Source | Limit stated |
|---|---|
| FAA HF-STD-001B §5.6.6.2.7.3 | max **4** colours per alphanumeric screen; **7** across a related screen set |
| FAA HF-STD-001B §5.6.6.2.7.5 | no more than **6** if users must recall meanings or search rapidly by colour |
| FAA HF-STD-001B §5.2.3.5.5.1 | if colour-coding is used, **shall not exceed 9** |
| MIL-STD-1472G §5.2.2.3.2.f | no more than **7** for categorically different information |
| MIL-STD-1472G §5.4.6.6 | number of different colours **shall not exceed 9** (labels) |
| MIL-STD-1472G §5.2.2.3.2.h | up to **30** where colour only groups and carries no meaning |
| NASA HIDH §5.4.10.7 | colour search degrades **above 9**; **11** basic colour terms more reliable |
| NASA HIDH §10.9.2.5.1 / §10.11.5.5 | no more than **9** including white and black in a coding system; labels limited to **9** |
| NUREG-0700 Rev.1 §1.3.8-9 | **≥40 ΔE** between coded colours → about **7 to 10 simultaneous colours** |
| **NUREG-0700 Rev.4 §1.3.8-1** | **"the number of colors should be limited to six"** |
| NUREG-0700 Rev.4 §1.3.8-7 | **≥40 ΔE (CIE L\*u\*v\*)** between coded colours → **at least 7–10 simultaneous colours** |
| FAA-HF-STD-010A §5.9 | maximum coding set **24** colours |
| FAA-HF-STD-010A §5.9 (Discussion) | other standards set **5 to 8**; Halsey & Chapanis (1954) **11 to 15**; Bishop & Crook (1961) **30**; Hanes & Rhoades (1959) one practised subject learned **50** |
| FAA-HF-STD-010A §5.9 (Discussion) | **11 focal colour names**: red, pink, orange, yellow, brown, green, blue, purple, black, white, gray |
| FHWA-HRT-16-060 Guideline 60 | no more than **7** colours per display |

### Why they differ — the register's decision table, restated

The **widest apparent disagreement in the evidence set**, and a real **domain disagreement**
(`CROSS-SOURCE-REGISTER.md` §2). The limits answer two questions. **"How many colours can a user name,
remember, and act on with no legend?"** clusters at **4–9**; FAA's 4-per-screen is most conservative
because ATC operators must identify colour under time pressure with no reference. **"How many can a
user discriminate side by side on this display?"** gives FAA-HF-STD-010A's **24** — a measured
*discrimination* limit (Derefeldt & Swartling 1995; 6 of 7 colour-normal participants named the same
24 colours reliably with no training), not a memory limit. Nobody remembers what 24 colours mean. The
source's caveats: the 35-colour test set *"included three grays but not white or black"*, so the 24
limit *"may be a bit conservative"*; and *"it is best to use the fewest number possible."* The
**11-focal-names** figure is a *naming* result with cross-cultural support (FAA-HF-STD-010A §5.9
Discussion, from Berlin & Kay 1969 and successors; NASA HIDH §5.4.10.7 lists the same 11), not a
licence to use 11 colours — ANSI/HFES-200 (2008) and ISO 9241-303 (2011) *recommend* them as
vocabulary, and that sits inside the 4–9 memory budget, not above it.

| If colour is used to… | Then limit to | Because |
|---|---|---|
| convey meaning the user must recall without a key | **4–7** | naming/memory ceiling |
| distinguish adjacent categories with a legend present | **≤9** | rapid-search degradation |
| be merely discriminable (e.g. chart series with a legend) | **≤24**, but verify ΔE | discrimination ceiling |
| group elements with no meaning attached | up to **30** | no decoding required |

(CROSS-SOURCE-REGISTER.md §2; MIL-STD-1472G §5.2.2.3.2.f, .h; FAA-HF-STD-010A §5.9)

### The one requirement that never bends

Every source states it; none compromises. **Colour must never be the only channel.**

| Source | Requirement |
|---|---|
| WCAG 2.2 §1.4.1 (A) | colour must not be the **only** visual means of conveying information, indicating an action, prompting a response, or distinguishing a visual element |
| FAA HF-STD-001B §5.6.6.2.1.5 | colour-coding **should be redundant** to some other means of coding |
| FAA-HF-STD-010A §4.2 | colour **shall not** be the sole means of coding critical information; use at least one dimension independent of colour vision: **size, shape, pattern, text content, position, or temporal modulation** |
| MIL-STD-1472G §5.2.2.3.2.l | if the population includes colour-blind users, colour-coding **shall not be the only means**; also §5.1.3.1.14 (touch targets) and §5.2.2.3.2.m (the *induced* case — protective eyewear, visors, filters in the optical path) |
| NUREG-0700 Rev.1 §1.3.8-11 | colour coding should be redundant with another feature; information should survive a **monochromatic display or hardcopy printout**, or colour-vision impairment |
| NASA HIDH §10.6.19 | colour-coding should not be the only means of conveying information |

**FAA-HF-STD-010A §4.2.2 adds a trap:** **brightness shall not be used as the redundant dimension**
for a chromatic code, because *"protans may not recognize brightness differences that are apparent to
others."* Use shape, pattern, position, or text — do not "add a second shade of the same colour and
call it redundancy."

### Other colour-coding rules worth carrying

| Rule | Statement | Source |
|---|---|---|
| One colour, one meaning | each colour represents only one category of displayed data | MIL-STD-1472G §5.2.2.3.2.d; FAA HF-STD-001B §5.6.6.2.4.1; NUREG-0700 Rev.1 §1.3.8-8; NASA HIDH §10.9.2.5.1 |
| Consistent | within a screen, an application, and related applications; meanings *"shall be fixed and not change over time"* | FAA HF-STD-001B §5.6.6.2.1.3; MIL-STD-1472G §5.2.2.3.2.c; FAA-HF-STD-010A §4.4 |
| Not decoration | *"Color differences shall not be introduced solely for aesthetic, stylistic, or decorative purposes"* | FAA-HF-STD-010A §4.3; FAA HF-STD-001B §5.6.6.1.4 |
| Add colour last | *"Color should only be added after the effectiveness of a screen has been maximized in an achromatic format"* — the cheapest discipline rule in the set | FAA HF-STD-001B §5.6.6.2.1.8 |
| Not a legend substitute | where a key exists it must include the actual colours and be visible without scrolling or expanding | FAA HF-STD-001B §5.6.6.2.1.11, §5.6.6.2.8.2–.3 |
| Not on small areas | users **shall not** have to discriminate among colours in small areas; small areas **shall** be coded achromatically. Discrimination degrades below about **1 degree** of visual angle, worst for blues/cyans/purples (small-field tritanopia) | FAA HF-STD-001B §5.6.6.2.1.9–.10; FAA-HF-STD-010A §4.7 |
| Not in the periphery | reserve colour for the **direct line of sight**; use white for peripheral signals; in the periphery prefer **blue, yellow, black, or white** over **red and green**. Macular pigment occupies the central **5 to 10 degrees** | FAA HF-STD-001B §5.6.6.2.3.1–.2; FAA-HF-STD-010A §4.8 |
| Warm for action, cool for status | longer wavelengths (red, orange) for action/response; shorter (blue, green) for infrequently used and background status | FAA HF-STD-001B §5.6.6.2.2.6, §5.6.6.2.4.4; MIL-STD-1472G §5.2.2.3.2.j(1)–(2) |
| Encode status in a chip, not the text | **a box or other shape adjacent to the text shall change colour, instead of the text itself** — one line of implementation that satisfies WCAG §1.4.1 free | FAA HF-STD-001B §5.6.6.2.10.1 |
| NASA's first-casualty rule | *"the color green should not be used if the color scheme uses more than six colors, and red and green should not be used within the same complement"* | NASA HIDH §10.11.5.5 |

**The ATC severity ladder, directly transposable** (FAA-HF-STD-010A §5.2; cf. FAA HF-STD-001B
§5.6.6.2.4.3 and §5.4.2.2.1.27):

| Colour | Meaning |
|---|---|
| **Flashing red** | **only** unacknowledged alarm, emergency requiring immediate action |
| **Red** | acknowledged alarm, emergency requiring immediate action |
| **Orange / amber** | alert, unusual condition requiring immediate attention but not immediate action |
| **Yellow** | caution, unusual condition requiring neither immediate attention nor immediate action |
| **Green** | OK to proceed / normal / satisfactory / within tolerance |
| **White** | alternative functions or system conditions with no operability or safety implications |
| **Blue** | **only** advisory or informational items |
| **Gray** | items the operator can ignore — unmonitored, unmanaged, inactive, out of service, or taken offline intentionally |

The *flashing → solid on acknowledgement* transition is the whole alarm model. See
`CROSS-SOURCE-REGISTER.md` §3 for the flash-rate conflict this creates on a public interface (WCAG
caps flashing at 3 per second; the older standards recommend 3–5 Hz for a screened operator population).

### The FAA standard palette — hex values ready to paste

FAA-HF-STD-010A Table 5.13.1-I publishes default **sRGB** values shown to be *"discriminable,
recognizable, conspicuous... and legible for observers having normal and deficient color vision, given
that redundant coding is used"*, tested at **40 lux** ambient:

| Colour | Hex | %Y | | Colour | Hex | %Y |
|---|---|---|---|---|---|---|
| White | `FFFFFF` | 100 | | Green | `23E162` | 55 |
| Gray | `B3B3B3` | 45 | | Yellow | `DFF334` | 80 |
| Pink | `F684D8` | 41 | | Magenta | `D822FF` | 23 |
| Blue | `5E8DF6` | 28 | | Aqua | `07CDED` | 50 |
| Orange | `FE930D` | 42 | | Brown | `C5955B` | 34 |
| Red | `FF1320` | 21.8 | | | | |

(FAA-HF-STD-010A Table 5.13.1-I, p. 37; the table also publishes u′, v′, and sR/sG/sB.)

**Caveats carried by the source:** specified for ambient **≤40 lux**; above **200 lux** it *"may be
used but is not mandatory"*, and grey and black must be exchanged to provide the grey background
required by §5.4.2, with luminances adjusted to hold ratios ≥3:1 (§5.13.3). Colours may be added
**only if** they code non-critical information *and* are experimentally shown not to be confused with
any standard palette colour in use (§5.14). If you adopt this palette, adopt it whole.

---

## Colour difference metrics — ΔE

Five ΔE numbers appear, and they are **not** competing thresholds. Each measures a different pair of
things.

| Metric | Threshold | Measures | Source |
|---|---|---|---|
| ΔE\*uv-sc (CIELUV, **size-corrected**) | **≥28** | smallest difference between any two **search targets** in a coded set | FAA-HF-STD-010A §5.7 |
| ΔE\*ab (CIELAB) | **≥9.9** | **spatially adjacent** colours that must be discriminable | FAA-HF-STD-010A §5.8 |
| ΔE (CIE L\*u\*v\*) | **≥40** | colours in a coded set; yields **7–10 simultaneous colours** | NUREG-0700 Rev.1 §1.3.8-9 |
| ΔE (CIE L\*u\*v\*) | **≥20** | colours within a set | MIL-STD-1472G §5.2.2.3.2.o |
| ΔE (CIE Yu′v′) | **≥100** | **foreground against its background** | MIL-STD-1472G §5.2.2.3.2.n; FAA HF-STD-001B §5.6.6.2.6.3 |
| ΔE Yu′v′ | **>40** absolute classification; **100** relative | colour classification tasks | FAA HF-STD-001B §5.3.1.9.8 |
| CIE 1976 UCS distance | **0.00384** (rounded to 0.004) | **touching** colours; minimum discriminable by colour-normal viewers | FAA-HF-STD-010A Appendix A.2.5 |

### Reconciliation

**The 20 / 28 / 40 spread is explained by the source itself**, in the most useful paragraph of
FAA-HF-STD-010A §5.7:

> *"Typically, size correction is omitted and the criterion is 20. ... Other standards that prescribe a
> criterion equal to 40 instead are based on Carter and Carter (1981), which omitted size correction
> and involved much smaller stimuli than Carter (1989)."*

So **20** (MIL-STD, uncorrected), **28** (size-corrected, for small search targets), and **40**
(uncorrected but from much smaller stimuli) are three points on one continuum, differing by whether a
size correction was applied and how large the measured stimuli were. **100** is a different quantity —
figure-versus-background, not colour-versus-colour. The size correction is what makes 28 usable:

```
ΔE*uv-sc = ( (KL*·ΔL*)² + (Ku*·Δu*)² + (Kv*·Δv*)² )^0.5     (FAA-HF-STD-010A Eqn. 1, CIELUV)
```

with coefficients depending on the visual angle **A in arcmin**; for **A ≥ 60 arcmin, KL\* = Ku\* =
Kv\* = 1** (Appendix A.1, Eqns. 3–7). Reference white for D65 is **u′n = 0.1978, v′n = 0.4683**.

**Practical takeaway: if your colour chips subtend 60 arcmin or more — which a normal legend swatch,
status dot, or chart series marker does at desktop viewing distance — the size correction is the
identity and the criterion is the plain ΔE figure.** You do not need the correction for ordinary UI
work; you do need it for sub-degree markers, which is exactly where colour also fails for a second
reason (small-field tritanopia below ~1°, §4.7).

**When to compute ΔE at all:** almost never by hand — you are choosing from an existing palette or a
design system's ramps, not authoring a code set against a photometer. Compute it when you author a
**categorical palette** that must survive a legend, a colour-blind user, and a busy background; the
28 / 40 criterion is the only way to know whether two of ten series colours are the same colour to a
deuteranope. Then do what the source requires instead of trusting the arithmetic: *"Color sets that
yield ΔE\*uv-sc < 28 for one or more color pairs should be tested using participants who are
representative of the intended user population"* (§5.7) — the number is a screening threshold, not a
proof. The **graphical method** is the cheap specified alternative: draw a line for each sRGB value on
the CIE 1976 UCS diagram using the confusion-line copunctal points — **protans u′ 0.6579, v′ 0.5013;
deutans −36.0000, 6.0000; tritans 0.2573, 0** (Appendix A.2, Table A.2.4-II) — and adjust values to
increase the distances among lines; the sRGB primaries are published as u′/v′ pairs for this purpose
(**red 0.45/0.52, green 0.13/0.56, blue 0.18/0.16**, Table A.2.3-I). Free tools: Coblis,
`daltonlens`, Chromium DevTools' "Emulate vision deficiencies" tab.

**One hard prohibition, not a threshold:** colours with a CIE 1976 **v′ chromaticity coordinate less
than 0.2 shall not be used** for text, symbols, or icons on black backgrounds (FAA-HF-STD-010A §5.10,
attributed to ANSI/HFES-100 2007 and ISO 9241-303 2011) — `rgb(0,0,n)`-family blue *"often appear[s]
blurry"* on dark backgrounds. FAA HF-STD-001B §5.6.6.2.2.14 and NUREG-0700 Rev.1 §1.3.8-6 give the
simpler form: **pure blue shall not be used on a dark background for text, thin lines, or
high-resolution information.**

---

## Colour vision deficiency

**Incidence, so the requirement has a number behind it.** NASA HIDH §5.4.10.6: total incidence in men
**may be as high as 8%**, deuteranomaly most common at about **4.6%**, the other L and M cone cases
about **1% each**; in females **less than 0.5%**; S-cone defects much rarer at around **0.002%**.
FAA-HF-STD-010A §4.2 gives the **medically cleared** FAA figure: roughly **0.6%** of the FAA population
as of 2006. NUREG-0700 **Rev.4** §1.1-27 gives a third figure — **approximately 10 percent of
color-blind individuals** — and draws a design rule from it: *"designers should avoid displays
requiring red-green or blue-yellow comparisons."*

**Reconcile the 10% / 8% / 0.6% spread by population, not by source authority.** Rev.4's 10% is the
**general-population** rate for colour-vision deficiency across all classes; NASA's 8% is the
**male** rate specifically (which is why it is described as "in men"); FAA's 0.6% is the rate among
**medically screened and cleared** air traffic controllers. The gap between 8% and 0.6% is the gap
between a screened and an unscreened population, and it is the whole argument for treating a
public-facing interface differently from an operator console. Rev.4's rule is therefore the one to
carry into general software: **avoid red-green and blue-yellow comparisons outright**, rather than
relying on screening. Note that Rev.4's phrasing names **blue-yellow** as well as red-green — the
tritan axis — whereas most other sources here discuss only red-green; this is a stricter and broader
prohibition than MIL-STD's.

| Rule | Statement | Source |
|---|---|---|
| **CVD incidence (current revision)** | to accommodate **approximately 10 percent of color-blind individuals**, designers should **avoid displays requiring red-green or blue-yellow comparisons** | NUREG-0700 Rev.4 §1.1-27, restated §1.3.8-1 |
| Colour never alone | colour-coding **shall not** be the only means when the population includes colour-blind users | MIL-STD-1472G §5.2.2.3.2.l; FAA-HF-STD-010A §4.2 |
| Distinguishable by both | colours **shall** be distinguishable by both colour-normal and colour-deficient persons | FAA HF-STD-001B §5.2.3.5.5.2; MIL-STD-1472G §5.4.6.6 |
| Survey the population | supervisors/managers need to be aware of any employees with red–green colour blindness | FHWA-HRT-16-060 Guideline 60 |
| Protanopes — forbidden wavelengths | **wavelengths above 650 nm shall not be used**; dominant wavelengths **above 650 nm should be avoided**, because protanopes are markedly less sensitive there | MIL-STD-1472G §5.2.2.3.2.l; FAA HF-STD-001B §5.6.6.2.2.16; NUREG-0700 Rev.1 §1.3.8-15 |
| Deuteranopes — specified red/green | Red **0.6078, 0.3441, 31.05**; Green **0.2564, 0.4372, 39.56**; Yellow **0.4209, 0.5040, 111.4**; Blue **0.1566, 0.0808, 13.33** (CIE x, y, Y) | MIL-STD-1472G §5.2.2.3.2.l |
| Red + green | wherever possible red and green **should not** be used in combination (red on a **green background** especially avoided); not within the same complement on labels | NUREG-0700 Rev.1 §1.3.8-13; NASA HIDH §10.11.5.5 |
| Green at high colour counts | green **should not be used if the scheme uses more than six colours** | NASA HIDH §10.11.5.5 |
| Induced deficiency | colour-coding **shall not** be the only means where protective eyewear, visors, or filters are in the optical path | MIL-STD-1472G §5.2.2.3.2.m |
| Complete palette | a red-green-safe palette with published sRGB values exists | FAA-HF-STD-010A Table 5.13.1-I |
| Verify by test | discrimination *"should in any case be verified by testing with human subjects possessing colour vision capabilities representative of the intended user population"* | NASA HIDH §8.7.10.2 |

**The >650 nm prohibition is the most concrete and the most violated.** It bites hardest on
**saturated deep reds** chosen to look "alarm-like". MIL-STD's own maximum-discriminability table puts
red at **700 nm** for colour *recognition*, while the same document prohibits **>650 nm** when
protanopes are in the population (Table XIV and §5.2.2.3.2.l) — two objectives from one document,
reconciled only by the conditional. For any interface reachable by an unscreened user, treat **>650 nm
as forbidden**; if you need an alarm red, take `FF1320` from the FAA palette rather than a naive
saturated primary.

**Implementation checklist:** (1) every colour cue has a non-colour partner — status chip = colour +
icon + text; chart series = colour + distinct marker shape + direct label; form error = red border +
icon + message text; link = colour + underline. (2) Never rely on red-versus-green for a binary
distinction; prefer red/blue, or better orange/blue — yellow-vs-blue discrimination also survives
increasing retinal eccentricity better than red-vs-green (FAA-HF-STD-010A §4.8). (3) Avoid deep
saturated reds above 650 nm. (4) Never use pure blue as a text or thin-line colour on a dark
background. (5) Test with a simulator in review and with people before release. (6) Remember that 0.6%
of a *medically screened* population still failed the screen: redundancy is a requirement everywhere,
not a courtesy for the unscreened.

---

## Dimming and adjustment law

**Dimming is a perceptual problem, not a linear one, and the sources specify the law.**

| Rule | Statement | Source |
|---|---|---|
| Curve | increments in luminance **proportional to luminance** — a **logarithmic (constant-ratio)** relationship between control position and luminance | NASA HIDH §8.7.5.2 |
| Direction | rotary **clockwise**, linear **up or right** → luminance **increases** | NASA HIDH §8.7.5.2 |
| Direction, discrete positions | rotary full counter-clockwise = OFF, full clockwise = ON; horizontal slider full left = OFF; vertical slider full down = OFF | MIL-STD-1472G Table XIII |
| Continuity / granularity floor | **continuous** or a fine stepwise approximation, or **≥30 increments** from full bright to full off | NASA HIDH §8.7.5.2; MIL-STD-1472G §5.1.2.1.6 |
| Range | **not less than 50:1**; or vary luminance from **10 % of minimum ambient luminance to full luminance**; or **10 % to 100 %** | MIL-STD-1472G §5.2.1.3.1, §5.2.1.3.4; NUREG-0700 Rev.1 §1.5.1-10; FAA HF-STD-001B §5.3.1.5.5 |
| One control for everything | the luminance levels of **all** indicator types should be **proportionally adjustable by a single "brightness" control** — it keeps the three-level hierarchy from collapsing into overlap as the user dims | NASA HIDH §8.7.10.1 |
| Dimming to zero / OFF | permitted only where failure to turn an indicator on cannot lead to a critical failure | MIL-STD-1472G §5.2.3.13.14; FAA HF-STD-001B §5.4.2.2.1.14 |
| ON/OFF must stay distinguishable | displays **shall not** be dimmable beyond the point where they cannot be differentiated from OFF | FAA HF-STD-001B §5.3.1.5.7 |
| Contrast controls mandatory | a control **shall** be provided to vary the contrast between characters and the background, and it should compensate for ambient lighting | MIL-STD-1472G §5.2.1.5.2; FAA HF-STD-001B §5.3.1.5.8, §5.6.2.5.6.13 |
| Contrast choices | when colour and contrast are adjustable, a **variety of colour selections capable of producing a range of contrast levels** shall be provided | FAA HF-STD-001B §5.6.6.2.9.6 |
| Dimming must not shift hue | compute new **sRGB values through IEC 61966-2-1:1999** so chromaticity is preserved; **shall not** be done by scaling sRGB values | FAA-HF-STD-010A §5.15.5 |

**The logarithmic law, in the source's words:** *"For every equal incremental increase in the control
setting, the luminance of the source should change by a constant ratio; this results in a logarithmic
relationship between control changes and luminance changes. For example, if an increment in the
control setting doubles source luminance, a further equal increase in setting should redouble
luminance to four times the original value"* (NASA HIDH §8.7.5.2). This is Weber's Law on a control,
and it is why a **linear** HTML range input mapped straight to opacity or lightness feels wrong at
both ends. In code: store the slider position as an exponent and compute
`value = min × (max/min)^position`, so equal slider steps give equal ratios.

**The other implementable rule is hue preservation under dimming.** FAA-HF-STD-010A §5.15.5 requires
luminance changes to keep the same CIE chromaticity coordinates, and **prohibits** scaling sRGB values
— *"because that approach will alter the object's chromaticity coordinates in most cases."* So **do
not dim with `opacity`** (blending toward the background changes luminance *and* chromaticity), and
**do not dim by multiplying R, G, B** (sRGB is not linear light, so halving the triples does not halve
the luminance and it moves the hue). Instead convert to a linear-light space, scale luminance there,
and convert back — or step along a pre-computed ramp of the *same* hue, which is what §5.15.2's
"finite palette with the same luminance as the object's default color and hues similar to the default
color" amounts to. Hardware counterpart: colour tracking, i.e. the drive-level ratios established for
the white point, must hold across all intensity levels (NASA HIDH §10.3.2.5.5).

**Master brightness is the recommended control shape.** NASA HIDH §8.7.10.1 works a three-tier
example: with a backlight/legend tier at **11 cd/m²** and a caution-and-warning tier at **30.9 cd/m²**,
the source sets the intermediate (nominal) indicator level to **18.2 cd/m²**, reasoning that *"Weber's
Law implies that the perceived 'midpoint' between two stimulus levels lies at the geometric mean
(square root of the product) of the two levels."* Tolerances must be proportional to nominal and must
allow **no overlap** among the three levels. Apply that to any three-level severity ramp: the middle
level is the **geometric** mean of the extremes, not the arithmetic mean.

### What must be locked from users

| Must not be user-adjustable | Source |
|---|---|
| CIE chromaticity coordinates of colours conveying **alerts or other critical information** — and the software **shall protect those coordinates** against circumvention | FAA-HF-STD-010A §5.15.1 |
| Status colours — **assigned during installation**, no user change | FAA HF-STD-001B §5.6.6.2.9.4 |
| Coding and status colours (alarms, alerts) where a monitor is **shared** by users | FAA HF-STD-001B §5.6.6.2.9.5 |
| Colour customisation for **tactically significant** information | MIL-STD-1472G §5.2.2.3.2.e |
| Critical alarm loudness (the audio analogue of this rule) | NUREG-0700 Rev.1 §4.5.6.3-11 |

**Free-form colour adjustability is explicitly disallowed.** Where non-critical colours *may* be
adjustable, FAA-HF-STD-010A §5.15.2 requires it to work **solely** by designating an object and
selecting from a **finite palette**, where alternatives have the **same luminance** as the default and
**similar hues**, all pre-tested not to degrade performance — and states flatly: *"No other
chromaticity-change methods (e.g., sliders or color wheels) are permissible."* Users **should be
discouraged** from adjusting hue or saturation at all, because those adjustments *"may degrade the
discriminability, recognizability, and/or legibility of the colors"*; **overall brightness and
contrast remain permissible** (Appendix B.6).

**Default-state discipline** (FAA-HF-STD-010A §5.15.7–5.15.11, §5.16): operators may **save** colour
sets as presets and restore them on any display; a function must **reset all colours to their default
sRGB values quickly and easily**; colours must **reset to defaults on every software restart**, with a
command selecting the display's **sRGB-preset state**; the display **should default to its sRGB-preset
state when turned on**; and FAA HF-STD-001B §5.6.6.2.9.2 requires an **easy way to restore the default
colour scheme** wherever colour settings are user-changeable. **Web translations:** put the palette in
design tokens; forbid per-user hue editing of semantic tokens (`--color-danger`, `--color-success`)
while allowing theme-level choices; honour `prefers-color-scheme` for light/dark and
`prefers-contrast` for a higher-contrast variant; provide a one-action "reset to default theme".

---

## Anti-patterns

- **Shipping 4.5:1 as the goal rather than the floor.** WCAG's AA minimum is below every ergonomics
  source's *preferred* value. Use 4.5:1 as a floor for body text and 7:1 as the target.
- **Chasing maximum contrast.** Above roughly **15:1** the source expects visual discomfort, and
  MIL-STD's preferred band is **6:1–10:1** for characters. Pure black on pure white is not better.
- **`#0000FF`-family blue text or thin blue lines on a dark background.** Prohibited by
  FAA-HF-STD-010A §5.10 (v′ ≥ 0.2) and stated as a rule by FAA HF-STD-001B §5.6.6.2.2.14 and
  NUREG-0700 Rev.1 §1.3.8-6. It renders blurry, and it is the one colour rule stated without
  qualification.
- **Saturated red next to saturated blue on a dark background.** Creates chromostereopsis — a false
  depth effect whose *"perceived magnitude varies widely among viewers"* (FAA-HF-STD-010A §4.6; FAA
  HF-STD-001B §5.6.6.2.2.15; NUREG-0700 Rev.1 §1.3.8-14). Mitigate with a medium grey background.
- **Status by colour alone.** Violates WCAG §1.4.1, FAA-HF-STD-010A §4.2, MIL-STD-1472G §5.2.2.3.2.l,
  NUREG-0700 Rev.1 §1.3.8-11, and NASA HIDH §10.6.19 simultaneously — the most consequential colour
  defect and the cheapest to fix.
- **Using brightness as the redundant channel for a chromatic code.** Protans may not see the
  brightness difference (FAA-HF-STD-010A §4.2.2). Use shape, pattern, position, or text.
- **Decorative colour, or adding colour before the layout works.** *"Color differences shall not be
  introduced solely for aesthetic, stylistic, or decorative purposes"* (FAA-HF-STD-010A §4.3; failure
  modes named: increased search time, degraded legibility, inferred unintended groupings, clutter), and
  *"Color should only be added after the effectiveness of a screen has been maximized in an achromatic
  format"* (FAA HF-STD-001B §5.6.6.2.1.8).
- **A free-form colour picker for semantically loaded colours.** No sliders, no colour wheels (FAA
  HF-STD-010A §5.15.2). Provide a curated, luminance-locked swatch set, or nothing.
- **Dimming with `opacity`, multiplying RGB, or a linear brightness slider.** The first two alter
  chromaticity, which the standard prohibits (§5.15.5); the third violates Weber's Law (NASA HIDH
  §8.7.5.2). Related: **separate brightness controls per indicator family**, when the source requires
  one proportional master control so the luminance hierarchy cannot collapse into overlap (§8.7.10.1).
- **Making a display dimmable to the point where ON and OFF look the same.** Explicitly prohibited
  (FAA HF-STD-001B §5.3.1.5.7); the stated consequence is failure to detect or perform a critical step.
- **Colour-coding small chips, peripheral items, or colours differing only in lightness.** Users
  *"shall not have to discriminate among colors in small areas"* (§5.6.6.2.1.9); red/green are
  unreliable outside the central **5–10 degrees** (FAA-HF-STD-010A §4.8); and *"Color combinations that
  are similar in lightness shall be avoided"* (§5.6.6.2.5.9), with no more than two luminance levels
  used for coding on colour displays (§5.6.6.2.5.10).
- **Trusting a colour-blindness simulator, or the 24-colour discrimination limit, as sufficient.** The
  source requires representative human observers against **all** anticipated colour combinations and
  backgrounds on the fielded display model (Appendix C.1), and says of 24 colours that *"it is best to
  use the fewest number possible"* (§5.9).

---

## Connects to

- **Ch 1 (Text size and legibility)**: stroke width and contrast are coupled — WCAG's definition of
  large-scale text notes that thin strokes hurt most **at lower contrast**, and the polarity-dependent
  stroke-width rules in MIL-STD-1472G §5.4.6.3.7 only make sense once the polarity decision above is
  made. More sharply: **Rev.4's small-character modulation formula is the arithmetic proof that size
  and contrast are not independent knobs** — the required contrast diverges as character height falls
  toward the 10-arcmin floor (see "The one contrast requirement a ratio cannot express"). Ch 1's size
  rules and this chapter's contrast rules must therefore be applied **together**, and the cheap fix
  for a failing contrast check on small text is to increase the size, not the contrast.
- **Ch 4 (Alerts, warnings, and flashing)**: the ATC severity ladder ends in "flashing red only for
  unacknowledged alarm"; the flash-rate conflict between WCAG's 3 per second and the control-room
  3–5 Hz is reconciled in `CROSS-SOURCE-REGISTER.md` §3, not here.
- **Ch 5 (Reading in motion and dynamic content)**: FAA-HF-STD-010A §4.9 permits three ways to
  modulate text — luminance-up, inverse video, or an adjacent modulated marker — and **prohibits
  flashing text on and off**, because it compromises legibility at all times.
- **Ch 7 (User-adjustable parameters and defaults)**: this chapter gives the contrast, luminance, and
  colour-adjustability ranges; Ch 7 gives the default-value contract, "safety-critical signals are not
  user preferences", and the restorability requirements.
- **Ch 10 (Accessibility and consistency)**: WCAG §1.4.1 is the same rule as MIL-STD's
  never-colour-alone; the difference is that WCAG states it as a conformance criterion for an
  unscreened population.
- **`CROSS-SOURCE-REGISTER.md` §2** — the full colour-count reconciliation and decision table
  reproduced above (now four figures, with Rev.4's **6** added); **§6** — the luminance adjustment
  range and the logarithmic law as one of three instances of "the range must cover the operational
  envelope, and it should be perceptually uniform".
- **`CROSS-SOURCE-REGISTER.md` §9** — the evidence-quality note that Rev.1 is a scanned/OCR source
  while Rev.4 is natively digital, which is why **Rev.4 is preferred wherever the two overlap**: it
  is the current revision, and where they differ (contrast floor 3:1 → 6:1; colour count unbounded →
  6) Rev.4's number is the one to use.
