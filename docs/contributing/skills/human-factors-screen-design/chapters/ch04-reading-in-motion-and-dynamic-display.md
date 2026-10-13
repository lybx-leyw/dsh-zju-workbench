# Chapter 4 — Reading in motion, movement, and dynamic display

**Core idea.** "Movement speed" has two different answers here, and conflating them is the central
error. For **changing values** — numbers, statuses, telemetry — the answer is a hard, converged,
numeric rule: **no faster than once per second if the user must read it, and 2–5 updates per second
only if the user is watching rate of change or gross magnitude**. For **moving text** — marquee,
ticker, crawl, auto-scroll — the answer is **not a speed at all**: every source either forbids the
movement outright or substitutes a *pausability* requirement. Nowhere in these eight documents does a
characters-per-second or words-per-minute crawl rate exist.

---

## 1. Update-rate ceilings for readable data

Three sources state the same two thresholds; NUREG-0700 Rev.4 restates them unchanged. Treat them as
one converged requirement.

| Content class | Ceiling | Source |
|---|---|---|
| Values the user must **reliably read** | **not more often than once per second** | MIL-STD-1472G §5.2.2.6.1.a; FAA HF-STD-001B §5.6.5.1.3; NUREG Rev.1 §1.4-1, §1.4-3, §2.5.3-2; **Rev.4 §1.4-3, §2.5.4-2** |
| Values used to identify **rate of change** or read **gross values** | **not faster than 5/s, not slower than 2/s** | MIL-STD §5.2.2.6.1.b; FAA §5.6.5.1.1; NUREG Rev.1 §1.4-3; **Rev.4 §1.4-3** |
| Numerals read consecutively (e.g. a counter) | **no faster than one per second** | NUREG Rev.1 §1.5.7-4 |
| Data items generally; max rate; position; overwrite | displayed long enough to "read them reliably and accurately"; the rate must not exceed the ability to perceive **and act on** the information; max rate = time the user needs to identify and process the change; changing values that must be read sit in a **fixed position**; erase old items **before** adding new ones | FAA §5.6.5.1.2, §5.6.3.2.2.16; NASA HIDH §10.12.5.1; NUREG Rev.1 §1.4-1, §2.5.3-2, §1.4-4; FAA §5.6.5.1.6 |
| User control, **with a bound** | the rate of update **shall be controllable by the user**; users select which categories update automatically, and the frequency/rate; temporary stop/resume | MIL-STD §5.2.2.6.4; FAA §5.6.5.1.4, §5.6.5.1.5; NUREG Rev.1 §1.4-2, §2.5.3-1; **Rev.4 §1.4-2** |

Three things are load-bearing. **(a)** The 2–5/s band is two-sided — a *range*, not a maximum: below
2/s a rate-of-change display stops reading as motion, above 5/s it changes faster than a person can
integrate. **(b)** The classes are not interchangeable — using 2–5/s for a value the user must *read* is
a defect, not an optimisation, because the readable ceiling is stricter even though its number is
lower. **(c)** The escape valve is explicit and Rev.4 keeps it: faster rates are acceptable where users
*monitor general trends* and need no exact readings (Rev.1 §2.5.3-2; Rev.4 §2.5.4-2). Rev.4 marks the
1/s and 2–5/s figures explicitly as a **design maximum and design window, not a user setting** — and
Rev.4 §1.4-2 bounds the *user-controlled* rate to what the source and pipeline can actually deliver.
**The user may slow the system down; they may not ask it to deliver faster than the source and
processing equipment can support**, so a rate slider must be bounded by the achievable rate, not just
by a design maximum.

**Update rate is not refresh rate.** MIL-STD's "update rate" (§5.2.2.6.2) is how often the *information*
changes; its "refresh rate" (§5.2.2.6.3) is how often a refreshed display is re-rendered, set by task
analysis, with **no numeric value given for flat panels** — MIL-STD's own gaps section records that its
only numeric refresh figure is **≥60 Hz for head-mounted virtual-environment displays** (§5.12.1.4.2).
Never satisfy an update-rate requirement by changing a render loop. **Long-duration watch:** NUREG
Rev.1 §1.1-31 — for slowly changing data, fixation for **1 to 10 minutes** may delay reaction to an
updated stimulus, so a compliant rate can still be missed.

### 1.1 User control of temporal scale — the sanctioned "movement speed" answer

The most important positive finding in the chapter, from the current revision of the nuclear standard:

> **NUREG-0700 Rev.4 §2.5.4-3** — In some applications it is permissible to **allow a user to control
> the speed for updating displayed data** (**time compression** for slowly developing patterns;
> **time expansion** for fast-changing data).

Read what this does and does not say. It does **not** give a crawl rate in characters per second, and it
is not about text motion at all. It says the sanctioned way to answer "how fast should this move?" is to
**make the temporal scale of the data itself a user-adjustable parameter** — compress time to see a slow
trend develop, or expand it to inspect data that would otherwise change too fast to read. Combined with
§1's ceilings and §1.4-2's bound:

| Design decision | Rule | Source |
|---|---|---|
| Upper bound on what the user may select | the rate **the source and processing equipment can actually deliver** | NUREG Rev.4 §1.4-2 |
| What the user may vary | **the temporal scale of the update** — compress slow patterns, expand fast ones | NUREG Rev.4 §2.5.4-3 |
| What the user must be able to do at any point | **freeze** the automatic update (see §6) | NUREG Rev.4 §2.5.2-31, §2.5.4-5/-6/-8 |

**This is the one place in the whole source set where a "movement speed" question gets a normative,
positive answer.** Everywhere else the sources either fix a ceiling (1/s, 2–5/s) or prohibit the motion
(FAA §5.6.2.5.1.12). Rev.4 §2.5.4-3 instead *delegates* the speed decision to the user, bounded by what
the system can deliver. See "What these sources do not answer" for why this is adjacent to, but not a
substitute for, a text-crawl rate.

---

## 2. Scrolling, paging, and panning

