# Cross-source reconciliation register

**Purpose.** Eight public-domain human factors documents are distilled into the skill in
this folder. They were written for different domains —
aircraft cockpits, air traffic control, nuclear control rooms, highway operations, and
the open web — at different times, for different display hardware. They frequently give
**different numbers for the same design question, and sometimes appear to contradict
each other outright.**

A reader who treats every number as equally applicable will produce a worse interface
than one who reads none of them. This register records, for the questions practitioners
actually ask, what each source says, **why the numbers differ**, and which to prefer for
a modern screen.

Three kinds of disagreement are distinguished throughout:

- **Unit disagreement** — same requirement, different measurement basis (arcmin vs mm vs
  pt vs px). Usually resolvable by arithmetic; often not a real conflict at all.
- **Domain disagreement** — the sources genuinely want different things because their
  operators, tasks, or hardware differ. Must be resolved by matching the source's
  context to yours.
- **Internal disagreement** — a single source contradicts itself. Reported as found;
  never silently smoothed over.

---

## 1. Character height — the most-confused quantity in the whole set

This is the most important reconciliation, because it is the first number a developer
reaches for and the easiest to misapply.

| Source | How height is expressed | Value |
|---|---|---|
| FAA HF-STD-001B | minutes of arc (visual angle) | 20–22 min preferred; **16 min** where legibility is important; 10 min minimum; 24 min max for readability; 45 min max for non-contextual groups |
| NUREG-0700 Rev.1 | minutes of arc | **≥16 min** (4.7 mrad), max 24 min (7 mrad); 20–22 min (5.5–6.5 mrad) preferred; ≤45 min (13 mrad) in groups |
| NUREG-0700 Rev.1 §7.5.6-1 | arcmin as a function of distance | **15 min = viewing distance × 0.004** (minimum); **20 min = × 0.006** (preferred) |
| FAA-HF-STD-010A Table 5.6-I | arcmin at expected viewing distance | embedded 10 min; individual glyphs 20 min, 24–35 preferred, 35 max; short strings 16 min (24 min if time-critical); long strings 16 min, 20–22 preferred, 30 max — each with higher values when colour is critical |
| NASA HIDH | arcmin | 5 min of arc acuity floor; optimal reading width 24–42 min |
| MIL-STD-1472G Table XXI | **millimetres at a 710 mm viewing distance** | critical/position-variable 5.0–8.0 mm (low light) or 3.0–5.0 mm (normal); critical/fixed 4.0–8.0 mm or 2.5–5.0 mm; non-critical 2.5–5.0 mm. **For other distances multiply by D/710 mm.** |
| WCAG 2.2 | points / em | no minimum size; "large scale" = **≥18 pt, or 14 pt bold**, ≈1.2 em / 1.5 em for mainstream body fonts |

### Reconciliation

These are **not** seven conflicting answers. Six of the seven are the same answer in
different clothes. Convert MIL-STD's millimetres to visual angle at its stated 710 mm:

```
angle(min) = 2 * atan( (size/2) / distance ) * (180/pi) * 60      # exact
           ≈ size / distance * 3437.75                            # small-angle shortcut
```

- 2.5 mm @ 710 mm ≈ **12.1 min**
- 3.0 mm @ 710 mm ≈ **14.5 min**
- 5.0 mm @ 710 mm ≈ **24.2 min**
- 8.0 mm @ 710 mm ≈ **38.7 min**

So MIL-STD's 2.5–5.0 mm band is ≈12–24 arcmin — landing squarely inside the 16–24 arcmin
band the aviation and nuclear documents specify. **The standards agree; only the
notation differs.**

### The decision rule to carry forward

1. **Express the requirement in visual angle, never in points or pixels.** All the
   authoritative sources do, and it is the only form that survives a change of screen
   size, resolution, or viewing distance. NASA HIDH states this explicitly: specify size
   in degrees, not points, unless the viewing distance is known.
2. **Fix a reference viewing distance, then convert.** `px = distance × tan(angle) × 2 ×
   (ppi factor)` — or, giving the practical form most teams use:

   ```
   required_height_mm = viewing_distance_mm * angle_radians
   required_height_px = required_height_mm / (25.4 / ppi)
   ```

   Worked example — a desktop monitor at 600 mm, 96 ppi, target 20 arcmin:
   20 arcmin = 0.005818 rad; 600 × 0.005818 = **3.49 mm**; at 96 ppi (0.2646 mm/px) that is
   **≈13 px** of cap height. A 13 px glyph is far smaller than most design systems
   default to — which is exactly the kind of error this register exists to prevent.
   (Note the subtlety: arcmin requirements are about **character height**, not font
   size. Font size includes ascender/descender space, so `font-size` must be
   meaningfully larger than the computed cap height.)
3. **Pick the threshold from the task, not from the source's authority.** The spread
   within one source is deliberate: 16 min for text that need only be legible, 20–22 min
   preferred for reading, **24 min when it must be read rapidly**. Copy that logic:
   size to the reading task, not to a single magic number.

### Where WCAG genuinely differs — and why that is correct

WCAG sets **no absolute minimum size at all**. This is not an omission. WCAG is written
for the web, where the viewing distance is unknown, the device is unknown, and the text
may be reflowed, zoomed to 200 %, or restyled by the user. Its answer to "how big should
text be" is therefore **"it must survive being made bigger"** (1.4.4 Resize, 1.4.10
Reflow, 1.4.12 Text Spacing), plus a 18 pt / 14 pt bold threshold only to decide which
contrast ratio applies.

