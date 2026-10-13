# Glossary

Terms as used **by the sources in this set**, not as used generally. Where a source gives a
term a precise technical meaning that differs from everyday usage, that meaning is given
here. Chapter references point to where the term does real work.

---

## A

**Acuity (visual)** — The finest detail the eye can resolve, conventionally ~1 minute of arc
for normal vision. It is the absolute floor beneath every legibility requirement here; NASA
HIDH uses **5 minutes of arc** as a practical floor for character height. (Ch 1)

**Additive/absolute contrast** — See *contrast ratio* vs *absolute contrast*. (Ch 3)

**Arcminute (arcmin, minute of arc)** — 1/60 of a degree of visual angle. **The canonical unit
for text size in this source set**, because it is independent of screen size, resolution, and
viewing distance. Convert to linear size with `size = 2 × distance × tan(angle/2)`. (Ch 1)

**Automaticity** — Skill acquired through repetition that no longer requires attention.
Relevant because consistent interfaces let users build it, and inconsistent ones prevent it.
(Ch 10)

## B

**Breadth (menu)** — The number of options presented at one level. Contrast *depth*. (Ch 9)

## C

**Cap height** — Height of a capital letter, measured from baseline to top. **This, not
`font-size`, is what arcmin requirements govern**; font size includes internal leading and is
typically 1.3–1.5 × cap height. (Ch 1)

**CIE L\*u\*v\* (CIELUV)** — The colour space in which this set's colour-difference metrics are
defined. **ΔE\*uv** quantifies perceptual difference between two colours. (Ch 3)

**Conspicuity** — The degree to which an element attracts attention against its background,
independent of whether it is legible once attended. (Ch 3, Ch 8)

**Contrast ratio** — Luminance ratio between foreground and background, expressed `(L1+0.05)/(L2+0.05)`
in the WCAG formulation on sRGB. Distinct from **absolute contrast** (a luminance difference)
and from **Michelson contrast**. (Ch 3)

**Critical marking** — MIL-STD term for a marking whose misreading has safety or mission
consequence; drives the stricter character-height and stroke-width requirements. (Ch 1)

**CVD (colour vision deficiency)** — Reduced ability to discriminate certain colour pairs.
~8 % of males are affected. The universal requirement across every source here: **colour must
never be the sole channel** for information. (Ch 3)

## D

**Default value** — MIL-STD-1472G §5.2.2.4.5 defines it functionally: a value supplied
**to reduce user workload**, displayed automatically at transaction start, acceptable with a
single keystroke, and replaceable **without changing the default definition**. A pre-filled
value that does not reduce work is not serving the standard's purpose. (Ch 7)

**Depth (menu)** — The number of levels the user must traverse to reach an option. The sources
penalise it because it forces **recall**. (Ch 9)

**Discoverability** — Whether an affordance is findable without prior knowledge. Opposite of
reliance on memorised gestures. (Ch 9, Ch 10)

**Duty cycle** — Fraction of a period a signal is "on". Flash and blink specifications here
pair a rate with a duty cycle (e.g. 50 % on/off); an equal duty cycle is preferred for alarms
so the signal is symmetric and predictable. (Ch 4, Ch 8)

## E

**Effectiveness / Efficiency / Satisfaction** — The ISO 9241-11 usability triad adopted by
NASA HIDH. Use these three when arguing that a change improves usability; "feels better" is
not one of them. (Ch 10)

**Emphasis budget** — The share of a display permitted to carry attention-grabbing formatting.
NUREG caps **highlighting at ≤10 %** of displayed information. (Ch 2)

## F

**Fail-steady** — An alarm requirement: if the attention-getting mechanism (flash, tone) fails,
the alarm must remain asserted in a steady state rather than disappearing. (Ch 4, Ch 8)

**Flicker fusion frequency (CFF)** — The rate above which a flashing light appears steady.
Relevant to refresh-rate requirements and to the 15–20 Hz band these standards prohibit for
seizure risk. (Ch 4)

**Focus (keyboard)** — The component currently receiving keyboard input. WCAG requires the
focus indicator to be **visible** (2.4.7) and focus order to preserve meaning (2.4.3). (Ch 9, Ch 10)

## G

**Ganging** — Coupling two controls so one moves the other. FAA permits ganging volume to mode
switches, but **prohibits** it where it could reduce an emergency signal below audibility. (Ch 7)

**Glance behaviour** — How long and how often a user can look away from a primary task to read
a display. Central to the "reading while moving" question, and **poorly covered by this source
set** — see Ch 4. (Ch 4)

## H

**Hierarchical menu** — A menu whose options open further menus. Parent visibility during child
selection is required by NUREG. (Ch 9)

**Hotspot** — The active region of an icon or control, as distinct from its visible glyph. The
accessible target is the hotspot; FAA requires ≥4 mm padding beyond the icon. (Ch 6)

## I

**Information unit** — A discrete item of meaning a user must extract (e.g. one destination on a
sign). Content budgets are often expressed in information units rather than characters because
comprehension, not reading, is the constraint. (Ch 4)

## L

**Large-scale text** — WCAG's term of art: **≥18 pt, or 14 pt bold**, or the CJK equivalent.
It exists solely to select a lower contrast requirement (3:1 rather than 4.5:1). (Ch 1, Ch 3)

