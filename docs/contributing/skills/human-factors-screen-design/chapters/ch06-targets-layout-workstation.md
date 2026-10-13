# Chapter 6 — Targets, layout, and viewing geometry

**Core idea.** Target size is the one screen-design number that both the government standards
and the web standard specify, and they appear to disagree by a factor of three. They do not:
they answer different questions about different users holding different devices. The
**accessible target is the hit area, not the visible glyph**, and the ergonomics standards add
two things WCAG never says — a **floor for gloves and vibration**, and a **ceiling above which
bigger stops helping**. The geometry numbers look like a hardware topic and mostly are, but four
of them transfer directly into how you size a kiosk, a wall display, and a phone.

---

## Target size — the merged table

Every figure is quoted verbatim. The `≈ px` row is computed at **96 ppi (1 mm = 3.78 px)**, the
same basis the cross-source register uses for *24 CSS px = 6.35 mm* and *44 CSS px = 11.6 mm*.

| Requirement | NASA HIDH | MIL-STD-1472G | NUREG-0700 Rev.1 | NUREG-0700 Rev.4 (current) | FAA HF-STD-001B | WCAG 2.2 |
|---|---|---|---|---|---|---|
| Minimum target, non-keyboard | **9.5 mm (0.4 in)** §10.4.2.21.1 Fig 10.4-18 | **15 × 15 mm (0.6 in)** §5.1.3.1.15 Fig 3 | **15 mm (0.6 in)** §3.2.4-10; **5 mm/side** for generic selectable items §2.2.6-10 | **10 mm (0.4 in)** for large and medium screens §11.3.2.3.6-2; **5 mm/side** for generic selectable items §2.2.6-10 | no running-text figure (see note) | **24 × 24 CSS px** (AA) §2.5.8; **44 × 44 CSS px** (AAA) §2.5.5 |
| ≈ px at 96 ppi | ≈ 36 px | ≈ 57 px | ≈ 57 px / ≈ 19 px | ≈ 38 px / ≈ 19 px | — | 24 px = 6.35 mm; 44 px = 11.6 mm |
| Maximum useful target | **22 mm (0.9 in)** — "ineffective beyond this size" §10.4.2.21.1 | **38 × 38 mm (1.5 in)** §5.1.3.1.15 Fig 3 | **40 mm (1.5 in)** §3.2.4-10 | **40 mm (1.5 in)**; "**touch areas greater than 22 mm (0.9 in) square do not tend to improve performance**" §11.3.2.3.6-2 | — | none stated |
| Minimum separation | dead space **3.2 mm (0.1 in)** §10.4.2.21.1 | **3.0 mm (0.12 in)**; **5.0 mm (0.2 in)** for first-contact actuation §5.1.3.1.15 Fig 3 notes | **3 mm (0.1 in)** §3.2.4-10, §2.2.6-10 | **3 mm (0.1 in)** §11.3.2.3.6-2, §2.2.6-10 | icons **≥ 10 mm**, perimeter to perimeter §5.6.13.3.14 | 24 px circles centred on adjacent targets must not intersect §2.5.8 |
| Maximum separation | not specified | **6.0 mm (0.25 in)** §5.1.3.1.15 Fig 3 | **6 mm (0.25 in)** §3.2.4-10 | **6 mm (0.25 in)** §11.3.2.3.6-2 | — | — |
| Padding around a glyph | — | — | — | — | **≥ 4 mm** hotspot outside the icon area §5.6.13.3.13 | hit area may exceed the glyph §2.5.8 |
| Text/keyboard targets | — | keyboard preferred **13 × 13 mm (0.5 in)** §5.1.3.1.15 Fig 3 | key strike surface **≥ 12 mm** §3.2.1-11; centreline **18–19 mm** horiz, **18–21 mm** vert §3.2.1-14 | keytop strike width **≥ 12 mm**, preferably **18 mm (0.7 in) with gloves** §11.3.2.2.2-1; key height **10–13 mm** §11.3.2.2.2-9; centreline **18–19 mm** horiz, **18–21 mm** vert §11.3.2.2.2-8 | alphanumeric key width **12–15 mm** §5.7.1.4; centreline **16–19 mm** horiz, **18–21 mm** vert §5.7.1.5–.6 | inline-in-sentence targets exempt §2.5.8 |
| Key symbol legibility | — | — | key nomenclature **≥ 2.5 mm** high, contrast ratio **3:1** §3.2.1-12 | key symbol height **≥ 2.5 mm (0.1 in)** §11.3.2.2.2-4; lettering-to-background contrast **≥ 3:1** §11.3.2.2.2-5 | — | — |
| Menu / label pointing area | — | — | label **plus a half-character distance** around it §2.2.6-11 | label **plus a half-character distance** around it §2.2.6-11, §2.2.2.5-10 | option label **plus a half-character distance** around it §5.6.7.6.1.7 | — |
| Gloved operation | — | **+5.0 mm to each dimension** §5.1.3.1.15 Fig 3 note 2 | — | keytop preferably **18 mm with gloves** §11.3.2.2.2-1; touch force sensitivity must match **gloved operations during an emergency** §11.3.2.3.6-3 | — | — |

**FAA states no touch-target size in running text.** Its exhibit *5.7.4.2.4 Touch panel responsive
area dimensions* exists (p. 413) but its numbers are image-only and were not recovered. Do **not**
attribute a numeric touch-target size to FAA HF-STD-001B; its two usable numeric target rules are
the **≥ 4 mm hotspot padding** (§5.6.13.3.13) and the **≥ 10 mm icon separation** (§5.6.13.3.14).

### The current revision corroborates the ergonomics figures, not the web figures

NUREG-0700 **Rev.4** is the current revision, and on targets it lands with the cockpit and
control-room documents rather than with WCAG:

- **Its ceiling agrees with NASA's.** Rev.4 §11.3.2.3.6-2 states that touch areas **greater than
  22 mm square do not tend to improve performance** — the same number NASA HIDH derives in Figure
  10.4-18, from a second, independent source, thirty years later. That convergence is the strongest
  evidence in this chapter for the upper bound: the ceiling is not a spacecraft artefact.
- **Its floor sits just above NASA's.** Rev.4's **10 mm** minimum for large and medium screens is a
  half-millimetre above NASA's 9.5 mm, and comfortably above WCAG AA's 6.35 mm equivalent. Both
  revisions give the same rationale — the band exists "to allow for **finger size and parallax
  inaccuracy**" (Rev.4 §11.3.2.3.6-2) — and Rev.4 scopes it explicitly to **large and medium** screens.
- **Rev.4 lowered the floor from Rev.1 but kept the ceiling.** Rev.1 §3.2.4-10 gave touch response
  areas as **15–40 mm**; Rev.4 §11.3.2.3.6-2 gives **10–40 mm**. The minimum moved down; the 40 mm
  maximum and the 3–6 mm separation band did not change. **Where the two revisions differ, Rev.4 is
  current** — but its 10 mm is the *outer* bound of a band whose optimum it puts at ~22 mm, not a
  target to design to.