**Practical synthesis:** use the arcmin rules to choose a default size for a *known*
context (a desktop app, a kiosk, a control console), and use WCAG's resizing and reflow
requirements to guarantee the layout does not break when the user overrides it. The two
are complements, not alternatives. A skill that carries only the arcmin numbers will
produce an interface that is correctly sized and completely unadjustable; one that
carries only WCAG will produce one that is adjustable from a bad starting point.

---

## 2. Colour count — the widest apparent disagreement

| Source | Limit stated |
|---|---|
| FAA HF-STD-001B | max **4** colours per alphanumeric screen; **7** across a related screen set; **≤6** when users must recall meanings or search rapidly; 9 for markings |
| MIL-STD-1472G | **≤9** different colours when colour-coding is used |
| NASA HIDH | **≤9** colours including black and white in a coding system; colour search degrades above 9; 11 basic colour terms |
| FAA-HF-STD-010A | mandates **24 max**, and reports that ANSI/HFES-100 and ISO 9241-125 set **5–8** while ANSI/HFES-200 and ISO 9241-303 recommend the **11 focal colour names** |
| NUREG-0700 Rev.1 | **≥40 ΔE (CIE L\*u\*v\*)** between coded colours → about **7–10 simultaneous colours** |
| NUREG-0700 **Rev.4** §1.3.8-1 | "In general, **the number of colors should be limited to six**" — a cap given as a count rather than derived from ΔE, so it does not reconcile with Rev.1's 7–10 by arithmetic |
| NUREG-0700 Rev.4 §1.3.8-7 | restates **≥40 ΔE** → **7–10** simultaneous colours (same figure as Rev.1, new section number) |

**Note the internal tension in the current revision:** Rev.4 gives both a hard count of **six**
(§1.3.8-1) and a ΔE-derived **7–10** (§1.3.8-7). Six is the more conservative and is stated as a
general coding limit; treat **six as the cap for colour that carries meaning**, and the ΔE rule as
the test that your chosen set is actually distinguishable. The two are complements: ΔE tells you
whether colours are *separable*, the count cap tells you how many a person can *use*.

### Reconciliation

This is a **domain disagreement**, and it is real. The limits are not
interchangeable because they are answering two different questions:

- **"How many colours can a person name, remember, and act on without a legend?"**
  → the answers cluster tightly at **4–9**. FAA's 4-per-screen is the most conservative
  because air traffic controllers must identify colours under time pressure with no
  reference. If your users must *interpret* colour, this is the relevant family and **4–7
  is the safe band**.
- **"How many colours can a person distinguish side by side on this display?"**
  → FAA-HF-STD-010A's 24 is a **discrimination** limit backed by measured colour
  difference (ΔE), not a memory limit. 24 colours are separable on a good display; nobody
  can remember what 24 colours mean.

**Decision rule.** Ask which question you are answering:

| If colour is used to… | Then limit to | Because |
|---|---|---|
| convey meaning the user must recall without a key | **4–7** | naming/memory ceiling |
| distinguish adjacent categories on screen with a legend present | **≤9** | rapid-search degradation |
| be merely discriminable (e.g. data series in a chart with a legend) | **≤24**, but verify ΔE | discrimination ceiling |

And in every case, apply the rule that **every one of these sources states and none of
them compromises on**: colour must **never be the only channel**. FAA, MIL-STD, NASA,
NUREG and WCAG 1.4.1 all require redundancy with shape, pattern, text, position, or
luminance. This is the one colour requirement that is genuinely non-negotiable, because
it is the only one that protects colour-vision-deficient users.

**Prevalence, for sizing the risk.** Three figures appear in the set, and they differ because
they describe **different populations** — not because the sources disagree:

| Figure | Population | Source |
|---|---|---|
| **~10 %** | "color-blind individuals" generally | NUREG-0700 Rev.4 §1.1-27, restated §1.3.8-1 |
| **up to 8 % in men** (deuteranomaly ~4.6 %, other L/M cone cases ~1 % each); **<0.5 % in women** | anomalous colour vision, general population | NASA HIDH §5.4.10.6 (Gegenfurtner & Sharpe, 1999) |
| **~0.6 %** | FAA candidates who are colour-vision deficient *after medical screening* | FAA-HF-STD-010A §4.2 |

Reconcile by population, not by which agency sounds more authoritative. The FAA figure is
**two orders of magnitude lower than the general-population rate precisely because it is
post-screening** — ATC candidates are tested with the Air Traffic Color Vision Test and those
with insufficient colour vision are excluded. **That screening is exactly what a general-audience
product does not have.** For anything reachable by the public, the relevant rate is the general
one — Rev.4's ~10 % (which is consistent with NASA's 8 %-in-men once the sex ratio is accounted
for) — so roughly **1 in 10 users**, or about **1 in 12 men**.

MIL-STD-1472G §5.4.6.6 requires colour coding to be distinguishable by both colour-normal and
colour-deficient persons, and Rev.4 §1.1-27 additionally requires avoiding **both red-green and
blue-yellow** comparisons — the tritan axis, which MIL-STD does not name. **Redundancy is not
optional at this prevalence.**

---

## 3. Flash and blink rates — a genuine safety conflict with older practice

| Source | Rule |
|---|---|
| WCAG 2.2 (2.3.1, Level A) | nothing may flash **more than 3 times per second**, or must be below the general/red flash threshold |
| FAA HF-STD-001B | flash **2–5 Hz** with ≥50 % ON interval; 3–5 flashes/sec for indicators; for text 1/3–1 Hz with 70 % on/off |
| MIL-STD-1472G | flash rate 2–5 Hz; alarm flash 3–5 flashes/sec |
| NUREG-0700 Rev.1 | ≤2 flash rates; slow **≥0.8 Hz**, fast **≤5 Hz**, separation **≥2 Hz**; 50 % duty cycle preferred; ≥50 ms on-time; single rate ≈2–3 blinks/s |
| NASA HIDH | alarm flash **3–5 flashes per second**, ~equal on/off, must fail-steady |

