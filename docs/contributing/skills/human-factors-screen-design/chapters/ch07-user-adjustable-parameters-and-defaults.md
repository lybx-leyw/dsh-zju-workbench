# Chapter 7 — User-adjustable parameters and the design of defaults

**Core idea.** A default is not a neutral placeholder — it is a **workload-reduction
device**, and MIL-STD-1472G §5.2.2.4.5 gives the only complete normative contract for how one
must behave. Everything else follows from three questions asked in order: *what value is most
likely correct, how cheap is it to accept, and how far may the user move away from it* — plus
one most teams never ask: **should this be adjustable at all?**

WCAG is silent on default *values*; it governs only that adjustment be *possible* and
non-breaking. So for defaults the government standards are the only source — and they agree
with each other far more than the spread of their domains would suggest.

---

## What a default IS — the six-part contract

MIL-STD-1472G §5.2.2.4.5 is worth quoting in full, because it is the most complete
normative answer in this entire source set to "how should defaults behave":

> To reduce user workload, default values shall be used. Currently defined default values
> shall be displayed automatically in their appropriate data fields with the initiation of a
> data entry transaction. The user shall indicate acceptance of the default by a single
> keystroke. The user shall be able to replace any default value during a given transaction
> without changing the default definition. The user shall have the option of generating
> default values based on operational experience, if the systems designer cannot predefine
> appropriate values. Where a series of default values has been defined for a data entry
> sequence, the experienced user shall be allowed to default all entries or to default until
> the next required entry.

Clause by clause, with what each one demands of an implementation:

| Clause | Text (abridged) | What it requires in code | Fails when… |
|---|---|---|---|
| **(a)** | defaults **shall** be used, *to reduce workload* | Every field, setting, and dialog where one value is more likely than others ships with a default | the form opens empty "to avoid biasing the user" |
| **(b)** | displayed **automatically** at the initiation of a data-entry transaction | The value is *in the field*, not in a tooltip, placeholder, or help text | the default exists in config but the input renders blank |
| **(c)** | acceptance by a **single keystroke** | `Enter` accepts the whole form; arrow/tab moves between pre-filled values without clearing them | accepting requires a click, a confirmation, or re-typing |
| **(d)** | replaceable during a transaction **without changing the default definition** | Instance state and template state are separate objects | the user's edit is written back to the settings store |
| **(e)** | user may **generate defaults from operational experience** | An expert path: "save current values as my defaults" | only the vendor can define defaults |
| **(f)** | default **all entries** or **up to the next required entry** | Bulk-accept for a sequence, plus a stopping rule at mandatory fields | every field in a long workflow must be confirmed one at a time |

**Clause (a) is the load-bearing one.** "To reduce user workload" is the *stated purpose* of
the requirement, so a default that does not reduce work is not a default in the standard's
sense — it is a value that happens to be pre-filled. That is the test to apply to every
default you write. Note that **(e) and (f) are permission-granting rather than prescriptive**:
the standard does not say what the operational-experience default should be, only that the
user must have the option of generating it when the designer cannot predefine a good value —
a direct admission that some defaults are only knowable in the field.

### Where MIL-STD, FAA and NUREG agree

FAA HF-STD-001B states the same contract independently, adding the display trigger:

| Requirement | Value / rule | Source |
|---|---|---|
| A field with a default shows it automatically when the form appears | required | FAA §5.6.2.11.7.2 (p. 271) |
| The default is displayed when the system prompts for a parameter that has one | required | FAA §5.6.13.2.2 (p. 341) |
| A defined default is displayed for keyed command / option-code entry | required | FAA §5.6.12.1.12 (p. 339) |
| Default entries appear in their fields in form-filling interactions | "wherever possible" | FAA §5.6.7.4.2 (p. 305) |
| A replaced default does not change the default itself | required; the same default reappears next time | FAA §5.6.2.11.7.4 (p. 271) |
| Defaults are indicated so the user can review and confirm or change them | required | NUREG-0700 Rev.1 §2.2.5-2 |
| Currently operative defaults are displayed for data entry | required | NUREG-0700 Rev.1 §2.7.1-7 (p. 230) |
| A default defined for a null control entry is indicated to the user | required | NUREG-0700 Rev.1 §2.1-59 |

NUREG's last three rules are MIL-STD (b) restated for three entry mechanisms — form filling,
live data entry, and command-code entry. **A default the user cannot see is not a default; it
is hidden state.**

---

## How to choose the default value

The sources never say "pick the average" or "pick the middle of the range." They give two
principles.

**Principle 1 — the default is the value that is *correct*, defined by the hardware's
capability, not by taste.** NUREG's tracking-speed rule: the default should be **moderate**,
and *"At a minimum, movement of the controller across the entire maneuvering surface should
move the cursor from one side of the screen to the other"* (§3.2.3-5). The inter-click
interval follows the same shape: a moderate default from a **predefined list of
alternatives** (§3.2.3-6).

**Principle 2 — the default is the most likely intent.** FAA states the general rule twice:

> "When a form is expected to have the same entry in a particular field **most of the time**;
> that entry should appear in that field as a default entry when the form first appears."
> — FAA HF-STD-001B §5.6.2.11.7.1 (p. 270)

> "**The most likely selection** in a menu list shall be made the default option."
> — FAA HF-STD-001B §5.6.7.5.6.7 (p. 309)

That is an operational definition: the default is the **mode** of the distribution of what
users actually do in that field. If you cannot state which value is the mode, you do not yet
know what the default should be — measure it, or apply MIL-STD clause (e) and let the user
generate it.

### Defaults the sources actually pin to a number

These are the concrete default *values* in the whole source set. Every one of them is a
number a developer can ship today.

| Parameter | Default | Range / alternatives | Source |
|---|---|---|---|
| Key-repeat **delay** | **0.5 s** | user-selectable | NUREG-0700 Rev.1 §3.2.1-19 |
| Key-repeat **rate** | **0.1 s** (≈10 chars/s) | user-selectable; adjustable per NASA | NUREG-0700 Rev.1 §3.2.1-19; NASA HIDH §10.4.2.3.7 |
| Key held → repeat begins | **500 ms**, then **~10 characters per second** | repeat rate **must** be adjustable | NASA HIDH §10.4.2.3.7 (p. 975) |
| Repeat initial delay (MIL-STD) | **500 to 750 milliseconds** | "when a repeat delay is provided" | MIL-STD-1472G §5.1.3.1.7 (p. 30) |
| Text-entry cursor blink rate | **3 Hz** | — | NUREG-0700 Rev.1 §2.3.6-3 (p. 194) |
| Pointing cursor blink | **should not blink** | — | NUREG-0700 Rev.1 §2.3.5-2 (p. 193) |
| Double-click interval | **700 ms** (two clicks within) | — | NUREG-0700 Rev.1 §2.2.6-9 (p. 191) |
| Cursor rate aiding | **OFF** (zero-order control-display relation) | on / off | NUREG-0700 Rev.1 §2.3.3-4 (p. 190) |
| Controller tracking speed | **moderate** | predefined list | NUREG-0700 Rev.1 §3.2.3-5 |
| Inter-click interval | **moderate** | predefined list | NUREG-0700 Rev.1 §3.2.3-6 |
| Cursor speed options | at least **two** (normal and fast) | — | NUREG-0700 Rev.1 §2.3.3-5 (p. 190) |
| Text window default height | at least **4 lines** | more than 4 shows little advantage | NUREG-0700 Rev.1 §2.5.6-10 (p. 217) |
| Text window default width | **50 to 80 characters** | 52–78 fastest for scrolling text | NUREG-0700 Rev.1 §2.5.6-11 (p. 217) |
| Window default size | **less than the full screen** | — | FAA §5.6.14.1.5 (p. 357) |
| Panel legend minimum brightness | dimmable to ~**0.1 cd/m²** | — | NASA HIDH §8.7.10 (p. 775) |
| Body-text size on a monitor (evidence, not a standard) | **12 pt** read quicker than 10 pt or 14 pt | inverted-U | FHWA-HRT-16-060, Guideline 59 Rationale (p. 81) |
| Display calibration interval | before service, then **annually**, or sooner on operator request | — | FAA-HF-STD-010A Appendix B.2 (p. 53) |