**Leading (line spacing)** — Vertical distance between baselines, or the CSS `line-height`.
WCAG requires content to survive **≥1.5 ×** font size. (Ch 2)

**Legibility vs readability** — *Legibility*: can a character be identified at all? *Readability*:
can a passage be read fluently? The sources use different thresholds for each — e.g. 16 arcmin
for legibility, 20–22 for comfortable reading, 24 for rapid reading. (Ch 1)

**Luminance (cd/m², fL)** — Light emitted or reflected per unit area. The absolute physical
quantity behind contrast ratios. The two units in this set are candelas per square metre
(cd/m²) and foot-lamberts (fL); **1 fL ≈ 3.426 cd/m²**. Most sources print the pair directly
(e.g. NUREG's "≥10 ft-L (35 cd/m²)", where the rounded 3.5 factor is the source's own), so
prefer the paired value from the source over a conversion of your own. (Ch 3)

## M

**Michelson contrast** — `(Lmax − Lmin)/(Lmax + Lmin)`. Used by some sources instead of a ratio;
values here range 0.45–0.9 depending on the standard and the assumed conditions. **Not
interchangeable with a WCAG contrast ratio** — do not convert between them loosely. (Ch 3)

**Mimic (diagram)** — A display that reproduces the spatial layout of a physical system. NUREG
covers mimic design explicitly. (Ch 9)

**MTFA (Modulation Transfer Function Area)** — A display-quality metric combining resolution and
contrast. NUREG-0700 Rev.1 requires **MTFA ≥ 5**. (Ch 3)

## P

**Packing density** — Proportion of the character-cell grid actually occupied by glyphs. NUREG
caps it at **≤50 %**, and at **≤25 %** for alphanumeric displays. A *legibility* constraint,
distinct from line length. (Ch 2)

**Polarity** — Whether text is dark-on-light (positive) or light-on-dark (negative). Affects
legibility, required stroke width, and the acceptable surround-luminance ratio. (Ch 1, Ch 3)

**Protanopia / Deuteranopia** — Red-blind and green-blind forms of dichromacy. MIL-STD prohibits
colour codes above **650 nm** because protanopes cannot distinguish them. (Ch 3)

## R

**Reflow** — Re-layout of content to fit a narrower viewport without two-dimensional scrolling.
WCAG pins this at **320 CSS px** width (1280 px at 400 % zoom) and **256 CSS px** height. (Ch 2, Ch 6)

**RSVP (Rapid Serial Visual Presentation)** — Showing words one at a time in a fixed position to
measure reading speed independent of eye movement. Used by NASA HIDH as a legibility measure that
is more representative of ordinary reading than a size threshold. (Ch 4)

## S

**Scanning vs reading** — Short labels are *scanned* (treated as shapes); long text is *read*.
This is why MIL-STD requires labels under three words in upper case and longer labels in mixed
case. (Ch 1, Ch 9)

**Screen density** — See *packing density*. (Ch 2)

**Section 508** — The US Rehabilitation Act amendment requiring federal agencies' electronic and
information technology to be accessible. The reason NASA, FAA, and NUREG carry explicit
accessibility requirements rather than treating them as optional. (Ch 10)

**Stable response time** — A response whose *variability* is bounded: FAA requires ≤5 % in the
0–2 s band, 10 % at 2–5 s, 15 % beyond. Consistency matters more than raw speed, because the user
builds a model of the system from it. (Ch 5)

**Stroke width** — Thickness of a glyph's strokes, specified as a fraction of character height
(typically **1/12 to 1/6**). Must be **thicker for light-on-dark** polarity. (Ch 1)

## T

**Target size** — The hit area for a pointer or touch input, distinct from the visible glyph.
Minimums in this set: **24 × 24 CSS px** (WCAG AA), **9.5 mm** (NASA), **15 × 15 mm** (MIL-STD),
**44 × 44 CSS px** (WCAG AAA). (Ch 6)

**Text spacing (WCAG 1.4.12)** — The four override values content must survive: line height
**≥1.5 ×**, paragraph spacing **≥2 ×**, letter spacing **≥0.12 ×**, word spacing **≥0.16 ×**
font size. A robustness requirement, not a style mandate. (Ch 2)

**Transfer (of training)** — The degree to which skill learned in one interface applies in
another. The quantified benefit of consistency. (Ch 10)

## V

**Visual angle** — The angle a viewed object subtends at the eye. The unit in which all
legibility requirements here are properly expressed, because it is invariant to distance and
screen size. (Ch 1)

**Vigilance decrement** — Degradation of detection performance over prolonged monitoring.
FHWA-HRT-16-060 reports performance decrements **noticeable after 30 min** of continuous
monitoring tasks, while noting laboratory vigilance decrements **in as little as 20 minutes**.
Relevant to alerting design for monitoring dashboards: do not assume sustained attention.
(Ch 8)

## W

**Weber's Law** — The finding that perceived change is proportional to the existing stimulus, so
brightness and volume must be adjusted **logarithmically** to feel linear. NASA requires
continuous logarithmic dimming for this reason. (Ch 7)

**Working memory / recall vs recognition** — The sources consistently penalise interfaces that
require the user to *remember* (menu locations, mode, codes) and favour those that let the user
*recognise* (visible options, visible state). NUREG's rule that the user must never have to query
the system to determine the current mode is the strongest form. (Ch 9, Ch 10)
