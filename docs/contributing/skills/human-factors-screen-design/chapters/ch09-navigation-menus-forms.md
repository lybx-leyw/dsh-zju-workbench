# Chapter 9 — Navigation, menus, forms, and data entry

**Core idea.** These standards were written for applications where the user is a trained
operator and the cost of a wrong selection is high, so they are conservative about
**breadth** (how many options appear at once) and **depth** (how many levels before the
target). The numbers still transfer well to forms and settings panels. They transfer
**poorly** to large-scale public web navigation, and this chapter says where and why rather
than pretending otherwise.

---

## Menu breadth and depth

| Rule | Value | Source |
|---|---|---|
| Options per menu, general | **3 to 10** (not more than 10, not less than 3) | FAA HF-STD-001B §5.6.7.5.3.4 |
| Options per pull-down menu | **3 to 10** | FAA HF-STD-001B §5.6.7.5.10.10 |
| Options per menu, NUREG | **4 to 8** | NUREG-0700 Rev.1 §2.2.2-51 |
| Menus with **fewer than 3** options | **avoid** | NUREG-0700 Rev.1 §2.2.2-51 |
| Menus with **only 1** item | **must not be used** | NUREG-0700 Rev.1 §2.2.2-51 |
| Control-type thresholds for mutually exclusive choice | radio buttons up to **6**; menu up to **10**; scrolling menu for **>10** | FAA HF-STD-001B §5.6.7.5.1.2 |
| Menu bar option count | no more than **10 plus Help** | FAA HF-STD-001B §5.6.7.5.7.4 |
| Hierarchical depth | **no more than 4** selections to reach an option | FAA HF-STD-001B §5.6.7.5.11.5 |
| Hierarchical depth, NUREG | **no more than 3** levels | NUREG-0700 Rev.1 §2.2.2-47 |
| Cascading submenu levels | **limited to one** | FAA HF-STD-001B §5.6.7.5.12.4 |
| Scrolling menu search capability | provide search when a scrolling menu is large, e.g. **50 options or more** | FAA HF-STD-001B §5.6.7.5.13.9 |

**The stated rationale is the useful part.** FAA's discussion of hierarchical depth says
plainly: *"Broad, shallow structures are preferred over narrow, deep ones."* NUREG requires
the **parent menu to remain visible** during child selection, and FAA limits cascades to one
level because *"cascaded menus require the user to remember where options are located or
buried."* Depth is penalised because it forces recall; breadth is penalised only when it
forces scanning. That asymmetry is the principle to carry forward.

**Rev.4 restates the same conclusion and adds rules that modern practice routinely violates.**
NUREG-0700 Rev.4 §2.2.2 supplies the current normative form:

| Rev.4 rule | Statement | Citation |
|---|---|---|
| Broad and shallow | "**Broad and shallow** menu structures should be used, rather than narrow and deep menu structures." | §2.2.2.3-12 |
| Depth limit | hierarchy limited "for example, to **no more than three**" levels; parent menu stays visible during child selection | §2.2.2.1-15 |
| Options per menu | **four to eight**; menus with only **two** options should be avoided; a one-item menu should not be used | §2.2.2.1-16 |
| Visual grouping of long menus | if meaningful categories cannot be found, divide into **visual groups** with space or lines, **as equal in size as possible**, **four to seven options per group** | §2.2.2.1-21 |
| Minimise the middle | the number of choices should be **minimised on menus located midway** in the hierarchy, because "users are more likely to get lost in the middle levels" | §2.2.2.3-13 |
| Step count vs crowding | minimise hierarchic levels "**but not if it results in display crowding**" — an explicit statement that the breadth/depth trade-off has a floor | §2.2.2.3-6 |
| Direct submenu selection | users should be able to select a menu or submenu **directly, without intermediate steps** (e.g. from a representation of the structure) | §2.2.2.3-14 |
| One action to go up | **one simple key action** to return to the next higher level, and one to the general top-level menu; the user should **not** have to backtrack to the starting level | §2.2.2.3-7, §2.2.2.3-11 |
| Show current position | indicate the **current position** in the structure — recapitulate prior selections, or offer a map as HELP | §2.2.2.3-8 |
| Visualise the path | provide a **visual representation of the user's path** through the hierarchy (an icon showing previous/current menus, or a "walking menu") | §2.2.2.3-5 |
| Distinct submenus | each subordinate menu should be **visually distinct** from the superordinate one (level numbers, graphic stacking) | §2.2.2.3-9 |
| Branch vs action | format so that options which **accomplish a control entry** are distinguishable from those that merely **branch** | §2.2.2.3-10 |
| Option wording | word options as **commands to the computer, not questions to the user** — good `+PRINT`, bad `PRINT?`; good `p = Print`, bad `Print? (Y/N)` | §2.2.2.6-1 |
| Minimise permanent menus | permanent menus should be **minimised**; justified only when examining every option in detail matters, menu text is large, or there is no pointing device | §2.2.2.1-5 |
| Avoid recall | when a transaction has a small option set, show the options **on the working display** rather than requiring the user to remember them or open a separate menu | §2.2.2.1-1 |

