# Chapter 8 — Alerts, warnings, and messages

**Core idea.** Every source here caps alert severities at **four** and requires severity to be carried by **more than one channel at once** — colour *plus* shape, text, position, or luminance, never colour alone. The sources genuinely disagree on **flash rate**: the cockpit and control-room documents recommend 3–5 flashes per second, while WCAG caps flashing at 3 per second for photosensitive-epilepsy reasons — and WCAG wins for anything a general or unscreened population can reach.

**How the two NUREG revisions are cited in this chapter.** NUREG-0700 **Rev.4** is the current revision and its alarm material is cited as `NUREG Rev.4 §…` using Rev.4's own numbering; the older **Rev.1 Vol.1** is cited as `NUREG Rev.1 §…`. Where both state the same rule the row carries both citations; where they differ, the difference is reported in-text rather than merged. Rev.4 generally *restates* Rev.1's alarm rules and adds the **state model** (new / acknowledged / cleared), **ringback**, **reset semantics**, **suppression-vs-filtering**, and **alarm routing** — it does **not** supersede Rev.1's four-level priority cap or the two-brightness-level rule, which it drops.

---

## Priority levels

| Rule | Value | Source |
|---|---|---|
| Priority levels | **limited to four** | FAA HF-STD-001B §5.5.1.2.4 |
| Priority levels **within a dimension** | **no greater than four** (Rev.1) | NUREG-0700 Rev.1 §4.4-2 |
| Priority **dimensions** | urgency (immediacy of required action) and challenges to plant safety; further dimensions (e.g. productivity, investment protection) **may** be added. The scheme must be **logical**, so the **highest safety significance receives the highest priority** | NUREG-0700 **Rev.4** §4.1.3-1 |
| Precedence for important information | alarms of **higher importance or greater safety significance** get **greater priority in their presentation** | NUREG-0700 **Rev.4** §4.2.2-1 |
| Alarm classes | **three**: Class 1 Emergency, Class 2 Warning, Class 3 Caution | NASA HIDH §10.9.1.1, Table 10.9-1 |
| Optional visual-only tier | **"class 0"** — out-of-limits arrows, **no auditory component** | NASA HIDH §10.9.1.1 |
| Signal words on placards/labels | **DANGER, WARNING, CAUTION, NOTICE** (ANSI Z535.2 / Z535.4) | MIL-STD-1472G §5.7.2.5.1–`.4` |

The rationale is quotable when someone asks for a sixth severity: *"Prioritization schemes with many levels may require operators to devote excessive attention to the priority level and thus reduce the benefits of prioritization"* (NUREG Rev.1 §4.4-2).

**Revision note.** Rev.4 restates the prioritisation *criteria*, the dimensions, and the precedence rule, but is **silent on the number of levels** — the four-level cap comes from FAA §5.5.1.2.4 and NUREG Rev.1 §4.4-2 only. The cap still governs; Rev.4 adds *what the levels should express* and *who wins when they collide*.

**Define each level by required response time, not by how bad it feels.** No source names "success" as a severity; green is defined as *"in tolerance / satisfactory / all right to proceed"* (FAA §5.4.2.2.1.27; MIL-STD Table XVIII), which is what a success state means. Colours are the ATC population-stereotype ladder (FHWA-HRT-16-060 §5.2).

| Modern level | Tier | Definition | Colour / flash |
|---|---|---|---|
| Blocking error | Class 1 DANGER | life-threatening; requires **immediate and preplanned safing action** | **flashing red** unacknowledged → **solid red** acknowledged |
| Error | Class 2 WARNING | potentially affects survival; **may** require a predetermined action to contain consequences | red (steady) |
| Warning | Class 3 CAUTION | less time-critical, but **potential for further degradation** if attention is not given | orange/amber or yellow; flash only to beat competing alerts |
| Info / notice | Class 0 NOTICE | informational; no hazard | white or blue — *blue **only** as advisory*; never |
| Success | green = in tolerance | *"all right to proceed"* | green; never |
| Ignorable | gray — *"items the operator can ignore"* | — | gray; never |

Definitions: NASA §10.9.1.1 Table 10.9-1. Signal words (MIL-STD §5.7.2.5.1–`.4`): **DANGER** if failure to avoid *will almost certainly* cause serious injury or death; **WARNING** if it *may*; **CAUTION** if *minor or moderate*; **NOTICE** for system damage or information not tied to a hazard. Red is reserved for *"no-go, error, failure, or malfunction"*, with flashing red for *"emergency conditions requiring immediate user action"* (FAA §5.4.2.2.1.27); FAA's caution tier is awareness *"not necessarily immediate action"* (§5.5.1.2.7).

**Precedence when alerts collide** — three mandatory rules: **higher priority overrides lower** (*"a more critical message overrides the presentation of any message having a lower priority"* — FAA §5.5.1.2.5; also NUREG Rev.1 §4.5.2-1, NASA §10.9.1.1); **simultaneous events present in descending priority order** (FAA §5.5.1.2.3); and **warnings must fully clear before cautions appear** — *"no caution messages shall be presented until all warning messages are terminated"* (MIL-STD §5.3.1.2.5), the strongest form and the one a queue-based notification system most often violates. NASA records the failure mode as a defect: on the Shuttle *"it was possible for all auditory alarms to sound simultaneously"* (§10.9.1.1).

**Two acceptance tests.** An alert system must **alert** (a problem exists), **inform** (priority and nature), **guide** (initial response), and **confirm** that the response corrected the problem (FAA §5.5.1.1.3; NUREG Rev.1 §4.1-1 — near-verbatim in both); and it must be **unambiguous with a clear indication of the cause** (FAA §5.5.1.1.2) and **distinctive and consistent for each class of event** (§5.5.1.2.9).

---

## Modality and redundancy

**Colour must never be the only channel** — the one requirement every source states and none compromises.

| Requirement | Source |
|---|---|
| Colour **shall not be the sole means** of coding critical information; use redundantly with **size, shape, pattern, text content, position, or temporal modulation** | FHWA §4.2 |
| Colour must not be the only visual means of conveying information, indicating an action, prompting a response, or distinguishing an element | WCAG 2.2 **1.4.1** (A) |
| **All** nonverbal audio signals shall be accompanied by a **visual signal that defines the condition** | FAA §5.5.1.1.11; MIL-STD §5.3.1.5.7.b |
| Important information through **both visual and auditory** means; the visual display itself redundant across **pictures, schematics, colour, and text** | NUREG Rev.1 §2.4.4-2 |
| Visual warnings/cautions/advisories **shall be integrated** with other modalities (auditory, tactile) | MIL-STD §5.7.3.2.3 |
| **Redundant codes** for alarms requiring rapid action — Rev.1's example is *fast flashing or bright*; **Rev.4's example is colour and location** | NUREG Rev.1 §4.5.6.2-2; NUREG **Rev.4** §4.2.6.2-2 |
| **Alarm priority should be coded** visually; acceptable methods are **colour, position, shape, and special symbols** — *"colour and position (top to bottom) are especially effective"* | NUREG **Rev.4** §4.2.2-3 (cf. Rev.1 §4.5.2-3) |
| Additional warnings **shall** be indicated by redundant coding | MIL-STD §5.7.3.2.8 |

**Do not use brightness as the redundant channel for a colour code** — *"protans may not recognize brightness differences that are apparent to others. Consequently, brightness coding **shall not** be used to add a redundant coding dimension to chromaticity"* (FHWA §4.2.2). Pair colour with **shape, icon, text, or position** instead.

**One coding dimension per meaning.** *"If flash rate is being used to indicate alarm state (new, acknowledged, or cleared), it should not also be used to indicate need for operator action"* — pick *either* "flashing = unacknowledged" *or* "flashing = urgent", never both (NUREG Rev.1 §4.5.6.1-3; Rev.4 §4.2.6.1-3 restates it, adding the worked example "immediate action required / action required within **15 minutes** / no near-term action needed"). Both revisions require a formal, documented scheme covering **all** dimensions (colour, shape, brightness, texture/pattern, flashing) with a stated **hierarchical order of salience**, established *before* any coding is applied, so the **highest-priority information is also the most prominent**; each colour gets *"a single, precise meaning"*, consistent across the interface, not counter to cultural stereotypes (Rev.1 §4.5.6.1-2; Rev.4 §4.2.6.1-1, §4.2.6.1-2). Rev.1 §4.1-3 and Rev.4 §4.7-1: if colour codes priority in the alarm system it must mean the same thing in the process displays and in computer-based procedure displays. Keep the set small — coding techniques **kept to a minimum** (§4.5.6.1-4; Rev.4 §4.2.6.1-4); coding **shall not be used if it reduces legibility or transmission time** (MIL-STD §5.2.2.3.1.c); highlighting budgeted at **10 %** of displayed information (§1.3.10-2); coding conventions such as **flash rate, intensity, and colour** must be applied **consistently across alarm displays** (Rev.4 §4.2.1-4); and **an "off" condition should never be used to attract attention to a message** (§1.3.10-9).

