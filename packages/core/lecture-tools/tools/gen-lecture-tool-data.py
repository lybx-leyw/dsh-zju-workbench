"""从 vendor 里抽出出题链工具的权威数据（schema / 提示词 hint / 清单渲染文案）。

为什么用脚本抽而不是手抄：任务书要求「工具 description 与 parameters 逐字搬」。
手抄一次 4000+ 字符的英文描述，出错概率不低，而错一个字就可能改变模型的调用行为。
脚本化之后，重新生成 = 重新对齐 vendor，任何人可复核。

产出：src/data/upstream.json（相对包根）
用法（仓库根）：
    PYTHONPATH=packages/dsh-zhiyun-host-deeptutor/vendor/deeptutor \
      python tools/gen-lecture-tool-data.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = PACKAGE_ROOT.parent.parent
sys.path.insert(0, str(REPO_ROOT / "packages/dsh-zhiyun-host-deeptutor/vendor/deeptutor"))

from deeptutor.knowledge import manifest as kb_manifest  # noqa: E402
from deeptutor.tools.builtin import (  # noqa: E402
    KbFilesTool,
    QuestionBankTool,
    RAGTool,
    ReadSourceTool,
)
from deeptutor.tools import question_bank as qb  # noqa: E402
from deeptutor.tools.prompting import load_prompt_hints  # noqa: E402

TOOL_CLASSES = (RAGTool, KbFilesTool, ReadSourceTool, QuestionBankTool)
HINT_FIELDS = ("short_description", "when_to_use", "input_format", "guideline", "note", "phase")

schemas: dict[str, dict] = {}
for cls in TOOL_CLASSES:
    definition = cls().get_definition()
    # to_openai_schema() 是「模型真正看到的那一份」：RAGTool 覆写了 raw_parameters
    # （presentation 追加 null），别的工具走 parameters → properties/required。
    schemas[definition.name] = definition.to_openai_schema()

hints: dict[str, dict[str, dict[str, str]]] = {}
for name in schemas:
    hints[name] = {}
    for language in ("en", "zh"):
        hint = load_prompt_hints(name, language)
        hints[name][language] = {field: getattr(hint, field) for field in HINT_FIELDS}

payload = {
    "_source": "packages/dsh-zhiyun-host-deeptutor/vendor/deeptutor/deeptutor/tools/builtin/__init__.py"
    " + tools/prompting/hints/{en,zh}/*.yaml",
    "_regenerate": "python tools/gen-lecture-tool-data.py",
    "schemas": schemas,
    "hints": hints,
    # kb_files 的清单渲染文案（en/zh）。工具输出要给模型看，所以照原样搬。
    "manifestText": {
        "report": kb_manifest._REPORT_TEXT,
        "note": kb_manifest._NOTE_TEXT,
        "statusLabels": kb_manifest._STATUS_LABELS,
        "unavailableLabels": kb_manifest._UNAVAILABLE_LABELS,
        "limits": {
            "default": kb_manifest.KB_FILES_DEFAULT_LIMIT,
            "max": kb_manifest.KB_FILES_MAX_LIMIT,
            "note": kb_manifest.MANIFEST_NOTE_LIMIT,
        },
        "unavailableCodes": {
            "remote": kb_manifest.UNAVAILABLE_REMOTE,
            "agent": kb_manifest.UNAVAILABLE_AGENT,
            "missing": kb_manifest.UNAVAILABLE_MISSING,
        },
    },
    # question_bank 的动作/过滤闭集与上限，同样来自真源而不是抄注释。
    "questionBank": {
        "actions": list(qb.ACTIONS),
        "filters": list(qb.FILTERS),
        "limits": {
            "defaultList": qb.DEFAULT_LIST_LIMIT,
            "maxList": qb.MAX_LIST_LIMIT,
            "maxEntryIds": qb.MAX_ENTRY_IDS,
            "maxQuestionPreview": qb.MAX_QUESTION_PREVIEW,
            "maxAnswerPreview": qb.MAX_ANSWER_PREVIEW,
            "maxCategoryName": qb.MAX_CATEGORY_NAME,
            "maxRecordQuestion": qb.MAX_RECORD_QUESTION,
            "maxRecordField": qb.MAX_RECORD_FIELD,
        },
    },
}

target = PACKAGE_ROOT / "src/data/upstream.json"
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"wrote {target} ({target.stat().st_size} bytes)")
print("tools:", ", ".join(schemas))