**Two Rev.4 rules contradict common modern practice outright, and the reasons are worth
taking seriously:**

- **"All menu items should be visible to the user without scrolling"** (§2.2.2.2-3), and the
  number of menu-bar categories "should not exceed the length of the bar". This is the
  normative ancestor of the argument against overflow/hamburger menus on desktop: a menu whose
  contents must be scrolled is hiding its own breadth, and the user cannot judge what is
  available without moving through it. On a constrained viewport this rule cannot always hold;
  where it cannot, the standards' own escape is the **visual grouping** rule above rather than
  unbounded scrolling.
- **"The order of options on menus should be fixed"** and "should **not** change automatically
  (e.g. based on their frequency of use)" (§2.2.2.2-5). This directly forbids adaptive or
  most-used-first menu reordering — a technique that is popular precisely because it is
  measurable. The standards' reasoning is spatial memory: a stable position is learnable
  without reading, and a menu that reorders destroys that. Rev.4 does permit ordering *by*
  expected frequency as a **design-time** decision (§2.2.2.2-1, §2.2.2.2-2), just not a
  changing one at run time. **If you implement adaptive menus, you are trading spatial memory
  for expected-hits, and the sources come down against the trade.**

**Reconciling 3–10 vs 4–8.** These are not in conflict so much as differently derived:
NUREG's 4–8 is the narrower, checklist-style recommendation, FAA's 3–10 the broader
permissible band. **Treat 4–8 as the target and 3–10 as the permissible range.** Below 3,
the grouping is not earning its own menu; above 10, users start hunting rather than reading.

---

## Menu ordering, grouping, and behaviour

- **Destructive commands go last.** FAA HF-STD-001B §13 groups destructive commands at the
  bottom of the menu.
- **Opposing actions must never be adjacent.** FAA HF-STD-001B §13: keep opposite actions
  apart, so a mis-aimed selection cannot flip an action to its inverse.
- **Group by logical function, then frequency, then criticality.** NUREG-0700 Rev.1 §2.1-40.
- **Organise formats to minimise cursor travel.** NUREG-0700 Rev.1 §2.1-40: in cursor-driven
  systems, arrange so positioning movements are short. This is the direct ancestor of
  Fitts's-law-aware menu layout.
- **Options in a single vertical column.** Except for a menu bar, options should be presented
  in one column, so scanning is one-dimensional. FAA HF-STD-001B §13.
- **Unavailable options must not highlight on hover.** NUREG-0700 Rev.1 §2.2.2-50:
  available items highlight when the cursor passes over them with the button down and return
  to normal when it leaves; **unavailable options should not highlight at all.**
- **Only actually-available options should be offered.** NUREG-0700 Rev.1 §2.1-42: if an
  option is not implemented or not available, annotate it rather than silently offering a
  dead control.
- **Never leave the user without a next action.** NUREG-0700 Rev.1 §2.1-43: transactions
  should always offer next steps or alternatives; basic actions (Continue, Abort, Main) must
  be reachable at any point.
- **Equivalent keyboard shortcuts should be shown in the option label.** NUREG-0700 Rev.1
  §2.2.2-52 — display them inline, not only in documentation.
- **On/Off menu items** should be **perceptually distinct when On**, and selecting them
  should change state. NUREG-0700 Rev.1 §2.2.2-53, §2.2.2-54.
- **Split activation for pointing.** NUREG-0700 Rev.1 §2.2.2-48: if selection is by pointing,
  the first action designates the option and a **separate second action** commits it. This is
  the rule that produces "select then confirm" behaviour, and it exists to prevent accidental
  activation under vibration or stress. Most modern desktop UIs deliberately relax this to
  single-click; keep it for destructive or irreversible actions.