**Modality choice** (NASA HIDH Table 10.9-3, §10.9.3) — choose **auditory** when the message is simple or short, no subsequent recall is needed, **immediate action is required**, the visual system is overloaded, or persons may be moving; choose **visual** when the message is complex or long, must be recalled, requires no immediate action, the auditory system is overloaded, or persons are stationary. NASA requires auditory cues **redundantly with visual cues** (§10.6.20.2), and FAA requires audio to be *supplementary* — alerting and directing attention to the visual display, never carrying the message alone (§5.5.1.1.12). **A sound-only alert in a UI is a defect.**

---

## Flash and blink for alerts

**Flash is an attention cue, never a carrier of information.** *"Flash coding shall be employed to call the user's attention to mission critical events only"* (MIL-STD §5.2.2.3.4.a); *"Flash or blink coding should only be used to indicate an urgent need for the user's attention and response, or to indicate the active location for data entry"* (FAA §7).

### The rate conflict, and how to resolve it

| Source | Rule |
|---|---|
| WCAG 2.2 **2.3.1** (A) | nothing may flash **more than three times in any one second**, or must be below the general/red flash threshold |
| WCAG 2.2 **2.3.2** (AAA) | no more than **three flashes per second, full stop** — threshold exception removed |
| FAA §7 | flashing rate **2–5 Hz**, minimum ON interval **50 %**; transilluminated indicators **3–5 flashes/s**, on and off approximately equal |
| MIL-STD §5.7.3.2.4.a | warning signals **flashing red, 3.0–5.0 Hz, 50 % duty cycle**, and **synchronised** |
| MIL-STD §5.2.2.3.4.b–c | duty cycle **50 % preferred** (ON ≥ OFF); **≤2 flash rates** differing by **≥2.0 Hz**; slower **≥0.8 Hz**; faster **≤5.0 Hz** |
| NUREG Rev.1 §4.5.6.2-3 | alarm flash **3–5 flashes/s**, approximately equal on and off |
| NUREG Rev.1 §1.3.10-12 | **≤2 flash rates**, **≥2 Hz** apart, slow **≥0.8 Hz**, fast **≤5 Hz**, on **≥** off, 50 % preferred; single rate **≈2–3 blinks/s with a minimum 50 ms ON time** |
| NUREG **Rev.4** §4.2.6.2-3 | alarm flash **3–5 flashes/s** with approximately equal on and off times — **unchanged from Rev.1** |
| NUREG **Rev.4** §4.2.6.2-1 | a flashing visual signal is the *preferred* means for directing attention and indicating alarm **status** (unacknowledged, acknowledged, cleared-not-reset) on SDCV and computer-based displays |
| NASA §10.9.2.5.1 | alarm flash **3–5 flashes/s**, on and off approximately equal |

**Resolution — a hard rule for this chapter:**

1. **Any interface reachable by the general public or an unscreened population: follow WCAG, ≤3 flashes/second.** The ergonomics figures were written when a blinking indicator was the primary attention mechanism in a control room staffed by a screened operator population. Flashing in the 3–50 Hz band can trigger photosensitive epileptic seizures, and the standard cannot know whether a viewer is susceptible. A 5 Hz flash on a public dashboard is not "following the human factors literature"; it misapplies a control-room rule to a population that was never screened.
2. **A closed, medically screened operator population** (the domain these documents were written for): 3–5 Hz remains defensible — but then **fail-steady**, roughly equal on/off intervals, synchronisation, and a flash-suppression control become mandatory.
3. **In all cases, provide a reduced-motion path.** WCAG **2.3.3** (AAA) requires interaction-triggered motion animation to be disableable unless essential; honour `prefers-reduced-motion`.

Two constraints apply regardless of population. **Never put flash or refresh near 15–20 Hz** — *"Flash or display refresh rate shall not be within the 15-20 Hz range"*, because *"people who are sensitive to seizures may have seizures induced by flashing screen cursors or by flickering displays, particularly near the 15-20 Hz range"* (FAA §7). And **a pulse must be long enough to be seen** — the rate must let both onset and end of the pulse fall between saccadic eye movements, *"about one third of a second"* (NASA §8.7.9.3).

### Non-negotiable companion rules

| Rule | Value | Source |
|---|---|---|
| **Fail-steady** | flashing lights **must illuminate and burn steadily** if the indicator is energised and the flasher fails | NASA §10.9.2.5.1; FAA §7 (*"the light shall remain ON"*) |
| Flasher failure mode | the element **shall assume a highly salient state** (high flash rate or steady ON), not a less salient one such as off; the code must be **unique** to avoid confusion between new and acknowledged | NUREG Rev.1 §4.8.1-4 |
| Flasher failure mode (Rev.4 restatement) | in case of flasher failure an **unacknowledged alarm should assume a highly conspicuous state, such as a steady "on" state, rather than a less conspicuous state, such as "off"** | NUREG **Rev.4** §4.4.1-4 |
| **Text must not flash** | *"Characters that must be read shall not flash; an adjacent flashing symbol or flashing background may be used"* | MIL-STD §5.2.2.3.4.e; FAA §7 |
| **Unacknowledged VDU messages: text must not flash** | on a VDU the **message text itself should not flash**; an **adjacent flashing symbol** indicates the unacknowledged message | NUREG **Rev.4** §4.2.3-2 |
| Flash an **adjacent marker**, not the item | an asterisk or arrow that flashes, rather than the item itself | FAA §7; NUREG Rev.1 §1.3.10-10 |
| **Only a small area** may flash | a small area of the screen, at any one time | MIL-STD §5.2.2.3.4.g; NUREG Rev.1 §1.3.10-11; FAA §7 |
| **Synchronise** same-rate flashers | items flashing at the same rate **shall** be synchronised | MIL-STD §5.2.2.3.4.d; FAA §5.4.2.2.1 |
| **Higher rate = more critical** | with two rates, the higher applies to the more critical information | NUREG Rev.1 §1.3.10-15; MIL-STD §5.2.2.3.4.c |
| **Suppression control required** | an acknowledgment or flash-suppression control **shall** be provided | MIL-STD §5.2.2.3.4.f; NUREG Rev.1 §1.3.10-13; FAA §7 |
| Flashing increases search time | *"Flash coding generally increases search times, especially in dense displays"* | NUREG Rev.1 §1.3.10-9 |

