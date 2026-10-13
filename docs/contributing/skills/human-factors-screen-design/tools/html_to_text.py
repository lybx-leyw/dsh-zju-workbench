#!/usr/bin/env python3
"""Convert a saved HTML document into readable plain text (stdlib only).

Used for the WCAG 2.2 source, which is HTML rather than PDF. Keeps heading
structure as markdown-ish markers so downstream mining can cite sections.

Usage:
    python html_to_text.py <input.html> <output.txt>
"""
from __future__ import annotations

import sys
from html.parser import HTMLParser
from pathlib import Path

# Elements whose text we never want in the extraction.
SKIP = {"script", "style", "nav", "head", "noscript"}
# Elements that imply a line break before their content.
BLOCK = {
    "p", "div", "section", "article", "li", "tr", "br", "h1", "h2", "h3",
    "h4", "h5", "h6", "dt", "dd", "table", "ul", "ol", "pre", "blockquote",
    "figcaption", "caption",
}


class Textify(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.out: list[str] = []
        self.skip_depth = 0
        self.heading: str | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in SKIP:
            self.skip_depth += 1
            return
        if tag in BLOCK and self.out and not self.out[-1].endswith("\n"):
            self.out.append("\n")
        if tag in {"h1", "h2", "h3", "h4", "h5", "h6"}:
            self.heading = tag
            self.out.append("\n" + "#" * int(tag[1]) + " ")

    def handle_endtag(self, tag: str) -> None:
        if tag in SKIP:
            self.skip_depth = max(0, self.skip_depth - 1)
            return
        if tag in BLOCK:
            self.out.append("\n")
        if tag == self.heading:
            self.heading = None

    def handle_data(self, data: str) -> None:
        if self.skip_depth:
            return
        text = " ".join(data.split())
        if text:
            self.out.append(text + " ")


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    src, dst = Path(sys.argv[1]), Path(sys.argv[2])
    parser = Textify()
    parser.feed(src.read_text(encoding="utf-8", errors="replace"))

    # Collapse runs of blank lines.
    lines: list[str] = []
    for raw in "".join(parser.out).splitlines():
        line = raw.rstrip()
        if line or (lines and lines[-1]):
            lines.append(line)
    dst.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"{src.name} -> {dst.name}  {len(lines)} lines")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
