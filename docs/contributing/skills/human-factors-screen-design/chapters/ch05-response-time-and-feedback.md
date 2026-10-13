# Chapter 5 — Response time, latency, and feedback

**Core idea.** Four standards publish latency budgets that agree on *structure* — tight for input,
looser for retrieval, an explicit feedback milestone past a couple of seconds — while differing on
exact values. Two things matter more than the numbers, and almost nobody implements either: the
**maximum** and **desirable** columns mean different things, and **variability is itself a
requirement**, so a consistent 1.0 s beats an inconsistent 0.2 s. A delay with no feedback is read
as a failure.

---

## The merged latency budget

Each source budgets against the *interaction class*, not the implementation. A blank cell means the
source states nothing for that class — **it is not a zero**. *Citation convention:* NUREG guideline
IDs use **Rev.1 numbering** (matching `CROSS-SOURCE-REGISTER.md`); where Rev.4 renumbers, both IDs
are given. Table 2.4's values are identical in both revisions.

| Interaction class | FAA HF-STD-001B | MIL-STD-1472G Table V | NASA HIDH Table 10.8-1 | NUREG-0700 Table 2.4 |
|---|---|---|---|---|
| Discrete input acknowledged | — | **0.1 s** §5.1.2.1.4.d | **0.1 s** §10.8.3 | **0.10 s** max / **< 0.10 s** pref §2.4.7-9 |
| Key print (depression → character) | — | **0.2 s** §5.1.2.1.4.d | — | — |
| Pointer / XY entry, pointing | **< 100 ms** §5.6.13.10.5.3 | **0.2 s** §5.1.2.1.4.d | — | **1.0 s** max / **< 0.25 s** pref (light pen) §2.4.7-9 |
| Sketching / drawing (point in → line out) | — | **0.2 s** §5.1.2.1.4.d | — | **0.1 s** max / **< 0.10 s** pref (light pen) §2.4.7-9 |
| Menu appears on selection | — | — | **0.5 s** §10.8.3 | — |
| Page scan (request → text scrolls) | — | **0.5 s** §5.1.2.1.4.d | — | — |
| Page turn (request → first lines) | — | **1.0 s** §5.1.2.1.4.d | — | **0.5–1.0 s** max / **< 0.25 s** pref §2.4.7-9 |
| Local update (local database) | — | **0.5 s** §5.1.2.1.4.d | — | — |
| Host update (data at host, accessible) | — | **2.0 s** §5.1.2.1.4.d | — | — |
| Updated data / state change | — | — | **1.0 s** §10.8.3 | — |
| Simple inquiry / data on request | — | **2.0 s** §5.1.2.1.4.d | **1.0 s** §10.8.3 | **2.0 s** max / **< 0.25 s** pref §2.4.7-9 |
| Complex inquiry (calculation, graphic) | — | **10 s** §5.1.2.1.4.d | — | **5.0 s** max / **< 2.0 s** pref §2.4.7-9 |
| Complex inquiry — table form | — | — | — | **2–4.0 s** max / **< 0.25 s** pref §2.4.7-9 |
| Complex inquiry — graphic form | — | — | — | **2–10.0 s** max / **< 0.25 s** pref §2.4.7-9 |
| File update (host file access) | — | **10 s** §5.1.2.1.4.d | — | — |
| Command in progress / done / impossible | — | message if > **1.0 s** §5.1.2.1.4.d | **2.0 s** §10.8.3 | — |
| Error feedback after entry | **within 2 to 4 s** §5.6.15.10.1.17 | **0.2 s** §5.1.2.1.5.e | **2.0 s** §10.8.3 | **2.0 s** max / **< 0.25 s** pref §2.4.7-9 |
| System activation (initialization) | — | — | — | **3.0 s** max / **< 0.50 s** pref §2.4.7-9 |
| Loading and restart | — | — | — | **15–60.0 s** max / **< 6.0 s** pref §2.4.7-9 |
| Intervention in an automatic process | — | — | — | **4.0 s** max / **< 1.50 s** pref §2.4.7-9 |
| Direct manipulation | — | — | — | **≤ 0.25 s** §2.2.6-5 |
| Full-screen pointer traversal | — | — | — | **≤ 0.5 s** rough positioning §2.3.3-2 |

- **NUREG Rev.4's Table 2.4 is numerically identical to Rev.1's in every row** — all eighteen values
  match; Rev.4 adds a nineteenth row, *Response to dynamic modeling*, with no values (`--- / ---`).
  This matters because Rev.1 is a **scanned document** whose numbers come from an OCR layer
  (`CROSS-SOURCE-REGISTER.md` §8 flags the risk). The digital Rev.4 **confirms** Rev.1.
- **One revision change:** Rev.1 `2.4.7-2` says the average response time *"should be displayed at
  time of use"*; Rev.4 `2.4.3-3` says *"at the time of logon."* **Prefer Rev.4** — a load-dependent
  average only helps before the user commits to a long action.