| Situation | Mechanism | Source |
|---|---|---|
| Text information on screen | **stationary**, not scrolled continuously except with user action | FAA §5.6.2.5.1.12 |
| Moving through **continuous text** | **scrolling, not panning** | FAA §5.6.2.8.6 |
| User **search of logically grouped information** (data forms) | **paging**, not panning or scrolling | FAA §5.6.2.8.7 |
| Searching through continuous text data | paging and windowing should **not** be used | NUREG Rev.1 §2.5.5-1 |
| Free cursor movement over a page of data | **panning**, not scrolling, as the framing concept | NUREG Rev.1 §2.5.5-3 |
| Content exceeds the display area | provide scrolling, paging, or panning | FAA §5.6.3.4.4.1; NUREG Rev.1 §2.5.2-6 |
| Scrolling structurally wrong; fast response; task-directed rather than reading for comprehension | paging is the better option | NASA §10.6.11 |
| Scrolling available but motor skills may be impaired (e.g. high-g) | **limit** vertical scrolling | NASA §10.6.11 |

FAA's rationale is worth carrying into a product decision: *experienced* users perform equally well
with paging or scrolling on grouped data, but *inexperienced* users do better with paging — so if both
populations use the application, paging is the safer default (FAA §5.6.2.8.7, Discussion). The
FAA-versus-NUREG framing preference looks like a conflict and is not: FAA §5.6.2.8.6 governs
**continuous text**, NUREG §2.5.5-3 a **free cursor over a page**. Scrolling is right when content is a
linear stream; panning when it is a spatial surface the user is pointing at. NUREG also warns the two
must not be mixed.

### 2.1 Axis, mechanics, and geometry

| Rule | Requirement | Source |
|---|---|---|
| Vertical preferred; horizontal never; design it out | use **vertical (top-to-bottom)** scrolling, and make the window wide enough for an entire line **without horizontal scrolling**; **"Horizontal scrolling is never recommended, especially when vertical scrolling is also required."** Horizontal scrolling/paging structures appear **only** where horizontal movement is appropriate, vertical likewise | FAA §5.6.14.2.4.3, §5.6.14.3.4.1; NASA §10.6.11; NUREG §2.5.5-7 |
| The narrow exception; one structure per axis | if the user cannot see all characters in a horizontal line, a shift must exist and take **a single action**; only **one** scrolling/paging structure for vertical and one for horizontal, **common to all files**; several techniques must work (scroll bar, arrow keys, keystroke commands; page icon or dedicated function keys); function clearly indicated by label; direction evident from labelling | NUREG §2.5.5-6, §2.5.5-10, §2.5.5-8, §2.5.5-9, §2.5.5-11, §2.5.5-12 |
| Size = amount; position = location; both absolute and relative | scroll box size proportional to how much of the document is displayed; box position indicates relative location; **both** absolute and relative position of the user indicated | FAA §5.6.14.2.4.14, §5.6.14.2.4.13; NUREG §2.5.5-15 |
| Granularity; stepping; drag; jump-to | movement **by line or by display unit**; two symbols stepping forward/backward **a unit at a time (e.g. one page)**; the box must be continuously draggable; page in one **or multiple** increments, multi-page movement **discrete with no intermediate pages displayed** | NUREG §2.5.5-17, §2.5.5-13, §2.5.5-14; FAA §5.6.14.2.4.18, §5.6.14.2.4.17 |
| Inert state; active window; dead-end; page number | scroll bars **shall be deactivated** when the whole document fits; full contrast for the **active** window only; the directional arrow subdued/greyed when nothing is available that way; the box displays the page number when selected | FAA §5.6.14.2.4.2, §5.6.14.2.4.4, §5.6.14.2.4.9, §5.6.14.2.4.15 |
| Overview inset; scope of framing; escape hatch | continuous panning/scrolling needs a margin inset showing current location; panning/zooming must affect **all** displayed data the same way; an easy means to return to normal display coverage (RETURN/RESET) | NUREG §2.5.5-16, §2.5.5-4, §2.5.2-9 |
| ROLL/SCROLL semantics | the command refers to the **display window, not the text/data** — an aperture moving over stationary text — but its *parameters* refer to the data: "roll up 5 lines" means the top five lines disappear and five new lines appear at the bottom, window fixed | MIL-STD §5.2.2.4.3.c; NUREG §2.5.5-18, §2.5.5-19 |
| Critical data and alarms | critical data shall **not** be obscured by pagination or scrolling; **"Operators should never have to page or scroll a display to view high-priority alarms."**; alarm message lists must **preclude scrolling** (paging preferred, because scrolling makes messages hard to read when many arrive at once); alarm graphics fully contained in one VDU | MIL-STD §5.2.2.2.4.a; NUREG §4.5.2-2, §4.5.7.2-4, §4.5.1-5 |
| Minimum lines; window width; text handling; orientation aids | **a minimum of four lines** of continuous text at one time; **50 to 80 characters** wide, with **52 to 78** fastest for *continuously scrolling* text at a user-set rate; large blocks broken into smaller meaningful portions; minimal hyphenation; scroll bar required when a field accepts more text than it displays; type-ahead search at **50 options or more**; every page labelled with current page and total; scrolling markers when content does not fit one screen; handheld information reachable in **less than three key actions**; all labelling preserved on scrollable tables/lists/forms/graphs | FAA §5.6.2.5.1.10, §5.6.2.5.1.9, §5.6.2.5.1.8, §5.6.2.11.3.2, §5.6.7.5.13.9; NUREG §2.5.6-10, §2.5.6-11, §1.1-50; MIL-STD §5.2.2.2.4.m, §5.2.3.3.3, §5.2.3.4.3, §5.2.3.4.2 |
| **Page scan** / **page turn** latency | **0.5 s** from request until text *begins* to scroll; **1.0 s** until the first few lines are *visible* (NUREG Table 2.4: **0.5–1.0 s**, desirable < 0.25 s) | MIL-STD table V (§5.1.2.1.4.d); NUREG Table 2.4 |
| Pointer traversal feeding the scroll | rough positioning no more than **0.5 seconds for full-screen traversal**; the rate of cursor movement must be **constant** — it must not change with time | NUREG §2.3.3-2 |

**Resolve the horizontal-scrolling disagreement this way.** NASA's "never" is the design rule: a
horizontally scrolling text pane is a defect. NUREG's "single action" clause is the **fallback** for a
fixed-width data display (a wide table in a narrow pane) where horizontal movement is inherent —
conditioned on it actually being appropriate for that display. Do not cite NUREG to justify a
horizontally scrolling article. On the ROLL/SCROLL pair: **the direction of apparent motion belongs to
the window, the units of the command belong to the data** (NUREG §2.5.5-2).