**Flashing text, if you must.** The only figures are far slower than for indicators, and they disagree — **take the slower (FAA's); both clear the WCAG cap:** FAA §7 gives **1/3 Hz to 1 Hz** at **70 % on**; MIL-STD §5.7.3.2.4.b gives cautions in flashing text **not greater than 2.0 Hz** at about **70 % on**, with caution signals **yellow** and, where used with warnings, **not more than half the intensity** of the warning signal.

---

## Alert states: new, acknowledged, cleared

Rev.4 gives this its own state model, and it is the part most modern toast/notification systems omit — they model "shown" and "gone", not three distinguishable states. **Unacknowledged, acknowledged, and cleared states should have unique presentations** to support rapid distinction (NUREG Rev.4 §4.2.3-1).

| State | Required presentation | Source |
|---|---|---|
| **New / unacknowledged** | indicated **both by visual (e.g. flashing) and audible means**; on a VDU the **message text itself should not flash** — an **adjacent flashing symbol** marks it | NUREG Rev.4 §4.2.3-2 |
| **Acknowledged** | the display changes to a **visually distinct acknowledged state**. The acknowledge function must change the visual coding **from that indicating an unacknowledged alarm to a visually distinct "not cleared" state** — e.g. **flashing → steady** | NUREG Rev.4 §4.2.3-4, §4.3.3-1 |
| **Cleared / ringback** | the return to normal is indicated by **visual and audible means**. Ringback is *not* required for every alarm but **is required when the user must know immediately that the deviation cleared, or when it is not expected to clear for some time**. Technique: a **special flash rate — one-half the normal rate is preferred, to allow discrimination** — or reduced brightness, or a special colour | NUREG Rev.4 §4.2.3-5 |
| **Cleared-alarm audio** | a **dedicated, distinctive** signal, **of finite and relatively short duration**; incoming and clearing tones must be **separate and distinct** | NUREG Rev.4 §4.2.3-5, §4.2.6.3-4 |

**A cleared alarm needs its own signal, not merely the absence of the alert.** That is the whole point of ringback, and it is why "remove the row from the list" is an incomplete implementation of "clear".

**Three rules that most implementations get wrong:**

- **Re-entering the abnormal range must present as a NEW alarm.** A parameter that re-enters after clearing but before reset produces visual and auditory signals as for new alarms. For **oscillating** parameters, processing should prevent frequent recurrence from becoming distracting — e.g. require the value to move **further into** the normal range before the alarm clears, or to remain in range for **a particular amount of time** (§4.2.3-6). This is a *hysteresis* requirement, not a rate limit.
- **Suppressed codes must be restored automatically** — codes auto-suppressed or delayed under high alarm volume or by more important alarms must be **presented automatically once the more important alarms are addressed**, and personnel **should not be required to remember to request** them (§4.2.6.2-8). If an unacknowledged alarm's tone auto-silences, a **reminder tone** must be presented; likewise when suppressed codes are restored the system should **remind the user by visual or auditory signals** (§4.2.6.3-5). The auditory alert mechanism should **automatically reset when silenced** (§4.2.6.3-6).
- **Reset is a separate control from acknowledge.** The **reset** function places an alarm in an **unalarmed state after the condition has cleared**, silences any audible clearance signal, extinguishes the light, and returns the alarm to inactive (§4.3.4-1; some alarms may have automatic reset). Use **manual** reset where it is important to explicitly inform users of a cleared condition that was once deviant — **do not** use automatic reset there; use **automatic** reset where users must respond to numerous alarms or a fast reset is essential — **do not** use manual reset in high-workload situations (§4.3.4-2, §4.3.4-3). Reset should be effective **only from locations at which personnel know which alarm they are resetting** (§4.3.4-4).

**Display functions.** The alarm display must support rapid discernment of (a) **priority** (urgency of action and importance to safety); (b) the **distinct alarm states — new, acknowledged, cleared**; (c) **first-out** alarms for reactor trip; (d) the **need to access other displays** to verify or clarify alarm state; and (e) the difference between alarms clearable by **ongoing corrective actions** and those requiring **significant maintenance intervention** — NUREG Rev.4 §4.2.1-1.

---

## Auditory alerts

### Frequency, loudness, and ceilings

| Requirement | Value | Source |
|---|---|---|
| Warning-signal frequency range | **200–5,000 Hz**, preferably **500–3,000 Hz** | FAA §5.5.2.7.2 |
| Tonal signals / discrete frequency codes | centre frequencies widely spaced within **500–3,000 Hz** (**200–5,000 Hz** may be acceptable) | NUREG Rev.1 §4.5.6.3-15, §1.3.11-27 |
| FM signal centre frequency | **500–1,000 Hz** | NUREG Rev.1 §4.5.6.3-18; §1.3.11-26 |
| Alerting signal band | **250–8,000 Hz** | MIL-STD §5.3.1.5.7.g |
| Alarm spectral content | **0.2–4 kHz**; ISO 7731:2003 specifies **0.3–3 kHz** with sufficient energy **0.3–1.5 kHz** | NASA §10.9.2.2 |
| Fundamental of a fused multi-component alarm | **0.15–1 kHz**, with **four or more harmonically related** components | NASA §10.9.2.2 (Patterson 1982) |
| Above prevailing ambient noise | at least **10 dB(A)**, or **5 dB(A)** above any maximum sound level of 30 s duration, whichever is louder | FAA §5.5.2.8.3 |
| Alternative framing | **10 dBA SPL** above ambient, **or 20 dBA SPL** above the amplitude of the masked threshold | FAA §5.5.2.7.1 |
| Above average control-room ambient | **10 dB(A) above average ambient noise** — *"generally considered adequate"* | NUREG Rev.1 §4.5.6.3-9 |
| **Rev.4 — level above ambient (two-point curve)** | **10 to 20 dB above average ambient noise, for quiet (below 45 dBA) and noisy areas respectively** — *"generally considered adequate"* | NUREG **Rev.4** §4.2.6.3-9 |
| Signal-to-noise ratio | at least **10 dB** in at least one octave band between **200 and 5,000 Hz**, at the intended receiver's operating position | MIL-STD §5.3.1.4.1 |
| Above the masked threshold (ISO 7731:2003) | **13 dB** in one or more **one-third octave** bands where the alarm resides, at head location | NASA §10.7.4.3; §10.9.2.1 |
| Commonly cited target | **15 dB(A)** — but this *"disregards the frequency content (spectra) of the alarm or the noise"* | NASA §10.9.2.1 |
| Above the critical band | **20 dB** above the noise level in the critical band for all major signal components | MIL-STD §5.3.1.2.3.b(5) |
| Verbal alarm above speech interference level | not less than **20 dB**; SNR at least **5:1** | MIL-STD §5.3.1.5.2; NUREG Rev.1 §1.2.11-9 |
| Emergency / evacuation signals | ceiling **115 dB(A)** | FAA §5.5.2.8.4 |
| All non-emergency signals | ceiling **90 dB(A)** | FAA §5.5.2.8.5 |
| General alarm sound level | **95 dB(A)**; **115 dB(A)** only if *"absolutely necessary"* for alarms indicating extreme danger. **Rev.4 adds a hard stop: signal levels above 115 dBA should not be used** | NUREG Rev.1 §4.5.6.3-9; NUREG **Rev.4** §4.2.6.3-9 |
| At the ear of the listener | **115 dB**; shall not cause discomfort or "ringing" | MIL-STD §5.3.1.4.3.e |
| Spacecraft, at the ear | **85 dB(A)** in orbit; **115 dB(A)** during launch or reentry | NASA §10.9.2.5 |

**MIL-STD's 250–8,000 Hz band is the outlier.** FAA, NUREG, and NASA all cluster on a **200–5,000 Hz** outer band and a **500–3,000 Hz** preferred band; take the cluster, since it is least affected by high-frequency hearing loss and by the fact that *"higher frequencies are blocked by solid objects while lower frequencies bend around them"* (NASA §10.9.2.2).

**On loudness: these are not four answers to one question; do not average them.** The **10 dB(A) above overall ambient** figures (FAA, MIL-STD, NUREG) are **broadband**, cheap to verify with a sound-level meter. The **13 dB above the masked threshold** and **20 dB above the critical band** figures are **spectral**, and stricter because overall level hides the case that actually breaks alarms: a steady ambient tone sitting on the alarm's own frequency. NASA §10.9.2.3 gives the concrete failure — *"if a fan has a constant harmonic tone with significant energy at 1 kHz, an alarm with a constant tone may not be an ideal type of alarm even if its frequency components conform to ISO 7731:2003 by being 13 dB over the fan's tone."* The **15 dB(A)** figure is *reported as* commonly cited, and NASA immediately qualifies it. **Practical rule:** 10 dB(A) above ambient is the floor for a consumer app whose ambient soundscape is unknown; 13 dB above the masked threshold in at least one one-third-octave band is the target where alarms are safety-relevant.

**Rev.4 refines the broadband rule into a two-point curve rather than a single number: 10 dB above ambient in quiet areas (below 45 dBA) and 20 dB above ambient in noisy areas** (NUREG Rev.4 §4.2.6.3-9). Rev.1's flat *"10 dB(A) above average ambient noise"* (Rev.1 §4.5.6.3-9) is the quiet-area end of that curve. **This is a real tightening, and it matters:** a single flat 10 dB figure under-alerts in a noisy environment, which is exactly where the masking problem the spectral figures describe is worst. MIL-STD's own advisory-signal rule agrees independently — in quiet areas (**below 45 dBA**) advisory signals should be presented at **50 to 70 dBA** (MIL-STD §5.3.1.2.4.a) — so use Rev.4's curve.

**On ceilings, note the disagreement:** a non-emergency alert at 95 dB(A) is over FAA's non-emergency ceiling of **90 dB(A)** but under NUREG's general maximum of **95 dB(A)** — **the lower ceiling for the lower severity is the safe reading** (FAA §5.5.2.8.5). Rev.4 states the same 95 dBA / 115 dBA pair as Rev.1 and adds a hard stop: **signal levels above 115 dBA should not be used** (NUREG Rev.4 §4.2.6.3-9).

**Do not induce startle.** The increase in sound level during any **0.5-second period shall be not greater than 30 decibels**, and *"the first 0.2 second of a signal shall not be presented at maximum intensity, use square topped waveforms, or present abruptly rising waveforms"* (MIL-STD §5.3.1.4.2.a). NASA gives two constructive techniques (§10.9.2.4): a **precursor alert** played **6 to 10 dB lower** on first presentation than on successive ones, and a **pulse envelope** with rise and fall time equal to **10 to 20 %** of the pulse duration. Recognition budget: a warning **shall** be unambiguously recognisable as a warning **within 0.5 second**; a single-element signal must convey full meaning within that 0.5 s; a two-element signal within **2.5 s** worst case (MIL-STD §5.3.1.3.1).

### How many distinct sounds

**A very tight budget, and the most commonly blown constraint in real apps.**

| Requirement | Value | Source |
|---|---|---|
| Absolute identification of audio signals | should **not exceed four** | FAA §5.5.2.2.1; NASA §10.7.3.1 |
| Absolute identification ceiling (hard limit) | humans identify a **maximum of 5 or 6** things absolutely, without direct comparison | NASA §10.7.3.1 |
| Abstract alarm set | **four** for easy acquisition; three additional become *"far more difficult"* | NASA §10.9.2.3 (Patterson 1982) |
| Relative discrimination | should **not exceed 12** | FAA §5.5.2.2.2 |
| Simple single-dimension signals | should **not exceed four** if varying on one dimension only, such as frequency | NUREG Rev.1 §1.3.11-8 |
| Tonal (pitch) coding | **no more than three frequencies**, and they must **not** be in a **2:1** ratio with one another | NUREG Rev.1 §4.5.6.3-14 |
| Discrete frequency codes | **no more than 4 separate frequencies** | NUREG Rev.1 §1.3.11-27 |
| Compound codes (two or more dimensions) | **maximum of nine** auditory signals — including signals outside the control room | NUREG Rev.1 §4.5.6.3-20 |

**Note the internal NUREG disagreement** — §4.5.6.3-14 says no more than **three** frequencies (*"operators may not reliably distinguish among more than three pitch codes"*) while §1.3.11-27 permits **four**. The same section resolves it: *"For critical alarms with differing response requirements, the more conservative guidance should be followed. If more than three critical alarms are to be coded, it is preferable to combine pitch with another dimension."* **Three pitch codes plus a second dimension**, not four pitch codes. FAA's rationale is the design instruction: *"between 4 to 7 alarms can be acquired reasonably quickly, performance decreases dramatically for additional alarms"* (§5.5.2.2.1, source Discussion). NASA requires **one meaning per audio signal** — *"Each audio signal should have only one meaning"* (§10.7.3.1) — with the *"attention-gaining characteristics of the signals in a set (e.g., rapidity of pulse pattern, frequency, and intensity)"* matching the relative priority.

### Pulse rates, warble, and temporal patterns

| Requirement | Value | Source |
|---|---|---|
| Modulated warning signals | **1–8 beeps per second**, or warbling with pitch rise and fall of **1–3 cycles per second** | FAA §5.5.2.5.3 |
| Pulse repetition rates | **no more than three** rates, **between 1 and 8 pulses per second** (faster may not be perceived as pulses), separated by **a factor of 2** | NUREG Rev.1 §4.5.6.3-16; NUREG **Rev.4** §4.2.6.3-16 |
| Frequency-modulated codes | **no more than three**; warble **1–3 times per second** | NUREG Rev.1 §4.5.6.3-17; NUREG **Rev.4** §4.2.6.3-17 |
| Tones active at the same time | frequencies separated by **at least 20 % of the centre frequency**, to avoid mutual masking | NUREG Rev.1 §4.5.6.3-7; NUREG **Rev.4** §4.2.6.3-7 |
| Intensity (loudness) coding | **should not be used**; if it must be, **no more than two levels** differing by **at least 6 dB(A)** | NUREG Rev.1 §4.5.6.3-21; NUREG **Rev.4** §4.2.6.3-21 |
| **Tone "burst" pattern** | bursts of **five or more brief pulses (about 0.1 s each)**; pulses may differ in onset/offset shaping, fundamental frequency, and harmonic structure; bursts may vary in number of pulses, tempo, and rhythmic and pitch contours | NUREG Rev.1 §4.5.6.3-19; NUREG **Rev.4** §4.2.6.3-19 |
| **Tone "burst" inter-pulse interval — the revisions disagree** | Rev.1: **.15 to 3 seconds**. Rev.4: **.15 to .3 seconds** | NUREG Rev.1 §4.5.6.3-19 vs NUREG **Rev.4** §4.2.6.3-19 |
| **Speech alone is not recommended (Rev.4)** | *"Using speech alone for presenting alarm information is not recommended"* — speech only **in conjunction with other methods** | NUREG **Rev.4** §4.2.6.3-22 |
| **Startle minimisation (Rev.4)** | audio signals should be designed to **minimise irritation and startle** — reliably capture attention without being unpleasant | NUREG **Rev.4** §4.2.6.3-10 |

Temporal pattern is the most robust identifying dimension: *"temporal pattern — the sequence of 'on' and 'off' iterations of the alarm sound — is easily heard and discriminated by a listener"* (NASA §10.9.2.3). Two worked patterns: ANSI S3.41's evacuation signal is **three "on" pulses each with a one-second period, followed by 1.5 s of silence**; ISO 1994's alarm "burst" is multiple pulses with a **0.15 to 0.5 s** silent interval between them, and an inter-burst interval between bursts — the silent intervals exist so users can *"think, verbally communicate, and take action in a constructive manner, compared to the counterproductive use of a constant alarm."*

**Prefer pulse-coding to duration-coding.** NASA records a real system that encoded lamp identity in blink frequency: *"the observer must decode the visible flash pattern using their sense of time passage, which is usually poor."* The fix was counting pulses instead — one pulse, two pulses, three pulses, each followed by a silent period (§8.7.9.3). Pulse **count** is reliable; pulse **duration** is not. **Cadence must track severity:** a safety-critical message may be redelivered **every 30 seconds** until rectified, critical alarms *"should continuously sound until acknowledged"*, and noncritical messages less often — because *"Presenting unimportant or noncritical messages to the user at very short intervals will cause the user to become desensitized to them"* (NASA §10.8.3). MIL-STD §5.3.1.5.6 requires critical warning signals to repeat **with not more than a 3.0-second pause** between messages until corrected or overridden. Use **intermittent, not continuous, tones**: *"Continuous tones are the most easily confused signals, even if they vary considerably in pitch. Furthermore, the human auditory system quickly adapts to continuous auditory stimulation"* (FAA §5.5.2.5.1).

### Loudness must not be user-adjustable

> *"Manual disable or adjustment of auditory signal intensity (loudness) should be **avoided**… **Under no circumstances should operators be able to disable audio alarm signals or reduce their level so as to render them inaudible.**"* — NUREG-0700 Rev.1 §4.5.6.3-11

NASA states the same as a scoping carve-out: volume from **5 % to 100 %** of maximum is provided for channels carrying aural annunciations, *"with the exception of caution and warning signals. Analogous to safety requirements in commercial aircraft, **the crew does not adjust the caution and warning audio levels.** Caution and warning audio levels should be adjusted relative to the predicted background noise level"* (§10.7.5.2). The same reasoning justifies the **5 %** floor on the *other* channels: *"it should not be possible to inadvertently disable the system with the volume control"* (§10.7.6). FAA's counterpart is that the user must still be able to **silence without erasing** — *"a simple means for turning off non-critical auditory alarms **without erasing any displayed message** that accompanies the auditory signal"* (§5.5.2.9.2).

**Reconciling with WCAG 1.4.2 (A).** WCAG requires audio playing automatically for more than **3 seconds** to be pausable/stoppable or volume-controllable independently of system volume. This is not a genuine conflict: WCAG 1.4.2 carries an **"essential"** exception, which a system status alarm occupies; and the two govern different things — the ergonomics rule fixes a **level floor** and forbids a **permanent user-set attenuation**, whereas acknowledge-and-silence turns off *this* alarm's sound for *this* event and is a persistence mechanism, not an intensity adjustment. **Implement:** no user-facing volume slider for alert tones; acknowledgement that silences a specific alert while leaving its visual message on screen; all other audio on a 5–100 % control. Also note WCAG **1.4.7** (AAA): background sounds must be absent, turn-off-able, or **≥20 dB** lower than foreground speech.

---

## Message wording and structure

### Wording rules

| Rule | Source |
|---|---|
| Messages focus on **what needs to be done, not on what was done wrong** | FAA §5.6.14.4.1.5 |
| Error messages **shall be brief, specific, and task-oriented**, and worded as **advice or suggestions** | FAA §5.6.15.10.2.9, §5.6.15.10.2.11 |
| **Goal first, then action** — *"To delete text, press Enter,"* not *"Press Enter to delete text"* | FAA §5.6.15.10.2.10; NASA §10.7.3.2 |
| State **the error detected, the input field containing it, and the corrective action** | FAA §5.6.15.10.2.7 |
| Be specific: *"Code format not valid: 2 letters, then 3 digits"* beats *"Invalid input"* | NUREG Rev.1 §2.4.5-1 |
| Language meaningful to users, requiring **no further documentation or translation**; no extraneous data | FAA §5.6.14.4.1.4; NUREG Rev.1 §2.4.1-6 |
| **Direct the wording at the operator** — *"Press ENTER to continue"*, not *"The operator should press ENTER"* | NUREG Rev.1 §2.4.1-5 |
| Consistent grammatical construction; familiar terminology; concise and clearly worded | NUREG Rev.1 §2.4.1-2, §2.4.1-3, §2.4.1-4 |
| **Avoid anthropomorphism** — no *"I AM LOADING YOUR FILE NOW"* | NUREG Rev.1 §2.4.1-7 |
| Name the parameter specifically — *"HIGH PRESSURE"*, not *"TEMPERATURE-PRESSURE"* or *"HIGH-LOW"* | NUREG Rev.1 §4.5.5.1-2 |
| **Short, direct, active voice**, matched to the target population's literacy and reading skills | MIL-STD §5.7.2.2 |
| A hazard warning must state **the hazard, how to avoid it, and the consequences of not avoiding it** | MIL-STD §5.7.2.1.2 |
| Reading level beyond **lower secondary education** requires a simpler version to be available | WCAG 2.2 **3.1.5** (AAA) |

MIL-STD's three hazard elements are the best template for a destructive-action dialog: *what will happen*, *how to prevent it*, *what happens if you don't*. NUREG's copy example is reusable: *"CONFIRM deletion of entire FEEDWATER file?"* beats *"CONFIRM DELETE"*, and when a whole file is to be deleted, enough information (name, description, size, date established, date last changed) should be shown to verify the target (§2.7.3-2).

### Progressive disclosure of error detail

| Rule | Source |
|---|---|
| **Multilevel messages** — more than one level **shall** be provided, successive levels giving increasingly detailed explanation; the user requests the deeper level (e.g. a *Show more* button) | FAA §5.6.15.10.2.3, §5.6.15.10.2.8; NUREG Rev.1 §2.4.5-11 |
| **Multiple errors** — describe the **first**, state the **total number of additional errors**, move the cursor to the first, offer sequential display of the rest. NUREG's pattern: *"DATE should be numeric [+ 2 other errors]"*, other error fields highlighted | FAA §5.6.15.10.2.4; NUREG Rev.1 §2.4.5-13 |
| **Repeated errors must change** — reword from the **third** repetition onward; NUREG requires *"a noticeable change"* | FAA §5.6.15.10.3.8; NUREG Rev.1 §2.4.5-9 |
| **Never interrupt an in-progress transaction** — an error appears only **after** an explicit ENTER action, not as wrong data are keyed | NUREG Rev.1 §2.4.5-4; FAA §5.6.15.10.2.5 |
| **Put the error where the error is** — *"at the point of the error or in a consistent area of the display"*; after acknowledgement the dialog disappears and **the field containing the error is highlighted**; a dialog **should not be placed in front of the error** it describes | NUREG Rev.1 §2.4.5-14; FAA §5.6.14.4.8.5, §5.6.14.4.8.4 |

### Dialog types, symbols, and button sets

The most concrete table in the chapter — copy it into a component API.

| Window type | Symbol | Buttons, in the order listed | Modality / behaviour | Source |
|---|---|---|---|---|
| **Request** | `?` | `OK`, `Apply`, `Reset`, `Cancel`, `Help` — *"all of the following push buttons that apply in the order in which they are listed"* | — | FAA §5.6.14.4.2.2 |
| **Information** | `i` | `OK`, `Help` | **Modal, requiring acknowledgement**; *"There shall not appear to the user to interrupt processing"* | FAA §5.6.14.4.3.3, §5.6.14.4.3.2, §5.6.14.4.3.4 |
| **Confirmation** | `?` | `{Yes, No, Help}` **or** `{Yes, No, Cancel, Help}` | *"Confirmation messages should be simple, positive, and direct"* (NUREG Rev.1 §2.7.3-1) | FAA §5.6.14.4.4.3 |
| **Warning** | `!` | `{Yes, No, Help}` **or** `{OK, Cancel, Help}` | *"Warning messages should be accompanied by an audible signal"* | FAA §5.6.14.4.5.3, §5.6.14.4.5.4 |
| **Working** | watch / clock / hourglass | `{OK, Help}`, `{OK, Cancel, Help}`, `{OK, Stop, Help}`, or `{OK, Pause, Resume, Stop, Help}` | Must **not** interrupt processing; remains until processing completes; removed automatically on completion | FAA §5.6.14.4.6.5, §5.6.14.4.6.2–.4 |
| **Error** | error symbol | `OK`, `Cancel`, `Help` | **Modal, requiring user acknowledgement in order to continue** | FAA §5.6.14.4.8.1, §5.6.14.4.8.2 |

The symbol convention is normative: *"i for information messages; ? for request and confirmation messages; ! for warning messages; and a watch, clock, or hourglass for working messages"* (§5.6.14.4.1.2). Every message window contains a **title, a type symbol, the message, and one or more push buttons**; an alert box must carry **an icon indicating the degree of severity** (§5.6.14.4.7.15). **Button order is not stylistic** — left-to-right (or top-to-bottom), *"according to frequency of use, sequence of use, or with **positive actions at the left or top and negative or canceling actions at the right or bottom**"* (§5.6.14.2.8.6); `Help`, when outside a menu bar, goes at the **bottom right corner** of the working area (§5.6.14.2.8.5).

| Default button contract | Value | Source |
|---|---|---|
| Number of defaults | **no more than one** | FAA §5.6.14.2.8.7 |
| Location | leftmost or topmost | FAA §5.6.14.2.8.8 |
| **Destructive actions must never be the default** | a button assigned a potentially destructive action **shall not** be the default | FAA §5.6.14.2.8.9 |
| **Enter must not confirm a destructive action** | *"The Enter key shall not be used for confirmation of destructive actions"* | FAA §5.6.15.10.1.12 |
| Visually distinguishable | extra border, highlight, or 3-D appearance | FAA §5.6.13.5.12 |
| Placement | top, bottom, or sides of the working area, in a row or column **centred with the window** | FAA §5.6.14.2.8.1–.2 |

**Modal vs. modeless.** Modeless for getting input and changing a document; modal only *"for serious problems for which an explicit response is required of the user before continuing"* (FAA §5.6.14.4.7.1–.2, §5.6.14.3.1.18). An application *"should primarily use movable dialog boxes; the user can reposition these to view obscured data"* (§5.6.14.4.7.13). Message windows **may not be minimized or resized** (§5.6.14.4.1.1); they should be *"just large enough to display the information required"* (§5.6.14.4.1.6) and *"located in a standard location on the screen"* (§5.6.14.4.1.7).

### Transient status: thresholds and the message bar

| Trigger | Required response | Source |
|---|---|---|
| Operation > **2 s** and cannot accept further input | *"it shall inform the user that action is continuing"* | FAA §5.6.15.7.5 |
| Processing time will exceed **2 s** | **shall** display a working message window | FAA §5.6.14.4.6.1 |
| Response > **2 s** | **shall** provide periodic feedback indicating normal operation | FAA §5.6.15.7.7 |
| Operation > **2 or 3 s** and blocks the application | may change the cursor shape; the status cursor must be **distinct from the normal cursor** | FAA §5.6.13.10.4 |
| Delay likely to exceed **15 s** | the user should be informed | FAA §5.6.15.7.8 |
| Entry invalid or inoperative at selection | **no action except an advisory message** stating the error and the appropriate functions/options/commands | FAA §5.6.15.10.3.4; NUREG Rev.1 §2.4.5-5 |
| Stacked-command error | notify and give correction/completion/cancellation guidance **within 4 s** | FAA §5.6.15.10.3.7 |

The dynamic-feedback rationale is directly implementable: *"the message might display the percent of processing that has been completed or that remains… When this is not possible, a display that changes with time is still desirable (for example, a row of dots with a new dot added periodically)"* (FAA §5.6.15.7.5). NUREG's counterpart: **successive periodic messages should differ in wording** so the user can tell the message updated — *"Processing search -- please wait"*, then *"Search continuing -- please wait"*, then *"Processing search -- wait please"* (§5.6.15.7.4).

**Message-bar mechanics** (FAA §5.6.14.2.5.1–.9): at the **bottom of an active window**, **read-only and non-scrolling**, **left** side for routine help and status, **right** side for window information such as object name or page number; it **automatically removes messages that are no longer relevant**; messages too long for the bar go to a message dialog box. The command entry area, when present, sits **across the bottom of the window just above the message area** (§5.6.14.3.2.10). Three rules keep a status message from being read as an error: routine-message wording must make clear it is *"status or feedback information, not … errors or requests for a user action"* (§5.6.15.9.3); the system **shall** give consistent routine feedback for control entries, processing, and print requests (§5.6.15.9.1); and *"the absence of computer response is not an acceptable means of indicating that an entry is being processed"* (NUREG Rev.1 §2.1-13).

---

## Placement and visual weight

### Alarm brightness and the two-level rule

| Requirement | Value | Source |
|---|---|---|
| **VDU bright state** | at least **100 % brighter than the inactivated / normal state**; **VDU displays limited to only two brightness levels** — Rev.4 restates the identical values | NUREG Rev.1 §4.5.6.2-5; NUREG **Rev.4** §4.2.6.2-5 |
| Transilluminated (lighted tile) states | Rev.1: brightest no more than **300 % brighter than the inactivated state**; dim state at least **10 % brighter**. Rev.4: dim state (if used) at least **10 % greater than the inactivated state**; brightest **not more than 300 % of the surrounding luminance**; **no more than three levels** | NUREG Rev.1 §4.5.6.2-4; NUREG **Rev.4** §4.2.6.2-4 |
| Alert indicator lights vs. other indicators on the panel | at least **three times brighter** | NASA §10.9.2.5.1 |
| General brightness coding | **no more than two levels**, each separated from the nearest other level by **not less than a 2:1 ratio** | MIL-STD §5.2.2.3.3.b |
| Brightness as a code | two-valued only — **bright and dim** — and **not** used with shape or size coding | NUREG Rev.1 §1.3.10-5 |
| Which level means what | **high brightness = primary importance**, lower = secondary | NUREG Rev.1 §1.3.10-6 |
| Reference intensities for the two levels | approximately **33 %** and **100 %** of display luminance | NUREG Rev.1 §1.3.10-7 |

**The numbers disagree, and the disagreement is informative.** NUREG says a VDU's bright state is *"at least 100 percent brighter"*; NASA says an alert indicator is *"at least three times brighter"* than other indicators on the same panel; NUREG caps transilluminated tiles at *"no more than 300 percent brighter."* These are different display technologies and different comparisons (absolute luminance vs. relative to co-located indicators). The implementable form: **for an emissive screen, target ≥2× the inactivated luminance, cap brightness levels at two, and keep them at least 2:1 apart** (MIL-STD's separation rule). NUREG also warns against one specific combination: **avoid low-intensity indications such as dark red in the periphery of the visual field** where colour coding is used, *"since they may not be readily detected"* (Rev.1 §4.5.6.2-6; Rev.4 §4.2.6.2-6 restates it). Adjacent areas of a focused window are frequently peripheral — a real bug source in wide dashboards.