- **The maximum column is not a comfort target.** NUREG `2.4.7-9`: *"Maximum system response times
  for real-time systems should not exceed the values presented in Table 2.4."* MIL-STD adds
  **non-regression**: response times and task completion times *"shall not exceed"* those of *"the
  equivalent existing or predecessor system"* (§5.1.2.1.4.d–e). **A rewrite slower than the thing it
  replaces is a defect by definition.**

### Continuous control and hardware

Stated in milliseconds, and much stricter. NASA's Table 10.8-1 is itself *"adapted from
MIL-STD-1472F (1999)"*, which is why its figures sit beside MIL-STD's.

| Requirement | Value | Source |
|---|---|---|
| Touch-screen display response | **≤ 100 ms**; **100 ms max, preferably 55 ms** | MIL-STD §5.1.3.1.4; NUREG Rev.4 `11.3.2.3.6-7` |
| Joystick / cursor control-to-display delay | **≤ 100 ms**; **≤ 0.1 s** | MIL-STD §5.1.3.3.3.a(5)(f); NASA §10.4.2.12.2 |
| Eye- and head-based control response | **≤ 100 ms**; sight dwell **≤ 300 ms** | MIL-STD §5.1.6.5, §5.1.6.4 |
| VE round trip (input → execute → display) | **≤ 100 ms**, **75 ms preferred** | MIL-STD §5.12.1.4.1.a–b |
| Head-mounted display, response to head movement | **≤ 16 ms** | MIL-STD §5.12.1.4.1.b |
| Body-referenced interface (robotics) | **< 50 ms** | MIL-STD §5.12.2.1.5 |
| Automated / weapon-system control | **≤ 100 ms** | MIL-STD §5.12.3.2.4, §5.12.3.3.4 |
| Vehicle motion control (left/right/forward) | **≤ 250 ms** | MIL-STD §5.12.3.3.4 |
| Surveillance display update from user command | **≤ 200 ms** | MIL-STD §5.12.5 |
| Panel response (pixel transition, 90 % of change) | **≤ 55 ms**, and **< one frame**; **≤ 13 ms at 75 frames/s** | NUREG Rev.4 `11.3.1.4.2-1` |
| Moving-edge blur | **≤ 15 ms** (blur edge time or Gaussian edge time) | NUREG Rev.4 `11.3.1.4.2-4` |
| On/off response time (temporal metric standards) | **< 55 ms** (HFES 2006); **< 13 ms** (TCO-06) | NASA Table 10.3-6 |
| Sensor-to-display delay | consistent with the user's task performance requirements | NUREG `1.4-7`; Rev.4 `1.4-7` |

The **55 ms / 13 ms pair is an independent agreement, not a coincidence**: NUREG Rev.4's
display-hardware clause and NASA's Table 10.3-6 (citing HFES 2006 and TCO-06) state the same two
figures from different pedigrees. Treat such convergence as a real specification.

---

## Maximum versus desirable

| Column | What it is | What to do with it |
|---|---|---|
| **Maximum** (NUREG) / **Table V ceiling** (MIL-STD) | The point past which the operator's task degrades — the *shall/should not exceed* line | A **defect threshold**; make it the alert threshold in monitoring |
| **Preferred / desirable** (NUREG `< …`) | The point past which the interaction reads as **immediate** | Design to this column — it is the target |
| **"Processing" threshold** (MIL-STD 1.0 s; FAA/NASA 2.0 s) | The point at which the user can no longer tell whether the input registered | Where an indicator becomes **mandatory**, not decorative |

The most consequential error in this chapter is treating the maximum as the requirement. NUREG `2.4.7-1`: *"the response should be faster for those transactions perceived by a user to be simple"* — because **users judge "simple" transactions by tighter time expectations**. The budget is set by **the user's model of the transaction, not the server's cost of serving it.** A 300 ms response to an action the user reads as simple misses a 250 ms target; the same 300 ms on a transaction the user expects to be slow is fine.