The 52–78-character figure is the only place in the set where line length is tied explicitly to
*scrolling* text, and it applies only when the scroll rate is **user-set** — the same pausability
principle WCAG reaches from the other direction.

---

## 3. Text movement — crawl, marquee, and ticker

**No marquee, ticker, or crawl rate exists anywhere in this source set.** This is not an extraction
omission — two sources say so about themselves. FAA HF-STD-001B §22: *"Marquee / ticker / crawl rates,
and characters-per-second reading rates — **nothing.**"* It constrains text movement *qualitatively*
and gives numeric update and flash rates, but has "no crawl/marquee speed figure and no words- or
characters-per-minute reading-speed figure anywhere in the text"; FAA §8 repeats it inline. FHWA-DOT
§2.5 explicitly defers duty cycle and frequency to FAA-HF-STD-001B/003/008 and **gives no numeric Hz or
duty-cycle value of its own**. And WCAG §2.2.2's position, per the mined file, is that *"the standard's
answer is not a speed limit but a pausability requirement plus a 5-second trigger threshold."*

**Do not invent one, and do not extrapolate one from the numbers elsewhere in this chapter.** The
closest adjacent figures, and how far each actually stretches:

| Available constraint | Value | Source | How far it transfers |
|---|---|---|---|
| Auto-motion must be pausable | moving/blinking/scrolling content that **starts automatically**, **lasts more than 5 seconds**, and sits **in parallel with other content** must offer pause, stop, or hide; auto-updating content must offer pause, stop, hide, **or control of update frequency** | WCAG §2.2.2 (A) | **Directly.** This is the operative rule for tickers. |
| Preference honoured; text should not move at all | interaction-triggered motion animation can be disabled; honour `prefers-reduced-motion`; and text shall be stationary, not scrolled continuously except with user action | WCAG §2.3.3 (AAA); FAA §5.6.2.5.1.12 | **Directly — a near-prohibition of tickers.** |
| Motion ceiling for graphic items | graphic display items shall not move faster than **60°/s of visual angle**, **20°/s preferred**; during motion, gross attributes and spatial orientation are preserved while small details may be lost | MIL-STD §5.2.2.5.3.a(1); NUREG §1.4-5 | **A transfer, not a text rule.** Both state it for "graphic display items"/"items on a graphic display." A moving text line plausibly is one, but neither source says so. Cite it as a borrowed engineering ceiling and say so. |
| Marquee orientation is worse | horizontal labels are easier to read than **marquee-style** labels or 90°-rotated labels | NASA §10.11.5.2 | **The only measured "marquee" finding in the set — and it is about *orientation*, not speed.** |
| Minimum pulse dwell; minimum on-time; reading geometry | a light pulse must be fast enough that **both onset and end fall between saccades — about one third of a second**; a minimum of **50 ms "on" time** between blinks for a single blink rate; ≥**4 lines**, **50–80 characters**, **52–78** fastest for user-paced scrolling | NASA §8.7.9.3; NUREG §1.3.10-12; FAA §5.6.2.5.1.10; NUREG §2.5.6-11 | Adjacent. The saccade figure is a *lower* bound on dwell, not a crawl rate. A ticker violates the 4-line rule by construction. |

**The prescriptive conclusion the evidence supports:** a marquee or auto-scrolling ticker for prose is
**non-conformant with FAA §5.6.2.5.1.12** and, if it runs past 5 seconds alongside other content,
**non-conformant with WCAG §2.2.2** unless pausable. For a ticker that must exist, the defensible design
is: user-controlled rate, pausable, motion capped at the 60°/s / 20°/s-preferred ceiling, no prose that
must be read, and no critical data — MIL-STD §5.2.2.2.4.a and NUREG's alarm rules forbid the last.

---

## 4. Reading speed and legibility measurement

The sources measure legibility **by reading speed**, not by size threshold — adopt this as a QA method.
A size threshold tells you whether a glyph is identifiable in isolation; reading speed tells you whether
glyph arrangement, contrast, spacing, sampling, font weight, and the display's temporal behaviour
together support comprehension. Every modifier below is invisible to a size-threshold test and visible
to a reading-rate test.

**The three accepted measurement protocols** (NASA §10.2.4.1): **(1)** size thresholds (visual acuity)
for letter identification — 5-letter strings on a video monitor, up–down staircase, **0.05 log unit**
size steps; **(2)** reading speed via Rapid Serial Visual Presentation (RSVP) — individual sentences
whose speed is varied to find the rate supporting **50 % correct (of words)** reading; **(3)** reading
speed via continuous reading of standardized text passages at **9th grade level**. RSVP reference
points: **small letters at two times acuity size** and **large letters at roughly ten times acuity
size**, in both all-upper-case and conventional mixed-case text. **The 35 wpm threshold is not a
target.** NASA §10.3.2.7.1 (stated twice) defines the **reading contrast threshold** as the **contrast
at which reading rate is 35 words per minute**, understood via the contrast sensitivity function and a
critical frequency of **2 cycles per letter width** — so **35 wpm is the definition of a low-contrast
failure point**, the speed at which reading is collapsing, and emphatically **not a marquee speed**. It
is the only wpm figure in NASA HIDH describing text reading; MIL-STD's only words-per-minute figure is
**150–180 wpm for speech displays** (§5.3.1.8.c), and its own gaps section records "No rule found for
reading speed" for text displays.

