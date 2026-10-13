# Extraction methodology and lessons learned

This document records **how** the human factors knowledge base in this folder was built, and
what went wrong along the way. It is written for the next person who points this pipeline at a
different body of source material — the domain knowledge is in [`SKILL.md`](SKILL.md); this is
the craft.

The short version: **the pipeline worked, but every one of its failures was a
document-identity or transcription-trust failure, not a technical one.** Plan for those.

---

## The pipeline

```
fetch  →  extract  →  mine  →  reconcile  →  assemble
```

| Stage | Tool | What it does |
|---|---|---|
| fetch | [`tools/fetch_sources.py`](tools/fetch_sources.py) | manifest-driven download with the proxy/TLS/UA workarounds this host needs |
| provenance | [`tools/write_provenance.py`](tools/write_provenance.py) | hashes every source, emits `sources/SOURCES.md`, verifies drift |
| extract | `pdftotext -layout`, [`tools/html_to_text.py`](tools/html_to_text.py) | source → layout-preserved plain text |
| mine | agent + a strict brief | one agent per source → `extracted/mined/<source>.mined.md` |
| verify | [`tools/verify_numbers.py`](tools/verify_numbers.py) | samples numeric claims and checks each occurs in the source text |
| index | [`tools/build_guideline_index.py`](tools/build_guideline_index.py) | line index for a document whose headings OCR poorly |
| reconcile | human judgement | [`CROSS-SOURCE-REGISTER.md`](CROSS-SOURCE-REGISTER.md) |
| assemble | agent, chapter per design question | `skills/human-factors-screen-design/` |

**One agent per source, one chapter per design question.** That split matters: mining is
source-shaped (one document at a time, exhaustive), while the skill is question-shaped (a
developer asks "how big should this text be", not "what does MIL-STD say"). Merging the two
would produce a skill organised by agency, which nobody wants to read.

---

## Lesson 1 — Publication URLs lie about document identity

**Three of the eight sources were mis-identified at intake.**

| Assumed | Actually | How it was caught |
|---|---|---|
| `DOT Human Factors Volume 1` (a research report) | **FAA-HF-STD-010A**, *Color Use in ATC System Displays* — a standard | an agent read the title page and reported the mismatch |
| `FHWA-HRT-16-060 Human Factors Assessment` (pedestrian crossing) | **Human Factors Guidelines for Transportation Management Centers** | same |
| `NUREG-0700 Rev.4` | **Rev.1 Vol.1** | a second agent noticed the page footers said `Rev. 1`; confirmed via `pdfinfo` Title |

The third one is the instructive case. An agent reported the revision mismatch, and the check
that settled it was **the PDF's own metadata**:

```
Title: NUREG-0700, Rev. 1, Vol. 1. "Human-System Interface Design Review Guideline..."
```

The genuine Rev.4 was then located and added — importantly, **not by guessing a URL** but by
scraping the publisher's landing page for the actual link
(`/docs/ML2602/ML26022A094.pdf`), whose metadata confirms `Rev. 4`.

**Practice:** after downloading anything, run `pdfinfo <file>` and read the `Title` field.
Compare it to what you think you downloaded. Rename the file to match the document, not the
URL. Record identity corrections in the manifest so the next person does not repeat the
mistake — the manifest for this set carries explicit notes for all three.

A fourth trap in the same family: the FHWA publication lives at a URL path containing
`/safety/` and the report number `16060` looks like a pedestrian-safety study. It is neither.

---

## Lesson 2 — An agent's confident claim about a source is a hypothesis, not a fact

Agents were reliable at transcription and unreliable at **attribution**. One agent produced a
correct and valuable extraction that mislabelled which of its two input files each finding came
from — it reported that Table 5.6-I was in "Source 1" when it is in Source 2.

The content was right; the pointer was wrong. That kind of error is more dangerous than a wrong
number, because it survives review: the number checks out against *a* source.

**Practice:** never accept a cross-source claim without re-locating the quoted text yourself.
In this run, every headline number was re-grepped in the raw extracted text before being
allowed into a chapter. Two of the verification scripts exist specifically to make that cheap.

---

## Lesson 3 — Verify numbers mechanically, not by eye

`tools/verify_numbers.py` samples numeric tokens from each mined file, normalises formatting,
and checks whether each value occurs in the corresponding source text. Result for this set:

```
total: 1145/1153 sampled numbers found in source (99.3%)
```

**All eight unmatched values were explainable**, and none was a fabricated source claim:

- two were my own `text L631–636` line references inside a mined file
- three were section-heading numbers the agent added (`### 1.11 …`)
- three were derived values (a unit conversion, a table reference)

That is the honest reading of a 99.3 % figure: it is strong evidence against invention, not
proof of correct attachment. The script says so in its own output. A number can appear in the
source and still be attached to the wrong rule — only reading catches that.

**Practice:** run the smoke test before shipping anything. A single unmatched number that
*should* have come from the source is worth an hour.

---

## Lesson 4 — Scanned PDFs need different scepticism than digital ones

`pdffonts <file>` cleanly separates the two classes:

| Source | fonts | embedded | meaning |
|---|---|---|---|
| NUREG-0700 Rev.4 | 62 | 62 | digital, trustworthy |
| MIL-STD-1472G | 14 | 13 | digital |
| FAA HF-STD-001B | 26 | 21 | digital |
| **NUREG-0700 Rev.1** | **2** | **0** | **300 ppi scan + OCR layer** |

The scanned file's prose is visibly damaged (`nunimuns` for "minimum", `altematives` for
"alternatives", `cunently` for "currently"). The important question was whether the **numbers**
survived. Sampling found they did — 198/200 numeric claims matched, and the two misses were
structural. But that is a measure of what OCR did *this time*.

**Practice:** treat every number from a scanned source as needing a second look, and prefer a
digital revision when one exists. Rev.4 superseded Rev.1, so Rev.4 wins wherever they overlap;
Rev.1 was kept only because it preserves numeric rules Rev.4 dropped.

---

## Lesson 5 — The brief given to the mining agent is the quality ceiling

The mining brief that produced usable output had four non-negotiable clauses:

1. **Never invent or round a number.** Every number must appear in the source. Omit rather
   than guess.
2. **Always cite the section number**, and the page when determinable.
3. **Prefer the source's own wording** for requirements; compress but do not paraphrase away
   specificity.
4. **If a topic has nothing, say so in one line** — do not pad.

Plus an output shape that made merging mechanical:

```markdown
- **<Short rule name>** — <the rule, preserving all numbers and units>
  - Citation: `<section>`
  - Applies to: <what part of an interface>
  - Rationale: <the source's stated reason, if it gives one>
```

**Clause 4 and the `Rationale` field turned out to matter most.** Requiring agents to record
what a source does *not* contain produced per-file gap sections that directly shaped the
skill's scope notes — the "reading while moving" gap was found this way, not by me noticing an
absence. And asking for the source's own rationale forced agents to read the explanatory
paragraphs, which is where the reasoning lives that makes a rule applicable rather than merely
quotable.

**Practice:** write the brief once, carefully, and reuse it verbatim across sources. All eight
sources here used the same brief with only the hunt-list changed.

---

## Lesson 6 — Reconcile explicitly; do not average

The eight sources frequently give **different numbers for the same question**. A naive merge
would either pick one arbitrarily or average them, both of which are wrong.

They differ for three identifiable reasons, and naming the reason usually resolves the conflict:

| Kind | Example | Resolution |
|---|---|---|
| **Unit** | text height in arcmin vs mm@710mm | convert; they agree (2.5–5.0 mm ≈ 12–24 arcmin) |
| **Domain** | colour count 4 vs 24 | the question differs: *remember* vs *discriminate* |
| **Internal** | MIL-STD display tilt: "perpendicular" vs "≥45° from" | report both; prefer the other sources |

The single most useful artefact of this whole project is
[`CROSS-SOURCE-REGISTER.md`](CROSS-SOURCE-REGISTER.md), because it is the layer no individual
source can provide and no agent produces unprompted.

**Practice:** budget real time for reconciliation. It is not a merge step; it is the analysis.

---

## Lesson 7 — Where a source's rule no longer binds, say so

Several rules assume a fixed-mount CRT and a trained operator. Pretending they still bind
unchanged would make the skill worse than useless for a modern web developer.

The chapters therefore state the limits explicitly — menu depth beyond 3–4 levels, split
activation, uniform form spacing on a proportional layout, WCAG's lack of an absolute minimum
text size. Each says what the rule was protecting and whether that protection is still needed.

**Practice:** a rule's *rationale* tells you when it has expired. A rule quoted without its
rationale becomes dogma.

---

## Environment gotchas (this host)

Recorded because each one blocks the pipeline and none is discoverable quickly.