### Reconciliation

**These do conflict, and WCAG should usually win.**

The older human factors standards were written when a blinking indicator was the primary
way to draw an operator's attention in a control room. They recommend 3–5 Hz because that
range is highly salient. WCAG caps at 3 Hz because flashing in the 3–50 Hz band can
trigger photosensitive epileptic seizures, and it cannot know whether any given viewer is
susceptible.

Resolve by context:

- **Any interface reachable by the general public, or by an unknown population** → follow
  WCAG. ≤3 flashes/second, hard. Add a `prefers-reduced-motion` path.
- **A closed, medically-screened operator population** (the domain these standards were
  written for) → 3–5 Hz remains defensible, and the MIL-STD/NUREG requirements to
  **fail-steady** and to keep on/off intervals roughly equal become mandatory.
- **In all cases** → the flash is an *attention* cue only; the information it carries must
  also be present statically. NUREG and NASA both require the alarm to remain identifiable
  when the flash fails or is suppressed.

A design that flashes at 5 Hz for a public-facing web dashboard is not "following the
human factors literature" — it is misapplying a control-room rule to a population that
was never screened, and it is an accessibility defect.

---

## 4. Response time — same shape, different thresholds

Every source gives a latency budget, and they agree on the *structure* (fast for direct
manipulation, slower for retrieval, with a progress indicator past a couple of seconds)
while differing on exact values.

| Action | NASA HIDH Table 10.8-1 | MIL-STD-1472G Table V | NUREG-0700 Rev.1 Table 2.4 |
|---|---|---|---|
| discrete input / key response | 0.1 s | 0.1 s | 0.10 s (desirable <0.10) |
| key print | — | 0.2 s | — |
| pointer / XY entry | — | 0.2 s | 1.0 s (light pen) |
| menu appears on selection | 0.5 s | — | — |
| data on request / simple inquiry | 1.0 s | 2.0 s | 2.0 s (desirable <0.25) |
| page turn | — | 1.0 s | 0.5–1.0 s (desirable <0.25) |
| local update | — | 0.5 s | — |
| updated data / state change | 1.0 s | — | — |
| complex inquiry | — | 10.0 s | 5.0 s (desirable <2.0) |
| error feedback | 2.0 s | 0.2 s | 2.0 s (desirable <0.25) |
| file update | — | 10.0 s | — |
| loading | — | — | 15–60 s (desirable <6.0) |
| direct manipulation | — | — | **≤0.25 s** |

### A second, stricter tier: display-hardware latency

The tables above are **application** budgets. NUREG-0700 Rev.4 §11.3.1.4.2 and §11.3.2.3.6 add a
separate **hardware** tier, an order of magnitude tighter, which matters as soon as you are
specifying an animation, a drag interaction, or a touch surface:

| Quantity | Value | Citation |
|---|---|---|
| Display/monitor response time — time for luminance to pass through **90 %** of an intended instantaneous change | **≤55 ms**, and **less than the duration of a single frame**; **≤13 ms at 75 frames/s** | Rev.4 §11.3.1.4.2-1 |
| Moving-edge blur (blur edge time / Gaussian edge time) | **≤15 ms** | Rev.4 §11.3.1.4.2-4 |
| Touch-screen display response (latency) | **≤100 ms, preferably 55 ms** | Rev.4 §11.3.2.3.6-7 |
| Touch repeat-function initial delay | **500–750 ms**, and the fact that a repeat has been initiated must be shown | Rev.4 §11.3.2.3.6-9 |
| Touch select-and-drag tracking | the moved object should **track the finger, both temporally and spatially** | Rev.4 §11.3.2.3.6-5 |

**A genuine cross-source convergence worth noting:** Rev.4's **55 ms / 13 ms at 75 frames/s**
pair independently matches NASA HIDH's Table 10.3-6 (which cites HFES 2006 and TCO-06). Two
documents from different agencies, derived from different display literatures, land on the same
figures — which is the strongest evidence in this collection that those numbers are real
constraints rather than one author's preference.

**How to use the two tiers.** The application budgets (0.1 s input, 1 s data, 2 s complex)
govern *when you must show what you are doing*. The hardware tier governs *whether the
interaction itself feels attached to the pointer or finger*. A 100 ms application response on a
panel with 55 ms latency is imperceptible; the same application response on a panel with 200 ms
latency will feel broken no matter how good the software is. **When a latency complaint has no
software explanation, measure the display.**

### Reconciliation

Two things matter more than the exact numbers:

1. **There are two columns, not one.** Every table has a *maximum acceptable* and a
   *desirable*. The maximum is the point past which the operator's task degrades; the
   desirable is the point past which the interaction feels immediate. Design to the
   desirable column and treat the maximum as a defect threshold.
2. **Consistency is itself a requirement.** FAA HF-STD-001B requires response-time
   variability within **5 %** in the 0–2 s range, **10 %** at 2–5 s, and **15 %** beyond
   5 s; NUREG requires variability within ±half the mean. A system that answers in 0.2 s
   sometimes and 1.8 s other times is worse than one that always answers in 1.0 s,
   because the user cannot build a model of it. **This is the most commonly ignored rule
   in the entire set** and the easiest to violate accidentally with an inconsistent cache
   or a variable-cost query.

Also note the **progress-indicator thresholds**. These are **not** one scale — the sources give a
sequence of distinct signals, and conflating them is a common error (an earlier draft of this
register did exactly that: it attributed FAA's 15 s figure to a countdown, when 15 s is FAA's
*informing* threshold and its countdown figure is 60 s):