| Factor | Finding | Source |
|---|---|---|
| Character width | best rates at **24–42 arcmin**; reasonable at **12–360**; decline rapidly below **12** and for very large letters | NASA §10.3.2.7.1 |
| Contrast; colour vs luminance; polarity | at best sizes contrast has little effect **until reduced to 0.1 or below**, and smaller/larger sizes are more contrast-sensitive; colour and luminance contrast have **equal** effects **in threshold units**, and **the larger controls reading rate**; polarity (black-on-white vs white-on-black) had **no effect** on reading rate | NASA §10.3.2.7.1 |
| Font width; letter spacing; sampling density | fixed vs proportional width shows **no consistent difference** over **15–30 arcmin**; letter spacing has little effect as long as characters do not overlap; rate declines below about **4 samples/width for 6-arcmin characters** | NASA §10.3.2.7.1, §10.3.2.7 |
| Bold; point size; resolution | bold **significantly reduces reading speed** centrally and peripherally (periphery = **10° from central display**); **12-point is read quicker on a monitor than 10- or 14-point** (inverted U); where **high reading speed is required**, monitors with **≥90 dpi** shall be used, and **≥30 pixels per degree** at the expected viewing distance, at native resolution | FHWA-DOT §1.4 (Bernard et al. 2013), §1.3 (Bernard et al. 2002); FAA §5.3.1.7.2; FHWA/FAA-HF-STD-010A §5.16 (ANSI-HFES-100 2007; ISO 9241-303 2011) |

**Reported as found, not resolved:** NASA §10.3.2.7.1 finds polarity has no effect on *reading rate*,
while §10.11.5.1 states black-on-white **is easier to read** than white-on-black. The source
distinguishes *speed* from *preference and legibility*. Both statements stand.

**Motion blur — why moving content is worse than static content.** Response time is the 10 → 90 %
transition, on-time + off-time, and it drives motion blur; blur is quantified as blur edge time (BET),
10–90 % of the full excursion (NASA §10.3.2.4.2, §10.3.2.4.3). In the worked example the on-time is
0.987 frames and **BET = 1.26 frames**; at **16 pixels/frame** the blur edge width is 1.26 × 16 =
**20.16 pixels**. Normative on- and off-times are **< 55 ms** (HFES2006 §7.2.4.1) and **< 13 ms**
(TCO-06 §A.2.8.2). Mitigations — black insertion, overdriving, a **≥120 Hz frame rate with
motion-interpolated imagery**, strobing the backlight — "all show promise but carry costs and potential
artifacts" (§10.3.2.4.3), and FHWA §5.16.12 prohibits flicker, directionally variant judder,
moving-line contrast degradation or spreading, grey-scale aberrations, dynamic false contour
degradation, inversion edge artifacts, and low dynamic contrast for moving patterns. **At 16 px of
movement per frame a moving glyph's edge is smeared across roughly 20 px — larger than the entire
character**, so "just animate it smoothly" is not a solution to reading-while-moving.

**The acceptance test.** NASA §10.2.4.2 (quoting ISO 9241-11) gives the only field-usable legibility
test in the set, and it is a **word-level** criterion: read system messages and instructions on screen
across **50 lux to 5000 lux**, reading **at least 98 % of words** correctly at normal viewing distance,
with users having **normal or corrected-to-normal vision**.

---

## 5. Flash, blink, and flicker

### 5.1 The numbers, per source

| Source | Rule |
|---|---|
| WCAG 2.2 §2.3.1 (A) / §2.3.2 (AAA) | nothing may flash **more than three times in any one second period**, or must be below the general and red flash thresholds; AAA removes the threshold exception — no more than three per second, full stop |
| FAA §5.6.6.11.3; §5.4.2.2.1.29; §5.4.2.1.1.5 | flash rate **2–5 Hz** with a minimum ON interval of **50 %**; transilluminated indicators and flashing red for emergency: **3 to 5 flashes/s**, on and off approximately equal |
| FAA §5.6.6.11.9; §5.6.6.11.4; §5.6.13.10.2.4 | flash coding on **text**: **1/3 Hz to 1 Hz**, on/off cycle **70 %**; with two rates the lower should be **< 2 flashes/s**, the higher on the more critical information; **flash or display refresh rate shall not be within the 15–20 Hz range** |
| MIL-STD §5.2.2.3.4.c, §5.2.2.3.4.b, §5.7.3.2.4.a, §5.7.3.2.4.b | ≤2 flash rates, differing by **≥2.0 Hz**; higher **≤5.0 Hz**; slower **≥0.8 Hz**; higher rate = more critical; "on" time equal to but not less than "off" time, **50 % duty cycle preferred**; warning signals flashing red at **3.0–5.0 Hz**, **50 % duty cycle**, synchronised; caution text **not greater than 2.0 Hz**, about **70 % on**, yellow |
| NUREG Rev.1 §1.3.10-12, §4.5.6.2-3, §4.5.3-5; **Rev.4 §1.3.10-12 (rates unchanged), §4.2.6.2-3** | ≤2 rates separated by **≥2 Hz**; slow **≥0.8 Hz**, fast **≤5 Hz**; on ≥ off, **50 % preferred**; single rate **roughly 2–3 blinks/s with a minimum 50 ms on-time**; alarm flash **3 to 5 flashes/s** with approximately equal on and off times; cleared-alarm flash rate **one-half the normal rate** preferred, for discrimination |
| NASA §10.9.2.5.1 | flashing lights **3 to 5 flashes/s**, on/off approximately equal; **must illuminate and burn steadily if the flasher fails** |

### 5.2 The conflict, and the alternative to flashing

**This is a genuine conflict, and WCAG should usually win.** Reuse the resolution in
`CROSS-SOURCE-REGISTER.md` §3. The older human factors standards were written when a blinking indicator
was the primary way to draw an operator's attention in a control room; they recommend 3–5 Hz because
that range is highly salient. WCAG caps at 3 Hz because flashing can trigger photosensitive epileptic
seizures, and it cannot know whether any given viewer is susceptible. **For any interface reachable by
the general public, or by an unknown population, follow WCAG: ≤3 flashes per second, hard, plus a
`prefers-reduced-motion` path. For a closed, medically-screened operator population — the domain these
standards were written for — 3–5 Hz remains defensible, and fail-steady plus roughly equal on/off
intervals become mandatory. In all cases the flash is an attention cue only: the information it carries
must also be present statically, and NUREG and NASA both require the alarm to remain identifiable when
the flash fails or is suppressed.**

The 15–20 Hz prohibition and the 3 Hz cap are **different mechanisms aimed at the same risk** — FAA's
band is a photic-stimulation prohibition from the same era as WCAG's criterion, and it applies to
*display refresh rate* as well as intentional flashing. Never let a render loop land in 15–20 Hz, even
briefly.