- **Its generic selectable-item rule is unchanged.** Rev.4 §2.2.6-10 repeats Rev.1's **≥ 5 mm per
  side, ≥ 3 mm apart** verbatim and under the same section number, so these are **one position held
  across both revisions**, not two. Cite either or both; they do not compete.

**This does not change the decision rule below; it strengthens it.** Pick by modality and
environment, and treat the ergonomics band as the anchor for anything finger-operated. WCAG's 24 px
AA remains the accessibility floor for a general audience, and its 44 px AAA is still the right
choice for a primary action — but no source in this set supports designing a touch control below the
~10–15 mm band on the argument that the web standard permits less.

### Why the government figures are larger, and how the sizes convert

- **Gloves** — MIL-STD requires **+5.0 mm on each dimension** for standard cotton flame resistant
  anti-flash gloves; base figures "apply to ungloved finger touch unless otherwise noted"
  (§5.1.3.1.15 Fig 3 note 2). NUREG requires controls usable with protective equipment (§3.1.1-12).
- **Vibration and platform movement** — MIL-STD §5.1.3.1.1: a touch-screen "shall not be the sole
  input means if system movement or vibration degrades user performance"; Table VI lists "accuracy
  degraded by vehicle movement and vibration" as a disadvantage.
- **Screened, trained operators doing time-critical work** — MIL-STD §5.1.3.1.6 requires a
  **confirmatory second action** for critical touch tasks; WCAG's audience is the general public,
  and it answers with target size plus the spacing exception instead.
- **Parallax through a thick overlay** — NUREG §3.2.4-10 gives its 15–40 mm band explicitly "to
  allow for finger size **and parallax inaccuracy**."

**Resolution of the 5 mm vs 44 px conflict.** Do not choose one number. Satisfy **WCAG AA
(24 × 24 CSS px) unconditionally** — the only figure here normative for a general audience — then
size the *visual* target from the modality table. Touch-first means **≥ 15 mm (≈ 57 px)** with a
**3–6 mm** gap; pointer-first means **24 px** with the spacing exception doing the work, and **44 px**
for primary actions. The full conversion ladder at 96 ppi (1 mm ≈ 3.78 px): NUREG **5 mm ≈ 19 px**,
WCAG AA **24 px = 6.35 mm**, NASA **9.5 mm ≈ 36 px**, WCAG AAA **44 px = 11.6 mm**, MIL-STD/NUREG
**15 mm ≈ 57 px**, NASA ceiling **22 mm ≈ 83 px**, MIL-STD max **38 mm ≈ 144 px**, NUREG max
**40 mm ≈ 151 px**. NASA's 9.5 mm is a floor for a screened operator on a moving platform, not a
licence to go below WCAG AA on the web.

### Decision rule by modality and environment

| Modality / environment | Design target | Separation | Cite |
|---|---|---|---|
| Mouse, trackpad, stylus, general-purpose screen | **24 × 24 CSS px** minimum; **44 × 44 px** where the control is primary or repeated | 24 px isolated hit circles; no intersection | WCAG §2.5.8, §2.5.5 |
| Finger, bare hand, stable device (phone, tablet, kiosk) | **15 × 15 mm** (Rev.1) — or **≥ 10 mm** per Rev.4 §11.3.2.3.6-2, with ~22 mm as the performance optimum | **3 mm** min, **6 mm** max | MIL-STD §5.1.3.1.15 Fig 3; NUREG Rev.1 §3.2.4-10; Rev.4 §11.3.2.3.6-2 |
| Minimal UI, icon toolbars, pointer-driven apps | **5 mm per side** is the *floor*, not the target; add **≥ 4 mm** padding around the glyph | **3 mm** | NUREG §2.2.6-10 (Rev.1 and Rev.4); FAA §5.6.13.3.13 |
| Finger, gloved, or vibrating / moving platform | **15 + 5.0 = 20 mm** per side | **5.0 mm** if first-contact actuation | MIL-STD §5.1.3.1.15 Fig 3 notes 2–3 |
| Dense data-entry touch keyboard | **13 × 13 mm** preferred; no minimum separation | 0 min, 6.0 mm max | MIL-STD §5.1.3.1.15 Fig 3 |
| Hardware key/button on a physical panel | **12–15 mm** strike width (Rev.4: **≥ 12 mm**, preferably **18 mm** with gloves); **16–19 mm** horizontal centreline | **18–21 mm** vertical centreline | FAA §5.7.1.4–.6; NUREG §3.2.1-11, §3.2.1-14; Rev.4 §11.3.2.2.2-1, §11.3.2.2.2-8 |

```css
.tap-target { min-width: 44px; min-height: 44px; display: inline-flex;
              align-items: center; justify-content: center; }  /* WCAG 2.5.5 AAA; ≈11.6 mm */
.icon-button { padding: 14px; }             /* 16px glyph + 14px each side ≈ 44px hit area */
```

---

## Separation, dead space, and the spacing exception

| Rule | Value | Source |
|---|---|---|
| Dead space between touch areas | **≥ 3.2 mm (0.1 in)** | NASA §10.4.2.21.1 Fig 10.4-18 |
| Separation, non-keyboard touch | **3.0 mm min**, **6.0 mm max**; **≥ 5.0 mm** for first-contact actuation, and last-contact may be < 5.0 mm but **not < 3.0 mm** | MIL-STD §5.1.3.1.15 Fig 3 and note 3 |
| Touch response areas | **3 mm min**, **6 mm max** separation | NUREG Rev.1 §3.2.4-10; Rev.4 §11.3.2.3.6-2 |
| Selectable screen items | separated by **≥ 3 mm**; more generally, "sufficient distance to minimize inadvertent activation of adjacent items" | NUREG §2.2.6-10 (Rev.1 and Rev.4); Rev.4 §11.3.2.3.1-10 |
| Icons | **≥ 10 mm** apart, perimeter to perimeter | FAA §5.6.13.3.14 |

**FAA's 10 mm vs NUREG/MIL-STD's 3 mm is a domain disagreement, not rounding.** FAA writes for icon
toolbars where the glyph is the visual anchor and the designer owns the whole layout; MIL-STD and
NUREG write for touch surfaces where a finger is wide and parallax shifts apparent contact. Resolve
by glyph size: **large glyphs separated by whitespace need only 3 mm of gutter plus padding; a row of
small icons needs FAA's 10 mm.**

### The key insight: the accessible target is the hit area, not the visible glyph

WCAG's **spacing exception** (§2.5.8) says an undersized target still conforms if a **24 CSS px
diameter circle centred on its bounding box does not intersect** another target's circle. It does
not require the drawn control to be 24 px — it requires the *isolated region around it* to be. That
single sentence reconciles the whole table: you can draw a 16 px glyph, keep the visual language
dense, and still conform, provided **padding** creates the isolated hit area. FAA's and NUREG's
half-character rule for menu labels (§5.6.7.6.1.7, §2.2.6-11) is the same idea forty years earlier —
*the pointing area is the label plus a margin, not the label.*

