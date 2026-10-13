#!/usr/bin/env python3
"""Index the guideline headings that actually appear in a source's body text.

Built for NUREG-0700 Rev.1, whose OCR text layer mangles the guideline identifier:
a heading printed as `1.1-17 Appropriate Display Format` appears as
`1.1 17 Appropriate Display Format`, `1.1-18 ...` may survive intact, and prose
cross-references are frequently unreadable ("see Section 1.5.1 1"). Indexing the
document's own table of contents therefore does not work; indexing the **body
headings** does, because a heading is a line that is just an identifier plus a title.

Heuristics:
  - A body heading is `<section> <sep> <n> <Title>` where sep is a hyphen or whitespace,
    the title starts with a capital letter, and the line does not contain a run of dots
    (which marks a table-of-contents entry).
  - Duplicate identifiers are kept only once, at their first body occurrence.

Line numbers are 1-based and count LF/CRLF newlines only, matching what `Get-Content`,
`sed -n`, and editors report. Note that `str.splitlines()` is NOT used: it also splits on
form-feed (`\\x0c`) characters present in pdftotext output, which inflates the count.

Usage:
    python build_guideline_index.py --text extracted/NUREG-0700-Rev1-Vol1.txt \
        --out extracted/NUREG-0700-Rev1-Vol1.guideline-index.tsv
"""
from __future__ import annotations

import argparse
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent

# <section> <hyphen-or-space> <n> <Title>
HEADING = re.compile(
    r"^\s*(\d{1,2}(?:\.\d{1,2}){1,2})[\s\-.]+(\d{1,3})\s+([A-Z][^\n]{3,90}?)\s*$"
)
# Table-of-contents leaders, e.g. "Maps.....................97"
TOC_LEADER = re.compile(r"\.{4,}\s*\d+\s*$")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--text", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    text_path = Path(args.text)
    if not text_path.is_absolute():
        text_path = HERE.parent / text_path

    lines = text_path.read_text(encoding="utf-8", errors="replace").split("\n")

    seen: dict[str, tuple[int, str]] = {}
    for i, line in enumerate(lines, start=1):
        if TOC_LEADER.search(line):
            continue
        m = HEADING.match(line)
        if not m:
            continue
        sec, num, title = m.group(1), m.group(2), m.group(3).strip()
        gid = f"{sec}-{num}"
        title = re.sub(r"\s{2,}", " ", title)
        # Skip identifiers whose title collapsed to junk.
        if len(title) < 4 or not re.search(r"[a-z]{3}", title):
            continue
        if gid not in seen:
            seen[gid] = (i, title)

    out_path = Path(args.out)
    if not out_path.is_absolute():
        out_path = HERE.parent / out_path
    out_path.parent.mkdir(parents=True, exist_ok=True)

    def sort_key(item: tuple[str, tuple[int, str]]):
        gid = item[0]
        sec, num = gid.split("-")
        return ([int(p) for p in sec.split(".")], int(num))

    with out_path.open("w", encoding="utf-8", newline="\n") as fh:
        fh.write("# line\tguideline_id\ttitle\n")
        fh.write("# 'line' is 1-based in the extracted .txt (LF/CRLF counted only).\n")
        for gid, (line_no, title) in sorted(seen.items(), key=sort_key):
            fh.write(f"{line_no}\t{gid}\t{title}\n")

    print(f"{out_path.name}: {len(seen)} guideline headings indexed from {text_path.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