**Text must never flash** — unanimous across four sources: FAA §5.6.6.11.6 (data or text the user must
read should never blink or flash, "because a blinking object is, by definition, not displayed
continuously and can be read only when it is displayed"); MIL-STD §5.2.2.3.4.e (characters that must be
read **shall not flash**); NUREG §1.3.10-9 (flashing should not be used where attention to detail or
reading of text is required; flash coding generally *increases* search times); and FHWA/FAA-HF-STD-010A
§4.9 (**"Text shall not flash on and off"**). **If text must be modulated, three techniques are
permitted** (FHWA §4.9), each preserving the contrast that naive on/off blinking destroys: **(1)**
alternate between normal luminance and one that is **obviously brighter**; **(2)** **polarity reversal /
inverse video**, alternating the item's colour with its background's; **(3)** add a **temporally
modulated marker** nearby — FAA §5.6.6.11.8 specifies an **asterisk or arrow** that flashes rather than
the item itself, NUREG §1.3.10-10 requires the same, and MIL-STD §5.2.2.3.4.e adds the adjacent-anchor
option.

### 5.3 Cursor blink, and the rest of the flash mechanics

| Cursor | Rate | Source |
|---|---|---|
| Text cursor; location cursor | **2–5 Hz**, with **2 to 3 Hz at a 50 % duty cycle preferred**; location cursors **2 to 3 Hz**, **50 % duty cycle** | FAA §5.6.13.10.2.3, §5.6.13.10.7.3, §5.6.13.10.7.4 |
| Text entry cursor default | **3 Hz**, if blinking is used to direct attention | NUREG Rev.1 §2.3.6-3; **Rev.4 §2.3.6-3** |
| **Pointing** cursor; status indicator | **should not blink**, and flicker minimized across the entire range of motion; change cursor shape when an operation takes **more than 2 or 3 seconds**, and the status cursor must be **distinct** from the normal cursor | NUREG §2.3.5-2, §2.3.5-3; FAA §5.6.13.10.4, §5.6.13.10.4.1 |

The rule most often broken: **the pointing cursor must not blink, but the text entry cursor should.**
Blinking communicates *where input will go*; it must not attach to the pointer.

| Flash mechanic | Requirement | Source |
|---|---|---|
| Purpose | only to call attention to **mission critical events** (the older FAA formulation also allows the active location for data entry), never to highlight routine information | MIL-STD §5.2.2.3.4.a; FAA §5.6.6.11.1; NUREG §1.3.10-9 |
| Area; synchronisation | only a **small area** shall flash at any time; same-rate items **shall be synchronized** | MIL-STD §5.2.2.3.4.g, §5.2.2.3.4.d; FAA §5.6.6.11.2, §5.4.2.2.1.30; NUREG §1.3.10-11 |
| Acknowledgement | an acknowledgement or flash suppression control **shall** be provided; acknowledging should stop the flashing | MIL-STD §5.2.2.3.4.f; FAA §5.6.6.11.5; NUREG §1.3.10-13 |
| Failure state | if the indicator is energised but the flasher failed, the light **shall remain ON** / burn steadily; on flasher failure the element should assume a **highly salient** state rather than a less salient one such as off, with a code unique from the acknowledged state | FAA §5.4.2.2.1.31, §5.4.2.1.1.6; NASA §10.9.2.5.1; NUREG §4.8.1-4 |
| Acknowledgement as a code | flashing red is reserved for the **unacknowledged** alarm and drops to **solid** red once acknowledged, with a static marker optionally persisting to aid re-finding; a new deviation before a prior alarm clears returns the shared alarm to the flashing state | FHWA §4.2.1, §5.2; NUREG §4.5.4-3 |
| Frequencies to avoid; dimming | motion frequencies between **0.1 Hz and 0.5 Hz** shall be avoided in virtual environments; hue can shift with luminance (Bezold–Brücke effect), most pronounced below **10 cd/m²** | MIL-STD §5.12.1.4.2; NASA §8.7.9.4 |

**Fail-steady is a software requirement, not a hardware one.** If your blink is a CSS animation or a
`setInterval`, the equivalent obligation is: if the animation does not run — reduced-motion set, tab
backgrounded, animation library failed — the indicator must default to **steady on**, never off. FHWA's
flash-to-acknowledge pattern plus the reflash rule give the full state machine: **flashing =
unacknowledged, steady = acknowledged, one-half-rate flash = cleared, steady-on = flasher/animator
failure.**

### 5.4 Flicker, refresh, and jitter

| Quantity | Value | Source |
|---|---|---|
| Flicker vs frame rate; modulation ceiling; CFF | flicker threshold is typically **zero above about 70 Hz**; observers cannot see luminance modulations more rapid than about **60 Hz**; critical fusion frequency rises with light level, from **below 20 Hz to above 60 Hz** | NASA §10.3.2.4.1, §10.3.2.4, §5.4.9.4 |
| Flicker compliance definitions | frame rate > formula value (HFES2006 §7.2.4.3); invisible to **90 % of users** (ISO13406 §7.24) | NASA §10.3.2.4.5, Table 10.3-6 |
| Flicker-free requirement; light sources | refresh rate and other parameters (duty cycle, brightness, contrast, colour, motion) adjusted to provide a flicker-free display; light sources shall not have a perceptible flicker | MIL-STD §5.2.1.1.4, §5.5.3.1.1.e; FAA §5.11.4.7.7 |
| Jitter; geometric distortion | over **1.0 second**, movement of a picture element shall not exceed **0.2 milliradians (41 seconds) of visual angle**, or alternatively **2 mm per cm of viewing distance** at **0.5 to 30 Hz**; combined geometric distortion shall not displace any point by more than **5.0 % of picture height** | MIL-STD §5.2.1.1.5, §5.2.1.1.3; FAA §5.3.1.8.1 |
| Vibration | displays should be stabilized to avoid vibrating above **5 Hz**; at +0.5 Gz RMS there is about a **threefold decrease in acuity** in the **5–20 Hz** range, with a vulnerable range of **2 to 30 Hz**; sufficient illumination avoids scotopic vision, which lowers CFF during vibration; characters read during vibration should be large enough to be perceived **even when blurred** (no numeric value given) | FAA §5.3.4.1.5, §5.3.4.1.4, §5.3.4.1.3; NASA §5.3.4.3 |
| Stereopsis; binocular asynchrony; HMD / VE | dynamic 3-D: temporal modulation of stereopsis **approximately 1.0 Hz**; binocular asynchrony should not exceed **100 ms**; scene update **≥60 Hz** with motion frequencies **0.1–0.5 Hz** avoided; input-to-display **≤100 ms** (75 ms preferred) round trip, **≤16 ms** for head-movement response in head-mounted imagery | MIL-STD §5.2.3.5.1.c, §5.12.1.4.2, §5.12.1.4.1.a–b; FAA §5.3.3.1.11, §5.3.3.1.10 |
| Display lifetime; persistent imagery | **20,000 to 60,000 hours** to 50 % brightness decline, with warm-up taking minutes to hours; uneven aging ("burn-in," "residual image") from long-term uneven illumination — i.e. fixed status bars, pinned headers, permanent alert banners | NASA §10.3.2.4.4, §10.3.2.4.5 |