```css
.icon { width: 16px; height: 16px; }      /* WRONG: the clickable thing is the 16px box */
.icon-button { width: 44px; height: 44px; display: grid; place-items: center; }
.icon-button > svg { width: 16px; height: 16px; }  /* RIGHT: glyph 16px, hit area 44px */
.dense-toolbar { gap: 8px; }  /* 24px boxes + 8px gap keep the 24px circles from intersecting */
```

**Related hit-area rules.** Make the **whole row** the target — the radio-button selection area
includes the button **and its label** (FAA §5.6.13.6.12). **Minimise the count of small targets**,
especially drag targets, because difficulty "is greater for people with disabilities" (FAA
§5.6.18.2.3), and **provide zoom** where one is unavoidable (FAA §5.6.18.2.4; MIL-STD
§5.2.2.5.1.b(2); NUREG §2.2.6-12, §2.5.2-4). **Do not depend on dragging** — every drag-driven
function must also work with a single pointer (WCAG §2.5.7), and the double-click model (two clicks
within **700 ms**) is a second reason to keep non-drag paths (NUREG §2.2.6-9). Give **immediate
feedback**, because a touch surface has no tactile response (MIL-STD §5.1.3.1.3; FAA §5.7.4.2.2–.3;
NUREG §3.1.1-3, §3.2.4-7), and require **a distinct confirming action** for critical touch tasks
(MIL-STD §5.1.3.1.6; NUREG §3.1.1-14).

---

## The upper bound — why "bigger is safer" is false

NASA's Figure 10.4-18 gives a **maximum**, with a blunt rationale: beyond a certain size, *"accuracy
is not improved."* The value is **22 mm (0.9 in)** (§10.4.2.21.1). **NUREG-0700 Rev.4 §11.3.2.3.6-2
independently states the same number** — "touch areas greater than 22 mm (0.9 in.) square do not
tend to improve performance" — and MIL-STD and NUREG both agree a ceiling exists, setting it higher
at **38 × 38 mm** (§5.1.3.1.15 Fig 3) and **40 mm** (Rev.1 §3.2.4-10, Rev.4 §11.3.2.3.6-2).

**This is a real conflict the register records only partly, and Rev.4 sharpens it.** The 22 mm figure
is a *performance* ceiling and now has two independent sources behind it; the 38–40 mm figures are
*layout* ceilings: past them the control wastes scarce touch-surface area and pushes other controls
out of reach. Both documents require reach across the whole surface — MIL-STD §5.1.3.1.11.a reserves
it to the central **90 %** of the anticipated population, and Rev.4 §11.3.2.3.6-10 requires that
users "can reach and actuate all areas of the screen, including the corners," while avoiding full arm
extension and upward reach. **Resolution: treat 22 mm as the point of diminishing returns** — never
size a control larger on the argument that it will be easier to hit — **and 38–40 mm as a hard
proportion-of-surface constraint.** In practice: size to 15 mm, allow up to 22 mm for the
highest-consequence or highest-frequency action, and never exceed 38 mm without a specific reason.
The related falsity is NASA §10.6.5's **minimising clicks by packing the screen**: it "often results
in severely cluttered displays" that require "serial searching," raising error risk under stress.

---

## Gloves and environmental modifiers

| Modifier | Effect | Source |
|---|---|---|
| Standard cotton flame resistant anti-flash gloves | **+5.0 mm** to each dimension of the actuation area | MIL-STD §5.1.3.1.15 Fig 3 note 2 |
| Pressure suits / suits for all expected environments; controls used without line of sight | spacing must let the suited crewmember reach and operate the control, with clearance depending on the body part the gesture needs; space or shape/texture out-of-view controls so a pressurised gloved hand can identify them by touch alone | NASA §10.5.4.4, §10.5.6 |
| Protective equipment generally | controls "should be easy to identify and activate, or use" while wearing masks and gloves | NUREG §3.1.1-12 |
| Vibration / moving platform | do not rely on touch as the sole input; expect degraded accuracy; **limit** dependence on continuous vertical scrolling where motor skills may be impaired (e.g. high-g) | MIL-STD §5.1.3.1.1; NASA §10.4.2.21, §10.6.11 |
| Screen sensitivity and actuation force | sensitivity must match the operational mode, **including gloved operations during an emergency**; force **0.25 N min / 1.5 N max** (MIL-STD gives the same 250 mN–1.5 N band) | NUREG Rev.4 §11.3.2.3.6-3; MIL-STD §5.1.3.1.8, §5.1.3.1.15 Fig 3; NUREG Rev.1 §3.2.4-11 |

**Software-side translation.** You cannot change the glove, but you can change the *hit area* and the
*gesture*. For industrial, clinical, outdoor, or in-vehicle deployment: build on a **20 mm minimum**
(15 + 5), avoid two-finger and precision-drag gestures, and make the visual affordance larger than
the WCAG minimum so a gloved finger lands centrally rather than on the boundary. Both NUREG revisions
also restrict *when* touch is appropriate at all: touch is **not recommended** "if the task requires
holding an arm up to the screen for long periods" (Rev.1 §3.2.4-1; Rev.4 §11.3.2.3.6-1), nor for
**entry of large amounts of data**, nor for tasks requiring **frequent, alternating use of the touch
screen and a keyboard** (Rev.4 §11.3.2.3.6-1), and MIL-STD §5.1.3.1.12 forbids touch for "frequent
actions over an extended duration of time" — **explicitly excepting small hand-held devices**.
Rev.4 also notes that **touch displays will not permit precise pointing** (§2.3.3-3), so any task
needing fine positioning needs a different device or a zoom affordance.

---

## Viewing geometry — distance