Note the shape of the "moderate" defaults: NUREG gives **no number** for tracking speed or
inter-click interval, deliberately — it gives a *predefined list* and a qualitative target so
the value can be tuned per hardware. Do not invent a number where the source declined to.

### Other default values the standards fix

Beyond the numeric table above, these defaults are pinned by wording rather than by a figure:

- **Numeric unit defaults.** "When a consistent dimensional unit is used in a given entry
  field, the dimensional unit shall be provided by the computer. When the dimensional unit
  varies for a given field, it shall be provided, or selected, by the user." — MIL-STD
  §5.1.3.5.3.j (p. 44). The default includes the *unit*, not just the magnitude.
- **Entry mode.** Insert is the default text entry mode — FAA §5.6.2.4.1.7 (p. 253).
- **Justification.** Left-justified with consistent word spacing unless the user specifies
  otherwise; left/right/center/full offered as user options — FAA §5.6.2.4.3.6, §5.6.2.4.3.7
  (p. 254).
- **Hyphenation.** "The default mode should be **no hyphenation**." — FAA §5.6.2.4.3.9 (p. 254).
- **Status indication.** "The status bar should indicate normal or default modes by the
  **absence** of the indicator for the non-normal modes." — FAA §5.6.14.2.6.2 (p. 361). The
  general pattern: **the default state renders as nothing**, so any visible indicator is
  information.
- **Clipboard.** Additions to the temporary editing buffer are **not cumulative** by default —
  FAA §5.6.10.2.3 (p. 334).
- **Window size.** "The size and shape of the initial presentation of a window should be
  **consistent with its contents**" (NUREG §2.5.6-9, p. 216); "when possible, the initial size
  of a window should permit the display of all its contents" (FAA §5.6.14.1.14, p. 357),
  subject to the four-line and 50–80-character floors above.
- **Window placement** — based on (a) importance of the information (critical information
  centred in the user's field of view), (b) information already displayed that should not be
  obscured, (c) distance from the current pointer location (pointer movement minimised), and
  (d) relevant information already displayed. — FAA §5.6.14.1.15 (p. 357).
- **Combined power/volume control.** If power and volume must be combined, provide a noticeable
  **detent** between OFF and the lower end of the volume range, and label the OFF position —
  NASA §10.7.6 (p. 1040).
- **Full dimming permitted only in non-critical operations.** "Dimming to full OFF may be
  provided in noncritical operations, but shall not be used if inadvertent failure to turn an
  indicator ON could lead to a critical maintenance failure." — FAA §5.4.2.2.1.14 (p. 205);
  MIL-STD §5.2.3.13.14 (p. 116).
- **Auto-restore of audio volume.** Where a local volume reduction is allowed on an audio
  warning, "full volume is automatically restored upon initiation of the next warning signal."
  — MIL-STD §5.3.1.3.2.e (p. 124).

### Rev.4 confirms these figures, and supplies the ones Rev.1 lacked

NUREG-0700 **Rev.4** §2.3 and §11.3.2.3 restate the pin-to-a-number defaults independently,
so the values above are not single-source. Where the two revisions overlap they agree; Rev.4
adds these:

| Parameter | Default | Source |
|---|---|---|
| Rate aiding (cursor acceleration) | **OFF** | NUREG-0700 Rev.4 §2.3.3-4 (p. 2-57) |
| Cursor speed alternatives | **at least 2** (normal and fast) | Rev.4 §2.3.3-5 (p. 2-57) |
| Pointer/controller tracking speed (control-display ratio) | **moderate**, selectable from a predefined range | Rev.4 §11.3.2.3.1-4 (p. 11-41) |
| Interclick interval | **moderate**, from a predefined range | Rev.4 §11.3.2.3.1-8 (p. 11-42) |
| Text-entry cursor blink rate | **3 Hz** (when blinking is used at all) | Rev.4 §2.3.6-3 (p. 2-60) |
| Key repeat delay / rate | **0.5 s** delay, **10 characters per second** | Rev.4 §11.3.2.2.2-13 (p. 11-35) |
| Double click | two clicks within **700 ms** | Rev.4 §2.3.3-9 (p. 2-57) |
| Automatic defaults for control entries | should **protect against data loss or other adverse consequences** | Rev.4 §2.7.6-5 (p. 2-96) |

(Rev.1's rule that a destructive print option defaults to **NO** is §2.7.6-5's ancestor in the
older revision — cited in the table above under *Destructive options default to NO*. Rev.4
states the general principle rather than the single example.)

Rev.4 also bounds two settings that earlier revisions left open, and the bounds are the
interesting part — both push the limit onto the *system* rather than the user:

- **Update rate** is user-controllable, but "the allowable rate should not exceed that capable
  of being met by the information source and the processing equipment" (Rev.4 §1.4-2). The user
  may slow the system down; they may not ask it to exceed what it can actually deliver.
- **Cursor step size** must track character size: "the incremental cursor positioning should
  vary correspondingly, with a step size matching the size of currently selected characters"
  (Rev.4 §2.3.3-6). This is the rule that keeps an adjustable font size from breaking precise
  cursor placement — if you scale text, scale the cursor step with it.

And one permission worth having: Rev.4 §2.5.4-3 explicitly allows **user control of the speed
of updating displayed data** in some applications — time *compression* for slowly developing
patterns, time *expansion* for fast-changing data. That is the sanctioned form of the
"movement speed" control Ch 4 was asked about: not a crawl rate, but a **user-adjustable
temporal scale** over the data itself.

---

## Default placement and the cost of acceptance

Choosing the right value is half the job. The other half is making it cost almost nothing to
accept — and making sure that the *cheap* path is never the dangerous one.

### Focus and cursor on entry

| Situation | Where focus goes | Source |
|---|---|---|
| Selecting options by **keyboard** | the **default option**, in the control entry area, with that area having **implicit input focus** | FAA §5.6.7.6.1.2 (p. 318); restated §5.6.12.1.14 (p. 339) |
| Selecting options by **pointing device** | the cursor is placed on the **default option** | FAA §5.6.7.6.1.5 (p. 319); restated §5.6.12.1.13 (p. 339) |
| A **form** first appears | the cursor goes automatically to the **first position of the first field** | FAA §5.6.2.11.6.1 (p. 269) |
| A **window** first appears | focus/highlighting on the object users are **most likely to select** (a text field or a default push button) | FAA §5.6.14.5.4.8 (p. 373) |
| A window first receives input focus | the text cursor goes in the text area **where typing is most likely** | FAA §5.6.13.10.2.7 (p. 352) |
| Form display (MIL-STD) | cursor positioned by the system at the **first data-entry field** | MIL-STD §5.1.3.5.3.f (p. 44) |
| Initial view of a data-entry display | form filling → **first entry field**; menu by pointing → **first listed option**; menu by code → **command entry area** | NUREG-0700 Rev.1 §2.3.1-5 (p. 188) |
| Window regains focus | focus returns to the object that **last had input focus** in that window | FAA §5.6.14.5.4.9 (p. 373) |

The FAA and NUREG rules converge on one sentence: **the first thing that can be activated
must be the thing most likely to be wanted.** That is also the accessibility position —
WCAG 2.4.3 requires focus order to preserve meaning and operability — but FAA and NUREG go
further and specify *what* should be first, not merely that the order be sensible.

### Default buttons

| Rule | Value | Source |
|---|---|---|
| Number of default buttons in a control window | **no more than one** | FAA §5.6.14.2.8.7 (p. 362) |
| Position of the default button | **leftmost or topmost** | FAA §5.6.14.2.8.8 (p. 362) |
| Destructive action as the default button | **shall not be designated as the default** | FAA §5.6.14.2.8.9 (p. 362) |
| Default button must be visually distinguishable | required (extra border, highlight, or 3-D appearance) | FAA §5.6.13.5.12 (p. 346) |
| Button ordering | by frequency of use, sequence of use, or with positive actions at left/top and negative or cancelling actions at right/bottom | FAA §5.6.14.2.8.6 (p. 362) |

**These four rules compose into a single layout decision.** Positive action leftmost/topmost,
negative action rightmost/bottom-most, exactly one of them drawn as the default — and if the
action is destructive the default is *not* it, so the default moves to the safe sibling. There
is no configuration in which a destructive button is both leftmost and painted as the default,
because §5.6.14.2.8.9 outranks §5.6.14.2.8.8.

### Destructive options default to NO

NUREG supplies the concrete case that makes the abstract rule testable:

> "If automatic defaults are provided for control entries, those defaults should protect
> against data loss, or at least not contribute to the risk of data loss. Example: when
> printout of filed data is requested, one control option might be to delete that file after
> printing; **the default value for such a destructive option should automatically be set to
> NO** whenever the printing options are presented."
> — NUREG-0700 Rev.1 §2.7.4-5 (p. 235)

Note the operative phrase: **"whenever the printing options are presented."** The default is
not set once at install; it is re-asserted every time the option surface appears. That is the
pattern for every destructive checkbox — *Delete after printing*, *Do not ask again*, *Apply to
all items*, *Skip confirmation* — each must default to the non-destructive state **on every
presentation**, not merely on first run.

Two supporting NUREG rules complete the mechanism. **Destructive modes are never established
automatically**: users must take *"explicit action to select any operational mode that might
result in data loss. Destructive modes should **not** be established automatically"*
(§2.7.4-4, p. 235). And **the Enter key is not the confirmation key** — FAA
§5.6.15.10.1.12 (p. 384): *"The Enter key shall not be used for confirmation of destructive
actions."* Combined with MIL-STD clause (c)'s single-keystroke acceptance, this means the fast
path and the dangerous path must use **different physical actions**.

### The form default is an instance, and it must not overwrite

MIL-STD adds a prohibition that rules out the most common "convenient" default implementation:
*"Data shall not be entered by overwriting a set of characters in a field (such as a
default)"* (§5.1.3.5.3.h, p. 44). FAA gives the correct behaviour: *"A user shall be able to
replace that value by moving the cursor into that field and typing, causing the default value
to disappear **immediately after the first keystroke**"* (§5.6.2.11.7.3, p. 271). NUREG agrees
— *"If a user chooses to alter the contents of a field, the displayed previously existing entry
(e.g., a default value or label) should be **cleared from the input field**"* (§2.1-66).