**Two flicker mechanisms are conflated by most teams, and the sources keep them apart.** *Frame-rate
flicker* is a perception threshold — above ~60–70 Hz nobody sees it, and CFF rises with brightness.
*Photic-stimulation risk* is a seizure threshold — the 15–20 Hz prohibition applies there and does
**not** go away when the panel gets brighter or faster. Satisfying one does not satisfy the other.

---

## 6. Display freeze

All three ergonomics standards require freeze. MIL-STD's wording is the most complete: **MIL-STD-1472G
§5.2.2.6.5–.8** — a display freeze mode **shall** be provided to allow viewing any selected frame that
is updated or advanced automatically by the system; a **single action** option shall allow resumption
**at freeze point or at the current real-time point**; the user **shall be prohibited** from entering
freeze mode when doing so would adversely affect the mission; and an appropriate **label** shall remind
the user when the display is frozen.

| Requirement | Source |
|---|---|
| Freeze automatically updated data **at any point**, to examine changed data more deliberately; automatically updated windows must have freeze capability **and** user control over the rate at which updated screens are scrolled | NUREG Rev.1 §2.5.3-5, §2.5.6-31; FAA §5.6.3.2.2.17; **Rev.4 §2.5.4-5, §2.5.2-31** |
| An **obvious reminder** of freeze mode, desirably in an **attention-grabbing mode, such as a flashing message**; appropriately **labeled**, and frozen status **shall be clearly indicated** | NUREG §1.1-45, §2.5.3-6; FAA §5.6.9.2.2; MIL-STD §5.2.2.6.7; **Rev.4 §2.5.4-5/-6** |
| Resumption at freeze point **or** current real-time point on a single action; unless the user specifies otherwise, releasing a frozen display **shall indicate conditions at the time of release, not the time it was frozen**; resuming from the frozen time requires alerting the user that the data are **not current**; a **speeded "replay" of interim changes** is an acceptable alternative | MIL-STD §5.2.2.6.5–.6; FAA §5.6.3.2.2.19, §5.6.9.2.4, §5.6.3.2.2.20; NUREG §2.5.3-8; **Rev.4 §2.5.4-8 — "positioned at the current real-time point"** |
| Notify users of **significant changes occurring while frozen**, and of critical information arriving in frozen, inactive, or **minimized** windows; the user **shall be prohibited** from freezing when doing so would adversely affect the mission | FAA §5.6.9.2.3, §5.6.5.1.7; NUREG §2.5.3-7; MIL-STD §5.2.2.6.8 |
| When data change too rapidly to read, view a frozen **"snapshot" display alongside** the continuous display; a suppressed display is annotated with a label, changes to suppressed data are signalled, and restoration is quick via a dedicated function key having no other use | NUREG §1.1-44, §2.5.4-2, §2.5.4-3, §2.5.4-4, §2.5.4-5 |

Three implementation lessons. **(1) Snapshot-alongside beats freeze alone** — NUREG §1.1-44 explicitly
endorses showing the frozen frame *next to* the live one, satisfying "read this value carefully" without
depriving the operator of currency. **(2) The freeze indicator must be a marker, not a blinking word** —
NUREG §1.1-45 suggests a flashing message but §5.2 above forbids flashing text; use a flashing **icon or
asterisk adjacent to** a steady label (FAA §5.6.6.11.7–.8; MIL-STD §5.2.2.3.4.e; NUREG §1.3.10-10),
capped at ≤3 flashes/second where the audience is public or unscreened (WCAG §2.3.1). **(3) The
prohibition is a real requirement** — MIL-STD §5.2.2.6.8 forbids offering freeze where freezing harms
the mission: a freeze control on a live safety, guidance, or control-loop display must be absent or
disabled where currency matters. It is not an accessibility preference and not a user option.

---

## What these sources do not answer

**These sources cannot tell you how fast text may move while it is being read.** Be precise about the
shape of that gap: the four questions actually asked resolve as follows.