| Rule | Value | Source |
|---|---|---|
| Seated user — maximum | **≤ 70 cm (28 in)** to a display near its associated controls (MIL-STD); **≤ 635 mm (25 in)** where there is an associated control (FAA) | MIL-STD §5.2.3.1.a; FAA §5.3.1.4.13 |
| With ejection seats | up to **76 cm (30 in)** | MIL-STD §5.2.3.1.b |
| Minimum viewing distance | **≥ 33 cm (13 in)**, preferably **≥ 51 cm (20 in)**; FAA's floor is **≥ 330 mm (13 in)** and NUREG Rev.1's VDU minimum is **≥ 12 in (30 cm)**; **Rev.4 §11.3.1.2-3 sets ≥ 50 cm (19.7 in)** for normal control-room viewing | MIL-STD §5.2.3.1.c; FAA §5.3.1.4.14; NUREG Rev.1 §7.1.2-8; Rev.4 §11.3.1.2-3 |
| Short observation periods, or dim signals must be detected | may reduce to **250 mm (10 in)**; MIL-STD gives **25 cm (10 in)** and Rev.4 a **minimum of 25 cm (10 in)** | FAA §5.3.1.4.14; MIL-STD §5.2.3.1.d; Rev.4 §11.3.1.2-3 |
| Touch screens specifically | design distance **≥ 40 cm**, but **30 cm** allowed for touchscreen-type applications (ISO 13406-2) | NASA §10.3.2.1 |
| Displays forced beyond **50 cm (20 in)** | must be modified in display size, symbol size, brightness ranges, and resolution | MIL-STD §5.2.3.1.f; Rev.4 §11.3.1.2-4 |
| Work-surface depth to achieve this | depth should allow positioning the display for a **minimum viewing distance of 50 cm (19.7 in)**, at a screen-centre angle of **minus 15° to minus 25°**, with the whole viewing area in an arc **60° below horizontal eye level** | Rev.4 §11.3.4.1-6 |
| Viewing distance : diagonal | large screen **3.0–6.0** required, **2.0–10** acceptable, optimum **4.0**; projection **not more than 8:1** and **not less than 2:1**, optimum **4:1**, preferred **3:1–6:1** | MIL-STD §5.2.3.2.1.c, Table XVI; FAA §5.3.2.3.3 |
| Large screen — closest viewer | no closer than **one-half the display width or height, whichever is greater** | MIL-STD §5.2.3.2.1.e; FAA §5.3.2.2.3 |
| Workstations that must serve several distances | "workplace design should allow observers to view displays from other distances" | FAA §5.3.1.4.17 |

**Two conflicts the register does not record.**

1. **700 mm (MIL-STD §5.2.3.1.a) vs 635 mm (FAA §5.3.1.4.13)** for the same case — a seated user
   with a display that has associated controls. FAA's Discussion gives the derivation: *"the reach
   distance for a 5th percentile female is 26 inches, so setting the distance at 25 inches insures
   that the 5th percentile female can reach the controls."* FAA's figure is the anthropometrically
   justified answer to a **reach-to-control** requirement; MIL-STD's is a display-distance limit.
   **Use 635 mm whenever the user must touch or reach what they are looking at** — the kiosk,
   console, and tablet case exactly.
2. **Viewing distance : diagonal, acceptable upper limit 10 (MIL-STD) vs 8 (FAA).** The
   *preferred* band is identical (3:1–6:1, optimum 4:1). **Design to 3:1–6:1; treat 8:1 as the
   outer limit.** The ratio is the only lever you have when you do not control the room: a wall
   display 4 m from the nearest viewer at 6:1 implies a **diagonal near 0.67 m**, and the same
   content on a 3 m wall then fails the geometry and must be **redesigned, not enlarged** — exactly
   what MIL-STD §5.2.3.1.f requires (size, symbols, brightness, and resolution change together).

---

## Viewing geometry — gaze angle, tilt, swivel, console sweep

| Rule | Value | Source |
|---|---|---|
| Line of sight from eye to screen centre | **10–60° below horizontal**, preferably user-settable within that range; the most comfortable resting eye position is **15° below horizontal**; a monitor at **40° below horizontal** reduces neck, shoulder, forearm, and wrist discomfort for users wearing **bifocals** | FAA §5.3.1.4.6 and Discussion |
| Vertical viewing angle — Rev.4's tighter band | **between −40° and 0°** relative to the horizontal LOS, preferably **−25° to −15°**; the bridge of the nose may substitute as the eye-point reference | Rev.4 §11.3.1.2-1 |
| Horizontal viewing angle — Rev.4 | **−35° to +35°** from direct frontal perpendicular viewing, preferably **−15° to +15°**; may expand to **−60° to +60°** for multiple horizontally arrayed screens where head rotation is allowed | Rev.4 §11.3.1.2-2 |
| Display face orientation | perpendicular to the line of sight whenever feasible; **never more than 45°** from it; dot-matrix/segmented displays **≤ 35° off axis** | FAA §5.3.1.4.7, .8; NASA §10.5.4.2; MIL-STD §5.2.3.12.7; Rev.4 §11.3.1.2-5 |
| Critical indicators | within **15°** of the normal line of sight; emergency displays and controls within a **30° cone** about it | MIL-STD §5.2.3.13.11; FAA §5.4.2.2.1.8; MIL-STD §5.1.2.2.1.h |
| Touch screen mounting and reach | perpendicular in the normal operating position; a **reduced angle (< 90° from horizontal)** may cut arm fatigue for frequent actions, but must be weighed against parallax, glare, and readability. The **central 90 %** of the anticipated population must reach and actuate all areas **including corners**; avoid full arm extension and upward reach; provide elbow support where possible | MIL-STD §5.1.3.1.10, §5.1.3.1.11.a–d; Rev.4 §11.3.2.3.6-10, §11.3.2.3.6-11 |
| Display adjustability | tilt **−5° to +20°**; height at least **110 mm** total; swivel minimum **45°** left or right; all in steps or continuously; the display must be **stable in all adjustment positions** | FAA §5.3.1.3.1, .2, .4, .6 |
| Console sweep and segments | total required left-to-right viewing angle **≤ 190°**; wrap-around console required when preferred panel space exceeds **1.12 m (44 in)**; central segment **≤ 1.12 m (44 in)** with vision over the top and **≤ 860 mm (34 in)** without; left/right segments **≤ 610 mm (24 in)** each with vision over the top | FAA §5.8.2.3.7, .1, .3, .5, .4 |
| Task-sequence span | sequenced displays and controls **≤ 1.8 m (72 in)** wide for a single user; single-operator workstation lateral spread **≤ 72 in (183 cm)** | FAA §5.8.2.6.4; NUREG §7.1.1-8; Rev.4 §11.2.1.2-5 |
| Monitoring zones | frequently monitored displays within **35°** left/right of straight-ahead LOS, **≤ 35° above** and **25° below** horizontal LOS; infrequently monitored displays within **≤ 95°** left/right; upper limit of the visual field **75° above** the horizontal LOS (5th percentile female) | NUREG Rev.1 §7.1.1-6, §7.1.1-7, §7.1.1-5, §7.1.2-5; Rev.4 §11.2.1.1-6 |
| Stand-up workstation display heights | displays **104–178 cm (41–70 in)** above the floor; important or frequently read displays **127–165 cm (50–65 in)** | Rev.4 §11.2.1.2-1–4 |
| Sit-only workstation display heights | displays **15–117 cm (6–46 in)** above the sitting surface; important displays **36–89 cm (14–35 in)** | Rev.4 §11.2.1.3-1–4 |
| Off-centreline viewing | individual viewer **≤ 10°**; group viewers **≤ 30°**, preferred **20°**; optical projection preferred **0–20°**, acceptable **0–30°**; Rev.4 adds **< 25° for beaded** high-gain projection screens and **< 30° for high-gain metallic** | FAA §5.3.2.2.4, §5.3.2.3.5, §5.3.2.3.4; MIL-STD §5.2.3.2.3.d, Table XVI; Rev.4 §12.1.1.3.1-3, §12.1.1.3.1-4 |

