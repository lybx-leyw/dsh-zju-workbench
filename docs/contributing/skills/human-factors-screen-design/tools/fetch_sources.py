#!/usr/bin/env python3
"""Manifest-driven downloader for public-domain human factors sources.

Why this exists: on this Windows host, git/curl's `schannel` TLS backend fails with
SEC_E_NO_CREDENTIALS, so HTTPS downloads must go through Python's OpenSSL stack.
This script is deliberately dependency-free (stdlib only).

Usage:
    python fetch_sources.py                 # fetch everything missing
    python fetch_sources.py --force         # re-fetch everything
    python fetch_sources.py --only NASA-HIDH-Rev1.pdf
    python fetch_sources.py --list          # show manifest + on-disk status
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import ssl
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCES = ROOT / "sources"
MANIFEST = Path(__file__).resolve().parent / "sources.manifest.json"

# Streaming chunk size for progress reporting.
CHUNK = 1 << 20

# Several .gov hosts (rosap.ntl.bts.gov, nrc.gov) return 403 to a bare "Mozilla/5.0".
# A complete desktop browser Accept header is required. Verified 2026-01: the full
# set below turns 403 into 200 on all three of those hosts.
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
BASE_HEADERS = {
    "User-Agent": UA,
    "Accept": "application/pdf,text/html,application/xhtml+xml,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}


def human(n: int | None) -> str:
    if not n:
        return "?"
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:.1f}{unit}"
        n /= 1024.0
    return f"{n:.1f}TB"


def load_manifest() -> list[dict]:
    with MANIFEST.open(encoding="utf-8") as fh:
        return json.load(fh)["sources"]


def fetch(entry: dict, force: bool = False) -> bool:
    dest = SOURCES / entry["file"]
    if dest.exists() and not force:
        print(f"  [skip] {entry['file']} already present ({human(dest.stat().st_size)})")
        return True

    print(f"  [get ] {entry['file']}")
    print(f"         {entry['url']}")
    req = urllib.request.Request(entry["url"], headers=BASE_HEADERS)
    ctx = ssl.create_default_context()
    tmp = dest.with_suffix(dest.suffix + ".part")
    try:
        with urllib.request.urlopen(req, timeout=180, context=ctx) as resp:
            total = resp.headers.get("Content-Length")
            total = int(total) if total and total.isdigit() else None
            written = 0
            digest = hashlib.sha256()
            with tmp.open("wb") as out:
                while True:
                    block = resp.read(CHUNK)
                    if not block:
                        break
                    out.write(block)
                    digest.update(block)
                    written += len(block)
                    if total:
                        pct = 100.0 * written / total
                        print(
                            f"\r         {pct:5.1f}%  {human(written)} / {human(total)}",
                            end="",
                            flush=True,
                        )
                    else:
                        print(f"\r         {human(written)}", end="", flush=True)
        print()
        # Reject an HTML error page masquerading as a 200.
        kind = entry.get("kind", "pdf")
        with tmp.open("rb") as fh:
            head = fh.read(512).lstrip()
        if kind == "pdf" and head[:4] != b"%PDF":
            tmp.unlink(missing_ok=True)
            print(f"  [FAIL] {entry['file']}: not a PDF (head={head[:16]!r})")
            return False
        if kind == "html" and not head[:1] in (b"<", b"{"):
            tmp.unlink(missing_ok=True)
            print(f"  [FAIL] {entry['file']}: not HTML/JSON (head={head[:16]!r})")
            return False
        tmp.replace(dest)
        print(f"  [ ok ] {entry['file']}  {human(dest.stat().st_size)}  sha256={digest.hexdigest()[:16]}…")
        return True
    except (urllib.error.URLError, OSError, TimeoutError) as exc:
        tmp.unlink(missing_ok=True)
        print(f"  [FAIL] {entry['file']}: {type(exc).__name__}: {exc}")
        return False


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--force", action="store_true", help="re-download even if present")
    ap.add_argument("--only", action="append", default=[], help="fetch only these manifest file names")
    ap.add_argument("--list", action="store_true", help="list manifest without downloading")
    args = ap.parse_args()

    SOURCES.mkdir(parents=True, exist_ok=True)
    entries = load_manifest()
    if args.only:
        entries = [e for e in entries if e["file"] in set(args.only)]
        if not entries:
            print("no manifest entry matched --only", file=sys.stderr)
            return 2

    if args.list:
        for e in entries:
            dest = SOURCES / e["file"]
            mark = "present" if dest.exists() else "missing"
            size = human(dest.stat().st_size) if dest.exists() else "-"
            print(f"{mark:8} {size:>9}  {e['file']}")
            print(f"         {e['title']}")
        return 0

    print(f"[fetch_sources] {len(entries)} entry(ies) -> {SOURCES}")
    ok = sum(fetch(e, force=args.force) for e in entries)
    print(f"[fetch_sources] {ok}/{len(entries)} available")
    return 0 if ok == len(entries) else 1


if __name__ == "__main__":
    raise SystemExit(main())