| Signal | Threshold | Source |
|---|---|---|
| Acknowledge the input (unconditional) | immediate | NUREG-0700 Rev.1 §2.1-13; FAA HF-STD-001B §5.6.15.5.1.4 |
| Declare that **processing** is happening | **1.0 s** (MIL-STD); 2 s is the outer bound (FAA, NASA) | MIL-STD-1472G Table V; FAA §5.6.15.7; NASA HIDH Table 10.8-1 |
| **Inform** the user the delay is long | **>15 s** | FAA HF-STD-001B §5.6.15.7.8 |
| **Countdown** showing time remaining | **>60 s** (FAA); 10 s (MIL-STD) | FAA HF-STD-001B §5.6.15.7.9; MIL-STD-1472G Table V |
| Completion signal | beyond that | both |

So the real conflict is **10 s vs 60 s for the countdown**, resolvable by what the countdown can
honestly display: at 10 s you have elapsed/progress information, and only at ~60 s can you offer a
genuine remaining-time estimate. The specific numbers matter less than the rule that **a delay
with no feedback is read as a failure**, and that acknowledgement, processing declaration,
informing, and countdown are four different promises made at four different times.

Two further corrections to this section, both surfaced by the response-time chapter:

- **Error feedback.** The table above omits FAA, and FAA is the outlier: §5.6.15.10.1.17 permits
  **2–4 s**, roughly 20× looser than MIL-STD's **0.2 s** and NUREG's **2.0 s maximum / <0.25 s
  preferred**. Treat FAA's band as a permitted outer limit, not a target; design to
  **0.2–0.25 s**.
- **Pointer response.** NUREG's **1.0 s** entry is a *light-pen* figure, and its 0.5 s is a
  *motion-rate* figure rather than end-to-end latency. Three of the four sources state **100 ms**
  (FAA <100 ms; MIL-STD 0.1 s for joystick/touch; NASA <100 ms in its definition of "real time").
  **Use 100 ms** and read NUREG's row as a different quantity.

---

## 5. Touch and pointing targets — six figures, three different jobs

| Source | Target size | Separation |
|---|---|---|
| NASA HIDH Fig. 10.4-18 | **min 9.5 mm (0.4 in)**; ineffective beyond **22 mm (0.9 in)** | dead space **min 3.2 mm (0.1 in)** |
| MIL-STD-1472G Fig. 3 | **min 15 × 15 mm (0.6 in)**, max 38 × 38 mm; keyboards preferred 13 × 13 mm; **+5.0 mm with gloves** | **min 3.0 mm**, max 6.0 mm; first-contact 5.0 mm |
| NUREG-0700 Rev.1 | selectable screen items **≥5 mm per side** | **≥3 mm**; touch zones 15–40 mm with 3–6 mm gaps |
| NUREG-0700 **Rev.4** §11.3.2.3.6-2 (current) | touch response areas **10–40 mm**, **optimum ~22 mm**; scoped to large/medium screens | **3–6 mm** |
| WCAG 2.2 (2.5.8, AA) | **24 × 24 CSS px** minimum | 24 px-diameter circles must not intersect |
| WCAG 2.2 (2.5.5, AAA) | **44 × 44 CSS px** | — |

### Reconciliation

The apparent 5 mm ↔ 44 px gap is again mostly **unit disagreement plus a different
threat model**:

- 24 CSS px at the CSS reference of 96 ppi = 6.35 mm; 44 CSS px = **11.6 mm**. So WCAG's
  AA minimum (6.35 mm) is *less* demanding than NASA's 9.5 mm, while its AAA level
  (11.6 mm) sits between NASA's minimum and MIL-STD's 15 mm.
- The **mil-spec numbers assume gloved hands, vibration, and a moving platform** — MIL-STD
  explicitly adds 5 mm for gloves and NASA's figures come from spacecraft. That is why
  they are the largest. If your users are on a phone, on a bus, or wearing gloves
  (industrial, medical, outdoor), the larger figures are the right ones.
- WCAG's numbers assume a mouse or a stylus on a general-purpose device, and its
  **spacing exception** is the subtle part: an undersized target still conforms if a
  24 px circle centred on it does not intersect another target's circle. That means
  **the accessible target is the hit area, not the visible glyph** — you can draw a 16 px
  icon and conform by giving it 24 px of isolated hit area.

**Decision rule:** pick by input modality and environment, not by picking the number that
looks most authoritative. Then remember NASA's **upper** bound: targets beyond ~22 mm do
not improve accuracy, they just waste space — so "bigger is safer" is false past a point.

### The current revision corroborates the ergonomics figures, not the web figures

NUREG-0700 **Rev.4** §11.3.2.3.6-2 supplies an independent check that settles the shape of this
whole disagreement. It gives touch response areas of **10–40 mm** with **3–6 mm** separation and
an **optimum around 22 mm** — scoped explicitly to **large and medium screen sizes**, and
accounting for "finger size and parallax inaccuracy":

- Its **22 mm ceiling independently reproduces NASA's 22 mm** result from a different agency,
  different decade, and different display literature. That is the strongest evidence in this
  collection that the ceiling is a real perceptual limit rather than a spacecraft artefact.
- Its **10 mm floor** sits a half-millimetre above NASA's 9.5 mm and well above WCAG AA's
  **6.35 mm** equivalent (24 CSS px at 96 ppi).
- Its **3–6 mm separation** matches MIL-STD's band exactly.

**Three further sub-conflicts, resolved:**