**On MIL-STD §5.2.1.2.3.** Its two sentences — "display faces shall be perpendicular to the user's
normal line of sight" and "display faces shall be not less than 45 degrees from the normal line of
sight" — contradict each other verbatim. The register already flags this; the resolution is to
**prefer FAA §5.3.1.4.7/.8 and NASA §10.5.4.2**, which state the coherent rule: perpendicular
where feasible, never more than **45° off** the normal line of sight.

---

## What transfers to a software decision, and what does not

Most of the geometry above is a **hardware procurement** concern. These items are not, because
they set the *content scale* your software ships with.

| Geometry item | Software decision it drives | Verdict |
|---|---|---|
| Viewing distance (MIL-STD §5.2.3.1; FAA §5.3.1.4; NUREG §7.1.2-8; NASA §10.3.2.1; Rev.4 §11.3.1.2-3) | base font size and target size — everything in Ch 1 and this chapter depends on it | **transfers, directly** |
| Line of sight 10–60° below horizontal (FAA §5.3.1.4.6; Rev.4 §11.3.1.2-1) | whether a kiosk is mounted angled or flat, hence whether the UI must be legible 10° or 40° off-normal — an anti-glare, anti-parallax layout decision; Rev.4's tighter **−25° to −15°** preferred band is the number to specify | **transfers as a constraint on the deployment spec** |
| Viewing distance : diagonal ratio (MIL-STD §5.2.3.2.1.c; FAA §5.3.2.3.3) | how much content a wall display may hold — how many rows and columns a dashboard may ship | **transfers** |
| Off-centreline angle, individual vs group (FAA §5.3.2.2.4; NUREG §7.1.1-6; Rev.4 §12.1.1.3.1-3) | where critical content sits on a shared display | **transfers** |
| Touch reach, central 90 % of population (MIL-STD §5.1.3.1.11; Rev.4 §11.3.2.3.6-10) | **do not put primary actions in the corners of a large touch surface** | **transfers** |
| 15° critical-indicator cone, 30° emergency cone, 75° visual-field limit | ordering of critical readouts relative to the centre of the viewport | **transfers as a priority-order rule** |
| Tilt −5/+20°, height 110 mm, swivel 45°, console segments, 190° sweep, 1.8 m span, workstation height bands (FAA §5.3.1.3, §5.8.2; Rev.4 §11.2.1.2, §11.2.1.3) | whether the app needs a rotate breakpoint or a multi-monitor layout mode | **weakly transfers** — spec it, do not compute from it |
| **Pixels per degree of visual angle** (Rev.4 §11.3.1.4.1-1: **≥ 32 pixels per degree** for image and video displays) | the real ceiling on how much detail may be drawn at a given viewing distance — screen content that resolves finer than this is wasted | **transfers as a content-density limit** |
| Mounting, parallax, glare, screen sensitivity, actuation force | out of scope for software | **does not transfer** |

**The most useful transferable rule.** For a **shared** display — a wall monitor, a control-room
overview, a dashboard on a TV — the individual-viewer limit of **10°** off centreline cannot be met
for everyone at once. FAA §5.3.2.2.4 and §5.3.2.3.4 give the group figure: **≤ 30°, preferred 20°**.
NASA §10.5.1 states the obligation plainly: a shared display "should be located within the required
viewing angles and viewing distances of **all** operators." In software terms: **put what everyone
must read in the centre 20°**, and demote what only the nearest viewer needs. This is the
wall-display analogue of the no-primary-actions-in-the-corners rule.

**Deployment sizing cheat-sheet** — the four cases the geometry actually decides:

| Deployment | Governing distance | Target size | Display constraint |
|---|---|---|---|
| **Phone / handheld** | held close; MIL-STD §5.2.3.4.3 prefers direct input pointers for handhelds with diagonal < 12.7 cm; §5.1.3.1.12 exempts small handhelds from the sustained-touch prohibition | **≥ 15 mm**, or WCAG 44 px, whichever is larger | reflow at **320 CSS px** (WCAG §1.4.10) |
| **Kiosk / touch terminal** | NASA §10.3.2.1 allows **30 cm** for touchscreens; FAA §5.3.1.4.14 floors at **250 mm**; where a control must be reached, FAA §5.3.1.4.13 caps at **635 mm** | **20 mm** (15 + 5 glove allowance) | mount angled — MIL-STD §5.1.3.1.10 permits < 90° from horizontal; no upward reach, since standing users cannot full-arm-extend (MIL-STD §5.1.3.1.11) |
| **Desktop with a mouse** | MIL-STD §5.2.3.1.c prefers **≥ 51 cm**; FAA §5.3.1.4.14 floors at **330 mm** | **24 CSS px** minimum, **44 px** for primary actions | resizable to 200 % without loss (WCAG §1.4.4) |
| **Wall / group display** | distance : diagonal **3:1–6:1**, optimum **4:1** (MIL-STD §5.2.3.2.1.c; FAA §5.3.2.3.3); never closer than **half the width or height** | content scale follows from the ratio, not from a px value | critical content in the centre **20°**; off-centreline **≤ 30°** for groups |

---

## Layout and flow

**Placement by importance and frequency** — the most consistently repeated rule in the set.

| Rule | Source |
|---|---|
| Most important information and controls in the **upper left** of its window; least important at the bottom; most frequently used information also in the **upper left**, and on the **first** screen if there are several | FAA §5.6.1.3.14, §5.6.8.3.2.2 |
| Most important / most frequent groups in **areas of easiest access**; maintenance-only groups get lesser access; frequently used displays in the **optimal visual and manual zones** | NASA §10.5.4.2, §10.5.4.3 |
| Critical displays and controls in the **primary manual and visual areas** and the **central visual field**, in a privileged position (e.g. top or leftmost); keep them out of high-traffic paths; particularly important / immediate-response information belongs in the **primary viewing area** | NASA §10.5.2; FAA §5.3.1.4.11, §5.6.1.3.13 |
| Critical or immediate-response data items **at the top** of the display; likewise frequently used data items | MIL-STD §5.2.2.2.6.a(2), (4) |
| Grouping order of preference: **(1)** order/sequence, **(2)** importance, **(3)** function, **(4)** frequency; grouping principles are task, sequence of use, frequency of use, data comparison, importance, function, alphanumeric/chronological | MIL-STD §5.2.2.2.6.a; NUREG Table 1.1, §1.1-15 |

**Scanning order, flow, grouping, and density.**