**Two Rev.4 differences to preserve rather than merge:**

- **The 300 % tile figure has a different reference point.** Rev.1 compares the brightest state to the tile's **own inactivated state**; Rev.4 compares it to the **surrounding luminance**. Not the same measurement, and Rev.4's is the more meaningful for an annunciator panel, since what must be limited is the *contrast against the panel* rather than against an unlit lamp.
- **Level counts differ by display type.** Rev.4 permits transilluminated (tile) displays **no more than three** levels while limiting **VDU displays to two** — Rev.1 gave no tile count. For a software UI the relevant figure is the VDU one: **two levels**.

### What must remain unobscured

| Requirement | Source |
|---|---|
| It should **not be possible** to position windows so that **menu bars, access to the command area, or caution and warning messages are obscured** | NUREG Rev.1 §2.5.6-22 |
| The **active window shall not be obscured** by any other window or icon; upon activation the window with input focus **shall be made wholly visible** | FAA §5.6.14.5.3.3, §5.6.14.5.4.4 |
| **Critical information shall not be obscured during window resizing** | FAA §5.6.14.6.2.4 |
| Windows should be large enough to present all relevant information, **not obscure important information**, not crowd, minimise scrolling; overlapping windows should not cover needed underlying screen information, **the underlying screen title**, or navigation controls | FAA §5.6.14.1.4, §5.6.14.7.1.4 |
| Window overlays **shall be nondestructive**; **overlaid data shall not be permanently erased** | FAA §5.6.14.7.1.5–.6 |
| Displayed information that temporarily overlays and obscures other data should **not erase the overlaid data** | NUREG Rev.1 §1.1-51 |