| Question | Positions | Resolution |
|---|---|---|
| **Touch-area minimum: did it change?** | Rev.1 §3.2.4-10 gave **15–40 mm**; Rev.4 §11.3.2.3.6-2 gives **10–40 mm** | The floor moved down; the 40 mm ceiling and 3–6 mm separation did not. **Prefer Rev.4 as current, but read its 10 mm as the band edge, not the target** — the same section gives ~22 mm as the optimum |
| **Viewing distance where controls must also be reached** | MIL-STD-1472G §5.2.3.1.a: **700 mm** (28 in); FAA HF-STD-001B §5.3.1.4.13: **635 mm** (25 in) | **Use 635 mm whenever the user must touch what they are looking at.** FAA's figure is anthropometrically derived — it is set so a 5th-percentile female can reach the controls — which is a *reach* constraint, while MIL-STD's is a *display-distance* limit |
| **Acceptable viewing-distance : screen-diagonal limit** | MIL-STD **10:1**; FAA **8:1**; preferred band identical at **3:1–6:1, optimum 4:1** | **Design to 3:1–6:1; treat 8:1 as the outer limit.** The two maxima differ because they bound different failure modes, but the preferred band is where both sources agree |

**And one hardware boundary, stated to prevent a category error:** Rev.4's Section 11.3.1.4
contains a dense set of display figures — pixel pitch **≤0.3 mm**, gamma **1.8–2.2**, **≥256**
grey levels, luminance **≥35 cd/m²** with **80–160** preferred, uniformity **≤50 %**, jitter
**≤0.0002 × distance**. These are **panel specifications, not layout rules** — a software team
cannot satisfy them from application code. The one figure in that section that *is* a design
constraint is **≥32 pixels per degree** (§11.3.1.4.1-1), because it is the geometric counterpart
of Ch 1's arcmin rules: it caps how finely a UI may be drawn at a given viewing distance.
Treating panel specs as layout guidance is a real anti-pattern.

---

## 6. User-adjustable parameters and defaults — where the richest material is

The question "what should the default be, and how much adjustment should be allowed" is
answered far more concretely by the government standards than by the web guidance.

| Source | Contribution |
|---|---|
| **MIL-STD-1472G §5.2.2.4.5** | the core default-value contract — see below |
| MIL-STD-1472G §5.2.1.3.1 | luminance adjustability range **not less than 50:1** |
| MIL-STD-1472G §5.1.2.1.6 | illumination continuously adjustable **or ≥30 increments** from full bright to full off |
| MIL-STD-1472G Table XXIII | **when** adjustment must be continuous vs may be fixed, by condition of use |
| MIL-STD-1472G §5.2.2.6.4 | the update rate **shall be controllable by the user** |
| MIL-STD-1472G §5.2.2.6.5–.8 | display freeze mode, resume-from-freeze with a single action, feedback label, and a prohibition on freezing when it would harm the mission |
| FAA HF-STD-001B §5.6.14.1.5–.15 | window default size, default location, and initial placement rules |
| NASA HIDH §10.4.2.3.7 | key repeat **must be adjustable** (500 ms hold → ~10 chars/s) |
| NASA HIDH §8.7.5.2 | dimming must be **continuous and logarithmic** (Weber's Law), with clockwise/up/right = brighter |
| NUREG-0700 Rev.1 | cursor rate aiding **default OFF**; controller tracking speed **moderate default**; inter-click interval **moderate default**; key-repeat delay **default 0.5 s**, rate **default 0.1 s**; text cursor blink **default 3 Hz** |
| NUREG-0700 Rev.1 §2.2.6-9 | double-click interval **700 ms** |
| WCAG 2.2 (2.2.1) | a user-adjustable time limit must have a range **≥10 × the default**, and extension **≥20 s** granted **≥10 times** |

**One genuine disagreement inside this topic — is font size user-adjustable?**

- **FAA HF-STD-001B §5.6.2.5.7.1**: *"When an application cannot satisfy the range of viewing
  requirements with a single text font, the application should provide text font size as a
  user-selectable option."* — i.e. font size **should** be user-selectable, but only when one
  size cannot serve all the viewing conditions.
- **MIL-STD-1472G**: contains **no** user-adjustable font size rule. Character height is
  specified as a **fixed function of viewing distance** (Table XXI), on the reasoning that if
  the display is positioned correctly there is exactly one correct size.
- **WCAG 2.2 (1.4.4, AA)**: text must be resizable **up to 200 %** without loss of content or
  functionality — so on the web, adjustability is mandatory, though the *mechanism* may be the
  browser rather than the page.

**Resolution.** This is a **domain disagreement**, and the two positions are both correct for
their contexts. MIL-STD's view holds when the viewing distance is fixed and controlled (a
console, a kiosk, a cockpit) — there, a single correct size *is* computable, and offering
adjustment invites the user to set it wrong. FAA's view holds as soon as viewing conditions
vary, which is the normal case for software: different monitors, window positions, and users.
WCAG then removes the choice entirely for general-purpose content.

**For a modern application, follow FAA + WCAG: make text size adjustable**, because you
cannot control the viewing distance. But take MIL-STD's underlying point seriously when
choosing the **default** — the default should be the size that is correct for the expected
viewing distance, computed from the arcmin rules in section 1, and adjustment should be an
escape hatch rather than the primary mechanism for getting legibility right.

### MIL-STD §5.2.2.4.5 in full — the clearest statement of default-value design

This section is worth quoting because it is the most complete normative answer in the set
to "how should defaults behave":

- **(a)** default values **shall** be used, *to reduce user workload*;
- **(b)** currently defined defaults **shall be displayed automatically** in their fields at
  the initiation of a data-entry transaction;
- **(c)** the user **shall** indicate acceptance of the default by a **single keystroke**;
- **(d)** the user **shall** be able to replace any default during a transaction
  **without changing the default definition**;
- **(e)** if the designer cannot predefine a good value, the user **shall** have the option
  of generating defaults **from operational experience**;
- **(f)** in a sequence, the experienced user **shall** be allowed to default **all entries**
  or default **up to the next required entry**.