1. **TLS.** `git` and `curl` use Windows `schannel` here and fail with
   `SEC_E_NO_CREDENTIALS (0x8009030e)`. Use `git -c http.sslBackend=openssl`, or Python
   `urllib` (OpenSSL). The environment proxies via `HTTP_PROXY`/`HTTPS_PROXY`.

2. **403s from `.gov` hosts.** `rosap.ntl.bts.gov` and `www.nrc.gov` reject a bare
   `Mozilla/5.0`. A full desktop-browser header set is required, and for nrc.gov HTML pages
   the `Sec-Fetch-*` headers too.

3. **The sandbox denies writes into `0700` directories.** Python's `tempfile.mkdtemp()` creates
   `0700`, so the upstream extractor dies writing `full_text.txt`. `os.chmod` on such a
   directory also fails. Measured: `0o777` OK, `0o755` OK, `0o700` → `PermissionError`. Also,
   the platform temp dir is outside the workspace. [`tools/run_extract.py`](tools/run_extract.py)
   fixes both without modifying the upstream checkout.

4. **`str.splitlines()` splits on form feed.** pdftotext output contains `\x0c`, so Python's
   `splitlines()` reported 36,795 lines for a file that `Get-Content` counts as 36,313. Any line
   index must split on `\n` only, or it will not match what an editor reports.

5. **`\x0c` and CRLF also affect naive indexing.** The first guideline index built here was
   silently wrong for exactly this reason and had to be rebuilt.

6. **Importing the upstream package writes `.pyc` into the pristine checkout.** This one was
   self-inflicted and worth recording because it is invisible to `git status` (upstream
   gitignores nothing here, but the files are untracked *and* the checkout otherwise reports
   clean). Upstream's `extract.py` sets `sys.dont_write_bytecode = True` inside an
   `if __name__ == "__main__"` block — which is true when it is run directly and **false when a
   wrapper imports it as a module**. The shim therefore left
   `book_to_skill/__pycache__/` and `book_to_skill/parsers/__pycache__/` (16 `.pyc` files)
   inside a checkout that is supposed to stay untouched. Fix: the shim now sets
   `sys.dont_write_bytecode = True` **before** importing `book_to_skill`
   ([`tools/run_extract.py`](tools/run_extract.py)). Verified after the fix: extraction still
   succeeds and zero `__pycache__` directories are created. **If you wrap someone else's CLI,
   replicate its `__main__`-guarded setup — those guards do not run when you import it.**

---

## Verifying a pristine vendored checkout

If the deliverable includes a pinned clone of a third-party tool, verify all three of these,
because the first can pass while the others fail:

```bash
git -C <checkout> status --porcelain --untracked-files=all   # must be empty
git -C <checkout> rev-parse HEAD                             # must equal the clone point
find <checkout> -name '__pycache__' -o -name '*.pyc'         # must be empty
```

`--untracked-files=all` matters: plain `git status --short` can hide untracked files inside
directories that also contain tracked ones, and bytecode caches are exactly that case.

---

## What was deliberately not done

- **No copyrighted textbooks were used.** The obvious authoritative sources (Salvendy,
  Wickens, Boff) are commercial publications. They were not downloaded from shadow libraries.
  The public-domain standards proved better suited anyway, because they state requirements as
  numbers with `shall`/`should` force.
- **No number was invented or silently rounded**, including when a figure existed only in a
  page image — those are recorded as gaps instead.
- **The generated skill was not installed into a host's global skills root.** It stays in this
  folder so there is one source of truth and nothing is shadowed.
- **Nothing was published or shared.** Chapter files synthesise rules; the sources are
  public-domain standards, but the safest default is to keep generated artefacts here.

---

## Reusing this on other material

1. Add entries to [`tools/sources.manifest.json`](tools/sources.manifest.json) — URL, licence,
   year, and a sentence on why it belongs. Verify each download's identity via `pdfinfo`.
2. `python tools/fetch_sources.py && python tools/write_provenance.py`
3. Extract to text (`pdftotext -layout`, or `html_to_text.py` for HTML). Check `pdffonts` to
   learn whether each file is scanned.
4. Dispatch **one mining agent per source** using the brief in Lesson 5, with a hunt-list
   tailored to the domain.
5. `python tools/verify_numbers.py` — investigate anything unmatched.
6. Reconcile by hand into a register. This is the step that creates the value.
7. Dispatch **one writing agent per design question**, not per source, each given the register
   and one existing chapter as the style exemplar.
8. Validate: `python book-to-skill/tools/validate_skill.py <SKILL.md> --lens claude`.
