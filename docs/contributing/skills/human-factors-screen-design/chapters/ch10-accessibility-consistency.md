# Chapter 10 — Accessibility, consistency, and adapting to the user

**Core idea.** Accessibility in these standards is not a separate compliance layer bolted on
at the end; it is the same requirements applied to a wider range of users. The government
standards were written under Section 508 and the Rehabilitation Act, so they treat
adjustability, timing, and input flexibility as **core interface properties**. This chapter
collects those rules, plus the consistency requirements that make an interface learnable.

---

## Timing and time limits

- **Adjustable response-time / timing** — when a system requires a response in less than
  **5 s**, or the release of a key in less than **1.5 s**, the system should provide either a
  means to **adjust the time interval** or an **alternate mode without the time requirement**.
  FAA HF-STD-001B §5.6.18.2.2. These two figures are the origin of the common
  "timing-adjustable" criterion, and they are far tighter than most web guidance.
- **Timing Adjustable (WCAG 2.2 2.2.1, A)** — for each time limit, at least one must hold:
  the user can **turn it off** before encountering it; or **adjust** it over a range of at
  least **ten times the length of the default**; or be **warned before it expires** and given
  at least **20 seconds** to extend it by a simple action, and be able to extend it **at least
  ten times**; or it is a real-time event with no alternative; or it is essential; or the
  limit exceeds **20 hours**.
- **Timeouts (WCAG 2.2 2.2.6, AAA)** — warn of the duration of any user inactivity that could
  cause data loss, unless data is preserved for more than **20 hours** of inactivity.
- **Adjustable keystroke acceptance delay** — a system intended to be operable by people with
  moderate motor disabilities should provide either a means of **delaying acceptance of a
  keystroke** for a preset, adjustable amount of time, or a keyguard (or a means to mount
  one). FAA HF-STD-001B §5.7.6.3.
- **Session and re-authentication** — WCAG 2.2 2.2.5 (AAA): after an authenticated session
  expires, the user can continue the activity **without loss of data** after re-authenticating.

**The principle:** any time limit that can be hit by a slow-but-correct user is a defect, not
a policy. Prefer no limit; if a limit is necessary, make it adjustable over a wide range and
warn before it fires.

---

## Input flexibility

- **Toggle select key** — a toggle-type select key should be available as a standard feature
  or option. FAA HF-STD-001B §5.7.6.2. The stated rationale is that users with disabilities
  *"may have difficulty simultaneously holding a select button down and moving the device, for
  example, in 'dragging' an object."*
- **Dragging Movements (WCAG 2.2 2.5.7, AA)** — all functionality that uses a dragging
  movement must be achievable by a **single pointer without dragging**, unless dragging is
  essential or determined by the user agent. This is the modern normative form of the same
  finding, 25 years later.
- **Left-right reversal of pointing-device buttons** — a system **shall** provide users the
  ability to reverse the left-right operation of the buttons. FAA HF-STD-001B §5.7.3.7.5.
- **Concurrent Input Mechanisms (WCAG 2.2 2.5.6, AAA)** — content must not restrict use of
  input modalities available on a platform, except where necessary for security or to respect
  user settings. Do not disable touch because a mouse is present, or vice versa.
- **Headphone volume adjustment** — provide a volume adjustment, including a **separate
  volume control for headphone jacks**. FAA HF-STD-001B §5.6.18.4.2.
- **Character Key Shortcuts (WCAG 2.2 2.1.4, A)** — if a keyboard shortcut uses only letter,
  punctuation, number, or symbol characters, then at least one must hold: a mechanism to
  **turn the shortcut off**; a mechanism to **remap** it to include a non-printable key
  (e.g. Ctrl, Alt); or the shortcut is **active only on focus**.

---

## Adjustability as an accessibility property

The accessibility rules and the general adjustability rules (Ch 7) are the same requirement
seen from two directions. From FAA HF-STD-001B's accessibility section specifically:

- **User-selectable font size** — when an application cannot satisfy the range of viewing
  requirements with a single text font, it **should provide text font size as a
  user-selectable option** (§5.6.2.5.7.1).
- **Volume control for caution signals** — audio caution signals shall be provided with manual
  reset and volume controls (§5.5.2.9.12).
- **Color keys must be accessible without scrolling or expanding** — when a colour key is
  used, it should be visible without the user having to scroll or expand anything
  (§5.6.6.x). The legend is part of the interface, not an appendix.

Cross-reference Ch 7 for the full default-value rules and the non-adjustability rules for
safety-critical signals.

---

## Consistency — the highest-leverage usability property

NASA HIDH states the quantified benefit directly: consistent interfaces are **easier to learn
and easier to train**, and task knowledge transfers between similar screens.