| Rule | Value | Source |
|---|---|---|
| Primary flow | **left to right, top to bottom**, matching the printed page; the most frequent choice goes **leftmost or topmost** ("In button sets and menus, the most frequent choice should appear in the leftmost or top position") | NASA §10.5.4.2/.3/.5; MIL-STD §5.2.2.2.5.d; NUREG §3.4.2-2; FAA §5.6.1.3.8 |
| Information flow direction | starts at a **high (global) level** and continually becomes more specific — the ancestor of progressive disclosure | NASA §10.5.4.3 |
| Natural order and start point | spatial or chronological order **must be preserved**; table rows increase left to right, columns top to bottom; the start point must be obvious, ordinarily **upper left** | FAA §5.6.1.3.15, §5.6.1.5.2; MIL-STD §5.2.2.4.6.c |
| Travel cost and proximity | minimise "both eye and pointer movement and the number of keystrokes", so the pointer does not cross the screen between steps; displays close to the controls they relate to, **display above each control**, pairs in rows (the inline-edit pattern); the hand must not obscure what is being read; related controls and displays must **not** sit on separate facing panels | FAA §5.6.1.3.7; NASA §10.5.4.2, §10.5.3; NUREG §3.4.2-3, §3.4.2-9 |
| Consistency | conventions consistent across the whole system and across applications | NUREG §3.4.2-6; MIL-STD §5.2.2.2.5.e |
| Group by task flow | reinforce with proximity, similar colour, or similar shape; use similarity, closure, or a border; separate groups with blanks, spacing lines, or colour-coding; keep groups used together close and push unrelated ones apart | NASA §10.6.7, §10.6.9, §10.5.4.4; MIL-STD §5.2.2.2.6.b; NUREG §1.1-16; FAA §5.6.1.3.11 |
| Alignment and clear space | **align elements** to reduce clutter and support search; clear space around critical information **≥ 1 character line** above and below and **≥ 2 character spaces** left and right | NASA §10.6.10; MIL-STD §5.2.2.2.2 |
| Tables and lists | blank line after a group of rows at intervals **≤ 5 lines**; column separation **≥ 3 spaces**; uniform column widths; **≥ 1 blank line** between header and body; each list item on a new line, in a recognisable order, ordered **vertically** within each column | MIL-STD §5.2.2.4.6.l, .k, .j, §5.2.2.2.4.n(5), .o(6), §5.2.2.4.7.b, .a, .e; FAA §5.6.2.9.1, §5.6.2.9.3 |
| Density ceilings | text screens **≤ 60 %**; packing density **≤ 50 %**; alphanumeric displays **≤ 25 %**; distribute unused area to separate logical groups rather than leaving it on one side | FAA §5.6.1.1.3; NUREG §1.1-11 |
| Component counts and uniformity | **< 20 icons** on screen at once; **≤ 20** action icons per window, along the **left margin**, bound to the window; **all push buttons in a window have the same size and shape** — the rule forbidding one "special" button from silently breaking a uniform target size | FAA §5.6.13.3.20, .26, .25, .27; §5.6.13.5.1 |
| Stable chrome | prompts, menu bars, command lines, and message areas in the **same screen location** throughout, as are instructions and error messages; the **bottom** is reserved for status, error messages, prompts, and command entry (command entry just above the message area) | FAA §5.6.1.3.2, §5.6.1.4.4; MIL-STD §5.2.2.2.4.k; FAA §5.6.14.3.2.10, .11 |
| Title, identity, and pagination | title or header at the top describing contents (unique, top-left, brief); a unique page id **3–7 characters**; "page x of y", numbered **continuously** across pages, **no leading zeros**; the last line of one page is the first line of the next; row/column labels stay put and must not scroll away | FAA §5.6.1.3.1; MIL-STD §5.2.2.2.4.n(1)–(4); NUREG §1.1-5, §1.1-6, §1.1-13, §1.1-50; FAA §5.6.2.8.3, §5.6.2.10.10; MIL-STD §5.2.2.4.7.c |
| Do not split related data | a user should never have to remember data across screens; related data stays on one page or in an integrated display. **Frames** are permitted **only** when two or more groups must be seen simultaneously **and** one requires scrolling | FAA §5.6.1.3.17, §5.6.2.8.2; NUREG §1.1-12, §1.1-10; NASA §10.6.5; MIL-STD §5.2.2.2.4.o |
| Minimise window manipulation | the resizing, placement, and manipulation of windows required to use the system should be **minimised**, and the window should **initially appear in the most appropriate form for the user's tasks** | Rev.4 §2.5.2-33 |

**On display hardware figures (the honest boundary).** Rev.4 carries an unusually dense set of
display-quality numbers, and most are **procurement specifications, not interface design rules** —
they constrain the monitor, not the layout. They are recorded here so a reader does not mistake their
absence for an oversight, and so the one figure that *does* bear on layout is not lost among them.

| Rev.4 figure | Value | Source | Bear on design? |
|---|---|---|---|
| **Pixels per degree of visual angle** | **≥ 32** for image and video displays; MTFA **≥ 5** | §11.3.1.4.1-1 | **Yes** — caps how much detail is resolvable at the design distance, and therefore how fine a UI may be drawn |
| Pixel pitch | **≤ 0.3 mm/pixel**; CRT pixel size **≥ 0.2 mm** at half height; at a 50 cm design distance the pitch must be **0.25 mm** for 16-arcmin characters and **0.35 mm** for 22-arcmin characters | §11.3.1.4.1-7 | Hardware, with that one instructive consequence |
| Gamma, grey scale, luminance, uniformity, jitter | gamma **1.8–2.2** per primary; discrete grey levels **≥ 256**; character or background (whichever is brighter) **≥ 35 cd/m²**, preferably **≥ 100 cd/m²**, preferred range **80–160 cd/m²**; luminance non-uniformity **≤ 50 %** of centre luminance; jitter **≤ 0.0002 × viewing distance** over 0.5–30 Hz, equivalently **≤ 0.2 milliradians (41 seconds)** of visual angle over 1 second | §11.3.1.4.3-4, §11.3.1.4.3-1, §11.3.1.4.3-2, §11.3.1.4.2-3 | Hardware — but it sets the contrast budget Ch 3 works within, and the jitter figure matches MIL-STD §5.2.1.1.5 |
| Image continuity, nonlinearity, orthogonality, Moiré, flicker | no resolvable scan lines, matrix spots, gaps or individual pixels; row/column length difference **≤ 1.0 %**; symbol displacement **≤ 5.0 %** of the symbol box; orthogonality error **≤ ±30 arcmin**; Moiré contrast **≤ 0.07** over 0.5–7 cycles/degree | §11.3.1.4.1-4, .5, .6, .8; §11.3.1.4.2-2 | Hardware |

**The one that transfers is pixels per degree.** It is the geometric counterpart of the arcmin rules
in Ch 1: text sized in arcmin tells you how large to draw a character, and **≥ 32 pixels per degree**
tells you whether the display can render it. A layout that packs fine detail into a display below
that density is not a layout problem you can fix in CSS.

---

## Scrolling, reflow, and the 320 CSS px floor

