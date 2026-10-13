#!/usr/bin/env python3
"""Run book-to-skill's extractor, working around two environment blockers.

**PREREQUISITE — this is the one tool here that is not self-contained.** It imports the
upstream `book-to-skill` package and looks for a checkout at `book-to-skill/` **inside this
skill folder** (`<skill>/book-to-skill`), or wherever `BOOK_TO_SKILL_ROOT` points. That
checkout is deliberately **not** vendored in this repository: it is a third-party project
(MIT, <https://github.com/virgiliojr94/book-to-skill>) with its own release cycle, and pinning
a copy here would silently rot. Clone it yourself before using this tool:

    git clone https://github.com/virgiliojr94/book-to-skill.git \
        docs/contributing/skills/human-factors-screen-design/book-to-skill

or clone it elsewhere and set `BOOK_TO_SKILL_ROOT` to that path. Note that a checkout left
inside this skill folder will show up in `git status`; either gitignore it or keep it outside.

Everything else in `tools/` — `fetch_sources.py`, `write_provenance.py`,
`verify_numbers.py`, `build_guideline_index.py`, `html_to_text.py` — is standalone stdlib
Python 3 and runs with no extra checkout.

This wrapper does NOT modify the upstream `book-to-skill` checkout. It imports it
and patches the two behaviours that fail in this environment, then delegates.

BLOCKER 1 — TLS backend.
    git and curl here default to the Windows `schannel` TLS backend, which fails
    with `schannel: AcquireCredentialsHandle failed: SEC_E_NO_CREDENTIALS`.
    Not relevant to extraction itself, but it is why the sources were fetched with
    `tools/fetch_sources.py` (Python/OpenSSL) instead of `git`/`curl`.

BLOCKER 2 — the extractor creates its work directory 0700.
    `book_to_skill.utils.prepare_output_dir()` does:
        - for an existing path:  os.chmod(path, 0o700)
        - for a new path:        path.mkdir(parents=True, mode=0o700)
    Under this host's file sandbox both are denied: writing INTO a 0700 directory
    is refused (`PermissionError: [Errno 13] ... full_text.txt`) and `os.chmod` on
    such a path raises `WinError 5`. Measured directly in the workspace:
        0o777 -> write OK        0o755 -> write OK        0o700 -> PermissionError
        os.chmod(dir, 0o755)                              -> PermissionError
    Fix: replace `prepare_output_dir` with an equivalent that creates the directory
    with normal (non-0700) permissions and performs no chmod. The upstream
    ownership guard is preserved.

    `BOOK_SKILL_WORKDIR` is also set to a workspace path, because the default temp
    root is outside the sandbox's writable area.

The upstream checkout is left untouched: patching happens in memory, at import time.

Usage (mirrors the upstream CLI):
    python run_extract.py <path> [--mode technical|text] [--install-missing ask|yes|no]
    python run_extract.py --check
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

# Upstream guards against writing .pyc beside its sources, but only under
# `if __name__ == "__main__"`, which is true when extract.py is run directly and
# false when this shim imports the package. Without this, importing book_to_skill
# leaves __pycache__/*.pyc inside a checkout that is meant to stay pristine.
# Must be set BEFORE the book_to_skill imports below.
sys.dont_write_bytecode = True

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
# Default: a `book-to-skill/` directory beside this skill folder. Override with
# BOOK_TO_SKILL_ROOT to point at a checkout anywhere else, so the third-party clone
# does not have to live inside the skill directory.
UPSTREAM = Path(os.environ.get("BOOK_TO_SKILL_ROOT") or (ROOT / "book-to-skill"))
WORKTMP = ROOT / ".worktmp"

if not UPSTREAM.is_dir():
    sys.exit(
        f"upstream 'book-to-skill' checkout not found at {UPSTREAM}\n"
        "Clone it (MIT, https://github.com/virgiliojr94/book-to-skill) or set\n"
        "BOOK_TO_SKILL_ROOT to an existing checkout."
    )

# Keep the extractor's work directory inside the workspace (the sandbox's writable
# area) instead of the platform temp dir, which is outside it.
WORKTMP.mkdir(parents=True, exist_ok=True)
WORKDIR = WORKTMP / f"book_skill_work-{os.getpid()}"
os.environ.setdefault("BOOK_SKILL_WORKDIR", str(WORKDIR))
os.environ["TEMP"] = str(WORKTMP)
os.environ["TMP"] = str(WORKTMP)

sys.path.insert(0, str(UPSTREAM))

from book_to_skill import utils as _utils  # noqa: E402
from book_to_skill.cli import main  # noqa: E402
from book_to_skill.exceptions import ExtractionError  # noqa: E402


def _prepare_output_dir_permissive(path: Path) -> None:
    """Same contract as upstream, minus the 0700 mode the sandbox rejects."""
    if path.exists():
        if not path.is_dir():
            raise ExtractionError(f"Refusing to use {path}: it is not a directory.")
        # Upstream tightens to 0700 here; the sandbox forbids the chmod, and 0700
        # is exactly the mode that blocks the subsequent write on this host.
        if hasattr(os, "getuid"):
            owner_uid = path.stat().st_uid
            if owner_uid != os.getuid():
                raise ExtractionError(
                    f"Refusing to use {path}: it is owned by a different user "
                    f"(uid {owner_uid}). Set BOOK_SKILL_WORKDIR to a private directory."
                )
    else:
        path.mkdir(parents=True, exist_ok=True)


_utils.prepare_output_dir = _prepare_output_dir_permissive


if __name__ == "__main__":
    main()