| Question | Verdict | Evidence |
|---|---|---|
| **(1) How fast may content update while a person reads it?** | **Answered, converged, numeric** — once per second for values that must be read, 2–5/s for rate-of-change and gross values | MIL-STD §5.2.2.6.1; FAA §5.6.5.1.1/.3; NUREG Rev.1 §1.4-1/-2/-3, §2.5.3-2; **Rev.4 §1.4-3, §2.5.4-2** |
| **(2) How fast may text scroll while a person reads it?** | **Not answered as a rate** — but see (5). The standards answer by *prohibiting the movement* and requiring *pausability*. The one numerical ceiling that plausibly transfers, **60°/s with 20°/s preferred**, is stated for **graphic display items**, not text, and must be cited as a borrowed engineering bound | FAA §5.6.2.5.1.12; WCAG §2.2.2; MIL-STD §5.2.2.5.3.a(1); NUREG Rev.1 §1.4-5 |
| **(3) How much reading time is available at a given movement speed?** | **Not answered at all** — nothing relates speed of travel to a reading-time budget. A marquee/ticker/crawl rate in characters per second is **explicitly absent**: FAA §22 and §8 both state there is no crawl/marquee speed figure anywhere in the text, and FHWA-DOT §2.5 gives no numeric Hz or duty-cycle value of its own. Reading speed in wpm for **text** displays is also **explicitly absent**: MIL-STD's gaps section records "No rule found for reading speed." Minimum display duration is **absent as a number** (FAA §5.6.5.1.2; MIL-STD §5.2.2.6.9), as is any flat-panel refresh minimum (only ≥60 Hz for HMD/VE) and any reaction-time figure (FHWA-DOT §1.8, §2.7) | FAA §22, §8; FHWA-DOT §2.5, §2.6, §2.12, §1.8, §2.7; MIL-STD gaps section; NUREG Rev.4 mining |
| **(4) How fast may a person read while in motion?** | **Not answered at all.** Nearest adjacent findings: whole-body vibration degrades acuity about threefold in the 5–20 Hz band; characters read during vibration must be oversized to survive blur; marquee-oriented labels are harder to read than horizontal ones; and peripheral reading is slower than central, with the periphery operationalised at 10° eccentricity. None is a speed-versus-reading-time law | NASA §5.3.4.3, §10.11.5.2; FAA §5.3.4.1.3; FHWA-DOT §1.4 |
| **(5) What do the sources *do* say about speed, positively?** | **NUREG-0700 Rev.4 §2.5.4-3**: "in some applications it is permissible to allow a user to control the speed for updating displayed data (time compression for slowly developing patterns; time expansion for fast-changing data)", bounded by §1.4-2 to what the source and processing equipment can deliver. **It is *not* a characters-per-second crawl rate and says nothing about text motion**; it says the sanctioned mechanism is to make the **temporal scale of the data a user-adjustable parameter**. **The sources answer the movement-speed question not with a speed limit but with a user-controlled rate, a hard ceiling, and a freeze** | NUREG Rev.4 §2.5.4-3, §1.4-2 |

**Why the gap exists — and why it is not laziness.** Every source places the reader at a **fixed
workstation**. MIL-STD specifies a maximum seated viewing distance of **70 cm (28 in)** (§5.2.3.1.a);
NASA HIDH, NUREG, and FAA HF-STD-001B are console and control-room documents. FHWA-HRT-16-060 and
FAA-HF-STD-010A are transportation documents, but their operator is a **stationary**
traffic-management-centre or air traffic controller — the vehicles move, the reader does not. WCAG is
written for the web, where, per its own mined gaps section, it "constrains *pausability* and *flash
rate*, not words-per-minute," and where viewing distance, device, and user are all unknown.

**Rev.4 nonetheless does not close the speed-versus-reading-time gap** — its mining contains no marquee,
crawl, ticker, words-per-minute, glance-duration, or dwell-time figure, and §2.5.4-3 supplies the
*adjacent* temporal-scaling rule, not the missing transportation data. The gap above stands.

**Named follow-up sources.** FHWA-DOT §2.6 and its cross-source note identify the actual literature and
cite it without reproducing its numbers. Both are named in FHWA-HRT-16-060's reference list at
pp. 128–129: **Dudek, C. L. (2006)**, *Dynamic Message Sign Message Design and Display Manual* (Florida
DOT; reference 50 in the FHWA source), and **Lerner, N., Singer, J., Robinson, E., Huey, R., &
Jenness, J. (2009)**, *Driver Use of En-Route Real-Time Traffic Information* (reference 89). Anyone
needing a genuine speed-versus-reading-time figure — for a head-up display in a moving vehicle, a
transit reader, a wearable, or an automotive HMI — must go to those, not to this collection. **Any wpm
or characters-per-second movement figure presented as coming from these documents would be fabricated.**
Adjacent constraints that **do** transfer to a moving reader: WCAG's timing-adjustable rule (**range
≥10 × the default**, extension **≥20 s** grantable **≥10 times**, §2.2.1); `prefers-reduced-motion`
(§2.3.3); the **≤3 flashes/second** cap (§2.3.1); the motion-blur budget (**BET 1.26 frames → 20.16 px**
of smear at 16 px/frame, NASA §10.3.2.4.3); and the prohibited motion artefacts (FHWA §5.16.12).

---

## Anti-patterns