### Reconciliation and the rules worth carrying into a modern UI

The web guidance (WCAG) is silent on default *values* — it governs only that adjustment
must be *possible* and non-breaking. So for defaults, the standards are the only source,
and they produce a coherent model:

1. **A default is a workload-reduction device, not a neutral placeholder.** (MIL-STD a)
   If a field's default is arbitrary, it is not serving its purpose.
2. **Accepting a default must be one action — the cheapest possible.** (MIL-STD c)
   This is why "Enter to accept" and pre-filled forms outperform empty forms.
3. **Editing a value must not change the default.** (MIL-STD d) Separate the *instance*
   from the *template*. This is the rule most often violated by persistence logic that
   silently writes the user's last input back as the new default.
4. **Where the default sits should reflect the most likely intent, and the *dangerous*
   option must never be the default.** FAA HF-STD-001B requires the default button to be
   leftmost/topmost with only one default, the initial cursor to be on the default option,
   and **destructive actions never to be the default**; NUREG requires the default for a
   destructive print option to be **NO**.
5. **Adjustment range should be generous, and log-scaled for perceptual quantities.**
   MIL-STD's 50:1 luminance range, NASA's logarithmic dimming law, and WCAG's 10×
   time-limit multiplier are three instances of the same principle: the range must cover
   the operational envelope, and for brightness/volume it should be perceptually uniform,
   not linear.
6. **Some things must NOT be user-adjustable.** NUREG requires alarm loudness to be
   non-adjustable; NASA requires caution and warning levels to be non-adjustable while
   voice-comms volume is adjustable (5–100 % floor); FAA requires status and coding colours
   to be locked from users and assigned at installation. **Safety-critical signals are not
   user preferences.**
7. **Defaults must be restorable.** FAA requires an easy return to the default colour
   scheme, zoom, and icon locations, and that defaults be restored at end of session.

---

## 7. Screen density and line length — a small but real conflict

| Source | Rule |
|---|---|
| NUREG-0700 Rev.1 §1.1-11 | packing density **≤50 %**; alphanumeric displays **≤25 %** |
| NUREG-0700 Rev.1 §1.3.10-2 | highlighting budget **≤10 %** of displayed information |
| FAA HF-STD-001B | screen density **≤60 %** |
| WCAG 2.2 (1.4.8, AAA) | line width **≤80 characters (40 for CJK)** |
| NUREG-0700 Rev.1 | line length **≥50 characters** (50–80 equivalent reading time) |
| NUREG-0700 Rev.1 | default text-window width **50–80 chars** (52–78 fastest) |
| FAA HF-STD-001B | three spaces between table columns; blank line every fifth row; **≤2 fonts per screen** |

### Reconciliation

Not contradictory — **different quantities**. "Density ≤50 %" is *proportion of the
character cell grid actually filled by ink*, a legibility constraint. "≤80 characters per
line" is a *measure* constraint governing where the eye must travel to find the next line.

The two rules interact usefully: a 50 % density cap forces whitespace between glyphs, and
a 50–80 character measure keeps line-tracking errors down. Together they are the numeric
core of "why dense dashboards are hard to read". The 10 % highlighting cap is the one
most worth reviving — attention highlighting loses all meaning when a third of the screen
is highlighted.

### Two sub-conflicts here worth naming, because both are easy to get backwards

**The character-spacing basis changed between revisions.** NUREG-0700 **Rev.1 §1.3.1-7**
measures the inter-character gap against character **width** (10–65 %); **Rev.4**, on the same
guideline number, measures it against character **height** (25–60 %, floor 25 % under degraded
conditions). Those are physically different gaps — at a permitted height:width ratio of 1:0.7,
25 % of height is a larger gap than 25 % of width. **Prefer Rev.4**, and note the failure mode:
copying "25 %" out of a secondary summary without knowing which basis it came from can produce
either crowding or excessive tracking.

**The line-spacing figures split into two families that are not in conflict once scoped.**
Screen rules give **≥2 stroke widths or 15 % of character height**; label rules give **one-half
character height**. The difference is what is being measured — a *gap in addition to* the glyph
versus *total label leading* — and the larger label figure exists because labels are read as
discrete units rather than as continuous text. Do not average them.

**One Rev.4 rule contradicts the ≥50-character floor and is correct to do so.** For text
"meant to be **scanned while it is scrolled**", the column width should be **35 characters or
fewer** (Rev.4 §2.5.1.3-7) — below NUREG's own ≥50 minimum for continuous reading. This is not
an inconsistency: the task differs. Continuous prose needs a long enough measure to establish
rhythm; text scanned *while it moves* needs a short one so the eye can re-acquire each line.
**Apply the ≤35 rule only to that task**, not as licence for narrow columns generally.

**Justification and hyphenation are three-way splits.** On justification: WCAG 1.4.8 (AAA)
requires that text **not** be justified; NUREG Rev.4 §1.2.1-15 states that "full justification
slows reading time"; FAA §5.13.3.3.4.1 permits left- or full-justification for **print** while
§5.6.2.4.3.7 offers it as a **screen option**. On hyphenation: FAA's default is **no
hyphenation**; NUREG permits minimal hyphenation with words left intact; MIL-STD **requires**
hyphenation on small screens. **Resolution:** ragged-right and no-hyphenation are the safe
defaults for screen text; the permissive positions are for print or for genuinely constrained
displays, and neither should be generalised to a normal reading view.

---

## 8. Where a source contradicts itself (reported, not resolved)