| Rule | Value | Source |
|---|---|---|
| Direction of preference | vertical (top-to-bottom) scrolling where there is a choice; **horizontal scrolling is never recommended**, especially when vertical scrolling is also required. Where horizontal scrolling is unavoidable it must take a **single action** (e.g. moving a scroll icon), and horizontal scroll/paging structures appear **only** where horizontal movement is appropriate | FAA §5.6.14.2.4.3; NASA §10.6.11; NUREG §2.5.5-6, §2.5.5-7 |
| Tabular displays | **shall not extend over more than one page horizontally** | MIL-STD §5.2.2.4.6.f |
| Text window width | wide enough for an entire anticipated line **without horizontal scrolling** | FAA §5.6.14.3.4.1 |
| Continuous text | **stationary**; not scrolled continuously except by user action; use **scrolling, not panning**, to move through it. For logically grouped information use **paging** instead, because inexperienced users perform better with it | FAA §5.6.2.5.1.12, §5.6.2.8.6, §5.6.2.8.7 |
| Overflow affordance | when content exceeds the display area, provide scrolling, paging, or panning; scroll-bars are provided whenever the entity exceeds the available space and **deactivated** when the whole document fits | FAA §5.6.3.4.4.1, §5.6.14.2.4.1, .2 |
| Reflow | present without loss of information or functionality, **without two-dimensional scrolling**, at **320 CSS px** width or **256 CSS px** height | WCAG §1.4.10 (AA) |

**The sources agree, and it is a strong agreement.** NASA says horizontal scrolling is never
recommended; MIL-STD forbids horizontal extension of tables across pages; NUREG permits it only for a
single action and only where horizontal movement is meaningful; FAA prefers vertical and sizes text
windows specifically to avoid it. WCAG then makes it a conformance failure at 320 CSS px. **Permission
to scroll horizontally exists but is narrow:** NUREG §2.5.5-6/.7 allow it where content is genuinely
two-dimensional (wide tables, canvases, timelines) and a single action shifts the view, and WCAG
§1.4.10 states the same exception formally — two-dimensional layout is permitted for **images needed
for understanding, video, games, presentations, and data tables** (not individual cells). Everywhere
else, **if a layout needs horizontal scrolling at 320 CSS px, the layout is the defect.** The
reachability rules that pair with it: several techniques to scroll or page (NUREG §2.5.5-9), only
**one** structure for vertical movement and **one** for horizontal (§2.5.5-10), scrolling labelled
textually or graphically (§2.5.5-11), and a scroll box sized to indicate the proportion of the
document displayed (FAA §5.6.14.2.4.14) and positioned to indicate relative location (§5.6.14.2.4.13).

```css
/* Reflow floor: no horizontal scroll at 320 CSS px. */
.shell { display: grid; grid-template-columns: minmax(0, 1fr); } /* minmax(0,1fr) prevents blowout */
.data-table { overflow-x: auto; }   /* the WCAG 1.4.10 data-table exception, scoped */
@media (max-width: 480px) { .sidebar { display: none; } }
```

---

## Window and panel defaults

| Rule | Value | Source |
|---|---|---|
| Default height, text and scanning windows | **≥ 4 lines** — NUREG's figure is a **default**; FAA's are **minima**, so both apply at once: open at 12 lines for prose and never let a resize go below 4 | NUREG §2.5.6-10; FAA §5.6.14.1.7 |
| Minimum height | text windows **≥ 12 lines**; alphanumeric windows **≥ 7 lines**; continuous text read on-line **≥ 4 lines** at one time | FAA §5.6.14.1.7, .8, §5.6.2.5.1.10 |
| Width | default generic text window **50–80 characters**; fastest line length for continuously scrolling text **52–78 characters** | NUREG §2.5.6-11 |
| Size adequacy | must permit display of the title and menu bar, if any; where possible the **initial** size displays **all** the window's contents and is consistent with them (amount of information, menus, data fields); large enough to present all relevant task information, not obscure important information, not crowd, and **minimise the need for scrolling** | FAA §5.6.14.1.9, .14, .4; NUREG §2.5.6-9 |
| Number of open windows | **shall not compromise system response time** | FAA §5.6.14.1.3 |

**Initial placement and focus** — FAA §5.6.14.1.15 gives the most complete placement rule in the
set: position the window by **(a)** the importance of the information — critical information in the
**centre of the user's field of view; (b)** information already displayed that should not be
obscured; **(c)** the distance from the current pointer location, so pointer movement is minimised;
**(d)** when applicable, already-displayed information relevant to the window. NUREG §2.3.1-5 adds
the focus rule: on the initial view of a data entry display the cursor appears automatically at a
**consistent and useful location** — for a form, the **first entry field**; for pointing-based menu
selection, the **first listed option**; for code entry, the **command entry area**. The HOME
position must be consistent across all displays of a given type and across the windows of a
partitioned display — NUREG §2.3.1-6.

**Structure, stacking, and resize.**

| Rule | Source |
|---|---|
| Title bar: a rectangular area at the top of the window **inside** the border, title **centred**; content is application name then file name separated by a single dash; secondary windows title the object under focus then the action ("Printer - Set Up"); a window opened from a menu option takes **that option's wording** as its title | FAA §5.6.14.2.1.1, .3, .5; §5.6.14.3.2.6 |
| Vertical order: title bar, menu bar directly below it, working area, command entry, message area at the bottom | FAA §5.6.14.3.2.8, .9, .10, .11 |
| Window labels sit at the top of the border and **remain while data scrolls underneath**; windows are visually separated, **preferably by borders** | NUREG §2.5.6-1, §2.5.6-5 |
| **Only one window active at a time**; it is distinguishable, **not obscured** by any other window, and on regaining focus the location cursor returns to the object that last had it; active windows frontmost, and **caution and warning windows frontmost** | FAA §5.6.14.5.3.2, .3, .7, §5.6.14.5.4.9; NUREG §2.5.6-7, §2.5.6-8 |
| **Overlapping windows must not cover** needed underlying information, the screen title, or navigation controls; it must not be possible to obscure menu bars, command-area access, or caution and warning messages | FAA §5.6.14.7.1.4; NUREG §2.5.6-22 |
| A window **shall never be movable off the display** so that it cannot be seen (it may be fully hidden by others); partially removed windows become accessible with a **single action**; **overlays are non-destructive**, so obscured data is not permanently erased | FAA §5.6.14.6.1.4; NUREG §2.5.6-29, §2.5.6-9; FAA §5.6.14.7.1.5, .6 |
| On **resize**, text, graphics, and icon layouts reformat so they remain visible; critical information is not obscured; scroll-bars are **added** when the window becomes too small to display its objects | FAA §5.6.14.6.2.10, .4, .13 |

**Rev.4 restates the same rules and adds three placement constraints** (§2.5.2, all from the mined
file): the number of open windows should have a **defined upper limit** so response time is not
compromised (§2.5.2-39); the system should **indicate all open windows including hidden ones**, at
the user's request rather than continuously (§2.5.2-46); and it should **not be possible to move or
resize a noncritical window so that it obscures critical information**, nor to move a critical
window **off the display** (§2.5.2-34, §2.5.2-35, §2.5.2-38). Rev.4 also adds the rule that the
amount of resizing, placement, and manipulation required should be minimised, with the window
appearing **initially in the most appropriate form for the user's tasks** (§2.5.2-33).

