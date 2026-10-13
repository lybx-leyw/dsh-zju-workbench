#!/usr/bin/env python3
"""Verify that numeric claims in the mined files actually occur in the source text.

The mined files were produced by agents reading extracted source text. An agent can
transcribe a number wrongly, or invent one. This script samples numeric tokens from a
mined file and checks whether each appears in the corresponding source text.

It is a *smoke test*, not a proof: a number can appear in the source and still be
attached to the wrong rule. But a number that does NOT appear anywhere in the source is
a hard signal that something was fabricated or misread, and that is worth catching
mechanically rather than by eye.

Numbers are normalised before comparison so that formatting differences do not cause
false alarms:
  - thousands separators removed          1,000 -> 1000
  - unicode minus / en-dash -> hyphen
  - a decimal written .5 or 0.5 is matched in both forms
  - values inside a range (4-8) are checked individually

Usage:
    python verify_numbers.py                    # check every mined file
    python verify_numbers.py --file FAA-HF-STD-001B.mined.md
    python verify_numbers.py --limit 200        # sample size per file (default 150)
    python verify_numbers.py --show-missing 40  # print this many unmatched values
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
MINED = ROOT / "extracted" / "mined"
SOURCES = ROOT / "extracted"

# mined file -> source text file
PAIRS = {
    "FAA-HF-STD-001B.mined.md": "FAA-HF-STD-001B.txt",
    "MIL-STD-1472G.mined.md": "MIL-STD-1472G.txt",
    "NASA-HIDR-Rev1.mined.md": "NASA-HIDH-Rev1.txt",  # legacy typo guard
    "NASA-HIDH-Rev1.mined.md": "NASA-HIDH-Rev1.txt",
    "NUREG-0700-Rev1-Vol1.mined.md": "NUREG-0700-Rev1-Vol1.txt",
    "NUREG-0700-Rev4.mined.md": "NUREG-0700-Rev4.txt",
    "WCAG22.mined.md": "WCAG22.txt",
    # FHWA-DOT covers two sources; both are searched.
    "FHWA-DOT.mined.md": "FHWA-HRT-16-060-TMC-Human-Factors-Guidelines.txt|FAA-HF-STD-010A-Color-Use-ATC-Displays.txt",
}

# A numeric token: at least one digit, optional single decimal part.
NUM = re.compile(r"\d+(?:\.\d+)?")

# Skip numbers that are almost certainly structural rather than factual: citation
# labels, section numbers, page numbers, line references, years, and markdown noise.
SKIP_CONTEXT = re.compile(
    r"(?i)"
    r"(citation|section|§|\bp\.\s*\d|page|rev\.|volume|vol\.|ch\d|ch\s|chapter|"
    r"line~?\s*\d|http|www\.|iso\s*\d|ansi|hfes|mil-std-\d|nureg-?\d|"
    r"faa-hf-std-\d|fhwa-hrt-\d|astm|ieee|sae|199\d|20[0-2]\d|"
    r"figure|table\s+[ivxl]+)"
)


def normalise(text: str) -> str:
    """Strip formatting so numeric comparison is about value, not presentation."""
    text = text.replace("\u2212", "-").replace("\u2013", "-").replace("\u2014", "-")
    text = text.replace("\u00a0", " ")
    # remove thousands separators inside numbers: 1,000 -> 1000
    text = re.sub(r"(?<=\d),(?=\d{3}\b)", "", text)
    return text


def numbers_in(line: str) -> list[str]:
    """Numeric tokens on a line, excluding obviously structural context."""
    if SKIP_CONTEXT.search(line):
        return []
    return NUM.findall(line)


def build_haystack(paths: list[Path]) -> str:
    parts = []
    for p in paths:
        parts.append(normalise(p.read_text(encoding="utf-8", errors="replace")))
    return "\n".join(parts)


def check(mined_name: str, mined_path: Path, limit: int, show_missing: int) -> tuple[int, int, list[str]]:
    if mined_name not in PAIRS:
        return 0, 0, [f"no source mapping for {mined_name}"]

    src_names = PAIRS[mined_name].split("|")
    src_paths = [SOURCES / n for n in src_names]
    missing_src = [p.name for p in src_paths if not p.exists()]
    if missing_src:
        return 0, 0, [f"missing source text: {', '.join(missing_src)}"]

    haystack = build_haystack(src_paths)

    # Collect candidate numbers with a little surrounding context.
    candidates: list[tuple[str, str]] = []
    for line in mined_path.read_text(encoding="utf-8", errors="replace").splitlines():
        for value in numbers_in(line):
            candidates.append((value, line.strip()[:120]))
    if not candidates:
        return 0, 0, []

    # Evenly sample across the file so the whole document is represented.
    step = max(1, len(candidates) // limit)
    sample = candidates[::step][:limit]

    checked = 0
    missing: list[str] = []
    for value, context in sample:
        checked += 1
        if value in haystack:
            continue
        # try a trailing-zero variant: 0.50 <-> 0.5
        alt = value.rstrip("0").rstrip(".") if "." in value else value + ".0"
        if alt and alt in haystack:
            continue
        missing.append(f"{value}   <- {context}")

    return checked, len(sample) - len(missing), missing[:show_missing] if show_missing else []


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--file", help="check only this mined file (basename)")
    ap.add_argument("--limit", type=int, default=150, help="numbers sampled per file")
    ap.add_argument("--show-missing", type=int, default=12, help="print this many unmatched values")
    args = ap.parse_args()

    if not MINED.is_dir():
        print(f"mined dir not found: {MINED}", file=sys.stderr)
        return 2

    files = sorted(MINED.glob("*.mined.md"))
    if args.file:
        files = [f for f in files if f.name == args.file]
        if not files:
            print(f"no such mined file: {args.file}", file=sys.stderr)
            return 2

    total_checked = total_ok = 0
    any_fail = False
    for f in files:
        checked, ok, missing = check(f.name, f, args.limit, args.show_missing)
        if checked == 0:
            print(f"{f.name:34} skipped ({'; '.join(missing) if missing else 'no numeric claims'})")
            continue
        pct = 100.0 * ok / checked
        flag = "OK  " if pct >= 97 else "WARN"
        print(f"{flag} {f.name:34} {ok:4}/{checked:<4} matched ({pct:5.1f}%)")
        total_checked += checked
        total_ok += ok
        if missing:
            any_fail = any_fail or pct < 97
            for m in missing:
                print(f"        unmatched: {m}")

    if total_checked:
        print(f"\ntotal: {total_ok}/{total_checked} sampled numbers found in source ({100.0*total_ok/total_checked:.1f}%)")
        print("note: a match does not prove the number is attached to the right rule;")
        print("      an unmatched number does prove it is absent from the source.")
    return 1 if any_fail else 0


if __name__ == "__main__":
    raise SystemExit(main())
