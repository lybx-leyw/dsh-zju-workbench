"""补一份 rag 选择器校验 + 名字过滤的基线（上游纯函数，不需外部服务）。

用法（**包根**）：python tools/gen-lecture-rag-baseline.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = PACKAGE_ROOT.parent.parent
sys.path.insert(0, str(REPO_ROOT / "packages/dsh-zhiyun-host-deeptutor/vendor/deeptutor"))

from deeptutor.knowledge.manifest import _filter_names  # noqa: E402
from deeptutor.tools.builtin import _normalize_rag_selectors, _kb_files_limit  # noqa: E402

SELECTOR_CASES = {
    "clean": {"query": "x", "kb_name": "kb"},
    "page_ok": {"page": 3},
    "page_bool": {"page": True},
    "page_zero": {"page": 0},
    "page_float": {"page": 2.5},
    "page_negative": {"page": -1},
    "region_empty": {"region": []},
    "region_ok": {"region": [0, 0, 1, 1]},
    "region_bad_len": {"region": [0, 0, 1]},
    "region_out_of_range": {"region": [0, 0, 1, 1.5]},
    "region_bool": {"region": [0, 0, 1, True]},
    "region_string": {"region": ["0", "0", "1", "1"]},
}

LIMIT_CASES = {
    "default_missing": {},
    "default_zero": {"limit": 0},
    "default_negative": {"limit": -3},
    "default_garbage": {"limit": "many"},
    "clamp": {"limit": 5000},
    "passthrough": {"limit": 7},
    "string_number": {"limit": "42"},
}

NAMES = [
    "第一章 力学/牛顿第二定律",
    "第一章 力学/动量守恒",
    "第二章 电磁学/库仑定律",
    "README.pdf",
    "notes/MixedCase.PDF",
    "a/b/c.txt",
]
PATTERNS = ["", "力学", "*.pdf", "*.PDF", "库仑*", "?", "notes/*", "*/*.pdf", "nomatch", "[ab]*"]

out = {
    "selectors": {
        label: (value if isinstance(value, str) else {k: v for k, v in value.items()})
        for label, kwargs in SELECTOR_CASES.items()
        for value in [_normalize_rag_selectors(dict(kwargs))]
    },
    "limits": {label: _kb_files_limit(kwargs.get("limit")) for label, kwargs in LIMIT_CASES.items()},
    "filters": {pattern: _filter_names(NAMES, pattern) for pattern in PATTERNS},
}
target = PACKAGE_ROOT / "tests/fixtures/lecture-rag-baseline.json"
target.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"wrote {target}")