**Warnings go frontmost; nothing covers a warning.** That is the operative reading of the NUREG prohibition — a modal error dialog covering the banner that shows an active critical warning is a defect, and so is a toast stack that grows over the region where warnings appear. FAA also requires **reserved areas**: prompts, menu bars, command lines, and message areas *"shall appear consistently in the same screen location throughout the system or application"* (§5.6.1.3.2) — a moving alert region defeats the point of spatial coding.

**Use spatial coding deliberately.** *"Spatial coding may be used to indicate alarm importance. In an otherwise variable alarm display, having a dedicated or consistent location for presentation of important alarms will enhance operators' ability to detect them"* (§4.5.6.2-7). For priority, *"colour, position, shape, and symbolic coding"* are acceptable and **colour and position (top to bottom) are especially effective** — but coding priority by position **can disrupt functional grouping** and should not be used where that grouping matters (§4.5.2-3). **Status indications generally should be presented on a separate region from alarm indicators** (FAA §5.5.1.2.11), because *"status indication is not intended to alert the user to the need for action. When status indication is presented together with alarm information, it can increase the demands on the user."* And **alert lights belong next to the control that resolves them** — *"Warning lights shall be an integral part of, or located adjacent to, the lever, switch, or other control by which the user is to take action"* (MIL-STD §5.2.3.13.11) — with master warning/caution/advisory indicators **set apart** from component status lights (§5.7.3.2.7, §5.2.3.13.9). Translation: an alert's **action** must be reachable from the alert, and an aggregate "N warnings" indicator must not be visually mixed with per-item status dots.