| Avoid | Why it fails |
|---|---|
| **Quoting a marquee or ticker speed and attributing it to these standards** | No crawl rate exists in this set, and two sources say so about themselves (FAA §22, §8). The defensible citation is FAA §5.6.2.5.1.12 (*text shall be stationary*) and WCAG §2.2.2 (*pausable*). |
| **Turning either wpm figure into a movement speed, or shipping auto-scrolling prose** | NASA's **35 wpm** is the contrast threshold at which reading is *failing* (§10.3.2.7.1), not a target; MIL-STD's **150–180 wpm** is the output rate for **speech** displays (§5.3.1.8.c) and its own gaps section records no text reading-speed rule. Auto-scrolling prose is prohibited qualitatively by FAA §5.6.2.5.1.12 and, past the 5-second trigger, non-conformant with WCAG §2.2.2 unless pausable; it also destroys the only line-length evidence in the set, since the 52–78-character optimum (NUREG §2.5.6-11) presumes a **user-set** scroll rate. |
| **Rendering a fast-updating value and calling it "real-time," or confusing update rate with refresh rate** | Above once per second for a value the user must read it is a defect under MIL-STD §5.2.2.6.1.a, FAA §5.6.5.1.3, and NUREG Rev.1 §1.4-1 / Rev.4 §1.4-3 simultaneously; above 5/s it fails the rate-of-change band too. And a 144 Hz render loop does not make a 20 Hz data feed readable (MIL-STD §5.2.2.6.2 vs §5.2.2.6.3). |
| **An update-rate control with no upper bound, or no temporal-scale control at all** | NUREG Rev.4 §1.4-2 bounds the adjustable rate by what the information source and processing equipment can meet; §2.5.4-3 explicitly permits user-controlled **time expansion** for fast-changing data and **time compression** for slowly developing patterns. Withholding both leaves the operator to guess at a rate the interface has already decided for them. |
| **Blinking — or `opacity`-fading — the text you want read, or flashing 3–5 Hz at the public** | On/off blinking is unanimously prohibited (FAA §5.6.6.11.6, MIL-STD §5.2.2.3.4.e, NUREG Rev.1 §1.3.10-9, FHWA §4.9) and a fade carries no contrast guarantee, while 3–5 Hz is an accessibility defect for an unscreened audience (WCAG §2.3.1, ≤3/s). A render loop must never drift into the 15–20 Hz band (FAA §5.6.13.10.2.4). |
| **A blinking pointer, or a blinking indicator whose failure state is "off"** | NUREG §2.3.5-2 forbids the former (blink belongs to the text entry cursor, default 3 Hz, §2.3.6-3); every source requires fail-steady for the latter (FAA §5.4.2.2.1.31, NASA §10.9.2.5.1, NUREG §4.8.1-4). If your animation is skipped — reduced motion, backgrounded tab, failed library — the alert must be **on**. |
| **A horizontally scrolling text pane, or mixed scroll/pan conventions** | NASA §10.6.11: "never recommended"; FAA §5.6.14.3.4.1 requires the window be wide enough to avoid it; NUREG §2.5.5-6 is a fallback for fixed-width data, not a licence. NUREG §2.5.5-10 allows one structure per axis, §2.5.5-8 requires a common structure across all files, §2.5.5-4 requires panning/zooming to affect all data identically, and **leaving scroll bars active when everything fits** fails FAA §5.6.14.2.4.2. |
| **Scrolling a list containing content the user must act on** | MIL-STD §5.2.2.2.4.a forbids obscuring critical data by scrolling or pagination; NUREG §4.5.2-2 states operators should **never** have to scroll or page to see high-priority alarms, and §4.5.7.2-4 requires scrolling of the alarm list to be precluded in favour of paging. |
| **Freeze defects: no unmissable indicator, two actions to resume, silent resume at the frozen point, freeze where currency is the point, or a forgotten inactive window** | MIL-STD §5.2.2.6.5–.7 requires single-action resume and a label; NUREG §1.1-45 requires an *obvious* reminder; MIL-STD §5.2.2.6.8 **prohibits** offering freeze where it harms the mission; FAA §5.6.3.2.2.20 requires alerting the user that data are not current and §5.6.9.2.4 / NUREG Rev.4 §2.5.4-8 make resuming at the **release** time the default; a frozen window that cannot be scrolled, or that scrolls at a fixed rate, fails NUREG §2.5.6-31; and FAA §5.6.5.1.7 requires notifying users of critical information arriving in frozen, **inactive, and minimized** windows — most implementations forget the last two. A frozen dashboard that looks live is a data-integrity failure. |
| **Judging legibility by a size threshold alone, or animating on a slow panel** | Bold, sampling density below 4 samples/width, contrast below 0.1, and character width below 12 arcmin each degrade reading rate while leaving glyph identification intact (NASA §10.3.2.7.1; FHWA §1.3–§1.4). And motion blur is a panel-and-frame-rate property: BET 1.26 frames smears a glyph edge across ~20 px at 16 px/frame (NASA §10.3.2.4.3) — "smoother" animation can make reading worse, not better. |

---

## Connects to

- **Ch 1 (Text size and legibility)** — the 24-arcmin "must be read rapidly" tier is a *static* size
  requirement; dynamic content needs that tier **plus** the update ceilings here. NASA's character-width
  band (24–42 arcmin for best reading rate) is a Ch 1 quantity measured by a Ch 4 method.
- **Ch 2 (Spacing)** — line, character, and word spacing are the static half of reading rate (NASA
  §10.3.2.7); the 4-line minimum (FAA §5.6.2.5.1.10) and 50–80-character measure (NUREG §2.5.6-11) are
  the geometry that scrolling must not destroy.
- **Ch 3 (Contrast and colour)** — the reading contrast threshold (35 wpm) is defined in terms of
  contrast, and colour versus luminance contrast have **equal** effects on reading rate in threshold
  units, with the larger of the two controlling (NASA §10.3.2.7.1). The permitted text-modulation
  techniques in §5.2 exist precisely because they preserve contrast.
- **Ch 7 (User-adjustable parameters and defaults)** — this chapter generates an unusually large set of
  mandatory controls: update rate (MIL-STD §5.2.2.6.4; **NUREG Rev.4 §1.4-2, bounded by source and
  processing capability**), update frequency and category selection (FAA §5.6.5.1.4), stop/resume (FAA
  §5.6.5.1.5), **the speed of updating displayed data — time compression / time expansion (NUREG Rev.4
  §2.5.4-3)**, auto-scroll rate in windows (NUREG §2.5.6-31), cursor sensitivity (MIL-STD
  §5.1.3.4.1.h(1)), and key repeat 500 ms → ~10 chars/s, **adjustable** (NASA §10.4.2.3.7). Note the
  collision with NUREG's key-repeat defaults of a 0.5 s delay and a 0.1 s rate (§3.2.1-19) — 0.1 s per
  character is 10 characters per second, the same rate NASA specifies.
- **Alert and response-time chapters** — the alarm-flash and fail-steady rules in §5.3 are the temporal
  half of alert design. The scroll and page latency budgets in §2.1 (page scan **0.5 s**, page turn
  **1.0 s**, MIL-STD table V) must reconcile with the response-time tables in `CROSS-SOURCE-REGISTER.md`
  §4.
- `CROSS-SOURCE-REGISTER.md` **§3** — the flash-rate reconciliation and public-versus-screened-population
  rule, reproduced in §5.2. **§4** — response-time budgets, including that variability stay within ±half
  the mean (NUREG) and within 5 %/10 %/15 % by range (FAA). **§8** — MIL-STD §5.2.2.5.3.a(1) prints the
  motion rate as "60 degrees (1.05 radians) (20 degrees (0.35 radians) preferred)", malformed in the
  source text; preserved as-is, so prefer the NUREG §1.4-5 restatement for the preferred value. **§9** —
  NUREG-0700 Rev.1 is a scanned document with OCR damage confined to prose; **Rev.4 is now mined and is
  digital**, and it confirms the Rev.1 figures this chapter relies on — §1.4-3 and §2.5.4-2 restate the
  1/s and 2–5/s ceilings unchanged, and §1.3.10-12 restates the flash rates (0.8 Hz / 5 Hz / ≥2 Hz
  separation / 50 ms on-time) unchanged. Where the revisions differ in guideline **numbering** (the alarm
  flash rule is Rev.1 `4.5.6.2-3` but Rev.4 `4.2.6.2-3`), the citations above name the revision
  explicitly. Prefer Rev.4 when a figure is disputed.

