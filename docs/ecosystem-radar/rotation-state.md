# 轮换状态

**这份文件是轮换的单一真源。** 任务开跑前先读它选组，跑完写回它。

## 为什么需要它

原轮换公式是 `day_of_year % 3` —— **只按日期取组，不记录「今天已经跑过哪组」**。
同一天只要多跑一次，就必然重复跑同一组。2026-10-14 当天跑了三轮，
第二、三轮的 5 个关键词与彼此**逐字相同**，第三轮几乎全是重复劳动。

因此改成本文件记状态：**同一天不重复取组**，要跑第二组就顺延到当天**尚未跑过的组**。

## 状态字段

| 字段 | 含义 |
| --- | --- |
| `last_group` | 最近一次跑的组（`A` / `B` / `C`） |
| `last_run_at` | 最近一次跑的时间（`YYYY-MM-DD HH:MM`，UTC+8） |
| `group_runs` | 各组历史累计运行次数，用于按「跑得最少」优先排序 |
| `runs` | 逐轮流水（倒序），便于回溯 |

## 取组规则

按顺序判断，命中即停：

1. **跨天重置**：若 `last_run_at` 的日期 ≠ 今天 → 取 `(day_of_year % 3)` 对应的组
   （组序 `0→A`、`1→B`、`2→C`），即原来的公式。同时把 `group_runs` 视为「今天清零」。
2. **同日续跑**：若 `last_run_at` 是今天 → 取**今天尚未跑过**的组里累计次数最少的一个；
   若三组今天都跑过了，取**今天最少跑过**的组（并提示不建议再跑）。
3. **状态缺失或不可解析** → 回落到规则 1（公式取组），并在报告里标注「状态文件不可用」。

> 规则 1 保证跨天行为与原公式**完全一致**（不改变既有节奏）；
> 规则 2 才修复同日重复。两者结合：**跨天照旧轮转，同日绝不重跑**。

## 手动操作

```bash
# 看状态 + 今天该跑哪组（只读，不改）
node scripts/radar-rotation.mjs

# 跑完写回（任务收尾时调用）
node scripts/radar-rotation.mjs --commit B --at "2026-10-15 09:30"

# 只取组名，便于脚本里用
node scripts/radar-rotation.mjs --group
```

---

## 状态

| 项 | 值 |
| --- | --- |
| `last_group` | `A` |
| `last_run_at` | `2026-10-18 09:20` |
| `group_runs`（累计） | A=15, B=9, C=9 |

### 流水