---

## Scaling and flood control

The numbers are small because the sources assume a wall of annunciator tiles; the **principles** transfer directly to a notification centre or log view.

| Requirement | Value | Source |
|---|---|---|
| Alarm tile display matrix | **maximum of 50 alarms per matrix; smaller matrices preferred** — **Rev.4 restates the identical value** | NUREG Rev.1 §4.5.7.1-5; NUREG **Rev.4** §4.2.7-6 |
| Separation in alphanumeric alarm lists | a **blank row every four or five** messages | NUREG Rev.1 §4.5.7.2-3; NUREG **Rev.4** §4.2.8-3 |
| Adding to a message list | the method **should preclude message scrolling**; *"paging is preferred"*; overflow kept on **subsequent pages**, important information **must not be truncated**, and the system should **clearly indicate that more information is available on subsequent pages** | NUREG Rev.1 §4.5.7.2-4, §4.5.7.2-5; NUREG **Rev.4** §4.2.8-4, §4.2.8-5 |
| High-priority alarms | enough area for **simultaneous viewing of all** of them **under the worst credible conditions**; nonspatially dedicated lists should generally **not** be the primary method for high-priority alarms; *"Operators should never have to page or scroll a display to view high-priority alarms"* | NUREG Rev.1 §4.5.2-2; NUREG **Rev.4** §4.2.2-2 |
| List ordering | **segregated by priority, highest first**; alternatively by operationally relevant category — **function, chronological order, status** (unacknowledged, acknowledged/active, cleared) — with most recent at the top (**pushdown stack**). Grouping alternatives **must not** interfere with detection of high-priority alarms | NUREG Rev.1 §4.5.7.2-1, §4.5.7.2-2; NUREG **Rev.4** §4.2.8-1, §4.2.8-2; MIL-STD §5.7.3.2.6 |
| Coordinate labeling of matrices | both axes labelled with alphanumerics; **preferred on the left and top sides** | NUREG Rev.1 §4.5.7.1-4; NUREG **Rev.4** §4.2.7-5 |
| Group labels | each group identified by a **label above the display**; functional groups **visually distinct** | NUREG Rev.1 §4.5.7.1-8, §4.5.7.1-2, §4.5.7.1-3; NUREG **Rev.4** §4.2.7-9, §4.2.7-3, §4.2.7-4 |
| Deduplication | a single alarmed event that invariably leads to subsequent alarmed events: show **the primary event**, **suppress the subsequent ones**, *"so long as this does not interfere with the operators' use of alarm information"* | NUREG Rev.1 §4.3-9; FAA §5.5.1.2.13 |
| **Suppression vs. filtering** | **filtered** alarms (eliminated, unavailable to users) only where messages have **no current operational significance** to monitoring, diagnosis, decision making, procedure execution, and alarm response (FAA §5.5.1.2.12 for the same limit). **Alarms that are merely redundant or lower priority should be SUPPRESSED (retrievable) rather than FILTERED**; retrieving suppressed alarms should **not be excessively complex** and their data must be accessible | NUREG **Rev.4** §4.1.3-2, §4.1.3-3; FAA §5.5.1.2.12, §5.5.1.2.14, §5.5.1.2.15 |
| **Alarm reduction (no numeric target exists)** | the number of alarm messages presented during off-normal conditions should be **reduced** relative to a no-processing baseline, to support detecting, understanding, and acting on all important alarms in the necessary time. The source states explicitly that **no specific degree of reduction is given** — evaluate with operators | NUREG **Rev.4** §4.1.2-2 |
| **Parameter stability processing** | apply **time filtering, time delay, or deadbanding** to alarm inputs to filter noise and eliminate unneeded momentary alarms — noting this **may reduce timeliness** | NUREG **Rev.4** §4.1.2-4 |
| **Alarm routing** | route alarms by intended use: alarms requiring **user action** → user displays/workstations (a subset may be routed where users own only part of the system); alarms answered by **maintenance** → maintenance workstations. Operators must still be **informed of maintenance-routed alarms that have operational significance** | NUREG **Rev.4** §4.1.4-1, §4.1.4-2 |
| **Alarm log** | **an alarm log should be maintained** — supports event analysis; may be a separate log or part of a broader record | NUREG **Rev.4** §4.1.5-1 |
| Under high volume | the *alerting* indication may be suppressed or delayed for conditions that (1) do **not** require immediate response and (2) do **not** challenge safety — but those codes **must be presented automatically afterwards**, and users must **not** have to remember to request them; if an unacknowledged alarm's tone turns off after an interval, a **reminder tone** must be presented | NUREG Rev.1 §4.5.6.2-1, §4.5.6.3-1, §4.5.6.2-8, §4.5.6.3-5; NUREG **Rev.4** §4.2.6.2-8, §4.2.6.3-5 |
| Mode/configuration dependence | alarm only in the modes/configurations where the value is actually a fault | FAA §5.5.1.1.5; NUREG Rev.1 §4.3-7, §4.3-8 |
| Normal-condition quiet | setpoints chosen so **no alarms are active for normal operating conditions** ("darkboard"), balancing that against nuisance alarms from excursions of no consequence | NUREG Rev.1 §4.2-4, §4.2-3 |
| Reduce at source | *"Reduce the number of alarms or alerts to only those most pertinent"*; *"Presenting too many alarms, including low-urgency alarms, may increase false alarms"* | FHWA Guideline 55; Guideline 45 |
| Use sparingly | *"Lights and related indicators shall be used sparingly"* (MIL-STD §5.2.3.13.5); *"Auditory alarms should not be used to indicate normal conditions"* (FAA §5.5.2.1.6) | MIL-STD §5.2.3.13.5; FAA §5.5.2.1.6 |
| Multiple concurrent alerts | it **shall be made clear that more than one alert or warning exists**; multiple alarms displayed **in the order of their priority** | MIL-STD §5.12.3.1.25.a–c |
| Shared alarms — when to combine, when not to | **limit** aggregate alarms (e.g. "Pump Trouble") that force extra user action to find the cause. *May be combined*: the same condition on **redundant components or logic trains** each with its own indicator placed in close proximity; several conditions on one or redundant components requiring further diagnosis; several conditions **calling for the same corrective action**; alarms that **summarise single-input alarms elsewhere**. *Should NOT be combined*: different actions follow depending on which condition exists **and** the constituent is not readily identifiable; information or protection for other constituents is **not available** after one has activated; **the constituent conditions are not of the same importance**. On activation the user must be able to **access the individual alarm information**; the shared alarm indicates the **highest priority of its active individual alarms** | NUREG **Rev.4** §4.2.4-1, Table 4.2, §4.2.4-2, §4.2.9-7; NUREG Rev.1 §4.5.4-1, §4.5.4-2 |
| Reflash | if a new deviation occurs before the previous alarm cleared, the alarm **returns to the new-alarm state** (e.g. flashing) | NUREG Rev.1 §4.5.4-3; NUREG **Rev.4** §4.2.4-3 |
| **Notification of undisplayed alarms** | if the user is **not currently viewing** the display where unacknowledged alarms appear, notify them that **an alarm message is available, its priority, and the location where it can be found** | NUREG **Rev.4** §4.2.3-3 (cf. Rev.1 §4.5.3-3) |
| **Message timestamps** | alarms **time-stamped with the time of occurrence and the time the condition clears**; where multiple systems timestamp alarms, events, and data, **all clocks should be synchronised to a common, correct date and time** | NUREG **Rev.4** §4.2.5-4, §4.2.5-5 |
| Message content, additional fields | identifies the **alarm source**; **setpoint limits** readily available; **deviant parameter values** in VDU/printer messages; **immediate actions** available on request; **links/references to alarm response procedures** (document title and section) | NUREG **Rev.4** §4.2.5-4, §4.2.5-7, §4.2.5-8, §4.2.5-9, §4.2.5-10 |