**Do not preselect the default text.** Select-all-on-focus and type-to-replace are the two
acceptable behaviours; a caret placed at the start of the default value is a bug.

---

## Separating the instance from the template

This is the rule most often violated in real code, so it gets its own section.

> **MIL-STD-1472G §5.2.2.4.5(d)** — "The user shall be able to replace any default value
> during a given transaction **without changing the default definition**."

> **FAA HF-STD-001B §5.6.2.11.7.4** — "When a default value is replaced, the default value
> itself shall not be affected so that the next time the form appears, the same default value
> will appear in the field."

**The persistence bug this prevents.** A form loads a default into a field; the user edits it
for a one-off transaction; the save path writes the whole form object back to the settings
store. The one-off edit is now the permanent default for every future user on every future
session. The form opens with a value correct for exactly one transaction in the past and wrong
for all the rest, nobody notices, and the UI gives no clue that a default was overwritten.

The fix is structural: **the default definition and the field instance must be two objects
with two write paths.** A transaction writes the instance; only an explicit "change the
default" action writes the definition. FAA permits a system to offer the latter, but only as a
deliberate user choice — the stated exception to §5.6.2.11.7.4 is *"when an application
permits a user to select whether he or she wants the application to retain the last entry or a
previous default value as the current default setting."* FAA also requires a dedicated
surface for the template side, which is exactly the settings-vs-data-entry split: *"A default
listing or screen shall be provided in which authorized users may view and change default
settings of fields"* (§5.6.7.4.3, p. 305).

And the lifetimes must be chosen explicitly, not by accident:

> "Design the system with a default for each setting, and decide which interface parameters
> users will be given access to and allowed to set. Decide which of these settings will remain
> in effect for the current session only and which will be in effect whenever that user logs
> on." — FAA §5.6.15.1.6 (p. 377), source Discussion

Three lifetimes to keep distinct in every settings model: **the default definition** (the
template), **the user's persisted preference** (the override that survives logout), and **the
in-session instance value** (the edit that survives nothing). Collapsing any two reproduces the
bug above.

---

## How much adjustment to allow

A default with no room to move is a decoration. The sources give both a *range* requirement
and a *granularity* requirement for each parameter class.

### Range

| Parameter | Required adjustable range | Source |
|---|---|---|
| Display luminance (highest:lowest) | **not less than 50:1** | MIL-STD-1472G §5.2.1.3.1 (p. 82) |
| Display brightness control | from **10 % of minimum ambient luminance** to **full luminance** | MIL-STD-1472G §5.2.1.3.4 (p. 83) |
| VDU luminance control | from **10 % of minimum ambient luminance** to **full luminance** | NUREG-0700 Rev.1 §1.5.1-10 |
| On-screen luminance (FAA wording) | **10 % to 100 %** luminance | FAA HF-STD-001B §5.3.1.5.5 (p. 146) |
| Post-print luminance (survivability) | adjustable **to zero** where required | MIL-STD-1472G §5.2.1.3.5 (p. 83) |
| Panel legend luminance floor | continuously adjustable to ~**0.1 cd/m²** | NASA HIDH §8.7.10 (p. 775) |
| Dark-adaptation dimming floor | dimmable to at least **0.000035 cd/m²** and at least **0.00035 cd/m²** | MIL-STD-1472G §5.5.3.1.6.d (p. 146) |
| Vehicular night display luminance | **0.1 to 3.5 cd/m²** (0.03 to 1.0 fL) | MIL-STD-1472G §5.6.5.8.1 (p. 165) |
| Field-use panel dimming | continuously variable from **0.1 cd/m²** near OFF to **3.5 cd/m²** at the 50 % control position | MIL-STD-1472G §5.2.1.6.4, table XIII (p. 85) |
| LED backlight luminance (worked example) | max **11 cd/m²**; caution/warning **30.9 cd/m²**; nominal indicator **18.2 cd/m²** | NASA HIDH §8.7.10.1 (p. 775) |
| Brightness variation between separate panels on one circuit | **not to exceed 1:7** | MIL-STD-1472G §5.2.3.16.5 (p. 118) |
| Foreground–background contrast when adjustable | **>3:1**, **7:1 preferred**; **not less than 2:1** at maximum ambient light | FAA §5.3.1.5.9 and §5.3.1.5.10 (p. 147) |
| Colour/contrast setting variety | a range of colour selections capable of producing **a range of contrast levels** shall be provided | FAA §5.6.6.2.9.6 (p. 298) |
| Volume, voice communications | **5 to 100 %** of maximum; minimum limited to an audible level | NASA HIDH §10.7.6 (p. 1040) |
| Volume, aural annunciations | **5 to 100 %** of maximum, *excluding caution and warning* | NASA HIDH §10.7.5.2 (p. 1040) |
| Volume, alarm signals (software) | min setting limited to an **audible** level; cannot be reduced to inaudible | MIL-STD-1472G §5.3.1.6.e(4) (p. 129); §5.3.1.5.7.c (p. 125) |
| Auditory signal intensity ceilings | **≤115 dB(A)** emergency; **≤90 dB(A)** other; **≥ ambient + 10 dB(A)** | FAA §5.5.2.8.2–.5 (p. 236) |
| Communications gain headroom | power output at least **15 dB** above anticipated ambient noise | MIL-STD-1472G §5.3.1.7.b(1) (p. 130) |
| Volume/gain electrical headroom | drive to at least **100 dB** overall with two earphones | MIL-STD-1472G §5.3.1.7.e(2) (p. 130) |
| Accessible comms output capability | at least **110 dB** overall with two earphones | NASA HIDH §10.7.6 (p. 1040) |
| Time limit (web/content) | adjustable over a range of at least **10 × the default** | WCAG 2.2 **2.2.1** (Level A) |
| Time-limit extension | at least **20 s** to extend, extendable at least **10 times** | WCAG 2.2 **2.2.1** (Level A) |
| Timeout disclosure exempt threshold | warn unless data is preserved **more than 20 hours** of inactivity | WCAG 2.2 **2.2.6** (Level AAA) |