| Rule | Statement | Source |
|---|---|---|
| **Consistency rule** | Interfaces that perform similar functions should have **similar visual designs and methods of interaction** | NASA HIDH §10.2 |
| **Consistency vs. distinction** | Things that perform *similar* functions should look consistent; things that perform *different* functions should look **distinct** | NASA HIDH §10.2 |
| **Standardisation** | Labels should be consistent and standardised throughout a system; standardisation reduces switching cost | NASA HIDH |
| **Location of recurring data** | Location of recurring data shall be **similar among all displays** and common throughout the system | MIL-STD-1472G §5.2.2.4.6.b; NUREG-0700 Rev.1 |
| **Formats within levels** | When hierarchical levels are used, display and input formats **shall be similar within levels** | FAA HF-STD-001B §5.6.7.2.2 |
| **Reserved areas** | Interactive elements (prompts, menu bars, command lines, message areas) shall occupy consistent reserved areas | FAA HF-STD-001B §4 |
| **Context display** | Context information shall be distinctive in location and format, and consistently displayed from transaction to transaction | NUREG-0700 Rev.1 §2.1-35 |

**The distinction rule is the subtle and most valuable one.** Consistency is not "make
everything look the same" — it is "make similar things similar **and different things
different**." Over-applied consistency destroys the affordance distinctions that let a user
tell a destructive button from a safe one.

---

## Simplicity and the cost of controls

- **Simplicity** — a user interface is considered simple if it is easy to understand and use
  without unnecessary complexity. NASA HIDH §10.2.
- **Simplicity in control design** means: provide **only necessary controls**, make control
  inputs **intuitive**, and minimise the number of steps and the amount of user memory
  required.
- **Usability testing requirement** — NASA HIDH requires usability testing on **all hardware,
  software, procedures, and training materials**, with usability defined per ISO 9241-11 as
  *"the extent to which a product can be used by specified users to achieve specified goals
  with effectiveness, efficiency and satisfaction in a specified context of use."*
- **Usability metrics** — the ISO 9241-11 triad (**effectiveness, efficiency, satisfaction**)
  is the measurement frame the standards assume. Use it when arguing that a change improves
  anything; "it feels better" is not one of the three.

---

## Flexibility is bounded, and it is not a substitute for design

The current revision (NUREG-0700 **Rev.4 §2.8**) treats configurability as something that must
itself be designed, and it is unusually sceptical of it. This is the counterweight to the
adjustability rules in Ch 7 — the same document that requires some settings to be adjustable
also requires that flexibility be **limited**.

| Rule | Statement | Citation |
|---|---|---|
| **Flexibility is not unlimited** | "Users' flexibility in configuring the interface **should not be unlimited**." Constrain it so that configuring the system does not become "a complex decision-making task"; offered options should be **well defined** | Rev.4 §2.8-6 |
| **Flexibility is not a substitute for design** | Users should **not** have to use flexible features to support tasks and circumstances that *"could have been anticipated and designed for."* Flexibility should follow from analysis of user requirements, not replace it | Rev.4 §2.8-2 |
| **Only where it measurably helps** | Flexible features should be provided "**when they result in specific benefits to user tasks and do not impair user performance**". Performance is impaired by an **excessive number** of flexibility features, or by poorly designed ones that "can also expose the user to HSI configurations that violate human factors engineering principles" | Rev.4 §2.8-1 |
| **Beneficial uses are enumerable** | `Table 2.6` lists the legitimate purposes: reduce the cost of accessing information; reduce the cost of processing and integrating information; reduce the cost of executing control actions; enhance signal; reduce noise; document a baseline or trend; create external reminders | Rev.4 §2.8-1, Table 2.6 |
| **Match expertise** | Capabilities should be **consistent with user expertise**: less experienced users may need a **high degree of support** (menu-based systems, computer-based help); highly proficient users may need features that **limit the number of steps** (command-based over menu-based) | Rev.4 §2.8-9 |
| **Expertise-dependent help control** | **Experienced** users should be able to define **when and how** they receive automated guidance; **less experienced users should have few options** for controlling help presentation | Rev.4 §2.7.1-8 |
| **Shared displays must be protected** | Where more than one user can configure a display, "mechanisms are needed to ensure that displays created by one user are **not changed or eliminated by other users**" — password protection, special directories, or administrative procedures | Rev.4 §2.8-4 |
| **Scope** | The system should still be "sufficiently flexible to enable users to **respond to unanticipated situations**", including developing **novel information displays** for unusual circumstances | Rev.4 §2.8-3 |
| **One action back to default** | Displays that users can modify "should provide a means for the user to **rapidly return the display to its default configuration**" | Rev.4 §2.8-7 |

**`Table 2.6` is the test to apply to any proposed setting.** A preference earns its place if it
reduces the cost of *accessing*, *processing*, or *executing*, or if it improves the
signal-to-noise ratio of the display. "The user might like it" is not on the list. The
`§2.8-2` rule is the sharper one: **if you can anticipate the need, design for it instead of
exposing a control** — every knob you ship is a decision you have delegated to someone with
less context than you.

**This is the same principle as Ch 7's "what must NOT be user-adjustable", generalised.** Ch 7
locks settings that carry shared meaning; Rev.4 additionally caps settings that carry none,
because unbounded configuration is itself a usability cost. Both point the same way: **defaults
and design decisions are the product; settings are an escape hatch for the cases you genuinely
cannot predict.**