**Implications for a toast, notification-centre, or log UI:**

- **Bound the visible set** — 50 per matrix is a *recognition* budget; past roughly that many independently-coded items, a live view stops being readable. Aggregate and label.
- **Never make the user scroll to find a high-priority alert** — stated as an absolute. Priority must escape the scroll container: pin critical alerts, or surface a count. Nonspatially dedicated lists should generally **not** be the primary vehicle for high-priority alarms (§4.2.2-2).
- **Group, then separate** — whitespace between groups; the blank row every 4–5 messages is the same idea on a fixed grid. Functional grouping must survive sorting by severity.
- **Suppress consequences, not causes — and prefer suppression to filtering** — deduplication is about *causal chains*: show the cause, collapse the effects behind a count reachable in one action. Filtered alarms are unreachable, so suppress (retrievably) anything merely redundant or lower priority (§4.1.3-2, §4.1.3-3).
- **Model three states, and give "cleared" its own signal** — see the alert-states section above. Add **hysteresis** so an oscillating parameter does not re-alarm on every threshold crossing (§4.2.3-6). Timestamp both occurrence and clear, and **synchronise the clocks** where multiple systems timestamp events (§4.2.5-4, §4.2.5-5).
- **Give each message the fields that make it actionable** — alarm title or legend, alarm source, priority, setpoint and parameter values, required immediate actions, and a reference to the detailed procedure (§4.5.5.1-1; Rev.4 §4.2.5-4, §4.2.5-7–.10). Tile layout: **top line = alarmed parameter, middle line = setpoint value, bottom line = severity** (§4.5.5.2-1; Rev.4 §4.2.5-2).
- **Separate the controls** — silence, acknowledgment, reset, and testing each get their own control, in **the same relative location** across the system, and the design should **not allow the operator to defeat the control** (§4.6.1-1, §4.6.1-3, §4.6.1-5; Rev.4 §4.3.7-1, §4.3.7-3, §4.3.7-6). Silence from anywhere in the primary area (§4.6.2-1), but **acknowledgement only where the alarm message can be read** (§4.6.3-2; Rev.4 §4.3.3-2). Global silence must cover any alarm **visible from** the control, and must **not** silence alarms that **cannot be visually detected** from it (Rev.4 §4.3.2-1) — the second half is the one implementations miss.
- **If the alert is on a screen the user is not looking at, say so — with priority and location** (§4.5.3-3; Rev.4 §4.2.3-3); likewise for critical information arriving in an inactive or non-displayed window (§2.5.6-26).
- **Keep alarm indicators away from non-alarm lights** — non-alarm illuminated displays must not sit so close to alarm displays that they could be mistaken for, or mask, an alarm (Rev.4 §4.6-7).
- **Embedded alarms still need priority and retrieval** — inside process/mimic displays they should be **salient, easily distinguishable**, **consistent across all displays of a type**, with **priority displayed** and **detail easily retrievable** (e.g. clicking the alarm); where not all fit, show those **more important to monitoring and action**, or a **high-level indication that a relevant alarm exists** (Rev.4 §4.2.9-1–.5).

---

## Dismissibility, persistence, and hover content

**WCAG 1.4.13 Content on Hover or Focus (AA)** requires **all three** of the following when hovering or focusing reveals content that is then hidden: **Dismissible** (can be dismissed **without moving hover or focus** — *unless* it communicates an input error, or does not obscure other content); **Hoverable** (the pointer can move **onto** the new content without it disappearing); and **Persistent** (it remains until the trigger is removed, the user dismisses it, **or the information is no longer valid**). Source: WCAG 2.2 **1.4.13** (AA). **Hoverable** is the condition that catches most implementations — a tooltip that vanishes the moment the cursor leaves the trigger fails, and so does one positioned with a gap the pointer cannot cross.

**Persistence is two-sided, and the two sides must not be confused:**

| Content | Required behaviour | Source |
|---|---|---|
| Notices, alerts, informational displays | **remain visible until the user responds with an appropriate action** | FAA §5.6.15.10.1.7 |
| Erroneous entry | **remains displayed until the error is corrected**; the message is removed after correction | NUREG Rev.1 §2.4.5-7 |
| Highlighting that identified an error | **removed when it no longer has relevance** | NUREG Rev.1 §1.3.10-4 |
| Continuously presented alerting signals | **persist until proper action or signal turnoff**; automatic termination is **not time-based** but on action or restoration of normal conditions | MIL-STD §5.3.1.2.3.b(3)–(4) |
| Stale messages in a message bar | the bar **should automatically remove messages that are no longer relevant** | FAA §5.6.14.2.5.5 |
| Manual shutoff | a **visual indication that the warning has been turned off** shall be provided | MIL-STD §5.3.1.5.7 |
| Clearing an alert | clearable by condition restoration, by correction, or by explicit acknowledgement | NASA §10.9.2.5.1 |
| Signal completion | *"Completion of a corrective action … shall automatically terminate the signal"* | FAA §5.5.2.6.6 |

**Resolution: the *message* persists, the *alerting* stops.** Error messages and unresolved warnings are not toasts — they stay until the condition changes. The attention mechanism (flashing, tone, badge) is what acknowledgement or correction terminates. Auto-dismissing an error on a timer is wrong in both directions: it removes information the user still needs, and it makes the absence of the message ambiguous.

Two more WCAG constraints bound the same behaviour. **2.2.2 Pause, Stop, Hide (A)** — any moving, blinking, or scrolling information that starts automatically, **lasts more than five seconds**, and is presented in parallel with other content must have a mechanism to **pause, stop, or hide** it; for **auto-updating** information the user must additionally be able to **control the update frequency**. That is the operative constraint for live alert feeds and animated badges. And **2.2.4 Interruptions (AAA)** — interruptions can be **postponed or suppressed**, **except emergency interruptions**; this is the normative web form of NUREG's high-volume suppression rules, and the two agree: suppress the non-critical, never the emergency, restore automatically.

---

## Anti-patterns

