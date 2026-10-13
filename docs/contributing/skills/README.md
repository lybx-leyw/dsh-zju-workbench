# 共享 skills

本目录存放**共享给全组复用的 Agent Skill**，按 [CONTRIBUTING.md](../CONTRIBUTING.md) 的约定放在 `docs/contributing/` 下。

**这里不是任何 harness 的自动加载目录。** 目录名刻意不叫 `.agents` / `.claude` / `.github/skills`，也不写进任何宿主配置——**由使用者自己决定把哪个 skill 装载到哪个宿主**。这样做的原因见下文。

## 现有 skill

| Skill | 内容 | 规模 |
| --- | --- | --- |
| [human-factors-screen-design](human-factors-screen-design/) | 屏幕内容与界面设计的人体工效学：字号/间距/对比度/配色/目标尺寸/布局密度/响应时延/告警编码，以及**可调参数的默认值设计**。来源为 8 份公有领域标准（FAA、NASA、MIL-STD、NUREG、FHWA、WCAG 2.2） | 10 章 + 速查表，约 7.5 万词 |

## 怎么用

挑一个 skill，把它的目录复制到你所用宿主的 skills 根目录，或者直接当普通 markdown 读：

```bash
# 例：装到跨宿主共享根（Copilot CLI / Amp / Codex / OpenCode 都读这里）
cp -r docs/contributing/skills/human-factors-screen-design ~/.agents/skills/

# 例：装到 Claude Code
cp -r docs/contributing/skills/human-factors-screen-design ~/.claude/skills/
```

装进全局根之前先确认目标位置没有同名目录，避免静默遮蔽（skill 按名字解析，同名会互相盖住）。

## 为什么不做自动加载

- **仓库不替使用者决定宿主。** 同一个 skill 在 Copilot CLI、Claude Code、Codex、OpenCode 下都能跑，装在哪个由使用者定。
- **自动加载目录会与本仓库的公开性质冲突。** `.agents/`、`.claude/` 这类目录一旦进仓库，就等于对所有使用者生效，也会让"仓库里有什么"与"我本机加载了什么"两件事纠缠在一起。
- **显式装载更容易排错。** skill 没生效时，问题范围就是"我有没有复制过去"，而不是"宿主有没有扫到这个路径"。

## 每个 skill 的自包含要求

放进本目录的 skill 必须**自包含**：内部链接只能是相对自身目录的路径，不得指向仓库外、也不得指向被 gitignore 的目录（例如用于产出的临时工作区）。两个理由：

1. 使用者会把**单个 skill 目录**复制走，父目录不会跟着走，指向父目录的链接必然断。
2. 被忽略的目录不会被推送，指向它的链接在远端仓库里是死链。

大体量的原始素材（PDF、提取出的全文、逐源挖掘结果）**不进仓库**，只保留可复现它们的工具与出处记录。人工工效学 skill 里约 160 MB 的原文就是这么处理的：`SOURCES.md` 记录出处、许可与 SHA-256，`tools/fetch_sources.py` 负责重新拉取。

## 加新 skill

1. 在 `human-factors-screen-design/` 旁边新建同名目录，内含 `SKILL.md`（带 YAML front matter 的 `name` + `description`）。
2. 保证自包含，跑一遍断链检查（下节）。
3. 在本文件的表格里加一行。
4. 按 [../AGENTS.md](../AGENTS.md) 的「提交与推送」流程，先经使用者确认再提交。

## 自检

改动本目录后，检查每个 skill 没有链接到自身目录之外：

```bash
# 逐个 skill 检查：找出解析后落在该 skill 目录之外的 markdown 链接
python - <<'PY'
import re
from pathlib import Path

root = Path("docs/contributing/skills")
bad = 0
for skill in sorted(p for p in root.iterdir() if p.is_dir()):
    for f in skill.rglob("*.md"):
        for m in re.finditer(r"\[[^\]]+\]\(([^)#]+)", f.read_text(encoding="utf-8", errors="replace")):
            t = m.group(1).strip()
            if not t or t.startswith(("http", "mailto:")):
                continue
            resolved = (f.parent / t).resolve()
            if not resolved.exists():
                print(f"BROKEN  {f.relative_to(root)} -> {t}")
                bad += 1
            elif not str(resolved).startswith(str(skill.resolve())):
                print(f"ESCAPES {f.relative_to(root)} -> {t}")
                bad += 1
print(f"{bad} problem(s)")
PY
```

要求是 **0 problem(s)**。`ESCAPES` 比 `BROKEN` 更重要：链接能解析、但落在 skill 目录之外的，说明使用者单独复制该 skill 时会断——这正是本目录要求自包含的原因。

用宿主规则校验 `SKILL.md`（可选，需要一份 book-to-skill 检出）：

```bash
python <book-to-skill>/tools/validate_skill.py \
  docs/contributing/skills/human-factors-screen-design/SKILL.md --lens claude
```

## 归属

本目录继承 `docs/contributing/OWNERS` 的声明（本目录内任何人皆可更改；负责人负责事后审查）。新增 skill 若属于特定负责人，在该 skill 目录内单独放一份 `OWNERS` 即可覆盖。