- **Generous pointing area for options.** NUREG-0700 Rev.1 §2.2.2-49: the acceptable pointing
  area should include **at least the option label plus a half-character distance around it**.
  This is the ancestor of padding-based hit areas (see Ch 6).

---

## Labels

- **Every field or column heading must be labelled.** MIL-STD-1472G §5.2.2.4.4.
- **Labels must be unambiguously related** to the group, field, or message they describe,
  **unique** and meaningful enough to be distinguished from data, error messages, and other
  alphanumerics. MIL-STD-1472G §5.2.2.4.4.
- **Labels should be highlighted or otherwise accentuated** to facilitate scanning.
  MIL-STD-1472G §5.2.2.4.4.
- **Case by length:** labels **shorter than three words** shall be **upper case only**;
  labels **longer than three words** shall be **upper and lower case**. MIL-STD-1472G
  §5.2.2.4.4. (Cross-check with Ch 1: mixed case reads faster; this rule is consistent with
  that — short labels are scanned, long labels are read.)
- **Label-to-data relation should be obvious** by position and alignment. NUREG-0700 Rev.1
  and MIL-STD both require the relation to be unambiguous rather than left to convention.

---

## Form layout

MIL-STD-1472G §16 gives spacing in *space characters*, which converts to em-based spacing
in CSS (one space ≈ 0.25–0.5 em depending on the font, so treat these as relative units).

| Element | Minimum separation | Source |
|---|---|---|
| Field label from its field | **≥1 space** | MIL-STD-1472G §16 |
| Field columns from each other | **≥3 spaces** | MIL-STD-1472G §16 |
| Field groups from each other | **≥5 spaces** | MIL-STD-1472G §16 |
| Heading indentation | **≥5 spaces** | MIL-STD-1472G §16 |
| Heading from first label | **≥3 spaces** | MIL-STD-1472G §16 |
| Table columns | **3 spaces**, with a **blank line every fifth row** | FAA HF-STD-001B §4 |
| Numeric columns | **decimal-point justified** | MIL-STD-1472G §16 |

**The grouping hierarchy is the actionable insight:** label→field is a small gap, group→group
is a large gap, and the ratio (1 : 3 : 5) is what makes grouping legible without borders.
Modern form design frequently fails this by using uniform spacing everywhere and relying on
dividers instead.

---

## Data entry, validation, and errors

- **Validate on blur or submit, not on every keystroke**, for anything that would reject a
  partially-typed valid value. The sources require that errors be *correctable*, and the
  related rule is that an error message "shall be continuously displayed until the error is
  corrected" (MIL-STD-1472G §5.1.2.1.5 k) — i.e. do not auto-dismiss the error before the
  user has acted on it.
- **Error messages must name the problem and the fix.** NUREG-0700 Rev.1's dialogue and error
  section requires specific, corrective wording rather than codes or blame, and requires the
  message to identify the offending field.
- **Write error text at or below a lower-secondary reading level.** WCAG 2.2 3.1.5 (AAA)
  requires that when text requires reading ability more advanced than **lower secondary
  education level**, supplemental or simpler content is available. Error messages are the
  highest-value place to apply this.
- **Confirmation for destructive actions, and the safe option must be the default.**
  NUREG-0700 Rev.1 requires the default for a destructive print option to be **NO**; see
  Ch 7 for the full default-safety rules.
- **Preserve user input across errors.** The sources' requirement that errors be correctable
  implies not discarding the user's work when validation fails — the direct ancestor of
  WCAG 2.2's re-authentication and data-preservation rules.

---

## Navigation, orientation, and finding your way

- **Focus Visible** — any keyboard-operable interface must have a mode where the focus
  indicator is visible. WCAG 2.2 2.4.7 (AA).
- **Focus Order** — focusable components must receive focus in an order that preserves
  meaning and operability. WCAG 2.2 2.4.3 (A).
- **Bypass Blocks** — a mechanism must exist to bypass repeated blocks of content. WCAG 2.2
  2.4.1 (A): the ancestor of skip links and landmarks.
- **Page Titled** — pages have titles describing topic or purpose. WCAG 2.2 2.4.2 (A).
- **Link Purpose (In Context)** — link purpose determinable from link text alone or with its
  programmatically determined context. WCAG 2.2 2.4.4 (A). This rules out bare "click here".