- **A five- or six-level severity scale.** Both sources that set the number cap it at four, and NUREG Rev.1 states why: excess levels make users attend to the level rather than the problem. Rev.4 keeps the dimensions but drops the count, so nothing in the sources licenses a fifth level.
- **Colour as the only severity channel.** Fails WCAG 1.4.1 and every ergonomics source here — FHWA cites roughly **0.6 % of the FAA population** as medically cleared with colour-vision defects, and MIL-STD requires coded colours to be *"distinguishable by both color-normal and color-deficient persons"* (§5.4.6.6). Rev.4 §4.2.2-3 requires priority to be *coded* and lists **colour, position, shape, and special symbols** as the acceptable methods.
- **Brightness as the second channel for a colour code.** FHWA §4.2.2 forbids it in exactly these terms: protans may not perceive the brightness difference. Use shape, icon, text, or position.
- **Flashing at 3–5 Hz in a public-facing product.** A control-room rate for a screened population. On the web it is a WCAG 2.3.1 failure and a seizure risk.
- **Flashing the text of the message itself.** Prohibited by both MIL-STD and FAA; the replacement is an adjacent flashing asterisk or arrow. A blinking error is unreadable for exactly as long as it is off. Rev.4 §4.2.3-2 states the same rule specifically for **unacknowledged VDU alarms** — flash an adjacent symbol, not the message text.
- **A blinking alert with no fail-steady path.** NASA, FAA, and NUREG Rev.1 and Rev.4 all require the indicator to burn steady (or move to a *more* conspicuous code) if the flasher fails. A CSS animation that simply stops leaves an active alarm looking inactive.
- **Sound-only alerts, or visual-only critical alerts.** FAA requires every nonverbal audio signal to be paired with a visual signal that defines the condition; NUREG and NASA require important information in both modalities. Rev.4 §4.2.3-2 requires unacknowledged alarms to be indicated **both visually and audibly**.
- **A user-facing volume slider for alarm tones.** NUREG Rev.1 §4.5.6.3-11: *"Under no circumstances should operators be able to disable audio alarm signals or reduce their level so as to render them inaudible."* Provide acknowledge-and-silence instead.
- **More than a handful of distinct alert sounds.** The absolute-identification ceiling is **four** (FAA §5.5.2.2.1; NASA §10.7.3.1), with a hard human limit around 5–6. An app with a dozen chimes has a dozen chimes nobody can name. Rev.4 restates the three-pitch-code and nine-compound-code caps (§4.2.6.3-14, §4.2.6.3-20).
- **Distinguishing alarms by pitch alone.** NUREG's cautionary case is real: ISS class 2 and class 3 alarms were confusable *"since they are not differentiated by temporal interval and in isolation the 375-Hz tone is not perceivably different from the 512-Hz tone"* (NASA §10.9.2.3). Combine pitch **and** temporal pattern.
- **Modelling only "shown" and "gone".** There is no third state, so "acknowledged" is indistinguishable from "new" and clearing produces no signal. Rev.4 requires **three unique presentations** (§4.2.3-1), an acknowledge that moves unacknowledged → **not cleared**, e.g. flashing → steady (§4.3.3-1), and **visual + audible** annunciation on clear with a **dedicated, distinctive, short** audible signal and a **half-rate flash or reduced brightness** in the visual channel — ringback, which must be **suppressed until the condition recurs** (§4.2.3-5). Treating "clear" as delete is the same defect.
- **No hysteresis on an oscillating alarm.** Without Rev.4's rule (§4.2.3-6) a parameter hovering at its threshold emits a new alarm on every crossing. Require it to move **further into** range, or to stay in range for a set time, before clearing.
- **Filtering an alarm that users might need.** Filtered alarms are unreachable. Rev.4 §4.1.3-2 and §4.1.3-3: filter only where the message has **no current operational significance**; **suppress (retrievable) rather than filter** anything merely redundant or lower priority.
- **A global silence control that mutes alarms the user cannot see.** Rev.4 §4.3.2-1 requires silence to work for any alarm **visible from** the control, and explicitly forbids silencing alarms that **cannot be visually detected** from it.
- **A caution or notice presented before an outstanding warning clears.** MIL-STD §5.3.1.2.5 forbids it outright; a low-priority toast shown while a critical modal is pending violates it.
- **"Invalid input."** NUREG's counter-example is copyable: *"Code format not valid: 2 letters, then 3 digits"* beats *"Invalid input."* An error naming neither the field nor the remedy has failed its purpose (FAA §5.6.15.10.2.7).
- **A destructive action as the default button, or Enter confirming it.** FAA §5.6.14.2.8.9 and §5.6.15.10.1.12 forbid both. The most common destructive-dialog bug.
- **Auto-dismissing errors on a timer.** Errors persist until corrected (NUREG Rev.1 §2.4.5-7); notices remain until the user responds (FAA §5.6.15.10.1.7). Toasts are for status, not for errors.
- **Validating as the user types.** NUREG Rev.1 §2.4.5-4: an error should appear only after an explicit ENTER action. `oninput` validation on a partially-typed value is a defect, not a feature.
- **A tooltip that disappears when the pointer moves toward it.** Fails WCAG 1.4.13's Hoverable condition.
- **Letting a dialog cover an active warning, the menu bar, or the command area.** NUREG Rev.1 §2.5.6-22 says it should not be *possible*; FAA requires the active window never to be obscured and the focus window to be made wholly visible on activation.
- **Silently truncating an alert list.** NUREG Rev.1 §4.5.7.2-5 (and Rev.4 §4.2.8-5): important alarm information must not be truncated, and the system should signal that more is available on later pages.
- **Suppressed alerts the user must remember to re-request.** NUREG Rev.1 §4.5.6.2-8 and Rev.4 §4.2.6.2-8 require automatic restoration after the more important alarms are addressed.
- **Alarming conditions that are normal in the current mode.** FAA §5.5.1.1.5, NUREG Rev.1 §4.3-7 and §4.3-8: alarm only where the value is actually a fault, or the system trains users to ignore it.
- **Showing status information inside the alarm feed.** FAA §5.5.1.2.11 and NUREG Rev.1 §4.3-5 (Rev.4 §4.1.2-5) both require separation, because co-mingling raises the reading load on the alarm stream itself.
- **An "off" or dim state used to attract attention.** NUREG Rev.1 §1.3.10-9: *"An 'off' condition should never be used to attract attention to a message."*

---

## Connects to

- **Ch 1 (Text size and legibility)**: alert and error text is the "must be read rapidly" case in the arcmin table. The rule that flashing must never be applied to text the user must read is the same principle in the temporal dimension.
- **Ch 2 (Spacing and density)**: the blank-row-every-four-or-five-messages rule and the ≤50-alarm matrix ceiling are density constraints; the 10 % highlighting budget separates signal from noise.
- **Ch 3 (Contrast and colour)**: the severity ladder is a colour-coding scheme, bound by the colour-count and ΔE rules; FHWA's prohibition on brightness as the redundant channel is a cross-chapter finding.
- **Ch 4 (Reading in motion)**: a toast or transient banner is motion; WCAG 2.2.2's five-second and pausability thresholds live there, and the tension between a transient toast and this chapter's persistence requirements is the crux of notification design.
- **Ch 5 (Response time)**: the 2 s working-indication threshold, the 2 s periodic-feedback threshold, the 4 s stacked-command error budget, and the 15 s "inform the user" threshold are the alerting side of the response-time tables.
- **Ch 6 (Targets and layout)**: button sets are target-size problems, and the rule that buttons sit in a row centred with the window is a layout constraint.
- **Ch 7 (Defaults and user-adjustable parameters)**: the default-button contract (one default, leftmost or topmost, never destructive, Enter never confirms destruction) and the non-adjustability of alarm loudness are both default/adjustability questions.
- **Ch 9 (Navigation, menus, forms)**: error messages and confirmation dialogs are the feedback half of data entry; NUREG's transactional rules (validate per transaction, correct before proceeding) are shared.
- **Ch 10 (Accessibility and consistency)**: WCAG 2.3.1 and 2.3.2 (flash), 1.4.2 (audio control), 2.2.2 (pause/stop/hide), 2.2.4 (interruptions), 1.4.13 (hover content), and 3.1.5 (reading level) are all restated here from the alerting point of view.
- `CROSS-SOURCE-REGISTER.md` **§3** — the full flash-rate reconciliation and the reasoning for letting WCAG override the ergonomics figures; **§2** — the colour-count reconciliation and the non-negotiable redundancy rule.
- **NUREG-0700 Rev.1 → Rev.4** — where the two revisions differ within this chapter: the **priority-level count** (Rev.1 §4.4-2 caps it; Rev.4 is silent), the **brightness-level count** (Rev.4 permits three for transilluminated tiles, two for VDU), the **300 % tile-luminance reference point** (Rev.1: vs. inactivated state; Rev.4: vs. surrounding luminance), and the **level above ambient** (Rev.1: a flat 10 dB(A); Rev.4: 10 dB quiet / 20 dB noisy).