| Source | Contradiction |
|---|---|
| MIL-STD-1472G §5.2.1.2.3 | "Display faces shall be perpendicular to the user's normal line of sight" immediately followed by "Display faces shall be not less than 45 degrees from the normal line of sight." Both are quoted verbatim in the mined file. **Prefer the ergonomics sources (FAA, NASA) for display tilt.** |
| MIL-STD-1472G §5.2.2.5.3.a(1) | Motion rate printed as "60 degrees (1.05 radians) (20 degrees (0.35 radians) preferred)" — the parenthetical is malformed in the source text. Preserved as-is. |
| FAA-HF-STD-001B | Two typography clusters give stroke width as **1/12–1/6** in one place and **10–12.5 %** in another; character spacing as **one stroke width** in one and **10 % of character height** in another. A merge must surface this, not silently pick one. |
| NUREG-0700 Rev.1 | OCR text layer contains word-level artefacts (`nunimuns` for "minimum", `altematives` for "alternatives", `cunently` for "currently"). Sampled inspection found **numbers intact** and damage confined to prose. The cross-check against Rev.4 has since been performed (see §9) and the overlapping figures agree, so Rev.1 is usable — but prefer Rev.4 for anything a reader will act on. |
| **NUREG-0700 Rev.1 vs Rev.4 — contrast floor** | Rev.1 §1.5.1-2 states **>3:1 minimum, 7:1 preferred**; Rev.4 §11.3.1.4.1-2 raises it to **≥6:1 minimum, 10:1 preferred** — stricter than WCAG's 4.5:1 and identical to MIL-STD §5.2.1.5.1. **Prefer Rev.4 where the display and room are known.** |
| **NUREG-0700 Rev.1 vs Rev.4 — luminance floor** | Rev.1 §1.5.1-7 gives **≥35 cd/m²** hard plus an **80–160 cd/m²** preferred range. Rev.4 keeps both but inserts a **second, higher** preferred minimum of **100 cd/m²** (§11.3.1.4.3-1). A display at 85 cd/m² passes Rev.1's preferred range and Rev.4's hard floor but misses Rev.4's preferred minimum. **Design to 100 cd/m².** |
| **NUREG-0700 Rev.1 vs Rev.4 — colour count** | Rev.1 gives no count, deriving **7–10** from the ΔE rule (§1.3.8-9); Rev.4 additionally states a hard cap of **six** (§1.3.8-1). See §2 above for the reconciliation. |
| **NUREG-0700 Rev.1 vs Rev.4 — response-time display timing** | Rev.1 §2.4.7-2 requires the average response time to be shown *"at time of use"*; Rev.4 §2.4.3-3 requires it *"at the time of logon"*. **Prefer Rev.4** — it reflects a UI where the user sees the figure once and forms an expectation, which is also the behaviour the consistency rule in §4 depends on. |
| NUREG-0700 Rev.4 §4.5.6.3-14 vs §1.3.11-27 | Tone-code count: §4.5.6.3-14 allows **≤3** frequencies ("operators may not reliably distinguish among more than three pitch codes"), §1.3.11-27 allows **≤4**. The same section supplies its own tie-breaker — "for critical alarms… the more conservative guidance should be followed" — so **prescribe 3 pitch codes and add a second coding dimension** rather than relying on a fourth tone. |
| NUREG-0700 Rev.4 (display hardware) | Trackball resistance states a "preferred" value **below** its own stated minimum; keyboard thickness gives two conflicting maxima joined by "to"; standup display height reads "178 m", evidently a typo for 178 cm. All three are recorded as defects in the mined file rather than silently corrected. |
| NUREG-0700 Rev.4 §12.2.1.1.2-3 vs §1.3.1-4 | The distance table's **minimum** column is built from `distance × 0.004`, which the source labels "15 minutes of arc" — but 15 arcmin is **0.004363 rad**, so the multiplier actually encodes **13.75 arcmin** (verified: every minimum row in the table resolves to ≈13.7 arcmin at its stated distance). The **preferred** column's `× 0.006` encodes **20.63 arcmin**, labelled "20 minutes", a +3.1 % rounding in the safe direction. So the table's minimum column sits ~8 % below its own label and **below §1.3.1-4's 16 arcmin floor**. **Trust the preferred column (≈20.6 arcmin); do not use the table's minimum column as a floor** — use `distance × 0.00463` for a true 16 arcmin. This is a labelling defect, not an arithmetic one: the multipliers and the table agree with each other. |

## 8b. Alerting conflicts found during chapter writing

These surfaced when the alerting chapter was written, and are recorded so a later reader does
not have to rediscover them.