**Read the 50:1 and the 10 %–100 % together, because they are not the same statement.**
MIL-STD §5.2.1.3.1 requires a *dynamic range* of at least 50:1 (highest to lowest). FAA
§5.3.1.5.5 and MIL-STD §5.2.1.3.4 require the control to *span* from 10 % of minimum ambient
luminance to full. A slider whose endpoints satisfy the second but whose physical panel only
reaches 20:1 fails the first. Implement both.

**The 10 × multiplier generalises.** WCAG 2.2.1 is the only normative statement on how a
default and its adjustable range should relate: *adjustable range ≥ 10 × the default*. For
time limits that is literal; for other quantities it is the right sanity check — if the range
is only 1.5 × the default in either direction, the user cannot change the operating point,
only nudge it. **"Numeric displays should accommodate the full range of the variable"** (FAA
§5.6.2.7.6, p. 262) is the display-side counterpart: the field must show the extremes of the
range without truncation, carrying the significant digits the task requires and no more
(§5.6.2.7.5, p. 262).

### Granularity

| Requirement | Value | Source |
|---|---|---|
| Illumination adjustment granularity | **continuously adjustable**, or a minimum of **30 increments** through the full range from full bright to full off | MIL-STD-1472G §5.1.2.1.6 (p. 25) |
| Dimming control | **multiple step or continuously variable** | MIL-STD-1472G §5.2.3.13.14 (p. 116) |
| Dimming control (NASA) | **continuous**, or a **fine stepwise approximation** to continuous | NASA HIDH §8.7.5.2 (p. 769) |
| Fine-grained dimming | all displays, backlit keyboards, panel indicators, egress and task lighting shall allow **fine grained control by the user** | MIL-STD-1472G §5.5.3.1.1.f (p. 144) |
| Rotary selector positions (hardware analogue) | maximum of **24 positions** on a rotary selector control, with detents at each | NUREG-0700 Rev.1 §3.3.2.5-2 |

**30 increments is the floor, and it is a floor on *count*, not on *perceptual evenness*.**
A brightness slider with 30 linear steps looks compliant and is not usable, because the first
few steps are indistinguishable and the last few are enormous. That is the subject of the next
section.

---

## Perceptual quantities need logarithmic scaling

This is the single most commonly missed rule in the set, and it is stated with unusual
precision by NASA:

> "In keeping with **Weber's Law** regarding human perceptual sensitivity, the control should
> provide increments in luminance that are **proportional to the value of luminance (L)**. For
> every equal incremental increase in the control setting, the luminance of the source should
> change by a **constant ratio**; this results in a **logarithmic relationship** between
> control changes and luminance changes. For example, if an increment in the control setting
> doubles source luminance, a further equal increase in setting should redouble luminance to
> four times the original value."
> — NASA HIDH §8.7.5.2 (p. 769)

**What this means in code.** A brightness slider's position `p ∈ [0, 1]` must not map to
luminance as `L = L_max · p`. It must map as `L = L_min · (L_max/L_min)^p` — a constant ratio
per step. The same applies to volume, and to any control whose physical quantity is
multiplicative.

**Two further consequences the sources draw explicitly:**

- **Direction convention is mandatory and identical across control types.** "When a rotary
  control is turned **clockwise**, or when a linear control is moved **upward or to the
  right**, luminance should steadily **increase** with each successive movement"
  (NASA HIDH §8.7.5.2, p. 769). NUREG states the general population stereotype: *Increase =
  forward, up, right, clockwise; Decrease = backward, down, left, counterclockwise*
  (§3.1.1-16, p. 245), with rotary controls clockwise = increase (§3.4.3-1, p. 285) and linear
  controls up or right = increase (§3.4.3-2, p. 285). MIL-STD's table XIII gives the
  hardware analogue: rotary full counter-clockwise (OFF) to full clockwise (ON); horizontal
  slider full left (OFF) to full right (ON); vertical slider full down (OFF) to full up (ON)
  (§5.2.1.6.4, table XIII, p. 85).
- **One control, not several.** "Ideally, the luminance levels of all these indicator types
  should be **proportionally adjustable by a single "brightness" control**"
  (NASA HIDH §8.7.10.1, p. 775). A single master control preserves the relative luminance
  hierarchy — the dimmest legends, the mid-tier status indicators, and the brightest
  caution/warning indicators — as the user dims. Separate per-element sliders destroy that
  ordering, and with it the semantic distinction the ordering was carrying.

### Do not implement dimming as opacity or RGB multiplication

FAA-HF-STD-010A is emphatic, and this is a defect that ships constantly:

