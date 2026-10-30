"""用**上游真实现**跑一份固定输入，把结果写成 JSON 基线。

用于和 JS 版逐字比对：工具的 content 是给模型看的文字，差一个空格都会改变
模型对结果的判断。基线覆盖：
  * question_bank 的 overview / list / 各错误分支（假的异步 store，不碰 SQLite）
  * kb_files 的 manifest 报告（各语言 / pattern / omitted / 空 / 不可枚举）
  * read_source 的三种错误语义

用法（**包根**）：
    python tools/gen-lecture-baseline.py
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = PACKAGE_ROOT.parent.parent
sys.path.insert(0, str(REPO_ROOT / "packages/dsh-zhiyun-host-deeptutor/vendor/deeptutor"))

from deeptutor.knowledge.manifest import (  # noqa: E402
    KbDocument,
    KbManifest,
    UNAVAILABLE_MISSING,
    render_manifest_report,
)
from deeptutor.tools.builtin import ReadSourceTool  # noqa: E402
from deeptutor.tools.question_bank import run_question_bank  # noqa: E402

ENTRIES = [
    {
        "id": 1,
        "question": "牛顿第二定律 F=ma 中 a 表示什么？",
        "user_answer": "加速度",
        "correct_answer": "加速度",
        "is_correct": 1,
        "bookmarked": 1,
        "categories": [{"name": "力学基础", "id": 1}],
        "created_at": 1.0,
    },
    {
        "id": 2,
        "question": "动量守恒的成立条件是什么？" + "长" * 200,
        "user_answer": "",
        "correct_answer": "系统所受合外力为零",
        "is_correct": 0,
        "bookmarked": 0,
        "categories": [],
        "created_at": 2.0,
    },
    {
        "id": 3,
        "question": "角动量守恒的判据？",
        "user_answer": "合外力矩为零",
        "correct_answer": "合外力矩为零",
        "is_correct": 1,
        "bookmarked": 0,
        "categories": [{"name": "力学基础", "id": 1}],
        "created_at": 3.0,
    },
]

CATEGORIES = [{"id": 1, "name": "力学基础", "entry_count": 2}]


class FakeStore:
    """上游 run_question_bank() 只用到这几个方法。"""

    async def question_bank_stats(self):
        return {
            "total": len(ENTRIES),
            "wrong": sum(1 for entry in ENTRIES if not entry["is_correct"]),
            "unresolved": sum(1 for entry in ENTRIES if not entry["is_correct"]),
            "bookmarked": sum(1 for entry in ENTRIES if entry["bookmarked"]),
            "uncategorized": sum(1 for entry in ENTRIES if not entry["categories"]),
        }

    async def list_categories(self):
        return list(CATEGORIES)

    async def find_category_by_name(self, name):
        for category in CATEGORIES:
            if category["name"].lower() == str(name).strip().lower():
                return category
        return None

    async def list_notebook_entries(self, **kwargs):
        rows = list(ENTRIES)
        if kwargs.get("uncategorized"):
            rows = [row for row in rows if not row["categories"]]
        if kwargs.get("bookmarked") is True:
            rows = [row for row in rows if row["bookmarked"]]
        if kwargs.get("is_correct") is False:
            rows = [row for row in rows if not row["is_correct"]]
        if kwargs.get("category_id") is not None:
            rows = [
                row
                for row in rows
                if any(c["id"] == kwargs["category_id"] for c in row["categories"])
            ]
        search = str(kwargs.get("search") or "").lower()
        if search:
            rows = [
                row
                for row in rows
                if search in row["question"].lower()
                or search in str(row["user_answer"]).lower()
                or search in str(row["correct_answer"]).lower()
            ]
        total = len(rows)
        limit = int(kwargs.get("limit") or 20)
        return {"items": rows[:limit], "total": total}


class EmptyStore(FakeStore):
    async def question_bank_stats(self):
        return {"total": 0, "wrong": 0, "unresolved": 0, "bookmarked": 0, "uncategorized": 0}

    async def list_categories(self):
        return []


async def question_bank_baseline():
    cases = {}
    store = FakeStore()
    empty = EmptyStore()
    for label, kwargs, target in [
        ("overview", {"action": "overview"}, store),
        ("overview_empty", {"action": "overview"}, empty),
        ("list_all", {"action": "list"}, store),
        ("list_wrong", {"action": "list", "filter_mode": "wrong"}, store),
        ("list_uncategorized", {"action": "list", "filter_mode": "uncategorized"}, store),
        ("list_bookmarked", {"action": "list", "filter_mode": "bookmarked"}, store),
        ("list_category", {"action": "list", "category": "力学基础"}, store),
        ("list_search", {"action": "list", "search": "动量"}, store),
        ("list_limit", {"action": "list", "limit": 1}, store),
        ("list_bad_filter", {"action": "list", "filter_mode": "nope"}, store),
        ("list_missing_category", {"action": "list", "category": "不存在"}, store),
        ("bad_action", {"action": "nope"}, store),
    ]:
        result = await run_question_bank(store=target, **kwargs)
        cases[label] = {"ok": result.ok, "text": result.text, "error": result.error}
    return cases


def kb_files_baseline():
    cases = {}
    documents = [
        KbDocument(name="第一章 力学/牛顿第二定律", size=0),
        KbDocument(name="第一章 力学/动量守恒", size=0),
        KbDocument(name="第二章 电磁学/库仑定律", size=1234),
    ]
    base = {"name": "lecture", "provider": "", "status": "", "kb_type": ""}
    for language in ("en", "zh"):
        cases[f"all_{language}"] = render_manifest_report(
            KbManifest(**base, total=3, matched=3, documents=tuple(documents)), language=language
        )
        cases[f"pattern_{language}"] = render_manifest_report(
            KbManifest(
                **base, total=3, matched=1, documents=(documents[2],), pattern="库仑*"
            ),
            language=language,
        )
        cases[f"no_match_{language}"] = render_manifest_report(
            KbManifest(**base, total=3, matched=0, documents=(), pattern="不存在"),
            language=language,
        )
        cases[f"omitted_{language}"] = render_manifest_report(
            KbManifest(**base, total=3, matched=3, documents=(documents[0],)), language=language
        )
        cases[f"empty_{language}"] = render_manifest_report(
            KbManifest(**base, total=0, matched=0, documents=()), language=language
        )
        cases[f"unavailable_{language}"] = render_manifest_report(
            KbManifest(**base, unavailable=UNAVAILABLE_MISSING), language=language
        )
    return cases


def read_source_baseline():
    async def run(kwargs):
        result = await ReadSourceTool().execute(**kwargs)
        return {"success": result.success, "content": result.content}

    single = {"at-1": "只有一份来源的正文"}
    multiple = {"t1-1": "第一份", "t1-2": "第二份"}
    return {
        "single_auto_id": asyncio.run(run({"source_index": single})),
        "multiple_missing_id": asyncio.run(run({"source_index": multiple})),
        "unknown_id": asyncio.run(run({"source_index": multiple, "source_id": "t9-9"})),
        "no_sources": asyncio.run(run({})),
        "hit": asyncio.run(run({"source_index": multiple, "source_id": "t1-2"})),
    }


baseline = {
    "questionBank": asyncio.run(question_bank_baseline()),
    "kbFiles": kb_files_baseline(),
    "readSource": read_source_baseline(),
}
target = PACKAGE_ROOT / "tests/fixtures/lecture-tool-baseline.json"
target.write_text(json.dumps(baseline, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"wrote {target}")
for group, cases in baseline.items():
    print(group, len(cases))