**Buttons and actions in windows.** Push buttons belong on the top, bottom, or sides of the working
area, in a horizontal row or vertical column **centred** with the window (FAA §5.6.14.2.8.1, .2);
ordering is by frequency or sequence of use, with **positive actions at the left or top and negative
or canceling actions at the right or bottom** (§5.6.14.2.8.6); in a data-entry window, buttons go in
a row at the bottom of the working area, **visually separated from the data fields** (§5.6.14.3.3.4);
button order must be consistent throughout the application, with the same buttons in the same
locations (§5.6.14.2.8.3, .4). A fixed-height panel (`height: 200px; overflow: hidden`) violates
FAA §5.6.14.6.2.10: content clipped by its container has not "reformatted so that it remains
visible."

---

## Anti-patterns

- **Sizing the visible glyph instead of the hit area** — a 16 px icon with no padding is a 16 px
  target (≈4.2 mm at 96 ppi), below NUREG's 5 mm floor and far below WCAG AA. §2.5.8 permits a small
  glyph, never a small *target*.
- **Designing a touch control much below 10 mm on the argument that WCAG allows it** — the
  *current* revision of NUREG-0700 sets a **10 mm** floor with a ~**22 mm** optimum (§11.3.2.3.6-2),
  so the web minimum is the accessibility floor, not the ergonomic one.
- **Treating "bigger is safer" as unbounded** — NASA §10.4.2.21.1 stops rewarding size at **22 mm**;
  a 60 mm button wastes reachable surface and violates MIL-STD §5.1.3.1.11.a (central-90 % reach).
- **Applying glove padding to a mouse-driven app** — MIL-STD's **+5.0 mm** is conditional on gloved
  operation (§5.1.3.1.15 Fig 3 note 2); inflating a desktop UI to 20 mm targets destroys density.
- **Treating geometry numbers as CSS values** — `−5°/+20°` tilt, `110 mm` height, `45°` swivel,
  `190°` sweep (FAA §5.3.1.3.1–.4, §5.8.2.3.7) are **mounting** requirements, not stylesheet ones.
- **Horizontal scrolling on a grid that also scrolls vertically** — NASA §10.6.11 calls the
  combined-axis case the worst; MIL-STD §5.2.2.4.6.f forbids tabular horizontal extension.
- **Centring critical content for an individual on a group display** — the individual limit is **10°**
  off centreline (FAA §5.3.2.2.4) but a group needs **≤ 30°, preferred 20°**.
- **Relying on hover to reveal an action on a touch device** — hover does not exist for a finger; the
  touch sources require immediate, explicit actuation feedback (MIL-STD §5.1.3.1.3; NUREG §3.2.4-7).
- **Making drag the only path to a function** — WCAG §2.5.7 (AA) requires a non-drag equivalent, and
  FAA §5.6.18.2.3 notes difficulty grows as targets shrink, "greater for people with disabilities."
- **Dense toolbar rows separated only by a hairline border** — FAA §5.6.13.3.14 requires **10 mm**
  perimeter-to-perimeter; a 1 px divider is a visual device, not a separation.
- **A window whose default is too small to hold its own content** — FAA §5.6.14.1.14 requires the
  initial size to show all contents where possible and §5.6.14.1.4 forbids needless scrolling.
- **A modal overlay that erases the data it covers** — overlays must be non-destructive (NUREG
  §2.5.6-9; FAA §5.6.14.7.1.5, .6).
- **Moving a critical or high-frequency action to a corner or distant panel** — NASA §10.5.2 and
  §10.5.8 require the primary/optimal zones; NUREG §3.4.2-9 forbids separating related controls and
  displays onto facing panels.
- **Using the emergency-stop convention for an ordinary action** — NASA §10.4.2.1.1 reserves large,
  hand- or fist-operated, mushroom-shaped buttons for **"emergency stop" only**.
- **Minimising clicks by packing the screen** — NASA §10.6.5: clutter forces serial search and raises
  error risk, particularly under stress or arousal.
- **Treating display-hardware figures as layout rules** — Rev.4's gamma, pixel pitch, Moiré, and
  luminance-uniformity numbers (§11.3.1.4.1, §11.3.1.4.3) specify the monitor, not the interface. The
  one exception is **≥ 32 pixels per degree of visual angle** (§11.3.1.4.1-1), which genuinely caps
  how fine a UI may be drawn at the design distance.

---

## Connects to

- **Ch 1 (Text size and legibility)** — the same viewing distance that fixes character height fixes
  the target grid; computing one and guessing the other ships correct text in wrongly sized controls.
- **Ch 2 (Spacing and density)** — target separation is the micro case of group separation, and
  NUREG's **≤ 50 %** packing density (§1.1-11) with FAA's **≤ 60 %** text density (§5.6.1.1.3) sets
  the budget that target size and dead space spend.
- **Ch 3 (Contrast and colour)** — groups may be demarcated by colour-coding (MIL-STD §5.2.2.2.6.b;
  NUREG §1.1-16), but colour must never be the only channel, so a colour-coded group still needs the
  blank space or demarcation line this chapter requires.
- **Ch 4 (Reading in motion)** — stationary text (FAA §5.6.2.5.1.12), update-rate and freeze controls
  (MIL-STD §5.2.2.6.4–.8; NUREG §2.5.6-31), and paging-vs-scrolling are the dynamic counterparts of
  this chapter's static layout rules.
- **Ch 5 (Response time)** — direct manipulation requires a response **within 0.25 s** (NUREG
  §2.2.6-5), which decides whether a direct-manipulation target grid is viable; FAA §5.6.14.1.3 also
  caps open windows by **response time**.
- **Ch 7 (User-adjustable parameters and defaults)** — FAA §5.6.14.1.15's initial-placement rule and
  NUREG §2.3.1-5's initial-cursor rule are default *values*; the default-value contract lives there.
- **Ch 8 (Alerts and messages)** — caution and warning windows must be frontmost (NUREG §2.5.6-8) and
  must not be positionable into obscurity (§2.5.6-22); emergency displays belong in the **30° cone**
  (MIL-STD §5.1.2.2.1.h).
- **Ch 9 (Navigation, menus, forms, and data entry)** — the option pointing area (FAA §5.6.7.6.1.7;
  NUREG §2.2.6-11), control-type thresholds, and form field ordering (FAA §5.6.2.11.5.2) are the
  interactive consumers of this chapter's target and flow rules.
- **Ch 10 (Accessibility, consistency, and adapting to the user)** — WCAG §2.5.8, §2.5.5, §2.5.6, and
  §2.5.7 are this chapter's normative accessibility statements; §1.4.10 supplies the reflow floor and
  §1.4.4 guarantees the layout survives the user overriding it.
- `CROSS-SOURCE-REGISTER.md` §5 — the full reconciliation of target-size figures and the basis for the
  mm/px conversions used above. **This chapter adds two reconciliations the register does not yet
  carry:** NUREG-0700 Rev.4 corroborating NASA's **22 mm** ceiling from a second source, and the
  **700 mm vs 635 mm** viewing-distance and **acceptable 10:1 vs 8:1** diagonal-ratio conflicts.