Note the tension this creates with Ch 7's adjustability requirements, and how it resolves: a
user must be able to adjust **brightness, volume, timing, and text scale** (Ch 7), because those
depend on the user's body, environment, and task — genuinely unanticipatable. A user should
**not** be able to reconfigure the interaction model, the information architecture, or the
coding scheme, because you can and should decide those once, well.

---

## Text as text

- **Images of Text (WCAG 2.2 1.4.5, AA)** — text must be used to convey information rather
  than images of text, except where the image of text can be **visually customised** to the
  user's requirements, or a particular presentation is essential. At AAA, **1.4.9** removes
  the customisation exception.
- **Rationale:** rasterised text cannot be resized, restyled, or recoloured, so it breaks
  Resize Text (1.4.4) and Visual Presentation (1.4.8) — and it becomes unreadable for anyone
  using a screen reader, a translator, or a custom stylesheet. This is why "just export the
  chart as a PNG with the labels baked in" is a defect, not a shortcut.

---

## Content on hover or focus

- **WCAG 2.2 1.4.13 (AA)** — where hover or keyboard focus reveals additional content that is
  then hidden, all three must hold:
  - **Dismissible** — can be dismissed without moving hover/focus, unless it communicates an
    input error or does not obscure other content;
  - **Hoverable** — the pointer can be moved onto the new content without it disappearing;
  - **Persistent** — it remains until the trigger is removed, the user dismisses it, or the
    information is no longer valid.

**Hoverable is the clause most implementations fail.** A tooltip that vanishes the moment the
cursor leaves the trigger makes its own content unreachable for anyone who needs to move the
pointer onto it — which includes every user who needs to select or scroll the tooltip text.

---

## Reading level and cognitive load

- **Reading Level (WCAG 2.2 3.1.5, AAA)** — when text requires reading ability more advanced
  than **lower secondary education level** (after removing proper names and titles),
  supplemental content or a simpler version must be available.
- **Apply this first to:** error messages, consent and legal text, onboarding, help text, and
  empty states. These are the places where comprehension failure has the highest cost.
- **Minimise required memory.** NASA HIDH's simplicity rule and NUREG-0700's menu rules both
  penalise interfaces that require the user to *remember* — where options live, what a code
  means, what mode they are in. Prefer recognition over recall, and show state rather than
  requiring the user to infer it.

---

## Motion sickness and vestibular safety

- **Minimise motion-sickness-provoking displays** — NASA HIDH §10 requires avoiding displays
  that provoke motion or simulation sickness, which is directly relevant to modern parallax,
  scroll-jacking, and large-field-of-view animation.
- **Animation from Interactions (WCAG 2.2 2.3.3, AAA)** — motion animation triggered by
  interaction **can be disabled**, unless essential. Honour `prefers-reduced-motion`.
- **Pause, Stop, Hide (WCAG 2.2 2.2.2, A)** — for moving, blinking, or scrolling information
  that starts automatically, lasts **more than five seconds**, and is presented in parallel
  with other content, provide a mechanism to **pause, stop, or hide** it. For auto-updating
  information presented in parallel with other content, provide a way to pause, stop, hide,
  **or control the update frequency**.

---

## Anti-patterns

- **A session timeout that discards the user's work.** WCAG 2.2 2.2.5 forbids it outright:
  re-authenticate and continue.
- **A time limit with no adjustment and no warning.** Violates WCAG 2.2.1 and the FAA rule
  that a sub-5-second response requirement needs an adjustable interval or an alternate mode.
- **Requiring a drag.** Must have a single-pointer alternative (WCAG 2.5.7) — this covers
  sliders, drag-and-drop reordering, swipe-to-delete, and map panning as the *only* control.
- **Overriding the user's platform input or motion preferences.**
- **Baked-in text in images.** Unreadable to screen readers, untranslatable, unzoomable.
- **Tooltips that vanish when you try to reach them.** Fails 1.4.13's *Hoverable* clause.
- **Consistency applied so broadly it erases affordance differences** — a destructive action
  styled identically to a safe one.
- **Requiring the user to remember what a code or mode means.** NUREG requires that the user
  never have to query the system to determine the current mode.
- **Treating accessibility as a final QA pass.** In these standards, adjustability, timing,
  and input flexibility are design inputs, not fixes.

---

## Connects to

- **Ch 1 (Text size)**: user-selectable font size and image-of-text rules are the same
  requirement as resizable text.
- **Ch 4 (Reading in motion)**: pause/stop/hide and reduced-motion.
- **Ch 5 (Response time)**: WCAG's timing rules and the ergonomics latency budgets meet here.
- **Ch 6 (Targets)**: target size and dragging alternatives.
- **Ch 7 (Defaults)**: adjustability ranges, and which parameters must not be adjustable.
- **Ch 9 (Navigation)**: focus order, focus visibility, link purpose, reading level of errors.