> "ATC software shall make the luminance changes… solely by allowing the operator to command
> a new desired luminance and then using the equations in **IEC 61966-2-1:1999** to compute
> new sRGB values that have the **same CIE chromaticity coordinates as before**. ATC software
> **shall not** make luminance changes by scaling sRGB values (e.g., halving the values to
> reduce an object's luminance) because that approach will **alter the object's chromaticity
> coordinates** in most cases."
> — FAA-HF-STD-010A §5.15.5 (p. 39)

If you dim by multiplying RGB, a saturated blue drifts toward black-blue and every coded
colour in your interface shifts hue as the user adjusts brightness. Convert through the sRGB
transfer function to a target luminance instead. This one rule is the difference between a
brightness control and a colour-corruption control.

---

## When adjustment must be continuous vs may be fixed

MIL-STD-1472G **table XXIII** (§5.5.3.1.1.c, p. 148) is the only source in the set that states
the adjustability requirement as a function of *condition of use* rather than of parameter.
This is the table to consult when deciding whether a control needs a slider or may be a fixed
setting.

| Condition of use | Luminance (cd/m²) | Luminance (fL) | Required adjustment |
|---|---|---|---|
| Indicator reading, **dark adaptation necessary** (white flood, indirect, or both, with operator choice) | 0.07 – 0.35 | 0.02 – 0.1 | **continuous throughout range** |
| Indicator reading, dark adaptation **not necessary but desirable** | 0.07 – 3.5 | 0.02 – 0.1 | **continuous throughout range** |
| Indicator reading, dark adaptation **not necessary** (white flood) | 3.5 – 70 | 1.0 – 20 | **fixed or continuous** |
| Panel monitoring, **dark adaptation necessary** | 0.07 – 0.35 | 0.02 – 0.1 | **continuous throughout range** |
| Panel monitoring, dark adaptation **not necessary** | 35 – 70 | 10 – 20 | **fixed or continuous** |
| **Possible exposure to bright flashes, restricted daylight** | 35 – 70 | 10 – 20 | **fixed** |
| Chart reading, **dark adaptation necessary** | 0.35 – 3.5 | 0.1 – 1.0 | **continuous throughout range** |
| Chart reading, dark adaptation **not necessary** | 17 – 70 | 5.0 – 20 | **fixed or continuous** |

**The pattern is the rule, and it transfers directly to software.** Continuous adjustment is
required wherever the ambient illumination varies — specifically wherever the user's eyes must
adapt to darkness (*dark adaptation necessary*, or desirable) — because a fixed level legible
in daylight is blinding at night and vice versa. It is *optional* where the ambient
environment is stable and bright, and **explicitly forbidden where the user may be exposed to
bright flashes in restricted daylight** — the one condition in the table where a fixed value
is mandatory.

Two supporting rules make the same point in software terms. **Automatic brightness adjustment
is permitted, not required**: it *"may be used if the brightness is adequate for the full
range of ambient illuminance"* (MIL-STD §5.2.1.3.7, p. 83) — if the automatic curve is not
adequate across the whole envelope, the manual control must remain. And **automatic adjustment
that hides state is a defect**: NASA on dynamic contrast says it *"produces a ratio that bears
little relation to the static contrast ratio and may be of questionable value since it cannot
be obtained in a single frame"* (§10.3.2.2.2.7, p. 921).

### Update rate, freeze, and resume

Closely related, and specified in the same style — MIL-STD §5.2.2.6.4–.8 (p. 105) treats the
refresh behaviour of a live display as a user-adjustable parameter with a fixed contract:

| Requirement | Rule | Source |
|---|---|---|
| Update rate controllable by the user | required | MIL-STD §5.2.2.6.4 (p. 105) |
| User control of display update rate | user should control it, but the allowable rate should not exceed what the source and processing equipment can meet | NUREG-0700 Rev.1 §1.4-2 |
| Display freeze mode | a freeze mode **shall** be provided to allow viewing any selected frame that is updated or advanced automatically | MIL-STD §5.2.2.6.5–.8 (p. 105) |
| Resume from freeze | a **single action** option to resume **at freeze point or at the current real-time point** | MIL-STD §5.2.2.6.5–.8 (p. 105) |
| Prohibition on freeze | user **shall be prohibited** from entering freeze mode when doing so would adversely affect the mission | MIL-STD §5.2.2.6.5–.8 (p. 105) |
| Freeze feedback | an appropriate **label** shall remind the user the display is frozen | MIL-STD §5.2.2.6.5–.8 (p. 105) |
| Freeze feedback salience (NUREG) | obvious reminder, desirably in an attention-grabbing mode such as a flashing message | NUREG-0700 Rev.1 §2.5.3-6 (p. 210) |
| Resume semantics (NUREG) | resumed update positioned at the **current real-time point**; alternatively resume where it stopped, or a speeded "replay" of interim changes | NUREG-0700 Rev.1 §2.5.3-8 (p. 210) |
| Auto-updating windows | must have display freeze capability; user controls the scroll rate of auto-updated screens | NUREG-0700 Rev.1 §2.5.6-31 (p. 219) |
| Readable changing values | values the user must reliably read: **≤1 update/second**; values read for rate of change or gross value: **not faster than 5/s, not slower than 2/s** when the display is "real-time" | NUREG-0700 Rev.1 §1.4-1, §1.4-3 (p. 129) |
| Numerals read consecutively | not faster than **one per second** | NUREG-0700 Rev.1 §1.5.7-4 |
| Changing values that must be read | displayed in a **fixed position**, updated **no more than once per second** | NUREG-0700 Rev.1 §2.5.3-2 |
| WCAG's related requirement | auto-updating info presented in parallel with other content: user must be able to pause, stop, hide it, **or control the update frequency** | WCAG 2.2 **2.2.2** (Level A) |

Notice that **freeze is not a nicety in these sources — it is a capability on the same footing
as the update itself**, with three obligations: a resume that is one action, a label that says
the display is frozen, and a *prohibition* on freezing when it would be dangerous. Software
that polls a live feed should carry all three.

---

## What must NOT be user-adjustable

The most under-implemented idea in this chapter. Every source in the set carves out a class of
parameters that must be **locked**, and the principle behind the carve-out is consistent:
**safety-critical and shared-meaning signals are not preferences.** A setting is a statement
about one user's preference; a coding scheme is a statement about what the system means.

| Must not be adjustable | Rule | Source |
|---|---|---|
| **Critical alarm loudness** | "Manual disable or adjustment of auditory signal intensity (loudness) should be **avoided**… **Under no circumstances should operators be able to disable audio alarm signals or reduce their level so as to render them inaudible.**" | NUREG-0700 Rev.1 §4.5.6.3-11 |
| **Caution and warning audio levels** | the crew **does not adjust** them; they are adjusted relative to the predicted background noise level | NASA HIDH §10.7.5.2 (p. 1040) |
| **Alarm control designs must not be defeatable** | "Alarm system control designs should **not allow the operator to defeat the control**" — including soft controls that may be "easily defeated in software" | NUREG-0700 Rev.1 §4.6.1-5 (p. 313) |
| **Status colours** | "Status colors shall be **assigned during installation**, without the possibility for users to change them." | FAA §5.6.6.2.9.4 (p. 298) |
| **Coding/status colours on a shared monitor** | "individual users **shall not** be able to change colors for coding and status of facilities, services, or equipment such as alarms or alerts" | FAA §5.6.6.2.9.5 (p. 298) |
| **Chromaticity of alerts and critical information** | "ATC software **shall not** allow operators to change the CIE chromaticity coordinates of colors used to convey alerts or other critical information. The software shall **protect those coordinates against attempts to circumvent** the lack of an intentionally provided means to change them." | FAA-HF-STD-010A §5.15.1 (p. 39) |
| **Controlled items / setpoints** | "When information must not be changed, users **should not be permitted** to change controlled items. It is **not enough** simply to instruct users not to make changes in displayed information." | NUREG-0700 Rev.1 §2.7.4-3 (p. 235) |
| **User-set alarm parameters, in three named cases** | user setting should **not** be allowed when (1) one user's settings might affect another user's reception of alarms; (2) the settings might affect the safety of systems, equipment, or personnel; or (3) alarm parameters are determined by functional, procedural, or legal requirements | FAA §5.5.2.1.10 (p. 233) |
| **Hue and saturation of display colours (discouraged)** | "Operators **should be discouraged** from adjusting display controls that alter hue or saturation because these actions may degrade the discriminability, recognizability, and/or legibility of the colors and necessitate recalibration. Adjustments of **overall brightness and contrast are permissible**, though, because operators can correct them easily if they cause viewing problems." | FAA-HF-STD-010A Appendix B.6 (p. 54) |
| **Any display characteristic designed to convey important task information** | "Users should **not** be able to change display characteristics that have been specifically designed to convey information important to their tasks… such as **coding schemes**." Graphic examples: **size, shape, and colour codes for icons, symbols, borders, lines, and arrows**. Text examples: **font characteristics (size, style, colour), abbreviations and acronyms for messages, and labels** | NUREG-0700 Rev.4 §2.8-8 (p. 2-103) |
| **Unbounded interface flexibility** | "Users' flexibility in configuring the interface **should not be unlimited**." Constrain it so configuration does not become "a complex decision-making task"; the options offered should be **well defined** | NUREG-0700 Rev.4 §2.8-6 (p. 2-103) |
| **Critical display coding on a shared display** | where more than one user can configure a display, "**mechanisms are needed to ensure that displays created by one user are not changed or eliminated by other users**" — password protection, special directories, or administrative procedures | NUREG-0700 Rev.4 §2.8-4 (p. 2-103) |

### The "important information" rule, and why it is broader than "safety-critical"

The **NUREG-0700 Rev.4 §2.8-8** rule above is worth isolating, because it draws a wider
boundary than the alarm and safety rules do — and this is the revision that supersedes Rev.1:

> "The HSI may allow users to change or adjust some characteristics **if** these changes will
> enhance personnel performance. However, users should not be able to change display
> characteristics specifically designed to convey important information, such as coding
> schemes."

The test is therefore **not** "is this dangerous to change?" but **"was this characteristic
designed to carry meaning?"** If yes, it is locked regardless of severity. Concretely, that
locks: icon/symbol/border/line/arrow **size, shape, and colour codes**; message
**abbreviations and acronyms**; **labels**; and text **font size, style, and colour** where the
font carries meaning.

This is a stronger constraint than most product teams apply, and it explains a common failure:
letting users restyle the *semantic* layer (status chips, severity badges, chart series
colours) in the name of personalisation, which silently breaks every shared screenshot,
runbook, and support conversation that depends on the code meaning the same thing for
everyone.

**Note the deliberate tension with Ch 1 and Ch 10.** FAA §5.6.2.5.7.1 says font size *should*
be user-selectable, WCAG requires text to resize to 200 %, and Rev.4 says font characteristics
**should not** be user-changeable. These reconcile on the same axis as everything else in this
chapter: **the user may scale the presentation, but may not redefine what a characteristic
means.** Enlarging text is a legibility accommodation; changing the font or colour that encodes
severity is a semantic change. Permit the first; lock the second — and implement the first as
a scale factor over the locked system rather than as free-form styling.

**Note the asymmetry FAA-HF-STD-010A draws, because it is the general principle.**
Brightness and contrast are **adjustable** because a bad setting is *self-correcting* — the
user sees the problem and 1:1 fix it. Hue and saturation are **discouraged**, and the
chromaticity of critical information is **forbidden**, because a bad setting degrades
*discriminability and recognisability* — the user cannot tell that a colour now means
something different, and neither can the next user of that workstation.

### Where colour adjustment IS allowed — and how narrowly

FAA-HF-STD-010A also supplies the best-specified *permitted* colour-adjustment design in the
set, for non-critical information. It is worth copying verbatim as a specification:

> "If this capability is provided, it shall function **solely** by allowing the operator to
> designate a displayed object and select alternative chromaticities for it from a **finite
> palette**. The alternatives shall have the **same luminance as the object's default color**
> and have **hues that are similar to the default color**. All alternatives shall be tested
> beforehand and have been shown **not to degrade operator task-performance**. **No other
> chromaticity-change methods (e.g., sliders or color wheels) are permissible.**"
> — FAA-HF-STD-010A §5.15.2 (p. 39)

Every constraint here has a purpose: *finite palette* (no unreviewed states), *same luminance*
(so brightness-based coding is unaffected), *similar hue* (so the code stays recognisable),
*pre-tested* (so no option is worse than the default), *no sliders or colour wheels* (a
continuous space contains an unbounded number of untested states). The **scope** of such a
change is specified too, and it is the right granularity model for any visual customisation:
object **only**, **all objects of the same type**, or all objects forming a **natural group**
(§5.15.6, p. 39).

**FAA's rule for what *may* be adjustable in colour is the complement of the "must not" list:**

> "When appropriate to the functionality of an application, users should have the option of
> selecting from a variety of color sets as a user preference setting for aspects of an
> application **that do not involve coding or status**." — FAA §5.6.6.2.9.1 (p. 298)

The test is one question: **does this colour carry a meaning the user must interpret?** If
yes, it is locked. If no, it is a preference — and it must come with a one-action way back.

---

## Restoring defaults

Every source that permits customisation also requires a cheap way to undo it. Collectively
these rules define a "reset" that is a first-class, always-present affordance rather than a
buried troubleshooting step.

| Requirement | Rule | Source |
|---|---|---|
| Restore default colour scheme | "the application **shall** provide an **easy way** to restore the default color scheme" — required whenever users may change non-coding colour settings | FAA §5.6.6.2.9.2 (p. 298) |
| Reset all colours to default sRGB | "shall provide a function that allows operators to **reset all colors to their default sRGB values quickly and easily**" | FAA-HF-STD-010A §5.15.7–5.15.11 (p. 40) |
| Reset on restart | "shall reset all colors to their default sRGB values and send a command to the display that selects its sRGB-preset state… **each time the software is restarted**" | FAA-HF-STD-010A §5.15.7–5.15.11 (p. 40) |
| Hardware default on power-on | "The display **should always default to its sRGB-preset state** when it is turned on." | FAA-HF-STD-010A §5.16.1–5.16.10 (pp. 40–42) |
| Presets portable across displays | "shall allow operators to restore their presets to **any display that is controlled by that software**, regardless of whether a preset was created for the display the operator is using currently" | FAA-HF-STD-010A §5.15.7–5.15.11 (p. 40) |
| Return to default after zooming | "When zooming is provided, an **easy means to return to the default display** should also be provided." | FAA §5.6.3.2.2.9 (p. 276) |
| Return to normal display coverage | if the user may pan or zoom, provide an easy means to return — e.g. a function key labeled **RETURN** or **RESET** | NUREG-0700 Rev.1 §2.5.2-9 (p. 209) |
| Home position for maps | users should be able to "return to initial appearance" and "define a home position and return to this position easily" | FAA §5.6.3.2.2.1 (p. 275) |
| Icon locations | users may change the **default location of icons**, and user-selected icon locations **should be retained across sessions** | FAA §5.6.13.3.17 and §5.6.13.3.18 (p. 343) |
| Settings reviewable and resettable mid-session | "Users should be able to **review user specified interface parameters and reset them at any time during a session**." | FAA §5.6.15.1.6 (p. 377) |
| Session-scoped settings reset at end of session | "At the end of a session, any parameters with settings that apply only to the current session **should be reset to their default values**." | FAA §5.6.15.1.2 (p. 377) |
| Window position: session vs. next session | moved/resized **and closed and reopened in the same session** → reappears in the size and location it had when closed; **at the next application session** → appears in its **default location** | FAA §5.6.14.6.2.2 and §5.6.14.6.2.3 (p. 375) |
| Easy return to initial function-key assignments | where function-key assignments change by user selection, give an easy means to return to the initial functions | NUREG-0700 Rev.1 §3.2.2-10 (p. 253) |
| Restoring suppressed data | suppressed data must be quickly restorable to its complete, originally generated form (§2.5.4-4); the restore key must have **no other use** (§2.5.4-5) | NUREG-0700 Rev.1 §2.5.4-4, §2.5.4-5 (p. 211) |
| Restore from backup | a "data restore" function must exist and must work **independent of external support** (e.g. loss of communication) | NASA HIDH §10.12.7.2–.4 (pp. 1068–1069) |

**Two of these rules conflict on the surface and must both be honoured.** FAA
§5.6.14.6.2.2 says a window closed and reopened *within a session* keeps its size and location;
§5.6.14.6.2.3 says that *at the next application session* it appears in its **default**
location, not where the user left it. Yet §5.6.13.3.18 says user-selected icon locations **are**
retained across sessions. The resolution: **window geometry is session-scoped; icon placement
is persistent.** The sources specify different lifetimes for the two, deliberately — icon
placement is a chosen preference, whereas a window's position is usually a side-effect of the
task in progress.

FAA-HF-STD-010A's restart-reset rule is the strongest statement in the set and the one most
worth adopting wholesale: **customisation is not permanent by default.** Colour customisation
resets to the standard on restart, and explicit presets exist for users who want to keep one —
so a workstation left in an unusual state cannot persist that state into the next operator's
shift, which is precisely the shared-monitor hazard FAA §5.6.6.2.9.5 guards against. It does
**not** apply to the user's own saved presets, which are restorable anywhere.

---

## Adaptive and learned defaults

MIL-STD clause (e) is the only licence in the set for a default that the designer could not
predefine:

> "**(e)** The user shall have the option of generating default values based on **operational
> experience**, if the systems designer cannot predefine appropriate values."
> — MIL-STD-1472G §5.2.2.4.5(e) (p. 97)

Read carefully, this is **not** a licence for the *system* to learn silently. It is a licence
for the *user* to generate the default. The distinction matters:

| Licensed by §5.2.2.4.5(e) | Not licensed |
|---|---|
| An explicit "save current values as my defaults" action | Silently writing the last submitted value back as the default |
| A per-user default profile the user can inspect and clear | A per-user default the user cannot see |
| A default derived from a documented operational procedure | A default inferred from traffic, invisible and unauditable |

The reason to keep it explicit is the same reason destructive-option defaults must be
re-asserted: **if the default can drift without the user's knowledge, the user cannot reason
about what the field will contain.** That is the failure MIL-STD §5.2.2.4.5(d) and FAA
§5.6.2.11.7.4 exist to prevent — a default that silently becomes a record of the past rather
than a statement about the normal case.

Clause (f) is the bulk-entry counterpart and is a *sequencing* feature, not a value feature:
**accept everything**, and **accept everything up to the first field that genuinely requires
the user's input**. The second is the better default UX for a long form, and it requires the
form to know which fields are required — the same distinction MIL-STD already requires be
visible: *"Required fields shall be distinguished from optional fields"* (§5.1.3.5.3.d,
p. 44).

---

## Is font size user-adjustable? — the one genuine disagreement

The sources conflict here, and the conflict is worth stating rather than smoothing over,
because the resolution is domain-dependent and a modern application must pick a side
deliberately. (MIL-STD's position is recorded in its own mined file as an explicit gap: *"No
rule found. Font/character height is specified as a fixed function of viewing distance
(§5.2.2.4.1.c, §5.4.6.3.12), not as a user setting."*)

| Source | Position |
|---|---|
| **FAA HF-STD-001B §5.6.2.5.7.1** (p. 260) | "When an application **cannot** satisfy the range of viewing requirements with a single text font, the application **should** provide text font size as a user-selectable option." — conditional, only when one size cannot serve |
| **NUREG-0700 Rev.1 §2.6.1-8** | The user **should** have the ability to change the physical characteristics of text — which "may include **font type, size and capitalisation**" — plus font style and tab position. Unconditional, in the text-editor context |
| **MIL-STD-1472G** | **No user-adjustable font-size rule**, recorded as an explicit gap in the mined file |
| **WCAG 2.2 1.4.4** (Level AA) | Text **must** be resizable up to **200 %** without loss of content or functionality. On the web, adjustability is mandatory — though the mechanism may be the browser rather than the page |
| **WCAG 2.2 1.4.8** (Level AAA) | A mechanism must be available for foreground and background colours **selectable by the user**, ≤80 characters per line (40 for CJK), text not justified, and resizable to 200 % without horizontal scrolling |

### Resolution

**This is a domain disagreement, and every position is correct for its own context.**

- **MIL-STD's position holds when the viewing distance is fixed and controlled** — a console,
  a kiosk, a cockpit. There a single correct size *is* computable from the arcmin rules (see
  **Ch 1**), and offering adjustment invites the user to set it wrong. MIL-STD is not
  neglectful; it is declining to expose a parameter it believes it can compute.
- **FAA's and NUREG's position holds as soon as viewing conditions vary** — different
  monitors, window positions, and users, which is the normal case for software. FAA's
  *"cannot satisfy the range of viewing requirements with a single text font"* is a trigger
  condition, not a prohibition.
- **WCAG removes the choice entirely for general-purpose content**, because the viewing
  distance is unknown by construction, so no single correct size exists.

**For a modern application: make text size adjustable (FAA + NUREG + WCAG), but choose the
default as MIL-STD would.** You do not control the viewing distance, so you cannot compute one
correct size — but the default should still be the size correct for the *expected* viewing
distance, and adjustment must be an **escape hatch, not the primary mechanism** for getting
legibility right. A design whose legibility depends on the user finding the font-size setting
has already failed.

Consequences for the implementation:

| Requirement | Rule | Source |
|---|---|---|
| Default size | compute from expected viewing distance via arcmin rules | Ch 1; MIL-STD table XXI |
| Adjustable range upward | at least to **200 %** without loss of content or functionality | WCAG 2.2 **1.4.4** (AA) |
| Layout under enlargement | no loss at **1.5 ×** line height, **2 ×** paragraph spacing, **0.12 ×** letter spacing, **0.16 ×** word spacing | WCAG 2.2 **1.4.12** (AA) |
| Reflow under enlargement | presentable without two-dimensional scrolling at **320 CSS px** width or **256 CSS px** height | WCAG 2.2 **1.4.10** (AA) |
| Enlargement as an accessibility feature | people with moderate visual disabilities must be provided **a means for enlarging a display** | FAA §5.6.18.3.1 (p. 400) |
| Alternative output for severe visual disability | text and graphics available at the alternative output display | FAA §5.6.18.3.2 (p. 400) |
| Text must not be rasterised | images of text break resizing, restyling and recolouring | WCAG 2.2 **1.4.5** (AA); **1.4.9** (AAA) |

---

## A procedure for adding an adjustable setting

Follow this in order. Steps 1–3 decide *whether* the setting should exist; steps 4–14 decide
*what it does*.

1. **Classify it: is it a preference or a meaning?** If the value carries a meaning another
   person must interpret — an alarm colour, a severity indicator, a coding colour, an alarm
   threshold that affects others' alarms — stop. It is **not adjustable** (FAA
   §5.6.6.2.9.4, §5.6.6.2.9.5, §5.5.2.1.10; NUREG §4.5.6.3-11, §2.7.4-3;
   FAA-HF-STD-010A §5.15.1). Document *why* it is locked, so a later reviewer does not
   "fix" it.
2. **Ask whether it can be computed instead.** If the correct value is a function of a known
   physical fact — viewing distance, panel luminance, hardware pixel density — compute it and
   ship no control at all (MIL-STD's position on character height). Offer a control only when
   the value genuinely varies with the user or the environment.
3. **If it stays, name its safety class.** Safety-critical (may not be reduced to
   ineffective), destructive (may not be the default), or ordinary preference. This class
   determines every subsequent decision.
4. **Choose the default from the mode of actual use** — the value that is correct "most of
   the time" (FAA §5.6.2.11.7.1; §5.6.7.5.6.7). If you cannot name the mode, either measure
   it or expose MIL-STD §5.2.2.4.5(e)'s explicit "save as my default" path instead of
   inventing a number.
5. **Check the default against the safety class.** Destructive or data-losing option → default
   to the non-destructive value, **re-asserted on every presentation** (NUREG §2.7.4-5). Alarm
   or caution/warning audio → not user-adjustable at all (NASA §10.7.5.2; NUREG §4.5.6.3-11).
6. **Set the adjustable range from the operational envelope, not from taste.** Use the table
   in *How much adjustment to allow* above. Where the source gives a range — 50:1 luminance,
   10 %–100 % luminance, 5 %–100 % volume, 10 × the default for a time limit — implement at
   least that range. Apply the equivalent of WCAG's 10 × multiplier as a sanity check: if the
   range is not several times the default, the user cannot really change the operating point.
7. **Set the granularity.** Continuous for illumination and dimming, or a minimum of **30
   increments** (MIL-STD §5.1.2.1.6). Where you are coding brightness *levels* rather than
   setting an absolute level, use **no more than three** intensity levels, each separated from
   its neighbour by a **2:1** ratio (FAA §5.6.6.3.2, §5.6.6.3.3).
8. **Choose the transfer function.** If the underlying quantity is multiplicative — brightness,
   volume, opacity — use a **constant-ratio (logarithmic) mapping**, not linear
   (NASA §8.7.5.2). Implement luminance changes through the sRGB transfer function, never by
   multiplying RGB or applying `opacity` (FAA-HF-STD-010A §5.15.5).
9. **Fix the direction convention.** Clockwise / up / right / forward = increase; the opposite
   = decrease (NASA §8.7.5.2; NUREG §3.1.1-16, §3.4.3-1, §3.4.3-2; MIL-STD table XIII).
   Never let a horizontal slider and a knob disagree.
10. **Decide the lifetime, explicitly.** Default definition / persisted user preference /
    session-only instance. Write down which one the control writes to (FAA §5.6.15.1.6
    Discussion; §5.6.15.1.2; §5.6.14.6.2.2–.3).
11. **Separate the write paths.** The transaction path writes the *instance only*. A distinct,
    user-initiated action writes the *definition* (MIL-STD §5.2.2.4.5.d; FAA
    §5.6.2.11.7.4). Add a regression test that replaces a default in a transaction and asserts
    the stored default is unchanged.
12. **Add the restore path.** One action returns the setting to its default, reachable at any
    time during a session, plus a reset-all (FAA §5.6.6.2.9.2; §5.6.15.1.6;
    FAA-HF-STD-010A §5.15.7–5.15.11). If the setting is a colour customisation, make it
    **reset on application restart** and expose saved presets separately.
13. **Place the acceptance affordance and the focus.** Default button leftmost or topmost and
    visually distinct, exactly one; never a destructive action; initial focus on the default
    option or the first field of the first form (FAA §5.6.14.2.8.7–.9, §5.6.13.5.12,
    §5.6.7.6.1.2, §5.6.7.6.1.5, §5.6.2.11.6.1; NUREG §2.3.1-5).
14. **Make the default visible and replaceable in one gesture.** Pre-filled, not placeholder
    text. First keystroke clears it — never preselect the value (FAA §5.6.2.11.7.3; MIL-STD
    §5.1.3.5.3.h; NUREG §2.1-66). Accepting is one keystroke (MIL-STD §5.2.2.4.5.c).

**A worked example — adding a "refresh interval" control to a live dashboard.** Steps 1–3:
a preference, not a meaning (it changes only what this user sees); not computable (it depends
on the user's task, not a physical fact); an ordinary preference, neither safety-critical nor
destructive. The remaining steps:

| Step | Decision | Why |
|---|---|---|
| 4 | Default: **≤1 update/second** if the user must reliably read the values; **2–5 per second** only if the values are read for trend or gross magnitude | NUREG §1.4-1, §1.4-3. Default to the slow end of the applicable band — nothing in the sources rewards a faster refresh |
| 5 | Safety check | Nothing here can be made inaudible or inoperative |
| 6 | Range: the control must let the user **stop** the update, not merely slow it | That is the freeze requirement, not a range of numbers — MIL-STD §5.2.2.6.5–.8; WCAG 2.2 2.2.2 |
| 7 | Granularity: discrete named steps, not a continuous slider | The meaningful values are a small set |
| 8 | No transfer function | It is a discrete choice |
| 9 | Right/up = faster, if presented as a slider | NASA §8.7.5.2 |
| 10 | Session-only lifetime by default; persistence is an explicit opt-in | A user who must read the display reliably will want it persisted — FAA §5.6.15.1.6 |
| 11 | Changing the interval on one dashboard must not change it for others | Clause (d) applied at component level |
| 12 | "Live / Paused / Slow" presets, plus a one-action reset to the default | MIL-STD §5.2.2.6.5–.8; FAA §5.6.6.2.9.2 |
| 13 | The settings dialog's default option takes initial focus | FAA §5.6.7.6.1.2 |
| 14 | Current interval *and* paused state are **always visible**, not only while the control is open | MIL-STD §5.2.2.6.5–.8; NUREG §2.5.3-6, §2.7.4-9 |

---

## Anti-patterns

- **The silently-mutating default.** A form edit is written back to the settings store, so the
  one-off value becomes the permanent default — exactly what MIL-STD §5.2.2.4.5(d) and FAA
  §5.6.2.11.7.4 forbid. Fix by separating the instance from the template, not by adding a
  confirmation dialog.
- **A default the user cannot see.** The value exists in config but the field renders blank or
  shows it only as a placeholder. MIL-STD clause (b) requires it *in the field* at the
  initiation of the transaction; NUREG requires it indicated three separate ways (§2.1-59,
  §2.2.5-2, §2.7.1-7).
- **The Enter key used both to accept a default and to confirm a destructive action.** FAA
  forbids Enter specifically for destructive confirmation; MIL-STD requires a destructive mode
  to be selected by explicit action. The fast path and the dangerous path must be physically
  different actions.
- **A destructive option as the default button.** FAA §5.6.14.2.8.9 is absolute; the corollary
  is that the default moves to the safe sibling, so a dialog offering only "Delete" and
  "Cancel" puts the default on Cancel.
- **Two default buttons, or none.** More than one makes "single keystroke acceptance"
  ambiguous; none makes the dialog unaccept-by-keyboard (FAA §5.6.14.2.8.7, §5.6.13.5.12).
- **A linear brightness or volume slider.** The first steps are imperceptible and the last
  enormous, because perception is logarithmic (NASA §8.7.5.2). A 30-step linear slider
  satisfies MIL-STD's §5.1.2.1.6 *count* and fails its purpose.
- **Dimming by multiplying RGB or by CSS `opacity`.** Shifts chromaticity, so every coded
  colour drifts as brightness changes; FAA-HF-STD-010A §5.15.5 forbids the sRGB-scaling
  approach by name.
- **A free-form colour picker for a status or alarm colour.** Disallowed (FAA-HF-STD-010A
  §5.15.1, §5.15.2), and FAA §5.6.6.2.9.4 locks status colours outright. A curated,
  luminance-locked, pre-tested palette is the permitted form, and only for non-critical
  information.
- **Letting an operator reduce alarm volume to inaudible, or disable it.** NUREG §4.5.6.3-11:
  *under no circumstances*. The floor is enforced in the control's range, not merely documented.
- **A customisation that survives a restart with no way back.** FAA-HF-STD-010A requires a
  one-action reset *and* a reset on application restart. A theme with no reset becomes a
  workstation the next operator cannot interpret.
- **An "adaptive" default the user cannot inspect.** MIL-STD clause (e) licenses the **user**
  generating defaults from operational experience; it does not license the system silently
  learning them. A default that drifts cannot be reasoned about.
- **A setting with no visible current state.** NUREG §2.7.4-9 requires continuous indication of
  the current mode, particularly where the mode affects data loss; MIL-STD §5.2.2.6.5–.8 and
  NUREG §2.5.3-6 require a label whenever a live display is frozen.
- **A time limit with no turn-off, no adjustment and no warning.** WCAG 2.2.1 requires one of
  the three; where adjustment is the answer the range must be **≥10 × the default**, with an
  extension of **≥20 s** available **≥10 times**.
- **Preselecting the default's text in an input.** MIL-STD §5.1.3.5.3.h forbids entry by
  overwriting; FAA §5.6.2.11.7.3 requires the default to vanish after the first keystroke.
- **Offering adjustment on a parameter the standards lock.** Every locked parameter above has a
  named reason — shared meaning, safety, or a functional/legal requirement. Shipping the
  setting anyway writes a defect no amount of good defaulting can repair.

---

## Connects to

- **Ch 1 (Text size and legibility)** — the font-size disagreement is resolved here; the
  default text size is chosen there, and its adjustability is governed by the rules in this
  chapter. Read them together.
- **Ch 2 (Spacing and density)** — WCAG 1.4.12's spacing multipliers and the reflow rule are
  the layout-side obligation of making text size adjustable.
- **Ch 3 (Contrast and colour)** — the "what must not be adjustable" list is mostly colour, and
  the sRGB-vs-scaling rule for dimming is a colour-integrity requirement, not a brightness
  one.
- **Ch 4 (Reading in motion)** — update rate, freeze, resume, and the pause/stop/hide rules are
  the same control surface viewed from the reading side.
- **Ch 5 (Response time)** — the freeze contract and the "working" thresholds share the same
  one-action, always-visible-state discipline.
- **Ch 6 (Targets and layout)** — a settings panel is a set of controls; the hit-area and
  spacing numbers apply unchanged.
- **Ch 8 (Alerts and messages)** — alarm loudness, alarm-parameter ownership, and the
  re-assertion of destructive defaults belong to alerting; the split is that this chapter
  decides *who may set what*, and Ch 8 decides *what is signalled*.
- **Ch 9 (Navigation, menus, and forms)** — default button placement, menu default option,
  first-field focus, and the button-ordering rules are the form-level instances of the
  placement rules here.
- **Ch 10 (Accessibility and consistency)** — resize to 200 %, reflow at 320 CSS px, target
  size, and the consistency requirement that a setting behaves the same way everywhere.
- `CROSS-SOURCE-REGISTER.md` §6 — the seven-point model of user-adjustable parameters this
  chapter expands, including the font-size reconciliation.