**An internal inconsistency, reported not resolved.** The preferred/maximum ratio is not constant: simple service **2.0 → < 0.25 s** (8×), complex service **5.0 → < 2.0 s** (2.5×), complex graphic inquiry **2–10.0 → < 0.25 s** (8–40×). Read both columns per row. (Ratios are arithmetic on NUREG's own figures, computed here.)

---

## Consistency — the rule most commonly ignored in the entire set

- **FAA §5.6.15.5.1.3** — *"System-response time variability shall not exceed **5 %** when processing in the range of **0 to 2 sec**; **10 %** when processing in the range **2 to 5 sec**; and **15 %** when processing longer than **5 sec**."*
- **FAA §5.6.15.5.1.2** — *"The variability of system response times for processing various types of control actions shall be minimized."*
- **NUREG `2.4.7-8` (Rev.1) / `2.4.3-9` (Rev.4)** — *"Response time deviations should not exceed more than **half the mean response time**. For example, if the mean response time is **4 seconds**, the variation is limited to a range of **2 to 6 seconds**."*

| | FAA | NUREG |
|---|---|---|
| Basis | percentage band that **tightens as the interaction gets faster** | **± half the mean** (half-mean to 1.5× mean) |
| At a 2 s mean | **5 % → ±100 ms** (derived) | **±1 s** (⇒ 1–3 s) |
| At a 4 s mean | 10 % → ±400 ms (derived) | ±2 s (⇒ 2–6 s; NUREG's own example) |
| At the fast end | **far tighter** — 100 ms of jitter is nothing on a round trip | loose |

**These are different claims and both bind. FAA binds everything a user perceives as instant.** A 5 % band on a 2-second transaction is a **100 ms** budget for the whole variation; on a key response the same logic implies less. A p50 of 0.2 s with a p99 of 1.8 s satisfies NUREG's ±half-the-mean and badly breaches FAA's 5 %.

**The engineering consequence: variable cache/query cost destroys the user's model of the system.** The user predicts *"this screen takes about a second"* and schedules attention around it. When the same action takes 0.2 s once and 1.8 s the next time:

1. **The prediction is worthless, so the user must watch** — serialising the interaction against a human doing nothing.
2. **Re-issuing becomes rational.** NASA §10.8.4.3: *"If the status information is delivered at some delay, the user may believe that the system has not received the command and thus issues it again; this double actuation can have minor to serious consequences."* §10.8.3 gives the mechanism — the indication exists to stop the user *"from believing the input was lost and repeating it."*
3. **Working memory decays.** NUREG `2.4.3-2`: navigation and retrieval latency *"contributes to information access cost … as system response time increases, the likelihood that information will be lost from working memory increases."*

**Benchmark the p95, not the average, and hold the p95/p50 ratio inside the band.** The usual causes are architectural, not perceptual: a **cold cache** served where a warm one usually is (the first request of a session breaks the band the user already learned), a **variable-cost query** (one button returning 5 rows for one user and 50 000 for another), or **client work attached to first paint** (hydration, chart layout, a large list render). If the cost cannot be flattened, **flatten the perception**: serve a fixed-cost partial result first, then fill in.

---

## Feedback thresholds — the milestone ladder

| Threshold | What must happen | Sources |
|---|---|---|
| **< 100 ms** | Nothing beyond the response itself; pointers and direct manipulation must track input continuously | FAA §5.6.13.10.5.3; NASA §10.14.6 ("real time" = discrete input < 100 ms) |
| **100 ms – 1 s** | **No indicator.** A busy state here is a defect: it converts a fast action into a visibly slow one. MIL-STD allows an acknowledgement *message* only *"where feedback response time must exceed **1 second**"* | MIL-STD §5.1.3.5.1.p |
| **> 1 s** | *"If computer response time will exceed 1.0 second, the user shall be given a message indicating that the system is processing"* §5.1.2.1.4.d; *"Where the delay exceeds 1.0 second, the user shall be informed"* §5.1.2.1.4.h | MIL-STD §5.1.2.1.4.d, §5.1.2.1.4.h |
| **> 2 s** | An operation over 2 s that blocks further input *"shall inform the user that action is continuing"* §5.6.15.7.5; processing that *"will exceed 2 seconds"* *"shall display a working message window"* §5.6.14.4.6.1 and *"shall provide periodic feedback"* §5.6.15.7.7; a cursor-shape change is justified past *"2 or 3 seconds"* §5.6.13.10.4. NASA: *"If there is to be a delay in system feedback greater than 2.0 seconds, the user should be given some indication that the system is processing the request"* §10.8.3 | FAA §5.6.15.7.5, §5.6.14.4.6.1, §5.6.15.7.7, §5.6.13.10.4; NASA §10.8.3, §10.13.2 |
| **> 2–4 s** | Error feedback must already have arrived | FAA §5.6.15.10.1.17 |
| **> 10 s** | **Countdown display** (MIL-STD only): *"For delays exceeding 10 seconds, a count-down display shall show delay time remaining"* | MIL-STD §5.1.2.1.4.h |
| **> 15 s** | **Inform the user it will be long** — *"The user should be informed if the delay is likely to exceed 15 seconds"* — and **signal completion positively**: *"When the computer response to a user request is greater than 15 seconds, the computer shall give a clear and positive indication (for example, an auditory signal) when processing is complete"* | FAA §5.6.15.7.8, §5.6.15.7.10 |
| **> 60 s** | **Countdown display** (FAA only): *"For delays exceeding 60 seconds, a countdown display should show delay time remaining"* | FAA §5.6.15.7.9 |

### The 10 s vs 60 s countdown conflict, resolved

`CROSS-SOURCE-REGISTER.md` §4 currently reads "countdown past ~10 s (MIL-STD) or ~15 s (FAA)". **The
FAA countdown figure is 60 s**; 15 s is FAA's separate, earlier *informing* threshold. Resolve by
asking what the countdown is for:

- **MIL-STD's 10 s** sits in §5.1.2.1.4.h, the same clause that sets the 1.0 s *"user shall be
  informed"* rule — written for **real-time control systems** where the operator is blocked and the
  delay dominates the interaction.
- **FAA's 60 s** concerns **how long a user must wait before a numeric estimate of remaining time is
  worth computing.** Below a minute, the estimate is usually less informative than the fact that work
  is progressing.

**Use 10 s for elapsed-time or progress information, and 60 s for a genuine remaining-time estimate**
— this satisfies both. FAA `5.6.15.7.5` prefers *"the percent of processing that has been completed or
that remains, with the percentage updated regularly"* and offers the fallback *"a display that changes
with time is still desirable (for example, a row of dots with a new dot added periodically)"* — **a
moving indicator is acceptable when a true estimate is unavailable; a fake percentage is not.**

### What to render, by elapsed time

| Elapsed | Render | Authority |
|---|---|---|
| 0–100 ms | Nothing — the result, or an optimistic local update | FAA §5.6.13.10.5.3; NASA §10.14.6 |
| 100 ms – 1 s | **The control's own pressed/selected state, immediately.** NUREG: *"the computer should acknowledge every entry immediately"*, accepting *"highlight the selected option label (e.g., by brightening or inverse video)"*; FAA: *"Any displayed message or datum selected as an option or input to the system shall be highlighted"*; MIL-STD: *"Every input by a user shall produce a consistent, perceptible response"* | NUREG `2.1-13`; FAA §5.6.15.7.17; MIL-STD §5.1.2.1.4.c |
| 1–2 s | An explicit **"processing"** message. The window *"shall not interrupt processing"* and *"shall be removed automatically when processing is completed"* | MIL-STD §5.1.2.1.4.d; FAA §5.6.14.4.6.1–.4 |
| 2 s+ | A **working indicator that visibly changes.** FAA: *"A dynamic aspect to the working message is highly desirable"*; successive periodic messages *"should differ in wording from presentation to presentation"* (its example: *"Processing search — please wait."* → *"Search continuing — please wait."*). NASA's accepted forms: *"a symbol (e.g., hourglass), animation (e.g., running list of dots…… or filling progress bar), or text message"* | FAA §5.6.15.7.5, §5.6.15.7.4; NASA §10.8.3 |
| 10 s+ | **Elapsed time or percent complete**, updating regularly. NUREG: *"advise the user of the time remaining for the process or of the fraction of the process completed"*; Rev.4 soft-control guidance permits a *"Time to Completion"* indicator for actions *"that involve significant wait times"* | MIL-STD §5.1.2.1.4.h; NUREG `2.4.7-4` / `2.4.3-5`; Rev.4 `7.4-2` |
| 15 s+ | **A completion signal** — *"a clear and positive indication (for example, an auditory signal)"* when the response exceeds 15 s, because the user will by now have looked away | FAA §5.6.15.7.10 |
| 60 s+ | **Remaining-time countdown** | FAA §5.6.15.7.9 |
| Any length | Multi-step status discoverable from **one** display: *"the status of sequential actions in progress should be displayed. Ideally, allow users to check the status of related operations at a glance from a single display"* | NUREG Rev.4 `7.3.4-1` |

**Two rules that apply at every threshold above.** **Acknowledge *before* you are slow** — FAA §5.6.15.5.1.4: *"When the processing of a control entry must be delayed, the current control entry shall be acknowledged"*; MIL-STD §5.1.3.4.1.c: the system *"shall acknowledge the data entry and provide an indication of the delay."* And **warn before the command, not after** — FAA §5.6.15.7.14: *"The system shall give the user warning information before a command is invoked that it will be time consuming to process"*; MIL-STD §5.1.2.1.4.f–g adds that users *"shall be provided with an option to abort time-consuming processes"*; NUREG Rev.4 `2.2.8-6` requires the user be *"informed and required to confirm the transaction or to narrow the query before processing"*, and FAA's query rules add the choice to *"confirm, modify, or terminate the search"* (§5.6.8.3.3.5–.6).

**Absence of response is never a status.** NUREG: *"The absence of computer response is not an acceptable means of indicating that an entry is being processed"* (`2.1-13`). Rev.4 adds, for lockout, that *"deletion or change of a displayed cursor in itself may not be a sufficient indicator of keyboard lockout"* (`2.1-16`) — while FAA and MIL-STD both require a *distinct* cursor for the busy state and a *signal when normal operation resumes* (FAA §5.6.13.10.4.1, §5.6.15.5.2.4; MIL-STD §5.1.3.5.1.d(1)–(3)).

---

## Direct manipulation — stricter than retrieval, by design

**NUREG `2.2.6-5`** (identical in Rev.1 and Rev.4): *"Direct manipulation should not be used when the computer response is slow. Other modes of interaction should be considered if the system is unable to respond immediately (**i.e., within 0.25 second**) to direct manipulation input."* Rev.4 supplies the companion requirement: *"The effects of operations performed on direct manipulation interfaces should be immediately visible"* (`2.2.6-23`).

**Why 0.25 s when a page turn may take 1.0 s?** They are different kinds of system. A **retrieval** is open-loop — the user issues it, waits, reads; the cost of the wait is delay. **Direct manipulation** is a **closed loop**: the user drags and their hand continuously corrects against what they see. A quarter-second of lag is not delay, it is **control-system instability** in a loop whose plant is a human arm.

NASA gives the quantitative frame and NUREG's value sits inside it: latencies **greater than 200 ms are generally regarded as significant**, **~50 ms** produces measurable productivity decline, and **~8 to 16 ms** is noticeable in body-referenced interfaces (§10.14.4.5). NUREG's 250 ms is the *outer* boundary at which direct manipulation still makes sense at all.

**The consequences are architectural, not cosmetic:**

- **NUREG Rev.4 `Table 2.1`** makes the dependency explicit: *"Slow computer response time → Forms"*; *"Fast computer response time → Command Language, Direct Manipulation, Speech."* If 0.25 s cannot be met, the instruction is **not to add a spinner to the drag** but to **change the interaction paradigm**.
- FAA §5.6.7.5.1.8 gives the same instruction for menus: long response time → **broad and shallow**; slow *display rate* → **narrow and deep**. Response time is an input to information architecture.
- NUREG Rev.4 `7.3.3.3-1` notes continuous-adjustment interfaces need *"a gross slewing movement followed by a fine adjustment"*, and that where *"the user's tasks do not permit careful hand-eye coordination, then other interfaces, such as arrow keys, should be used"* — the fallback for a latency-bound continuous control is **discrete input**.

**Concrete test.** For any drag, resize, scrub, reorder, or drawing interaction, measure input event → frame in which the moved object is painted. Above 250 ms, **or variable**, it is out of budget. Fix with a local client-side transform applied on the input event, reconciling the authoritative value afterwards — or switch to discrete controls.

---

## Perceptual thresholds and frame budgets

Below the transaction budgets sit thresholds set by the visual and motor systems rather than by task
convention. NASA §10.14.4.5 and §10.14.6 are the source for all of these.

| Threshold | Effect | Source |
|---|---|---|
| **> 200 ms** | Latency *"generally regarded as significant"* | NASA §10.14.4.5 |
| **~50 ms** | **Measurable productivity decline** | NASA §10.14.4.5 |
| **~8–16 ms** | **Noticeable** in body-referenced interfaces (virtual environments) | NASA §10.14.4.5 |
| **< 50 ms** | Required for **body-referenced** interfaces; equivalent to *"at least **20 Hz** … for manual control"* | NASA §10.14.4.5, §10.14.6 |
| **< 8 ms** | Required for **visually stable virtual objects** in immersive or AR displays | NASA §10.14.4.5 |
| **250 ms – several seconds** | **"Move-and-wait"** becomes the practical strategy; continuous manual control becomes *"very challenging and impose[s] high workload"* | NASA §10.14.4.5 |
| **> 300 ms** | Interaction *"becomes more episodic and ultimately more dependent on increasingly complete automation"*; direct manual control is no longer viable and **supervisory control** should be implemented | NASA §10.14.4.5 |
| **16–30 ms** | The ceiling on what **predictive filters** can cancel *"without introducing excessive jitter"* | NASA §10.14.4.5 |

### Frame budgets (derived)

The standards state update rates in hertz; a renderer needs milliseconds. These are arithmetic on the
sourced rates — **no new figure is introduced**.

| Update rate | Frame budget | Where the rate comes from |
|---|---|---|
| **20 Hz** | **50 ms** | NASA §10.14.6: manual control "real time" = ≥ 20 Hz with < 50 ms latency (the two figures are consistent) |
| **60 Hz** | **16.7 ms** | NASA §10.14.6: ≥ 60 Hz for perceptually stable virtual objects; MIL-STD §5.12.1.4.2: HMD scene update ≥ 60 Hz |
| **75 Hz** | **13.3 ms** | NUREG Rev.4 `11.3.1.4.2-1` names 75 frames/s as the rate at which panel response must be ≤ 13 ms |
| **90 Hz** | **11.1 ms** | interpolated rate, satisfying NASA's ≥ 60 Hz virtual-object floor with margin |
| **120 Hz** | **8.3 ms** | NASA §10.3.2.4.5 notes 120 Hz with motion-interpolated imagery as a motion-blur mitigation |

**Read the 60 Hz row carefully.** 60 Hz = **16.7 ms**, while MIL-STD requires an HMD to update within
**16 ms** of a head movement, NASA requires **< 16 ms** for visually stable virtual objects, and
noticeable delays begin at **~8–16 ms**. **The 60 Hz frame period is at or just over the requirement,
not comfortably inside it** — and any latency added on top (sensor sampling, pose prediction,
compositor, photon emission) breaks it. That is why a nominally 60 Hz headset can still make users ill.

### Flicker, and the frame-rate floor

- NASA §10.3.2.4.1: the flicker threshold *"is typically zero at frequencies above about **70 Hz**"*; flicker *"is rarely a problem at frame rates of that frequency or greater."*
- NASA §10.3.2.4: *"Human observers cannot see modulations of luminance more rapid than about **60 Hz**. This is the basis for frame rates at around that value."* Critical fusion frequency *"ranges from below **20 Hz** to above **60 Hz**"* (§5.4.9.4).
- **FAA §5.6.13.10.2.4 — a prohibition, not a floor:** *"Flash or display refresh rate shall not be within the **15–20 Hz** range"*, because people sensitive to seizures *"may have seizures induced by flashing screen cursors or by flickering displays, particularly near the 15-20 Hz range."* FAA states **no positive minimum refresh rate** anywhere.
- MIL-STD §5.2.1.1.4 requires only a *"flicker free display"*; §5.2.2.6.3 a rate *"as defined by the task analysis"*. **MIL-STD's only numeric refresh value is 60 Hz or greater for VE head-mounted displays** (§5.12.1.4.2).

**The nearest thing to a consensus floor is 60 Hz, and it comes from virtual-environment displays rather than a general rule.** Elsewhere the sources constrain flicker by *outcome* (flicker-free; not in 15–20 Hz) rather than by number. The 15–20 Hz prohibition is hard regardless of purpose.

### AR/VR specifically

- **Latency** — VE round trip **≤ 100 ms**, **75 ms preferred** (MIL-STD §5.12.1.4.1.a); **≤ 16 ms** for a head-mounted display responding to head movement (§5.12.1.4.1.b); **< 50 ms** for body-referenced interfaces, **< 8 ms** for visually stable virtual objects (NASA §10.14.4.5).
- **Update rate** — **≥ 60 Hz** (MIL-STD §5.12.1.4.2; NASA §10.14.6).
- **Motion to avoid** — **0.1 Hz to 0.5 Hz** *"shall be avoided"* (MIL-STD §5.12.1.4.2); temporal modulation of stereopsis *"shall be approximately **1.0 Hertz**"* for dynamic displays (§5.2.3.5.1.c).
- **Prediction is bounded** — NASA §10.14.4.5: predictive filters *"can only cancel approximately **16-30 ms** of system latency."* **A design assuming prediction will absorb a 100 ms sensor-to-photon budget has 16–30 ms of headroom, not 100.**
- **Who pays:** NASA §10.14.4.6 — *"the proportional productivity loss is worst for the most expert users."* Latency work pays back fastest on the workflows your heaviest users repeat most.

---

## Where the sources disagree, and how to resolve it

Extending `CROSS-SOURCE-REGISTER.md` §4. Four conflicts there are new or under-stated.

| Question | FAA | MIL-STD | NASA | NUREG | Resolution |
|---|---|---|---|---|---|
| **Busy-indicator onset** | **> 2 s** §5.6.15.7.5, §5.6.14.4.6.1 | **> 1.0 s** §5.1.2.1.4.d, §5.1.2.1.4.h | **> 2.0 s** §10.8.3 | no number; *"acknowledge every entry immediately"* `2.1-13` | **Acknowledge at input time (NUREG, unconditional); declare *processing* at MIL-STD's 1.0 s; 2 s is the outside boundary.** Different signals, so no real conflict. |
| **Error-feedback deadline** | **within 2–4 s** §5.6.15.10.1.17 | **0.2 s** §5.1.2.1.5.e | **2.0 s** §10.8.3 | **2.0 s** max / **< 0.25 s** pref §2.4.7-9 | **Prefer 0.2–0.25 s.** MIL-STD's 0.2 s and NUREG's < 0.25 s are the same number from two agencies; NASA's 2.0 s is a ceiling; FAA's 2–4 s is a *permitted band*, 20× looser. Bounded by MIL-STD §5.1.2.1.5.b: check *"at logical data entry breaks … rather than character-by-character."* |
| **Countdown threshold** | **60 s** §5.6.15.7.9 (informing at 15 s, §5.6.15.7.8) | **10 s** §5.1.2.1.4.h | — | — | **Both, at different fidelities** — elapsed/progress at 10 s, a real remaining-time estimate at 60 s. The register's "10 s or 15 s" conflates FAA's *informing* threshold with its *countdown* threshold. |
| **Pointer response** | **< 100 ms** §5.6.13.10.5.3 | **0.2 s** XY; **0.1 s** joystick; **0.1 s** touch §5.1.2.1.4.d, §5.1.3.3.3.a(5)(f), §5.1.3.1.4 | **< 100 ms** = "real time" §10.14.6 | **1.0 s** max light pen / **0.5 s** traversal §2.4.7-9, §2.3.3-2 | **Use 100 ms** — three of four state it outright. NUREG's 1.0 s is a *light pen*, whose own acquisition latency dominates, and its 0.5 s is about **motion rate**, not end-to-end latency. |

**One NUREG-internal conflict, reported not resolved:** the preferred/maximum ratio is 8× for simple
service, 2.5× for complex service, and 8–40× for complex graphic inquiry. The preferred column is not a
systematic fraction; read it per row.

---

## Practical engineering guidance

These standards predate skeleton screens and optimistic updates, so they do not name them. They do bound
what each technique may claim.

**Optimistic UI — constrained, not forbidden.**

- **Allowed:** NUREG `2.1-13` requires *immediate* acknowledgement and accepts a purely local visual
  change — highlighting the selected option label, brightening, inverse video. A same-frame local state
  change **is** the required acknowledgement.
- **Required:** the outcome must still be reported. FAA §5.6.15.7.15: *"When a control process or
  sequence is completed or aborted by the system, positive indication shall be presented to the user
  concerning the outcome of the process and the requirements for subsequent user action."* NUREG Rev.4
  `2.4.2-2` requires a confirmation or error message, and states that successful entry *"should not be
  signaled merely by automatic erasure of entered data."* **An optimistic update that never reconciles
  and never reports is a violation.**
- **Forbidden:** using optimism to hide latency the user needs to know about. NUREG `2.4.4-4` requires
  advising the user *"when response time will exceed the maximum amounts given in Table 2.4"*; MIL-STD
  §5.1.3.4.1.c requires an indication of the delay.
- **Also required:** reversibility. NUREG Rev.4 `7.7-1`–`7.7-3`: cancel and undo *"should be available
  for selected actions"*, and **inconsistency is worse than absence** — *"Providing undo features
  inconsistently may have worse consequences than not providing them at all."*

**Skeleton screens — endorsed in substance.** FAA describes what a skeleton is: *"a display that changes
with time is still desirable (for example, a row of dots with a new dot added periodically)"*
(§5.6.15.7.5); NASA approves *"animation (e.g., running list of dots…… or filling progress bar)"*
(§10.8.3); NUREG Rev.4 accepts an **elapsed-time** display when a percentage is unavailable. Three
constraints bind them:

- **It must change.** FAA §5.6.15.7.4: successive periodic feedback messages *"should differ in wording
  from presentation to presentation or be otherwise indicated so the operator can discern that the
  message has changed or been updated."* A static grey box is not feedback.
- **It must be removed automatically.** FAA §5.6.14.4.6.4: *"The window shall be removed automatically
  when processing is completed."*
- **It must not lie about scale.** A skeleton whose layout does not match the content produces the same
  reflow it was meant to prevent.

**Staleness indication — required, and the easiest to forget.** NASA §10.12.4: *"Questionable, stale, or
missing data should be indicated as such through use of visual coding (e.g., color, symbol, background
fill) … Any 'stale' data on a page should be clearly marked when presented to the operator."* The stated
reason is a modern app's problem exactly: *"this indication is especially important for telemetry with
discrete states, as those items may not change frequently, so that section of the display will always
appear static."* **A value that has not changed looks identical to a value that has not updated.**

| Requirement | Source |
|---|---|
| Annotate with **time information** when the user must assess currency | NUREG `1.1-42` (Rev.1) / Rev.4 |
| Mark data failing validation; distinguish **personnel-entered** from validated data | NUREG `1.4-11` |
| Notify the user of **significant changes that occurred while a display was frozen** | FAA §5.6.9.2.3; NUREG `2.5.3-7` |
| On resume, show conditions **at time of release**, not at freeze — unless the user asked otherwise | FAA §5.6.9.2.4; NUREG `2.5.3-8` |
| **Alert the user that data are not current** when resuming from the frozen point | FAA §5.6.3.2.2.20 |
| Label a frozen or suppressed display so its status is visible | MIL-STD §5.2.2.6.5–.8; NUREG `2.5.3-6`, `2.5.4-2` |
| Erase old items **before** adding new ones, to avoid reading a half-overwritten value | NUREG `1.4-4` |
| Let the user **control the update rate** | MIL-STD §5.2.2.6.4; NUREG Rev.4 `1.4-2` |
| Update floor: values that must be **reliably read** ≤ **1/s**; rate-of-change or gross values **2–5/s** | MIL-STD §5.2.2.6.1.a–b; NUREG `1.4-1`, `1.4-3`, `2.5.3-2`; Rev.4 `1.4-3`, `2.5.4-2` |
| Show **average response time** when it is load-dependent, in specifics not a code — the source's example: *"Average response to simple commands is 10 to 15 seconds; system response time is usually 1 to 2 seconds between 1100 and 1200 and after 1600 hours"* | NUREG `2.4.7-2` (Rev.1) / `2.4.3-3` (Rev.4) |

**The last row is the one to actually build.** A system whose latency varies with load should say so, in
numbers, at the point of use — the standards' answer when the consistency cannot be engineered away, and
far better than an unexplained spinner.

**Preventing the duplicate submission.** NASA §10.8.3 and §10.8.4.3 both name double-actuation as late
feedback's consequence. The fix follows from the thresholds: **acknowledge on the input event,
synchronously**, before any await, so the user sees the press registered within the 60 Hz frame budget.
Disable-or-debounce is a mitigation; a same-frame acknowledgement is the requirement.

**Rules that survive a rewrite.** MIL-STD's non-regression clauses (§5.1.2.1.4.d, §5.1.2.1.4.e)
translate directly into a CI check: if the same user action takes longer on the new build than the old,
that is a defect against the standard whether or not any absolute threshold was crossed. Track p50 and
p95 per interaction class and fail on regression, not only on absolute budget.

---

## Anti-patterns

- **Designing to the maximum column.** Using NUREG's 2.0 s for a simple inquiry when the preferred
  figure is < 0.25 s is an 8× miss that passes a naive reading of the table.
- **A busy indicator from 0 ms.** MIL-STD allows an acknowledgement message only past 1.0 s; a spinner
  on a 200 ms action converts an instant interaction into a visibly slow one.
- **A static "Loading…" that never changes.** Fails FAA §5.6.15.7.4 — periodic feedback must differ
  from presentation to presentation so the operator can tell it is updating.
- **A fake progress bar.** FAA prefers a real percentage; its sanctioned fallback is a *changing*
  indicator, not an invented fraction.
- **Optimistic UI with no reconciliation and no completion signal.** Violates FAA §5.6.15.7.15 and
  NUREG Rev.4 `2.4.2-2`, and leaves the user unable to tell whether the command was accepted.
- **Variable latency papered over with a spinner.** FAA's 5 %/10 %/15 % bands and NUREG's
  ±half-the-mean rule are about the *distribution*; no indicator fixes a distribution.
- **Treating a fast p50 as compliance.** A bimodal 0.2 s / 1.8 s service has an excellent mean and fails
  both variability rules.
- **Auto-refreshing readable values faster than once per second.** MIL-STD and NUREG cap readable values
  at 1 update/second, with 2–5/second only for rate-of-change or gross values; per NUREG `1.4-4` a fast
  update may also display a half-overwritten value.
- **An auto-updating region the user cannot pause or freeze.** MIL-STD §5.2.2.6.4 and NUREG Rev.4
  `1.4-2` make update rate user-controllable; WCAG 2.2 `2.2.2` adds that auto-updating content parallel
  to other content must be pausable, stoppable, hideable, or frequency-controllable.
- **Live data with no staleness indicator.** NASA §10.12.4 is explicit, and discrete-state values will
  otherwise *"always appear static"*. A dashboard whose socket died an hour ago looks current.
- **Direct manipulation over a slow backend.** NUREG `2.2.6-5` forbids it; NUREG Rev.4 `Table 2.1`
  prescribes forms or discrete input instead.
- **Requiring a spinner to be watched.** Any wait past ~15 s needs a completion signal (FAA
  §5.6.15.7.10) precisely because the user is expected to look away.
- **Suppressing the abort.** MIL-STD §5.1.2.1.4.f–g requires an option to abort time-consuming
  processes; FAA §5.6.15.5.2.5 asks for a lockout override.
- **A countdown for a wait that is actually unknown.** FAA's discussion offers the changing-indicator
  fallback; a countdown that expires before the work does is worse than none.
- **Assuming pose prediction buys back a VR latency budget.** NASA bounds predictive filters at 16–30 ms
  of cancellable latency; a 100 ms sensor-to-photon budget is not recoverable by prediction.
- **Ignoring the 15–20 Hz prohibition.** FAA §5.6.13.10.2.4 bans flash *or display refresh* in that band
  outright, for seizure safety.

## Connects to

- **Ch 1 (Text size and legibility)** — the 55 ms / 13 ms panel response figures and the 15 ms
  moving-edge-blur ceiling are the hardware half of legibility: a display that cannot complete a pixel
  transition within a frame cannot present stable text.
- **Ch 4 (Reading in motion)** — the update-rate ceilings (1/s for readable values, 2–5/s for
  rate-of-change values) and WCAG 2.2 `2.2.2`'s pause/stop/hide requirement are the same rules as the
  animation and auto-refresh limits there.
- **Ch 6 (Targets and layout)** — the 250 ms direct-manipulation ceiling is what makes a drag target
  usable; NUREG's 0.5 s full-screen traversal is the movement-cost half of the same budget.
- **Ch 7 (User-adjustable parameters and defaults)** — update rate, freeze, and refresh are parameters
  both MIL-STD and NUREG require the user to control; this chapter supplies their bounds.
- **Ch 8 (Alerts and messages)** — NASA's feedback-recurrence cadence (a safety-critical message every
  **30 seconds** until rectified; over-frequent non-critical messages cause desensitisation, §10.8.3) is
  the timing rule for the alerting content described there.
- **Ch 9 (Navigation, menus, forms)** — FAA §5.6.7.5.1.8 and NUREG Rev.4 `Table 2.1` make breadth,
  depth, and dialogue format functions of response time; that chapter's structure depends on the latency
  measured here.
- **Ch 10 (Accessibility, consistency, and adapting to the user)** — WCAG 2.2 `2.2.1`'s
  ten-times-default adjustable range and `2.2.6`'s 20-hour data-preservation rule are the *timing*
  dimension of accessibility; this chapter is its latency dimension.
- `CROSS-SOURCE-REGISTER.md` §4 — the shorter reconciliation table this chapter extends, plus the four
  new conflicts recorded above (busy-indicator onset, error-feedback deadline, countdown threshold,
  pointer response).