| 时间 | 组 | 说明 |
| --- | --- | --- |
| 2026-10-14 首轮 | A | DSH 插件生态；11 个 A 类候选；出骨架 `dsh-radar-dsh-market`（占位） |
| 2026-10-14 第二轮 | C | 与第三轮**关键词逐字相同**；出骨架 `dsh-radar-fsrs-scheduler` |
| 2026-10-14 第三轮 | C | **重复轮次**（公式缺陷所致）；增量 4 条 🔵；出骨架 `dsh-radar-market` |
| 2026-10-14 16:18 | B | zju / cc98 / campus app（B组浙大场景；36条新增；无骨架） |
| 2026-10-15 00:18 | B | **（回填补记）** zju / cc98 / campus app；36条新增；无骨架。此前未入流水，见下方漂移说明 |
| 2026-10-15 03:04 | A | deepseek-harness plugin / cordis plugin / dsh plugin / dsh market / dsh desktop（A组·DSH插件生态；出骨架 `dsh-radar-dsh-web`） |
| 2026-10-15 06:02 | C | timetable ics export / paper annotation reader / ocr notes taking / quiz practice / fitness tracker / spaced repetition flashcard / html to markdown converter / pdf to markdown（C组·学生功能域；22条登记；无新增 🟢，不出骨架） |
| 2026-10-15 09:06 | A | 增量角度：theme / calendar / translate / markdown / export / search / course / flashcard / cordis plugin ui（63条；出骨架 `dsh-radar-better-markdown`） |
| 2026-10-15 12:00 | A | **能力域细分**：`dsh plugin rag/ocr/graph/pdf/speech/workflow`、`cordis plugin service`、`dsh plugin knowledge/citation/notes editor`（全新能力域切片；79条新增；出骨架 `dsh-radar-deep-read`） |
| 2026-10-15 14:59 | A | **管理/治理面**切片：`dsh plugin mcp/browser/image/classroom/exam/writing/chart/dashboard/ai tutor`（52条新增；出骨架 `dsh-radar-context-dashboard`）。脚本判 `same-day(exhausted)`（三组今天已跑完），本轮**不重复任何组的关键词**、改跑正交新切片 |
| 2026-10-15 18:05 | A | **插件开发/调试工具链 + Agent 编排**切片（当日第七轮；脚本判 same-day(exhausted)，不重复已跑关键词）：dsh plugin sdk / dsh skill marketplace / deepseek-harness agent orchestration / dsh plugin developer toolchain / dsh plugin debugging（77条新增；出骨架 dsh-radar-context-lens） |
| 2026-10-15 21:05 | A | dsh plugin mobile app / desktop app / health check / system monitor / notification push / performance benchmark / error tracking / log analyzer / cost usage / permission audit（第8轮·宿主外壳/运维/审计切片） |
| 2026-10-16 00:00 | B | **跨天重置**（`289 % 3 = 1` → B）。**细分场景轴**：`zju tool`/`courses`/`webvpn`/`calendar`/`grade`/`learning`/`exam`/`zhiyun`/`cloud classroom` + `cc98 client`/`zju skill`（10 次搜索；新增 24 条；🟢1 + 🟡4 + ⚠1；出骨架 `dsh-radar-career-calendar`） |
| 2026-10-16 00:00 | B | 自动记录 |
| 2026-10-16 03:10 | C | 自动记录 |
| 2026-10-16 06:15 | A | **同日第三轮**（规则 2：今日已跑 B 00:00 / C 03:10 → 取未跑过的 A）。**学习科学切片**：`dsh plugin spaced repetition`/`knowledge graph`/`socratic`/`curiosity`/`mastery learning` + 5 个返 0 词（13 次搜索 ⚠ 超限 3 次）。新增 8 条；🟢1（由 10-15 的 🔵 深化）+🟡2+🔵3+⚠1+⛔1；出骨架 `dsh-radar-lookatstudy` |
| 2026-10-16 09:01 | B | **同日第四轮**（规则 2：今日已跑 B 00:00 / C 03:10 / A 06:15 → 脚本判 `same-day(exhausted)`）。按 10-15 先例**不重复任何已跑关键词**，改跑**正交新轴：校园基础设施 / 系统能力轴**（`zju login`/`zju auth`/`zju vpn`/`zju captcha`/`zju library`/`zju jwb` 等；20 次搜索 ⚠ 超限一倍，为一次性验证该轴是否枯竭）。新增 **20 条**；🟢1 + 🟡2 + 🔵9 + ⛔11（**0 条 NOASSERTION**）；出骨架 `dsh-radar-panda-calendar`。**该轴一次即扫尽**（`zju seat booking`/`zju notice announcement`/`zju scholarship`/`zju freshman guide`/`zju graduation credit audit`/`zju graduate student tool` 六词全返 0） |
| 2026-10-16 04:12 | B | 学科资产/课程内容轴：zju physics/math/lab report/software engineering/campus map + user:ZJU-Turing/org:zju-isee + topic:zju(+lang:js/ts)；30词；第30次触发API 403限额，本轮不完整；145条新增；🟢1+🟡1+🔵22+⚠3+⛔118；出骨架 dsh-radar-zju-recorder |
| 2026-10-16 15:05 | B | 自动记录 |
| 2026-10-16 21:10 | A | 第八轮·A组跨harness互操作/插件市场与治理轴（hub: cross-harness / plugin marketplace / plugin score / security audit） |
| 2026-10-17 06:10 | B | B组新增轴(考研/保研)+A组治理轴深挖(承接第八轮延伸词清单) |
| 2026-10-17 09:06 | C | C组第十一轮·复习调度/FSRS优化器轴(10全新词；有效候选10条；🟡1+🔵3+⛔6；无新🟢不出骨架；发现reviewQueue为只读投影、本仓无调度写入方) |
| 2026-10-17 12:05 | A | A组 sort=updated 新仓视图：deepseek-harness-plugin/cordis-plugin/dsh-plugin/dsh-ecosystem/dsh-theme/topic 视图/双词限定(11次，超限1)；17条新增(🟢1+🔵13+⚠1+⛔2簇)；骨架 dsh-radar-knowledge-graph |
| 2026-10-17 21:00 | A（第十五轮） | **同日第六轮**（脚本判 `same-day(exhausted)`；今日已跑 B 06:10 / C 09:06 / A 12:05 / C 15:20 / A 18:00）。不重复已跑关键词，改跑正交新切片：**导出与工作流 / MCP 治理 / 上下文工程**（`dsh plugin workflow automation`/`dsh plugin export pdf`/`deepseek harness plugin tool`/`cordis plugin`/`dsh plugin model provider`/`dsh plugin spaced schedule`/`dsh plugin unit test`/`dsh plugin i18n localization`，8 次搜索未超限、0 次 403）。35 条新仓 → 有效 13 条；**0 🟢 + 2 🟡 + 10 🔵 + 3 ⚠ + 22 ⛔**；**无骨架、本轮暂不开新 PR**。新结论：① `dsh plugin <能力词>` 逐条命中率高（total 4/8 两词全中），抽象技术词（unit test / spaced schedule）语义漂移报废；② 导出轴已被「零依赖 + `window.print()`」范式杀穿，无护城河；③ **首次出现能换底层实现的候选** `dsh-paddle-ocr`（版面块解析），但绑定云端 token，与本仓「无独立 API key」原则正面冲突 → 人工裁决；④ 同日第 6 轮仍出 2 🟡，说明枯竭的是「按日期取组」调度而非 A 组本身 |
| 2026-10-17 18:00 | A | 音乐/乐理/谱面正交轴（第十四轮）：opensheetmusicdisplay 等 10 词，1🟢3🟡4🔵4⚠；骨架 dsh-radar-score-practice |
| 2026-10-18 00:00 | A | A组第十九轮：topic:deepseek-harness-plugin 全量视图 + 存量再评级；11次搜索(超限1)；18条有效候选 🟢1(会话笔记)🟡2(kline/thoughtdag)⚠2⛔11；骨架 dsh-radar-session-notebook |
| 2026-10-18 03:05 | B | B组第二十轮：CC98 轴（zju / zju courses / cc98 / campus app / zju tool，5次搜索）；85条新仓→13条有效；🟢1(CC98-CLI)+🟡1(cc98-mcp)+🔵4+⚠1+⛔6；骨架 dsh-radar-cc98-sdk（骨架内自述可能应判⛔） |
| 2026-10-18 06:00 | C | C组第二十一轮·技术基座轴(latex to mathml/bibtex parser/citation-js/transcript summarizer)；10次搜索；76条新仓→19有效；🟢1+🟡1🔵6⚠2⛔9；骨架 dsh-radar-temml |
| 2026-10-18 09:20 | A | topic 分页 page2 (stars:>0) / topic created:>2026-10-12 / dsh plugin graph |
| 2026-10-17 15:20 | C（第十三轮） | **同日第四轮**（脚本判 `same-day(exhausted)`；今日已跑 B 06:10 / C 09:06 / A 12:05）。按先例**不重复任何已跑关键词**，改跑正交新切片：时间管理/专注计时/任务分解/卡片生成（`time blocking calendar typescript`/`pomodoro timer react focus`/`task breakdown study planner javascript`/`cloze deletion flashcard generator typescript`/`study timer analytics dashboard javascript` 等 13 次搜索，⚠超限 3 次；0 次 403）。87 条全部首次登记 → **有效 4 条；0 🟢 + 0 🟡 + 4 🔵 + 2 ⚠ + 81 ⛔**；**无骨架、不开 PR**。新结论：① 宽词 `study planner`(624)/`study timer`(6284)/`study analytics`(14830) 彻底饱和（合计 2.2 万条仅 1 条入候选且非 JS）→ 建议移除；② 三段式窄词 `task breakdown`/`cloze deletion`/`flashcard generation llm` 全返 0 → 两子轴封板；③ C 组「高价值 ∩ JS 栈」交集趋近空集，建议调轮换比 A:C:B=2:1:1（待人工裁决） |
| 2026-10-17 00:01 | C（第九轮） | **跨天首轮**（`290 % 3 = 2` → C，与公式一致）。**学生功能域**：`timetable ics export`/`paper annotation reader`/`ocr notes taking`/`quiz practice app`/`fitness tracker javascript`/`spaced repetition flashcard typescript`/`FSRS scheduler rust wasm`/`pdf markdown converter javascript`（10 次搜索，达上限未超限；API 全程 200）。新增 29 条登记（有效候选 12 条）；**🟢1 + 🟡4 + 🔵8 + ⛔16（0 条 NOASSERTION）**；出骨架 `dsh-radar-fsrs-browser`（B 类锁版 `fsrs-browser@6.6.0`）。**新结论**：① C 组「课表导出/论文批注」两轴接近枯竭（单校工具 + 1★ 论文阅读器）；② 宽词 `quiz practice app`(2711)/`fitness tracker js`(1069) 已饱和、去重后 0 条入候选；③ 窄技术词 `FSRS scheduler rust wasm`(total 2) 一轮即中本轮唯一 🟢 |
| 2026-10-16 18:35 | B（跨校同型轴） | `course review rating platform` 等 10 词（11 次调用，⚠超限 1 次）；抓取 60 条量级 → **新候选仅 1 条**；🟡0 🟢0 🔵1 ⛔9；**无骨架、不开 PR**。⚠ 开场 `ls-remote` 静默失败被误读为「分支不存在」，push 被拒后 reset 到 `origin/radar`（`c87c23a`）重做 —— **与 10-15 第二轮同型坑，建议修脚本**。**新结论：跨校同型轴同样薄** |