| Question | Positions | Resolution |
|---|---|---|
| **Non-emergency alarm loudness ceiling** | FAA §5.5.2.8.5 caps non-emergency signals at **90 dB(A)**; NUREG Rev.1 §4.5.6.3-9 permits **95 dB(A)** generally (115 dB(A) only for extreme danger) | Take the **lower ceiling for the lower severity**: ≤90 dB(A) non-emergency, ≤115 dB(A) only for extreme danger |
| **Alarm "bright state" magnitude** | NUREG Rev.1 §4.5.6.2-5: VDU bright state "at least **100 % brighter**"; §4.5.6.2-4 caps transilluminated tiles at "no more than **300 % brighter**"; NASA HIDH §10.9.2.5.1: alert indicators "at least **three times brighter**" | For an emissive screen: target **≥2 × the inactivated luminance**, use **only two brightness levels**, kept **≥2:1 apart** (MIL-STD-1472G §5.2.2.3.3.b). The 300 % figure belongs to backlit tiles, not screens |
| **Flashing text rate and duty cycle** | FAA §7: **1/3–1 Hz at ~70 % on**; MIL-STD-1472G §5.7.3.2.4.b: flashing cautions **≤2.0 Hz at ~70 % on** | Take the **slower** (FAA's). Both clear the WCAG ≤3/s cap, so this is a legibility difference, not a safety conflict |
| **Flashing caution: colour and intensity** | MIL-STD-1472G §5.7.3.2.4.b: caution signals are **yellow**, and when used alongside warnings must be **not more than half the intensity** of the warning signal | Apply as stated. This is a *hierarchy-preservation* rule: a caution must never out-shout a warning |
| **Auditory alarm SNR** | Five figures across the set: **10 dB(A) above ambient** (FAA; NUREG **Rev.1** §4.5.6.3-9) vs NUREG **Rev.4** §4.2.6.3-9's **two-point curve — 10 dB in quiet areas (below 45 dBA), 20 dB in noisy areas**; **13 dB** above masked threshold in ≥1 one-third-octave band (NASA, per ISO 7731:2003); **15 dB(A)** commonly cited (NASA); **≥20 dB** below foreground for background audio (WCAG 1.4.7) | **Do not average, and do not use a flat 10 dB.** Use the **two-point curve** (10 dB quiet / 20 dB noisy) as the broadband requirement — a flat 10 dB under-alerts precisely where masking is worst, which is the noisy case. Layer the **13 dB above masked threshold in one one-third-octave band** on top as the safety-relevant target, because NASA §10.9.2.3 shows a broadband SNR figure hides masking by a co-located ambient tone. MIL-STD-1472G §5.3.1.2.4.a uses the **same 45 dBA quiet-area threshold** (though it states *absolute* levels, 50–70 dBA, rather than a dB-above-ambient curve), so the quiet/noisy distinction is corroborated even though the metric differs |
| **Tone-burst inter-pulse interval** | NUREG Rev.1 §4.5.6.3-19: **.15 to 3 seconds**; NUREG Rev.4 §4.2.6.3-19: **.15 to .3 seconds** — an order of magnitude apart | **Report both; do not merge.** Both agree on the rest of the pattern (≥5 pulses of ~0.1 s). Rev.4 is current, so prefer **.15–.3 s**, but note the older range existed and treat the narrower band as the tighter constraint |
| **300 % tile-luminance reference point** | NUREG Rev.1 §4.5.6.2-4 measures the brightest state against the tile's **own inactivated state**; Rev.4 §4.2.6.2-4 measures it against the **surrounding luminance** | **Different quantities, not a contradiction.** Both are reported; for software the VDU rule governs and the 300 % figure is a backlit-tile hardware concern |
| **Brightness-level count by display type** | NUREG Rev.4 §4.2.6.2-5 limits a **VDU to two** brightness levels; §4.2.6.2-4 permits transilluminated tiles **no more than three**. Rev.1 gave no tile count | **A VDU (i.e. software) follows the two-level rule.** The three-level allowance is for backlit physical tiles |
| **Auditory ceiling hard-stop** | NUREG Rev.4 §4.2.6.3-9 adds *"signal levels above 115 dBA should not be used"* on top of the existing 95 / 115 dB(A) pair | **Treat 115 dB(A) as an absolute ceiling**, not merely the top of a permitted band. 95 dB(A) remains the normal limit; 115 dB(A) is permitted only for extreme danger that requires attention-getting reliability |
| **Alarm-reduction degree** | NUREG Rev.4 states **no numeric target**, and says so explicitly ("no specific guidance on the degree of alarm reduction required") | **Recorded as an absence, not filled in.** Any figure quoted for "how much to reduce alarms" comes from elsewhere |

---

## 9. Quality notes on the evidence base

Recorded so a later reader does not over-trust the extraction chain:

- **NUREG-0700 Rev.1 is a scanned document** (300 ppi page images with an OCR text layer,
  no embedded fonts). Every other source in the set is natively typeset digital text.
  Rev.4 is digital and was preferred wherever the two overlap.
- **Rev.4 is now mined, so the cross-check has been performed.** Where this register once said
  "cross-check against Rev.4 before relying on a Rev.1 figure", that check has been done for the
  overlapping sections, and the results are recorded in the relevant sections above. The
  headline outcome: **most figures are unchanged between revisions** (the 1/s and 2–5/s
  update-rate ceilings, the 3–5/s alarm flash range, ≤50 alarms per matrix, the blank-row
  interval, the 100 %-bright-state rule, and the 40 ΔE colour-difference rule are all
  restatements rather than changes). Rev.4 **does** change: the contrast floor (**3:1/7:1 →
  6:1/10:1**), the luminance preferred minimum (**+100 cd/m²**), the colour-count cap (**+six**),
  the touch-zone floor (**15 mm → 10 mm**), the alarm level above ambient (**flat 10 dB → 10/20 dB
  by quiet/noisy**), the tone-burst interval (**.15–3 s → .15–.3 s**), and a **115 dBA absolute
  ceiling**. It also adds a whole class of rules Rev.1 lacked, most importantly **what must NOT
  be user-adjustable** and the **alert state model** (new / acknowledged / cleared, with
  ringback). A Rev.1-only figure that Rev.4 dropped remains valid only as historical context.
- **Some numeric values live only in figures** and are therefore absent from a
  text-only extraction. NASA HIDH's Figure 10.3-16 (character height standards in minutes
  of arc) and Figure 10.5-1 (minimum control spacing) are the most valuable of these, and
  MIL-STD-1472G Table 5.7.4.2.4 (touch panel responsive area) is another. Reading the
  original page images would recover them.
- **Figure-only and OCR-damaged values were omitted rather than guessed** throughout the
  mined files, and each omission is recorded in that file's own gaps section. Where a
  value was ambiguous, the ambiguity was preserved in the text instead of being resolved
  by inference.
- **Everything here is a US Government work (public domain) or an openly licensed
  standard.** No copyrighted textbook was used, and no target of this work should be
  redistributed from a shadow library.