- **Show the current context continuously.** NUREG-0700 Rev.1 §2.1-34: if the consequence of
  an entry depends on prior context, a **continuous indication of current context** must be
  displayed, and *the user should not have to query the system to determine the current
  mode.* §2.1-35 adds that context information be distinctive and consistently placed, and
  that the system indicate the current position within a sequence. This is the strongest
  statement in the set in favour of visible state and against mode-hiding.

---

## Help and consistency

- **Context-sensitive help beats documentation.** NUREG-0700 Rev.1's help section requires
  help to be reachable from where the problem occurs; FAA HF-STD-001B §19 groups help
  requirements around immediate availability rather than a manual.
- **Consistency requirements are specific, not aspirational.** MIL-STD-1472G §17 and
  NUREG-0700 Rev.1 require: **location of recurring data similar among all displays**;
  terminology used consistently; display and input formats similar within hierarchical
  levels (FAA HF-STD-001B §5.6.7.2.2); and similar interaction patterns for similar tasks.

---

## Where these rules no longer bind — an honest note

**Menu depth.** FAA says ≤4 selections, NUREG says ≤3 levels. Large public websites
routinely exceed both, often necessarily: a retailer with 50,000 SKUs cannot present
category navigation inside four levels without unacceptable breadth at each level. The
standards' own logic explains the escape hatch — the penalty is **recall**, and a web
navigation system compensates with search, visible breadcrumbs, and browser history, none
of which existed for the operators these rules were written for. **The rule to keep is the
principle: prefer broad and shallow, keep the parent visible, and never make the user
remember where something is.** The specific integers are calibration for a context that is
not the web.

**Split activation.** The "select, then separately confirm" rule is actively harmful in
high-frequency modern UI. Apply it only where an action is destructive or irreversible.

**Menu bars.** FAA requires a menu bar to extend the full width of the primary window and
its options to remain visible at all times. Modern navigation (sidebars, command palettes,
hamburger/overflow menus) violates both. The underlying requirement — that the primary
navigation affordances stay discoverable rather than hidden behind a gesture — is still
sound, and is the reason the hamburger menu is a measurable usability cost on desktop.

**Fixed forms.** The spacing tables assume a fixed-width character grid. In a proportional,
responsive layout, translate them into **relative spacing** (the 1 : 3 : 5 grouping ratio)
and let the layout engine handle the rest.

---

## Anti-patterns

- **Deep nesting to avoid a long list.** Depth costs recall; breadth costs scanning. The
  sources consistently prefer paying in scanning — *"broad, shallow structures are preferred
  over narrow, deep ones."*
- **A menu with one or two items.** NUREG forbids the single-item menu outright and says to
  avoid fewer than three: the grouping is not conveying anything, and the extra click is pure
  cost.
- **Cascading submenus more than one level deep.** FAA limits cascades to one level precisely
  because the parent gets obscured and the user must remember the path.
- **Highlighting disabled options on hover.** NUREG is explicit that unavailable options
  should not highlight — a hover state is a promise of interactivity.
- **Uniform spacing in forms.** The 1 : 3 : 5 label/column/group ratio is what communicates
  structure without borders; uniform gaps flatten it.
- **Left-justifying numeric columns.** Decimal-point justification is required so magnitudes
  can be compared by eye.
- **Hiding current mode.** NUREG requires that the user never have to query the system to
  learn the current mode. Modal interfaces that do not display their mode are the canonical
  violation.
- **Auto-dismissing error messages on a timer.** Errors must persist until corrected.
- **"Click here" link text.** Fails WCAG 2.4.4.
- **Hiding primary navigation behind a gesture with no visible affordance.**

---

## Connects to

- **Ch 1 (Text size)**: label sizing and the case rules here depend on the legibility
  thresholds; short labels are *scanned*, long labels are *read*, which is why their case
  treatment differs.
- **Ch 2 (Spacing and density)**: form spacing is a special case of the general density and
  grouping rules.
- **Ch 6 (Targets and layout)**: the option pointing area and minimum target sizes govern
  menu and control hit areas.
- **Ch 7 (Defaults)**: form defaults, default button placement, and the rule that destructive
  actions are never the default.
- **Ch 8 (Alerts and messages)**: error message content, button sets, and dialog structure.