> **⚠ 漂移已回填（2026-10-15 12:00 本轮处理）**：此前 B 组于当日 00:18 实跑
> （见 `registry.md`「2026-10-15 · B 组」36 条），但**未写入流水**，
> 导致脚本按规则 2 判断时误以为「今天只跑过 A/C」而建议再跑 **B**（`same-day(unused)`）。
> 本轮开跑时正是遇到这一误判 —— 经 `git log` 实证当日已有四轮
> （B 00:18 / A 03:04 / C 06:02 / A 09:06，且已通过 PR #13 合入 `main`），
> **未采纳脚本建议**，改跑**全新能力域切片**，并把 B 组那轮**回填入上表**。
>
> **但根本修复仍未落地**（需人工确认后改代码）：
> ① 流水目前靠收尾人工回填，**漏记无人发现**；建议改为「跑完即写」的强制步骤。
> ② `scripts/radar-rotation.mjs` 用 `new Date()`（**UTC**）取「今天」，
>    在北京 00:00–08:00 区间会把「今天」算成前一天；建议改为 Asia/Shanghai。
> 本轮以 `--today 2026-10-15` 规避。

> **⚠ 漂移说明（2026-10-15 第三轮发现）**：当日 **B 组实际于 00:1x 跑过**
> （见 `registry.md` 的「2026-10-15 · B 组」章节，36 条候选），但**未写入本流水**。
> 因此本轮（06:00）按规则 2 判断时，脚本误以为「今天只跑过 A」而建议再跑 B ——
> 那将违反「同日绝不重跑」。本轮**人工改跑 C 组**（今日真正未跑过的组）。
> 另：`scripts/radar-rotation.mjs` 用 `new Date()`（UTC）取「今天」，在北京 00:00–08:00
> 区间会把「今天」算成前一天，本轮以 `--today 2026-10-15` 规避。两处均建议修复。

> **回填说明**：以上三轮发生在状态文件建立**之前**，按当日报告与 `registry.md` 的实际记录回填。
> 因无法精确还原首轮/第二轮的分钟级时间，仅 `last_run_at` 记第三轮的 23:01。B 组至今未跑
> （`group_runs.B = 0`），故 **2026-10-15 按规则 1 取 B 组**（`288 % 3 = 0` → 也正好是 B，
> 与公式一致，这个巧合不是必然）。
