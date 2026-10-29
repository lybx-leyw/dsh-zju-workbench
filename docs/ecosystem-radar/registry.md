# 生态雷达 · 候选登记表

> **追加式**去重真值。状态取值：`proposed` / `skeleton-created` / `adopted` / `rejected` / `pending-license`。
> 每次扫描只追加**新出现**的仓库；已登记的不再重复。
>
> **`骨架日期`**（本表新增）：该仓库首次出骨架的日期。用于 RADAR.md 的保守废弃原则 ——
> 骨架**默认不删除**，只有能力清单全部 `已提取`/`作废` 或用户明确要求时才删。
> 历史行未填此列属正常（列新增于 2026-10-28），骨架包的实际日期以 `packages/radar/dsh-radar-*/` 的首次提交为准。

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 骨架日期 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `deepseek-ai/deepseek-harness` | A 原生DSH | MIT | 通用 | 宿主基础 | 排除 | rejected | 2026-10-14 | 已是本项目宿主 |
| `awesome-dsh-plugin/awesome-dsh-plugin` | A 原生DSH | CC0-1.0 | 通用 | 全新（线索源） | 🟢 | proposed | 2026-10-14 | 插件精选清单，可扩充关键词池 |
| `zhu1090093659/dsh-web` | A 原生DSH | Apache-2.0 | 通用 | 重复可强化（插件页） | 🟢 | proposed | 2026-10-14 | Web 插件聚合生态 |
| `dsh-market/dsh-market` | A 原生DSH | MIT | 通用 | 重复可强化（插件页） | 🟢 | proposed | 2026-10-14 | DSH 内插件市场 |
| `liustack/modlens` | A 原生DSH | MIT | 论文 | 重复可强化（论文阅读） | 🟡 | proposed | 2026-10-14 | 视觉 / 图文理解 |
| `liustack/modsearch` | A 原生DSH | MIT | 学习 / 问一问 | 重复可强化（问一问） | 🟡 | proposed | 2026-10-14 | 联网检索 |
| `shengsheng90/DSH-taskboard` | A 原生DSH | Apache-2.0 | 学习 / 今天 | 重复可强化（今天） | 🟡 | proposed | 2026-10-14 | 待办任务板 |
| `Ebony-Vinyl/dsh-our-free-model` | A 原生DSH | MIT | 通用 | 全新 | 🔵 | proposed | 2026-10-14 | 免登录模型接入 |
| `cordiverse/cordis` | A 原生DSH | MIT | 通用 | 基础设施 | 🔵 | proposed | 2026-10-14 | 项目已用框架 |
| `ccch1mneyyy/dsh-TUI` | A 原生DSH | MIT | 通用 | 无关 | 🔵 | proposed | 2026-10-14 | TUI 形态 |
| `Devin-AXIS/iPolloWork` | A 原生DSH | NOASSERTION | — | — | ⚠ 待核 | proposed | 2026-10-14 | 许可证待人工核验 |
| `open-spaced-repetition/ts-fsrs` | B 其他JS | MIT | 复习节奏 | 重复可强化（学习页·习题调度） | 🟢 | proposed | 2026-10-14 | 锁版 ts-fsrs 5.4.2，已出骨架 dsh-radar-fsrs-scheduler |
| `agentcooper/react-pdf-highlighter` | B 其他JS | MIT | 论文批注 | 重复可强化（论文阅读页） | 🟡 | proposed | 2026-10-14 | 论文页为 iframe 壳，适配成本中高 |
| `Laomai-codefee/pdfjs-annotation-extension` | B 其他JS | Apache-2.0 | 论文批注 | 重复可强化（论文阅读页） | 🟡 | proposed | 2026-10-14 | 同上，依赖 PDF.js viewer |
| `MuhametSmaili/note-it` | B 其他JS | Apache-2.0 | 笔记 OCR | 重复可强化（笔记） | 🟡 | proposed | 2026-10-14 | 需从浏览器扩展提取 OCR 能力 |
| `Hzy0913/Timetable` | B 其他JS | MIT | 大学课程表 | 重复可强化（我的课/今天） | 🟡 | proposed | 2026-10-14 | 上游 4 年未更新，只借鉴渲染 |
| `Snouzy/workout-cool` | B 其他JS | MIT | 锻炼 | 全新（无锻炼面板） | 🔵 | proposed | 2026-10-14 | 完整独立平台，非强化式集成 |
| `open-spaced-repetition/awesome-fsrs` | B 其他JS | CC0-1.0 | 复习 | 全新（线索源） | 🔵 | proposed | 2026-10-14 | 可扩充关键词池 |
| `open-spaced-repetition/fsrs4anki` | B 其他JS | MIT | 复习 | 仅供参考（算法参考） | 🔵 | proposed | 2026-10-14 | 非 JS，只作调参经验 |
| `RyotaUshio/obsidian-pdf-plus` | B 其他JS | MIT | 论文批注 | 仅供参考 | 🔵 | proposed | 2026-10-14 | 强耦合 Obsidian |
| `LinzuoZhang/Paper-Lantern` | B 其他JS | MIT | 论文精读 | 仅供参考 | 🔵 | proposed | 2026-10-14 | 独立应用形态 |
| `langlibai66/paper-cn-reader` | B 其他JS | MIT | 论文批注 | 仅供参考 | 🔵 | proposed | 2026-10-14 | Agent Skill，非 JS 库 |
| `zhaoliangbin42/AI-MarkDone` | B 其他JS | MIT | 阅读批注 | 仅供参考 | 🔵 | proposed | 2026-10-14 | 浏览器扩展形态 |
| `JustBrandonLim/timetable-grabber-sit` | B 其他JS | MIT | 课表 ICS | 仅供参考 | 🔵 | proposed | 2026-10-14 | 可提取 ICS 生成逻辑 |
| `romankurakin/dkuzeit` | B 其他JS | MIT | 课表 ICS | 仅供参考 | 🔵 | proposed | 2026-10-14 | 体量过小（★4） |
| `marioMLLL/ecnu-timetable-calendar` | B 其他JS | MIT | 高校课表 | 仅供参考 | 🔵 | proposed | 2026-10-14 | 体量过小（★8） |
| `CodeWithCJ/SparkyFitness` | B 其他JS | NOASSERTION | — | — | ⚠ 待核 | proposed | 2026-10-14 | 许可证待人工核验 |
| `ankitects/anki` | B 其他JS | NOASSERTION | — | — | ⚠ 待核 | proposed | 2026-10-14 | 许可证待人工核验 |
| `itskovacs/wingfit` | B 其他JS | NOASSERTION | — | — | ⚠ 待核 | proposed | 2026-10-14 | 许可证待人工核验 |
| `andymatuschak/orbit` | B 其他JS | NOASSERTION | — | — | ⚠ 待核 | proposed | 2026-10-14 | 许可证待人工核验 |
| `NLion74/ics-webuntis` | B 其他JS | NOASSERTION | — | — | ⚠ 待核 | proposed | 2026-10-14 | 许可证待人工核验 |
| `windingwind/zotero-pdf-translate` | B 其他JS | AGPL-3.0 ⛔ | 论文翻译 | — | ⛔ | rejected | 2026-10-14 | ★12051 但 AGPL 红线：只可参考，不摘代码 |
| `DuarteSantos8/openGym` | B 其他JS | AGPL-3.0 ⛔ | 锻炼 | — | ⛔ | rejected | 2026-10-14 | 许可证排除 |
| `wger-project/wger` | B 其他JS | AGPL-3.0 ⛔ | 锻炼 | — | ⛔ | rejected | 2026-10-14 | 许可证排除 |
| `Grible/timetable.js` | B 其他JS | GPL-3.0 ⛔ | 课表 | — | ⛔ | rejected | 2026-10-14 | 许可证排除 |
| `thomaschampagne/elevate` | B 其他JS | MPL-2.0 ⛔ | 锻炼 | — | ⛔ | rejected | 2026-10-14 | 许可证排除 |
| `zeus-12/uxie` | B 其他JS | 无许可证 ⛔ | 阅读笔记 | — | ⛔ | rejected | 2026-10-14 | 无许可证，不摘代码 |
| `qq273681448/TimeTable` | B 其他JS | 无许可证 ⛔ | 课表 | — | ⛔ | rejected | 2026-10-14 | 无许可证，不摘代码 |
| `hellosagar/Quiz-App` 等通用答题 App | B 其他JS | MIT | 刷题 | **重复且无增益** | ⛔ | rejected | 2026-10-14 | 与 dsh-zhiyun-quiz 重合且无更优底层 |
| `DongLanQwQ0/ZJU-Tongge-Schedule` | B 其他JS | MIT | 浙大课表 | 全新 | 🔵 | proposed | 2026-10-14 | ★1。浙大**撞课**工具（`.ics` 上传 + 教室距离），纯前端可移植。**前置**：本仓尚无课表数据层（见 `docs/robot-digest/2026-10-13.md` F-001）。第三轮 C 组 |
| `theycallmedern/ZJU-Schedule-Bot` | B 其他JS | MIT | 浙大课表 | 全新 | 🔵 | proposed | 2026-10-14 | ★0。Telegram 课表提醒（CF Workers + D1），形态与 web 客户端不兼容，仅线索。第三轮 C 组 |
| `MeteorNOX/DeepSeek-Balance-Whale-Widget` | A 原生DSH | MIT | 通用 | 全新 | 🔵 | proposed | 2026-10-14 | ★4793。DSH 余额挂件（鲸鱼娘），形态与本仓面板无关。第三轮 A 组回访 |
| `whiteguo233/OpenBiliClaw` | A 原生DSH | MIT | 内容发现 | 全新 | 🔵 | proposed | 2026-10-14 | ★3435。跨平台内容发现 Agent（B站/小红书等），Python 为主，未评估集成路径。第三轮 A 组回访 |

---

## 2026-10-15 · B 组（浙大场景）· 追加

> 关键词：`zju`、`cc98`、`campus app`。搜索 3 次，API 无 403。
> 36 条候选与既有 registry 比对后全部为本轮新增。许可证核实以 GitHub API `license.spdx_id` 为准。

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `ZJU-CC98/Forum` | B 其他JS | Apache-2.0 | 校园论坛 | 全新 | 🟢 | proposed | 2026-10-15 | ★223。**CC98 官方桌面端**（React+Redux+SignalR+TS），有完整 API 层与登录；可作「反馈」页社区能力或新页面底层。B 组最高价值 |
| `ZJU-CC98/CC98-PWA` | B 其他JS | MIT | 校园论坛 | 全新 | 🟡 | proposed | 2026-10-15 | ★60。CC98 移动版 PWA（TS/React），m.cc98.org。API 用法更轻量，适合作参考。**注意 2024-05 后未更新** |
| `ZJU-CC98/CC98-V4` | B 其他JS | Apache-2.0 | 校园论坛 | 全新 | 🔵 | proposed | 2026-10-15 | ★15。CC98 第四版前端，2023-08 后停更 |
| `Lucent-Snow/CC98-CLI` | B 其他JS | MIT | 校园论坛 | 全新 | 🔵 | proposed | 2026-10-15 | ★18。TS CLI/TUI 客户端，2026 新作；可提取其 API 封装 |
| `YangShu233-Snow/cc98-live-better` | B 其他JS | MIT | 校园论坛 | 全新 | 🔵 | proposed | 2026-10-15 | ★14。CC98 插件，体量过小 |
| `antct/cc98-mirror` | B 其他JS | 无许可证 | — | — | ⛔ | rejected | 2026-10-15 | ★19。无许可证，不得摘取代码 |
| `ZJU-CC98/MyCC98` | B 其他JS | 无许可证 | — | — | ⛔ | rejected | 2026-10-15 | ★46。2014 年 Java 项目，无许可证 + 过时 |
| `lunarfire/CC98Lite` | B 其他JS | 无许可证 | — | — | ⛔ | rejected | 2026-10-15 | ★28。Objective-C，无许可证 |
| `Puhao/cc98` | B 其他JS | 无许可证 | — | — | ⛔ | rejected | 2026-10-15 | ★15。Python 爬虫，无许可证 |
| `South-River/CC98-mmpictures` | B 其他JS | GPL-3.0 | — | — | ⛔ | rejected | 2026-10-15 | ★46。GPL 红线 |
| `Ansherly/CC98-Desktop` | B 其他JS | 无许可证 | 校园论坛 | — | ⛔ | rejected | 2026-10-15 | ★41。C#/WinUI3，无许可证 + 技术栈不符 |
| `inuEbisu/CC98Autosign` | B 其他JS | WTFPL | 校园论坛 | 全新 | 🔵 | proposed | 2026-10-15 | ★14。CC98 自动签到（Python）。WTFPL 属宽松但**不在白名单枚举内**，只登记不采用 |
| `QSCTech/zju-icicles` | B 其他JS | 无许可证 | 课程资料 | — | ⛔ | rejected | 2026-10-15 | ★41256。浙大课程攻略共享计划，**内容版权**，无许可证，只作线索 |
| `zjutjh/zjut-icicles` | B 其他JS | 无许可证 | 课程资料 | — | ⛔ | rejected | 2026-10-15 | ★773。浙江工业大学版本（非浙大），无许可证 |
| `CYBruce/DataStructure_Algorithm_ZJU` | B 其他JS | 无许可证 | 课程资料 | — | ⛔ | rejected | 2026-10-15 | ★750。2019 年后停更，无许可证 |
| `xlucn/PAT` | B 其他JS | 无许可证 | 刷题 | — | ⛔ | rejected | 2026-10-15 | ★494。PAT 题解，无许可证，只作线索 |
| `TheNetAdmin/zjuthesis` | B 其他JS | MIT | 论文（LaTeX） | 全新 | 🔵 | proposed | 2026-10-15 | ★3776。**浙大毕业论文 LaTeX 模板**（TeX）。与「论文阅读」非同一场景，但属浙大高价值资产 |
| `yunwei37/ZJU-CS-GIS-ClassNotes` | B 其他JS | MIT | 课程笔记 | 全新 | 🔵 | proposed | 2026-10-15 | ★1475。个人课程笔记库（Jupyter），**内容库非工具**，只作线索 |
| `hao14293/2021-Postgraduate-408` | B 其他JS | MIT | 刷题（考研） | 全新 | 🔵 | proposed | 2026-10-15 | ★1372。考研 408 备考资料（C++），内容库，2024 后停更 |
| `PeiPei233/zju-learning-assistant` | B 其他JS | MIT | 课件下载 | 全新 | 🔵 | proposed | 2026-10-15 | ★519。Tauri+Rust 课件批量下载器。**功能与 `dsh-zhiyun-classroom` 下载器重叠**，技术栈为 Rust，仅线索 |
| `ZJU-Turing/TuringCourses` | B 其他JS | NOASSERTION | 学习指南 | — | ⚠ 待核 | pending-license | 2026-10-15 | ★806。图灵班课程指南（Markdown），许可证待核 |
| `IsshikiHugh/zju-cs-asio` | B 其他JS | NOASSERTION | 资料索引 | — | ⚠ 待核 | pending-license | 2026-10-15 | ★338。ZJU-CS 网站资料集合，许可证待核 |
| `thu-info-community/thu-info-app` | B 其他JS | NOASSERTION | 校园信息 | — | ⚠ 待核 | pending-license | 2026-10-15 | ★237。清华校园信息整合 App（RN）。**他校**，仅作架构参考。许可证待核 |
| `Mythologyli/zju-connect` | B 其他JS | AGPL-3.0 | 网络接入 | — | ⛔ | rejected | 2026-10-15 | ★794。ZJU RVPN 客户端（Go）。AGPL 红线 + 非 JS |
| `Mythologyli/ZJU-Connect-for-Windows` | B 其他JS | LGPL-3.0 | 网络接入 | — | ⛔ | rejected | 2026-10-15 | ★471。LGPL 红线 + C++/Qt |
| `oddfar/campus-example` | B 其他JS | MIT | 校园论坛 | 全新 | 🔵 | proposed | 2026-10-15 | ★285。校园论坛/树洞 SpringBoot+Vue 示例。Java 后端，技术栈不符 |
| `oddfar/campus-imaotai` | B 其他JS | Apache-2.0 | — | — | ⛔ | rejected | 2026-10-15 | ★4136。i茅台自动预约，**与校园场景无关** |
| `kkw114514-lang/campus-job-application-workflow` | B 其他JS | MIT | 秋招 | 全新 | 🔵 | proposed | 2026-10-15 | ★184。AI 秋招投递工作流（Python）。与浙大学习工作台正交 |
| `wolongHyy/Campus_Recruitment-Application-Links` | B 其他JS | MIT | 秋招 | 全新 | 🔵 | proposed | 2026-10-15 | ★101。校招链接汇总（Python），内容库 |
| `hanjiayuan2025-coder/CampusApply-Agent` | B 其他JS | 无许可证 | 秋招 | — | ⛔ | rejected | 2026-10-15 | ★86。Chrome 插件，无许可证 |
| `TUM-Dev/Campus-Android` | B 其他JS | GPL-3.0 | 校园信息 | — | ⛔ | rejected | 2026-10-15 | ★209。慕尼黑工大，GPL + Kotlin |
| `TUM-Dev/Campus-iOS` | B 其他JS | GPL-3.0 | 校园信息 | — | ⛔ | rejected | 2026-10-15 | ★104。同上，GPL + Swift |
| `MummyDing/Awesome-Campus` | B 其他JS | GPL-3.0 | 校园信息 | — | ⛔ | rejected | 2026-10-15 | ★122。江西师大，GPL + 2018 年停更 |
| `s4ntrx/MUST-Campus` | B 其他JS | 无许可证 | 校园信息 | — | ⛔ | rejected | 2026-10-15 | ★133。澳门科技大学 PWA，无许可证 |
| `Sfedfcv/redesigned-pancake` | B 其他JS | 无许可证 | — | — | ⛔ | rejected | 2026-10-15 | ★268。无许可证，描述不可解析 |
| `shrikanth7698/Zinger-Android-App` | B 其他JS | MIT | — | — | ⛔ | rejected | 2026-10-15 | ★155。校园外卖 App，**与场景无关** + 2020 年停更 |

---

## 2026-10-15 · A 组（DSH 插件生态）· 追加

> 关键词：`deepseek-harness plugin`、`cordis plugin`、`dsh plugin`、`dsh market`、`dsh desktop`、
> `dsh plugin ui`、`dsh plugin student`、`dsh plugin notes`、`dsh plugin paper`。搜索 9 次，API 无 403。
> 候选与既有 registry 逐条比对后，以下均为**本轮新增**。类型 A = 原生 DSH 插件包（npm `dsh` 字段带
> `bundle.patch` 或 `client`，已逐条 `npm view` 核实）/ B = 其他 JS 项目。

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `LivXue/dsh-plugin-shop` | A 原生DSH | Apache-2.0 | 通用 | 重复无增益（插件页） | ⛔ | rejected | 2026-10-15 | ★704。**与 `dsh-market/dsh-market`、`bradeGithub/DSH-Plugins-Marketplace` 三足鼎立，都是插件市场**；本仓「插件」页只需一个后端，三个候选互为重复且无增益 |
| `bradeGithub/DSH-Plugins-Marketplace` | A 原生DSH | MIT | 通用 | 重复无增益（插件页） | ⛔ | rejected | 2026-10-15 | ★175。同上，插件市场第 3 个候选，重复无增益 |
| `Anionex/dsh-vision-toolkit` | A 原生DSH | MIT | 论文（扫描件） | 重复可强化（论文阅读） | 🟡 | proposed | 2026-10-15 | ★896。`npm view dsh-vision-toolkit` 确认带 `dsh.client`（原生 A 类）。视觉工具箱：粘贴即识图 / 多图问答 / 截图到 UI 还原。**与已登记的 `liustack/modlens` 功能重叠**，二选一 |
| `omdsh-dev/dsh-genui` | A 原生DSH | MIT | 通用 | 重复可强化（全页面 UI） | 🟡 | proposed | 2026-10-15 | ★589。**内联交互式 UI 组件**（`dsh-ui` fenced block 在回复里渲染）。横向增强所有面板的回答呈现，**不与任何现有包重复**，是本轮最干净的强化式候选 |
| `V1ki/dsh-plugin-subscriptions` | A 原生DSH | MIT | 通用 | 全新（模型接入层） | 🔵 | proposed | 2026-10-15 | ★463。把 ChatGPT/Claude/Grok 订阅当 LLM provider（OAuth）。与已登记的 `Ebony-Vinyl/dsh-our-free-model` 同域但不重叠；属接入层，与浙大学生工作台面板无关 |
| `ZSeven-W/dsh-ios` | A 原生DSH | MIT | 通用 | 全新 | 🔵 | proposed | 2026-10-15 | ★323。会话内跑 iOS 模拟器（含 USB iPhone）。开发域，与本仓面板无关 |
| `Fishquito7/dsh-skill-mcp-panel` | A 原生DSH | MIT | 通用 | 重复可强化（插件页） | 🔵 | proposed | 2026-10-15 | ★197。Web 端 skill / MCP 管理面板。与「插件」页同域，但未核到 npm 包名，**无法锁版挂载** |
| `leenkcool/Blue-Whale-Harness` | A 原生DSH | Apache-2.0 | 通用 | 全新（线索源） | 🔵 | proposed | 2026-10-15 | ★197。插件总目录（1958 仓库 / 1819 真插件）。**纯清单不含可挂载实现**，可作 `awesome-dsh-plugin` 之外的第二个线索源 |
| `HsiangNianian/dsh-auto-continue` | A 原生DSH | MIT | 通用 | 全新 | 🔵 | proposed | 2026-10-15 | ★146。非人工中断后自动发「继续」。体量小，形态与本仓面板无关 |
| `01Virex/dsh-status-rotator` | A 原生DSH | MIT | 通用 | 重复无增益（主题） | ⛔ | rejected | 2026-10-15 | ★145。状态行换梗（打字机 + 弹幕）。本仓外壳已自建状态行与主题（同 `dsh-skin-market` 的判据），无增益 |
| `mexiaosqwq/dsh-web-mobile` | A 原生DSH | MIT | 通用 | 重复可强化（外壳） | 🔵 | proposed | 2026-10-15 | ★134。DSH Web 窄屏适配。与 `dsh-zhiyun-shell` 壳层同域；未核到 npm 包名，且需先评审是否与外层响应式冲突 |
| `techflag/workdsh` | A 原生DSH | MIT | 通用 | 重复无增益 | ⛔ | rejected | 2026-10-15 | ★224。WorkBuddy 风格桌面工作台（项目 / Agent / 会话管理）。**与本工作台整体形态重复**，且是应用而非可挂载插件 |
| `cv-superding/dsh-deepseek-web-login` | A 原生DSH | Apache-2.0 | 通用 | 全新（模型接入层） | 🔵 | proposed | 2026-10-15 | ★269。用 chat.deepseek.com 网页版模型作 LLM provider。接入层，与学生面板无关 |
| `dhicoc/dsh-reverse-skill` | A 原生DSH | MIT | 通用 | 全新 | 🔵 | proposed | 2026-10-15 | ★248。逆向工程 skill 包（88 个 SKILL.md）。**PowerShell 技术栈**，非 JS |
| `ayuayue/PiDeck` | A 原生DSH | MIT | 通用 | 重复无增益（桌面端） | ⛔ | rejected | 2026-10-15 | ★1077。本地项目 / Agent 会话管理工作台（可导入 Codex、Claude 会话）。与已登记的三个桌面端同判据 —— 本工作台是 Web 形态，不同路 |
| `Ebony-Vinyl/EAC-Desktop` | A 原生DSH | MIT | 通用 | 重复无增益（桌面端） | ⛔ | rejected | 2026-10-15 | ★2017。桌面端。同上 |
| `Javis603/token-monitor` | A 原生DSH | MIT | 通用 | 全新 | 🔵 | proposed | 2026-10-15 | ★3085。本地 token / 成本 / 限额监控挂件（45+ 引擎）。与已登记的余额挂件同域，形态与本仓面板无关 |
| `Vncntvx/dsh-zotero` | A 原生DSH | MIT | 论文（文献库） | 重复可强化（论文阅读） | 🟡 | proposed | 2026-10-15 | ★35。Zotero 集成：检索论文、读全文 PDF 与笔记、抽相关段落。**与已登记的 `dsh-zhiyun-paper` 是同一页的不同来源**，互补而非重叠（本地文献库 vs 已上传 PDF）。体量小需评审 |
| `XieZongChen/dsh-md-notes` | A 原生DSH | MIT | 笔记 | 重复可强化（笔记页） | 🔵 | proposed | 2026-10-15 | ★15。MD 笔记管理器 + 编辑器。与 `dsh-zhiyun-notes` 同域；★15 体量过小，未核到 npm 包名 |
| `charrywhite/dsh-sticky-notes` | A 原生DSH | MIT | 笔记 | 重复可强化（笔记页） | 🔵 | proposed | 2026-10-15 | ★7。便签（可拖动、9 种皮肤）。体量过小 |
| `zhaoolee/notes` | B 其他JS | Apache-2.0 | 笔记 | 重复可强化（笔记页） | 🔵 | proposed | 2026-10-15 | ★297。开源便签应用（Docker 私有化、支持 DSH 插件调用）。**是独立应用而非插件包**，只能作参考 |
| `maple-pwn/paperlab` | B 其他JS | MIT | 论文（修订） | 全新 | 🔵 | proposed | 2026-10-15 | ★8。Overleaf 风格的论文修订工作台（由 DSH 插件驱动）。形态为独立 Web 应用，与本仓论文页不同路 |
| `863683348/dsh-plugin-academic-writing` | A 原生DSH | MIT | 论文（写作） | 全新 | 🔵 | proposed | 2026-10-15 | ★3。学术写作工具（大纲 / 标题摘要骨架 / GB-T 7714 与 APA 引用）。**引用格式生成**与 `dsh-zhiyun-final-pass` 的终稿检查部分同域，需评审是否重叠 |
| `zhaoxuejie/dsh-plugin-academic-paper` | A 原生DSH | MIT | 论文（检索） | 重复可强化（论文阅读） | 🔵 | proposed | 2026-10-15 | ★1。arXiv / Semantic Scholar 检索 + 引用格式 + 本地文献库。体量过小（★1），仅作线索 |
| `zoujialin1997/free-academic-search` | A 原生DSH | MIT | 论文（检索） | 重复可强化（论文阅读） | 🔵 | proposed | 2026-10-15 | ★2。免 API key 的多源学术检索（Semantic Scholar / PubMed / arXiv）。体量过小，仅作线索 |
| `maple-pwn/paperlab` 之外的论文类小包 | A 原生DSH | MIT | 论文 | 仅供参考 | 🔵 | proposed | 2026-10-15 | `1283011852/dsh-plugin-deep-paper-reading`（★1）、`Thomas-Novato/deepseek-harness-paper-assistant`（★1）、`OrinVoss/dsh-math-team`（★7）、`try-works/dsh-paper-design`（★2）、`void2anything/dsh-qingagent`（Apache-2.0，★2）、`zhaoxuejie/…`、`gqallen931/paper-gogo-plugin`（无许可证 ⛔）。**均为 ★≤7 的小包**，仅作线索；`gqallen931/paper-gogo-plugin` 因无许可证排除 |
| `WYH66666666/DSH-Transparent-UI-Plugin` | A 原生DSH | AGPL-3.0 | 通用 | — | ⛔ | rejected | 2026-10-15 | ★414。玻璃质感主题。**AGPL 红线**，只登记不摘代码；且主题域本仓已自建 |
| `ArisaYamatogi/dsh-lecture-copilot` | A 原生DSH | GPL-3.0 | 讲座录制/翻译 | — | ⛔ | rejected | 2026-10-15 | ★3。自动录制 + 翻译 + 生笔记。**GPL 红线**，且与 `dsh-zhiyun-lecture` 同域 |
| `EthanYoQ/AI-Novel-Writer` | A 原生DSH | GPL-3.0 | — | — | ⛔ | rejected | 2026-10-15 | ★1549。GPL 红线。**已由 2026-10-15 A 组误跑登记，本轮去重确认** |
| `zhukunpenglinyutong/desktop-cc-gui` | 其他 | 无许可证 | — | — | ⛔ | rejected | 2026-10-15 | ★4479。多引擎 AI 编码桌面客户端，**无许可证** |
| `nashorya/dsh-student-memory` | A 原生DSH | 无许可证 | 学习记忆 | — | ⛔ | rejected | 2026-10-15 | ★0。「学生记忆插件」描述最贴合本仓，但**无许可证** → 只登记，不得摘取任何代码 |
| `mckenna0625/dsh-langgraph-paper-pipeline` | A 原生DSH | 无许可证 | 论文 | — | ⛔ | rejected | 2026-10-15 | ★1。无许可证 + Python |
| `YaoApp/yao` | 其他 | NOASSERTION | 通用 | — | ⚠ 待核 | pending-license | 2026-10-15 | ★8130。Agent/工作空间平台（Go）。许可证待人工核验，不采用 |
| `cholf5/dsh-plugin-dev-notes` | A 原生DSH | MIT | 笔记（开发向） | 全新 | 🔵 | proposed | 2026-10-15 | ★11。插件开发笔记，无描述。体量过小，仅作线索 |

---

## 2026-10-15 · C 组（学生功能域）· 追加

> 关键词：`timetable ics export`、`paper annotation reader`、`ocr notes taking`、`quiz practice`、
> `fitness tracker`、`spaced repetition flashcard`、`html to markdown converter`、`pdf to markdown`。
> 搜索 8 次，API 无 403。原始命中 63 个未登记仓库，经相关性二次过滤后保留 22 条登记在下。
> **`open-spaced-repetition/fsrs.js` 不登记** —— 与既有骨架 `dsh-radar-fsrs-scheduler` 锁定的
> `ts-fsrs` 重复且无增益（同组织同算法的 TS 后继），按 ⛔ 处理但不占用登记行。

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `ctrlaltwill/LearnKit` | B 其他JS | MIT | 复习 / 刷题 | 重复可强化（学习页·复习调度） | 🟡 | proposed | 2026-10-15 | ★182（活跃）。Obsidian 学习系统（flashcards + FSRS + image-occlusion + 自测）。**调度层与 `ts-fsrs` 骨架重复**，仅 image-occlusion 有独有增益 → 建议只提取该思路，不整包集成 |
| `Charlielin-Fan/zotero-ai-reader` | B 其他JS | MIT | 论文批注 | 重复可强化（论文阅读页） | 🟡 | proposed | 2026-10-15 | ★2（低活跃）。Zotero 全文证据批注。与 `Vncntvx/dsh-zotero` 同域，**二选一**（优先后者）。体量过小 |
| `st3v3nmw/obsidian-spaced-repetition` | B 其他JS | MIT | 复习 | 重复可强化（学习页） | 🔵 | proposed | 2026-10-15 | ★2589。Obsidian 插件形态强耦合宿主；调度层与 `ts-fsrs` 重复，仅作线索 |
| `kirill-markin/flashcards-open-source-app` | B 其他JS | MIT | 复习 | 重复可强化（学习页） | 🔵 | proposed | 2026-10-15 | ★93。完整独立 App（iOS/Android/Web），非可封装库 |
| `VienDinhCom/supermemo` | B 其他JS | MIT | 复习 | **重复且无增益** | 🔵 | proposed | 2026-10-15 | ★337。SM-2 算法实现，**旧于 FSRS**，已被 `ts-fsrs` 骨架覆盖。登记但建议不采用 |
| `pieralukasz/true-recall` | B 其他JS | NOASSERTION | 复习 | — | ⚠ 待核 | pending-license | 2026-10-15 | ★65。Obsidian 插件，许可证待人工核验 |
| `chrisryugj/kordoc` | B 其他JS | MIT | 文档转换 | 全新 | 🔵 | proposed | 2026-10-15 | ★2448（活跃）。PDF/Office→Markdown（CLI + MCP，含 OCR）。**面向韩文 HWP 格式**，与本仓中文场景不符，需裁定是否移植 |
| `philschmid/clipper.js` | B 其他JS | Apache-2.0 | 文档解析 | 全新 | 🔵 | proposed | 2026-10-15 | ★629。HTML→Markdown 爬虫。**2024-01 后停更** |
| `KKonstantinov/markdown-for-agents` | B 其他JS | MIT | 文档解析 | 全新 | 🔵 | proposed | 2026-10-15 | ★34（活跃）。HTML→Markdown 省 token，可作解析层参考 |
| `zhikangSu/DeepRead` | B 其他JS | 无许可证 | 论文精读 | — | ⛔ | rejected | 2026-10-15 | ★9。描述贴合但**无许可证** → 只登记，不得摘取任何代码 |
| `dimostzim/PaperSprint` | B 其他JS | 无许可证 | 论文精读 | — | ⛔ | rejected | 2026-10-15 | ★4。无许可证 |
| `mrmps/pdf2md` | B 其他JS | 无许可证 | 文档转换 | — | ⛔ | rejected | 2026-10-15 | ★380。浏览器端 PDF→MD，无许可证 |
| `Nano-Collective/get-md` | B 其他JS | NOASSERTION | 文档转换 | — | ⚠ 待核 | pending-license | 2026-10-15 | ★95。HTML→MD，许可证待核 |
| `koljapluemer/obsidian-the-queue` | B 其他JS | 无许可证 | 复习 | — | ⛔ | rejected | 2026-10-15 | ★44。无许可证 |
| `simonoppowa/OpenNutriTracker` | B 其他JS | GPL-3.0 | 锻炼 | — | ⛔ | rejected | 2026-10-15 | ★2685。GPL 红线 + Dart |
| `timfraedrich/OutRun` | B 其他JS | GPL-3.0 | 锻炼 | — | ⛔ | rejected | 2026-10-15 | ★880。GPL 红线 + Swift |
| `maksimowiczm/FoodYou` | B 其他JS | GPL-3.0 | 锻炼 | — | ⛔ | rejected | 2026-10-15 | ★619。GPL 红线 + Kotlin |
| `subconcept-labs/ulangi` | B 其他JS | GPL-3.0 | 复习 | — | ⛔ | rejected | 2026-10-15 | ★455。GPL 红线 + 2023 年后停更 |
| `kordoc` 之外的韩文/多语文档 | B 其他JS | 混合 | — | — | ⛔ | rejected | 2026-10-15 | 泛化关键词命中的无关项（钢琴练习器、健身房 SaaS 等）经相关性二次过滤后不登记 |
| `edu/quiz-template` 类通用答题模板 | B 其他JS | MIT | 刷题 | **重复且无增益** | ⛔ | rejected | 2026-10-15 | `quiz practice` 命中大量通用答题模板，均与 `dsh-zhiyun-quiz` 重合且无更优底层，不登记 |

---

## 2026-10-15 · A 组（DSH 插件生态 · **增量角度**）· 追加

> 关键词：`dsh plugin theme`、`dsh plugin calendar`、`dsh plugin translate`、
> `dsh plugin markdown`、`dsh plugin export`、`dsh plugin search`、`dsh plugin course`、
> `dsh plugin flashcard`、`cordis plugin ui`。搜索 9 次，API 无 403。
> 与 registry 既有 132 条逐条比 `owner/repo` 去重，以下 **63 条均为首次登记**。
> 类型 A = 原生 DSH 插件包（npm `dsh` 字段带 `bundle`/`client`，关键项已 `npm view` 核实）/
> B = 其他 JS 项目。**本轮唯一 🟢 已出骨架 `dsh-radar-better-markdown`。**

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `zerob13/dsh-better-markdown` | A 原生DSH | MIT | 论文（呈现）/笔记 | **重复可强化** | 🟢 | skeleton-created | 2026-10-15 | ★20。`npm view` 确认 `dsh-better-markdown@0.1.2` 带 `bundle`+`client`。基于 `markstream-react` 的流式 Markdown + Mermaid + KaTeX + 降级兜底。**强化式集成**：仍是论文/笔记同一面板、功能相似正交、底层多调更优实现。已出骨架。待裁定：与 `dsh-smooth-stream` 二选一 |
| `Physicolor/dsh-ui-harmonizer` | A 原生DSH | MIT | 通用（全页面） | 重复可强化（UI 基元） | 🟡 | proposed | 2026-10-15 | ★10。`dsh-ui-harmonizer@0.9.1` 可锁版挂载。调和已装插件间样式冲突、统一视觉语言。与 `dsh-zhiyun-ui-primitives` 同域不重复（本仓定义基元 vs 上游调和第三方）。风险：全页面作用面，需确认不与自建主题冲突 |
| `MAGMA27/dsh-calendar` | A 原生DSH | Apache-2.0 | 日程/任务 | 重复可强化（今天页） | 🟡 | proposed | 2026-10-15 | ★1。`dsh-calendar@0.10.3` 可锁版挂载。日历 + Agent 任务编排（todo/时间安排/周期运行/`calendar_task`）。★1 体量极小，需评审是否值得引入 |
| `d-dev0101/open-sea-skin` | A 原生DSH | MIT | 通用 | 重复无增益（主题） | ⛔ | rejected | 2026-10-15 | ★392。海洋皮肤，`npm` 可挂载。**主题域本仓已自建**（同 `dsh-skin-market` 判据） |
| `RevolutionLA/dsh-dream-skin` | A 原生DSH | MIT | 通用 | 重复无增益（主题） | ⛔ | rejected | 2026-10-15 | ★239。换肤/壁纸/主题包（8 套 Mirage），同上 |
| `ymh0000123/dsh-theme-endfield` | A 原生DSH | MIT | 通用 | 重复无增益（主题） | ⛔ | rejected | 2026-10-15 | ★139。终末地官网风格（奶油纸底/信号黄），同上 |
| `rison114514/dsh-endfield-ui` | A 原生DSH | **无** | — | — | ⛔ | rejected | 2026-10-15 | ★86。Endfield 风 UI 外壳。**无许可证** → 只登记，不得摘取任何代码 |
| `oil-oil/dsh-theme` | A 原生DSH | MIT | 通用 | 重复无增益（主题） | ⛔ | rejected | 2026-10-15 | ★45。实时主题编辑器（调色板/字体控制），同上 |
| `yoli-mi/dsh-client-ui-custom` | A 原生DSH | MIT | 通用 | 重复无增益（主题） | ⛔ | rejected | 2026-10-15 | ★39。壁纸/磨砂/强调色/快捷键可配置，同上 |
| `nevertoday/dsh-theme-plugin` | A 原生DSH | MIT | 通用 | 重复无增益（主题） | ⛔ | rejected | 2026-10-15 | ★26。中国传统色主题包，同上 |
| `chouxiaohuai/dsh-uiskin-theme` | A 原生DSH | NOASSERTION | — | — | ⚠ 待核 | pending-license | 2026-10-15 | ★40。海洋幻想主题。许可证待人工核验，不采用 |
| `chen731215-dev/dsh-tavern-v2` | A 原生DSH | NOASSERTION | — | — | ⚠ 待核 | pending-license | 2026-10-15 | ★47。酒馆/角色卡。许可证待核 + 域不符 |
| `Nwflower/dsh-chat-import` | A 原生DSH | MIT | 通用 | 全新（会话管理） | 🔵 | proposed | 2026-10-15 | ★231。从 25+ AI 编码代理导入会话历史为可续会话。与浙大学生面板无关 |
| `xiajiajun516/dsh-config-manager` | A 原生DSH | MIT | 通用 | 全新（配置管理） | 🔵 | proposed | 2026-10-15 | ★191。配置备份/恢复/迁移/同步。与已登记桌面端同判据 |
| `DIAG5/dsh-better-input` | A 原生DSH | MIT | 笔记/论文（导入） | 重复可强化（导入通路） | 🔵 | proposed | 2026-10-15 | ★26。输入增强套件（语音识别/提示词优化/**各类文件转 MD**/交互优化）。`npm` 可挂载，依赖 `pdfjs-dist`/`mammoth`/`turndown`。与笔记/论文页导入通路正交，可作后续候选 |
| `HongMing-Huang/dsh-file-upload` | A 原生DSH | MIT | 笔记/论文（导入） | 重复可强化（导入通路） | 🔵 | proposed | 2026-10-15 | ★26。Claude 风格拖拽/回形针上传 + 内容嗅探 + 转换（`mammoth`/`pdfjs-dist`/`markitdown-node`）。`npm` 可挂载 |
| `Jiyr0119/dsh-workspace-explorer` | A 原生DSH | MIT | 通用（文件树） | 全新 | 🔵 | proposed | 2026-10-15 | ★39。工作区文件树面板，拖拽引用进输入框。**未核到 npm 包名，无法锁版挂载** |
| `Laplace-bit/dsh-smooth-stream` | A 原生DSH | MIT | 论文/笔记（渲染） | 重复可强化（渲染） | 🔵 | proposed | 2026-10-15 | ★82。流式渲染与滚动处理。`npm` 可挂载。**与 🟢 `dsh-better-markdown` 功能重叠 → 二选一** |
| `kejixiaoliang/awesome-dsh-plugins` | A/清单 | MIT | 通用 | 全新（线索源） | 🔵 | proposed | 2026-10-15 | ★52。插件精选目录（14 类 280+，含 MCP/Skill/TUI/多 Agent/记忆/UI 皮肤）。**第三个线索源** |
| `imsai-sh/awesome-deepseek-harness-plugins` | A/清单 | MIT | 通用 | 全新（线索源） | 🔵 | proposed | 2026-10-15 | ★291。插件商店/目录（11000+ 插件，含搜索/排行/安装命令）。**第四个线索源** |
| `awesome-dsh-plugin/dsh-find-plugin` | A 原生DSH | MIT | 通用 | 全新（线索源） | 🔵 | proposed | 2026-10-15 | ★187。会话内搜插件（GitHub `dsh-plugin` topic 实时搜 + stars 排序）。**第五个线索源** |
| `2BingLing/dsh-market` | A 原生DSH | NOASSERTION | 通用 | 重复无增益（插件页） | ⚠ 待核 | pending-license | 2026-10-15 | ★151。插件市场（6000+ 收录，五维评分）。**第 6 个插件市场候选** + 许可证待核 |
| `mishibeikejie/zat-dsh-engine` | A 原生DSH | MIT | 通用 | 重复无增益（插件页） | ⛔ | rejected | 2026-10-15 | ★77。可视化插件市场。**第 7 个插件市场候选**，本仓「插件」页只需一个后端 |
| `yyyyukari/dsh-plugin-workshop` | A 原生DSH | MIT | 通用 | 重复无增益（插件页） | ⛔ | rejected | 2026-10-15 | ★25。Steam 创意工坊式插件浏览器（零服务端，GitHub 驱动）。插件页重复；且未核到 npm 包名 |
| `Dylan37670/dsh-plugin-panel` | A 原生DSH | MIT | 通用 | 重复无增益（插件页） | ⛔ | rejected | 2026-10-15 | ★2。插件市场面板（目录搜索/中文翻译/语义搜索/收藏）。体量过小 + 插件页重复 |
| `dsh-blue/blue` | A 原生DSH | MIT | 通用（TUI） | 全新 | 🔵 | proposed | 2026-10-15 | ★21。终端 UI（Cordis 插件树，热插拔渲染/交互/命令）。TUI 域，与本仓 Web 形态不同路 |
| `JingHao-Leon/deepseek-harness-guide` | 文档 | MIT | 通用（开发参考） | 全新 | 🔵 | proposed | 2026-10-15 | ★9。DSH 架构深度教程 + Cordis 插件系统 + 事件系统讲解。**对本仓自研插件有参考价值** |
| `kun2-5code/dsh-plugin-template` | 脚手架 | MIT | 通用（开发参考） | 全新 | 🔵 | proposed | 2026-10-15 | ★8。插件脚手架（6 种插件形态 / 14 个浏览器 UI 面）。**对本仓自研插件有直接参考价值** |
| `yuioi666/dsh-plugin-model-capability` | A 原生DSH | MIT | 通用 | 全新（接入层） | 🔵 | proposed | 2026-10-15 | ★7。模型能力管理器（思考等级/上下文窗口/输出上限/输入模态/网关）。接入层 |
| `Mars-Sea/dsh-commandcode-provider` | A 原生DSH | MIT | 通用 | 全新（接入层） | 🔵 | proposed | 2026-10-15 | ★389。Command Code provider（今日推送）。接入层，与学生面板无关 |
| `anweat/dsh-web-search-pro` | A 原生DSH | MIT | 通用（检索） | 重复可强化（搜索） | 🔵 | proposed | 2026-10-15 | ★78。增强持久化搜索（多引擎 + SQLite/LRU 缓存 + 平台桥接）。与已登记 `liustack/modsearch` 同域 |
| `loongsuite/dsh-plugin` | A 原生DSH | Apache-2.0 | 通用 | 全新（可观测性） | 🔵 | proposed | 2026-10-15 | ★27。OpenTelemetry 追踪（每轮次转 GenAI span 树）。可观测性域 |
| `linyp/dsh-plugin-langfuse` | A 原生DSH | MIT | 通用 | 全新（可观测性） | 🔵 | proposed | 2026-10-15 | ★14。Langfuse 可观测性（会话导出为 OTel trace 树）。同上 |
| `YeqingTang/dsh-session-flow` | A 原生DSH | Apache-2.0 | 通用（会话） | 重复无增益（会话） | ⛔ | rejected | 2026-10-15 | ★4。会话信息流重设计（档案柜/血缘树/检索/ZIP 导出）。DSH 自身已具备会话管理 |
| `bwndlct/dsh-session-export` | A 原生DSH | MIT | 通用（会话） | 重复无增益（会话） | ⛔ | rejected | 2026-10-15 | ★3。会话导出 MD/JSON。同上 |
| `yangyongzhen/dsh-session-export` | A 原生DSH | **无** | — | — | ⛔ | rejected | 2026-10-15 | ★3。会话导出 MD。**无许可证** → 只登记 |
| `azure5100/huahua-dsh-record-replay` | A 原生DSH | Apache-2.0 | 通用（会话） | 重复无增益（会话） | ⛔ | rejected | 2026-10-15 | ★3。会话录制回放（时间线/replay-pack 导入导出）。同上 |
| `PerryLink/dsh-fund-research` | A 原生DSH | Apache-2.0 | 通用（金融） | 全新 | 🔵 | proposed | 2026-10-15 | ★67。公募基金确定性研究报告生成。金融域，与学生场景正交 |
| `PolinniZhong/dsh-knit` | A 原生DSH | MIT | 笔记/论文（本地检索） | 全新 | 🔵 | proposed | 2026-10-15 | ★54。任务感知的工作区上下文检索与生命周期追踪（纯本地、零模型调用、零网络）。**与论文/笔记页本地检索有潜在交集，值得后续深看** |
| `Fayelin12/dsh-office` | A 原生DSH | MIT | 通用 | 重复无增益（桌面端） | ⛔ | rejected | 2026-10-15 | ★6。Agent 办公室仪表盘（工作区/会话/token/子代理 6 栏）。与已登记桌面端同判据 |
| `Hou-DL/dsh-token-pulse` | A 原生DSH | MIT | 通用 | 重复无增益（token） | ⛔ | rejected | 2026-10-15 | ★4。Token 热力图（GitHub 风格日历视图）。与已登记 token 监控同域 |
| `skkjkk/dsh-usage-dashboard` | A 原生DSH | Apache-2.0 | 通用 | 重复无增益（token） | ⛔ | rejected | 2026-10-15 | ★3。用量统计仪表盘（token/成本/时长/会话聚合）。同上 |
| `Fiennes4590/dsh-token-usage-calendar` | A 原生DSH | MIT | 通用 | 重复无增益（token） | ⛔ | rejected | 2026-10-15 | ★1。动态 Cordis token 用量日历。同上 |
| `greyhackintoch-dev/dsh-month-tokens` | A 原生DSH | MIT | 通用 | 重复无增益（token） | ⛔ | rejected | 2026-10-15 | ★1。月度 token 计数（仅本地数据）。同上 |
| `AK-blank/dsh-plugin-offpeak-badge` | A 原生DSH | MIT | 通用 | 全新 | 🔵 | proposed | 2026-10-15 | ★1。显示 DeepSeek API 是否处于错峰计费时段。有用小工具，但与本仓面板无关 |
| `runcat-tommy/dsh-panda-calendar` | A 原生DSH | MIT | 日程 | 重复可强化（今天页） | 🔵 | proposed | 2026-10-15 | ★1。熊猫日历（公历/农历/干支/生肖/节气/传统与外国节日/法定节假日含调休/多城市天气/时间戳转换/历史上的今天）。`npm` 可挂载。功能丰富但与本仓「今天」页设计取向不同，需裁定 |
| `Como44/dsh-zh-more` | A 原生DSH | MIT | 通用（中文） | 重复无增益（中文） | ⛔ | rejected | 2026-10-15 | ★2。DSH 中文增强（斜杠命令名与插件清单中文化，三种显示模式）。**本仓已中文优先**，无增益 |
| `asd13006/dsh-multi-lang-ui` | A 原生DSH | MIT | 通用（i18n） | 全新 | 🔵 | proposed | 2026-10-15 | ★1。多语言 UI（繁中/日/韩/法/德/西）。未核到 npm 包名 |
| `onfire-07/dsh-think-translate` | A 原生DSH | MIT | 通用（翻译） | 全新 | 🔵 | proposed | 2026-10-15 | ★1。点击 Think 行浮窗实时翻译推理过程。`npm` 可挂载。新颖，但非学生面板刚需 |
| `SHAN5246992ZHUI/dsh-select-translate` | A 原生DSH | NOASSERTION | — | — | ⚠ 待核 | pending-license | 2026-10-15 | ★1。Windows 划词翻译置顶卡（仅 Windows）。许可证待核 |
| `ShiXiangYu2/dsh-translate-pro` | A 原生DSH | **无** | — | — | ⛔ | rejected | 2026-10-15 | ★2。专业翻译插件（18 语言/4 风格/术语表）。**无许可证** → 只登记 |
| `gongyijie85/mattpocock-skills-dsh-zh` | 技能包 | MIT | 通用（学习参考） | 全新 | 🔵 | proposed | 2026-10-15 | ★6。Matt Pocock 技能中文版（25 个技能正文全译）。**技能包而非插件**，可作学习参考 |
| `Kaiji-Z/dsh-plugin-lookatstudy` | A 原生DSH | MIT | 知识/课程 | 重复可强化（知识页） | 🔵 | proposed | 2026-10-15 | ★19。把 markdown/文件夹/GitHub 学习仓库变成 AI 导师课程（门控技能）。**与本仓「知识」页有潜在交集，值得后续深看** |
| `leonHan01/learn-dsh` | A 原生DSH | NOASSERTION | — | — | ⚠ 待核 | pending-license | 2026-10-15 | ★1。DSH 学习工作区 + 12 天课程。许可证待核 |
| `bettermen/xiashuo` | A 原生DSH | MIT | 教材写作 | 全新 | 🔵 | proposed | 2026-10-15 | ★1。虾说教材写作（三栏工作台/九阶段门禁）。**教材写作与论文页不同路** |
| `fadedfakers/dsh-course-plugin` | A 原生DSH | MIT | 课程 | 全新 | 🔵 | proposed | 2026-10-15 | ★0。课程插件（学生端 + 教师端 + 共享内核，形状由 `课程配置.json` 描述）。**★0 但形态有意思**，作线索 |
| `praisethefacts/dsh-plugin-google-classroom` | A 原生DSH | MIT | 课程 | 全新 | 🔵 | proposed | 2026-10-15 | ★0。Google Classroom MCP（只读课程/作业/截止日/公告）。**国内场景不适用** |
| `fengchang618gmail/dsh-course-subtitles` | A 原生DSH | MIT | 讲座/课程字幕 | 重复可强化（讲座字幕） | 🔵 | proposed | 2026-10-15 | ★0。抓课程字幕（DeepLearning.AI/YouTube/Bilibili/Coursera）并重建整句。与 `dsh-zhiyun-lecture` 字幕通路有交集 |
| `myYangyunfan/dsh_cardian` | A 原生DSH | MIT | 笔记/复习 | 重复可强化（笔记页） | 🔵 | proposed | 2026-10-15 | ★2。知识中心（RepoWiki 笔记/闪卡/记忆，本地 Obsidian vault）。与 `dsh-zhiyun-notes` 同域，体量过小 |
| `tyfforu/dsh-flashcard` | A 原生DSH | MIT | 复习 | **重复且无增益** | ⛔ | rejected | 2026-10-15 | ★0。Anki 式 **SM-2** 闪卡（右侧栏复习标签）。**SM-2 旧于 FSRS**，已被 `dsh-radar-fsrs-scheduler` 骨架覆盖 |
| `hugoyoung1228/dsh-language-tutor` | A 原生DSH | MIT | 语言学习 | 全新 | 🔵 | proposed | 2026-10-15 | ★0。写作检查/导师/闪卡/双语翻译。未核到 npm 包名 |
| `863683348/dsh-plugin-education` | A 原生DSH | MIT | 教育工具 | 全新 | 🔵 | proposed | 2026-10-15 | ★0。教育工具包（按学段教案骨架/测验脚手架/答案）。`npm view` 确认 `dsh-plugin-education@0.3.2` 带 `bundle`。与已登记 `863683348/dsh-plugin-academic-writing` 同作者 |
| `ktao732084-arch/dsh-vibegap` | A 原生DSH | **无** | — | — | ⛔ | rejected | 2026-10-15 | ★0。词汇闪卡（Agent 运行时浮现）。**无许可证** → 只登记 |
| `yuexiaoliang/dsh-methodology` | 文档 | **无** | — | — | ⛔ | rejected | 2026-10-15 | ★0。软件项目方法论双语课程。**无许可证** → 只登记 |
| `HuanLinOTO/dsh-plugin-mineru` | A 原生DSH | NOASSERTION | 论文/笔记（文档解析） | — | ⚠ 待核 | pending-license | 2026-10-15 | ★46。向模型暴露 MinerU 文档解析（PDF/图片/DOCX/PPTX/XLSX → 结构化 MD/JSON）。**功能最贴合学生场景，但许可证 NOASSERTION**。⚠ **建议优先核验仓库 LICENSE**，若为 MIT/Apache 即可转 🟢 |
| `naodeng/dsh-qa` | A 原生DSH | NOASSERTION | — | — | ⚠ 待核 | pending-license | 2026-10-15 | ★29。QA 工作台（零依赖测试计划）。许可证待核 |
| `Trouvaille-xx/dsh-StardewValley-UI` | A 原生DSH | NOASSERTION | — | — | ⚠ 待核 | pending-license | 2026-10-15 | ★1。星露谷主题包（像素 UI/提醒音效/OST/token 热力图）。许可证待核 + 主题域已自建 |
| `609476965/dsh-LorebookMD` | A 原生DSH | **无** | — | — | ⛔ | rejected | 2026-10-15 | ★23。DSH 小说创作（酒馆/SillyTavern 角色卡与世界书导入）。**无许可证** → 只登记 |
| `a86582751/dsh-nexttavern` | A 原生DSH | **GPL-3.0** | — | — | ⛔ | rejected | 2026-10-15 | ★173。长篇角色扮演（角色卡/分支对话/长篇记忆/多 Agent 集群）。**GPL 红线**，只登记不摘代码 |
| `sixtysevenlf/dsh-blender-plugin` | A 原生DSH | BSD-3-Clause | — | — | 🔵 | proposed | 2026-10-15 | ★227。DSH × Blender 实时联控。**Python 技术栈**，非 JS；且域不符 |

---

## 2026-10-15 · A 组（DSH 插件生态 · **能力域细分**）· 追加

> 关键词：`dsh plugin rag`、`dsh plugin ocr`、`dsh plugin graph`、`dsh plugin pdf`、
> `dsh plugin speech`、`dsh plugin workflow`、`cordis plugin service`、`dsh plugin knowledge`、
> `dsh plugin citation`、`dsh plugin notes editor`。搜索 **10 次**（= 上限），API 无 403。
> 全部关键词均为**历史轮次从未使用过**的能力域切片。原始命中 89 条，与既有 registry
> 逐条 `owner/repo` 比对后剔除 10 条已登记项，**79 条为本轮新增**。
> 类型 A = 原生 DSH 插件包（`dsh.bundle.patch` 或 `dsh.client`，可锁版者已逐条 `npm view` 核实）/
> B 类本轮未产出（该切片天然聚焦 DSH 生态）。

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `PensiveFei/deep-read-summarize` | A 原生DSH | MIT | 论文/笔记/精读 | 重复可强化（论文页·笔记域） | 🟢 | proposed | 2026-10-15 | ★32。`deep-read-summarize@0.3.13` **已核可锁版**（包名无 `dsh-` 前缀）。书/论文/视频/网页 → 结构化 MD（解析器层 + MapReduce 长文精读 + JSON Schema 约束）。补「读完 → 结构化笔记」**断裂通路**。**已出骨架 `dsh-radar-deep-read`** |
| `qishuilalala/dsh-voice-mode` | A 原生DSH | MIT | 讲座/语音交互 | 全新（本仓无语音层） | 🟡 | proposed | 2026-10-15 | ★16。`dsh-voice-mode@0.7.23` 已核可锁版。全双工：流式 ASR + TTS 按句朗读 + 实时字幕 + 开口即打断 + 本地识别免 Key。**注入 9 个 UI 分包**，作用面宽，需裁定要不要语音层 |
| `PensiveFei/dsh-voice-scribe` | A 原生DSH | MIT | 语音输入 | 全新（本仓无语音层） | 🟡 | proposed | 2026-10-15 | ★36。轻量 Alt 说话 → composer；默认零成本 Web Speech。**与 `dsh-voice-mode` 二选一**，不要都接 |
| `Roarpeng/GraphFlow` | A 原生DSH | Apache-2.0 | 学习/代码理解 | 全新（本仓无图谱层） | 🟡 | proposed | 2026-10-15 | ★22。本地优先代码知识图谱 + 上下文引擎。**图谱簇 5 个中建议取此**（★最高 + Apache-2.0 + 仍推送） |
| `Flan246/dsh-lit-search` | A 原生DSH | MIT | 论文/文献检索 | 重复可强化（论文页·检索） | 🟡 | proposed | 2026-10-15 | ★4。`dsh-lit-search@0.2.2` 已核可锁版。学术检索 + 引用 + BibTeX。**文献簇 4 个中唯一核到可锁版者**，建议与已 🟡 的 `dsh-zotero` 二选一 |
| `quqxui/dsh-memgas` | A 原生DSH | MIT | 通用（记忆层） | 全新 | 🔵 | proposed | 2026-10-15 | ★26。四通道检索融合的长期记忆（SQLite）。与 `jasen215/dsh-continual-harness` 同域 |
| `lemoncat7/dsh-knowledge` | A 原生DSH | MIT | 知识/笔记 | 重复可强化（知识页） | 🔵 | proposed | 2026-10-15 | ★17。可安装知识库（RAG + SQLite），2026-10-15 推送 |
| `htcqp802/dsh-knowledge-base` | A 原生DSH | MIT | 知识/文档 | 重复可强化（知识页） | 🔵 | proposed | 2026-10-15 | ★8。导入 PDF/DOCX/MD 的知识库 |
| `123caiji/dsh-memory-toolkit` | A 原生DSH | MIT | 通用（记忆层） | 全新 | 🔵 | proposed | 2026-10-15 | ★4。跨会话知识 + token 优化工具包 |
| `Spirtxiaoqi7/mindspace-dsh-local-rag` | A 原生DSH | MIT | 通用（RAG） | 全新 | 🔵 | proposed | 2026-10-15 | ★2。本地混合 RAG。体量过小 |
| `wly8691-jpg/knowlp-rag` | A 原生DSH | MIT | 笔记 | 全新（RAG） | 🔵 | proposed | 2026-10-15 | ★3。双知识图谱 RAG（Markdown 笔记）。**Python** 技术栈 |
| `jing-hy/picturereader` | A 原生DSH | MIT | 论文（识图） | 重复可强化（视觉簇） | 🔵 | proposed | 2026-10-15 | ★35。像素到文本（`image_scan`/`image_ocr`）。**视觉簇**，簇内已取 `modlens`，本条保留线索 |
| `CraZY222123/dsh-ocr-plugin` | A 原生DSH | MIT | 论文（OCR） | 重复可强化（视觉簇） | 🔵 | proposed | 2026-10-15 | ★13。**Python**。视觉簇 |
| `linenxi-ctrl/dsh-vision` | A 原生DSH | MIT | 论文（识图） | 重复可强化（视觉簇） | 🔵 | proposed | 2026-10-15 | ★9。外挂识图模型 + 一键安装。视觉簇 |
| `sfyyy/dsh-vision-bridge` | A 原生DSH | MIT | 论文（识图） | 重复可强化（视觉簇） | 🔵 | proposed | 2026-10-15 | ★6。按需视觉桥。视觉簇 |
| `ferstar/dsh-tool-ocr` | A 原生DSH | MIT | 论文（OCR） | 重复可强化（视觉簇） | 🔵 | proposed | 2026-10-15 | ★4。本地 OCR。视觉簇 |
| `liqiGeGe/dsh-plugin-execution-graph` | A 原生DSH | Apache-2.0 | 学习（执行可视化） | 全新（图谱簇） | 🔵 | proposed | 2026-10-15 | ★21。会话加「执行图」标签页。**图谱簇次选** |
| `benz-ai-x/dsh-research-graph` | A 原生DSH | MIT | 研究/知识 | 全新（图谱簇） | 🔵 | proposed | 2026-10-15 | ★8。研图：研究主题 + 可追溯知识卡片。图谱簇 |
| `QuantumKuba/dsh-graphify-plugin` | A 原生DSH | MIT | 学习（代码理解） | 全新（图谱簇） | 🔵 | proposed | 2026-10-15 | ★8。原生 Graphify 知识图谱。图谱簇 |
| `tancheng33/dsh-ontology` | A 原生DSH | MIT | 知识建模 | 全新 | 🔵 | proposed | 2026-10-15 | ★16。**可推理本体**（TBox + ABox）；`dsh-ontology@0.1.0` 已核可锁版。与图谱簇相关但语义不同 |
| `sueccku/dsh-plugin-wps-office-next` | A 原生DSH | MIT | 文档操作 | 全新 | 🔵 | proposed | 2026-10-15 | ★13。中文对话操作 WPS 表格/文字/演示。**自带 MCP + 常驻 COM，Windows 依赖** |
| `Tianbuyu-wwx/DSH-FormatForge` | A 原生DSH | MIT | 文档解析 | 重复可强化（文档解析） | 🔵 | proposed | 2026-10-15 | ★10。拖入 30+ 格式转换。**Python** 技术栈 |
| `didclawapp-ai/DSH-Office` | A 原生DSH | MIT | 文档读写 | 全新 | 🔵 | proposed | 2026-10-15 | ★5。PPTX/DOCX/XLSX/PDF 读写编辑 |
| `loudMore/dsh-drop-to-path` | A 原生DSH | MIT | 笔记（附件） | 重复可强化（附件通路） | 🔵 | proposed | 2026-10-15 | ★11。图片与文件直达纯文本模型（附件栏 → 工作区路径）。与视觉簇配套 |
| `HaoyueQin/dsh-better-reasoning-effort` | A 原生DSH | MIT | 通用 | 全新（模型调参） | 🔵 | proposed | 2026-10-15 | ★53。逐模型推理强度设置；`dsh-better-reasoning-effort@0.5.3` 已核可锁版。**注意 GitHub 搜索存在大小写重复条目，去重需忽略大小写** |
| `PerryLink/dsh-plugin-guide` | A 原生DSH | Apache-2.0 | 通用（线索源） | 全新（开发线索源） | 🔵 | proposed | 2026-10-15 | ★48。DSH 插件开发知识库（10 章指南 + 脚手架 + 检查器） |
| `kaijia323/create-dsh-plugin` | 技能包 | MIT | 通用（线索源） | 全新 | 🔵 | proposed | 2026-10-15 | ★5。创建/开发/调试/打包 DSH 插件的 AI 技能 |
| `green-dalii/dsh-plugin-dev-skill` | 技能包 | MIT | 通用（线索源） | 全新 | 🔵 | proposed | 2026-10-15 | ★5。插件开发 skill（tool/adapter/service） |
| `TrueHOOHA/dsh-plugin-dev-skill` | 技能包 | Apache-2.0 | 通用（线索源） | 全新 | 🔵 | proposed | 2026-10-15 | ★2。Cordis 插件开发 skill |
| `gwsbhqt/dsh-insight` | A 原生DSH | MIT | 通用（可观测） | 全新 | 🔵 | proposed | 2026-10-15 | ★3。只读洞察面板：每个插件/服务来自哪里 |
| `Cerbur/clutch-dsh` | A 原生DSH | MIT | 通用（会话管理） | 全新 | 🔵 | proposed | 2026-10-15 | ★34。Git Worktree 会话管理。**会话管理域 DSH 自身已具备** |
| `KunoLu/sbtd-plugins` | A 原生DSH | Apache-2.0 | 通用（工作流） | 全新 | 🔵 | proposed | 2026-10-15 | ★190。SBTD host 插件（OMP + DSH）+ 共享工作流套件 |
| `xuanyuanzhifeng/dsh-plugin-agent-workflow` | A 原生DSH | MIT | 通用（工作流） | 全新 | 🔵 | proposed | 2026-10-15 | ★228。Agent 工作流 |
| `GZX2211/dsh-Visual-Workflow` | A 原生DSH | MIT | 通用（编排） | 全新 | 🔵 | proposed | 2026-10-15 | ★48。可视化 Agent 编排（Workflow/Multi-Agent/MCP/HITL）。**形态为独立编排平台**，与本仓面板不同路 |
| `KongFangXun/sofagent` | A 原生DSH | MIT | 通用（工作流） | 全新 | 🔵 | proposed | 2026-10-15 | ★52。FDE Harness |
| `omdsh-dev/dsh-deep-research` | A 原生DSH | MIT | 研究/论文 | 全新 | 🔵 | proposed | 2026-10-15 | ★28。自适应深度研究编排器（官方 workflow engine 之上） |
| `Cruciforms/dsh-socrates` | A 原生DSH | MIT | 研究 | 全新 | 🔵 | proposed | 2026-10-15 | ★2。苏格拉底式先澄清的深度研究 |
| `aiyacharley/dsh-pubmed` | A 原生DSH | Apache-2.0 | 论文/文献检索 | 重复可强化（文献簇） | 🔵 | proposed | 2026-10-15 | ★2。25 个工具覆盖 PubMed/Europe PMC/PubTator3；`dsh-pubmed@0.4.4` 已核可锁版。文献簇 |
| `niuniu-869/dsh-plugin-cas-kb` | A 原生DSH | MIT | —（会计） | 全新 | 🔵 | proposed | 2026-10-15 | ★1。中国会计准则与税法知识库。**域不符** |
| `xuboboo/dsh-grok-geo` | A 原生DSH | MIT | —（GEO） | 全新 | 🔵 | proposed | 2026-10-15 | ★3。GEO 品牌审计。**Python** + 域不符 |
| `Wang-JQ77/dsh-litresearch` | A 原生DSH | MIT | 论文/文献 | 重复可强化（文献簇） | 🔵 | proposed | 2026-10-15 | ★1。科学文献深度调研 MCP。**Python** + 体量过小 |
| `agents-group/dsh-design-plugin` | A 原生DSH | MIT | 通用（设计） | 全新 | 🔵 | proposed | 2026-10-15 | ★0。设计模式：25% 对话 + 75% iframe 预览 + 元素选择引用 |
| `FleetingEcho/dsh-powerdesk` | A 原生DSH | MIT | 通用（IDE） | 全新 | 🔵 | proposed | 2026-10-15 | ★2。DSH 的 IDE 工作台（WebGPU 终端 + CodeMirror 6）。体量过小 |
| `jingchangzhao-gif/dsh-note` | A 原生DSH | MIT | 笔记 | 重复可强化（笔记域） | 🔵 | proposed | 2026-10-15 | ★0。跨编辑器 AI 写作助手（长期文档上下文） |
| `Blaczz/dsh-achievements` | A 原生DSH | MIT | 通用（游戏化） | 全新 | 🔵 | proposed | 2026-10-15 | ★2。跨会话成就徽章 |
| `Ruler4396/dsh-launcher-lifetime` | A 原生DSH | MIT | 通用（服务生命周期） | 全新 | 🔵 | proposed | 2026-10-15 | ★2。控制 dsh 服务生命周期（常驻/托盘/跟随） |
| `andyfan1094/dsh-winrm` | A 原生DSH | Apache-2.0 | —（远程运维） | 全新 | 🔵 | proposed | 2026-10-15 | ★2。WinRM 远程 Windows 管理。**域不符** |
| `superfly/sprites-deepseek-plugin` | A 原生DSH | MIT | —（云开发） | 全新 | 🔵 | proposed | 2026-10-15 | ★6。Fly.io Sprites。**Python** + 域不符 |
| `KCNyu/clawock` | A 原生DSH | MIT | —（投资） | 全新 | 🔵 | proposed | 2026-10-15 | ★19。股票投资与组合决策工作流。**Python** + 域不符 |
| `dshbox/cordis-rs` | 其他 | MIT | 通用（基础设施） | 基础设施 | 🔵 | proposed | 2026-10-15 | ★59。Cordis 的 Rust 实现。**非 JS**，与 DSH 生态不同路 |
| `KannaKuron/dsh-ide-git` | A 原生DSH | MIT | 通用（IDE） | 全新 | 🔵 | proposed | 2026-10-15 | ★6。IDE 级 Git 工具窗（分支树）。体量过小 |
| `skyf0xx/hedgehog` | 其他 | MIT | 通用（开发工具） | 全新 | 🔵 | proposed | 2026-10-15 | ★45。AI 驱动开发构建器。形态为独立工具 |
| `mrpulor-gh/nuphus-mcp` | 其他 | MIT | 通用（桌面自动化） | 全新 | 🔵 | proposed | 2026-10-15 | ★326。桌面自动化 MCP server。**Rust**，非 JS 插件包；本仓无桌面自动化域 |
| `Soren-ABT/dsh-knowledge` | A 原生DSH | **AGPL-3.0** | — | — | ⛔ | rejected | 2026-10-15 | ★76。知识库 + RAG（分块/本地嵌入/混合检索）。**AGPL 红线** → 只登记不摘代码 |
| `OBdangshang07/DSH_Creative_Workshop` | A 原生DSH | MIT | 通用 | **重复且无增益**（插件页） | ⛔ | rejected | 2026-10-15 | ★57。Steam 工坊式发现/信任/图搜索/集合/交易式安装。**插件市场第 4 个候选**，与 `dsh-market`/`dsh-plugin-shop`/`DSH-Plugins-Marketplace` 互为重复无增益 |
| `springbrand-lab/dsh-skin-universe` | A 原生DSH | BSD-3-Clause | 通用 | **重复且无增益**（主题） | ⛔ | rejected | 2026-10-15 | ★7。主题 + Web GUI 插件（任务板/Git 图/文件面板/SSH）。主题域本仓已自建 |
| `miuzel/dsh-graph` | A 原生DSH | **无** | — | — | ⛔ | rejected | 2026-10-15 | ★18。目标看板插件。**无许可证** → 只登记；且属图谱簇非首选 |
| `sunshine-lang/dsh-plugins` | A 原生DSH | **无** | — | — | ⛔ | rejected | 2026-10-15 | ★5。插件门户合集（weather/pdf/…）。**无许可证** → 只登记 |
| `beancookie/dsh-plugin-anydoc` | A 原生DSH | **无** | — | — | ⛔ | rejected | 2026-10-15 | ★7。基于 `@firecrawl/anydoc` 的多格式转 GFM。**无许可证** → 只登记 |
| `staff-os/dsh-ragflow` | A 原生DSH | **无** | — | — | ⛔ | rejected | 2026-10-15 | ★2。RAGFlow 知识库检索。**无许可证** → 只登记 |
| `lodfather/dsh-workspace-alias` | A 原生DSH | **无** | — | — | ⛔ | rejected | 2026-10-15 | ★0。跨机会话分组同步。**无许可证** → 只登记 |
| `grelvan/dsh-ocr-local` | A 原生DSH | NOASSERTION | 论文（离线 OCR） | — | ⚠ 待核 | pending-license | 2026-10-15 | ★6。**完全离线的本地 OCR**（PP-OCRv5 + ONNX Runtime）。离线对本地化工作台价值高，**建议优先核 LICENSE** |
| `Adamaik/dsh-zcode-plugins` | A 原生DSH | NOASSERTION | 文档（PDF 等） | — | ⚠ 待核 | pending-license | 2026-10-15 | ★9。为 DSH 未内置的 ZCode 插件（PDF 等）提供非官方 bundle。许可证待核 |
| `dsh-plugins/dsh-loader` | A 原生DSH | NOASSERTION | 通用 | — | ⚠ 待核 | pending-license | 2026-10-15 | ★3。版本感知的第三方 Cordis 插件适配注册表。**与本仓「锁版挂载」思路同源**，值得核 |
| `walkinglabs/awesome-deepseek-harness-plugins` | 清单 | NOASSERTION | 通用（线索源） | 全新 | ⚠ 待核 | pending-license | 2026-10-15 | ★44。来源已验证的 DSH 插件目录。**作线索源**（与 `awesome-dsh-plugin`、`Blue-Whale-Harness` 并列），非代码借鉴风险低 |
| `EthanYoQ/AI-Novel-Writer` | A 原生DSH | GPL-3.0 | — | — | ⛔ | rejected | 2026-10-15 | ★1554。**已登记（去重确认）**，本轮 `dsh plugin rag`/`workflow` 再次命中。GPL 红线 |
| `HuanLinOTO/dsh-plugin-mineru` | A 原生DSH | NOASSERTION | 论文/笔记 | — | ⚠ 待核 | pending-license | 2026-10-15 | ★46。**已登记（去重确认）**，本轮 `dsh plugin pdf` 再次命中。功能最贴合，许可证待核 |
| `chen731215-dev/dsh-tavern-v2` | A 原生DSH | NOASSERTION | — | — | ⚠ 待核 | pending-license | 2026-10-15 | ★48。**已登记（去重确认）**，本轮 `dsh plugin graph` 再次命中 |
| `liustack/modlens` | A 原生DSH | MIT | 论文 | 重复可强化 | 🟢 | proposed | 2026-10-14 | ★4259（本轮回访确认星级）。**视觉簇首选**，簇内其余不取 |
| `Vncntvx/dsh-zotero` | A 原生DSH | MIT | 论文 | 重复可强化 | 🟡 | proposed | 2026-10-15 | 本轮 `dsh plugin pdf` 再次命中（去重确认）。**文献簇**：与 `Flan246/dsh-lit-search` 二选一 |
| `Anionex/dsh-vision-toolkit` | A 原生DSH | MIT | 论文 | 重复可强化 | 🟡 | proposed | 2026-10-15 | 本轮再次命中（去重确认）。视觉簇 |
| `zhaoxuejie/dsh-plugin-academic-paper` | A 原生DSH | MIT | 论文 | 重复可强化 | 🔵 | proposed | 2026-10-15 | 本轮再次命中（去重确认）。文献簇 |
| `EthanYoQ/AI-Novel-Writer`（重复行合并） | — | — | — | — | — | — | — | 见上方 GPL 行，此处不重复计数 |

## 2026-10-15 · A 组（DSH 插件生态 · **管理/治理面**）· 追加

> 关键词：`dsh plugin mcp`、`dsh plugin browser`、`dsh plugin image`、`dsh plugin classroom`、
> `dsh plugin exam`、`dsh plugin writing`、`dsh plugin chart`、`dsh plugin dashboard`、
> `dsh plugin ai tutor`。搜索 **9 次**（未超 ≤10 上限），API 无 403。
> 全部关键词均为**历史轮次从未使用过**的管理/治理面切片。原始命中 217 条（去重后），
> 与既有 registry（266 条）逐条 `owner/repo` 比对后剔除 165 条已登记项，**52 条为本轮新增**。
> 类型 A = 原生 DSH 插件包（`dsh.bundle.patch` 或 `dsh.client`，可锁版者已逐条 `npm view` 核实）/
> B 类本轮未产出（该切片天然聚焦 DSH 生态）。

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `bowenliang123/dsh-context` | A 原生DSH | Apache-2.0 | 通用（上下文治理） | 重复可强化（今天页·会话状态） | 🟢 | proposed | 2026-10-15 | ★2134，本仓 radar 历史**最高星**候选。`dsh-context@0.71.0` **已核可锁版**（Apache-2.0）。`bundle.patch` + `client.inject` **6 个 UI 分包**（含 sidebar-right/settings）→ **面板型、非纯 tool**。上下文**构成分解**（按来源归类）+ 逐会话预算；现有仅有「用了多少 token」一个粗粒度数字。补「事前可见」缺口。**已出骨架 `dsh-radar-context-dashboard`** |
| `yyh-001/DSH-X` | A 原生DSH | MIT | 通用（启动器） | 全新（宿主外围） | 🔵 | proposed | 2026-10-15 | ★693，2026-10-15 推送。轻量桌面启动器：启动项/多实例/版本/插件/MCP/技能管理。`npm view dsh-x` **E404**，包名待核（可能非 npm 分发）→ 不可锁版，只登记 |
| `0xsline/awesome-deepseek-harness` | 清单 | CC0-1.0 | 通用（线索源） | 全新（线索源） | 🔵 | proposed | 2026-10-15 | ★1180。DSH 生态精选清单（Python 仓库）。**作线索源**，与 `awesome-dsh-plugin`、`walkinglabs/awesome-deepseek-harness-plugins`、`Blue-Whale-Harness` 并列 |
| `hashgraph-online/awesome-ai-plugins` | 清单 | Apache-2.0 | 通用（线索源） | 全新（线索源） | 🔵 | proposed | 2026-10-15 | ★670。AI 助手插件精选（**跨生态**，非 DSH 专属）。线索源价值有限 |
| `vibeinging/dsh-desktop` | A 原生DSH | MIT | 通用（桌面端） | 全新（宿主外围） | 🔵 | proposed | 2026-10-15 | ★483。DSH 桌面应用（本地 AI 工作区）。形态为**完整宿主**，与本仓「profile 内嵌」不同路 |
| `Dominic789654/awesome-deepseek-harness` | 清单 | NOASSERTION | 通用（线索源） | 全新（线索源） | ⚠ 待核 | pending-license | 2026-10-15 | ★377。插件/技能/MCP/patch/orchestrator 清单。许可证待核，**作线索源风险低**，建议优先核 |
| `yyh-001/dsh-meme` | A 原生DSH | MIT | 通用（娱乐） | 全新 | 🔵 | proposed | 2026-10-15 | ★192。表情包插件（斗图/图库市场）。**与学习场景无关** |
| `Totoro-qaq/dsh-plugin-bridge` | A 原生DSH | MIT | 通用（会话迁移） | 全新（会话管理域） | 🔵 | proposed | 2026-10-15 | ★163。`dsh-plugin-bridge@0.4.4` **已核可锁版**。跨 preset 会话迁移（定式握手，原会话不动）。与本仓「多域会话」可能有用，但非学生场景刚需 |
| `ZSeven-W/dsh-crew` | A 原生DSH | MIT | 通用（多智能体） | 全新 | 🔵 | proposed | 2026-10-15 | ★163。从 Claude Code / Codex 派活给 DSH agent。**跨工具编排**，与本仓形态不同路 |
| `dickpy/dsh-imagegen` | A 原生DSH | Apache-2.0 | 论文（配图）/通用 | 全新（无生图层） | 🔵 | proposed | 2026-10-15 | ★116。Web GUI 文生图/图生图。本仓无生图域；论文配图或有用但非核心 |
| `wqty123/dsh-browser` | A 原生DSH | MIT | 通用（浏览器） | 全新（浏览器域） | 🔵 | proposed | 2026-10-15 | ★113。`dsh-browser@0.1.0` **已核可锁版**。共享真实浏览器插件。与 `dsh plugin browser` 关键词下其余条件相近者同属浏览器簇 |
| `YOU-SHOULD-KNOW-ME/antigrative-dashboard` | A 原生DSH | MIT | 通用（用量面板） | 重复可强化（用量域） | 🔵 | proposed | 2026-10-15 | ★111。内联仪表盘：tok/s、缓存命中率、五小时/周配额。**用量域**，簇内已取 `dsh-context`（★2134），本条保留线索 |
| `Tabbit-Browser/dsh-tabbit` | A 原生DSH | MIT | 通用（浏览器） | 全新（浏览器簇） | 🔵 | proposed | 2026-10-15 | ★107。Tabbit 浏览器插件。浏览器簇 |
| `Stormycry-cryp/dsh-AuthInOne` | A 原生DSH | MIT | 通用（登录/模型切换） | 全新 | 🔵 | proposed | 2026-10-15 | ★105，2026-08-15 后未更新。Provider/Auth 登录 + 模型切换一体化 |
| `Sanqi-normal/dsh-webui-market-plugin` | A 原生DSH | MIT | 通用（插件市场） | **重复且无增益**（插件页） | ⛔ | rejected | 2026-10-15 | ★104。社区插件市场（浏览 awesome-dsh-plugin.com 目录）。**插件市场第 5 个候选**，与 `dsh-market`/`dsh-plugin-shop`/`DSH-Plugins-Marketplace`/`DSH_Creative_Workshop` 互为重复无增益 |
| `kenz1117/dsh-ui-usage-billing` | A 原生DSH | MIT | 通用（用量计费） | 重复可强化（用量域） | 🔵 | proposed | 2026-10-15 | ★79，2026-10-15 推送。侧栏成本指标 + 真实用量。用量簇，同不取 |
| `yi-yezhiqiu/dsh-prompt-market` | A 原生DSH | MIT | 通用（提示词） | 全新 | 🔵 | proposed | 2026-10-15 | ★76。提示词市场（浏览/搜索/收藏，选中即写入输入框）。零后端、免构建、数据只存本机 |
| `dhicoc/dsh-chinese-traditional-wisdom-skill` | A 原生DSH | **无** | — | — | ⛔ | rejected | 2026-10-15 | ★55。玄学技能包（八字/紫微/六爻）。**无许可证** → 只登记；且域不符 |
| `xmutfyh/dsh-plugin-writing-guard` | A 原生DSH | MIT | 论文写作 | 重复可强化（论文页·写作纪律） | 🟡 | proposed | 2026-10-15 | ★46。科研写作与文档诚信守卫（论证经济性/去 AI 腔/守证据）。**论文页已有 `dsh-radar-better-markdown` 管呈现，本条管「写作纪律」，互补不重复**；且与 `dsh-radar-deep-read` 的产出环节可串联 |
| `LaplaceYoung/dsh-directorx` | A 原生DSH | Apache-2.0 | 通用（多模态） | 全新 | 🔵 | proposed | 2026-10-15 | ★35。视频/图像/音频技能 + 知识语料。**多模态创作**，非学生场景 |
| `huangziyuan-general/dsh-novel-forge` | A 原生DSH | MIT | 通用（长文写作） | 全新 | 🔵 | proposed | 2026-10-15 | ★19，2026-10-15 推送。长篇写作约束（细纲审批/设定校验/去 AI 味）。**小说域**，与本仓论文域不同 |
| `gongyijie85/mattpocock-skills-dsh` | 技能包 | MIT | 通用（线索源） | 全新（线索源） | 🔵 | proposed | 2026-10-15 | ★19。Matt Pocock 技能集（TypeScript 向）。**Shell 仓库**，技能包 |
| `ryubyte/dsh-a2a` | A 原生DSH | MIT | 通用（互操作） | 全新 | 🔵 | proposed | 2026-10-15 | ★13。A2A v1.0 双端插件（Client 发现远程 Agent / Server 暴露 JSON-RPC+SSE） |
| `Xenia0922/dsh-opencode-go-usage` | A 原生DSH | MIT | 通用（用量面板） | 重复可强化（用量域） | 🔵 | proposed | 2026-10-15 | ★11。`dsh-opencode-go-usage@1.4.1` **已核可锁版**。悬浮用量仪表盘（配额/逐请求成本/模型来源分布）。用量簇 |
| `EchoUser005/dsh-fate-spectrum` | A 原生DSH | MIT | —（玄学） | — | 🔵 | proposed | 2026-10-15 | ★10。离线确定性命盘。**域不符** |
| `HaoyanZhang123/dsh-plugin-control-your-development` | A 原生DSH | MIT | 通用（产品看板） | 全新 | 🔵 | proposed | 2026-10-15 | ★10。把 AI 开发进展变成产品仪表盘（skill + 右侧栏面板） |
| `Max-Samson/dsh-usage-chart` | A 原生DSH | MIT | 通用（用量面板） | 重复可强化（用量域） | 🔵 | proposed | 2026-10-15 | ★9。实时 token/成本/逐轮图表。用量簇 |
| `shiyan688/dsh-novel-craft` | A 原生DSH | MIT | 通用（小说） | 全新 | 🔵 | proposed | 2026-10-15 | ★8。反馈驱动的 AI 小说写作。**小说域** |
| `lxfu1/dsh-plugin-chart` | A 原生DSH | MIT | 通用（图表） | 重复可强化（图表域） | 🔵 | proposed | 2026-10-15 | ★8。内置 AntV 图表可视化技能 + 原生渲染。**图表簇**，与 `dsh-plugin-mermaid` 同域 |
| `YangShen-SWE/dsh-plugin-simple-pet` | A 原生DSH | NOASSERTION | — | — | ⚠ 待核 | pending-license | 2026-10-15 | ★7。Windows 桌宠 + 计费/配额。**PowerShell** + 域不符 + 许可证待核 |
| `xmutfyh/writing-guard-skill` | 技能包 | MIT | 论文写作 | 仅供参考 | 🔵 | proposed | 2026-10-15 | ★6。上条 writing-guard 的 CC/Codex 可执行版规则集。**与 `dsh-plugin-writing-guard` 同源**，取一即可 |
| `ddedook/dsh-novel` | A 原生DSH | MIT | 通用（小说） | 全新 | 🔵 | proposed | 2026-10-15 | ★5。工作区即一本小说（人物/世界观/大纲落本地）。小说簇 |
| `Physicolor/dsh-widgets` | A 原生DSH | MIT | 通用（组件） | 全新（基础设施） | 🔵 | proposed | 2026-10-15 | ★5，2026-10-14 推送。右侧栏自定义组件系统。**基础设施**，可作承载层线索 |
| `Monokuna-Hugo/dsh-kaoyan-english` | A 原生DSH | MIT | **考研英语** | 全新（考试域） | 🟡 | proposed | 2026-10-15 | ★4。考研英语阅读命题助手（抓取外刊 → 命题）。`npm view dsh-kaoyan-english` **E404** → **不可锁版**，须源码级移植。**考试域**，与 `dsh-zhiyun-final-pass` 同属备考但内容不同 |
| `lj970926/dsh-plugin-mermaid` | A 原生DSH | MIT | 通用（图表） | 重复可强化（图表域） | 🔵 | proposed | 2026-10-15 | ★4。mermaid 代码块渲染（chart/source 切换）。**与 `dsh-radar-better-markdown` 的 Mermaid 能力重复**，取一即可 |
| `tianyagk/dsh-tradewatcher` | A 原生DSH | MIT | —（盯盘） | — | 🔵 | proposed | 2026-10-15 | ★4。行情侧栏面板。**域不符** |
| `c-ling/dsh-plugin-goldboard` | A 原生DSH | MIT | —（黄金） | — | 🔵 | proposed | 2026-10-15 | ★4。黄金行情看板。**域不符** |
| `1-CellBio/dsh-okf` | A 原生DSH | **无** | 论文（引用库） | — | ⛔ | rejected | 2026-10-15 | ★3。研究 PDF → 可引用 markdown 库。**无许可证** → 只登记；功能与 `dsh-radar-deep-read` 相近，本也无增益空间 |
| `Aampidy/dsh-mcmp` | A 原生DSH | MIT | 竞赛（数模） | 全新（竞赛域） | 🔵 | proposed | 2026-10-15 | ★3。数学建模竞赛论文全自动流水线。**竞赛域**，本仓无此面板 |
| `cute-baobao/dsh-usage-meter` | A 原生DSH | MIT | 通用（用量） | 重复可强化（用量域） | 🔵 | proposed | 2026-10-15 | ★3。逐模型逐小时 token 记录。用量簇 |
| `junwei529/work-charter-dsh` | A 原生DSH | MIT | 通用（策略） | 全新 | 🔵 | proposed | 2026-10-15 | ★2。Work Charter 策略插件（session-coordinator 支撑） |
| `zerro-223/dsh-token-usage` | A 原生DSH | MIT | 通用（用量） | 重复可强化（用量域） | 🔵 | proposed | 2026-10-15 | ★2。逐请求 token 统计 Web UI。用量簇 |
| `tanzhangjia/dsh-plugins-examples` | A 原生DSH | MIT | 通用（开发线索源） | 全新（线索源） | 🔵 | proposed | 2026-10-15 | ★1。本地插件开发示例。**开发线索源** |
| `kapelame/deepseek-harness-leetcode` | A 原生DSH | MIT | **刷题** | 全新（刷题域） | 🟡 | proposed | 2026-10-15 | ★1，2026-10-15 推送。LeetCode Hot 100：讲义 + 沙箱判题 + AI 导师 + 间隔复习。`npm view deepseek-harness-leetcode` **E404** → **不可锁版**，须源码级移植。**与 `dsh-zhiyun-quiz` 同属刷题但题库不同**，且自带间隔复习（与 `dsh-radar-fsrs-scheduler` 重叠需协调） |
| `zengqingsong/dsh-classroom-plugin` | A 原生DSH | MIT | 课堂 | 全新（课堂域） | 🔵 | proposed | 2026-10-15 | ★0。无 description。与 `dsh-zhiyun-classroom` 同域但信息不足，**无法判断是否重复** |
| `yuanstarstar/dsh-bit-login` | A 原生DSH | MIT | 校园网 | 仅供参考 | 🔵 | proposed | 2026-10-15 | ★0。北理工校园网（Srun）登录 + 成绩/课表。**非浙大**，但 Srun 认证流程可借鉴（本仓已有 `dsh-zhiyun-net-proxy`） |
| `Elion-Wang/class-help` | A 原生DSH | MIT | **课堂笔记** | 重复可强化（课堂/笔记域） | 🟡 | proposed | 2026-10-15 | ★0。课堂 AI 助手：**实时录音 + 本地转录（sensevoice）** → 经授权整理成笔记并归入课程目录 + 作业助教。`npm view class-help` **E404** → **不可锁版**，须源码级移植。**与 `dsh-zhiyun-classroom`/`dsh-zhiyun-lecture` 同域**，但「实时转录 → 课程目录」这一段本仓空白，**强化式集成候选** |
| `hopefullstack-collab/dsh-plugin-company-example` | A 原生DSH | MIT | 通用（示例） | 全新（示例） | 🔵 | proposed | 2026-10-15 | ★0。企业插件示例（SSO + Settings hub）。**示例代码** |
| `BotHarness/dsh-companion-example` | A 原生DSH | MIT | 通用（示例） | 全新（示例） | 🔵 | proposed | 2026-10-15 | ★0。最小 bundle 示例（host Service + Cordis 事件 + client Slot）。**开发线索源** |
| `joao-paulo-santos/dsh-bouncing-squares-example` | A 原生DSH | MIT | 通用（示例） | 全新（示例） | 🔵 | proposed | 2026-10-15 | ★0。`dsh-granular-settings` 示例。**示例代码** |
| `haozheou/dsh-exam-expert` | A 原生DSH | **无** | 考试（出题） | — | ⛔ | rejected | 2026-10-15 | ★0。出题流水线（角色+目录→通读→看板）。**无许可证** → 只登记；且 ★0 体量过小 |
| `casteadelqui/dsh-go` | A 原生DSH | MIT | —（围棋） | — | 🔵 | proposed | 2026-10-15 | ★0。可玩围棋面板。**域不符** |

---

## 2026-10-15 · 第七轮（A 组 · **插件开发/调试工具链 + Agent 编排**切片）

> **本轮来源**：`node scripts/radar-rotation.mjs --today 2026-10-15` 判 `same-day(exhausted)`
> （当日三组均已跑过、A 组已 4 次）。按规则 2 的 `exhausted` 分支语义，**不重复任何已跑关键词**，
> 改跑**全新正交切片**：`dsh plugin sdk`、`dsh skill marketplace`、`deepseek-harness agent
> orchestration`、`dsh plugin developer toolchain`、`dsh plugin debugging`。
>
> 搜索 **5 次**（未超 ≤10 上限），API 无 403。原始命中 77 条（`owner/repo` 去重后），
> 与既有 registry（318 条）逐条比对后**全部为本轮新增**。
>
> **切片价值**：本轮首次系统触及**「插件开发/调试工具链」**这一能力域（前六轮聚焦
> RAG/OCR/PDF/论文/UI/管理面，从未覆盖）。该切片**产出密度高于上一轮治理面**
> （77 条中 🟢 1 / 🟡 3 / 🔵 等，治理面 52 条中 🔵 占 73%）。
> 类型 A = 原生 DSH 插件包；B 类本轮未产出（该切片天然聚焦 DSH 生态）。

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `gordonlu/dsh-context-lens` | A 原生DSH | MIT | 通用（插件治理/成本） | **重复可强化**（插件页） | 🟢 | proposed | 2026-10-15 | **本轮唯一 🟢，已出骨架 `dsh-radar-context-lens`**。★0 但 npm `dsh-context-lens@0.3.1` **已核可锁版**。请求上下文剖析器：按**插件归因**的 token 占比 + KV cache 分账 + 相邻请求增删。**强化式集成三条件全中**：仍是插件页同一个面板 + 功能正交（依赖关系 vs 上下文成本）+ 底层多调更优实现。插件页 README 自述「只读依赖事实、不解析源码」→ 成本视角**结构性缺失**。⚠ 上游自述 WIP、token 占比为**估算**非计费真值 |
| `KinomotoMio/dsh-context-lens` | A 原生DSH | MIT | 通用（上下文可观测） | 重复可强化（插件页） | 🟡 | proposed | 2026-10-15 | ★5。同名不同仓（另一作者）。「See what every plugin puts into the model」+ **Reader 有序视图** + 归因接口。`npm view @kinomotomio/dsh-context-lens` **E404 未发布** → **不可锁版**，须源码级移植。功能较 `gordonlu` 版**更完整**（含 Agent 可调接口）但成熟度同样 WIP。**两版同域，建议取一**；`gordonlu` 版可锁版故优先 |
| `FeatherHunter/dsh-plugin-ui-debug` | A 原生DSH | **BSD-3-Clause** | 通用（UI 调试） | 全新（插件开发域） | 🟡 | proposed | 2026-10-15 | ★7。**让 AI 在真实 Chrome 中看界面/点按钮/拖组件**（Playwright + CDP）。本仓有 `dsh-plugin-ui-debug` 所辖的**空白**：现有测试是 `node --test` 单测，**没有真实浏览器驱动的 UI 验证**。`npm view` 待核 → 若无包则源码级移植 |
| `hinayoung23/dsh-cordis-plugin-kit` | A 原生DSH | MIT | 通用（插件开发） | 全新（插件开发域） | 🟡 | proposed | 2026-10-15 | ★2。**离线** Cordis/DSH 插件标准 + 脚手架 + 静态检查 + 运行时调试 + 性能门禁。⚠ **与本仓 `scripts/` 已有部分重叠**（`check-css-order.mjs`/`parser-verify.mjs`/`profile.mjs`）：需先比对再决定，重叠部分应**取优不叠加** |
| `CkEFFAF/dsh-plugin-devkit` | A 原生DSH | MIT | 通用（插件开发） | 全新（插件开发域） | 🔵 | proposed | 2026-10-15 | ★1。运行时 inspector（`/debug`）+ 隔离 debug-boot + **无浏览器**的宿主契约测试 + client slot 预览。与上条 `cordis-plugin-kit` 同域，**「无浏览器宿主契约测试」**对本仓 `scripts/test-host.mjs` 有借鉴价值 |
| `0718lol/dsh-forge` | A 原生DSH | MIT | 通用（插件开发） | 全新（插件开发域） | 🔵 | proposed | 2026-10-15 | ★0。插件开发者工具链：scaffold / compat-test / ship。该切片第三个工具链候选，**信息量最低**（★0、无 topics） |
| `toolclub/dsh-agent-team-gui` | A 原生DSH | MIT | 通用（多智能体） | 全新（编排域） | 🔵 | proposed | 2026-10-15 | ★287，2026-10-12 推送，**本轮最高星**。持久化多模型工作流团队：动态 lead 规划 + 有界 DAG + 逐 agent 模型/工具 + Run Center + Token 洞察。**整页型编排面板**，与本仓「多页面工作台」形态不同路；但其 **Token 洞察**与 `dsh-context-lens` 同域 |
| `kukucaiCndy/Corum-Harness` | A 原生DSH | Apache-2.0 | 通用（桌面端） | 全新（宿主外围） | 🔵 | proposed | 2026-10-15 | ★76，2026-10-15 推送。基于 DSH 底座的**桌面版 Agent** + IDE 功能补全。形态为完整宿主，同 `dsh-desktop` 一类 |
| `huaweicloud/huaweicloud-devkit` | 技能包 | Apache-2.0 | —（云服务） | — | 🔵 | proposed | 2026-10-15 | ★66。华为云官方 AI agent 插件（skills + MCP + 安全护栏）。**域不符**，但与 DSH 无关的官方 devkit，仅登记 |
| `zenx0x/allinluna` | A 原生DSH | Apache-2.0 | 通用（多智能体） | 全新（编排域） | 🔵 | proposed | 2026-10-15 | ★63。资源感知多智能体编排（Codex + DSH 双端）。编排域 |
| `rootkiller6788/dsh-flow` | A 原生DSH | MIT | 通用（编排） | 全新（编排域） | 🔵 | proposed | 2026-10-15 | ★34。插件化微内核架构，用于构建/编排/扩展。**基础设施型**，可作承载层线索 |
| `olicesx/kixparadigm` | A 原生DSH | MIT | 通用（编排） | 全新（编排域） | 🔵 | proposed | 2026-10-15 | ★30。AI 自编排极简范式（常驻认知层）。编排域 |
| `chumingjun/dsh-harness-one` | A 原生DSH | MIT | 通用（编排） | 全新（编排域） | 🔵 | proposed | 2026-10-15 | ★26。可视化 AI 工作流编排器：多智能体 DAG。编排域 |
| `Wenaixi/dsh-superpower` | A 原生DSH | MIT | 通用（工程技能） | 全新（技能域） | 🔵 | proposed | 2026-10-15 | ★24。移植 obra/superpowers 的 **15 个工程技能**（双语描述）。技能包，与本仓开发流程或有交集 |
| `PerryLink/dsh-skill-pack-security` | A 原生DSH | Apache-2.0 | 通用（安全） | 全新（安全域） | 🔵 | proposed | 2026-10-15 | ★22。安全审计技能包 + **`plugin_vet` 供应链门禁**。⚠ 与雷达自身的「污染防护/信息泄露检查」思路同源，**可作本任务的工具线索** |
| `StvLi/dsh-ros2` | A 原生DSH | MIT | —（机器人） | — | 🔵 | proposed | 2026-10-15 | ★22。ROS 2 诊断插件。**域不符** |
| `CodermanYHZ/dsh-node-flow` | A 原生DSH | MIT | 通用（编排） | 全新（编排域） | 🔵 | proposed | 2026-10-15 | ★11。节点式工作流画布（子代理/条件/循环/定时）。编排域 |
| `hoyyang/dsh-mall` | A 原生DSH | MIT | 通用（插件市场） | **重复且无增益**（插件页） | ⛔ | rejected | 2026-10-15 | ★10。插件商场（AI 装前审查/装后诊断 + 五维评分雷达）。**插件市场第 6 个候选**，与 `dsh-market`/`dsh-plugin-shop`/`DSH-Plugins-Marketplace` 等互为重复 → ⛔。**但「AI 装前审查 + 装后诊断」这一能力本身是本仓插件页的真缺口**，见报告「值得单独摘出的一点」 |
| `peiqi10086/dsh-skills-market` | A 原生DSH | MIT | 通用（技能市场） | 重复且无增益（技能市场簇） | 🔵 | proposed | 2026-10-15 | ★9。本地 skills 管理 + SkillHub 商城。**技能市场簇**，本簇本轮命中 10+ 条，同质化严重 |
| `whutzefengxie-ops/dsh-shadow-mind` | A 原生DSH | MIT | 通用（编排） | 全新（编排域） | 🔵 | proposed | 2026-10-15 | ★9。独立 Shadow agent 编排。编排域 |
| `pn1024/dsh-skill-market` | A 原生DSH | MIT | 通用（技能市场） | 重复且无增益（技能市场簇） | 🔵 | proposed | 2026-10-15 | ★7。技能市场（SkillHub + ClawHub）。技能市场簇 |
| `TindalosKorone/dsh-cheatengine` | A 原生DSH | MIT | 通用（调试） | 全新（调试域） | 🔵 | proposed | 2026-10-15 | ★7。桥接 Cheat Engine 做动态调试。**宿主外围型**，域偏 |
| `CocoSgt/dsh-inspector` | A 原生DSH | **无** | 通用（调试） | — | ⛔ | rejected | 2026-10-15 | ★6。**无许可证** → 只登记，不采用 |
| `yangbobo2021/relay-dsh-plugin-claude` | A 原生DSH | MIT | 通用（互操作） | 全新（互操作域） | 🔵 | proposed | 2026-10-15 | ★6。Claude Code 集成插件。跨工具互操作 |
| `Luck9Star/dsh-gateway-provider` | A 原生DSH | MIT | 通用（模型网关） | 全新（模型层） | 🔵 | proposed | 2026-10-15 | ★5。通用 LLM 网关 provider（newapi / LiteLLM）。模型接入层 |
| `huabai-flowerwhite/dsh-plugin-design` | A 原生DSH | MIT | 通用（插件规范） | 全新（插件开发域） | 🔵 | proposed | 2026-10-15 | ★5。发现/检查第三方插件并对照 **DH-TP-S** 规范。**插件治理规范**，与 `dsh-plugin-devkit` 同域互补 |
| `YYTbit/oh-my-deepseek-harness` | A 原生DSH | MIT | 通用（编排） | 全新（编排域） | 🔵 | proposed | 2026-10-15 | ★5。多智能体编排。编排域 |
| `37chengshan/agent-mcp` | 技能包 | MIT | —（MCP） | — | 🔵 | proposed | 2026-10-15 | ★5。无 description，信息不足 |
| `wz-heng/dsh-feishu-bridge` | A 原生DSH | MIT | —（飞书） | — | 🔵 | proposed | 2026-10-15 | ★4。飞书频道桥（fail-closed 设计）。**域不符**，但 fail-closed 设计可借鉴 |
| `Jan-Jianhao-Liu/omo-deepseek-harness` | A 原生DSH | CC0-1.0 | 通用（编排） | 全新（编排域） | 🔵 | proposed | 2026-10-15 | ★4。OMO 规约智能体 + 超任务编排（不间断规划/分类委派/自主校验）。编排域 |
| `ZSeven-W/dsh-qa` | A 原生DSH | MIT | 通用（QA） | 全新（测试域） | 🔵 | proposed | 2026-10-15 | ★4。**Agent 像真实用户一样探索你的应用**做 QA。⚠ 与本仓 `tests/` 和 `scripts/shots.mjs` 有交集，**「像用户一样探索」是现有单测覆盖不到的一层**，值得留意 |
| `dushaobindoudou/dsh-bots` | A 原生DSH | MIT | 通用（编排） | 全新（编排域） | 🔵 | proposed | 2026-10-15 | ★3。Bots 工作台，桥接 sdk-bots 编排网关。编排域 |
| `cxdyun/dsh-skills-marketplace` | A 原生DSH | MIT | 通用（技能市场） | 重复且无增益（技能市场簇） | 🔵 | proposed | 2026-10-15 | ★3。类 CodeX 插件市场。技能市场簇 |
| `open-dshai/dsh-employee` | A 原生DSH | MIT | 通用（数字员工） | 全新（市场簇） | 🔵 | proposed | 2026-10-15 | ★3。数字员工市场面板。市场簇变体 |
| `stephenlzc/dsh-swarm-panel` | A 原生DSH | **无** | 通用（编排） | — | ⛔ | rejected | 2026-10-15 | ★3。会话流可观测 + 持久多智能体编排。**无许可证** → 只登记 |
| `KanoNoUta/dsh-captain` | A 原生DSH | MIT | 通用（编排） | 全新（编排域） | 🔵 | proposed | 2026-10-15 | ★3。GPT 规划 + DeepSeek 执行 + 独立校验。编排域 |
| `Jarad-z/dsh-goalmesh` | A 原生DSH | MIT | 通用（编排） | 全新（编排域） | 🔵 | proposed | 2026-10-15 | ★3。目标驱动多智能体编排（有界 DAG 调度）。编排域 |
| `daybreak33167-commits/dsh-subscriptions` | A 原生DSH | **无** | — | — | ⛔ | rejected | 2026-10-15 | ★2。驱动 Cursor 模型。**无许可证** → 只登记 |
| `akira399/dsh-plugin-publisher` | A 原生DSH | MIT | 通用（插件发布） | 全新（插件开发域） | 🔵 | proposed | 2026-10-15 | ★2。插件开发与 GitHub 发布工作流（consent-gated）。插件开发域 |
| `xsoc1/math-research-dsh` | 技能包 | MIT | 论文（数学） | 全新（科研域） | 🔵 | proposed | 2026-10-15 | ★2。math-research 的市场化 SKU（严谨开放式数学）。科研域 |
| `a554878526/dsh-debug-mode` | A 原生DSH | MIT | 通用（调试） | 全新（调试域） | 🔵 | proposed | 2026-10-15 | ★2。runtime-first 调试模式。调试域 |
| `lukaiwuyi/dsh-frontend-tools` | A 原生DSH | MIT | 通用（前端桥接） | 全新（基础设施） | 🔵 | proposed | 2026-10-15 | ★1。DSH 插件 + client SDK：把 web/Electron/Tauri 接到 DSH。**基础设施**，可作承载层线索 |
| `guyuefangyuanl/Deeperian` | A 原生DSH | MIT | 笔记 | 全新（笔记域） | 🔵 | proposed | 2026-10-15 | ★1。Obsidian 插件内嵌 DSH agent（WIP）。⚠ 与本仓 `dsh-zhiyun-notes` **域重叠但形态不同**（外部编辑器 vs 本仓内建） |
| `2026heshao/dsh-armory` | A 原生DSH | MIT | 通用（管理面板） | 重复可强化（管理面） | 🔵 | proposed | 2026-10-15 | ★1，2026-10-14 推送。MCP 管理 + Skills + WorkBuddy 专家 一体板。**管理面簇**，同不取 |
| `win4r/dsh-plugin-skill` | 技能包 | **无** | 通用（开发） | — | ⛔ | rejected | 2026-10-15 | ★1。插件脚手架/调试技能。**无许可证** → 只登记 |
| `shine-233/dsh-plugin-debug` | A 原生DSH | MIT | 通用（调试） | 全新（调试域） | 🔵 | proposed | 2026-10-15 | ★1。crash guard + 事故取证 + trace 分析。**PowerShell**，平台受限 |
| `lemonmmice/dsh-postman` | A 原生DSH | Apache-2.0 | 通用（API 调试） | 全新（调试域） | 🔵 | proposed | 2026-10-15 | ★1。Postman 风格 API 调试面板。调试域。⚠ 本仓有 `/api/zhiyun-*` 路由，或有用 |
| `nemosr/dsh-personal-plugins` | A 原生DSH | MIT | 通用（浏览器测试） | 全新（测试域） | 🔵 | proposed | 2026-10-15 | ★1。个人插件集：web_app_testing + host-web-debugger。测试域 |
| `cybtachyon/dsh-plugin-degen-investigator` | A 原生DSH | MIT | 通用（调试） | 全新（调试域） | 🔵 | proposed | 2026-10-15 | ★1。监视运行中 agent、检测**重复工具调用**。⚠ 与雷达自身「关键词重复」问题同族，思路可借鉴 |
| `zhaoxuejie/dsh-plugin-session-export` | A 原生DSH | MIT | 通用（会话复盘） | 重复可强化（会话导出） | 🔵 | proposed | 2026-10-15 | ★1。会话黑匣子：旁路采集事件 → 导出 Markdown/HTML 复盘。与既有 `bwndlct/dsh-session-export` 同域，取一即可 |
| `xingyingyuzhui/dsh-vision-bench` | A 原生DSH | MIT | —（嵌入式） | — | 🔵 | proposed | 2026-10-15 | ★1。Keil 调试 + Modbus HMI。**域不符** |
| `zerosloney/dsh-debugger-dap` | A 原生DSH | **无** | 通用（调试） | — | ⛔ | rejected | 2026-10-15 | ★1。交互式 DAP 调试器。**无许可证** → 只登记 |
| `weekitmo/dsh-trace` | A 原生DSH | MIT | 通用（调试） | 全新（调试域） | 🔵 | proposed | 2026-10-15 | ★1。检查脱敏后的 LLM HTTP 请求/响应。⚠ **与本仓 `dsh-zhiyun-net-proxy` 的中继思路有交集**（都在看出口流量），可作观测层线索 |
| `floydc-sz/dsh-serial-debugger` | A 原生DSH | MIT | —（串口） | — | 🔵 | proposed | 2026-10-15 | ★1。串口调试。**域不符** |
| `Gladdonilli/dsh-cursor-sdk` | A 原生DSH | MIT | 通用（模型接入） | 全新（模型层） | 🔵 | proposed | 2026-10-15 | ★0。官方 Cursor SDK provider。模型接入层 |
| `salathleizhang/dsh-agent-sdk` | A 原生DSH | MIT | 通用（SDK） | 全新（基础设施） | 🔵 | proposed | 2026-10-15 | ★0。可嵌入的插件式编码 agent 运行时。基础设施 |
| `Lgv-H/dsh-maibot-plugin-writer` | A 原生DSH | MIT | —（麦麦） | — | 🔵 | proposed | 2026-10-15 | ★0。让 DSH 自己写/校验/安装麦麦插件。**域不符** |
| `lovedheart/dsh-tool-browser` | A 原生DSH | **无** | 通用（浏览器） | — | ⛔ | rejected | 2026-10-15 | ★0。有状态浏览器工具（Playwright/CDP）。**无许可证** → 只登记；浏览器簇亦已饱和 |
| `orangeofcarl0-sys/palimpsest` | A 原生DSH | MIT | 通用（编排） | 全新（编排域） | 🔵 | proposed | 2026-10-15 | ★0，2026-10-14 推送。证据治理的多智能体编排。编排域 |
| `oneinitAI/dsh-settings-plus-demo` | A 原生DSH | **无** | 通用（示例） | — | ⛔ | rejected | 2026-10-15 | ★0。`dsh-settings-plus` 注册 SDK 示例。**无许可证** → 只登记 |
| `TsukiNullNeko/dsh-ui-tool-mode` | A 原生DSH | MIT | 通用（UI） | 全新（UI 域） | 🔵 | proposed | 2026-10-15 | ★0。一个头部按钮切换原生 tool schema。小工具 |
| `Timeflys2018/knowme-dsh-bridge` | A 原生DSH | MIT | 通用（互操作） | 全新（互操作域） | 🔵 | proposed | 2026-10-15 | ★0。B3-small 线桥 cordis 插件（交互控制方法）。互操作层 |
| `wat-bill/dsh-chm2docs` | A 原生DSH | NOASSERTION | —（文档转换） | — | ⚠ 待核 | pending-license | 2026-10-15 | ★0。Windows `.chm` → 文档（SDK 手册）。**许可证待核**；域偏 |
| `TheFengyuye/tracelens` | A 原生DSH | MIT | 通用（可观测） | 全新（可观测域） | 🔵 | proposed | 2026-10-15 | ★0。LLM & Agent 可观测：trace / replay / analyze。⚠ **与 `dsh-context-lens` 同域**，但偏 trace/replay 而非按插件归因，**同域取优** |
| `Nuomc/dsh-skills-marketplace` | A 原生DSH | **无** | 通用（技能市场） | — | ⛔ | rejected | 2026-10-15 | ★0。技能市场。**无许可证** → 只登记；技能市场簇 |
| `w2112515/dsh-marketplace-publish` | 技能包 | MIT | 通用（发布） | 仅供参考 | 🔵 | proposed | 2026-10-15 | ★0。插件市场上架用 portable skill。**发布流程线索** |
| `QT7-C23/DSH-Marketplace` | A 原生DSH | MIT | 通用（市场） | 重复且无增益（插件页） | ⛔ | rejected | 2026-10-15 | ★0。社区市场 + 资源管理器。**插件市场第 7 个候选** → ⛔ |
| `S-AN-Shu/dsh-skill-manager` | A 原生DSH | MIT | 通用（技能管理） | 重复且无增益（技能市场簇） | 🔵 | proposed | 2026-10-15 | ★0。安全受限的技能管理 + GitHub 市场。技能市场簇 |
| `Aidea-cc/dsh-skill-hub` | A 原生DSH | MIT | 通用（技能市场） | 重复且无增益（技能市场簇） | 🔵 | proposed | 2026-10-15 | ★0。与 `pn1024/dsh-skill-market` **描述逐字相同**（SkillHub + ClawHub + sidebar）。疑似同源，取一 |
| `Asher191919/dsh-skills-hub` | A 原生DSH | **无** | 通用（技能市场） | — | ⛔ | rejected | 2026-10-15 | ★0。技能市场面板。**无许可证** → 只登记 |
| `JACKWang19559/dsh-skill-hub` | A 原生DSH | MIT | 通用（技能市场） | 重复且无增益（技能市场簇） | 🔵 | proposed | 2026-10-15 | ★0。桌面版 Skills 管理面板。技能市场簇 |
| `wzn16/dsh-skill-market` | A 原生DSH | MIT | 通用（技能市场） | 重复且无增益（技能市场簇） | 🔵 | proposed | 2026-10-15 | ★0，2026-10-15 推送。可视化技能商店。技能市场簇 |
| `CaseyTso/dsh-plugin-market` | A 原生DSH | **AGPL-3.0** | 通用（市场） | — | ⛔ | rejected | 2026-10-15 | ★0。双源市场。**AGPL-3.0 非宽松白名单** → 只登记，**不得摘取任何代码** |
| `chenyuyu6666/aiknowledge-skills` | 技能包 | **无** | — | — | ⛔ | rejected | 2026-10-15 | ★0。AIWorkspace 统一技能库（跨生态）。**无许可证** → 只登记 |
| `CleverC2200/dsh-agent-manage` | A 原生DSH | MIT | 通用（市场） | 重复且无增益（插件页） | ⛔ | rejected | 2026-10-15 | ★0，2026-10-15 推送。插件市场：安装注入 Claude Code/Codex 插件。**插件市场簇** → ⛔ |
| `Friend-Xu/dsh-install` | A 原生DSH | MIT | 通用（安装管理） | 重复且无增益（插件页） | ⛔ | rejected | 2026-10-15 | ★0。MCP + 技能安装管理。**插件页已自建** → ⛔ |
| `Alex-Yanggg/awesome-DSH-plugin` | 清单 | CC0-1.0 | 通用（线索源） | 全新（线索源） | 🔵 | proposed | 2026-10-15 | ★101。DSH 插件精选清单（第 **5** 个 awesome 清单）。**作线索源**，不单独集成 |

---

## 2026-10-15 · 第八轮（A 组 · **宿主外壳 / 运维 / 安全审计**切片）

> 关键词：`dsh plugin mobile app`、`dsh plugin desktop app`、`dsh plugin health check`、
> `dsh plugin system monitor`、`dsh plugin notification push`、`dsh plugin performance benchmark`、
> `dsh plugin error tracking`、`dsh plugin log analyzer`、`dsh plugin cost usage`、
> `dsh plugin permission audit`（**10 次调用，达 ≤10 上限**）。
> API 状态：✅ 无 403（开跑时 search 剩余 30/30）。
> 去重基线：registry 396 条已登记项；本轮去重后 **81 条新增**（88 条去重候选，剔除撞词 1 条，其余为已登记）。
>
> 许可证分布（新增 81 条）：**宽名单 72 ｜ NOASSERTION 1 ｜ 无许可证 8 ｜ 红线 0**。
>
> ⚠ **本轮采用「簇登记」以抑制膨胀**：用量/成本簇（22 条）与桌面外壳簇（17 条）
> 高度同质，**折叠为分组行**而非逐条登记，详见文末说明。

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `vibeinging/dsh-desktop` | A 原生DSH | MIT | 通用（宿主外壳） | 全新 | 🔵 | proposed | 2026-10-15 | ★483，2026-10-14 推送，**在维护**。Electron 桌面工作区（Sessions/项目/文件/联网研究）。功能面远超本仓需要，形态为独立应用而非插件集，仅线索 |
| `Clarklevis1995/dsh-plugin-mobile-gateway` | A 原生DSH | MIT | 通用（移动接入） | 全新 | 🟡 | proposed | 2026-10-15 | ★78，2026-10-13 推送。WebSocket 网关让同网段移动端接入（npm 0.10.1 可锁版，带 dsh.client）。⚠ 需强安全评审：本仓目前是本地单机形态 |
| `PolinniZhong/dsh-personal-center` | A 原生DSH | MIT | 通用（个人面板） | 重复可强化（个人页） | 🟡 | proposed | 2026-10-15 | ★118，npm 1.1.2 可锁版。Token 用量统计/成本估算/自定义指令/全局字号/桌面宠物。⚠ 与「个人」页偏好设置+「用量」域重叠，**取其一即止**（本轮用量簇共 22 条） |
| `kenz1117/dsh-ui-usage-billing` | A 原生DSH | MIT | 通用（用量面板） | 重复且无增益（用量簇） | 🔵 | proposed | 2026-10-15 | ★79，2026-10-15 推送。侧栏成本指标 + 从会话聚合真实用量。用量簇内取一即可 |
| `jkrandom-sudo/dsh-plugin-audit` | A 原生DSH | MIT | 通用（插件安全） | 重复可强化（插件页） | 🟢 | proposed | 2026-10-15 | ★4，MIT，npm 0.1.4 可锁版。**插件静态权限画像（带文件/行号证据）+ 运行时哨兵**。本仓插件页**无任何**权限扫描能力 → 已出骨架 `dsh-radar-plugin-audit`。⚠ 哨兵建议默认关闭 |
| `rogerdigital/dsh-vet` | A 原生DSH | MIT | 通用（插件安全） | 重复可强化（插件页） | 🟡 | proposed | 2026-10-15 | ★2，MIT，但 npm 的 `dsh` 字段为 `{seams:[fs,shell,web]}` **非 `bundle.patch` 形状** → 不能直接锁版挂载。装前审查 + 供应链审计，带 `dsh-vet/v1` 报告标准 |
| `Evhye38496/dsh-perfscope` | A 原生DSH | MIT | 通用（插件体检） | 重复且无增益（审计簇） | 🔵 | proposed | 2026-10-15 | ★2，MIT，npm 0.1.1 可锁版。一键健康检查打分 Scan→Score→Fix→Share。⚠ 与 `dsh-plugin-audit` **同簇**，审计簇取一即可 |
| `LeslieWylie/dsh-fleet-audit` | A 原生DSH | MIT | 通用（凭据卫生） | 全新（安全域） | 🔵 | proposed | 2026-10-15 | ★1，MIT。只读、零依赖、确定性：检查凭据文件权限、内嵌 git-remote 凭据（脱敏）、provider token 字面量。**与插件审计不同轴**（查的是机器上的凭据暴露面） |
| `C6Lactide/dsh-plugin-doctor` | A 原生DSH | MIT | 通用（插件体检） | 重复且无增益（审计簇） | 🔵 | proposed | 2026-10-15 | ★0，MIT。检查 patch 层 YAML、include 形式、双份拷贝一致性。⚠ 与 `coderfu123/dsh-plugin-doctor` **同名不同仓**，审计簇内取一 |
| `chuanxuWei/dsh-trust-center` | A 原生DSH | MIT | 通用（插件安全） | 重复可强化（插件页） | 🔵 | proposed | 2026-10-15 | ★0，MIT。审计型权限与供应链信任中心，**npm 未发布** → 无法锁版，仅参考 |
| `baihejiangnan/dsh-plugin-safety-net` | A 原生DSH | MIT | 通用（插件安全） | 重复且无增益（审计簇） | 🔵 | proposed | 2026-10-15 | ★0，MIT。受控安装 + 插件管理 + 健康检查。审计簇内另一条，取一 |
| `ice5kysl/dsh-plugin-health` | A 原生DSH | MIT | 通用（插件体检） | 重复且无增益（审计簇） | 🔵 | proposed | 2026-10-15 | ★0，MIT。零依赖体检 CLI：manifest/npm/repo/docs + 只读面安全扫描。审计簇，取一 |
| `qinshige/dsh-performance-guard` | A 原生DSH | MIT | 通用（性能诊断） | 全新（性能域） | 🔵 | proposed | 2026-10-15 | ★0，MIT。宿主与 Web 性能诊断、反复的插件隔离排查、安全恢复。⚠ 与本仓 `scripts/radar-rotation` 一类的排查经验同族，**「插件隔离排查」思路可借鉴** |
| `Suxeca/dsh-plugin-repo-auditor` | A 原生DSH | MIT | 通用（仓库审计） | 全新（安全域） | 🔵 | proposed | 2026-10-15 | ★0，MIT，2026-10-14 推送。用 CMU StarScout 启发式审 GitHub 仓库的**假 star / 水军 / 空壳代码库** + 供应链与敏感权限静态检查。⚠ **与雷达自身的候选甄别高度相关**，可作选品工具线索 |
| `SOH4C4759/dsh-plugin-restart` | A 原生DSH | MIT | 通用（运维） | 全新（运维域） | 🔵 | proposed | 2026-10-15 | ★1，MIT，2026-10-08 推送。侧栏底一键重启 + 分离式 supervisor。⚠ **本仓改 profile 后手动重启的痛点直接对应**，可作开发期工具线索 |
| `nicecx/dsh-reset-handoff` | A 原生DSH | MIT | 通用（运维） | 全新（运维域） | 🔵 | proposed | 2026-10-15 | ★0，MIT。把重启请求交给外部运维 agent 的版本化 JSON 协议（preflight→gate→restart→health-check→recover）。**设计值得借鉴**：承认「DSH 不会自己重启」 |
| `Nasbaye/dsh-launcher` | A 原生DSH | MIT | 通用（运维） | 全新（运维域） | 🔵 | proposed | 2026-10-15 | ★0，MIT。一键重启插件：状态点 + 预检 + 重启后续跑 + token 截断自动续。运维簇 |
| `idoall/dsh-notify` | A 原生DSH | MIT | 通用（通知） | 全新（提醒域） | 🔵 | proposed | 2026-10-15 | ★1，MIT，2026-10-15 推送。页内任务通知：toast + 铃铛历史 + WebAudio 提示音 + 后台标签闪烁。**不碰 OS 通知矩阵**，形态克制，可作「今天」页提醒线索 |
| `Lubaoshuai/dsh-notify` | A 原生DSH | MIT | 通用（通知） | 全新（提醒域） | 🔵 | proposed | 2026-10-15 | ★0，MIT。agent 可调 `notify_send` + 外部投递（Telegram/Slack/Discord/飞书/钉钉/Bark/ntfy/webhook）。通知簇，取一 |
| `wwweljf/dsh-plugins` | A 原生DSH | MIT | 通用（通知） | 全新（提醒域） | 🔵 | proposed | 2026-10-15 | ★0，MIT。回合结束提示音 + 微信推送。通知簇，取一 |
| `Aurthes/dsh-web-push` | A 原生DSH | MIT | 通用（通知） | 全新（提醒域） | 🔵 | proposed | 2026-10-15 | ★0，MIT。Web Push → OS 级手机通知，带点击跳转会话。通知簇，取一 |
| `hnmrxz/dsh-plugin-sysmon` | A 原生DSH | MIT | 通用（系统监控） | 全新（本机资源） | 🔵 | proposed | 2026-10-15 | ★1，MIT。本机 CPU/内存/磁盘/负载/uptime 显示在底栏。**与学习场景无关**，但本仓「今天」页若需本机负载提示可参考 |
| `YOUNG26815/dsh-sysmon` | A 原生DSH | MIT | 通用（系统监控） | 全新（本机资源） | 🔵 | proposed | 2026-10-15 | ★0，MIT。系统哨兵：CPU/内存/磁盘/进程 + agent 工具 + 实时仪表盘。系统监控簇，取一 |
| `JularDepick/dsh-system-monitor-plugin` | A 原生DSH | Apache-2.0 | 通用（系统监控） | 全新（本机资源） | 🔵 | proposed | 2026-10-15 | ★0，Apache-2.0。监控 dsh 系统进程资源占用并以图表汇报。系统监控簇，取一 |
| `maoqizhen/dsh-pc-manager` | A 原生DSH | MIT | 通用（系统监控） | 无关 | 🔵 | proposed | 2026-10-15 | ★0，MIT。系统监控 + 垃圾清理。清理功能**超出本仓边界**，不合 |
| `U-Illll/dsh-memory` | A 原生DSH | MIT | 通用（记忆） | 全新（记忆域） | 🔵 | proposed | 2026-10-15 | ★1，MIT。wiki 双链记忆图 + 9 个工具（混合检索/读/链接扫描/记住/忘记/编译/健康检查/常驻检索子代理）。记忆域 |
| `Tommy00748/dsh-self-evolution` | A 原生DSH | MIT | 通用（自演化） | 全新（记忆域） | 🔵 | proposed | 2026-10-15 | ★0，MIT。有界自管理记忆 + 每回合自动复核定稿技能 + 技能健康检查 + 跨会话召回。记忆域 |
| `YFY-AI/dsh-llm-fallback` | A 原生DSH | MIT | 通用（模型层） | 全新（模型层） | 🔵 | proposed | 2026-10-15 | ★1，MIT。LLM provider 故障转移：优先级路由 + 健康检查 + 手动切换。⚠ **与本仓 `dsh-zhiyun-net-proxy` 的中继思路相关**，可作可用性兜底线索 |
| `force-push/dsh-a2a-plugin` | A 原生DSH | MIT | 通用（互操作） | 全新（互操作域） | 🔵 | proposed | 2026-10-15 | ★0，MIT。双向 A2A 协议客户端（JSON-RPC 2.0 / SSE / 子代理委派）。互操作域 |
| `frank6com/obsidian-harness-like` | A 原生DSH | MIT | 笔记（Obsidian） | 全新（跨形态） | 🔵 | proposed | 2026-10-15 | ★5。在 Obsidian 内跑 Cordis 插件系统 + AI agent，读写笔记走审批。形态为外部编辑器，与本仓内建笔记不同，仅作**审批式读写**设计参考 |
| `caixuf/dsh-native-mobile` | A 原生DSH | Apache-2.0 | 通用（移动接入） | 全新（移动域） | 🔵 | proposed | 2026-10-15 | ★0，Apache-2.0，2026-10-15 推送。Kotlin/Compose 原生客户端 + 进程内认证网关，走真实 DSH `/api` 协议单 WebSocket 复用。移动簇中**协议最正规**的一条 |
| `Wike-CHI/dsh-mobile` | A 原生DSH | Apache-2.0 | 通用（移动能力） | 全新（移动域） | 🔵 | proposed | 2026-10-15 | ★3，Apache-2.0。MobileService seam + mock/mobile-mcp provider + agent 工具（observe/open_app/tap/type/back）+ 分级执行策略。移动簇 |
| `superclaude1/dsh-vision-android` | A 原生DSH | MIT | 通用（移动能力） | 全新（移动域） | 🔵 | proposed | 2026-10-15 | ★2，MIT。多模态视觉 + Android adb UI 自动化做真机测试。移动簇 |
| `SunWay0573/dsh-mobile` | A 原生DSH | MIT | 通用（移动接入） | 全新（移动域） | 🔵 | proposed | 2026-10-15 | ★1，Kotlin 为主。手机控制本机 agent：远程唤醒、感知工作状态休眠、推送、隐私帘。移动簇 |
| `qingshanyuluo/dsh-mobile-ux` | A 原生DSH | MIT | 通用（移动接入） | 全新（移动域） | 🔵 | proposed | 2026-10-15 | ★1。纯 CSS 移动 UI + 带密码的 Cloudflare 隧道 + 极简 Android WebView。移动簇 |
| `alexcarterio/dsh-mobile-access` | A 原生DSH | MIT | 通用（移动接入） | 全新（移动域） | 🔵 | proposed | 2026-10-15 | ★1，MIT。局域网网关 + 设备审批 + 移动布局 + 推送 + PWA。移动簇 |
| `agent-mobile/dsh-mobile-gateway` | A 原生DSH | MIT | 通用（移动接入） | 全新（移动域） | 🔵 | proposed | 2026-10-15 | ★1，MIT。token 门控的 `/m/api`。移动簇 |
| `Liki-K-Wang/dsh_mobile_app` | A 原生DSH | MIT | 通用（移动接入） | 全新（移动域） | 🔵 | proposed | 2026-10-15 | ★0，MIT。扫码配对 Android 手机到本机 web GUI（LAN/Tailscale）。移动簇 |
| `AKHYui/DSH-Remote-plugin` | A 原生DSH | MIT | 通用（远程接入） | 全新（移动域） | 🔵 | proposed | 2026-10-15 | ★0，MIT。经单条出站 WebSocket 暴露本机 harness（无入站端口、可穿 NAT），固定 op 白名单。⚠ **出站中继思路与 `dsh-zhiyun-net-proxy` 同族** |
| `evanfang0054/dsh-tailscale-console` | A 原生DSH | MIT | 通用（远程接入） | 全新（运维域） | 🔵 | proposed | 2026-10-15 | ★1，MIT。Tailscale 远程访问运营面板：健康检查、HTTPS 入口开关、代理绕过、中继运维、ACL 生成。⚠ 本仓若做远程访问需先定安全模型 |
| `Alain-Prot0s5/dsh-screenshot` | A 原生DSH | MIT | 通用（桌面工具） | 无关 | 🔵 | proposed | 2026-10-15 | ★2，MIT，PowerShell + 仅 Win10/11 + 需 DSH Desktop。⚠ 本仓为 Web 工作台，**平台与形态均不合** |
| `rifkyazizf/dsh-session-tabs` | A 原生DSH | MIT | 通用（会话 UI） | 全新（UI 域） | 🔵 | proposed | 2026-10-15 | ★1，MIT，2026-10-08 推送。会话标签页（桌面版）。UI 域小工具 |
| `Max-Samson/dsh-usage-chart` 等 **用量/成本簇 19 条** | A 原生DSH | 多为 MIT（1 条无许可） | 通用（用量面板） | **重复且无增益**（用量簇） | ⛔ | rejected | 2026-10-15 | 全部是「token 用量 / 费用估算 / 余额」面板，形态高度同质（侧栏挂件、悬浮窗、设置页仪表盘）。本仓**无用量面板**但「个人」页已承载偏好设置；**簇内取一即可，不逐条集成**。含 `jLeon-account/dsh-client-usage`（无许可证，仅登记） |

<!-- 折叠组 -->

### 健康提醒簇（2 条，同名不同仓，取一）

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `rshh5/dsh-health-reminder` | A 原生DSH | MIT | 通用 | 全新（簇内取一） | 🔵 | proposed | 2026-10-15 | ★1。A flat monochrome health-reminder plugin for DSH Web: schedu |
| `rshh0520/dsh-health-reminder` | A 原生DSH | MIT | 通用 | 全新（簇内取一） | 🔵 | proposed | 2026-10-15 | ★0。DSH Web health reminder plugin: scheduled water-drinking rem |

### 其余（域偏 / 形态不合 / 撞词）

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `Favio8/dsh-plugins` | A 原生DSH | 无许可证 | 通用 | 全新（簇内取一） | 🔵 | proposed | 2026-10-15 | ★1。DeepSeek Harness (DSH) source plugin collection, one folder  |
| `change979666/ox-alpha-dsh` | A 原生DSH | MIT | 通用 | 全新（簇内取一） | 🔵 | proposed | 2026-10-15 | ★0。Bilingual DSH Desktop model hub plugin for Ox Alpha, custom  |
| `SodiumLayer/dsh-obscura` | A 原生DSH | MIT | 通用 | 全新（簇内取一） | 🔵 | proposed | 2026-10-15 | ★0。Obscura settings-page plugin for DeepSeek Harness: starts an |
| `geosmall/logic-dshot-gitlab` | A 原生DSH | 无许可证 | 通用 | 全新（簇内取一） | 🔵 | proposed | 2026-10-15 | ★0。DShot Logic Analyzer Plugin |

---

## 2026-10-16 · B 组（浙大场景 · **细分场景轴**）· 追加

> 关键词（全部为 B 组内的正交新切片，不与已跑的 `zju` / `zju course` / `cc98` / `campus app` 重复）：
> `zju tool`、`zju courses`、`zju webvpn`、`zju calendar`、`zju grade`、`zju learning`、
> `zju exam`、`zju zhiyun`、`zju cloud classroom`、`cc98 client` + `zju skill`。
> **搜索 10 次**（上限 10），API 无 403，本轮**完整**。
> 许可证核实：GitHub API `license.spdx_id` + 对高价值候选**逐一拉取 LICENSE 实文比对**。

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `Phil-Fan/awesome-zju-tools` | B 其他JS | CC0-1.0 | 浙大工具索引 | **全新（线索源）** | 🟢 | proposed | 2026-10-16 | ★240。浙大工具/脚本/资源合集（MDX+Astro 站点 zjutools.top），**2026-10-15 当日更新**。与 `awesome-dsh-plugin` 同性质：价值在**索引了谁**，只作雷达外部线索池，**不制成插件**。⚠ 清单内第三方项目须**逐个独立核证**许可证，不得因收录于 CC0 清单即假定可用。LICENSE 文件名为**小写 `license`** |
| `memset0/Learning-at-ZJU-Helper` | B 其他JS | MIT | 学在浙大/智云课堂 | **重复且可强化**（课程/讲座页） | 🟡 | proposed | 2026-10-16 | ★58。userscript（webpack+Hyperapp+UI5），**插件化架构**（`src/plugins/` 可插拔 + 上下文工具链）。功能：PTA 助手 / 视频播放器网页全屏 / 带时间戳精准空降 / 专注模式 / 画中画。**强化点**：本仓 `dsh-zhiyun-classroom`+`dsh-zhiyun-lecture` **无"播放器增强"层**。⚠ **2024-12 停更 22 个月**；技术栈错配（userscript ≠ DSH 包），建议走 **(a) 能力提取 + 重写**而非 (b) iframe 注入。MIT 允许借鉴，摘代码须记 ATTRIBUTION |
| `Dunn1127/zju-career-calendar` | B 其他JS | MIT | 宣讲会/双选会 | **全新**（求职时间线） | 🟡 | proposed | 2026-10-16 | ★0。浙大宣讲日历：采集器（cheerio）+ 静态站点 + 离线 PWA + 收藏；devDeps 含 `ical.js`。`node>=24`。**与"今天"页的学业日程不同源**（求职 vs 学业），本仓无招聘类能力 → 无重复风险。**L2 骨架选定** → `packages/dsh-radar-career-calendar`。⚠ **版权归属异常**：LICENSE 正文写"大连理工宣讲日历贡献者"却为浙大仓库，疑模板未改/fork 改写，**须人工核证**；⚠ **采集合规性须裁定**（robots/ToS/限速/是否含个人联系方式） |
| `baihe26/zju-literature-downloader` | B 其他JS | MIT | 论文获取 | **重复且可强化**（论文页） | 🟡 | proposed | 2026-10-16 | ★34。Codex/Claude **skill**（`SKILL.md`+`agents/`+`scripts/`），经**用户已授权**浙大图书馆/WebVPN Chrome 会话下载校验阅读 PDF。**强化点**：本仓 `dsh-zhiyun-paper` 只解决"读"，**"合规取全文"是空白**。⚠ **合规红线为最高优先**：不得内置绕过付费墙机制，建议**只引导不代下**。与 `3-Tian/zju-paper-fetcher`（★0，MIT，同作者同类）**归一取一** |
| `xhacker/zju-jwb-to-icalendar` | B 其他JS | MIT | 课表 iCal 导出 | **重复且可强化**（课程页） | 🟡 | proposed | 2026-10-16 | ★17。教务网课表 → iCalendar（可导入 iOS/Google 日历）。**本仓课程页缺 iCal 导出通路**。⚠ **2017-08 停更 9 年**（jwbinfosys 选择器几乎必然失效）+ Python 非 JS → **只作"能力缺口"线索登记，实现由本仓自建**（课表→VEVENT 映射，工作量小）。`Dunn1127/zju-career-calendar` 的 `ical.js` 用法可作参考 |
| `YangShu233-Snow/Learning_at_ZJU_third_client` | B 其他JS | NOASSERTION | 学在浙大 | 全新 | ⚠ 待核 | pending-license | 2026-10-16 | ★88（forks 7）。**2026-10-15 当日活跃**，本轮**最活跃且最贴合本仓场景**者：学在浙大第三方客户端，目标"实现绝大部分网页端功能且更流畅"。Python，无 `cordis.patch.yml`（B 类）。**许可证待人工核验，不采用、不摘取任何代码**。⚠ **建议优先核验**：若宽松，可能是比 `Learning-at-ZJU-Helper`（停更 22 月）**更值得接的对象** |
| `Zarad0X/openclaw-zju-skills` | B 其他JS | MIT | 课程/成绩/CC98 | 全新 | 🔵 | proposed | 2026-10-16 | ★10。浙大 OpenClaw skills（课程/邮件/成绩/CC98 自动化）。**他生态**（OpenClaw），架构可参考，不直接接 |
| `WEN-JY/academic-research-skills` | B 其他JS | MIT | 科研 | 全新 | 🔵 | proposed | 2026-10-16 | ★6。浙大 MEM 学术研究 Agent skills（JS）。科研 OS 簇，**簇内不建议接入** |
| `yimuEwood/zju-research-skills` | B 其他JS | Apache-2.0 | 科研 | 全新 | 🔵 | proposed | 2026-10-16 | ★1。跨 agent 科研工作流系统「ZJU Research OS」（Python）。同上，簇内不建议接入 |
| `Anchorite-no/cc98-autosign-fast` | B 其他JS | MIT | 校园论坛 | 全新 | 🔵 | proposed | 2026-10-16 | ★6。CC98 自动签到（Go，支持 WebVPN/多账号）。非 JS 技术栈，仅线索。相比已登记 `inuEbisu/CC98Autosign`（Python，WTFPL）更活跃 |
| `macanine/zju-zhiyun-cli` | B 其他JS | 无许可证 | 智云课堂 | — | ⛔ | rejected | 2026-10-16 | ★0。智云课堂 CLI。**无许可证**，不得摘取代码，仅线索 |
| `Xecades/zju-zhiyun-down` | B 其他JS | 无许可证 | 智云课堂回放 | — | ⛔ | rejected | 2026-10-16 | ★5。轮询智云课堂回放 API 下载视频。**无许可证**，仅线索 |
| `StephenChen1108/edgeless-zju-transcript-exporter` | B 其他JS | 无许可证 | 智云字幕导出 | — | ⛔ | rejected | 2026-10-16 | ★3。从 Edge 导出智云课堂字幕。**无许可证**，仅线索 |
| `Meteors27/ZJU-Calendar-Maker` | B 其他JS | 无许可证 | 课表 ics | 重复且无增益 | ⛔ | rejected | 2026-10-16 | ★19。一键生成课程表 ics（Python）。**无许可证** + 2023 停更。功能与 `xhacker/zju-jwb-to-icalendar` 重复，**簇内取一，取 MIT 那条** |
| `ZJUZhiyuCai/zju-activity-calendar` | B 其他JS | NOASSERTION | 活动日历 | — | ⛔ | rejected | 2026-10-16 | ★1。许可证不明 |
| `Lucent-Snow/zju-scholar` | B 其他JS | **GPL-3.0** | 课表/成绩/考试/作业/智云字幕 | 重复且无增益 | ⛔ | rejected | 2026-10-16 | ★21。Claude Code Skill，**功能域与本仓高度重叠**，但 **GPL 红线** → 只作**需求清单对照**，不碰代码 |
| `Lucent-Snow/ZJU-English-dictation-tool` | B 其他JS | 无许可证 | 英语听写 | — | ⛔ | rejected | 2026-10-16 | ★15。无许可证 |
| `3-Tian/zju-paper-fetcher` | B 其他JS | MIT | 论文获取 | 重复且无增益 | 🔵 | proposed | 2026-10-16 | ★0。DOI → 经 wengine WebVPN 驱动 Chrome 下载。与 `baihe26/zju-literature-downloader` **同簇归一取一**（取 ★34 那条） |
| `KqSmea8/zjuGradeMonitor` | B 其他JS | 无许可证 | 成绩监控 | — | ⛔ | rejected | 2026-10-16 | ★0。无许可证 + 2019 停更 |
| `a9257/ZJU-GRADES` | B 其他JS | 无许可证 | 成绩查询 | — | ⛔ | rejected | 2026-10-16 | ★0。无许可证 + 2019 停更 |
| `FrazierLei/ZJU-toolkit` | B 其他JS | Apache-2.0 | 通用工具 | — | 🔵 | proposed | 2026-10-16 | ★20。Python 实现的浙大实用功能集。2021 停更，仅线索 |
| `awmleer/zjuwlan` | B 其他JS | MIT | 校园网认证 | 重复且可强化（网络代理） | 🔵 | proposed | 2026-10-16 | ★3。ZJUWLAN 命令行认证（JS）。与本仓 `dsh-zhiyun-net-proxy` 同域但形态不同（CLI vs 工作台），2022 停更，仅线索 |
| `eWloYW8/ZJUWebVPN` | B 其他JS | WTFPL | WebVPN 接入 | — | 🔵 | proposed | 2026-10-16 | ★9。ZJU WebVPN Python 封装。**WTFPL 属宽松但不在白名单枚举内** → 只登记不采用 |
| `haoqunjiang/cc98-ionic` | B 其他JS | BSD-3-Clause | 校园论坛 | 全新 | 🔵 | proposed | 2026-10-16 | ★4。CC98 第三方客户端（Ionic/JS）。2018 停更，许可证宽松但过时，仅线索 |

> **簇登记（折叠）**：① **浙大 Agent Skill 簇 4 条** → 取一（论文获取取 `baihe26/...`；科研 OS 类不建议接入）；
> ② **课表 iCal 导出簇 3 条** → 取一（取 MIT 的 `xhacker/zju-jwb-to-icalendar`，实现自建）；
> ③ **论文获取簇 2 条** → 归一（`baihe26/...` ★34 vs `3-Tian/...` ★0，同作者，取前者）。

---

## 2026-10-16 · C 组（学生功能域 · **能力轴新切片**）· 追加

> 关键词（全部为 C 组内的正交新切片，不与已跑的 `timetable ics export` / `paper annotation reader` /
> `ocr notes taking` / `quiz practice` / `fitness tracker` 重复）：
> `flashcard srs`、`markdown notes editor`、`citation bibliography manager`、`handwriting math ocr`、
> `mindmap knowledge graph`、`pdf summarizer llm`、`lecture video transcript`、`exam practice question bank`、
> `latex equation editor javascript`、`academic pdf reader react`。
> **搜索 10 次**（上限 10），API 无 403，本轮**完整**。`zju paper annotation reader` → `total_count = 0`（记"该关键词无结果"）。
> 许可证核实：GitHub API `license.spdx_id` + 对高价值候选**逐一拉取 LICENSE 实文比对**
> （`lecture-to-notes` / `marksman` / `iwe` 三条实文已核）。

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `drpwchen/lecture-to-notes` | B 其他JS | MIT | 讲座录像→笔记 | **重复可强化** | 🟡 | proposed | 2026-10-16 | ★108，**2026-10-13 活跃**。实为 **Python** 管线（faster-whisper/Surya/PyMuPDF）。录像+课件→**带时间戳逐字稿 + 幻灯片对齐**，产出**双向同步 HTML 查看器**（点要点跳时刻/播放高亮要点）。自述目标是 **traceability 而非 accuracy**。**强化对象**：`dsh-zhiyun-lecture`×`classroom` 的"拿到课件之后"通路 —— 本仓**音视频理解与时间轴对齐完全空白**。⚠ 技术栈错配（Python），建议**能力提取（取对齐设计与 `slides_grounded.json` 证据模型）而非外挂管线**；⚠ **课堂音视频数据策略须人工拍板**（红线）。**本轮 L2 骨架选定对象** |
| `artempyanykh/marksman` | B 其他JS | MIT | 笔记/Wiki 写作 | **重复可强化** | 🟡 | proposed | 2026-10-16 | ★3365，2026-09-14。实为 **F#**。Markdown **LSP**（补全/跳转/诊断）。**强化对象**：`dsh-zhiyun-notes`。⚠ **但本仓笔记是"节笔记"（绑定账号+课程+节次），非自由文件树** —— LSP 的跨文件价值**未必成立**。建议**先定笔记形态定位**再决定是否推进；若仅需内链补全，不如**直接扩展既有 `zy://` 协议** |
| `iwe-org/iwe` | B 其他JS | Apache-2.0 | 知识管理/笔记网络 | **重复可强化** | 🟡 | proposed | 2026-10-16 | ★1774，**2026-10-15 当日活跃**。实为 **Rust**。Markdown **知识图谱**：LSP + CLI + **MCP memory**（`ai-memory`/`ai-agents`），主页 iwe.md。**强化对象**：`dsh-zhiyun-knowledge` 的**字面检索 → 图检索**（真正的底层升级）。⚠ ① 与首轮登记的 `modsearch`/`modlens` **功能域交叉，不可两条都接**，须横向比对；② 本仓知识域键空间是「账号+课程+节次」，**须先确认能否在其上建图** |
| `jupyterlab-contrib/jupyterlab-citation-manager` | B 其他JS | BSD-3-Clause | 文献引用 | 全新 | 🔵 | proposed | 2026-10-16 | ★75，2026-09-04。Zotero Web API 引用管理器。**引用/文献域是本仓全新缺口**，但形态是 JupyterLab 扩展，**强耦合不可复用** |
| `mlava/scholar-sidekick-obsidian` | B 其他JS | MIT | 文献引用 | 全新 | 🔵 | proposed | 2026-10-16 | ★2，2026-10-12。DOI/PMID/ISBN → 格式化引用，**10000+ CSL 样式**。**CSL 样式表思路可作本仓自建引用功能的参考**；形态为 Obsidian 插件 |
| `dmarienko/skena` | B 其他JS | MIT | 知识图谱 | 重复可强化 | 🔵 | proposed | 2026-10-16 | ★8，2026-09-30。VS Code 扩展：JSON Canvas → 交互节点图，连 markdown vault。**JSON Canvas 格式**可作知识图存储参考 |
| `shaunhurryup/lovely-mindmap` | B 其他JS | MIT | 知识图谱 | 重复可强化 | 🔵 | proposed | 2026-10-16 | ★89，2025-02-23。TS 构建知识图谱。可作**图谱渲染**参考 |
| `DavidMiserak/GoCard` | B 其他JS | MIT | 复习调度 | 重复可强化 | 🔵 | proposed | 2026-10-16 | ★59，2026-05-15。**纯 Markdown 文件的 SRS**（SM-2）。与已登记 `ts-fsrs` **同域**：`ts-fsrs` 是"FSRS 本身"，此条是"应用形态"。Go TUI **不可复用**；**「文件即卡片」的数据模型可参考** |
| `1989877799-ai/PaperLens` | B 其他JS | MIT | 论文阅读 | 重复可强化 | 🔵 | proposed | 2026-10-16 | ★0，2026-07-31 后未更新。DeepSeek 驱动的英文论文阅读器（React），仅线索 |
| `Amey-Thakur/LATEXRENDER` | B 其他JS | MIT | 公式编辑 | 全新 | 🔵 | proposed | 2026-10-16 | ★5，2026-09-06。纯浏览器 LaTeX 公式编辑器，导出 14 种格式。体量过小，仅线索 |
| `antonmedv/textarea` | B 其他JS | MIT | 通用文本编辑 | 重复且无增益 | ⛔ | proposed | 2026-10-16 | ★2527，2026-10-05。"活在 URL 里的极简文本编辑器"。与本仓功能域无关，**重复且无增益** |
| `pieralukasz/true-recall` | B 其他JS | **NOASSERTION** | 复习调度 | — | ⚠ 待核 | proposed | 2026-10-16 | ★64，2026-10-14。Obsidian 原生间隔重复：**FSRS v6 调度 + 图像遮挡（image occlusion）**。**图像遮挡题型是本仓「习题」域尚未考虑过的** → **建议人工优先核验许可证**。**不采用、不得摘取代码** |
| `Sreehari05055/thesys-core` | B 其他JS | **NOASSERTION** | 学术研究 | — | ⚠ 待核 | proposed | 2026-10-16 | ★174，2026-10-14。开放研究工作站：学术搜索 + PDF 上传 + 内联引用（TS）。API 报 `NOASSERTION`。**若实为 AGPL 则 ⛔**。**不采用、不得摘取代码** |
| `papis/papis` | B 其他JS | GPL-3.0 | 文献管理 | — | ⛔ | proposed | 2026-10-16 | ★1789，2026-10-03。**GPL 红线**。文献管理功能相关，但许可不行 —— 只作需求对照 |
| `Slydite/lore-engine` | B 其他JS | MPL-2.0 | 讲座→笔记 | — | ⛔ | proposed | 2026-10-16 | ★118，2025-10-11。"PDF + 视频（带转写）→ 教育内容"管线，**与 🟡-1 功能域几乎重叠**，却因 **MPL 红线** ⛔。**只作需求清单对照，不碰代码** |
| `CeciliaGuo331/dehydrater` | B 其他JS | AGPL-3.0 | 讲座→笔记 | — | ⛔ | proposed | 2026-10-16 | ★6，2026-10-13。**中文**课堂录音整理：录像/录音 + 课件 → 逐字稿与按课件组织的笔记，无需 GPU。**功能最贴合却因 AGPL 红线** ⛔。同上，只作需求对照 |
| `thiswillbeyourgithub/wdoc` | B 其他JS | AGPL-3.0 | 多文档摘要 | — | ⛔ | proposed | 2026-10-16 | ★544，2026-10-12。**AGPL 红线** |
| `hedgedoc/hedgedoc` | B 其他JS | AGPL-3.0 | 协作笔记 | — | ⛔ | proposed | 2026-10-16 | ★7482，2026-10-15。**AGPL 红线** |
| `ankidroid/Anki-Android` | B 其他JS | GPL-3.0 | 复习 | — | ⛔ | proposed | 2026-10-16 | ★12019，2026-10-15。**GPL 红线** |
| `vnotex/vnote` | B 其他JS | LGPL-3.0 | 笔记 | — | ⛔ | proposed | 2026-10-16 | ★13005，2026-10-15。**LGPL 红线**（C++ 原生） |
| `Laverna/laverna` | B 其他JS | MPL-2.0 | 笔记 | — | ⛔ | proposed | 2026-10-16 | ★9166，2021-05-30 停更。**MPL 红线** |
| `daniel3735928559/guppy` | B 其他JS | **无许可证** | 公式编辑 | — | ⛔ | proposed | 2026-10-16 | ★193，2022-12-09。WYSIWYG 公式编辑器（LaTeX 兼容 + 结构化输出），**功能相关但无许可证 → 不可摘取代码** |
| `toeverything/AFFiNE` | B 其他JS | **NOASSERTION** | 知识库 | — | ⛔ | proposed | 2026-10-16 | ★73540。许可证不明，不采用 |
| 认证类题库 App（`nosadaniel/kcna_cert_demo_quiz` / `nguyenviettung7691/az-104-exam-simulator` 等） | B 其他JS | MIT 等 | 刷题 | **重复且无增益** | ⛔ | proposed | 2026-10-16 | 均为 **K8s / Azure / CEH 等认证题库**，与本仓课程学习**无关**，且本仓已有 `dsh-zhiyun-quiz`。**不集成** |

> **簇登记（折叠）**：① **讲座/课堂→笔记簇 3 条** → 许可证决定归属：
> `lecture-to-notes`（MIT ✅，取）／`lore-engine`（MPL ⛔）／`dehydrater`（AGPL ⛔）——
> **后两条功能与前者几乎重叠，仅作需求对照**；
> ② **文献引用簇 2 条** → `jupyterlab-citation-manager`（BSD-3）与 `scholar-sidekick-obsidian`（MIT）
> **均强耦合他生态** → 均 🔵，**引用域建议本仓自建**（可参考 CSL 样式表思路）。

---

## 2026-10-16 · A 组（DSH 插件生态 · **学习科学切片**）· 第三轮 · 追加

> 关键词：`dsh plugin spaced repetition`、`dsh plugin knowledge graph`、`dsh plugin socratic`、
> `dsh plugin curiosity`、`dsh plugin mastery learning`（+ 5 个返回 0 的词，见报告）。
> **13 次搜索**（⚠ 超 ≤10 上限，已如实记录）。API 无 403。
> 许可证核实：`license.spdx_id` + 对高价值候选**逐一拉取 LICENSE 实文比对**
> （`ponytail-grill` / `spec-gate` / `dsh-teacher` 三条实文已核）。
> **本轮把 2026-10-15 登记的 🔵 `Kaiji-Z/dsh-plugin-lookatstudy` 深化为 🟢 并出骨架**
> （非重复登记，见下）。

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `Kaiji-Z/dsh-plugin-lookatstudy` | A 原生DSH | MIT | 学习路径/习题/掌握度 | **重复可强化** | 🟢 ↑ | proposed | 2026-10-15 | **↑ 由 🔵 深化为 🟢**（首轮仅标「值得后续深看」）。★19。npm `dsh-plugin-lookatstudy@0.26.3` **已核实可锁版挂载** ✅，**零运行时依赖** ✅。**BKT 掌握度 + 门控技能树**（与 FSRS 正交、可叠加）。⚠ **自带 SM-2 与 `dsh-radar-fsrs-scheduler` 冲突，须人工裁决**。**本轮 L2 骨架** |
| `lastplayer82/dsh-tanqi` | A 原生DSH | Apache-2.0 | 探索/兴趣驱动 | 重复可强化（今天页） | 🟡 | proposed | 2026-10-16 | ★0。npm `@lastplayer82/dsh-tanqi@0.2.0` 可挂载 ✅，零依赖。AI 好奇心/冷知识 + 分层深挖。补「今天页」缺的**动机驱动**。⚠ 2026-08-21 后未更新，先观望 |
| `qShan1/dsh-ponytail-grill` | A 原生DSH | MIT | 苏格拉底追问/自检 | 重复可强化（quiz 闭环） | 🟡 | proposed | 2026-10-16 | ★0。**LICENSE 实文已核**（MIT / Copyright 2026 qShan1）✅，`dsh.bundle.patch` + `dsh.client`，**无 npm 包但零依赖**。追问对象是**人**（对学生理解诘问），补 quiz「做完题之后」。⚠ 与 `Yihong89/dsh-teacher` 同域取一 |
| `boomzikazita/dsh-spec-gate` | A 原生DSH | **MIT** ✅ | 开发流程（非学习） | 全新但域外 | 🔵 | proposed | 2026-10-16 | ★0。**许可证纠错**：`package.json` 写 `license: None`（漏填），但 **LICENSE 实文为完整 MIT** → 以实文为准 **MIT ✅**。规格门禁 + Socratic 访谈／歧义打分。**功能域为开发流程工具，与学生学习场景正交** → 仅登记 |
| `Yihong89/dsh-teacher` | A 原生DSH | **⚠ 待核** | 苏格拉底导师 | 重复可强化（quiz 闭环） | 🔵 | proposed | 2026-10-16 | ★3。A 类结构齐备，但**三项均不满足**：① **未发布 npm**（`dsh-teacher` E404）→ 无法锁版挂载；② **LICENSE 文件为空**，仅 `package.json` 声明 MIT → ⚠ 待核；③ 依赖 `dsh-voice-core`，该包 **npm 亦 E404** → 传递依赖不可解析。**不采用、不得摘取代码** |
| `kotosq/ielts-vocab-trainer` | A 原生DSH | BSD-3-Clause | 雅思词汇 | 重复且无增益 | 🔵 | proposed | 2026-10-16 | ★0。BSD-3 ✅ 但 **未发布 npm**（`@dsh-external/ielts-vocab-trainer` E404）→ 无法锁版挂载；雅思与本仓浙大课程场景正交无关；间隔重复已由 `fsrs-scheduler` 覆盖 |
| `Luke-Yong/dsh-plugin-knowledge-graph` | A 原生DSH | MIT | 知识图谱 | 重复可强化（知识页） | 🔵 | proposed | 2026-10-16 | ★4。`dsh.bundle.patch` ✅ 但**无 `dsh.client`**（纯后端）。⚠ **把 `typescript` 误列为运行时 dependency** → 污染依赖树。归入**已饱和的图谱簇**，不单独推进 |
| `alei37/dsh-cet6-tutor` | A 原生DSH | **AGPL-3.0** | 六级备考 | — | ⛔ | rejected | 2026-10-16 | ★0。**AGPL 红线** ⛔。CET-6 间隔重复导师。**只作需求对照，不碰代码** |

> **簇登记（折叠）**：① **苏格拉底追问簇 3 条** → 取一（建议 `qShan1/dsh-ponytail-grill`；
> `Cruciforms/dsh-socrates` 已登记但属 deep research 方向）；
> ② **知识图谱簇 5 条** → 全部已登记/本轮仅补 1 条纯后端，**簇内饱和**，
> 建议人工一次性横向排序取一（`Roarpeng/GraphFlow` ★22 最高）；
> ③ **间隔重复/掌握度簇 3 条** → `lookatstudy`（BKT+技能树）／`dsh-flashcard`（仅 SM-2，⛔）／
> `dsh-radar-fsrs-scheduler`（FSRS）→ **必须与 fsrs-scheduler 统一裁决**。

---

## 2026-10-16 · B 组（浙大场景 · **校园基础设施 / 系统能力轴**）· 第四轮 · 追加

> 关键词：`zju captcha`、`zju login`、`zju vpn`、`zju auth`、
> `zju jwbinfosys OR zdbk OR zju jwb`、`zju grade point`、`campus timetable scraper zju`、
> `zju cloud classroom`、`zju zhiyun course video`、`zju library`
> （+ 追加 8 词验证轴是否枯竭，见报告）。**20 次搜索**（⚠ 超 ≤10 上限，已如实记录）。API 无 403。
> 许可证核实：`license.spdx_id` + 对 🟢/🟡 候选**逐一拉取 LICENSE 实文比对**，
> 并对 npm 包（`login-zju@1.0.9`、`dsh-panda-calendar@1.2.4`）做 **registry 二次核实**。
> **本轮 0 条 `NOASSERTION`**（与 10-16 第二/三轮形成对比）。

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `5dbwat4/login-ZJU` | B 其他JS | **MIT** ✅ | 账号/登录（全场景前置） | **重复可强化** | 🟢 | proposed | 2026-10-16 | ★16，**2026-10-14 活跃**。**LICENSE 实文已核**（`Copyright (c) 2024 5dbwat4`）✅。npm `login-zju@1.0.9`（2026-07-03）**MIT ✅ 已核实可锁版引入**，依赖**仅 `nanoid ^5.1.9`**（零传递污染），**无 engines/peer 门槛**。**把浙大 12 个系统的登录态统一成一套 API**（`new ZJUAM(u,p)` + `service.fetch()` 即用）：ZJUAM/ZDBK/COURSE/COURSES/CLASSROOM/APILIB/BOOKINGLIB/CC98/ETA/FORM/OPEN/ALT。**强化对象**：本仓 `dsh-zhiyun-classroom/src/auth.js` 是**手写 CAS、只服务智云一个目标**；上游是同一流程的**通用化实现**。三条判据均成立 → **强化式集成**。⚠ **① 绝不可与现有智云登录并行**（建议上游只管智云之外的 11 个业务）；⚠ **② 凭据流向变了**（明文入参，须确认不落盘/不进日志）；⚠ ③ 核对 `nanoid` 版本冲突。**本轮 L2 骨架备选之一** → 实际骨架出了 panda-calendar |
| `SylarLong/iztro` | B 其他JS | **MIT** ✅ | 日程/时间（校历/农历） | **重复可强化** | 🟡 | proposed | 2026-10-16 | **★4227**，**2026-10-15 当日活跃**。**纯 JS 农历/黄历权威底层**（中西历互转 + 干支 + 生肖 + 廿四节气 + 传统节日 + 每日宜忌）。本仓「今天」页**只有公历**，无任何历法逻辑。⚠ **上游字面用途是紫微斗数排盘**（与本仓无关）→ 若接入**只可取历法模块**，命理部分不接入、不显示，**此点须人工拍板（产品取向）**。⚠ **与骨架 `dsh-radar-panda-calendar` 同域，两条须裁决取一** |
| `runcat-tommy/dsh-panda-calendar` | A 原生DSH | **MIT** ✅ | 日程/时间（历法） | **重复可强化** | 🟡 → **出骨架** | proposed | 2026-10-16 | ★1。npm `dsh-panda-calendar@1.2.4` **MIT ✅ 已核实可锁版挂载**，`dependencies`/`peerDependencies` **均空**（零传递污染）。`dsh.bundle.patch` + `dsh.client`（4 个 inject 点）。**离线圈日引擎 73384 天逐日校验、0 不一致**（数据派生自 `lunar-javascript` 6tail/MIT，有生成器与测试可溯源）。⚠ **① 默认会在 `conversation.view` 注册「熊猫日历」标签页**（是否允许须人工裁决）；⚠ ② 自带紫微斗数/天气/时间戳，**均不接入**。**本轮 L2 骨架** → `packages/dsh-radar-panda-calendar` |
| `Mythologyli/zju-web-login` | B 其他JS | MIT ✅ | 校园网认证 | 全新但形态不合 | 🔵 | proposed | 2026-10-16 | ★42，2026-01-31。**ZJU 网络网页认证登录脚本**。⚠ 实为**用户脚本（Tampermonkey 形态）**，非库 → 不可作依赖；但**认证表单字段与跳转链是现行有效的一手资料**，可作 `dsh-zhiyun-net-proxy` 的能力缺口对照 |
| `mohan-zeyu/golang-login-zju` | B 其他JS | MIT ✅ | 统一身份认证 | 重复可强化 | 🔵 | proposed | 2026-10-16 | ★5，2026-06-25。**Go** 版 ZJU 登录库。与 `5dbwat4/login-ZJU` 同域但**语言不可直用** → 只作**交叉验证**（两套独立实现对同一 CAS 流程的共识，可反证上游流程未漂移） |
| `n0sig/ZJU-Web-Auth-Bash` | B 其他JS | **无许可证** | 校园网认证 | — | ⛔ | rejected | 2026-10-16 | ★28。Bash 认证脚本。**无许可证 → 不得摘取任何代码** |
| `Xinzhe99/zju-autologin` | B 其他JS | MIT ✅ | 校园网认证 | 全新但形态不合 | 🔵 | proposed | 2026-10-16 | ★4，2026-10-14。**srun 门户 + PyQt6 托盘应用**（Python）。⚠ 桌面形态与 web 客户端不兼容；**同域已有** `yuanstarstar/dsh-bit-login`（10-15 登记，Srun 参考）→ **簇内饱和，不单独推进** |
| `eWloYW8/ZJUWebVPN` | B 其他JS | WTFPL | WebVPN 访问 | 重复可强化 | 🔵 | proposed | 2026-10-16 | ★9，2025-12-26。Python wrapper，包装浙大 WebVPN 自动访问。⚠ 本仓已有 WebVPN 通路（`dsh-zhiyun-net-proxy` 分域中继）→ 倾向**重复且无增益**；保 🔵 仅因 **WTFPL 极宽松**，可作实现参考。⚠ WTFPL 不在白名单字面表内（但非 copyleft）—— **不进 L2 骨架，故不触发白名单约束**；若要升 🟢 须人工确认 |
| `ChenyuHeee/Libot` | B 其他JS | MIT ✅ | 图书馆座位 | 全新但形态不合 | 🔵 | proposed | 2026-10-16 | ★3，2026-01-08。**Python** macOS/Windows 桌面工具：每分钟轮询浙大图书馆座位，有空位推**钉钉群**（群号 145455027687）。⚠ 形态完全不兼容（桌面 app + 需用户自建群）→ 仅作「**图书馆座位域确有真实需求**」的线索；若要做，由本仓自建 |
| `birchtree2/zju-grad-course-helper` | B 其他JS | MIT ✅ | 研究生选课 | **重复且无增益** | ⛔ | rejected | 2026-10-16 | ★0，2026-09-15。**JS 浏览器扩展**。⚠ 扩展形态不能作为依赖；与 `Zhangyc0/ZJU-Course-Selection` 同域 → **选课簇整体不进集成评估**（见下） |
| `Zhangyc0/ZJU-Course-Selection` | B 其他JS | MIT ✅ | 选课脚本 | **重复且无增益** | ⛔ | rejected | 2026-10-16 | ★15，2021-08-13 停更 5 年（Python）。许可虽合规，但功能为「**自动抢课**」→ **高风险行为**（违反教务系统使用条款、可能触发账号处罚）。建议**不进任何集成评估**，只登记。**建议把「自动抢课/签到/评教」写进 radar 排除规则**，免每轮重复判断 |
| `QSCTech/jw-scraper` | B 其他JS | MIT ✅ | 教务数据 | **重复且无增益** | ⛔ | rejected | 2026-10-16 | ★7，2023-02-22。**Go** 教务网爬虫 SDK。⚠ 与 `xhacker/zju-jwb-to-icalendar`（10-16 已登记）同域且 Go 不可直用 → **簇内取一，已取 MIT 的 TS 那条** |
| `awmleer/zju-library` | B 其他JS | **无许可证** | 图书馆 | — | ⛔ | rejected | 2026-10-16 | ★22，2022-05-21。浙大图书馆 app（React Native）。**无许可证** + 停更 4 年 → **不得摘取任何代码** |
| `FrazierLei/ZJU-toolkit` | B 其他JS | Apache-2.0 ✅ | 综合工具集 | 仅供参考 | 🔵 | proposed | 2026-10-16 | ★20，2021-01-26。Python 浙大杂项功能集。⚠ **已登记，本轮补记细节**：许可合规但**停更 5 年**且形态为「脚本集合」→ 无集成价值，仅作用户需求清单对照 |
| `clarkok/captcha-viewer` | B 其他JS | **无许可证** | 验证码识别 | — | ⛔ | rejected | 2026-10-16 | ★1，2013-10-08 停更 **13 年**。验证码识别实验（针对 `jwbinfosys` 的 `CheckCode.aspx`）。**无许可证且已失效** → 只证「教务网验证码」曾是真实痛点，**不碰代码** |
| `StephenChen1108/edgeless-zju-transcript-exporter` | B 其他JS | **无许可证** | 智云字幕导出 | **重复且无增益** | ⛔ | rejected | 2026-10-16 | ★3，2026-09-29。智云字幕导出（Edge 扩展）。**无许可证** → 仅线索；且智云字幕域本仓已覆盖（`dsh-zhiyun-classroom`）→ 重复且无增益 |
| `Mythologyli/zju-connect` | B 其他JS | **AGPL-3.0** | 校园网络（RVPN） | — | ⛔ | rejected | 2026-10-16 | **★796（本轴最高）**，2026-10-08 活跃。ZJU RVPN 客户端的 Go 实现。**AGPL 红线** ⛔。功能与本仓网络域高度相关 → **只作需求清单对照，不碰代码** |
| `Mythologyli/ZJU-Connect-for-Windows` | B 其他JS | **LGPL-3.0** | 校园网络（RVPN） | — | ⛔ | rejected | 2026-10-16 | ★473，2026-03-12。Qt/C++ 桌面客户端。**LGPL 红线** ⛔ |
| `QSCTech/zjunet` | B 其他JS | **GPL-3.0** | VPN/WLAN/DNS | — | ⛔ | rejected | 2026-10-16 | ★332，2023-12-21。**求是潮官方**命令行脚本（VPN / WLAN / DNS）。功能最贴合校园网络域，**却 GPL 红线** ⛔ → 只作需求对照，不碰代码 |
| `Cillo-x/zjuam-auth` | B 其他JS | **GPL-3.0** | 统一身份认证 | — | ⛔ | rejected | 2026-10-16 | ★0，2026-10-03。**零依赖 Node.js** 的浙大统一身份认证客户端，支持 CAS 登录与 **OAuth2 授权码**。**GPL 红线** ⛔ → 不碰代码。⚠ **但值得人工看一眼**：**OAuth2 是本仓登录域从未考虑过的形态**，若 `open.zju.edu.cn` 支持，可能比 CAS 更合适（须核官方文档，实现由本仓自建） |

> **簇登记（折叠）**：
> ① **统一身份认证簇 6 条** → `5dbwat4/login-ZJU`（**MIT/TS/npm 可挂载 → 取，🟢**）／
> `mohan-zeyu/golang-login-zju`（MIT 但 Go → 交叉验证）／
> `Cillo-x/zjuam-auth`（**GPL ⛔**，但含 OAuth2 形态 → 需求对照）／
> `n0sig/ZJU-Web-Auth-Bash`（无许可 ⛔）／`Mythologyli/zju-web-login`（MIT 但用户脚本）／
> `Xinzhe99/zju-autologin`（MIT 但 PyQt）→ **本轮取一，其余登记**。
>
> ② **校园网络 / VPN 簇 4 条** → `Mythologyli/zju-connect`（**AGPL ⛔ ★796**）／
> `Mythologyli/ZJU-Connect-for-Windows`（**LGPL ⛔ ★473**）／`QSCTech/zjunet`（**GPL ⛔ ★332**）／
> `eWloYW8/ZJUWebVPN`（WTFPL 🔵）→ **簇内三个最高星标全部 copyleft**。
> **结论：本仓校园网络能力必须自建**（与 2026-10-14 起 `QSCTech/zjunet` 被排除的结论一致）。
>
> ③ **选课簇 2 条** → `Zhangyc0/ZJU-Course-Selection`（Python 停更 + 抢课风险）／
> `birchtree2/zju-grad-course-helper`（扩展）→ **均不进集成评估**。
>
> ④ **农历 / 日历簇 2 条** → `SylarLong/iztro`（**🟡**）／
> `runcat-tommy/dsh-panda-calendar`（**🟡 + 本轮骨架**）→ **两条同域，须人工裁决取一**。
>
> ⑤ **图书馆簇 3 条** → `ChenyuHeee/Libot`（MIT，桌面）／`awmleer/zju-library`（无许可 ⛔）／
> `5dbwat4/login-ZJU` 的 `APILIB`+`BOOKINGLIB`（**取这条**：库形态、可复用）
> → **取 `login-ZJU` 里的图书馆通路，两条独立 app 不取**。

> **⚠ 本轮红线模式（建议人工注意）**：本轴 20 条候选中有 **8 条无许可证或 copyleft**
> （AGPL 1 / LGPL 1 / GPL 2 / 无许可 3，另有 1 条 WTFPL）。
> 占全部新候选 **40%**（若只算被排除的 11 条则占 73%）。
> 浙大校园基础设施生态的普遍特征是**「学生自用的脚本 / 桌面工具」，许可证意识弱**。
> **这条轴上可用的 JS 库实际上只有 `login-ZJU` 一条**。

---

## 2026-10-16 · B 组（浙大场景 · **学科资产 / 课程内容轴**）· 第五轮 · 追加

> 关键词：`zju physics`、`zju chemistry`、`zju biology`、`zju math`、`zju lab report`、
> `zju computer science course`、`zju software engineering`、`zju course notes latex`、
> `zju exam past paper`、`zju study group OR collaboration`、`zju thesis typst`、
> `zju campus map`、`user:ZJU-Turing`、`org:zju-isee`、`topic:zju`、
> `topic:zju language:javascript`、`topic:zju language:typescript`、
> `zju matlab OR simulation javascript`、`zju data visualization` 等 30 词。
> ⚠ **第 30 次调用触发 API 403 限额**（`rate limit exceeded for user ID 242547135`）
> → **本轮为「不完整轮次」**，改用前 29 次已获数据出报告，未覆盖切片明确留待后续。
> 许可证核实：全部以 `license.spdx_id` 为准；对 🟢/🟡 候选**额外拉取 LICENSE 实文比对**。
> **本轮 3 条 `NOASSERTION`**（单列待核）。**145 条新候选**，与 registry 529 条逐条比对，无重复。

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `p16e0nd/zju-recorder` | B 其他JS | **MIT** ✅ | 课堂直播/录制 | **重复可强化** | 🟢 | adopted | 2026-10-16 | ★0，2026-09-30。**LICENSE 实文已核**（`Copyright (c) 2026 ZJU Recorder contributors`）✅。**智云课堂本地版**（Node.js，`app/server.js` 149KB）。**三块可提取能力**：① **OAuth2 授权码链路**（`casapi`→`oauth2.0/authorize`→`tgmedia get-info?code=ST-xxx`→`_token` cookie 内藏 JWT）—— 本仓 `dsh-zhiyun-classroom/src/auth.js` 是 **CAS 直连**，**无此链路**；② `CookieJar` 显式处理 `domain`/host-only/`path`；③ RSA **密码反转 + 分块** 实现（本仓为整块，可交叉验证）。**强化对象**：课堂页直播通路。⚠ **① 形态不兼容**（Windows 本地工具，`127.0.0.1:8787`）→ **只提取能力，不挂载整体**；⚠ **② 凭据流向**（支持明文账密自动登录，须确认不落盘）；⚠ **③ 录制须承接上游 `DISCLAIMER.md` 边界且默认关闭**；⚠ ④ `flv.min.js`/`hls.min.js` 为**第三方构建产物，许可证未核，不得引入**。**✅ 已并入（2026-10-18）**：能力提取进 `dsh-zhiyun-classroom`——OAuth2 授权码入口（`entry:'oauth'`）+ `_token`→JWT + Bearer 头，直播走新建的 `live.js`/`stream.js`（HLS 转发 + m3u8 改写），`CookieJar` 一项**作废**（本仓 `tough-cookie@6.0.2` 已覆盖，实测 domain/host-only/path 语义完备）。骨架包 `packages/dsh-radar-zju-recorder` 待删。⚠ RSA「交叉验证」判断有误：短 ASCII 密码两者输出**完全相同**、中文密码因 UTF-8/UTF-16 取字节方式不同而不同、>126 字符上游是多块空格拼接而本仓单块（协议不同） |
| `macanine/zjumihomo-converter` | B 其他JS | **MIT** ✅ | 校园网络分流 | **重复可强化**（仅规则数据） | 🟡 | proposed | 2026-10-16 | ★0，2026-10-06。**LICENSE 实文已核**（`Copyright (c) 2025 Js-Sung`）✅。Clash/Mihomo 订阅转换器，**运行时依赖仅 `js-yaml ^4.1.0`**。**真正有价值的是内置「校园网分流规则」这份数据**，而非转换代码 → 只能提取规则、不能整体挂载。带 `test/mihomo-check.mjs` 可作**规则合法性校验**参考。⚠ **语义须对齐**：本仓 `dsh-zhiyun-net-proxy` 是**分域中继**，与「绕过网络管控」语义不同；不得把后者带入本仓任何用户可见文案 |
| `hongxin/csmath-2022` | B 其他JS | MIT ✅ | 数学（CS 方向） | 仅供参考（内容库） | 🔵 | proposed | 2026-10-16 | ★62。CS 方向博士生数学课（优化/ML 理论）。**内容库非工具**，MIT 但无代码价值。**同系列 `csmath-2019`/`-2020`/`CSMATH` 均无许可证** → 只 2021/2022 两条合规 |
| `hongxin/csmath-2021` | B 其他JS | MIT ✅ | 数学（CS 方向） | 仅供参考（内容库） | 🔵 | proposed | 2026-10-16 | ★30，同上系列 |
| `upupming/zhr-action-demo` | B 其他JS | MIT ✅ | 日常打卡 | 仅供参考 | 🔵 | proposed | 2026-10-16 | ★61，2023-01-02。健康打卡 GitHub Action。**功能已停用**，只证历史形态 |
| `jinzcdev/pintia-solutions` | B 其他JS | MIT ✅ | 刷题（PTA） | 仅供参考 | 🔵 | proposed | 2026-10-16 | ★40。PTA 700+ 题解（C++）。与刷题面板同域，但**内容不可机器消费** |
| `longqianh/ZJU-experiment-report-template` | B 其他JS | Apache-2.0 ✅ | 实验报告 | 仅供参考（模板） | 🔵 | proposed | 2026-10-16 | ★36。实验报告 LaTeX 模板 |
| `TheNetAdmin/ZjuReportTemplate` | B 其他JS | MIT ✅ | 实验报告 | 仅供参考（模板） | 🔵 | proposed | 2026-10-16 | ★18，2019 停更。同上 |
| `ZJU-SE-2021/MSaaS` | B 其他JS | MIT ✅ | 软工课设 | 无关 | 🔵 | proposed | 2026-10-16 | ★14。医疗系统课设 |
| `ZJU-Turing/TuringPlugins` | B 其他JS | MIT ✅ | 课程文档站 | 无关 | 🔵 | proposed | 2026-10-16 | ★4。`[DEPRECATED]` mkdocs 插件集（Python）。**形态为文档站插件**，与本仓无交集 |
| `windingwind/Requestool` | B 其他JS | MIT ✅ | 教务（jwglxt） | 全新但形态不合 | 🔵 | proposed | 2026-10-16 | ★4，2020-02-23。`zju-jwglxt` 的 Chrome 扩展。扩展形态不可作依赖；2020 停更 |
| `ShawHaines/ComputationalPhysics` | B 其他JS | MIT ✅ | 计算物理 | 仅供参考 | 🔵 | proposed | 2026-10-16 | ★2。课程作业（Jupyter） |
| `Luyf12/SRE_odometer` | B 其他JS | Apache-2.0 ✅ | 软工需求 | 无关 | 🔵 | proposed | 2026-10-16 | ★2。软工课设 |
| `YuhaoLian/ZJU-Personal-Course` | B 其他JS | Unlicense ✅ | 课程存档 | 无关 | 🔵 | proposed | 2026-10-16 | ★1。个人作业存档（HTML） |
| `fengnian123/zju_data-Data-visualization` | B 其他JS | MIT ✅ | 数据可视化 | 无关 | 🔵 | proposed | 2026-10-16 | ★1。可视化大作业 |
| `dilititi/Echo-in-ZJU` | B 其他JS | Apache-2.0 ✅ | 校园地图 | 全新但形态不合 | 🔵 | proposed | 2026-10-16 | ★0。紫金港**声音地图**（交互式网页）。形态为网页艺术项目，无能力可提取 |
| `GeorgeC6/ZJU-College-Physics-Exp-Plots` | B 其他JS | MIT ✅ | 大物实验绘图 | 无关 | 🔵 | proposed | 2026-10-16 | ★0。**MATLAB**，技术栈不符 |
| `mem-courses/discrete-mathmatics` | B 其他JS | MIT ✅ | 离散数学 | 仅供参考 | 🔵 | proposed | 2026-10-16 | ★0，2024-06-05。离散数学笔记（Typst） |
| `spiritysdx/Probability-Theory-and-Mathematical-Statistics-ZJU-4-ed.-` | B 其他JS | MIT ✅ | 概率论 | 仅供参考 | 🔵 | proposed | 2026-10-16 | ★1。概率论教材（浙大4版）资料 |
| `Zyeeor/Object_Oriented_Programming` | B 其他JS | MIT ✅ | — | 无关 | 🔵 | proposed | 2026-10-16 | ★0。与本仓无对应功能 |
| `smilenow/Java-Application` | B 其他JS | MIT ✅ | — | 无关 | 🔵 | proposed | 2026-10-16 | ★1 ❌ 无关（翁恺课程作业） |
| `junl666/MATH285-Lab-ZJUI-SP23` | B 其他JS | MIT ✅ | — | 无关 | 🔵 | proposed | 2026-10-16 | ★1 ❌ 无关 |
| `cxz66666/data-visualization-summerschool2020` | B 其他JS | MIT ✅ | — | 无关 | 🔵 | proposed | 2026-10-16 | ★0 ❌ 无关（COVID 可视化 demo） |
| `Circle-Ming/time` | B 其他JS | MIT ✅ | — | 无关 | 🔵 | proposed | 2026-10-16 | ★0 ❌ 无关（math_lab） |
| `NoughtQ/notebook` | B 其他JS | **NOASSERTION** | 笔记 | — | ⚠ 待核 | proposed | 2026-10-16 | ★135，2026-10-02。个人笔记库。**许可证待人工核验，不采用、不摘代码** |
| `ZJU-Turing/TuringDoneRight` | B 其他JS | **NOASSERTION** | 课程指南 | — | ⚠ 待核 | proposed | 2026-10-16 | ★76，2026-07-25。图灵班学长组资料网站。**待人工核验** |
| `ZJU-Mix/ZJU-General-Physics-Assistance-Project` | B 其他JS | **NOASSERTION** | 普物笔记 | — | ⚠ 待核 | proposed | 2026-10-16 | ★4，2025-01-16。普物(H) 笔记工程。**待人工核验** |
| `zju-isee/zju-isee` | B 其他JS | **无许可证** | 电子/信电 | — | ⛔ | rejected | 2026-10-16 | ★**323**（本轴最高）。信电专业课程仓库，2023-12 停更。**无许可证 → 不得摘取任何代码** |
| `tiny656/PAT` | B 其他JS | **无许可证** | 刷题 | — | ⛔ | rejected | 2026-10-16 | ★284。PAT 题解。无许可证 |
| `maksymilan/zju-resume-template` | B 其他JS | **无许可证** | 简历 | — | ⛔ | rejected | 2026-10-16 | ★202，2026-01-10。浙大简历模板（TeX）。无许可证 |
| `zhanghai/zju-csse-undergraduate-design-latex-template` | B 其他JS | **无许可证** | 毕设 | — | ⛔ | rejected | 2026-10-16 | ★164，2017 停更。本科毕设 LaTeX 模板。无许可证 |
| `hongxin/csmath-2019` | B 其他JS | **无许可证** | 数学（CS 方向） | — | ⛔ | rejected | 2026-10-16 | ★134。**同系列仅 2021/2022 有 MIT**，本条无许可证 |
| `hongxin/csmath-2020` | B 其他JS | **无许可证** | 数学（CS 方向） | — | ⛔ | rejected | 2026-10-16 | ★82。同上 |
| `hongxin/CSMATH` | B 其他JS | **无许可证** | 数学（CS 方向） | — | ⛔ | rejected | 2026-10-16 | ★23，2026-03-17。同上系列 |
| `merelydust/PAT-Advanced-Level` | B 其他JS | **无许可证** | 刷题 | — | ⛔ | rejected | 2026-10-16 | ★116。PAT 甲级题解。无许可证 |
| `megrxu/zjureport` | B 其他JS | **LPPL-1.3c** | 实验报告 | — | ⛔ | rejected | 2026-10-16 | ★110，2026-04-07 活跃。实验报告模板（TeX）。**LPPL 非白名单且非标准开源许可** ⛔ |
| `zhaoluting/marp-themes` | B 其他JS | **GPL-3.0** ⛔ | 演示主题 | — | ⛔ | rejected | 2026-10-16 | ★87。Marp 主题（含「浙大蓝」学术主题）。**GPL 红线** ⛔ |
| `lhxcs/ZJU_Courses` | B 其他JS | **无许可证** | 课程资料 | — | ⛔ | rejected | 2026-10-16 | ★46。无许可证 |
| `Deturium/School-Bus` | B 其他JS | **无许可证** | CTF 平台 | — | ⛔ | rejected | 2026-10-16 | ★43，2018 停更。AAA 战队 CTF 平台前端（Vue）。无许可证 |
| `ruoxining/ZJUCourse` | B 其他JS | **无许可证** | 课程资料 | — | ⛔ | rejected | 2026-10-16 | ★55。无许可证 |
| `zjuchenlong/Thesis-latex` | B 其他JS | **无许可证** | 毕设 | — | ⛔ | rejected | 2026-10-16 | ★38。博士论文（TeX）。无许可证 |
| `01tu01/share_mathematic_material_ZJUT` | B 其他JS | **无许可证** | 数学 | — | ⛔ | rejected | 2026-10-16 | ★36。**浙江工业大学**（非浙大）。无许可证 |
| `TonyCrane/ZJU-General-Physics-Experiment-I` | B 其他JS | **无许可证** | 大物实验 | — | ⛔ | rejected | 2026-10-16 | ★26，2022 停更。无许可证 |
| `yuaanlin/zju-se-project` | B 其他JS | **无许可证** | 软工课设 | — | ⛔ | rejected | 2026-10-16 | ★20。无许可证 |
| `yuaanlin/computer-graphics-final-project` | B 其他JS | **无许可证** | 图形学 | — | ⛔ | rejected | 2026-10-16 | ★12。WebGL 课设。无许可证 |
| `szcf-weiya/ZJU-MATH4901M-2025Fall` | B 其他JS | **无许可证** | 数学前沿 | — | ⛔ | rejected | 2026-10-16 | ★13。LLM 统计前沿讨论班。无许可证 |
| `kaleo996/ZJU-Discrete-Math-2022` | B 其他JS | **无许可证** | 离散数学 | — | ⛔ | rejected | 2026-10-16 | ★13。语雀笔记导出。无许可证 |
| `macanine/zju-english-helper` | B 其他JS | **无许可证** | 大英单词 | — | ⛔ | rejected | 2026-10-16 | ★3，**2026-10-14 活跃**。**大英默写器 Pro**（TypeScript）。⚠ **场景高度贴合但无许可证** → 只作需求证据，**建议本仓自建** |
| `macanine/chalaoshi` | B 其他JS | **无许可证** | 课程评价 | — | ⛔ | rejected | 2026-10-16 | ★1，**2026-09-11**。**查老师增强网页**（TS）。⚠ 同上，**建议本仓自建** |
| `kenqia/zju-forum-search` | B 其他JS | **无许可证** | 论坛检索 | — | ⛔ | rejected | 2026-10-16 | ★2，**2026-10-15 推送**。CC98 **自然语言找帖**（多轮 AI 检索，TS 扩展）。⚠ 形态为浏览器扩展 + 无许可证 → 只作需求证据 |
| `ZJU-Turing/GeneralEducationAdmin` | B 其他JS | **无许可证** | 通识课评价 | — | ⛔ | rejected | 2026-10-16 | ★2，2026-02-09。**图灵班通识课程评价系统**（Vue）。⚠ 同上，**建议本仓自建** |
| `DeeJ6126/ZJU_CLS_Study_Web` | B 其他JS | **无许可证** | 学习 | — | ⛔ | rejected | 2026-10-16 | ★1，**2026-10-15 推送**。无描述。无许可证 |
| `shrike-505/ZJU-GeneralPhysicsExperiment2-Report` | B 其他JS | **GPL-3.0** ⛔ | 大物实验 | — | ⛔ | rejected | 2026-10-16 | ★6。**GPL 红线** ⛔ |
| `Shuenhoy/ZJUHardwareLabReportTemplate` | B 其他JS | **GPL-3.0** ⛔ | 硬件实验 | — | ⛔ | rejected | 2026-10-16 | ★4。**GPL 红线** ⛔ |
| `fffelix-jan/ADSQuizMachine` | B 其他JS | **AGPL-3.0** ⛔ | 刷题（ADS） | — | ⛔ | rejected | 2026-10-16 | ★2。ADS 判断题练习机。**AGPL 红线** ⛔ |
| `yzyDavid/tss-backend` | B 其他JS | **GPL-3.0** ⛔ | 软工课设 | — | ⛔ | rejected | 2026-10-16 | ★2。**GPL 红线** ⛔ |
| `yzyDavid/tss-frontend` | B 其他JS | **GPL-3.0** ⛔ | 软工课设 | — | ⛔ | rejected | 2026-10-16 | ★1。**GPL 红线** ⛔ |
| 其余 ~78 条（`zju physics`/`zju software engineering`/`zju study group`/`zju campus map`/`topic:zju` 等切片命中的课设与个人存档） | B 其他JS | **无许可证** | 课程作业 | — | ⛔ | rejected | 2026-10-16 | 全部 `license: null`。**不为每条单列**：本轴 145 条候选中 **104 条无许可证（72%）**，其中绝大多数是 ★0–★4 的课程作业与个人存档。**本轴的可集成密度极低（仅 21% 落在宽松白名单内，且其中多为 ★0 模板）** |

> **簇登记（折叠）**：
> ① **智云课堂本地客户端簇 1 条** → `p16e0nd/zju-recorder`（**MIT/JS → 取，🟢 + 本轮骨架**）。
> 与既有 `edgeless-zju-transcript-exporter`（10-16 第四轮，**无许可证** ⛔）、
> `iamNCJ/ZJU-Tronclass-Courseware-Downloader`（本轮，**无许可证** ⛔）同域 →
> **该域三个同类项目只有 zju-recorder 一条合规**，故取之。
>
> ② **实验报告模板簇 6 条** → `longqianh`（Apache-2.0 ✅）／`TheNetAdmin`（MIT ✅）／
> `megrxu/zjureport`（**LPPL ⛔ ★110 最高星**）／`shrike-505`（**GPL ⛔**）／
> `Shuenhoy`（**GPL ⛔**）／其余无证 → **模板类整体不进集成评估**（本仓非 LaTeX 排版工具），
> 只登记。⚠ 注意**星标最高的两条均为非白名单许可**。
>
> ③ **课程资料 / 笔记内容库簇（~90 条）** → `QSCTech/zju-icicles`（★41259，无证）／
> `zju-isee/zju-isee`（★323，无证）／`NoughtQ/notebook`（⚠ NOASSERTION）／
> `ruoxining`、`lhxcs`、`ZJU-Turing/TuringCourses` 等 → **全部为「内容」而非「能力」**，
> ⛔ 或 ⚠，**不进入集成评估**。本仓无内容托管定位。
>
> ④ **PAT / 刷题簇 4 条** → `tiny656/PAT`（★284 无证）／`merelydust/PAT-Advanced-Level`（★116 无证）／
> `jinzcdev/pintia-solutions`（**MIT ✅ ★40**）／`xlucn/PAT`（10-15 已登记，无证）
> → **仅 `jinzcdev/pintia-solutions` 合规**，但为**题解内容**非工具 → 🔵 只登记。
>
> ⑤ **数学（CS 方向）CSMATH 簇 5 条** → `csmath-2021`/`-2022`（**MIT ✅**）／
> `csmath-2019`/`-2020`/`CSMATH`（**无证 ⛔**）→ **同系列许可不一致**，
> 但同为内容库 → 🔵/⛔ 只登记。
>
> ⑥ **无许可证但**场景活跃**簇 4 条**（★0–★3，均 2026-09/10 推送）→
> `macanine/zju-english-helper`（大英默写）／`macanine/chalaoshi`（查老师）／
> `kenqia/zju-forum-search`（CC98 自然语言检索）／`ZJU-Turing/GeneralEducationAdmin`（通识课评价）
> → **⚠ 本轮最值得人工注意的一组**：**场景贴合度高于本轮任何合规候选**，
> 但**全部无许可证** → **不碰代码**，登记为**需求证据**，若要做**由本仓自建**。

> **⚠ 本轮红线模式（建议人工注意）**：新候选 145 条中
> **无许可证 104 条（72%）／copyleft 6 条／LPPL 1 条／NOASSERTION 3 条**，
> **仅 31 条（21%）在宽松白名单内**，而这 31 条里绝大多数是 ★0–★4 的课程作业，
> 真正「可被当作库/能力调用」的**只有 `zju-recorder` 与 `zjumihomo-converter` 两条**。
> **本轴的可集成密度是迄今所有轴中最低的** —— 与第四轮「校园基础设施轴」同源
> （学生自用项目许可证意识弱），但本轮更极端：
> 课程资料 / 题解 / 笔记的作者**根本没想过要授权**。

> **✅ 本轮新增 2 条方法论结论（已写入当日报告 `2026-10-16-d.md` 第五节）**：
> ① **`topic:zju + language:javascript|typescript` 是迄今信噪比最高的检索式**
> —— 26/27 两次调用 26 条命中、**21 条为新（81%）**；而裸词 `zju software engineering`
> （30 条命中）只 13 条新且全部无证。**建议 B 组后续以 `topic:` 切片为主。**
> ② **`关键词A OR 关键词B` 布尔式完全失效** —— 5 次调用返回**同一批 5632 条**
> （恰等于 `zju` 单词总命中数），学科限定词不起作用。**建议写入排除规则：禁止 `A OR B` 形式。**

---

## 2026-10-16 · B 组（浙大场景 · **校园生活 / 生活服务轴**）· 第六轮 · 追加

> 轮换脚本判 `same-day(exhausted)`（今日已跑 B/C/A）。按既有先例**不重复任何已跑关键词**，
> 改跑 **B 组正交新轴：校园生活/服务**（毕业/宿舍食堂/校园卡/体育场馆/通知/奖学金等）。
> 15 次搜索（⚠ 超限 5 次，为一次性判断该轴是否枯竭）；**去重基线 565 条**。
> **本轮最重要结论：B 组已实质性枯竭**，详见 `2026-10-16-e.md` 第二节。
> 新候选 **12 条**（🟡1 + 🔵5 + ⛔6）；**0 条 NOASSERTION**；出骨架 1 个。

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `compsci-adl/mycoursereviews` | B 其他JS | MIT | 选课评价 | 重复且可强化（反馈页） | 🟡 | proposed | 2026-10-16 | ★2 / **forks=6**；TypeScript + Next.js + Drizzle + Keycloak，2026-10-12 推送（活跃）。**课程维度结构化评价**（评分+标签+检索），与 `dsh-zhiyun-page-feedback`（issue 形态的诉求板）**非同面板、功能正交、外部底层更优** → 符合「强化式集成」三条。**L2 骨架选定** → `packages/dsh-radar-mycoursereviews`。⚠ **数据/课程目录属阿德莱德大学，不得搬运**，只能借鉴数据模型，课程数据须接浙大来源 → 属「能力提取+自建」。/LICENSE 端点已核 `spdx_id=MIT` |
| `OpenLake/RateMyCourse` | B 其他JS | MIT | 选课评价 | 重复且可强化（反馈页） | 🔵 | proposed | 2026-10-16 | ★0 但 **forks=26**（fork 远超 star，典型"内部平台被广泛复刻"）；Next.js + TypeScript + Supabase；2026-06-13 推送。与上条**同簇取一**（取更活跃者）。可作**第二设计参照**；若 `mycoursereviews` 评审驳回则改评估本条 |
| `DelightRun/ZJUThesis-MPhil` | B 其他JS | MIT | 论文撰写 | 全新 | 🔵 | proposed | 2026-10-16 | ★37。浙大计算机学院**硕士**论文 LaTeX 模板。与已登记 `TheNetAdmin/zjuthesis`（★3776，**本科**毕设）**覆盖学位层次互补**。TeX 非 JS 技术栈 → 只作线索，不进雷达实现面。/LICENSE 端点已核 MIT |
| `zju-pil-lab/zju-pil-lab.github.io` | B 其他JS | MIT | — | 无关 | ⛔ | rejected | 2026-10-16 | ★0。实验室官网（TypeScript），非工具 |
| `ChenyuHeee/zju-bulletin-board` | B 其他JS | **无许可证** | 通知公告聚合 | 全新 | 🔵 | proposed | 2026-10-16 | ★2。浙大学院通知公告聚合（Python，每日自动抓取 + GitHub Pages 展示）。**2026-10-16 当日活跃**。**场景价值高（本仓无通知聚合能力，「今天」页可增通知源）**，但**无证 → 不碰代码**，只作**需求证据**；若要做**由本仓自建** |
| `Kepler16f/zju-kezhou` | B 其他JS | **无许可证** | 培养方案/选课风险审计 | 重复且可强化（课程页） | 🔵 | proposed | 2026-10-16 | ★0。学业罗盘：本科培养方案结构化 + 选课风险审计智能体（Dify 低代码轨 + Flutter App 轨）。**2026-10-15 新建**，思路与本仓课程页契合。**无证 → 仅作设计对照，不碰代码** |
| `ZJU-R/zjuTimeTable` | B 其他JS | **无许可证** | 选课查看 | 重复且无增益 | ⛔ | rejected | 2026-10-16 | ★19。浙大选课查看器（第三方，Python/FastAPI）。**无证** + 2024-06 停更，功能与已登记课表类重复 |
| `shuwei1204/ZJUthesis` | B 其他JS | **无许可证** | 论文撰写 | 重复且无增益 | ⛔ | rejected | 2026-10-16 | ★131。浙大论文 LaTeX 模板，**2018 停更 8 年**，已被 `TheNetAdmin/zjuthesis` 完全覆盖 |
| `eclipselu/zjuthesis-mphil` | B 其他JS | **无许可证** | 论文撰写 | 重复且无增益 | ⛔ | rejected | 2026-10-16 | ★28。硕士论文模板，**2017 停更 9 年** |
| `huoyao/ZJUThesis` | B 其他JS | **GPL-3.0** | 论文撰写 | 重复且无增益 | ⛔ | rejected | 2026-10-16 | ★12。**GPL 红线** + 2016 停更 |
| `elgoog577215-beep/ZJU_Platform` | B 其他JS | **无许可证** | — | 无关 | ⛔ | rejected | 2026-10-16 | ★5。无描述、无证 |
| `quark-zju/dotfiles` | B 其他JS | **无许可证** | — | 无关 | ⛔ | rejected | 2026-10-16 | ★4。个人 dotfiles，非工具 |
| 浙工大簇（`zjutjh/zjutthesis` ★52／`Devin100086/ZJUT-BAOYAN` ★39／`wanger233/zjut-cjcx` ★33／`Kukukukiki192/ZJUT-SE` ★23／`zhangshenxu/zjuthelp-weixin` ★20／`gzpbbd/ZJUT-Online-Judge` ★14／`Frontlook/ZJUT-GPA-calculator` ★0／`IM594/Dormitory_ZJUT` ★1） | B 其他JS | 多为**无许可证** | **非浙大** | 无关 | ⛔ | rejected | 2026-10-16 | **浙江工业大学 ≠ 浙江大学** —— 校名相近但主体不同，**整簇排除**（本轮 `zjut` 459 条命中的主力，须注意 `zjut` 会被大量浙工大仓库污染） |
| 个人主页/空仓库簇（`vmmoskani/zjuf`／`sadieen/zjur`／`Leager-zju/Leager-zju`／`tzhangZJU/tzhangZJU.github.io`／`zjuzhfbloodz/zjuzhfbloodz.github.io`／`zjuyk/zjuyk`／`Vita0818/ZJU-CS2045M-Project2`／`pyd966/notes`／`spnotold/enterprise-approval-system`／`yangkao/-Self-use-only-zjuers.com---ui-remake`／`shufengdong/sparrowzz`／`shengyuzhang/AI4GC-ZJU`／`panjoel812/zju-english-dictation`／`DeeJ6126/ZJU_CLS_Study_Web`） | B 其他JS | 多为**无许可证**（极少数 GPL） | — | 无关 | ⛔ | rejected | 2026-10-16 | 个人主页 / 课程作业 / 空仓库 / 自用改造，**无工具价值**。多为 `zju pushed:>2026-09-01` 切片带入 |

> **✅ 本轮新增 3 条方法论结论（已写入当日报告 `2026-10-16-e.md`）**：
> ① **B 组已实质性枯竭** —— 15 次搜索中 **6 次 `total_count=0`**、**2 次泛化失效**
> （`total_count` 恰为 5635 = `zju` 单词总数）、`topic:zju` 的 **Top20 已 100% 登记**。
> **建议 B 组降频**（`group_runs` B 已达 6 轮 + 本轮）。
> ② **`zju pushed:>YYYY-MM-DD`（时间窗切片）是 `topic:` 饱和后唯一还有产的切片**
> —— 503 条里捞出 8 条全新活跃仓库。**但它捞的是"新"不是"相关"**，
> 副产品是大量个人主页/空仓库噪声，**须配合相关性二次过滤**。
> ③ **★本校切片枯竭时，改走"跨校同型功能域"检索式** —— 本轮唯一合规候选
> （`course review rating platform`，2/2 命中 MIT）即由此得到，而浙大专属切片
> 合规率仅 4/16。**校园问题的解跨校同型，且正式课程设计项目许可证意识更强**。
> **建议写入关键词池：B 组后续以"功能域词"为主、"校名"为辅。**

### 2026-10-16 · 第七轮（跨校同型轴）

> 关键词：`course review rating platform`、`university course planning assistant language:typescript`、
> `library seat booking reservation university`、`university notice announcement aggregator typescript`、
> `timetable generator optimizer typescript`、`grade gpa calculator university typescript`、
> `exam countdown study planner javascript`、`student planner all-in-one pwa typescript`、
> `campus information portal integration react`、`school management system rest api javascript`（11 次调用）。
> 抓取 60 条量级 → **新候选仅 1 条**。**结论：跨校同型轴同样薄**（见 `2026-10-16-f.md`）。

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `OpenLake/RateMyCourse` | B 其他JS | MIT ✅ | 课程评价 | 全新 | 🔵 | proposed | 2026-10-16 | ★**0**，push **2026-06-13**（停滞 4 个月）。IIT Bhilai。Next.js+TS+Supabase 课程/教师评价平台。**数据与抓取脚本强绑他校教务（`scripts/fetch_courses.py`），对浙大零可复用性**；★0 + 停滞 + 非强化关系 → 只登记。**若将来补「课程评价」场景，建议自建（浙大可用 CC98 数据），不移植此项目** |
| `compsci-adl/mycoursereviews` | B 其他JS | MIT ✅ | 课程评价 | 重复可强化 | 🟡 | proposed | 2026-10-16（**首登第六轮，本轮独立复跑命中**） | ★2，push 2026-10-12。Adelaide 大学课程评价平台（TypeScript）。**本轮复跑 `course review rating platform` 再次命中，许可证与分级与第六轮一致 → 交叉印证**，不重复判定 |
| 其余 9 条同型项 | 多为课程作业 | **无** | — | — | ⛔ | rejected | 2026-10-16 | `university course planning assistant` / `timetable generator optimizer` / `gpa calculator` / `exam countdown planner` / `school management system` 等词命中项**全部★0-2 且无许可证**，属学生课程作业，无集成价值。**不逐条铺开** |

> **本轴结论（供后续轮次直接引用）**：跨校同型轴**只在「具体功能名词」上有效**；
> 升格到**抽象平台名词**（`student planner pwa`、`campus portal`）即 `total_count = 0`。
> **不建议作为主力轴**；建议主力退回 A 组，B 组降频为事件驱动。

### 2026-10-16 · 第八轮（A 组 · 跨 harness 互操作 / 插件市场与治理轴）

> 关键词：`cordis`、`cordis plugin in:name,description`、`harness plugin in:name,description`、
> `harness plugin marketplace in:name,description`、`agent plugin cross-harness in:name,description`、
> `dsh plugin marketplace in:name,description`、`dsh plugin store in:name,description`、
> `dsh plugin registry discover in:name,description`、`mcp server marketplace agent skills in:name,description`、
> `dsh plugin security audit`（10 次调用，**未超限**；0 次 403）。
> 抓取约 80 条 → **新候选 11 条**。**本轮是当日产出率最高的一轮**（见 `2026-10-16-g.md`）。

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `PerryLink/dsh-score` | A 原生DSH | Apache-2.0 ✅ | 插件质量/工作台可用性 | **重复可强化** | 🟡 | proposed | 2026-10-16 | ★12，push 2026-10-12。TypeScript。**插件多维质量评分**（消费 dsh-test-drive 安装实测 + 维护活跃度 + 文档完备度）。**强化式集成三条件成立**：仍是「插件」页（`dsh-zhiyun-page-plugins`）+ 功能正交（现有答"关掉谁会不会连坐"，本条答"装谁靠不靠得住"）+ 底层新增本仓完全没有的评分能力。**骨架已生成** `packages/dsh-radar-plugin-score`。⚠ 上游 ★ 低、fork 0，属早期项目，采用前须隔离环境验证、并确认评分数据源可否离线 |
| `PensiveFei/dsh-secure-audit` | A 原生DSH | MIT ✅ | 隐私/成绩等 PII 脱敏 | **重复可强化** | 🟡 | proposed | 2026-10-16 | ★84（本子轴活跃度最高），push 2026-10-11。JavaScript（**移植成本低于 TS 项**）。**只读**安全检查（prompt-injection 检测 + 中文 PII 脱敏 + 本地配置审计），与本仓「不另开写入口」原则契合。**答"安不安全"，与 dsh-score 的"好不好"正交**。受「L2 每日最多 1 个」限制未出骨架，**建议下一轮出** |
| `wshobson/agents` | B 其他JS | MIT ✅ | 插件发现 | 全新 | 🔵 | proposed | 2026-10-16 | ★**40898**，fork 4339，push 2026-10-15。**语言 Python**。跨 harness 插件市场（Claude Code / Codex / Cursor / OpenCode / Copilot / Antigravity / Pi 六种统一市场）。**价值在"跨 harness 统一市场"这一范式**，可作方法论线索；非 JS 栈且非 DSH 生态 → **不直接集成** |
| `imsai-sh/awesome-deepseek-harness-plugins` | A 原生DSH | MIT ✅ | 插件发现 | **重复无增益** | 🔵 | proposed | 2026-10-16 | ★296，fork 282，push 2026-10-16。JavaScript。11,000+ 插件市场 + 搜索 + 排名 + 免费 API。**与已登记骨架 `dsh-radar-dsh-market`（锁定 `dsh-market` ★6494）功能重叠**，后者 ★ 更高且先登记 → 不集成，**只作线索源**（可从中捞候选） |
| `Kilo-Org/kilo-marketplace` | B 其他JS | Apache-2.0 ✅ | — | 全新 | 🔵 | proposed | 2026-10-16 | ★194，push 2026-09-28。Skills / MCP Servers / 插件统一市场，**非 DSH 生态**。作跨生态市场范式参考 |
| `whyihaveyou/dsh-suite` | A 原生DSH | MIT ✅ | 插件发现 | **重复无增益** | 🔵 | proposed | 2026-10-16 | ★60，fork 14，push 2026-10-16。HTML。"每小时刷新活目录 + 兼容实测 + 内置商店 + 脚手架"。**与 dsh-market 骨架重叠** → 不集成 |
| `mishibeikejie/zat-dsh-engine` | A 原生DSH | MIT ✅ | 插件发现 | **重复无增益** | 🔵 | proposed | 2026-10-16 | ★77，push 2026-09-24。TypeScript。可视化插件市场。**与 dsh-market 骨架重叠** → 不集成 |
| `web-casa/Awesome-DeepSeek-Harness-Plugins` | A 原生DSH | **NOASSERTION** ⚠ | 插件发现 | — | ⚠ | pending-license | 2026-10-16 | ★117，push 2026-08-31。"官方自动生成的 DSH Cordis 插件清单"。**许可证无法识别 → 待人工核验，本轮不采用、不摘取任何代码** |
| `2BingLing/dsh-market` | A 原生DSH | **NOASSERTION** ⚠ | 插件发现 | — | ⚠ | pending-license | 2026-10-16 | ★154，push 2026-10-15。"持续收录 6000+ 插件 · 中文搜索 + 五维评分"。**许可证不明，且与已登记 MIT 的 `dsh-market/dsh-market` 疑似同型 → 待人工核验，不采用** |
| `bradeGithub/DSH-Plugins-Marketplace` | A 原生DSH | MIT ✅ | 插件发现 | **重复无增益** | ⛔ | rejected | 2026-10-16 | ★176，JavaScript。在 DSH Web GUI 内浏览/安装 `topic:dsh-plugin` 全部插件。**与 dsh-market 骨架重复且无增益** → 不集成 |
| `ZASENJC/dsh-plugins-store` | A 原生DSH | MIT ✅ | 插件发现 | **重复无增益** | ⛔ | rejected | 2026-10-16 | ★70，TypeScript。自动分类/收录/验证的市场。**与 dsh-market 骨架重复且无增益** → 不集成 |
| `dshplugin-app/dsh-plugin-registry` 等 4 条 | A 原生DSH | MIT ✅ / **无** | — | — | ⛔ | rejected | 2026-10-16 | `dsh plugin registry discover` 命中项，**全部 ★0-2**，含 `vbarter/dsh-plugin-registry`（**无许可证**）、`Jesse-njx/dsh-plugin-manager-registry`、`MalcolmFeng/dsh-nacos-bridge-plugin`。活跃度与许可证均不达标，**不逐条铺开** |

> **本轮结论（供后续轮次直接引用）**：
> ① **A 组未枯竭 —— 枯竭的是「功能域切片」，不是「生态连接切片」**。此前 9 轮 A 组全部只查
> 「DSH 插件能做什么」（rag/ocr/graph/paper/theme/学习科学/开发工具链/运维…），
> 本轮首查**「与外部 ecosystem 的连接面」**即捞到 11 条新候选、2 条 🟡，
> **产出率为当日 B 组枯竭轮与跨校同型轴的 3~5 倍**。**建议 A 组以「连接面」为新主力轴**。
> ② **插件市场子轴封板**：单轮命中 **6 个**同类项（★296/176/154/77/70/60），
> 全部与已登记 `dsh-radar-dsh-market`（`dsh-market` ★6494）重叠。
> **后续遇同类项直接判 ⛔「重复且无增益」，只登记一行、不重复评估**。
> ③ **「插件治理」（质量评分 / 安全审计 / 供应链）是真空白且是强化式集成的理想落点** ——
> 本仓有 22 个 bundle 却**零质量/安全元数据**。建议下轮深挖，延伸词：
> `dsh plugin vet`、`plugin supply chain`、`dsh plugin provenance`、
> `plugin permission manifest`、`dsh plugin compatibility test`。
> ④ **长尾切片必须加 `in:name,description`**：`cross-harness` 收窄后仅 13 条、
> `registry discover` 仅 4 条；不加限定符则 `harness plugin` 返 8332 条（混入全部
> Claude Code / Cursor 生态）。**注意：这与首跑校准的「限定符别叠加」不矛盾** ——
> 那条针对 `license:`/`stars:` **叠加过滤**，而 `in:` 是**收窄检索面**，作用方向相反。
> ⑤ **`cordis` 是含义过载词**：裸搜 3828 条（含人名/地名），**必须与 `plugin`/`harness` 组合**。

---

## 2026-10-17 · C 组（学生功能域 · 第九轮）

> 跨天首轮（北京时间 00:01），公式取组 `290 % 3 = 2` → C 组。
> 关键词：`timetable ics export` / `paper annotation reader` / `ocr notes taking` /
> `quiz practice app` / `fitness tracker javascript` / `spaced repetition flashcard typescript` /
> `FSRS scheduler rust wasm` / `pdf markdown converter javascript`（10 次搜索，达上限未超限）。
> 去重后未登记项 17 条，经相关性二次过滤保留 12 条有效候选。

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `open-spaced-repetition/fsrs-browser` | B 其他JS | BSD-3-Clause ✅ | 复习节奏 | **重复可强化**（学习页 · 复习调度） | 🟢 | proposed | 2026-10-17 | ★57，Rust→WASM，**零运行时依赖**。含 **Optimizer**（本仓 `ts-fsrs` 无此路径）+ Scheduler。已出骨架 `dsh-radar-fsrs-browser`（锁版 6.6.0）。⚠ 须裁决与 `dsh-radar-fsrs-scheduler` 的关系 |
| `alex-krassavin/reamkit` | B 其他JS | MIT ✅ | 笔记 / 课件解析 | **重复可强化**（解析 · 导入） | 🟡 | proposed | 2026-10-17 | ★10，**纯 TypeScript** 读 docx/xlsx/pptx/pdf → MD/HTML/PDF，**无需 LibreOffice / headless Office / 商业 SDK**。可强化 `dsh-zhiyun-parser`；项目偏小需评估维护风险 |
| `Vantalens/Trans2Former` | B 其他JS | MIT ✅ | 笔记 / OCR | **重复可强化**（解析 · OCR 路径） | 🟡 | proposed | 2026-10-17 | ★6，本地优先 14 入 / 11 出，**内置 PP-OCRv5 本地 OCR** + 转换质量报告，全程离线。与 `dsh-zhiyun-parser` 视觉路径正交 |
| `M1ck4/pdfmd` | B 其他JS | MIT ✅ | 笔记 | **重复可强化**（PDF→MD） | 🟡 | proposed | 2026-10-17 | ★302 / fork 77，头部 PDF→MD，智能标题识别 + 去页眉页脚 + 孤立片段合并。**Python 实现**，若接入需移植，成本中高 |
| `Tessie27/Live-Caption-Saver` | B 其他JS | **CC0-1.0** ✅ | 课堂录音 / 笔记 | **全新**（课堂字幕采集） | 🟡 | proposed | 2026-10-17 | ★12，Windows 实时字幕 OCR 抓取 + 时间戳自动落盘。对应「课堂录音」场景，但**平台绑定 Windows**，Web 端价值有限 |
| `computerfan/XJTLU-Timetable-to-ICS` | B 其他JS | MIT ✅ | 课表 | 重复可强化（课表导入） | 🔵 | proposed | 2026-10-17 | ★4，西交利物浦课表→ICS 命令行。**单校小工具**，仅作 ICS 导出范式参考 |
| `clemmbn/auriga-extract` | B 其他JS | MIT ✅ | 课表 | 重复可强化（课表导入） | 🔵 | proposed | 2026-10-17 | ★5，ISAE-SUPAERO 课表导出为单 ics。同上，单校工具 |
| `JXC240/paper-reader` | B 其他JS | MIT ✅ | 论文批注 | 重复可强化（论文阅读） | 🔵 | proposed | 2026-10-17 | ★1，本地 PDF 批注伴侣。2026-10-16 建仓，**过新未验证** |
| `RobbieRao/VibeResearchPaperReader` | B 其他JS | MIT ✅ | 论文批注 | 重复可强化（论文阅读） | 🔵 | proposed | 2026-10-17 | ★1，离线双语论文批注 + 段落级 + 自动保存 + 可移植 JSON（Python）。规模过小 |
| `Tentengg/Paper-Reader` | B 其他JS | MIT ✅ | 论文批注 | 重复可强化（论文阅读） | 🔵 | proposed | 2026-10-17 | ★1，AI 桌面 PDF 阅读器，多模型分析。2026-03 后停滞 |
| `jojomondag/FileToMarkdown` | B 其他JS | MIT ✅ | 笔记 | 重复可强化（格式转换） | 🔵 | proposed | 2026-10-17 | ★27，60+ 格式转 MD，CLI + API + 浏览器。**最近 push 2025-08 已停滞** |
| `elliotblackburn/mdpdf` | B 其他JS | Apache-2.0 ✅ | 笔记 / 导出 | 方向相反 | 🔵 | proposed | 2026-10-17 | ★803，MD→PDF（含样式表）。**本仓要的是 PDF→MD，方向相反**，仅参考 |
| `sindresorhus/gulp-markdown-pdf` | B 其他JS | MIT ✅ | 笔记 / 导出 | 方向相反 | 🔵 | proposed | 2026-10-17 | ★64，MD→PDF，2023 后停滞。同上，方向相反 |
| `ChloeVPin/openlet` | B 其他JS | MIT ✅ | 复习 / 闪卡 | **重复无增益** | ⛔ | rejected | 2026-10-17 | ★2，FSRS 闪卡 + 协作文件夹。与 §fsrs-browser / fsrs-scheduler 同域但从零起，**无算法或数据增量** → 不集成 |
| `masaok/metastack` | B 其他JS | MIT ✅ | 复习 / 闪卡 | **重复无增益** | ⛔ | rejected | 2026-10-17 | ★2，FSRS 闪卡（系统设计面试向）。同上，**无增量** → 不集成 |
| `walterscarborough/LibSpacey` | B 其他JS | MIT ✅ | 复习 | **重复无增益** | ⛔ | rejected | 2026-10-17 | ★26，C++ SM2 实现（含 TS 包装）。**算法代际落后于 FSRS**（本仓已选 FSRS 路线），2023 停滞 → 不集成 |
| `seenmttai/markdown-pdfjs` | B 其他JS | MIT ✅ | 笔记 / 导出 | 方向相反 | 🔵 | proposed | 2026-10-17 | ★5，浏览器端 MD→PDF，无服务端。方向相反，仅参考 |
| `SuriyaG894/md-converter-ext` | B 其他JS | MIT ✅ | 笔记 / 导出 | 方向相反 | 🔵 | proposed | 2026-10-17 | ★2，Chrome 扩展 MD→PDF/DOCX，全离线。方向相反，仅参考 |
| `AnimatingAntier/InkRead-AI-paper-reader` | B 其他JS | **无许可证** ⛔ | — | — | ⛔ | rejected | 2026-10-17 | ★1，砚读 InkRead，功能贴合论文场景，但**无许可证 → 不可采用，不得摘取任何代码**，仅登记 |
| `hemelroy/NoteHub` | B 其他JS | **无许可证** ⛔ | — | — | ⛔ | rejected | 2026-10-17 | ★2，OCR 课堂笔记（面向残障学生）。**无许可证**且 2019 停滞 |
| `Waqar-743/SnapNote` | B 其他JS | **无许可证** ⛔ | — | — | ⛔ | rejected | 2026-10-17 | ★6，桌面笔记 + 剪贴板捕获 + OCR。**无许可证** |
| `sunnnn2005/smart-handwritten-note-taking-app` | B 其他JS | **无许可证** ⛔ | — | — | ⛔ | rejected | 2026-10-17 | ★2，iPad 手写笔记（Swift/PencilKit）。**无许可证**且非 JS 栈 |
| `zhaouv/vscode-markdown-draw` | B 其他JS | Apache-2.0 ✅ | — | 无关 | ⛔ | rejected | 2026-10-17 | ★39，VS Code 手绘 SVG 插件。**非笔记本体**，与本仓无关 |
| `avigael/react-native-fitness-app` | B 其他JS | MIT ✅ | — | 无关 | ⛔ | rejected | 2026-10-17 | ★28，React Native 演示项目，2023 停滞。与浙大/考试/刷题/笔记/论文/锻炼无关 |
| `Sachin-deepak-S/fitness-adventure` | B 其他JS | MIT ✅ | — | 技术栈不符 | ⛔ | rejected | 2026-10-17 | ★15，游戏化健身。**PHP/MySQL，非 JS 栈** |
| `erleiuat/minska` | B 其他JS | MIT ✅ | — | 无关 | ⛔ | rejected | 2026-10-17 | ★25，Vue 卡路里/体重记录，2023 停滞。与学生场景无关联 |
| `tonderaikawere/python-learning` | B 其他JS | MIT ✅ | — | 无关 | ⛔ | rejected | 2026-10-17 | ★25，Python 桌面学习 App（tkinter）。**非 JS 栈**，无关 |
| `bandinopla/skill-assessments-quizzes` | B 其他JS | MIT ✅ | — | **重复无增益** | ⛔ | rejected | 2026-10-17 | ★14，通用面试题库。`dsh-zhiyun-quiz` 已覆盖出题+质检 → 不集成 |
| `AbdulBasit313/React-Quiz-App-Template` | B 其他JS | MIT ✅ | — | **重复无增益** | ⛔ | rejected | 2026-10-17 | ★63，Quiz UI 模板（React/TS/Tailwind）。仅 UI 样板，**无算法/数据增量** → 不集成 |
| `hellosagar/Quiz-App` / `cnrture/Quizzy-Compose-Multi-Module` | B 其他JS | MIT ✅ | — | 技术栈不符 | ⛔ | rejected | 2026-10-17 | ★101 / ★77，Android（Java/Kotlin）原生 Quiz App。**非 JS 栈**，不逐条铺开 |

> **本轮结论（供后续轮次直接引用）**：
> ① **C 组「课表导出 / 论文批注」两轴接近枯竭**。`timetable ics export` 57 条里符合
> 「JS 栈 + 宽松许可」的仅 4 条且**全是单校小工具**（4–34★，如 XJTLU / 奈梅亨 / ISAE-SUPAERO）；
> `paper annotation reader` 22 条里已登记 5 条，新发现 4 条**全是 1★ 且建仓 < 2 个月**。
> **后续遇「单校课表工具」「1★ 论文阅读器」直接判 🔵/⛔，只登记一行。**
> ② **C 组「文档解析」轴仍有价值**：`reamkit`（纯 TS、无 LibreOffice 依赖）与
> `Trans2Former`（本地 PP-OCRv5 OCR）都能强化 `dsh-zhiyun-parser`，
> 但均为小项目（6–10★），**适配成本需人工评估**。建议下轮延伸：
> `document converter typescript no libreoffice`、`local ocr wasm browser`。
> ③ **宽词已饱和，建议弃用**：`quiz practice app`（2711）与 `fitness tracker javascript`（1069）
> 合计贡献 3780 条结果，**去重后 0 条进入候选**（头部全为 App 架构演示 / 课程作业 / UI 模板）。
> 后续 C 组改用窄限定：`quiz practice spaced repetition`、`fitness tracker wearable api`。
> ④ **`FSRS scheduler rust wasm` 是精准命中词**（total 仅 2），一轮即捞到本轮唯一 🟢。
> **窄而专的技术词优于宽泛场景词** —— 与 A 组「收窄检索面」的经验一致。
> ⑤ **`fsrs-browser` 与既有 `ts-fsrs` 骨架的分层关系需人工裁决**（方案 ①替换 / ②分层 / ③维持），
> 二者同属 `open-spaced-repetition` 组织，**不应同时采用**，否则违反「功能仍相似正交」。

---

## 2026-10-17 · C 组（学生功能域 · **同日第二轮**）· 追加

> 本轮与同日 **00:01 的「第九轮 · C 组」**（提交 `771580b`）**同日同组**，系取组时本地
> `rotation-state.md` 快照陈旧所致（详见 `docs/ecosystem-radar/2026-10-17-c2.md` §12）。
> 已 **rebase 到远端最新、不覆盖第九轮产出**，并将与第九轮**重复的 7 条剔除**：
> `M1ck4/pdfmd`、`Tessie27/Live-Caption-Saver`、`AbdulBasit313/React-Quiz-App-Template`、
> `Waqar-743/SnapNote`、`JXC240/paper-reader`、`RobbieRao/VibeResearchPaperReader`、`Tentengg/Paper-Reader`。
> 关键词：`timetable ics export`、`paper annotation reader`、`ocr notes taking`、`quiz practice`、
> `fitness tracker language:typescript`、`spaced repetition flashcard`、`html to markdown converter`、
> `pdf to markdown`、`pomodoro study timer`、`lecture notes ai summarize`。搜索 10 次，API 无 403。
> 原始命中 241 个不同仓库（含第九轮已登记项），按远端 registry 去重后登记 **23 条**在下。
> **本轮增量细分轴：文档 → Markdown 格式转换**（第九轮未覆盖）。
> **本轮唯一 🟢 已出骨架 `dsh-radar-markitdown-js`。**

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `Mirza-Glitch/markitdown-js` | B 其他JS | MIT | 笔记/论文/课件（文档导入） | **重复可强化**（导入通路） | 🟢 | skeleton-created | 2026-10-17 | ★21。**本轮核心命中（第九轮未覆盖）**。npm `markitdown-js@0.0.14`（MIT，`type: module`，2025-03-02）。按格式分派到专用库：`mammoth`(docx)/`turndown`(html)/`node-pptx-parser`(pptx)/`xlsx`/`pdf-parse`。**本仓原无格式转换底层**（`dsh-zhiyun-parser` 是 LLM 解析、`pdfjs-dist` 只管渲染）→ 强化式集成成立。⚠ 上游停滞约 19 个月；依赖含 `exiftool-vendored`/`fluent-ffmpeg`/`node-tesseract-ocr` 二进制项，建议自建收敛子集。已出骨架。待裁定 vs `instax-dutta/MarkItDownJS` |
| `instax-dutta/MarkItDownJS` | B 其他JS | MIT | 笔记/论文/课件（文档导入） | 重复可强化（导入通路） | 🟡 | proposed | 2026-10-17 | ★1（但 2026-08-24 活跃）。通用文档→MD 引擎（PDF/DOCX/PPTX/XLSX/HTML/CSV/JSON/XML/图片/音频/EPUB/压缩包）。覆盖广于 `markitdown-js`，但 **★1 社区验证不足**。**与 🟢 候选二选一，不要都接** |
| `danburzo/percollate` | B 其他JS | MIT | 笔记/论文（网页导入） | 重复可强化（导入通路） | 🟡 | proposed | 2026-10-17 | ★4688（2025-08 停更）。Node CLI：网页 → 可读 PDF/EPUB/HTML/**Markdown**（内置 Readability）。成熟度远高于 🟢 候选，但**是 CLI 非可 import 库**，需改造 → 适配成本中高。与 `markitdown-js` 同属「→MD」细分，建议分工（网页走 percollate、本地文档走 markitdown-js）或二选一 |
| `ankimcp/anki-mcp-server` | B 其他JS | MIT | 复习 | 重复可强化（学习调度） | 🟡 | proposed | 2026-10-17 | ★516（活跃，2026-10-11）。Anki 的 MCP server（TS）。**调度层与既有骨架 `dsh-radar-fsrs-scheduler`（`ts-fsrs`）及第九轮的 `dsh-radar-fsrs-browser` 重叠**；形态为 MCP server（服务端）非可嵌入库。仅「Anki 卡片格式互操作」有独有增益 |
| `SYuan03/Skill-Anything` | B 其他JS | MIT | 习题/复习 | 重复可强化（学习页） | 🟡 | proposed | 2026-10-17 | ★337（活跃，2026-09-26）。任意来源（PDF/视频/网页/音频/文本）→ 12 节学习包 + 测验 + 闪卡 + 间隔重复。**Python 技术栈** → 代码不可复用，仅借鉴产物结构。与 `dsh-zhiyun-quiz` + FSRS 骨架域重叠，增益有限 |
| `Cawlumm/lyftr` | B 其他JS | MIT | 锻炼 | **全新**（无锻炼面板） | 🟡 | proposed | 2026-10-17 | ★359（活跃，2026-10-16）。自托管锻炼记录（React + **Go** 后端 + SQLite + Docker）。**前后端一体且后端非 JS** → 仅可提取前端数据模型与图表思路。**本仓无锻炼面板 → 属「全新」而非强化式集成**，建议降 🔵。提请裁定 |
| `microsoft/markitdown` | B 其他JS | MIT | 文档转换（设计参考） | 仅供参考 | 🔵 | proposed | 2026-10-17 | ★190577。**Python**。生态位最高的文件→MD 工具。非 JS → 不可直接集成，仅作「格式分派矩阵」**设计参考**。🟢 候选 `markitdown-js` 即其 JS 端口 |
| `mixmark-io/turndown` | B 其他JS | MIT | 文档转换（底层件） | 重复可强化（导入通路·底层） | 🔵 | proposed | 2026-10-17 | ★11476。**JS HTML→Markdown 事实标准**（npm `turndown@7.2.4` MIT），正是 `markitdown-js` 的内部依赖。**若走自建收敛子集路线，这是核心件**。配套 `turndown-plugin-gfm@1.0.2`（MIT）。提请裁定：整包接 vs 自建 |
| `datalab-to/marker` | B 其他JS | Apache-2.0 | 文档转换 | 仅供参考 | 🔵 | proposed | 2026-10-17 | ★40504。**Python**。高精度 PDF→MD+JSON。仅参考 |
| `firecrawl/anydoc` | B 其他JS | MIT | 文档转换 | 仅供参考 | 🔵 | proposed | 2026-10-17 | ★22886。**Rust**。Word/PPT/Excel/OpenDocument/RTF/EPUB/CSV/PDF → 干净 MD。仅参考 |
| `firecrawl/pdf-inspector` | B 其他JS | MIT | 文档解析 | 仅供参考 | 🔵 | proposed | 2026-10-17 | ★19664。**Rust**。PDF 检测/分类/文本抽取（自动判扫描件）。仅参考 |
| `chatdoc-com/OCRFlux` | B 其他JS | Apache-2.0 | 文档解析 | 仅供参考 | 🔵 | proposed | 2026-10-17 | ★2532。**Python**。多模态 PDF→Markdown 工具包。仅参考 |
| `showdownjs/showdown` | B 其他JS | MIT | 文档转换 | 无关（方向正交） | 🔵 | proposed | 2026-10-17 | ★14873。JS 双向 MD⇄HTML。本仓需求是 HTML→MD（单向），方向正交，无集成价值 |
| `open-spaced-repetition/py-fsrs` | B 其他JS | MIT | 复习 | **重复且无增益** | 🔵 | proposed | 2026-10-17 | ★513。**Python** 版 FSRS。与 `ts-fsrs`（骨架）及第九轮 `fsrs-browser` 同组织同算法 → 登记但**不建议采用** |
| `alyssaxuu/carden` | B 其他JS | MIT | 复习 | 重复可强化（学习页） | 🔵 | proposed | 2026-10-17 | ★490。JS 闪卡 + 间隔重复 + 游戏化。**2022-06 停更**，调度层（自有算法）旧于 FSRS → 仅线索 |
| `flashcards/flashcards.github.io` | B 其他JS | MIT | 复习 | 仅供参考 | 🔵 | proposed | 2026-10-17 | ★184。社区开发者闪卡库（内容向，非底层） |
| `gymcoach-app/gymcoach` | B 其他JS | MIT | 锻炼 | **全新**（无锻炼面板） | 🔵 | proposed | 2026-10-17 | ★99（活跃，2026-10-14）。自托管锻炼记录 + 自带 LLM 的 AI 教练。**本仓无锻炼面板**，形态为独立自托管 App → 仅参考 |
| `liuchuan01/Fitness-OS` | B 其他JS | Apache-2.0 | 锻炼 | **全新**（无锻炼面板） | 🔵 | proposed | 2026-10-17 | ★76（活跃，2026-10-07）。个人 AI 健身工作台（3D 身体 + 训练记录 + **DeepSeek Harness** 集成）。形态为独立工作台 → 仅参考 |
| `basarsubasi/simplefitnessapp` | B 其他JS | MIT | 锻炼 | **全新**（无锻炼面板） | 🔵 | proposed | 2026-10-17 | ★225。FOSS 健身追踪 App（移动端形态）→ 仅参考 |
| `hasaneyldrm/logpress-public` | B 其他JS | MIT | 锻炼 | **全新**（无锻炼面板） | 🔵 | proposed | 2026-10-17 | ★274（活跃，2026-07）。React Native AI 训练追踪（iOS/Android）→ 移动端形态，仅参考 |
| `zixun-ai/obsidian-paper-reader` | B 其他JS | MIT | 论文批注 | 仅供参考 | 🔵 | proposed | 2026-10-17 | 强耦合 Obsidian 宿主；支持标注/墨迹/链接笔记。许可证已核实（`/license` → MIT） |
| `CatchTheTornado/text-extract-api` | B 其他JS | MIT | 文档抽取 | 仅供参考 | 🔵 | proposed | 2026-10-17 | ★3184。Python 文档抽取 API（+ Ollama 本地 OCR），**2025-12 停更**、非 JS → 仅参考 |
| `BallCard/zju-study-workbench` | B 其他JS | MIT | 课程/笔记 | 仅供参考 | 🔵 | proposed | 2026-10-17 | ★0，**仓库已 archived**。ZJU 课程资料 + AI 笔记 + LaTeX PDF + Git 进度工作台。**归档 → 不建议跟进**，仅作场景印证 |
| 非 JS 的 HTML/PDF→MD 转换库汇总 | B 其他JS | 混合 | — | — | ⛔ | rejected | 2026-10-17 | `html to markdown converter` / `pdf to markdown` 命中大量**非 JS** 或纯方向正交项，经技术栈过滤后不登记：`JohannesKaufmann/html-to-markdown`(Go)、`letmutex/htmd`(Rust)、`suntong/html2md`(Go)、`vsch/flexmark-java`(Java)、`mysticmind/reversemarkdown-net`(C#)、`thephpleague/html-to-markdown`(PHP)、`JosephusPaye/markdown-to-html`、`breakdance/breakdance`(JS 但 2026-01 停更且被 turndown 覆盖)、`netgusto/upndown`(JS，2024 停更)、`alanshaw/markdown-pdf`(方向反之 MD→PDF)、`wisupai/e2m`、`thombashi/sqlitebiter`、`vdjagilev/nmap-formatter` 等 |
| `ujifgc/pagedown` | B 其他JS | NOASSERTION | 文档转换 | — | ⚠ 待核 | pending-license | 2026-10-17 | ★447。许可证待人工核验；**方向正交（MD→HTML）+ 2020-10 停更 → 建议直接 ⛔** |
| `StudyLions/StudyLion` | B 其他JS | NOASSERTION | 学习计时 | — | ⚠ 待核 | pending-license | 2026-10-17 | ★139。Python Discord 学习计时 bot。许可证待核；**形态（Discord bot）不符** |
| `pooriyayt/StudyMasterPro` | B 其他JS | NOASSERTION | 学习管理 | — | ⚠ 待核 | pending-license | 2026-10-17 | ★21。Python + PyQt5 桌面学习管理。许可证待核；非 JS |
| `Kennygunderman/state-of-health-tracker` | B 其他JS | **无** | — | — | ⛔ | rejected | 2026-10-17 | ★481。React Native 健康追踪。**`/license` 端点返回 Not Found → 确认无许可证** → 只登记，不得摘取任何代码 |
| `macanine/zju-english-helper` / `kenqia/zju-forum-search` | B 其他JS | **无** | — | — | ⛔ | rejected | 2026-10-17 | 分别为浙大大英默写器（★3）、CC98 自然语言找帖扩展（★2）。**`/license` Not Found → 无许可证** → 只登记（注：第九轮已登 `kenqia/zju-forum-search`，本轮仅作补充说明，不重复占行） |
| `mcpower/icallate` / `Treeki/myplace-timetable-export` / `jaidenlabelle/algonquin-timetable-to-ics` / `WoodyABCD/CityU-timetable-to-ics-exporter` / `finwarman/kcl-timetable` | B 其他JS | **无** | 课表 ICS | — | ⛔ | rejected | 2026-10-17 | 各校课表→ICS 小工具，**均无许可证**。ICS 生成逻辑思路可借鉴，**代码不可摘** |
| 各校课表→ICS 导出器（有证） | B 其他JS | MIT | 课表 ICS | **重复且无增益** | ⛔ | rejected | 2026-10-17 | `TOHgoto/cuhk-timetable-exporter`(★2,MIT)、`khosbilegt/mq-timetable-exporter`(★2,MIT)、`JaciBrunning/ElsieScraper`(无证)。（`computerfan/XJTLU-Timetable-to-ICS`、`clemmbn/auriga-extract` 第九轮已登）。与既有 `DongLanQwQ0/ZJU-Tongge-Schedule` 同域，且**本仓尚无课表数据层**（`docs/robot-digest/2026-10-13.md` F-001）→ 前置未就绪，无增益 |
| 通用答题 App / 模板 | B 其他JS | 混合 | 刷题 | **重复且无增益** | ⛔ | rejected | 2026-10-17 | `cnrture/Quizzy-Compose-Multi-Module`(Kotlin ★77)、`Vaibhav2002/Quizzify`(Kotlin ★43)、`eddy-hu/quizbee`(无证 ★40)、`MrPowers/code_quizzer`(无证 ★203)、`Tc2r1/Dev_Interview_Prep_App`(NOASSERTION ★51)、`LorenKociko/CCNA-Practice`(无证 ★73)。均与 `dsh-zhiyun-quiz` **重合且无更优底层**。宽词 `quiz practice`（8549 条）已**饱和**，建议改用窄限定 |
| 番茄钟类 | B 其他JS | 混合 | 计时 | **重复且无增益** | ⛔ | rejected | 2026-10-17 | `Arijit-05/Fomodoro`(Kotlin ★187)、`narlock/TamoStudy`(Java ★94)、`andreidimaano/Calcifer`(JS ★42)、`njallam/stream-pomodoro`(无证)、`aribaskagan/KEGOMODORO`(MIT)、`fgerschau/pomodoro-timer`(无证)。**技术栈多非 JS**，且单一计时器与本仓「今天」页重合无增益。**该关键词价值密度低，建议下次不再单跑** |
| 学习者独立 App / 桌面端 | B 其他JS | 混合 | 学习管理 | **重复且无增益** | ⛔ | rejected | 2026-10-17 | `Limekana/StudyDesk`(MIT ★26)、`hoangsonww/StudySync-Study-Buddy-App`(MIT ★28)、`SuryaThejas-07/Virtual_Fitness_Trainer`(无证 ★39)、`Devam338/fit_forge`(无证 ★38)。独立应用形态，非可封装库 |
| `lowlighter/metrics` | B 其他JS | MIT | — | 无关 | ⛔ | rejected | 2026-10-17 | ★17293。GitHub 个人主页信息图生成器。**域完全不符**（`fitness tracker` 误命中其 fitness 插件） |
| GPL/AGPL 红线项（本轮 C 组命中） | B 其他JS | GPL/AGPL ⛔ | — | — | ⛔ | rejected | 2026-10-17 | `iamgio/quarkdown`(GPL-3.0 ★16318)、`artcc/freelingo`(AGPL-3.0 ★179)、`WhyAsh5114/MyFit`(AGPL-3.0 ★142)、`HHousen/lecture2notes`(AGPL-3.0 ★67)、`femiaf13/manatee-fitness`(AGPL-3.0 ★48)、`xiaoxiae/Florodoro`(GPL-3.0 ★39)、`bttger/markdown-flashcards`(GPL-3.0 ★96)、`cubetastic33/sakubun`(GPL-3.0 ★41)、`helloworld1/AnyMemo`(GPL-2.0 ★158)、`dunossauro/copylot`(GPL-3.0 ★31)、`QSCTech/zjunet`(GPL-3.0 ★332)、`zhaoluting/marp-themes`(GPL-3.0 ★87)、`RunasSudo/allocics.js`(AGPL-3.0 ★2)。**许可证红线 → 只登记，不摘任何代码** |
| 浙大课程资料 / 作业仓库（约 80 条） | B 其他JS | NOASSERTION/无 | — | — | ⛔ | rejected | 2026-10-17 | `zju-isee/zju-isee`、`lhxcs/ZJU_Courses`、`tiny656/PAT`、`merelydust/PAT-Advanced-Level`、`jinzcdev/pintia-solutions`、`macanine/zju-linear-algebra-papers`、`zhenguren/zju-study-map`、`AmeliaaaGXY/ZJU-SmartCampus-Map`、`dilititi/Echo-in-ZJU*`、`yuaanlin/*` 课程作业系列、`ZJU-Turing/*` 等。**C 组关键词误命中的 B 组域**，全部 `NOASSERTION` 或无许可证 / 纯资料内容 → **内容版权，只作线索，不逐条登记、不摘取** |

---

## 2026-10-17 · 第十轮（**B 组首轮 + A 组治理轴深挖**）· 追加

> 轮换脚本 `node scripts/radar-rotation.mjs --today 2026-10-17` 判 `same-day(unused)`
> （今日已跑 C @ 00:01）→ 取今日未跑过的 **B 组**；B 组新增轴一轮即枯竭（10 次搜索 7 次返 0），
> 遂转 **A 组治理/连接面轴**（承接第八轮指定的延伸词清单）。**共 16 次搜索**（⚠ 超 ≤10 上限 6 次，
> 已在报告 §1「自律说明」如实记录：B 组 10 次为一次性验证新轴、A 组 6 次为上一轮指定动作）。
> API 全程 200，**本轮完整**。许可证核实：`license.spdx_id` + 对 🟢/🟡 候选**逐一拉取 LICENSE 实文比对**。
> 原始命中与去重基线见 `2026-10-17-b2.md`。

### A 组 · 治理轴（本轮主力）

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `liujianqiao701/dsh-compat-vet` | A 原生DSH | MIT ✅ | 工作台可用性 | **重复可强化**（插件页） | 🟢 | proposed | 2026-10-17 | ★0，push 2026-09-30。JavaScript。**插件兼容性体检**：探测本机 dsh 版本与能力（含实测校准），预警「下次启动会被拒绝加载」的插件与「快要不适配」的插件，给中文预警 + 一键修复。**npm `dsh-compat-vet@0.3.2` 的 `dsh` 字段为 `{bundle:{patch:'./cordis.patch.yml'}, engines:{dsh:'*'}, client:{...}}` —— 标准 bundle 形状、可锁版挂载**（同域 `rogerdigital/dsh-vet` 是 `{seams:[...]}`，**非 bundle 形状、不能挂载**，这是本轮选它的**决定性理由**）。**强化式集成三条件成立**：仍是「插件」页（不新增导航项，上游自带 `./client` 可整页挂但**刻意不用**）+ 功能正交（现有答「谁依赖谁、现在能关掉谁」的**横向**拓扑；本条答「下次启动还能不能被加载」的**纵向**可用性）+ 底层新增本仓完全没有的版本矩阵判定能力（本仓 `packages/` 无 compat 包，`page-plugins/src` 无 peer/semver 实现）。**LICENSE 实文已核**（`MIT License / Copyright (c) 2026 liujianqiao`）；**npm 实包已核**（patch 行 id `compat-vet`；files 含 9 个 lib 模块 + 6 个真机验证脚本 + 9 个测试文件）。**骨架已生成** `packages/dsh-radar-compat-vet`。⚠ **上游极早期（★0/fork 0/建仓当月即无更新）**，采用前须隔离环境实跑其 `verify-real-boot.mjs`。⚠ **不得暴露其「一键修复」写入口**（与本仓「不另开写入口」冲突，只取只读预警） |
| `wulun811/dsh-plugin-vet` | A 原生DSH | MIT ✅ | 插件安全 | **重复可强化**（插件页） | 🟡 | proposed | 2026-10-17 | ★4，fork 1，push 2026-09-29。TypeScript。确定性**静态扫描（11 条规则）** + LLM 审计协议 + 双段记分卡；**可选**运行时守卫（T1 哨兵 / T2 `fs` & `child_process` 钩子）+ 蜜罐诱饵。上游自述 *"Monitor-and-alert only — vet never blocks or kills on its own"*（**只监视不阻断**），与本仓「只读、不另开写入口」原则**契合度好**。**LICENSE 实文已核 MIT**。⚠ **npm 未发布**（`registry.npmjs.org/dsh-plugin-vet` → `Not found`）→ **不可锁版挂载**，须走源码路径。与 §2.4 同簇取优 |
| `nisconder/npm-safe-forDSH` | A 原生DSH | Apache-2.0 ✅ | 依赖安全 | **重复可强化**（插件页 · **新维度**） | 🟡 | proposed | 2026-10-17 | ★4，push 2026-08-29。TypeScript。**装前检查 npm 包**：22 条供应链规则 + **深层 tarball 扫描** + CI 门禁 + 本地优先。npm 已发布 `@npm-safe/dsh-tool-npm-safe`。**答的是「我要装的这个 npm 依赖本身安不安全」**——与「插件能不能加载」（兼容性）、「插件能碰到什么」（权限画像）**都不同**，是治理簇内**第三个正交维度**。**LICENSE 实文已核 Apache-2.0**。⚠ 依赖含 `sqlite`，采用前须核离线可用性。**建议下一轮出骨架** |
| `ChaoYuZhang001/dsh-gate` | A 原生DSH | MIT ✅ | 插件供应链 | **重复可强化**（插件页） | 🟡 | proposed | 2026-10-17 | ★1，push 2026-10-01。TypeScript。**GitHub Action + 静态 Provider**，做兼容性 / 权限 / **provenance** 三项检查，覆盖 **Desktop 社区目录**。**形态特殊**：偏 CI 侧门禁而非运行时面板 → 若采用，落在**构建期**而非插件页。**LICENSE 实文已核 MIT** |
| `Darren-Tang/dsh-provenance` | A 原生DSH | MIT ✅ | 插件供应链 | 全新（溯源域） | 🔵 | proposed | 2026-10-17 | ★1，push 2026-08-19。TypeScript。装前供应链 preflight：**验证你安装的和你看的源码一致**。npm 已发布 `dsh-provenance`。治理簇**第四个正交维度**（溯源/一致性），概念明确；但 ★1 且 npm `dsh` 字段未见 `bundle.patch` → 仅登记。**LICENSE 实文已核 MIT** |
| `Zaogaogwc/dsh-plugin-manager` | A 原生DSH | MIT ✅ | 插件管理 | **重复无增益** | 🔵 | proposed | 2026-10-17 | ★1，push 2026-08-15。JavaScript。Mod 风格插件管理：provenance + **预览优先的热切换** + 预设 + AI 过滤 + 诊断 + 更新。⚠ **与「插件」页现有开关语义部分重叠** → 不集成，仅作交互范式参考 |
| `SongYuhui14/dsh-plugin-compat-checker` | A 原生DSH | MIT ✅ | 工作台可用性 | **重复且无增益** | 🔵 | proposed | 2026-10-17 | ★1，push 2026-08-19。JavaScript。装前兼容性预测（**与本轮 🟢 上游同做一件事**）。**npm 未发布、无 `bundle.patch`** → 不能锁版挂载，故不选为骨架。**LICENSE 实文已核 MIT** |
| `Edge-Echo/dsh-release-evidence` | A 原生DSH | MIT ✅ | 插件质量 | 全新（发布证据域） | 🔵 | proposed | 2026-10-17 | ★1，push 2026-10-04。JavaScript。把插件发布的**证据包**（生命周期测试 / 回归评估 / 兼容性 / 质量预算）聚合为**可独立验证的签名包**——自述 *"Does not run the tests — proves which ones ran and that their reports were not altered"*（不重跑测试，而证明哪些跑过且报告未被篡改）。**范式有新意**，但 ★1 且未发布 → 登记备查。**LICENSE 实文已核 MIT** |
| `2imagine50/dsh-plugin-vet` | A 原生DSH | MIT ✅ | 插件安全 | **重复无增益** | 🔵 | proposed | 2026-10-17 | ★0，push 2026-09-10。JavaScript。「安装前审查一个 dsh 插件：**不安装、不运行**它的代码」。与 🟢 上游功能重叠，★0 → 不集成 |
| `duxingxiake3/dsh-plugin-market` | A 原生DSH | MIT ✅ | 插件发现 | **重复无增益** | 🔵 | proposed | 2026-10-17 | ★1，push 2026-10-02。JavaScript。DSH 内「发现 / 审视 / 安装」市场。**与已登记骨架 `dsh-radar-dsh-market`（`dsh-market` ★6494）重叠** → 不集成 |
| `ACEMaravilla/dsh-plugin-market` | A 原生DSH | MIT ✅ | 插件发现 | **重复无增益** | 🔵 | proposed | 2026-10-17 | ★0，push 2026-08-16。TypeScript。Model-facing 插件市场（`plugin_search`/`plugin_vet`/`plugin_report`/`plugin_install`）。同上重叠 → 不集成 |
| `SongYuhui14/dsh-code-vetter` | A 原生DSH | MIT ✅ | 代码安全 | 场景错位 | 🔵 | proposed | 2026-10-17 | ★1，push 2026-08-19。JavaScript。AI 代码安全审查（SQL/命令注入、硬编码密钥、危险函数、弱加密、鉴权绕过，OWASP/CWE 对齐）。**扫描对象是「代码」不是「插件」** → 与治理轴场景错位，仅登记。**LICENSE 实文已核 MIT** |
| `LCYLYM/dsh-attachments-guardian-fixture` | A 原生DSH | MIT ✅ | — | 无关 | 🔵 | proposed | 2026-10-17 | ★0，push 2026-10-16。JavaScript。**测试夹具**（为自动化插件兼容性维护提供公共 fixture），非可用插件 → 仅登记 |
| `HYBB-rash/dsh-liangshen` | A 原生DSH | Apache-2.0 ✅ | — | 重复无增益 | 🔵 | proposed | 2026-10-17 | ★4，push 2026-09-04。TypeScript。LiangShen DSH 预设的**维护分支**（fork of `dsh-plugins`），非独立能力 → 仅登记 |
| `poplarity/dsh-science-workbench` | A 原生DSH | MIT ✅ | 科研工作台 | 待评估（功能域） | 🔵 | proposed | 2026-10-17 | ★11，push 2026-10-15。JavaScript。**可复现科研工作台**插件。**属功能域（科研）而非本轮治理轴** → 本轮仅登记，**建议留待 A 组功能域轮次单独评估**（可能与「论文」页 / 知识页相关） |

### A 组 · 非 DSH 生态的供应链/agent 配置审计（仅作线索）

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `homeofe/supply-chain-guard` | B 其他JS | Apache-2.0 ✅ | 依赖安全 | 全新（能力对照） | 🔵 | proposed | 2026-10-17 | ★7，fork 3，push 2026-10-16。TypeScript。**离线**供应链扫描器：**15 生态**、含**传递依赖 lockfile**；检测 350+ 威胁指标（含 GlassWorm、Shai-Hulud）；GitHub Action + MCP server + CycloneDX SBOM + SLSA 分级。**非 DSH 生态** → 不直接集成；但「离线 + 多生态 + 传递依赖」是**强能力**，作方法论与能力对照线索 |
| `basitalisandhu/agent-config-audit` | B 其他JS | MIT ✅ | Agent 配置安全 | 全新（需求清单） | 🔵 | proposed | 2026-10-17 | ★0，fork 1，push 2026-10-16。Python。审计 **Claude Code** 权限规则（含**被静默跳过的规则**）、`.mcp.json` 密钥与未锁定 MCP server、**外泄 hook**、插件清单、`CLAUDE.md`/`AGENTS.md`/`.cursor` 的 prompt injection；输出 Table/JSON/Markdown/**SARIF** + GitHub Action + pre-commit。**非 DSH 生态且 ★0** → 只作「agent 配置审计该查什么」的**清单参照**（其覆盖面值得本仓后续自建时对照） |
| `qualixar/skillfortify` | B 其他JS | **NOASSERTION** ⚠ | 插件安全 | — | ⚠ | pending-license | 2026-10-17 | ★38，push 2026-10-02。Python。自称「首个 AI agent skill/plugin 正式安全扫描器」（静态 + 动态）。**许可证无法识别 → 待人工核验，本轮不采用、不摘取任何代码** |

### B 组 · 新增轴（考研/保研/科研训练）—— 一轮即枯竭

| 仓库 / 簇 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `Devin100086/ZJUT-BAOYAN` | B 其他JS | **无许可证** | 保研 | — | ⛔ | rejected | 2026-10-17 | ★39。**浙工大**保研分享库（`zjut` ≠ `zju`，**非浙大**）；**内容库非工具** + 无证 → 排除 |
| `yhshu/BaoYan-2019` | B 其他JS | **GPL-3.0** ⛔ | 保研 | — | ⛔ | rejected | 2026-10-17 | ★10。2019 年计算机推免复习（针对 THU/PKU/ZJU 机试）。**GPL 红线** + 2019 停更 7 年 → 排除 |
| `shamsudduha124/gradapplier` | B 其他JS | **无许可证** | 留学申请 | — | ⛔ | rejected | 2026-10-17 | ★0，2026-09-03 建仓。TypeScript。研究生申请文书工具。无证 + ★0 → 排除 |
| B 组本轮 7 个返 0 词 | — | — | — | — | — | — | 2026-10-17 | `zju campus tool language:typescript`、`zju study tool language:javascript`、`zju note taking language:typescript`、`zju postgraduate exam 408`、`zju recommendation postgraduate baoyan tool`、`postgraduate exam study planner javascript`、`zju graduate admission recommendation` —— **全部 `total_count = 0`**。**结论：B 组新增轴一轮即扫尽**（见报告 §3.1） |

### ⛔ 排除簇（同上，集中登记不逐条铺开）

| 仓库 / 簇 | 类型 | 许可证 | 原因 | 分级 | 状态 | 首次发现 |
| --- | --- | --- | --- | --- | --- | --- |
| `truelove-dreamer/dsh-plugin-vetting` | A 原生DSH | **无许可证** ⛔ | ★5，2026-08-26。JavaScript。启发式恶意软件检测。**`/license` 端点返 `Not Found`** → 无证，**不采用、不摘取任何代码**，仅登记一行。⚠ 功能贴合且 ★ 高于本轮骨架上游，**若认为值得用须先联系作者补许可证** | ⛔ | rejected | 2026-10-17 |
| `ateen18/dsh-plugin-security-review` | A 原生DSH | **无许可证** ⛔ | ★4，2026-08-24。JavaScript。装前静态审查 + 运行时审计 + 可选 tool-call 守卫 + 一键面板。**同上 `Not Found`** → 同上处理 | ⛔ | rejected | 2026-10-17 |
| 供应链通用簇（`apache/ofbiz-plugins` ★177、`Coloquinte/moosic-yosys-plugin` ★25、`TorturedDude/supply-chain-guard-plugin` ★16、`sbom-tool/gh-guard` ★15、`EncoreDigitalGroup/heimdall` ★10、`oracle/macaron-utilities` ★10、`duhu2000/supply-chain-qcc-enhanced` ★5、`saschagrunert/nri-supply-chain` ★4、`attach-dev/attach-guard` ★7） | B 其他JS | 多为宽松 ✅ | **与本仓无关**：OFBiz ERP 插件、Yosys 逻辑锁定、Kotlin/PHP/Java/Go 栈、企查查 MCP、容器镜像证明 —— `plugin supply chain` 宽词带入的**同名污染**。非 JS 栈或非 agent 插件语境 → 排除 | ⛔ | rejected | 2026-10-17 |
| Android/Cordova 权限簇（`Bphreaker/cordova-plugin-remove-ad-permission`、`globules-io/cordova-plugin-remove-duplicate-permissions`、`vmoranv/jshook_plugin_android_permission_audit`、`Lzy-joy/AndManifestPlugin`、`wwdemoteam/DTCordovaPermissions`、`happinov/cordova-plugin-android-systemalertwindow`、`openbrf/example-plugin`、`Alpha-xp5-ai/OneSignalPro`、`chrisneagu/FTC-Skystone-...`、`Lhagawajaw/11-36-00-PM-...`） | B 其他JS | 混合 | `plugin permission manifest` 单词命中项**全部为 Android Manifest / Cordova / Unreal / FTC SDK / 构建日志**同名污染，**与 DSH 插件权限无关** → 排除。**结论：该关键词对本仓无价值，建议从关键词池移除**（同 2026-10-17 的 `quiz practice app` 处理） | ⛔ | rejected | 2026-10-17 |
| `deepseek-harness-java/vet-clinic-af` | A 原生DSH | 无 | ★0。Java Native Plugin 的**宠物医疗门诊**场景 —— `vet` 一词的**双关污染**（兽医 vs 审视）→ 排除 | ⛔ | rejected | 2026-10-17 |

---

## 2026-10-17 · 第十一轮（C 组 · **复习调度 / FSRS 参数优化**轴 · 定向深挖）

> 当日第三轮（`same-day(unused)`，累计 C=6 < A=10）→ 取 C 组。
> 按「同类项不重复评估」与「不重复已跑关键词」纪律，**不重跑任何已跑词**，
> 改跑 **10 个全新词**，全部指向同一条轴：**复习调度 / FSRS 优化器**（由第九轮 `fsrs-browser` 打开）。
> 去重后未登记 84 条 → 相关性过滤后**有效候选 10 条**。**无新 🟢，本轮不出骨架**（见报告 §5）。
> ⚠ `note taking markdown obsidian plugin javascript` 为第 11 次调用，**超 ≤10 上限 1 次**（如实记录）。

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `open-spaced-repetition/fsrs-rs` | B 其他JS | BSD-3-Clause ✅ | 复习调度 | **重复可强化**（溯源） | 🟡 | proposed | 2026-10-17 | ★**445**，fork 45，Rust，push 2026-10-09，crates.io 发布，**活跃**。FSRS 的 **Rust 参考实现**（Optimizer + Scheduler），是第九轮 🟢 `fsrs-browser` 与 npm `@open-spaced-repetition/binding` 的**共同上游** → **补上许可证追溯链**。**本仓无 Rust 构建链** → 不以 crate 集成，**只作溯源登记** |
| `ihv-forge/ts-fsrs-optimizer` | B 其他JS | **`NOASSERTION` ⚠ → 已实文核实为 BSD-3-Clause** | 参数优化 | 重复且**无增益** ⛔ | 🔵 | proposed | 2026-10-17 | ★1，TypeScript，push 2026-10-01，npm 已发布。**纯 TS 优化器：无原生模块、无 WASM、无服务端**。⚠ **GitHub API 报 `NOASSERTION` 系误报** —— 已拉 `LICENSE` 实文：首行 `BSD 3-Clause License`，署名 `Copyright (c) 2023, Open Spaced Repetition` + `(c) 2026, ihv-forge`，自述为 `fsrs-rs` 衍生作品 → **在白名单内，无红线**。**仍不采用的真实理由是 ★1 极早期 + 与既有 🟢 `fsrs-browser` 能力重叠（无增益），与许可证无关** |
| `open-spaced-repetition/fsrs-optimizer` | B 其他JS | BSD-3-Clause ✅ | 参数优化 | 重复且**无增益** ⛔ | 🔵 | proposed | 2026-10-17 | ★112，**Python**，push 2026-08-06，PyPI `FSRS-Optimizer` 6.5.0。**依赖 `torch`/`scipy`/`pandas`/`scikit-learn`** 的重型实现。本仓为 JS 技术栈 → **不可复用**，登记但不建议采用 |
| `ishiko732/fsrs-wxt` | B 其他JS | **无许可证** ⛔ | 参数优化 | 仅作**实现范式**参考 | 🔵 | rejected | 2026-10-17 | ★1，TypeScript（WXT + React），push 2026-06-08。扩展形态：导入本地 Anki `revlog.csv` → WASM 优化器算 FSRS 参数。**`/license` 无文件 + API `license: null` → 无许可证，不采用、不摘取任何代码**。⭐ **但留下一条例的（可执行）事实**：其 `package.json` 依赖 `@open-spaced-repetition/binding: 0.5.0` + `@open-spaced-repetition/binding-wasm32-wasi: 0.5.0`，二者**均已核实为 npm 官方发布**（`repository = open-spaced-repetition/ts-fsrs`，**MIT**，与既有骨架锁版 `ts-fsrs` **同组织同仓库**）→ **本仓若走「分层」方案应用这两个官方包，而非第三方 `fsrs-wxt`**；亦说明第九轮「方案②代价高」的估计偏高（同组织两个包，非跨组织拼接） |
| `khannoussi-malek/PaperLab` | B 其他JS | Apache-2.0 ✅ | 论文精读 / 笔记 | **重复可强化**（论文阅读页 · RAG） | 🔵 | proposed | 2026-10-17 | ★8，fork 1，Python（Electron + FastAPI + React），push 2026-10-17，建仓 2026-09-13。**本地优先 PDF 阅读器**：批注锚定到页、**AI 回答带引用**、离线 Ollama、pgvector RAG、**内置 MCP server**、topics 含 `zotero-alternative`。与「论文阅读」页（`dsh-zhiyun-paper` / `dsh-zhiyun-page-paper`）同域，但**形态为独立桌面应用而非可嵌入库**，本仓论文页又为 iframe 壳 → **不集成**；其「答案必须带引用」的交互纪律可参考 |
| `bruce2431/Pj13-PaperReader` | B 其他JS | **无许可证** ⛔ | 论文精读 | 重复（论文阅读页） | ⛔ | rejected | 2026-10-17 | ★0，TypeScript，push 2026-10-14，建仓 2026-10-11（**3 天内**）。中文「论文精读 PDF 阅读器：目录页 + 阅读器 + 生词卡 + 批注卡」，零依赖 Node 后端（`node:http` + `node:sqlite`）+ Vite/React/pdf.js，**为扫描版 PDF 的 OCR 文本层做字形对齐**。**无许可证 + ★0 + 建仓 3 天** → 排除。**但「OCR 文本层字形对齐」是本仓没有的具体技术点**，若 `dsh-zhiyun-parser` 后续要处理扫描版讲义可回看此思路（**只读思路、不取代码**） |
| `nanhualyq/ir-ext` | B 其他JS | **无许可证** ⛔ | 复习 / 增量阅读 | 全新（本仓无增量阅读） | ⛔ | rejected | 2026-10-17 | ★0，TypeScript，push 2026-09-12，建仓 2024-06-21。浏览器扩展，**增量阅读（Incremental Reading）**。**无许可证** → 不采用。⭐ **方法论价值高**：`incremental reading browser extension`（`total_count = 1`）是**本轮唯一有新语义**的词。增量阅读 = 「读长文时就地成卡、与阅读进度一同调度」。本仓「读（page-study）/ 记（notes）/ 出题（quiz）」**三段都有但手动串联** → **缺的正是串联本身**。**建议下一轮 C 组单列该轴**：`incremental reading` / `readwise alternative` / `cloze extraction` |
| `open-spaced-repetition/fsrs-optimizer-tiny` | B 其他JS | **无许可证** ⛔ | — | — | ⛔ | rejected | 2026-10-17 | ★4，Python，push 2023-09-05。**无许可证且 2023 年即停更**（描述为空）→ 排除，仅登记一行 |
| `VictorAurelius/2026-Smart-Quiz` | B 其他JS | MIT ✅ | 刷题 / 语言学习 | **重复且无增益** ⛔ | ⛔ | rejected | 2026-10-17 | ★2，TypeScript，push 2026-07-08。离线优先日语（JLPT N5–N3）/ 中文（HSK）背题应用。**与 `dsh-zhiyun-quiz` 覆盖面重复且无底层增量**，内容库亦非本仓场景 → 排除 |
| `SoumiryaSarangi/ExamPrep-AI` | B 其他JS | MIT ✅ | 考试备考 | **重复且无增益** ⛔ | ⛔ | rejected | 2026-10-17 | ★2，JavaScript，push 2026-08-30。「讲义 PDF → 笔记 / 卡 / 题 / 限时考」的 AI 备考平台。**与「学习」页既有链路（解析 → 出题 → 质检）逐环节重复**，且依赖 GPT 云调用（与本仓本地优先取向不符）→ 排除 |

### 第十一轮 · 排除簇（集中登记，不逐条铺开）

| 仓库 / 簇 | 类型 | 许可证 | 原因 | 分级 | 状态 | 首次发现 |
| --- | --- | --- | --- | --- | --- | --- |
| 学习管理平台 / 学生仪表盘簇（`CeylonTech-Labs/LearnHub_Front`、`sahmedhusain/01-dashboard`、`minkushgoyal/student-learning-dashboard`、`dabdenehanshu0-droid/colloge-deshbord`、`Fouzia-Oreen/BrightBrainz_Learning-Management-System`、`Sanikamca24009/Learning-Management-System`、`akhil-palla/orbiixx-lms`、`IsaShaikh/smartedu-platform`、`Algorithm-Artist-ctrl/smart-education-platform`、`nafisa3003/IELTS-Beta-Webapp-Next`、`hashu007/EDUPREDICT-...`、`Mounusha25/edu_morph`、`akishoreapl-droid/campiusiq`、`sreecharan-desu/student-education-api`、`waterskiheatlightning933/edu-shield-ai`、`davidchileshe074/nmlc-admin-dashboard-main`、`Anish-jx/EduQuiz`、`JeremySaaj/MindMate-AI`、`shawnrajeev/Cognify--AI-Powered-Learning-Platform` 等 ~20 条） | B 其他JS | **绝大多数 `null`（无许可证）** | `learning analytics student dashboard typescript`（total 20）与 `spaced repetition scheduler wasm` 等词的**同名污染**：**全为通用 LMS / 学生仪表盘 / 毕业设计级样板**，与浙大场景无关联，且**几乎全部无许可证**。**该关键词族对本仓无价值，建议弃用** | ⛔ | rejected | 2026-10-17 |
| 同名噪声簇（`rn-snehapriya/Automatic-Note-Taking-From-Video-Using-Tesseract-OCR`（Jupyter，无证，2022 停更）、`Zenardi/ff7r-pc-optimization`（**最终幻想 VII 重置版**性能优化，`fsrs`/`optimizer` 撞词）、`Neutron-I7950/fsr4-frame-boost-native`（**AMD FSR 4 画质**指南）、`Pexilo/SoTReader`（**盗贼之海**截图 OCR）、`selimfirat/nino`（GPL）、`bryanjenningz/react-mandarin-reader`（GPL-3.0）、`ayoung012/rmit-timetable-export`（GPL-3.0）、`kevin-v96/annotation-pointers`（GPL-3.0）、`jaidenlabelle/cineplex-timetable-exporter`（**影院**排片导出，非课表；无证）、`AbdulWSaqib1996/timetable-pwa`（无证）、`PardhavMaradani/vit-timetable-export-plugin`（无证）等） | B 其他JS | 混合（多条 **GPL-3.0** / 无证） | ① **词义撞车**：`fsr4 / ff7r` 与 `FSRS` 无关；`Cineplex` 影院排片 ≠ 课表；`Sea of Thieves` ≠ 笔记。② **GPL 红线**多条。③ 无许可证多条。④ 单校/单机构小工具，与本仓无接缝 → 排除 | ⛔ | rejected | 2026-10-17 |
| FSRS 生态重复实现簇（`davafons/nagori-fsrs`（Ruby 绑定，NOASSERTION）、`yasinErdemli/FSRSKit`（Swift，BSD-3）、`Qxy0happy/fsrs-dual-optimizer`（Go，MIT）、`Heward165/RecallSharp`（C#，MIT）、`rzhang003/FSRS-Optimizer`、`Prj-geek/dsa-fsrs-optimizer`、`Rucha0901/flashcard-fsrs-optimizer`、`YuuseiKurobane/linear-adr-optimizer-python`、`shesl-tinkerland/fsrs4anki-optimizer`（均无证）、`luisangel2895/neurova-web` 等） | B 其他JS | 混合 | **本仓技术栈为 JS/TS** → **Ruby / Swift / Go / C# / Python 实现全部不可复用**；其余无许可证且 ★0。逻辑同 `py-fsrs`（第十轮已判「重复且无增益」）→ **簇内一次性排除，`fsrs optimizer` 子轴就此封板** | ⛔ | rejected | 2026-10-17 |

### 第十一轮 · 核心结论（供后续轮次直接引用）

> **⚠ `reviewQueue` 是只读投影，本仓无任何调度写入方。** 本轮以**代码级证据**推翻第九轮骨架的前置假设：
> ① `dsh-zhiyun-quiz/src/store.js:501` 的 `reviewQueue` **只是 `status === 'accepted'` 过滤器**，
> **无时间 / 间隔 / 优先级维度**（采纳顺序 = 复习顺序）；
> ② `dsh-zhiyun-study-core/src/workbench.js:314-321` 的 `quizView` 投影**不含 `fsrsRating` / `selfRecall` / `dueAt` / `attempts`**
> → **界面拿不到评分，无法交给任何调度器**；
> ③ `generate.js:1087` 的 `computeBacklog`（读 `dueAt` / `isNew`）**全仓仅 2 处命中**（定义处 + README 移植台账一行），
> **`src/index.js` 未导出、无任何调用方**；
> ④ **全仓写入 `dueAt` 的代码：0 处**（仅 2 处读取）。
>
> **⇒ 调度能力（写入方）是完整缺口；第九轮骨架 TODO 第 3 条「接缝已存在、只需不越界」不成立 —— 实际是两端都没接。**
> **⇒ 但三条强化判据仍成立**：①面板不新增（⚠ 依据须改为「新增『到期/积压』显示本就是本仓纪律」，见 `generate.js:1076-1083` 对 review debt 的论证）；
> ②功能正交（现有答「哪些题已采纳」，调度答「先做哪道」）；③**缺口比原论证更大（从无到有，而非手动换自动）**。
>
> **⇒ 正面结论**：`store.js:38-54` 的 **FSRS 隔离已做好**（`fsrsRating` **只**来自 `selfRecall`，
> `autoVerdict === correct` 时仍为 `null`；理由是 Anki 手册「忘了却按 Hard 会让间隔静默偏长」）
> → **接入 FSRS 不需先补数据合规层，`fsrsRating` 可直接作为调度输入**（降低落地成本）。

### 第十二轮 · 2026-10-17 · A 组（`sort=updated` 新仓视图）

> 关键词：`deepseek-harness-plugin` / `cordis-plugin` / `dsh-plugin` / `dsh-ecosystem` / `dsh-theme` /
> `dsh-plugin topic:dsh-plugin` / `dsh-plugin topic:deepseek-harness` / `dsh plugin:in:name,description` /
> `cordis-plugin in:name,description` / `deepseek-harness-plugin in:name,description` /
> `deepseek-harness-plugin+graph in:name,description`（11 次调用，⚠ 超限 1 次；0 次 403）。
> **17 条全部首次登记**。详见 `2026-10-17-d.md`。

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `cwbcheng/dsh-knowledge-graph` | A 原生DSH | MIT ✅ | 笔记 / 复习 | **重复可强化**（笔记页 · 图谱） | 🟢 | proposed | 2026-10-17 | **本轮唯一 🟢，已出骨架 `dsh-radar-knowledge-graph`**（锁版 npm `0.1.3`）。★1，JavaScript，push 2026-10-16。把**任意正文/图片**用 LLM 拆成知识图（8 类节点 × 12 类关系）+ **与原文双向锚点** + 证据核验 + 待核对队列 + 审计日志；另有《学习观》本体 `learning-view-v1`（18 节点 / 21 关系）。**强化 `dsh-zhiyun-vault` 的「链接图」**：vault 按**链接**找（人写的边），本条按**语义**找（抽取的边）—— 一个连「篇」，一个连「义」。⚠ **npm `latest` 0.1.3 与仓库 `package.json` 1.0.1 不一致**，且 npm 4 版全发于 2026-09-01 → 锁版可能落后一个月，评审须先确认同源构建。⚠ 自带 SQLite，与 `dsh-zhiyun-knowledge`「零文件 IO」硬约束冲突，须裁决 |
| `omdsh-dev/DSH-better-sidebar` | A 原生DSH | MIT ✅ | 工作台可用性 | **重复且无增益** ⛔（同层替换） | 🔵 | proposed | 2026-10-17 | ★**4215**（本轮最高星），TypeScript，push 2026-10-17，建 2026-08-07，topics 含 `dsh-better-sidebar`。开放侧边栏底座：三方注册新侧栏页 + 内置文件渲染编辑 / 终端 / 侧对话 / Git / 子代理页。**与本仓 `dsh-zhiyun-shell` 是同一层东西**（侧栏 + 页面插槽 + NAV 过滤）→ 接入等于**换掉外壳**而非强化 → ⛔。⭐ **架构对照价值**：其「插槽即认领」与本仓 `children` 声明同构，可回看 |
| `AdamPlatin123/dsh-plugin-radar` | A 原生DSH | MIT ✅ | 生态 | **与本任务同构**（生态雷达） | 🔵 | proposed | 2026-10-17 | ★**1474**，**Python**，push 2026-10-17。21k+ 候选持续发现 + **k8s 运行级实测 1.3 万+** + 15 分钟快照，目录为生成产物。不可直接复用（Python + k8s）；⭐ **对本文档的直接批评**：本仓只做静态分级、**15 个骨架无一经真机挂载** → 建议补「隔离 `DSH_HOME` 至少挂一次」的最小验证（范式见 `dsh-compat-vet/scripts/verify-real-boot.mjs`） |
| `ice5kysl/dsh-insights` | A 原生DSH | MIT ✅ | 插件发现 | 重复且**无增益**（市场簇） | 🔵 | proposed | 2026-10-17 | ★1，JavaScript，push 2026-10-15。生态观测站：全量发现 + manifest 门禁 + S/A–D 健康分 + 作者分析 + 周报 + 开放数据 + badge，零依赖 Node 管线。与 `dsh-market` 骨架重叠 → 不集成 |
| `121212165/dsh-plugin-eco-scan` | A 原生DSH | MIT ✅ | 插件发现 | 重复且**无增益**（市场簇） | 🔵 | proposed | 2026-10-17 | ★1，TypeScript，push 2026-10-17。星数 / npm 周下载 / release 资产下载的**日快照差分与增长排名**（`/eco-scan`）。⚠ 这是本仓雷达**没有的口径（增长 ≠ 存量）** → 留作线索源 |
| `PerryLink/dsh-plugin-doctor` | A 原生DSH | Apache-2.0 ✅ | 插件质量 | 重复且**无增益**（审计簇） | 🔵 | proposed | 2026-10-17 | ★5，JavaScript，push 2026-10-16。**零依赖核验标准**：静态结构门禁 R / cordis 契约 K / 无头沙箱冒烟 D / 生态收录 CC。审计簇已有 `dsh-plugin-audit`（骨架）+ `compat-vet`（骨架），取一即止 |
| `cherrchen/dsh-theme-studio` | A 原生DSH | MIT ✅ | 通用 | 与本仓无接缝 ⛔ | 🔵 | proposed | 2026-10-17 | ★0，TypeScript，push 2026-10-16。可移植 DSH/Cordis 主题插件（配色浏览 / 预览 / 应用 / 持久化），DSH Desktop 预装。本仓自有 `--zy-*` 主题注入、不做主题市场 → 不集成 |
| `S3K926/dsh-memory-board` | A 原生DSH | MIT ✅ | 笔记 / 复盘 | 重复可强化（**对象错位**） | 🔵 | proposed | 2026-10-17 | ★13，JavaScript，push 2026-10-17。把**文件式本地记忆档案**（日记 / 状态 / 生长 / 事件流）搬进设置页：概览 / 搜索 / 追加 / 谨慎编辑，**读写带指纹守卫 + 改前备份**。⚠ 强化的是「**agent 的记忆**」而非「**学生的笔记**」，本仓无对应写入方 → 不集成；「指纹守卫 + 改前备份」可借 |
| `mrdhira/dsh-kanban` | A 原生DSH | MIT ✅ | 学习计划 | 重复可强化（**但需新面板**） | 🔵 | proposed | 2026-10-17 | ★0，TypeScript，**建 2026-10-16**（1 天），push 2026-10-17。人机共用一块 SQLite 看板；**两道门（DoR / DoD）由看板强制**，每次移动是事件 → 周期时间与吞吐从事实算出。看板是**新页面**，不满足「同一个面板」→ 不集成；「每移动=一次事件」可与 `dsh-radar-panda-calendar` 对照 |
| `kenz1117/dsh-engram` | A 原生DSH | MIT ✅ | 通用（记忆） | 全新（本仓无记忆层） | 🔵 | proposed | 2026-10-17 | ★21，TypeScript，push 2026-10-17，topics 含 `embeddings,memory,sqlite`。SQLite + embeddings 的 agent 记忆（**描述为空**）→ 线索级，不集成 |
| `mocias/dsh-agent-room` | A 原生DSH | MIT ✅ | 通用 | 全新（多 agent 侧栏） | 🔵 | proposed | 2026-10-17 | ★0，JavaScript，**建 2026-10-15**，push 2026-10-16。侧栏里放多个 agent harness（codex / 任意 ACP），带文件图片上传与按用户主题。与 `DSH-better-sidebar` 同属「侧栏底座」→ 同判不集成 |
| `shenhuanageshei/dsh-team-link` | A 原生DSH | MIT ✅ | 通用（协作） | 全新（会话分享） | 🔵 | proposed | 2026-10-17 | ★6，JavaScript，push 2026-10-17。会话深链 + 全会话导出（MD/JSON）+ 配对后的跨会话消息。本仓单机单人形态 → 不集成；「会话导出」与 `dsh-plugin-bridge` 同域 |
| `dongkid/dsh-extra-workspaces` | A 原生DSH | MIT ✅ | 通用 | 全新（会话工作目录） | 🔵 | proposed | 2026-10-17 | ★0，JavaScript，**建 2026-10-16**，push 2026-10-16。按会话追加工作目录 + 运行时上下文提醒（告诉模型本会话可用哪些额外目录）→ 仅登记 |
| `zqh260619/dsh-dupguard` | A 原生DSH | MIT ✅ | 通用（输出质量） | 全新（复读守卫） | 🔵 | proposed | 2026-10-17 | ★3，JavaScript，push 2026-10-17。模型复读时**立即停止生成**（默认同串连续 ≥10 次），阈值 / 单元长度 / 窗口 / 白名单均可在设置页调；**已生成内容正常提交、不丢消息、不污染会话日志**。与学习场景无接缝 → 不集成；「不丢已生成内容」这条纪律可抄 |
| `lph993/dsh-project-progress` | A 原生DSH | MIT ✅ | 通用（项目管理） | 全新 | 🔵 | proposed | 2026-10-17 | ★0，TypeScript，建 2026-09-27，push 2026-10-17。描述仅一句 "deepseek harness project manager plugin"、无 topics → 线索级，不评 |
| `AL-Yichen/dsh-fullscreen-input` | A 原生DSH | MIT ✅ | 通用（输入体验） | 全新 | 🔵 | proposed | 2026-10-17 | ★2，JavaScript，建 2026-10-06，push 2026-10-17。全屏输入框（`topic:dsh-plugin`）。与本仓页面无接缝 → 不集成 |
| `HaydenSmith1121/dsh-plugins` | A 原生DSH | **`NOASSERTION`** ⚠ | 插件发现 | — | ⚠ 待核 | pending-license | 2026-10-17 | ★3，JavaScript，push 2026-10-17。插件市场（目录：一插件一配置文件 + 可视化面板 + 一键安装；本体在另一仓库）。**许可证无法识别 → 待人工核验，不采用、不摘取任何代码**；即便核实也大概率「重复无增益」（与 `dsh-market` 骨架同域） |

#### 第十二轮 · 排除簇（集中登记，不逐条铺开）

| 仓库 / 簇 | 类型 | 许可证 | 原因 | 分级 | 状态 | 首次发现 |
| --- | --- | --- | --- | --- | --- | --- |
| **主题皮肤簇**（`zkforge/dsh-claude-desktop-theme`（`NOASSERTION`）、`Nwflower/dsh-claude-style`（★174，`NOASSERTION`）、`ymh0000123/dsh-theme-endfield`（★141）、`NoNameLeGo/dsh-catppuccin-theme`（★61）、`niiang/dsh-kimino-theme`（★42）、`aklnaaw/dsh-claude-theme`（★22，`NOASSERTION`）、`FeatherHunter/dsh-opencode-palette`（★60）、`ash-qw/dsh-theme-prts`、`Xian-JL/dsh-Xiao-theme`、`Xian-JL/dsh-Kinich-theme`、`Asukahimi/dsh-dania-theme`、`yefengliu1/dsh-theme-songgrid`、`acdsh4869/dsh-aqua-theme`（AGPL-3.0）、`lemonscat7/dsh-theme-xiaohei` … 共 30+ 条） | A 原生DSH | 混合（多条 `NOASSERTION` / 1 条 AGPL-3.0） | **与本仓无强化关系**：本仓自有 `--zy-*` 主题注入层、且**不做主题市场**。`dsh-theme`（571 条）中九成为角色皮肤 / 动漫主题。**建议从 A 组词池移除该词** | ⛔ | rejected | 2026-10-17 |
| **市场 / 目录 / 排行榜簇**（`AI-Scarlett/DSH-Store`、`qomob/dsh`、`dingzhenyao/dsh-plugin-directory`（无证）、`SCP-008-1/dshop`（无证）、`189-sketch/dsh-plugins-top`、`ywsldxk/dsh-plugin-stars`（无证）、`bruc3van/awesome-dsh-plugin`（★418）、`awesome-deepseekharness/awesome-deepseek-harness`（CC0）、`0xsline/awesome-deepseek-harness`（★1190，CC0）、`tanle-mtr/dsh-plogin-plugin-recommender`、`kejixiaoliang/awesome-dsh-plugins`（已登记）、`imsai-sh/awesome-deepseek-harness-plugins`（已登记）…） | A 原生DSH / 清单 | 混合 | 与已登记 `dsh-market`（★6781）/ `dsh-web`（★8836）/ 骨架 `dsh-radar-dsh-market` **同域且无增益**；清单类已登记两条 → **不再逐条登记，只作线索源**。⚠ `topic:dsh-plugin`（19826 条）头部全为泛 agent 项目（`morluto/rea` 293k★、`nexu-io/open-design` 101k★、`ruvnet/ruflo` 75k★），**该 topic 不可作发现入口，仅统计用** | ⛔ | rejected | 2026-10-17 |
| **模型接入 / 订阅簇**（`WSL043/dsh-codex-subscription`（★184）、`diwer/dsh-codex-adapter`、`EDDY597/dsh-opencode-gateway`（`NOASSERTION`）、`kuraneko1/dsh-opencode-zen`、`HypoDear/dsh-workbuddy-connect`、`SAXEM1997/dsh-cherry-bridge`、`Yikeqm/dsh-wb-credit-fallback`） | A 原生DSH | 混合 | **接入模型 / 订阅，不强化任何学生功能**；provider 层本仓已有 `dsh-zhiyun-net-proxy` / `omni` → 无增益 | ⛔ | rejected | 2026-10-17 |
| **远程 / 手机 / 多端簇**（`chs-1108/dsh-phone-bridge`、`HypoDear/dsh-remote`（无证）、`xingzhen199186/dsh-mini-remote`、`niushuanan/xiaozhuang-dsh`（发行版）、`Twofruitsgrape/dsh-pi-bridge`（`NOASSERTION`）、`aitcmhk-web/DSH-bot`） | A 原生DSH | 混合 | 本仓单机单人形态；已登记 `dsh-pocket`（GPL-2.0）与移动网关数条 → 重复无增益 | ⛔ | rejected | 2026-10-17 |
| **角色扮演 / 小说簇**（`a86582751/dsh-nexttavern`（★177，GPL-3.0）、`flizzywine/dsh-tavern`（★1018，AGPL-3.0）…） | A 原生DSH | **GPL-3.0 / AGPL-3.0** ⛔ | **许可证红线** + 与学生场景无关 | ⛔ | rejected | 2026-10-17 |
| **非 JS 栈**（`HapyRain/dsh-router-laya`（Python，★20）、`yxdotnet/dsh-persona-driven`（Python）、`gluztm/DSHGuard`（C#，GPL-3.0）、`eovidiu/cordis-ios`（Swift，`NOASSERTION`）、`akkefa/deepseek-cordis`（Python）、`fshoocn/cordis-port`（Python，`NOASSERTION`）） | A 原生DSH | 混合 | 本仓 JS/TS 栈 → **不可复用** | ⛔ | rejected | 2026-10-17 |
| **运维 / 桌面壳 / 输入体验簇**（`henlii/dsh-plugins`、`173787247/dsh-wsl-kit`、`moon16u/dsh-pouch`、`zeng6125-rgb/dsh-llm-retry-settings`（★10）、`fpm0312/dsh-auto-compact`、`inmny/dsh-continue`、`star-Cosmo/dsh-model-tidy`、`S3K926/dsh-auto-handoff`（已弃用）、`my-dsh/deepseek-intelligent-ui`、`Hikari16665/dsh-netease-lyrics`、`MeteorNOX/DeepSeek-Balance-Whale-Widget`（★5012）、`PC2005-cloud/dsh-pet`（★1674）） | A 原生DSH | 混合 | 与「学习工作台」无接缝；宿主已具备的能力（自动压缩 / 续跑 / 重试）不再额外挂载 → 无增益 | ⛔ | rejected | 2026-10-17 |

#### 第十二轮 · 核心结论（供后续轮次直接引用）

> ① **`sort=updated` 是 A 组的有效第二视图。** 本轮 17 条候选**全部首次登记**，其中 8 条建于
> 2026-10-06 之后 —— 这些仓在历轮 `sort=stars` 下**从未出现过**。建议 A 组固定双取法（stars / updated）交替。
> ② **`topic:dsh-plugin` 不可作发现入口**（19826 条头部全为泛 agent 项目）；`dsh-theme` 对本仓无价值（571 条九成为皮肤）。
> ③ **`<词A>+<词B> in:name,description` 的写法大多返 0**；改「单主题词 + 后置过滤」才有效（本轮 #11 由此捞到唯一 🟢）。
> ④ **本仓雷达的系统性短板（自评）**：只做静态分级，**15 个骨架无一经真机挂载**。
> 上游 `dsh-plugin-radar`（★1474）用 k8s 做运行级实测，本仓学不起；但「每个骨架在隔离 `DSH_HOME` 挂一次」
> 可做，范式见 `dsh-compat-vet/scripts/verify-real-boot.mjs`。

---

## 第十三轮 · 2026-10-17 · C 组补位轴（时间管理 / 专注计时 / 任务分解 / 卡片生成）

> 取组：脚本判 `same-day(exhausted)`，按先例改跑**正交新切片**（与今日已跑词无交集）。
> 13 次搜索（⚠ 超限 3 次，为 2 个返 0 词的放宽回补）、0 次 403；87 条全部首次登记；
> **0 🟢 + 0 🟡 + 4 🔵 + 2 ⚠ + 81 ⛔**。详见 `2026-10-17-e.md`。

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `v1tzor/StudyAssistant` | B 其他JS | Apache-2.0 ✅ | 学习计时 / 任务 / 统计 | **重复且无增益** | 🔵 | proposed | 2026-10-17 | ★47 / fork 7，**Kotlin（KMP）**，push 2026-10-14，建 2024-04-17。离线优先的 AI-agent 学习助手（Tasks / Goals / Timer / Statistics / Analytics / Multi-Org；Compose + Ktor + SQLDelight）。**本轮唯一有真实工程量的项目，但非 JS 栈 → 源码不可复用**；仅「计时与统计同源」的产品结构可参照。与 `dsh-zhiyun-study-core` 计时/统计域重合且无更优底层 |
| `klaschukk/koda` | B 其他JS | MIT ✅ | 学习计时 / 日计划 | **重复且无增益**（且需新面板） | 🔵 | proposed | 2026-10-17 | ★0，TypeScript，push 2026-09-21。Electron + React 日计划器：时间块日历 + 专注计时 + 每日复盘，「计划→专注→复盘」闭环。与「今天」页 + 专注计时同域，★0 不支撑引入 → 仅线索 |
| `NoNightWatch/agent-manager-for-ai-planner` | B 其他JS | MIT ✅ | —（Agent 编排） | **与本仓无接缝** | 🔵 | proposed | 2026-10-17 | ★7，TypeScript，push 2026-04-08。任务拆分 + 模型分层 + 成本控制的 AI 编排层。**对象是 agent 任务而非学生学习计划** → 对象错位；「按任务难度选模型档」对 `dsh-zhiyun-omni` 路由有参考价值 |
| `Ordnungen/ord-dashboard` | B 其他JS | MIT ✅ | 笔记 / 复习 | **重复且无增益**（强耦合 Obsidian） | 🔵 | proposed | 2026-10-17 | ★0，TypeScript，push 2026-09-27。Obsidian 插件：笔记参与度分析 + 间隔重复。**强耦合 Obsidian API**，与自有文件式 `dsh-zhiyun-vault` 无法对接；「笔记→复习」链路本仓已有 `quiz` + `reviewQueue` → 无增益 |
| `ShadowWalker2014/open-sunsama` | B 其他JS | **`NOASSERTION`** ⚠ | 日计划 / 时间块 | 重复可强化（**但对象为职场**） | ⚠ 待核 | pending-license | 2026-10-17 | **★104**，TypeScript，push 2026-10-17，建 2026-01-29。开源 Sunsama 替代：按天看板 + 拖拽时间块 + 专注计时 + 未完成滚动 + **一键 MCP 连接器（OAuth）/ REST API**，Web/桌面/移动三端。**许可证无法识别 → 待人工核验，不采用、不摘代码**；即便核实通过，产品面向职场（学生场景需重做）→ 至多 🟡。价值点在「时间块=一等公民」数据模型 + MCP 免密钥范式 |
| `SparshGarg999/ExamArchitect` | B 其他JS | **无许可证** ⛔ | 考试复习计划 | 场景贴合但**不可采用** | ⚠ 待核→⛔ | rejected | 2026-10-17 | ★43，JavaScript，push 2026-06-04。真题卷 → 主题抽取 → 预测考点 → 个性化复习计划（PWA + FastAPI）。**场景高度贴合，但 `license = null` → 按硬边界不采用、不摘代码**，仅登记 |

### 第十三轮 · 排除簇（集中登记，不逐条铺开）

| 仓库 / 簇 | 类型 | 许可证 | 原因 | 分级 | 状态 | 首次发现 |
| --- | --- | --- | --- | --- | --- | --- |
| **Pomodoro / 专注计时单页应用簇**（`Arijit-05/Fomodoro`（★187，Kotlin）、`sonnylazuardi/react-tomato-timer`（★107）、`narlock/TamoStudy`（★94，Java）、`andreidimaano/Calcifer`（★42）、`Vishnu-Chandra/FocusTab-Browser-Extension`（★26）、`maruf009sultan/Pomoflare`（★23）、`mvareva/focus-timer`（★21）、`fgerschau/pomodoro-timer`（★15）、`teoh4770/pomotama`（★15）、`LalaGa-1119/cat-focus-timer`（★7）、`lucianodiisouza/holedeep`、`arrudadev/pomodoro-timer`、`sid-talesara/mindmelo`、`chiscookeke11/focus_timer_desktop_app`、`kabbagepatch/focus-coffee`、`Stephana-Jolly/Tokido-Timer`、`gomenasia/Focus-timer`、`zeus495/Focus-Timer-Web-UI-App`、`AhmedNaoum97/pomodoro`、`vasylpryimakdev/pomodoro-timer`、`RadyaI/miau-pomodoro`、`xiaoxiae/Florodoro`（GPL-3.0）、`dunossauro/copylot`（GPL-3.0）、`brandon-wallace/pomodoro-focus`（GPL-3.0）等 ~24 条） | B 其他JS | 混合（**多条 `null` / 3 条 GPL-3.0**） | **重复且无增益**：计时器本体是 300 行级实现，**不存在「更优底层」**；多条非 JS 栈（Kotlin/Java）。趣味交互（`holedeep` 黑洞强制休息、`focus-coffee` 透明主题）不构成强化 → 排除 | ⛔ | rejected | 2026-10-17 |
| **学生作业级 Study Planner / Dashboard 簇**（`SRISAKSHI-12/Study-Planner`、`amreeshsharma/study-planner`、`msk-panigrahi/Study-planner-focus-tracker-`、`Ankita200628/student-study-planner`、`Kash15if/study-planner`、`MSS1625/StudyPlanner`、`manjumaigur/Study-Planner`、`megihalili911-pixel/studyplan-web-app`、`Mohammedimad01/StudyFlow`、`FahimMahmudEkram/Study-Tracker`、`Dilhara-De-Alwis/StudyFlow`、`nandandas2407-web/Time-Tracker`、`Pavitrr-V/tymerr`、`vishwakarthikeya/StudySync-Student-Productivity-Dashboard`、`Vaibhavdoye/smart-study-planner-`、`Ksh1t1j07/smart-study-planner-dashboard`、`AnushaSubramani-2316/Front-End-prj-Study-Sphere-`、`mauryamisthi19-coder/StudyHub-Student-Productivity-Platform`、`ManikantaAddanki/AI-Study-Planner-Scheduler`、`Saifuddin-khan/AI-Powered-Student-Study-Planner`、`Adi-Marathe/StudyFlow` 等 ~21 条） | B 其他JS | **绝大多数 `null`（无许可证）** | `study planner javascript`（624）/ `study timer analytics dashboard javascript`（16）的**同名污染**：头部全为训练营作业、毕业设计、HTML+CSS 模板（★≤8、多无证）。**该词族对本仓无价值，建议弃用** | ⛔ | rejected | 2026-10-17 |
| **Cloze 闪卡生成器簇**（`angrbrd/flashcard-generator`、`drewwmercer/Flashcard-Generator`、`risaco/flashcard-generator`、`miritalakhani/Flashcard-Generator`、`ItsOkayItsOfficial/Flashcard-Generator`、`EkaterinaShainiak/Flashcard-Generator`、`jasonboru/Flashcard-Generator`、`KOM2005/Flashcard-Generator`、`Wat-Sacca/cloze-xlsx`、`developerKunal18/AI-Rule-Based-Flashcard-Generator-from-PDF-Python-`） | B 其他JS | **全部 `null`（无许可证）** | `cloze flashcard generator`（113 条）**整页为 2017 年「UofA Bootcamp Week 11 — Cloze Constructors」同一份作业的十余次 fork**，无许可证 + 2017 年停更 → **`cloze` 子轴封板** | ⛔ | rejected | 2026-10-17 |
| **`study analytics` 撞词簇**（`igerber/diff-diff`（DiD 因果推断）、`byukan/Marketing-Data-Science`、`ItsAwSM/Python-for-Data-Analytics`、`Aryia-Behroziuan/neurons`、`sw-song/kaggle-study`、`marcoshsq/Data_Science_Roadmap`、`iAART/aart`（黑洞光子环射线追踪）、`SomiaNasir/Google-Data-Analytics-Capstone-Cyclistic-Case-Study`） | 非 JS / 课程作业 | 混合 | `study` 撞「**研究**」、`analytics` 撞「**数据分析**」→ 全为统计学/数据科学课程，与「学习时长统计」无关。**该词不可用** | ⛔ | rejected | 2026-10-17 |
| **撞词 / 无接缝杂项**（`danderfer/Comp_Sci_Sem_2`（★214，"Bee Movie" 脚本）、`armourinfosec/Offensive-Linux-Privilege-Escalation`（★32，「study notes」）、`lichman0405/taskforge`（无证）、`PiyushAnand2006/Ekans`（无证）、`ClimbStack/climbstack-app`（React Native）、`Mapl6/personal-os`、`Chrysidoidea/mentis-planor`、`RomanGumeniuk/stupid-simple`、`rizksn/rzk-calendar-frontend`（无证）、`lucasfmujica/morchitask`（无证）、`a2105z/Chronos`（Python）、`ManakRaj-7/NexusDesk-Premium-Productivity-Desktop-Web-App`、`SENESO/notion-clone`、`styrene-lab/omegon-pi`、`trietphan/clawswarm`、`xQUANTUMTECH/agent-engine`、`melikeisil/Iris`（Java/Jira）） | B 其他JS | 混合 | 二次过滤后**均与学习工作台无接缝**（词义撞车 / 无许可证 / 技术栈不符）→ 排除 | ⛔ | rejected | 2026-10-17 |

### 第十三轮 · 核心结论（供后续轮次直接引用）

> ① **C 组「补位轴」同为薄轴，且有效候选率创十三轮最低（4/87 ≈ 4.6%）。**
> ② **宽词 `study planner`(624) / `study timer`(6284) / `study analytics`(14830) 已彻底饱和**：
> 三者合计 ~2.2 万条，入候选仅 1 条（且非 JS）；共同特征是「训练营作业 / 模板 / 数据分析课程 + 九成无许可证」
> → **建议从词池永久移除，只保留窄技术词**。
> ③ **三段式窄词 `task breakdown …` / `cloze deletion …` / `flashcard generation llm …` 全返 0**；
> 两段式放宽后才回到作业簇 → **「任务分解」「卡片生成」两个子轴一轮即见底，建议封板**。
> ④ **C 组存在结构性约束**：高星学生工具多出现在**移动端（Kotlin/Swift）/ 桌面端 / Python**，
> 而本仓是 JS/TS Web → **「高价值 ∩ JS 栈」交集趋近空集**。建议调整轮换比（A:C:B = 2:1:1），需人工裁决。
> ⑤ **本轮唯一「潜在 🟡」`open-sunsama`（★104，9 个月）卡在 `NOASSERTION`** → 待核，不采用。

---

## 第十四轮 · 2026-10-17 · 音乐 / 乐理 / 谱面正交轴

> 取组：脚本判 `same-day(exhausted)`，按先例改跑**正交新切片**（音乐/乐理，前十三轮从未触及）。
> 10 次搜索（**未超限**）、0 次 403；38 个唯一仓库全部首次登记（命中 37 + 人工核实 1）；
> **1 🟢 + 3 🟡 + 4 🔵 + 4 ⚠ + 26 ⛔**。详见 `2026-10-17-f.md`。

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `opensheetmusicdisplay/opensheetmusicdisplay` | B 其他JS | **BSD-3-Clause** ✅ | 音乐课 / 乐理 / 视唱 | **重复可强化**（看课页 · 课件区素材） | 🟢 | proposed | 2026-10-17 | ★1992 / fork 384，TS，建 2016-02-08，push 2026-10-15。MusicXML → 浏览器/无头渲染的事实标准（底层 VexFlow），含 cursor + 小节定位 + 逐音事件。锁版 `opensheetmusicdisplay@2.2.1`（npm 解包 ≈2.3 MB，自带 `vexflow@1.2.93`）。**强化三判据**：同一面板（课件区多一种素材，不新开页）/ 相似正交（媒体+播放头+对齐对象，对齐对象由字幕行换成小节）/ 更优底层（本仓无任何乐谱渲染能力）。**L2 骨架 `dsh-radar-score-practice`**。⚠ 配套 `osmd-audio-player@0.7.0` 声明 `opensheetmusicdisplay: ^0.8.4` → **大版本错配，未裁决前不可用** |
| `tan-z-tan/musicxml-io` | B 其他JS | MIT ✅ | 乐谱数据 / 练习分析 | 全新（数据层） | 🟡 | proposed | 2026-10-17 | ★7，TS，建 2025-12-27，push 2026-10-11，`0.12.1`（仅依赖 `fflate`）。MusicXML 解析/改写/序列化，可作 OSMD 之外的轻量数据层。**成熟度存疑**（★7、新建） |
| `Romanticjojo/Syrinx` | B 其他JS | Apache-2.0 ✅ | 乐器练习 / 逐音评分 | 重复可强化（看课页 · 练习反馈） | 🟡 | proposed | 2026-10-17 | ★69，TS，建 2026-08-31，push 2026-09-16。Electron/Web 长笛练习伴侣：**OSMD 渲染 + 麦克风音准检测 + 逐音打分 + 个人曲库**。**「练习反馈」而非「看谱」的真实落地样本** → 若人工判定真需求是练习反馈，应优先走此路径（同为宽松许可）。风险：新建、早期 |
| `isc/arabesque` | B 其他JS | MIT ✅ | 钢琴练习 / 乐理训练 | 重复可强化（练习面板） | 🟡 | proposed | 2026-10-17 | **★0** / fork 0，JS，建 2025-12-28，push **2026-10-17**。Web MIDI 键盘 + MusicXML + 实时逐音反馈 / 训练模式 / 严格模式 / 练习日志，PWA 且上架 App Store。功能最贴「学生自己练」，但★0 → **仅作设计参照** |
| `vexflow/vexflow` | B 其他JS | MIT ✅ | 乐理 / 谱面 | 重复可强化（若走非 OSMD 路线） | 🔵 | proposed | 2026-10-17 | ★247（fork 2023-04 建），TS，push 2026-09-16。OSMD 的底层渲染引擎。**若不用 OSMD 需自带 MusicXML 解析** → 成本高于收益，仅作降级备选 |
| `grimmdude/MidiWriterJS` | B 其他JS | MIT ✅ | —（MIDI 导出） | **不在接缝上** | 🔵 | proposed | 2026-10-17 | ★608 / fork 66，JS，建 2016-03-13，push 2026-06-16。程序化生成 MIDI/JSON。**本仓无 MIDI 出口需求** → 不用 |
| `Zachacious/MusicTheoryJS` | B 其他JS | ISC ✅ | 乐理练习 / 出题 | 重复可强化（若做乐理题） | 🔵 | proposed | 2026-10-17 | ★17，TS，push 2026-08-01。零依赖乐理库（和弦解析/调性分析/音阶/MIDI/记谱）。**只有在决定做「乐理题」时才需要**；当前无对应面板 |
| `wilfriedago/obsidian-tinymist` | B 其他JS | MIT ✅ | 论文 / 写作 | 重复且无增益（强耦合 Obsidian） | 🔵 | proposed | 2026-10-17 | ★8，TS，建 2026-09-17，push 2026-10-15。Obsidian 插件：Tinymist LSP 驱动的 Typst 编辑/预览/导出。与 `dsh-zhiyun-vault` 文件式方案不对接 → **仅「LSP → 预览」接缝写法可参照** |
| `SYKhayyat/ksav` | B 其他JS | Apache-2.0 ✅ | 写作 / 排版 | 全新（无对应面板） | 🔵 | proposed | 2026-10-17 | ★0，TS，建 2026-07-23，push 2026-10-16。真 Typst 引擎驱动的希伯来文 RTL 编辑器。**RTL 与中文无关** → 不引入；证明「真编译器 + Web 编辑器」路线可行，对论文页 Typst 路线有参考价值 |
| `0xfe/vexflow` | B 其他JS | **`NOASSERTION`** ⚠ | 乐理 / 谱面 | 重复可强化（但许可证不可核） | ⚠ 待核 | pending-license | 2026-10-17 | **★4398** / fork 654 量级的「VexFlow 原仓」，push 2025-03-05。⚠ **API 识别不出许可证** → 待人工核验，**不采用、不摘代码**。若采用 VexFlow 必须改从 `vexflow/vexflow`（MIT）取 |
| `0xfe/vextab` | B 其他JS | **`NOASSERTION`** ⚠ | 乐理 / 记谱 | — | ⚠ 待核 | pending-license | 2026-10-17 | ★654，JS，push 2026-04-15。VexTab 记谱文本解析器（VexFlow 配套）。同上，许可证不可识别 → 待核 |
| `phucdhh/HeyTeX` | B 其他JS | **`NOASSERTION`** ⚠ | 论文 / 公式排版 | 重复可强化（但许可证不可核） | ⚠ 待核 | pending-license | 2026-10-17 | ★4，JS，push 2026-07-04。浏览器端 LaTeX & Typst 实时协作编辑器（WASM）。**★4 且许可证不可识别** → 双重不达标 |
| `Pushplaybang/music-tools` | B 其他JS | **`NOASSERTION`** ⚠ | 视唱练耳 | 全新（无对应面板） | ⚠ 待核 | pending-license | 2026-10-17 | ★2，JS，push 2026-03-25。钢琴/吉他交互式耳力训练 quiz。★2 + 许可证不可识别 → 不采用 |
| `sightreader/performer` | B 其他JS | GPL-3.0 ⛔ | 视唱 | — | ⛔ | rejected | 2026-10-17 | ★3，TS，2023-01 停更。强 copyleft → 排除 |
| `SanQuilmas/ReMusic` | B 其他JS | **LGPL-3.0** ⛔ | 纸质谱扫描 | — | ⛔ | rejected | 2026-10-17 | ★3，PHP，push 2025-05-27。纸质乐谱扫描 → 可编辑数字谱（`sheet music ocr javascript` 唯一命中）。copyleft + 非 JS 栈 → 排除 |
| `anlohse/midicomposer` | 非 JS（C++） | 无许可证 ⛔ | — | — | ⛔ | rejected | 2026-10-17 | ★1，C++20 桌面 MIDI 编辑器。技术栈不符 + 无证 → 排除 |
| `beejsbj/midi-strudel`、`wowanirudh-boop/keyfall`、`jellybro99/musical_zettelkasten`、`joelkingsley/sheet-flow`、`DanWong530/music-dictation-quiz`、`foreline/sight-reading`、`unknownman/midiano`、`elbankster/MIDI-Piano-Chord-Trainer`（Python） | 混合 | **全部 `null`（无许可证）** | — | — | ⛔ | rejected | 2026-10-17 | ★0–★4 的长尾玩具/早期项目，**无一有许可证** → 按硬边界排除、不摘代码 |
| **撞词 / 无接缝簇**：`smith86n/wiki-is-mostly-fake-radom-words-word-genrationr-`（MediaWiki 模板，★10）、`isaac5373/personal-blog`、`amatlosz/asdf-tinymist`（Shell）、`stephengaito/asdf-tinymist`（Shell）、`sublimelsp/LSP-Tinymist`（Python）、`lumine-code/ide-tinymist`（★0）、`qiulinfan/obsidian-tinymist`（★0，与 `wilfriedago` 同型）、`jere-mie/wasmtex`（★3）、`artur-shlyapnikov/harmony`（★0）、`amvn-rwt/vibe-chords`（★2）、`larszu/UnableSet`（Ableton 控制器）、`EDGEGlobe-lab/geo-midi-controller-app`（CC0，但为 MIDI 控制器面板）、`Kaushal1011/LLM-Music-Composer`（无证）、`igapyon/miku-abc-player`、`mathenri/sheet-music-app`、`anywhichway/sheet-music` | 混合 | 混合 | — | — | ⛔ | rejected | 2026-10-17 | 词义撞车（`music editor` → MediaWiki/博客模板）、体量 ★≤4、或与学习工作台无接缝 → 排除 |

### 第十四轮 · 核心结论（供后续轮次直接引用）

> ① **`opensheetmusicdisplay OR vexflow`（total 325）是本轴唯一有效入口**；其余 9 词合计仅 3 条 🟡，
> 且一半为 ★0–★4 长尾 → **「音乐/乐理」轴一轮即接近见底，建议封板**。
> ② **「视唱练耳 / 耳力训练」子轴一轮即尽**（`solfa solfege sight reading training` → total **0**；
> `ear training music quiz web` → total 3，全是 ★0–★2 且两无证）→ **子轴封板**。
> ③ **「浏览器 Typst / Tinymist」子轴无货**：结果全是 Obsidian/编辑器适配器，**Tinymist 本体是 Rust LSP、
> 不是 JS 项目** → 若走 Typst 路线应**锁版 Tinymist 二进制**，不必再搜 JS 包。
> ④ **许可证陷阱**：`0xfe/vexflow`（★4398，大众引用最多的那个仓库）**API 识别为 `NOASSERTION`**，
> 而同组织后继仓 `vexflow/vexflow`（★247）为 MIT → **任何 VexFlow 引用必须从后者取**，此条应写入后续任何谱面类决策。
> ⑤ **产品层真实样本是「练习反馈」而非「看谱」**：`Syrinx`（Apache-2.0，音准+逐音打分）与 `arabesque`（MIT，Web MIDI 实时反馈）
> 都比纯渲染更贴学生；若人工判定真需求为练习反馈，**应优先改做 Syrinx 能力提取**。
> ⑥ **轮换失衡仍在扩大**（A=11 / B=8 / C=8，今日已五轮）。本轮为「能力域」补充，与 B 组无交集；
> **A 组（原生 DSH 插件）仍是唯一高产出轴**，建议人工裁决轮换比。

## 2026-10-17 · 第十五轮 · A 组（导出/工作流/MCP 编排正交切片）

> 取组：脚本判 `same-day(exhausted)`；不重复已跑关键词，改跑正交新切片。8 次搜索、0 次 403。
> 35 个唯一新仓库 → 有效 13 条（🟡2 / 🔵10）、⚠3、⛔22。**无 🟢、无骨架**。
> 完整报告见 [`2026-10-17-g.md`](./2026-10-17-g.md)。

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `omdsh-dev/dsh-paddle-ocr` | A 原生DSH | BSD-3-Clause | 课件/讲义解析 | 重复可强化（parser 版面块） | 🟡 | proposed | 2026-10-17 | **本轮最高价值**：PaddleOCR-VL 版面解析，按块输出 + 1000 页 async + 队列退避；补 `vision.js` 拼图预算与「看错版面」空白。⚠ 云端 + 独立 token，与「只用 ctx.llm、无独立 API key」原则冲突 → 未出骨架，待裁决 |
| `Sev7eEn7/dsh-sieve` | A 原生DSH | MIT | 通用（长上下文） | 重复可强化（上下文预算） | 🟡 | proposed | 2026-10-17 | 工具输出过滤 + 旧上下文裁剪（原文归档）+ 技能渐进披露；离线重放 −36.28% 字符、在线 −21.2% 输入 token（**历史数据，Jev/Laya 配置未复测**）。全局 middleware，须核宿主钩子冲突 |
| `guyusky/dsh-export-plugin` | A 原生DSH | MIT | 通用 | 新颖（会话导出） | 🔵 | proposed | 2026-10-17 | 零 npm 依赖、纯前端注入，隐藏 iframe + `window.print()`，复用 `/api/session.export`；★0 |
| `dawsondx/dsh-doc-share` | A 原生DSH | MIT | 通用 | 新颖（报告化导出） | 🔵 | proposed | 2026-10-17 | 对话→封面+摘要+章节排版 → PNG/HTML/PDF；★1 |
| `AnakinCao/dsh-md-export` | A 原生DSH | MIT | 笔记导出 | 重复可强化（笔记页） | 🔵 | proposed | 2026-10-17 | md→独立 HTML（mermaid 内联）/PDF；**与 `dsh-radar-better-markdown` 同依赖 `dsh-better-sidebar`，须统一裁决**；★1 |
| `Hudson-Junior-Wang/dsh-chat-pdf-export` | A 原生DSH | MIT | 通用 | 新颖 | 🔵 | proposed | 2026-10-17 | 打印「已渲染」的助手正文，高保真；★0 |
| `PerryLink/dsh-mcp-panel` | A 原生DSH | Apache-2.0 | 通用 | 重复（omni 已管 MCP） | 🔵 | proposed | 2026-10-17 | 只走 `mcp/status` 只读接缝 + 追加式 profile patch 写，架构干净；★76 |
| `SeverusZh/dsh-plugin-subagent-director` | A 原生DSH | MIT | 通用 | 全新（子代理选模型） | 🔵 | proposed | 2026-10-17 | 按子代理/角色模板分配 provider+model；★21 |
| `mrdevlorx/dsh-model-garden` | A 原生DSH | MIT | 通用 | 全新（模型选择器） | 🔵 | proposed | 2026-10-17 | provider 分组/收藏的可搜索模型选择器；★7 |
| `cyanseek/dsh-native-playbook` | A 原生DSH | MIT | 通用 | 全新（原生能力管理） | 🔵 | proposed | 2026-10-17 | 任务感知 use/prepare/verify 原生能力；★4 |
| `988hj7tczd-oss/dsh-computer-use` | A 原生DSH | MIT | 通用 | 重复（宿主已有） | 🔵 | proposed | 2026-10-17 | 跨平台桌面自动化；★53 |
| `Zhiyuan-Fan/Awesome-DeepSeek-Harness-Plugins` | 线索源 | MIT | — | 全新（线索源） | 🔵 | proposed | 2026-10-17 | ★574 精选清单，可并入关键词池 |
| `AwesomeHou/dsh-plugin-marketplace` | A 原生DSH | MIT | 通用 | 重复（插件页） | 🔵 | proposed | 2026-10-17 | live-sync `topic:dsh-plugin`；已有同类候选多条 |
| `LaoGordon/dsh-literature-search` | A 原生DSH | ISC | 论文 | 重复可强化（论文检索） | 🔵 | proposed | 2026-10-17 | arXiv/Crossref/OpenAlex 多源；★0 且根 package.json 名 `dsh-plugin-workspace`、无 `dsh.bundle` → 结构不规范，仅线索 |
| `tearslee/dsh-workbuddy2api` | A 原生DSH | MIT | 通用 | 无关（网关运维） | 🔵 | proposed | 2026-10-17 | 守护 workbuddy2api 并自动注册 |
| `Thedeergod666/dsh-musage` | A 原生DSH | MIT | 通用 | 无关（计费） | 🔵 | proposed | 2026-10-17 | 5 provider 套餐余额监控 |
| `wenzetan/dsh-llm-newapi` | A 原生DSH | MIT | 通用 | 无关（网关） | 🔵 | proposed | 2026-10-17 | NewAPI OpenAI 兼容 provider |
| `wingoo/codex-plugin-dsh` | A 原生DSH | MIT | 通用 | 无关（provider） | 🔵 | proposed | 2026-10-17 | 本地 Codex App Server 作 provider |
| `akira399/dsh-plugin-publisher` | A 原生DSH | MIT | 通用 | 重复无增益 | ⛔ | rejected | 2026-10-17 | 插件开发/发布工作流；已有 `dsh-radar-plugin-audit` |
| `alenhu2005/dsh-usage-export` | A 原生DSH | MIT | 通用 | 重复无增益 | ⛔ | rejected | 2026-10-17 | token 用量 + 导出，非学生场景 |
| `songoao25/dsh-bottom-info-bar` | A 原生DSH | MIT | 通用 | 重复无增益 | ⛔ | rejected | 2026-10-17 | 状态栏 provider/mode 徽章 |
| `Renzic-Stone/DSH-EasyRewrite` | A 原生DSH | MIT | 通用 | 重复无增益 | ⛔ | rejected | 2026-10-17 | 消息撤回/重编辑，宿主已有 |
| `zjl1989-li/dsh-harness-zh-cn` | A 原生DSH | MIT | 通用 | 重复无增益 | ⛔ | rejected | 2026-10-17 | 运行时汉化 system prompt；界面本身中文 |
| `Como44/dsh-zh-more` | A 原生DSH | MIT | 通用 | 重复无增益 | ⛔ | rejected | 2026-10-17 | 斜杠命令/插件卡片中文化 |
| `KNGLOKIKO/dsh-plugin-approval-zh` | A 原生DSH | MIT | 通用 | 重复无增益 | ⛔ | rejected | 2026-10-17 | 审批卡片中文化 |
| `Ragnoryok1/dsh-client-locale-ru` | A 原生DSH | MIT | — | 无关 | ⛔ | rejected | 2026-10-17 | 俄语语言包 |
| `GuidoMaxier/dsh-locale-es` | A 原生DSH | MIT | — | 无关 | ⛔ | rejected | 2026-10-17 | 西语语言包 |
| `xISPx/dsh-locale-ru` | A 原生DSH | MIT | — | 无关 | ⛔ | rejected | 2026-10-17 | 俄语语言包 |
| `rbstxt/dsh-locale-ja` | A 原生DSH | MIT | — | 无关 | ⛔ | rejected | 2026-10-17 | 日语语言包 |
| `KannaKuron/dsh-agent-lang` | A 原生DSH | MIT | — | 无关 | ⛔ | rejected | 2026-10-17 | 工具描述/思考/回复分语种控制 |
| `cjm-m/dsh-paste-code-block` | A 原生DSH | MIT | 通用 | 无关（输入框） | ⛔ | rejected | 2026-10-17 | 长代码折叠粘贴 |
| `furkancak1r/dsh-composer-plus` | A 原生DSH | MIT | 通用 | 无关（输入框） | ⛔ | rejected | 2026-10-17 | git Changes 面板 / 输入历史 |
| `C3H3-AI/dsh-quark-backup` | A 原生DSH | MIT | — | 无关 | ⛔ | rejected | 2026-10-17 | 夸克网盘定时备份 |
| `C3H3-AI/dsh-boot-wake` | A 原生DSH | MIT | — | 无关 | ⛔ | rejected | 2026-10-17 | 重启/跨日自动唤醒会话 |
| `alib8b8/dsh-plugin-aflare` | A 原生DSH | **NOASSERTION** | — | — | ⚠ 待核 | proposed | 2026-10-17 | 许可证待人工核验，**不采用、不摘代码** |
| `shuxidemosheng/dsh-tool-todo-plus` | A 原生DSH | **NOASSERTION** | 学习/今天 | 重复（todo_write 增强 fork） | ⚠ 待核 | proposed | 2026-10-17 | 许可证待核；功能与本仓待办重叠 |
| `walkinglabs/awesome-deepseek-harness-plugins` | 线索源 | **NOASSERTION** | — | 全新（线索源） | ⚠ 待核 | proposed | 2026-10-17 | 清单类，仅文字参考、不摘代码；风险低但须核 |

## 2026-10-18 · A 组（第十九轮 · topic 全量视图 + 存量再评级）

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `timestatic/dsh-session-notebook` | A 原生DSH | Apache-2.0 | 笔记/课堂对话 | 重复可强化（今天页轨迹+笔记页） | 🟢 | proposed | 2026-10-18 | ★0。划线/引用→可搜索知识库，带 text-anchor 锚定 + 快照恢复，本仓笔记域纯存储无此能力。npm `@timestatic/dsh-session-notebook@0.1.0` 已发布可锁版。⚠ 注入 4 个宿主插槽（全站划线），须先拆宿主/客户端。⚠ npm `license` 字段为空（仓库 LICENSE 为 Apache-2.0）。骨架 dsh-radar-session-notebook |
| `chenxiachan/thoughtdag` | A 原生DSH | MIT | 学习/思考脉络 | 重复可强化（知识页） | 🟡 | proposed | 2026-10-18 | ★648。无限画布+可编辑思维图（React Flow，knowledge-graph/note-taking）。⚠ **仓库 `private:true` 且 npm 上 `thoughtdag@0.2.2` 是另一产品**（按文件反查会话）、无 `dsh.bundle` → 锁版不成立，须源码级移植 |
| `FTShare-Lab/dsh_kline` | A 原生DSH | MIT | 金融通识/数据可视化 | 全新（本仓无行情域） | 🟡 | proposed | 2026-10-18 | ★33。交互式 K 线（多市场/技术指标/支撑压力/新闻基本面），原生侧栏展示。学生场景弱，故 🟡 非 🟢 |
| `Ychris12138/dsh-usage-stats` | A 原生DSH | MIT | 通用 | 重复无增益（用量域饱和） | 🔵 | proposed | 2026-10-18 | ★177。余额/配额/token 分析。用量簇已 23+ 条，`dsh-personal-center` 已 🟡「取其一即止」 |
| `Likenttt/garmin-connect-plugin-for-dsh` | A 原生DSH | MIT | 锻炼 | 全新（本仓无锻炼面板） | 🔵 | proposed | 2026-10-18 | ★31。TS+MCP，浏览器式 MFA。**唯一可用的锻炼域项**，但强依赖个人 Garmin 账号，与「无独立 API key」原则冲突，须人工裁决 |
| `Amakurai/dsh-liketavern` | A 原生DSH | MIT | — | 无关 | 🔵 | proposed | 2026-10-18 | ★121。SillyTavern 风格角色扮演界面 |
| `skymecode/deepseek-harness-for-vscode` | A 原生DSH | MIT | 通用 | 无关（编辑器扩展） | 🔵 | proposed | 2026-10-18 | ★157。VS Code 扩展形态，非 Web 工作台插件 |
| `No-PRM/dsh-explorer` | A 原生DSH | MIT | 通用 | 无关（IDE 面板） | 🔵 | proposed | 2026-10-18 | ★8。VS Code 风格文件树+git 装饰+diff，桌面 IDE 形态 |
| `A1eksib286/dsh-plugin-mathtype` | A 原生DSH | **NOASSERTION** | 论文/公式 | — | ⚠ 待核 | proposed | 2026-10-18 | ★0。Word 公式升级为 MathType OLE 对象。许可证未声明，**不采用、不摘代码** |
| `2BingLing/dsh-market` | A 原生DSH | **NOASSERTION** | 通用 | 重复无增益（插件市场已 3 个） | ⚠ 待核 | proposed | 2026-10-18 | ★155。6000+ 插件中文搜索+五维评分。无许可证，且与 `dsh-radar-dsh-market`/`dsh-radar-market` 同域 |
| `PensiveFei/dsh-voice-scribe`(再评级) | A 原生DSH | MIT | 语音输入 | 重复无增益 | ⛔ | rejected | 2026-10-18 | ★36。2026-10-15 登为 🟡；本轮语音输入簇 10 条中 9 条同质，且 `dsh-voice-mode` 能力更全（全双工+本地免 Key）→ 降为 ⛔，取值最全的一支 |
| `WizisCool/dsh-ears` | A 原生DSH | MIT | 语音输入 | 重复无增益 | ⛔ | rejected | 2026-10-18 | ★23。语音输入+文本润色，与上条同质 |
| `Real-WangLe/dsh-voice-local` | A 原生DSH | MIT | 语音输入 | 重复无增益 | ⛔ | rejected | 2026-10-18 | ★12。SenseVoice 本地离线，与 `dsh-voice-mode` 本地路径重叠 |
| `3274375092/dsh-voice` | A 原生DSH | MIT | 语音输入 | 重复无增益 | ⛔ | rejected | 2026-10-18 | ★8 |
| `Zhangbo-cn/dsh-voice-input-plugin` | A 原生DSH | MIT | 语音输入 | 重复无增益 | ⛔ | rejected | 2026-10-18 | ★6 |
| `baisama-cloud/dsh-stt-input` | A 原生DSH | MIT | 语音输入 | 重复无增益 | ⛔ | rejected | 2026-10-18 | ★3 |
| `QT-Chen/dsh-mic-input` | A 原生DSH | MIT | 语音输入 | 重复无增益 | ⛔ | rejected | 2026-10-18 | ★3 |
| `0nt-one/dsh-voice-input` | A 原生DSH | MIT | 语音输入 | 重复无增益 | ⛔ | rejected | 2026-10-18 | ★5 |
| `DIAG5/dsh-better-input` | A 原生DSH | MIT | 语音输入 | 重复无增益 | ⛔ | rejected | 2026-10-18 | ★26。语音+提示词优化+多格式转 MD 的套件，整体仍是输入框增强 |
| `AKS1st/dsh-mermaid` | A 原生DSH | MIT | 通用 | 重复无增益（markdown 渲染） | ⛔ | rejected | 2026-10-18 | ★9。已出 `dsh-radar-better-markdown` 覆盖围栏渲染 |
| `realguan/dsh-mermaid-preview` | A 原生DSH | MIT | 通用 | 重复无增益 | ⛔ | rejected | 2026-10-18 | ★2 |
| `baconbao/dsh-mermaid-image-preview` | A 原生DSH | MIT | 通用 | 重复无增益 | ⛔ | rejected | 2026-10-18 | ★4 |
| `sijidoubi/dsh-plugin-mermaid` | A 原生DSH | MIT | 通用 | 重复无增益 | ⛔ | rejected | 2026-10-18 | ★1。mermaid_render 工具 |
| `huiyeo/dsh-plugin-mermaid-preview` | A 原生DSH | MIT | 通用 | 重复无增益 | ⛔ | rejected | 2026-10-18 | ★1。右侧栏 .mmd 预览 |
| `WYH66666666/DSH-Transparent-UI-Plugin` | A 原生DSH | **AGPL-3.0** | — | 无关（主题） | ⛔ | rejected | 2026-10-18 | ★416。AGPL 一律排除 |
| `XieRW/dsh-beauty-skins` | A 原生DSH | MIT | — | 重复无增益（主题） | ⛔ | rejected | 2026-10-18 | ★100。主题域已判死（累计 ⛔ 13 条） |
| `KinGao294/dsh-skin` | A 原生DSH | MIT | — | 重复无增益（主题） | ⛔ | rejected | 2026-10-18 | ★17 |
| `dugujun3-cloud/dsh-wallpaper` | A 原生DSH | MIT | — | 重复无增益（主题） | ⛔ | rejected | 2026-10-18 | ★2。wallhaven 在线壁纸 |
| `Andersen216/dsh-whale-girl-live2d` | A 原生DSH | MIT | — | 重复无增益（桌宠） | ⛔ | rejected | 2026-10-18 | ★39。本仓已自行落地 `docs/ai-pet`（鲸鱼娘 Live2D） |
| `leaforgh/dsh-whale-pet` 族（`meto-ventus/dsh-ventus-whale` ★8 等） | A 原生DSH | MIT | — | 重复无增益（桌宠） | ⛔ | rejected | 2026-10-18 | ★8。3D 虎鲸桌宠，同上 |
| `jasondu/dsh-ui-mobile` | A 原生DSH | MIT | 通用 | 重复无增益（移动端） | ⛔ | rejected | 2026-10-18 | ★5。离屏侧栏+详情抽屉；`dsh-web-mobile`(★139) 已登记未定 |
| `biubiu23333333/dsh-mobile-layout` | A 原生DSH | MIT | 通用 | 重复无增益（移动端） | ⛔ | rejected | 2026-10-18 | ★0。窄屏 ≤719px 布局 |
| `juanlian583/dsh-mobile-adapt` | A 原生DSH | MIT | 通用 | 重复无增益（移动端） | ⛔ | rejected | 2026-10-18 | ★0 |
| `huanxi-drxx/dsh-client-ui-mobile` | A 原生DSH | MIT | 通用 | 重复无增益（移动端） | ⛔ | rejected | 2026-10-18 | ★4 |
| `TecFancy/dsh-mobile` | A 原生DSH | MIT | 通用 | 重复无增益（移动端） | ⛔ | rejected | 2026-10-18 | ★2 |
| `kexin8/dsh-composer-keys` | A 原生DSH | MIT | 通用 | 无关（输入框） | ⛔ | rejected | 2026-10-18 | ★4。↑↓ 历史 / Ctrl+C 清空 |
| `blue-a11y/dsh-client-shortcuts` | A 原生DSH | MIT | 通用 | 无关（输入框） | ⛔ | rejected | 2026-10-18 | ★1。全局快捷键注册表 |
| `dream12347/dsh-session-manager` | A 原生DSH | MIT | 通用 | 重复无增益（会话管理） | ⛔ | rejected | 2026-10-18 | ★85。与 `hkkz9522/dsh-session-manager` 同名；壳层已管会话列表 |
| `hkkz9522/dsh-session-manager` | A 原生DSH | MIT | 通用 | 重复无增益（会话管理） | ⛔ | rejected | 2026-10-18 | ★50。同上，同名竞品 |
| `FylarOpen/dsh-fylar-office-editor` | A 原生DSH | **null** | 通用 | — | ⛔ | rejected | 2026-10-18 | ★196。Office 预览/编辑，**无许可证**，只登记不摘码 |
| `drscrewdriver/dsh-docx-sidebar` | A 原生DSH | **null** | 笔记 | — | ⛔ | rejected | 2026-10-18 | ★1。右侧栏读 .docx，**无许可证** |
| `drscrewdriver/dsh-office-render` | A 原生DSH | **null** | 通用 | — | ⛔ | rejected | 2026-10-18 | ★1。Office→PDF 忠实排版，**无许可证** |
| `tyfforu/dsh-flashcard` | A 原生DSH | MIT | 复习 | 重复无增益（quiz+FSRS） | ⛔ | rejected | 2026-10-18 | ★0。Anki 式侧栏复习，与本仓 `dsh-zhiyun-quiz` + FSRS 骨架重叠 |
| `GZX2211/dsh-Visual-Workflow` | A 原生DSH | MIT | 通用 | 重复无增益（编排） | ⛔ | rejected | 2026-10-18 | ★51。可视化 Agent 编排；本仓不面向编排 |
| `xbzbing/dsh-git-panel` | A 原生DSH | MIT | 通用 | 无关（IDE 面板） | ⛔ | rejected | 2026-10-18 | ★12。IDE 风格 Git 面板 |
| `HaoyueQin/dsh-diff-stat` | A 原生DSH | MIT | 通用 | 无关（IDE 面板） | ⛔ | rejected | 2026-10-18 | ★8。edit/write 行内 +N −M 徽标 |
| `1692775560/dsh-Mimir-Academic-research` | A 原生DSH | MIT | **论文** | 重复可强化（论文域） | 🔵 | proposed | 2026-10-18 | ★541。LaTeX 边写边编译 + arXiv 管理 + 实验追踪 + GPU SSH。**整台科研工作台**，体量远超本仓论文页，只能借鉴不能挂载；`nan` 关键词轮漏登，本轮补登 |

## 2026-10-18 · B 组（第二十轮 · **CC98 轴**）

> 关键词：`zju` / `zju courses` / `cc98` / `campus app` / `zju tool`（5 次搜索，未超限；API 全程 200）。
> 85 条新仓 → 二次过滤后 13 条有效候选：🟢1 + 🟡1 + 🔵4 + ⚠1 + ⛔6。
> 许可证以 GitHub API `license.spdx_id` 为准，重点项另拉 `LICENSE`/`package.json` 实文核实。

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `Lucent-Snow/CC98-CLI` | B 其他JS | MIT | 校园论坛 / 课堂讨论 | 重复可强化（补 `dsh-zhiyun-omni` 的 `cc98` 读层） | 🟢 | proposed | 2026-10-18 | ★18。TS 原生 CLI+TUI 客户端，走 OpenID API。**`cc98-mcp` 的端点与 WebVPN 实现即参考自它**。无 DSH 形状、未导出为库 → 只能作底层实现，不能直接挂载 |
| `EviterLesRoses2/cc98-mcp` | A 原生DSH | MIT | 校园论坛（AI 读帖） | 重复可强化（**存疑**） | 🟡 | proposed | 2026-10-18 | ★4。stdio MCP server，10 个只读工具，`CC98_WEBVPN_MODE=auto`。⚠ **npm `cc98-mcp` = 404，未发布** → 锁版不成立。与 `Lucent-Snow/CC98-CLI` 同源，二选一优先后者。骨架 `dsh-radar-cc98-sdk`（骨架内自述「按现行判据很可能应判 ⛔」） |
| `walavave/CC98-CLI` | B 其他JS | MIT | 校园论坛 | 重复无增益（同一实现的分支） | 🔵 | proposed | 2026-10-18 | ★5。描述与 `Lucent-Snow/CC98-CLI` 逐字相同，后建 3 天 |
| `stevenstg/obsidian-cc98-publish` | B 其他JS | MIT | 笔记 → 论坛发帖 | 重复无增益（笔记导出已覆盖） | 🔵 | proposed | 2026-10-18 | ★6。Obsidian 插件：MD→UBB + 图片上传。本仓无发帖需求；「MD→UBB 转换」可作参考 |
| `CPbianma/zju-library-booker` | B 其他JS | MIT | 图书馆预约 | 全新（本仓无场馆预约） | 🔵 | proposed | 2026-10-18 | ★1。TS，仅查询 + 预约预览（不执行）。预约风控/验证码是不可绕过的前提 |
| `Zarad0X/openclaw-zju-skills` | B 其他JS | MIT | 课表/成绩/邮箱/CC98 | 重复无增益（`omni` 已覆盖） | 🔵 | proposed | 2026-10-18 | ★10。OpenClaw Skill 集合（非 JS 库）。价值在「校园 API 清单」，非可复用代码 |
| `kaixuanwang2003/zju-welcome` | B 其他JS | **NOASSERTION** | 新生指南 | — | ⚠ 待核 | proposed | 2026-10-18 | ★154，2026-09-20 仍活跃。HTML 策展站，**无许可证**，不采用、不摘代码 |
| `QSCTech/zju-icicles` 等课程资料族（73 条，含 `ZJU-Turing/TuringCourses` `NOASSERTION`、`PeiPei233/zju-learning-assistant` MIT 但为批量下载器、`Phil-Fan/awesome-zju-tools` CC0 已登记线索源） | B 其他JS | `null` / `NOASSERTION` / 线索源 | 课程资料 | — | ⛔ | rejected | 2026-10-18 | 内容版权受限（`null`）；且**非 JS 栈**（C/C++/Verilog/VHDL/LaTeX）。`zju courses` 一词 29 条**全部**落此簇，入候选 0 条 |
| `Mythologyli/zju-connect`（AGPL-3.0 ★798）、`Mythologyli/ZJU-Connect-for-Windows`（LGPL-3.0）、`QSCTech/zjunet`（GPL-3.0）、`5dbwat4/ZJU-live-better`（GPL-3.0 ★220） | B 其他JS | **GPL 族** | 校园网络 | 重复无增益（WebVPN 已有） | ⛔ | rejected | 2026-10-18 | 许可证红线；且 `dsh-zhiyun-net-proxy` / `omni` 已覆盖 |
| `vsloong/Sunshine`（Apache-2.0 ★84）、`ucsd/campus-mobile`（Dart）、`neuland-ingolstadt/neuland.app-native`（AGPL）、`thu-info-community/thu-info-app`（NOASSERTION ★237） | B 其他JS | 混合 | 校园 App | — | ⛔ | rejected | 2026-10-18 | 非 JS 栈 / 非本校；`campus app` 轴噪声 |
| `oddfar/campus-imaotai`（★4134）、`oddfar/campus-example`、`oddfar/uni-app_campus_web` | B 其他JS | Apache/MIT | — | 无关 | ⛔ | rejected | 2026-10-18 | 撞词：这里的 campus 指「i茅台 campus」或通用校园社交站，与浙大无关 |
| `biu9/cc98-summary`、`Ansherly/CC98-Desktop`（null）、`Ansherly/CC98-Ocean`（null）、`Yutyrannus/CC98.u`（MIT，2016 Ionic）、`kodango/cc98`（null，2012 Userscript） | B 其他JS | null / MIT | 校园论坛 | 重复无增益 | ⛔ | rejected | 2026-10-18 | 无许可证 / 停更 10 年 / 同一实现的重新打包 |

## 2026-10-18 · C 组（第二十一轮 · **技术基座轴**）· 追加

> 切片：**公式渲染 / 文献引文 / 转写摘要**（C 组首次走技术基座层，此前只扫功能层）。
> 10 次搜索（达上限未超），API 全程 200。76 条新仓 → 19 条有效候选。
> 🟢1 + 🟡1 + 🔵6 + ⚠2 + ⛔9（簇内合计）。骨架：`packages/dsh-radar-temml/`。

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `ronkok/Temml` | B 其他JS | **MIT** ✅ | 论文/笔记/讲座（公式渲染） | 重复可强化（⚠ 基线为空，待裁） | 🟢 | skeleton-created | 2026-10-18 | ★356，2026-10-08 与 npm 0.14.0 同日发布。**零依赖纯库**，周下载 72.9 万，`renderToString(tex)` → MathML 字符串，本地实测可用。本仓**无任何公式渲染器**（`$k_1$` 现由宿主 `MarkdownText` 原样显示）→ 严格说是「无→有」，雷达按「同类内容呈现升级」记强化，**定性需人工拍**。⚠ 与 `dsh-radar-better-markdown`（自带 KaTeX）**二选一或明确分层，不可都上**。已出骨架 |
| `citation-js/citation-js` | B 其他JS | **MIT** ✅ | 论文（参考文献） | 全新 | 🟡 | proposed | 2026-10-18 | ★213，2026-10-11 活跃。BibTeX/RIS/DOI/Wikidata → CSL-JSON → 按 CSL 样式排版。**要真用需自建整条 UI**（导入/选样式/插引用/生成文献表）= 新功能页而非强化 → **本轮未出骨架**，等「论文页是否做参考文献」的产品决策。底层依赖 `citeproc-js` 为 NOASSERTION，许可证链须一并核 |
| `larsgw/citation.js`、`pcooksey/bibtex-js`、`ORCID/bibtexParseJs`、`cacfd3a/bibtex-js` | B 其他JS | MIT | 论文（引文） | 重复无增益（被 citation-js 覆盖） | ⛔ | rejected | 2026-10-18 | 合并为 1 族行避免登记表膨胀。`larsgw/citation.js`(★241) 是 citation-js **旧仓/同名仓**（已迁移，勿重复引入）；`pcooksey/bibtex-js`(★279) **2020 后停更**且只做「.bib → HTML 列表」；`bibtexParseJs`(★113)、`cacfd3a/bibtex-js`(★84) 均为**单向解析器**，能力被 citation-js 完全覆盖 |
| `tamuratak/latex-utensils` | B 其他JS | MIT | 论文（LaTeX 解析） | 全新（暂不需要） | 🔵 | proposed | 2026-10-18 | ★45，TS + PEG.js。解析器非渲染器，本仓目前不解析 `.tex`。若将来做「公式编辑往返」可再看 |
| `asnunes/mathml-to-latex` | B 其他JS | MIT | 论文（公式） | 全新（二期） | 🔵 | proposed | 2026-10-18 | ★83，2026-06-10。MathML → LaTeX 反向转换。若采用 Temml，**读写往返**可能用到；属二期 |
| `mika-cn/mathml2latex` | B 其他JS | MIT | 论文（公式） | 全新（二期） | 🔵 | proposed | 2026-10-18 | ★46，**已 archived**（2023-03 停更），不再维护，仅作 `asnunes` 的备选参考 |
| `fred-wang/TeXZilla` | B 其他JS | **`null`** | 论文（公式） | — | ⛔ | rejected | 2026-10-18 | ★150 但**无许可证** → 不采用、不摘代码。能力与 Temml 重叠，无选它的理由 |
| `lo-tp/sm2-plus` | B 其他JS | MIT | 复习（闪卡） | 重复无增益 | ⛔ | rejected | 2026-10-18 | ★54，**2019-01 停更**。SM-2 改进版；本仓已有 FSRS 系列（`fsrs-browser`/`fsrs-scheduler` 骨架），**SM-2 是更旧的算法**，无强化空间 |
| `simpread/memos-daily-review-plugin` | B 其他JS | MIT | 复习（每日回顾） | 重复无增益 | 🔵 | proposed | 2026-10-18 | ★9，2026-02-24。形态是 **Memos 插件**而非可嵌入库；「每日回顾」的设计可参考，代码不可复用 |
| `Juris-M/citeproc-js` | B 其他JS | **NOASSERTION** | 论文（CSL 处理器） | 全新（引文必需底层） | ⚠ 待核 | proposed | 2026-10-18 | ★365，CSL 处理器事实标准。**NOASSERTION 成因是 CPAL-1.0 + MIT 双许可的混合写法**（并非真的没写 LICENSE）→ **须人工读 LICENSE 原文**。若上 citation-js，这是唯一绕不开的核验点 |
| `GeeLaw/bibtex-ts` | B 其他JS | **NOASSERTION** | 论文（BibTeX） | 全新（暂不需要） | ⚠ 待核 | proposed | 2026-10-18 | ★6，格式保持型 BibTeX 解析（保留原始排版，能力独特）。NOASSERTION，不采用不摘码 |
| 转写/摘要 app 簇（`haucongle/yt-summarizer`、`MakazhanAlpamys/TubeMind`、`chaimae101/youtube-summarizer`、`dmpapageo/youtube-summarizer`、`AjayThomas-crl/brievo-ai`、`tadhithya/AI-YouTube-Summarizer`、`asakohayase/ai-youtube-quiz-generator`、`Priyanshu9898/You-Tube-Transcript-Summarizer`、`MedamoniSharan/Ai-PodcastSummarizer`、`anandkumar16/ai-meeting-summarizer`、`sakhawatkabir/ai-meeting-notes`、`ketankauntia/Meeting-Summarizer-ai`） | B 其他JS | **`null`**（11/12） | 讲座（视频摘要） | 重复无增益 | ⛔ | rejected | 2026-10-18 | 12 条，**11 条无许可证**（唯一 MIT 者 `seanwessmith/…` 是 C 语言项目）。共同形态：粘一个 LLM API 做 YouTube 摘要，★≤5、无库形态、无可提取能力。**建议整簇不再扫（存量）** |
| 间隔重复 app 簇（`alanbuzek/spaced_repetition`、`SaschaMet/Brain-Wave`、`anmolsharma152/AlgoDeck`、`VivekChaurasia03/leetcode-repeater`、`melisaaleyna/WordApp`、`thinkful-ei-armadillo/*` 2 条、`EmreEksi03/…` 等） | B 其他JS | `null` / NOASSERTION | 复习 | 重复无增益 | ⛔ | rejected | 2026-10-18 | 10 条。有 MIT 的几条（★≤10）均为完整 app 且算法更旧（SM-2 / Leitner），与本仓 FSRS 重复且无增益；其余无许可证 |
| `abhishekalandikar/MCQ-QB-and-Exam-Generator`、`Rizwan-Ullah-tech/MCQ-Generator` | B 其他JS | **`null`** | 习题 | 重复无增益 | ⛔ | rejected | 2026-10-18 | `exam question bank generator` 全部结果（total=2）。★0，本地 CRUD 题库，无许可证 |
| `JorelMurray/Spaced-Repetition-Application`、`KeonTsang/Spaced-repetition-game`、`hamederostamkhani/sCardRecall`、`ArthurMaceddo/cs50w-projects` | B 其他JS | MIT/`null` | — | — | ⛔ | rejected | 2026-10-18 | **非 JS 栈**（Python / Java / Django），违反「限定 JS 技术栈」 |
| `kbhujbal/AlphaAnalyst-…`、`akash-kumar5/Lexx-LegalAI`、`Obaid38/KnowledgeHub-…`、`iamsaurabhc/picard-oss`、`SamurAIGPT/ai-knowledge-base`、`huangy22/Academic_Citation_Network`、`0xAdafang/LuminAi_WebClient`、`WojciechGos/sumarize-yt-transcription-microservices`、`Voza47/Video-Summarizer-Using-NLP` | B 其他JS | 混合 | — | 无关 | ⛔ | rejected | 2026-10-18 | `citation-js` 一词的语义漂移产物：股票分析 / 印度法律 / 通用 RAG / 微服务练习。与本仓场景无关 |
| `shandianchengzi/Zotero_Item_Updater`（GPL-3.0）、`kwikwag/mathml2latex`（GPL-2.0）、`marcovo/phpbb_mathjax`（GPL-2.0）、`AABoyles/jsBibtex`（GPL-3.0） | B 其他JS | **GPL 族** | — | — | ⛔ | rejected | 2026-10-18 | 许可证红线（GPL 不属宽松白名单） |
| `faroit/bibtex-js`、`dpfau/serviette`、`ixchow/bib` | B 其他JS | MIT/`null` | 论文（BibTeX） | 重复无增益 | ⛔ | rejected | 2026-10-18 | 2013–2020 停更 / 同一实现重新打包 / 作者自述「not production ready」 |
| `meirallmains299/ChatGPT_Latex`、`AdinathChaudhari/markdown-studio`、`jfluhler/gemini-export`、`aeudes/slidev-addon-citations`、`citation-js/replacer`、`lewisacidic/simple-cite`、`vdmitriyev/jsorcidbibtex`、`JDMCreator/bibtex-names.js`、`hubgit/citation-parsers` | B 其他JS | MIT/`null`/TeX | — | — | ⛔ | rejected | 2026-10-18 | 浏览器扩展 / 单文件 HTML 工具 / 薄包装 / 对比清单；★≤15，无独立价值 |

## 2026-10-18 · A 组（第二十二轮 · topic 分页 + 时间窗）

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `xiaoso456/dsh-tool-plus` | A 原生DSH | MIT | 课程作业/课设/跑脚本 | 重复可强化（「今天」页终端分页） | 🟢 | proposed | 2026-10-18 | ★10，2026-10-17。`@xiaoso/dsh-tool-plus@0.1.14` 已核（`dsh.bundle.patch` 3 份 + `client.inject` locale/settings）。内核 [oh-my-pi](https://github.com/can1357/oh-my-pi)（MIT ★35.8k）。补：持久 shell / 输出最小化 / 后台作业 / 行区间读 / 原子写 / 四模式编辑。**⚠ 最大争议：上游 patch 会 `disabled` 掉 tool-bash/pwsh/fs/fs-search 四行，且执行器不设沙箱参数 → 不得整包套用**。风险：pi-natives 分发 Rust 二进制、需 `--allow-build`(koffi)、puppeteer-core 调本机浏览器。**已出骨架 `dsh-radar-tool-plus`** |
| `a1141171521/dsh-plugin-memfuse` | A 原生DSH | MIT | 跨课程学习记忆 | 重复可强化（记忆簇） | 🟡 | proposed | 2026-10-18 | ★3，当周新仓，`0.1.0`。「本地优先、文本可读、失败可见」分层记忆。**记忆簇在册已 4 条 → 不新增骨架，待横评** |
| `giter00/dsh-headroom` | A 原生DSH | Apache-2.0 | 通用（长任务） | 重复可强化（上下文治理） | 🔵 | proposed | 2026-10-18 | ★17，`0.3.0`。挂 `tools/post-execute` 在物化前压缩，有损部分进 CCR store 可按 id 取回原文。与 `dsh-context`(★2134，已有骨架) 同域：前者管「压」后者管「看得见」，**可叠但需先裁** |
| `Zoria-Lind/dsh-token-optimizer` | A 原生DSH | MIT | 通用 | 重复可强化（上下文治理） | 🔵 | proposed | 2026-10-18 | ★20，`2.2.2`。分层 token 管道（输出阶梯/缓存/工具裁剪/MCP 懒加载/压缩调度）。上下文治理簇已 5 条，**簇饱和** |
| `justhalfbit/dsh-plugin-memory` | A 原生DSH | MIT | 学习记忆 | 重复可强化（记忆簇） | 🔵 | proposed | 2026-10-18 | ★14，`0.7.2`。跨会话项目记忆（Markdown + 渐进披露 + 可选后台蒸馏 + 按项目隔离）。记忆簇第 4 家，同上待横评 |
| 会话管理/回放/侧聊簇（`MingoZhou/dsh-replay` ★13、`g-yixuan/dsh-sidenote` ★13、`xohmai/dsh-session-delete` ★25/Apache-2.0、`JeffKeeping/dsh-session-manager` ★1、`TonyZiYuan/dsh-session-delete` ★0、`Zephyr-vibe/dsh-archived-sessions` ★23） | A 原生DSH | MIT / Apache-2.0 | — | 重复无增益 | ⛔ | rejected | 2026-10-18 | 6 条，全部作用于**宿主会话层**（日志/归档/删除/回放/fork）。本仓是学习面板，会话层归宿主所有 → 属「替宿主做事」非「强化学习面板」。**整簇不再扫** |
| 插件市场/插件可视化簇（`yunhuantian/dsh-plugin-hub` ★5、`jelly-000/dsh-3d-plugin-graph` ★3） | A 原生DSH | MIT | — | 重复无增益 | ⛔ | rejected | 2026-10-18 | 在册已有 `dsh-radar-dsh-market`、`plugin-audit`/`plugin-score` 与「插件」页，4 家同质 |
| `xiaoso456/dsh-workflow-lite` | A 原生DSH | **NOASSERTION** | 通用（工作流） | 重复无增益 | ⚠ 待核 | pending-license | 2026-10-18 | ★9，`0.5.0`。仓库 API `NOASSERTION` 但 `package.json` 自写 MIT —— **双源不一致，须人工读 LICENSE 原文**；不采用、不摘码。功能亦与在册 `GZX2211/dsh-Visual-Workflow`、`xuanyuanzhifeng/dsh-plugin-agent-workflow` 同域 |
| `zuoyunlai/lunheng-article-pipeline-dsh` | A 原生DSH | MIT | 论文/长文 | 重复无增益 | ⛔ | rejected | 2026-10-18 | ★16。多 Agent 深度长文流水线。与 `dsh-zhiyun-final-pass` 终稿流程重叠，且属「另起一条流水线」而非强化现有面板 |
| 当周新仓·与学习场景无关簇（`Cikian/dsh-cture-image`、`merlotqi/dsh-image`、`suanlv/dsh-local-compute-pool`、`PhilYue/dsh-llm-manage`、`yn2aa/dsh-model-fallback`、`ferrisching/dsh-prompt-predict`、`Yulu224/dsh-costview`、`guojinpeng/dsh-cost-meter`、`lemonel/dsh-prompt-freeze`、`Kevinwu901113/dsh-computer`/`dsh-dot`/`dsh-plugin-remote-use`、`Hope-Phenom/dsh-plugin-remote-use`、`ADistanceThereIs/dsh-output-loop-guard`、`Cristallin2006/DSH-CTF-Skill`、`xinspark/dsh-win-pwsh7`、`dingminhua/dsh-service-portal`、`Lao-Pi/LazyPersons-Standalone-DSH-Manager`、`zyygkg/deepseek-harness-harness`、`jiejiushijiehaohao-creator/deepseek-preset-github-plugin-security-review`） | A 原生DSH | 多为 MIT | — | 无关 | ⛔ | rejected | 2026-10-18 | 当周新建（`created:>2026-10-12`）产品：图像生成/本机算力池/模型管理/计费卡片/提示词冻结/输入框联想/远程桌面/CTF 技能/开发脚手架。★0–3，无学生场景 |
| `arale-soft/ben-dsh-crawl4ai`、`janpauldahlke/dsh-build-tools`、`unknowbug/RE-Framework`、`yu-wenchao/dsh-opencode-free-models`、`sugarforever/dsh-plugins` | A 原生DSH / 工具 | **`null`** | — | — | ⛔ | rejected | 2026-10-18 | **无许可证**（红线），只登记不摘码 |

## 2026-10-18 · A 组（第二十三轮 · **插件自检 / 兼容回归轴**）

> 同日第五轮。脚本判 `same-day(exhausted)`（今日已跑 A×2 / B / C），按先例**不重跑已跑组**，
> 改跑正交新切片：`plugin compatibility` / `plugin upgrade` / `plugin dependency` /
> `dsh-plugin in:name` / `cordis plugin` / `dsh plugin harness test`（7 次搜索，≤10，0 次 403）。
> **首次登记 6 条** + 复现 13 条；🟢1 + 🟡1 + 🔵3 + ⚠3 + ⛔11；骨架 `dsh-radar-upstream-radar`。

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `MicroMilo/upstream-radar` | A 原生DSH | **Apache-2.0** ✅ | 工作台可用性（插件页） | **重复可强化**（与 compat-vet 同列不同取证层） | 🟢 | proposed | 2026-10-18 | ★11，TS，2026-08-14 建 / 2026-10-16 push。`upstream-radar@0.45.0` 已核：`dsh.bundle.patch`=标准 patch（行 id `upstream-radar`、name `upstream-radar/dsh`）、**无 `dsh.client`（纯服务端）**、`dependencies:{}` 零依赖、`engines.node>=22`、`inject:['agents']`。许可三源一致（API/ LICENSE / npm）。**定位=常驻兼容测试**：DSH 或插件版本一变就起 Agent，在一次性 CI 里**真装真跑**，报告绑定插件字节/commit/DSH 版本/Node 版本/日志。**强化三判据成立**：仍是插件页（无 client → 结构上无法另起面板）+ 正交（现有答「现在能不能关掉」，本条答「下次启动能不能加载」）+ 底层新增本仓与 compat-vet 都没有的隔离实跑证据链。**与 `dsh-radar-compat-vet` 不重复**：静态契约 vs 动态实跑，输出同构应汇入**同一列**（`source: static\|isolated-run`）。**已出骨架 `dsh-radar-upstream-radar`**。⚠ 硬门槛 `node>=22`；⚠ 分钟级异步 + 离线须降级 `unknown`；⚠ 报告过期须降为 `stale`，否则成「看起来有证据的假保证」；⚠ **两骨架抢同一列，裁决前都不得接 profile** |
| `Noob-stupid/dsh-plugin-gating-hub` | A 原生DSH | MIT ✅ | 工作台可用性 | 重复可强化（仅借判据，不挂载） | 🟡 | proposed | 2026-10-18 | ★103，2026-08-14 建 / **2026-10-18 push（极活跃）**。npm `@noob-stupid/dsh-plugin-console@0.5.67`：`dsh.bundle.patch` + `client.inject`（runtime/locale/ui-settings）。**框架升级安全 + 插件门控**：升级前五类契约预检（消息契约/依赖 API/配置 schema/已移除 API/loader 契约）→ 备份+整树回滚点 → 失败自动回滚 → **有硬证据才自动禁用**（`@deepseek-ai/*` 与受保护行永不自动禁用）。**判 🟡 不判 🟢**：核心动作会**写 profile**（装卸/降级/改组合树），与本仓「不另开写入口」正面冲突；自带多源市场与在册 dsh-market/plugin-hub 同域。→ **只借其契约预检判据表（纯数据+纯函数）**喂给 compat-vet 的静态侧，**不得引入写入路径**；借代码须先补 ATTRIBUTION（本轮未借） |
| `AdamPlatin123/dsh-plugin-radar` | A 原生DSH / 工具 | MIT | — | 无关（线索源） | 🔵 | proposed | 2026-10-18 | ★1476，**Python**。21k+ 候选的持续发现。非 JS 栈，且本质是「本仓雷达正在做的事」→ 只作**线索源**（其候选清单可反哺 registry 补漏）。不集成 |
| `wqx11235/dsh-upgrade-guard` | A 原生DSH | MIT | 工作台可用性 | 重复可强化（簇内落选） | 🔵 | proposed | 2026-10-18 | ★2，2026-10-17。升级前兼容盘点 / 升级后契约扫描 / 启动冒烟。与 compat-vet 三件套同构，★2 且未核实包形态 → 簇内择优选了 upstream-radar |
| `PerryLink/dsh-test-drive` | A 原生DSH | Apache-2.0 | 工作台可用性 | 重复可强化（备选） | 🔵 | proposed | 2026-10-18 | ★12。把仓/npm 包装进一次性环境做冒烟。比 upstream-radar 轻，但**只做冒烟、不做版本矩阵** → 若评审嫌 upstream-radar 太重，这是备选 |
| `HiWhaleW/dsh-toolbox` | A 原生DSH | **NOASSERTION** | 工作台可用性 | 重复可强化 | ⚠ 待核 | pending-license | 2026-10-18 | ★30，2026-10-15。"plugin preflight, and compatibility monitoring" —— **功能与本轮主线直接对得上**，但许可证无法确认 → **不采用、不摘码**。若人工核实为宽松许可，可能比 upstream-radar 更轻（多了 plugin preflight）→ **值得单独一核** |
| `naodeng/dsh-qa` | A 原生DSH | **NOASSERTION** | — | 无关 | ⚠ 待核 | pending-license | 2026-10-18 | ★31。本地测试工作台（零依赖 test runner）。非学生场景 + 许可证不明 → 只登记 |
| `Nothing1024/dsh-upgrade-compat` | 工具 / Skill | **`null`** | — | — | ⚠ | rejected | 2026-10-18 | ★1，无语言标注、**无许可证** → 红线，仅登记不摘码 |
| 升级工具簇（`oh-my-dsh/dsh-plugin-upgrade-skill` ★288、`KYinCode/dsh-hot-installer` ★9、`LX2000WASD/dsh-plugin-manager-companion` ★6、`PerryLink/dsh-plugin-upgrade` ★2、`wonaren/dsh-upgrade` ★1、`zudazhuang/dsh-upgrade` ★1、`oldzhang82/dsh-conservative-upgrade` ★1） | A 原生DSH | MIT / Apache-2.0 | — | 无关（宿主层） | ⛔ | rejected | 2026-10-18 | 7 条，全部作用于**宿主/插件管理器本身**（热重载、升级、守护、回滚）。属「替宿主做事」而非「强化学习面板」，与本仓插件页无共享面板 |
| 插件市场/目录簇（`LivXue/dsh-plugin-shop` ★706、`bruc3van/awesome-dsh-plugin` ★422、`dshplugin/dsh-plugin-hub` ★250、`whyihaveyou/dsh-suite` ★60） | A 原生DSH | Apache-2.0 / MIT | — | 重复无增益 | ⛔ | rejected | 2026-10-18 | 4 条，在册已有 dsh-radar-dsh-market / plugin-hub 与「插件」页，市场簇已 6+ 家同质 |
| `PerryLink/dsh-score` ★12、`PerryLink/dsh-skill-pack-security` ★22 | A 原生DSH | Apache-2.0 | — | 重复无增益 | ⛔ | rejected | 2026-10-18 | 与在册 `plugin-score`、`plugin-audit` 重复 |
| `Nexus-Aethra/DSHBox`、`redoop/cordis-rust` | A 原生DSH / 内核 | **`null`** | — | — | ⛔ | rejected | 2026-10-18 | 无许可证红线；后者是 Rust 重写 cordis 内核，与 JS 栈无关 |
| 开发/宿主杂项簇（`Classicoke/cleverer-dsh`、`omdsh-dev/dsh-plugin-skills`、`liyown/dshx`、`anweat/dsh-browser`、`keyiadiannao/dsh-power-button`、`a903067276-rgb/dsh-file-mentions`、`qphotoai/dsh-computer-use-windows`、`fb0sh/dsh-pentester`、`HakureiMonika/dsh-sandbox-escalation-fix`、`hytime/dsh-thinking-effort`、`Player-MINEPIG/dsh-tavern`、`majiayu000/dsh-desk`、`CREAIT-nl/dsh-plugins`） | A 原生DSH | 多为 MIT | — | 无关 | ⛔ | rejected | 2026-10-18 | 13 条：开发脚手架 / 浏览器 / 电源键 / 文件提及 / 渗透测试 / 酒馆兼容 / 沙箱升级 / 推理档位 / 桌面壳。与学生场景无关或属宿主层 |

## 2026-10-18 · A 组（第二十四轮 · **知识图谱 / 链接图渲染轴**）

> 同日第六轮。脚本判 `same-day(exhausted)`（今日已跑 A×3 / B / C），按先例**不重跑已跑组**。
> 本轮从**本仓空洞**出发（vault 的 `graph` RPC 无任何页面消费者），反查生态渲染库。
> 7 次搜索（≤10，0 次 403）：`knowledge graph visualization library`(20) / `obsidian graph view`(289，stars+updated) /
> `force-directed graph react`(73) / `graphology sigma.js`(11) / `cytoscape.js`(621) / `wallet filter`(244，探针)。
> 有效候选 9 条；🟢1 + 🔵4 + ⚠1 + ⛔3 族；骨架 `dsh-radar-note-graph`。

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `cytoscape/cytoscape.js` | B 其他JS | **MIT** ✅ | 笔记（知识网） | **全新**（补缺视图，**非强化**） | 🟢 | skeleton-created | 2026-10-18 | ★11239，JS，push 2026-10-15。`cytoscape@3.34.4` 实核：`dependencies:{}` **零运行时依赖**、单包、内置图算法、Canvas/SVG 双渲染器、`cy.mount()` 直挂 DOM（无需 React 绑定）。**判据③不成立**：本仓**无任何图谱渲染器**；vault 已产出 `graph:{nodes[{id,title,inDegree,outDegree,tags}],edges}`（`src/index/vault-index.js` L208），但 `page-notes/src/client.jsx`（694 行）**零消费** → 这是「无→有」。判 🟢 的理由是「接进来就有东西看、不新建任何东西」，**不是强化**（与 `dsh-radar-temml` 同处置，定性须人工拍）。⚠ 入度/出度**不在** cytoscape，vault 已算好。已出骨架 `dsh-radar-note-graph`；⚠ 挂载形态二选一（建议纯库包、删 patch）；⚠ 右栏默认收起→默认不可见；⚠ 布局需 >800 篇降 preset |
| `zsviczian/excalibrain` | B 其他JS（Obsidian 插件） | MIT | 笔记（关系图） | 全新（借范式） | 🔵 | proposed | 2026-10-18 | ★1004，2026-09-29。**「以当前笔记为根的关系图」**（根节点 + 上下游两栏）—— 「跟随当前节点」交互的唯一成熟参考。绑 Obsidian API，**不可嵌入** → 只借交互范式，不借代码 |
| `Sanqui/obsidian-persistent-graph` | B 其他JS（Obsidian 插件） | MIT | 笔记（图谱坐标） | 全新（范式参考） | 🔵 | proposed | 2026-10-18 | ★147。节点坐标持久化的标准做法（存 workspace 状态）。骨架首版**不做**持久化（要新增存储位，与「笔记库只有 .md」冲突）；将来要做时唯一该参考的实现 |
| `vasturiano/react-force-graph` | B 其他JS | MIT | — | 重复（簇内落选） | 🔵 | proposed | 2026-10-18 | ★3325，2026-09-29。力导向图 React 组件，能力最强但绑 `three`（2D/3D/VR/AR），对「侧栏小图」过度设计 → 簇内选了零依赖的 cytoscape。将来做**全屏图谱**再回看 |
| `Wimmics/venus` | B 其他JS | Apache-2.0 | 论文/笔记（KG 仪表盘） | 全新（远期） | 🔵 | proposed | 2026-10-18 | ★2，2026-10-08，学术原型（知识图谱可视化仪表盘，多视图联动）。★2 过新不采用；「多视图共用一份选择状态」适合将来「笔记页 + 论文页共用图谱」时参考 |
| `brianpetro/obsidian-smart-connections` | B 其他JS（Obsidian 插件） | **NOASSERTION** | 笔记（语义近邻） | 可强化（语义图簇） | ⚠ 待核 | pending-license | 2026-10-18 | ★5512，JS，2026-10-10，**本轴 ★ 最高**。图谱+列表双视图、本地 embedding、语义近邻 —— 正好补 `dsh-radar-knowledge-graph` 缺的「近邻」。许可证无法确认 → **不采用、不摘码**，须人工读 LICENSE 原文 |
| `HEmile/juggl`(★821)、`Developer-Mike/obsidian-advanced-canvas`(★1562)、`noduslabs/infranodus-obsidian-plugin`(★175)、`pixmix/obsidian-viewer-nextcloud`、`IdreesInc/Waypoint`(★863) | B 其他JS（Obsidian 插件） | **GPL-3.0 / AGPL-3.0 / MPL-2.0** | — | — | ⛔ | rejected | 2026-10-18 | **5 条许可证红线**（GPL-3.0×2、AGPL-3.0×2、MPL-2.0）。`juggl` 本是最贴「可样式化局部关系图」的参考，也只能登记不可用 |
| Obsidian 图谱插件新仓簇（`elliott-json-park/obsidian-tag-graph`★1、`LowKI2/cortex-graph`★0、`NicoKNL/tasks-map`★54、`sskhekhaliya/obsidian-GraphWay`、`PGD618/my-web`、`Sammie-07/gogo-brain-wiki`、`Pierovercleaver/Notes-Editor-Obsidian`、`batuhan-bas/mufka`★4）、`ElsaTam/obsidian-extended-graph`(★238) | B 其他JS | MIT / `null` / NOASSERTION | 笔记 | 重复无增益 | ⛔ | rejected | 2026-10-18 | 9 条，全为 **Obsidian 插件 / 个人 app / 数字花园模板**，不可嵌入；除 `tasks-map`(任务图) 与 `extended-graph` 外 ★≤4 且多为当周建仓。**建议本轴 3 个月内不再扫 `obsidian graph view` 的 updated 视图** |
| 自研图渲染簇（`Aoviz-Team/graphs`★18、`i-artist/aoviz`★6、`Biki-dev/OKVE`★1、`inferagraph/core`★2）、薄包装（`plotly/react-cytoscapejs`★534、`plotly/dash-cytoscape`★679） | B 其他JS | MIT / `null` | — | 重复无增益 | ⛔ | rejected | 2026-10-18 | 自研渲染 ★低 / 2022–2024 停更 / `null` 许可证，能力被 cytoscape 完全覆盖；`react-cytoscapejs` 最后 push 2025-01，`cy.mount()` 少一层依赖 |
| `wallet filter` 前 10 条（`anjulalk/cardstock`、`rzazo24/quill`、`ArmySHan/Trove-Discord-Wallet-Bot`、`MrLouisWright/ioc-sentinel` 等） | — | MIT / `null` | — | 无关 | ⛔ | rejected | 2026-10-18 | **主动探针**：为「网络代理」页的过滤词表找底层。1 次搜索即证明「filter 词表」在 GitHub 上的唯一语义是**加密钱包 / 卡包优惠 / 交易机器人** → 该轴封板 |

## 2026-10-18 · A 组（第二十五轮 · **Markdown 结构判定层 / 目录条 / 语言控制**）

> 同日第 7 轮。脚本判 `same-day(exhausted)`，按先例不重跑已跑组。
> 15 次搜索（⚠ 超限 5 次，探针失败后未及时止损），0 次 403。
> 唯一 🟢 是**强化式集成**且判据③**成立**（正则近似 → CommonMark token 判定），本月首条无争议的强化候选。

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `markdown-it/markdown-it` | B 其他JS（纯库） | **MIT** ✅ | 笔记 / 论文（`[[双链]]` 预览、页码引用） | **重复且可强化**（判据①②③全成立） | 🟢 | skeleton-created | 2026-10-18 | ★21984，push 2026-10-16，零运行时依赖（argparse/entities/linkify-it/mdurl/punycode.js/uc.micro）。锁版 `markdown-it@14.1.0`。替掉本仓三处「正则猜语法」：`vault#excludedRanges`（缺缩进代码/setext/HTML 块）、`page-notes/client.jsx` L220 右栏正则（连围栏都不排除）、`page-paper/citations.js#protectedRanges`（单行，缺缩进代码/HTML 块）。**验收 = 与现有实现差分零差异**（`tests/vault.test.mjs` 342 行全过）。已出骨架 `dsh-radar-vault-parse`；⚠ 评审须先回答反方案（补正则 vs 接库）；⚠ 推荐走纯库包、删 patch |
| `a792883583/dsh-chat-toc` | A 原生DSH | MIT ✅ | 学习（长会话阅读） | **全新**（补目录，非强化） | 🟡 | proposed | 2026-10-18 | ★3，push 2026-09-30，`package.json` 实核 `dependencies:{}`、有 `dsh.bundle.patch`、inject `dsh-client-runtime`+`dsh-client-locale`。会话右侧边缘目录条（hover 展开、点击跳转）。与 `miaomiao636/dsh-message-navigator`（★2，功能更全更重）**二选一**，不并列接入 |
| `miaomiao636/dsh-message-navigator` | A 原生DSH | MIT ✅ | 学习（长会话） | 全新（同域备选） | 🔵 | proposed | 2026-10-18 | ★2，push 2026-09-01，零 deps，inject `dsh-client-ui-layout`+`dsh-client-ui-conversation`。用户消息大纲 + 点击跳转 + 滚动高亮 + 搜索 + 导出大纲 → 能力更全也更容易与宿主会话 UI 打架 |
| `KannaKuron/dsh-agent-lang` | A 原生DSH | MIT ✅ | 通用（中文输出） | 全新（可选） | 🔵 | proposed | 2026-10-18 | ★1，v0.12.0，inject `dsh-client-locale`+`ui-slots`+`ui-settings`。控制**工具调用描述/思维链语言**。本仓 UI 全中文、模型输出未约束 → 非痛点 |
| `Ragnoryok1/dsh-client-locale-ru`、`xISPx/dsh-locale-ru`、`linmino/dsh-zh-tw-ui` | A 原生DSH | MIT ✅ | — | 无关 | 🔵 | proposed | 2026-10-18 | 语言包簇（俄/繁中）。与浙大中文用户无关，只作「locale 包怎么写」的范本；繁中包对简体用户无收益 |
| `gwsbhqt/dsh-insight`、`liuhaolong16/dsh-hot-refresh` | A 原生DSH | MIT | 通用（插件开发） | **重复无增益** | 🔵 | proposed | 2026-10-18 | `insight`★3 只读洞察面板（插件/服务/工具/方法）—— 本仓 `page-plugins` 的 `buildView`+依赖图已覆盖；`hot-refresh`★1 开发期热刷新，`patchReload: live` 已覆盖大半。均属开发者工具，非学生场景 |
| `A1eksib286/dsh-plugin-mathtype` | A 原生DSH | **NOASSERTION** | — | — | ⚠ 待核 | pending-license | 2026-10-18 | ★0，Python，Word 公式升级为 MathType OLE。许可证无法确认 → **不采用、不摘码**，须人工读 LICENSE |
| `dakkaboy/dsh-locale-ru` | A 原生DSH | **NOASSERTION** | — | — | ⚠ 待核 | pending-license | 2026-10-18 | ★0，与 `xISPx/dsh-locale-ru`(MIT) 疑似同源复刻 —— **「无许可证 fork」的典型样本**，不采用 |
| 会话导出簇（`121212165/dsh-plugin-transcript`、`kittimzhe/dsh-session-export`、`DEVbyQIN/dsh-session-md`、`guyusky/dsh-export-plugin`、`huangfuren/dsh-conversation`） | A 原生DSH | MIT | — | **重复无增益** | ⛔ | rejected | 2026-10-18 | 5 条全部 ★0–2。10-17 已判定「导出」轴被「零依赖 + `window.print()`」范式杀穿，无护城河；本轮复核维持 |
| 粘贴打包簇（`sakuraqqq/dsh-auto-paste`、`X-noesis/dsh-paste-packer`、`XWIDE/dsh-draft-keeper`） | A 原生DSH | MIT | — | **重复无增益** | ⛔ | rejected | 2026-10-18 | ★1–3，改 composer 行为（大段文本转附件/打包卡片/保留粘贴图片）。与本仓「附件 / 草稿」模型重复，且属于**改宿主输入框**的高风险面 |
| 应用/外壳（`techflag/workdsh`★239、`Kazama-Suichiku/dshcode`★0、`vastsa/PI-Desktop`★6979 **LGPL-3.0**） | A 原生DSH / 应用 | MIT / **LGPL-3.0** | — | 无关 | ⛔ | rejected | 2026-10-18 | `workdsh` 已在册（重复无增益）；`dshcode` 是 Tauri 桌面 fork；`PI-Desktop` 许可证红线 |
| `clipboard sync plugin harness`（total 0）、`uniclip desktop clipboard`（total 1，0★ Java 2017） | — | — | — | 无关 | ⛔ | rejected | 2026-10-18 | **主动探针**：跨设备剪贴板同步插件在本生态**查无实据**（1 次搜索即废）。该轴与本工作台「跨设备」叙事距离远，**建议封板**。⚠ `uniclip` 一词会误召回本仓已采纳的 `ronkok/Temml` —— 搜索词与仓名不同源，「没搜到」≠「不存在」 |

## 2026-10-18 · 第二十六轮（A 组 · 插件自省 / 依赖图底层轴）

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `antoine-coulon/skott` | B 其他JS | **MIT** ✅ | 通用（插件页/工程可视化） | **重复可强化**（插件页模块图底层） | 🟢 | skeleton-created | 2026-10-18 | ★877，TS/ESM，2026-09-11 push，2022 建仓。一次调用产出模块图 + **循环依赖** + 未解析导入 + 孤儿。`skott@0.35.12` 实核：`exports` 含 `./graph/*`/`./rendering`。**判据③成立**：`page-plugins/src/runtime.js` 只折「运行时包级图」，答不出①文件级环②未加载边③空边。⚠ 依赖重（`@parcel/watcher` 原生 + `typescript` + `effect` + `fp-ts` + `depcheck`）→ **仅宿主侧**；⚠ 粒度死结（运行时/包级 vs 文件系统/文件级）须人工二选一；⚠ `packages/` 已 50 包须收窄 entrypoints。已出骨架 `dsh-radar-plugin-graph` |
| `tree-freedom/dsh-capability-inspector` | A 原生DSH | **MIT** ✅ | 通用（插件可用性诊断） | **重复可强化**（插件页「工具是否真可用」） | 🟡 | proposed | 2026-10-18 | ★1，2026-08-13 建仓，TS。带 `dsh.bundle.patch`；peer 仅 `cordis` + `dsh-tools`（干净）。DSH Doctor：工具/模型/技能/工作区/会话/插件/MCP 能力矩阵。**与本仓「插件」页只答依赖、不答能力**形成正交补位。★1 过新 → 未出骨架，待人工读源 |
| `Rex16200513/dsh-lifecycle-inspector` | A 原生DSH | MIT ✅ | 通用 | 全新（effect 泄漏视图） | 🔵 | proposed | 2026-10-18 | ★1，2026-09-13 建仓（1 天）。Cordis Effect 生命周期 / teardown 清理诊断，带 web client 注入。本仓无「插件 effect 是否被 dispose」视图 → 将来做内存泄漏排查时的唯一参考 |
| `CharlotteN7/dsh-plugin-inspector` | 非 DSH（CLI） | MIT ✅ | 通用（装前审视） | 全新（但非插件形态） | 🔵 | proposed | 2026-10-18 | ★0，`package.json` **无 `dsh` 字段** → 是 CLI 不是 DSH 插件（名字误导）。`js-yaml`+`tar`+`typescript` 读包判意图。只记思路：装前静态读包 |
| `kjinengineer/decode-deps` | B 其他JS | MIT ✅ | 通用 | 重复（skott 弱化版） | 🔵 | proposed | 2026-10-18 | ★24，2025-02 停更，`d3`+`express`。文件级依赖图可视化；能力被 skott 覆盖，且与「宿主「插件」页」（运行时图）无直接关系 |
| `giancarloerra/SocratiCode` | B 其他JS | **AGPL-3.0** ⛔ | — | — | ⛔ | rejected | 2026-10-18 | ★3342，本轴 ★ 最高，但 **AGPL-3.0 红线** → 只登记，不摘码 |
| JVM 依赖图插件簇（`vanniktech/gradle-dependency-graph-generator-plugin`★1627、`sbt/sbt-dependency-graph`★1243、`cashapp/licensee`★756、`ferstl/depgraph-maven-plugin`★607、`savvasdalkitsis/module-dependency-graph`★208、`gradle/github-dependency-graph-gradle-plugin`★96、`dwijnand/sbt-project-graph`★78） | 非 JS 栈 | Apache-2.0 | — | — | ⛔ | rejected | 2026-10-18 | 7 条全为 Gradle/Maven/sbt 生态（Kotlin/Scala/Java/Groovy）。**`plugin dependency graph` 是词面陷阱**：173 条里 JS 栈为 0 |
| `PaulTaykalo/objc-dependency-visualizer`★1868、`glato/emerge`★1171(Python)、`uysalserkan/dependency-visualizer`、`royvandijk06/luna`、`Archana-m11/Dependency-Vulnerability-Mapper` | 非 JS 栈 / `null` | MIT / `null` | — | — | ⛔ | rejected | 2026-10-18 | Objective-C/Swift、Python、无许可证 |
| npm 小工具簇（`krishana7911/npm-treehouse`★1、`manuartero/lock-tree`★1、`enesmuzaffer22/npm-dep-visualizer`★1、`louisan42/npm-package-visualizer`★0、`yurukusa/dep-tree`、`efealtiparmakoglu/depgraph`、`NickCirv/dependency-graph`、`sulthonzh/depgraph-viz`、`LeoOfGit/OmniPack`GPL-3.0） | B 其他JS | MIT / `null` / GPL-3.0 | — | 重复无增益 | ⛔ | rejected | 2026-10-18 | 9 条 ★≤3、多为当周建仓；能力被 skott 完全覆盖；`dep-tree`/`redesigned-pancake` 无许可证 |
| `ianho7/dsh-port-inspector`★2、`liuhange789/data-asset-inspector`★2、`AlloyPlane/dsh-f12-inspector`★1、`eighteentang/dsh-plugin-dev-tools` | A 原生DSH | MIT ✅ | — | 无关 / 重复 | ⛔ | rejected | 2026-10-18 | Windows 端口回溯 / 数据资产合规 30 插件包 / DOM 元素拾取。与学生场景无关，或与 `dsh-radar-plugin-audit`、`compat-vet` 重叠 |
| 装前审计簇（`taxueseek/dsh-plugin-guard`★1、`kiterunner1/dsh-plugin-audit`★0、`HubaKing/dsh-community-plugins`★5） | A 原生DSH | MIT ✅ | 通用（安全） | **重复无增益** | ⛔ | rejected | 2026-10-18 | 三份装前静态审计实现，与在册 `dsh-radar-plugin-audit` / `dsh-radar-compat-vet` / `rogerdigital/dsh-vet` 功能重合 → **审计轴封板 3 个月** |
| `ameerthehacker/rustyring`、`h3po/dsh-skill-plugin-lifecycle`、`echo719/dsh-plugin-hub` | — | `null` | — | — | ⛔ | rejected | 2026-10-18 | Rust 循环依赖检测器（无许可证）/ Shell skill（无许可证）/ 纯 HTML 插件导航站（无许可证） |

## 2026-10-19 · 第二十七轮（B 组 · 浙大工具脚本 ↔ 本仓数据层对读轴）

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `DongLanQwQ0/ZJU-Tongge-Schedule` | B 其他JS | **MIT** ✅ | 课表 / 今天 | **重复可强化**（今天页课表投影） | 🟢 | skeleton-created | 2026-10-19 | ★1，2026-10-02 push，零依赖 Node+纯前端。传 .ics → 建群 → 撞课比对；**浏览器本地解析、原文不上传**；重合四级（同教室/同楼栋/同区域/不同区域）。**判据③成立**：本仓 `page-today/src/agenda.js` 只有「上海时区 + 现在/接下来/已结束」，无周次网格、无楼栋距离、无 .ics 互操作。**只取本地解析+冲突判定，群组服务层不取**（工作台无自建后端）。已出骨架 `dsh-radar-tongge-schedule` |
| `burriedalien666/zju842-practice` | B 其他JS | **MIT** ✅（内容另有 `CONTENT-NOTICE.md` ⚠） | 刷题 / 学习（842 信号与系统·数电） | **重复且可强化**（学习页刷题） | 🟡 | proposed | 2026-10-19 | ★21，2026-10-04 push，Vite+Fastify 本地 App（Win/mac/Android）。2009–25 真题专题刷/整卷/收藏/自评掌握度/答案照片/考点分布。**可借核心=题库版本化**（`library.json` 指针 + `edition-<hex16>` 目录 + `validateLibraryTransition` + `atomicJson`）。⛔ `sharp` 原生 + 题库内容版权独立于代码 → 未出骨架，待人工裁定 |
| `0x000005/better-zdbk` | B 其他JS | MIT ✅ | 选课 | 全新（本仓无选课面板） | 🔵 | proposed | 2026-10-19 | ★2，660KB 单文件 UserScript，选课页内联化/过滤/快速点选。学期性极强，不做骨架 |
| `Nanoarcheaum/zju_coursecraft` | B 其他JS | MIT ✅ | 培养方案规划 | 全新（我的课无先修/培养方案） | 🔵 | proposed | 2026-10-19 | ★1，建仓 2 天。带 `academic-curriculum-map.schema.json` + 课程包导入 + 未来规划。**「培养方案/先修关系」是本仓真实空洞**，但过新，只登记 |
| `xuyicheng-zju/Selection-Assistance` | B 其他JS | Apache-2.0 ✅ | 选课决策 | 全新 | 🔵 | proposed | 2026-10-19 | ★6，TS，无描述，需读源 |
| `eWloYW8/ZJU-course-material-download` | B 其他JS | MIT ✅ | 课件下载 | **重复无增益** | 🔵 | proposed | 2026-10-19 | ★14，2026-01 后未更新。「无权限课件」下载与 `xzzd.download` 重叠且绕过权限判定，与本仓「按已登录身份正规拉取」冲突，不采用 |
| `upupming/zju-grs-ics`★8、`FinleyGe/zjut-class-timetable-ics`、`theycallmedern/ZJU-Schedule-Bot`★0 | B 其他JS/TS/Go | `null` / MIT / MIT | 课表导出 | 重复（课表已入 ics 时代） | ⛔ | rejected | 2026-10-19 | 研究生院课表→ics 的两份实现（2022 / 2024，均已停更）。本仓课表已是结构化数据，**入 ics 只是导出格式问题**，不引入新底层 |
| `lvmiao233/ZJUCompNet`★15、`LBruyne/ZJU-blockchain-course-2023`★5、`LBruyne/ZJU-blockchain-course-2024`★4、`frank-xjh/iZJU-Wiki`★6、`sjyinzju/ZJU-night-scare`★12、`shenluyao/ZJU_zdbk_plan`、`Ltto123/ZJU-low-score-course-selection-helper` | B/— | `null` | 课程资料 | — | ⛔ | rejected | 2026-10-19 | 全部 `null` 许可证：课程实验文档 / 区块链作业 / 国际校区 Wiki / 占位仓。不摘码 |
| 泛 `course review` 平台簇（`Somnath-Chattaraj/Campus-Chatter`、`KaanAkkok/Opinia`、`aliu5454/CourseRatings`、`mahadaafridi/AntRatings`、`lakyito/course-reviews`、`AlpNuhoglu/Course-Review-Platform`、`kevinpettersson/chalmers-course-reviews`、`fruitlesspeak/CourseHub`、`IshikaSaxena2005/AI-Powered-Education-Insights-Platform`） | B 其他JS | 全部 `null` | — | 无关 | ⛔ | rejected | 2026-10-19 | UBC / UCI / Sabancı / Chalmers / 泛校园社区。**`campus app` 宽词的系统性噪声**：9 条全部无许可证、全部与浙大无关 |
| 用户名 / `zjut`（浙工大）误报（`mly-zju/simpleKoa`★130、`mly-zju/chat-room`★66、`quark-zju/vscode-line-history`★13、`chenzq-98/zjut-java_web_course_design`、`HouQiming/zju_game_course`） | — | `null` | — | 无关 | ⛔ | rejected | 2026-10-19 | `zju` 出现在 owner 名或 `zjut` 里。⚠ **`zju in:name` 的系统性误报源**，后续需人工过滤 |
| `PeiPei233/zju-learning-assistant`★526、`Lucent-Snow/zju-scholar`★21、`Mythologyli/zju-connect`★798、`ZJU-Connect-for-Windows`★473、`QSCTech/zjunet`★332、`AoiKJuice/ZJU-Academic`、`ChenyuHeee/Libot`★3、`Ansherly/ZJU-*WebVPN.Csharp` | 非 JS 栈 | MIT / GPL-3.0 / AGPL-3.0 / LGPL-3.0 | 课件/VPN | — | ⛔ | rejected | 2026-10-19 | Rust / Python / Go / C# / Shell。`zju-connect` 为 **AGPL-3.0**、`ZJU-Connect-for-Windows` 为 **LGPL-3.0** → 许可证红线，且本仓 VPN 层已有 `dsh-zhiyun-net-proxy` |
| `ZJU-FAST-Lab/e2e_opt`★55、`ZJU-OmniAI/LLM_in_Work`★19、`ZJUBCA/zjubca.wallet`★29、`SJoJoK/ZJU_Charger`★16、`TeresaPeng-zju/be-water`★24、`ZHENG28/zjut_LibrarySeatSystem`★7、`Santosh766/Discounted-Price-Prediction`、`codepiper/UniversityNotifications`、`AhmedZ70/UniCentral`、`022003harsh/TechBard`、`Shaamiilll/Skillup-E-learning` | — | 混合 | — | 无关 | ⛔ | rejected | 2026-10-19 | 科研代码 / Office-AI 桥接 / 加密钱包 / 充电桩 / 无关 SaaS。`zju_library_seat` 为 SSM 造假项目 |
| `Slowist-Lee/website-converter` | B 其他JS | `null` | WebVPN 链接转换 | 重复无增益 | ⛔ | rejected | 2026-10-19 | ★2，WebVPN 代理链接→普通链接。本仓 `dsh-zhiyun-net-proxy` 已在数据出口层处理分域代理，**不需要在渲染层再转换链接**；且无许可证 |
| `lybx-leyw/dsh-zju-workbench` | — | `null` | — | 自身 | ⛔ | rejected | 2026-10-19 | 本仓自身 |

## 2026-10-19 · 第二十八轮（A 组 · 规划/计划轴 · `dsh-plugin <动词>` 视图）

> 同日第 2 轮（00:00 已跑 B 组第二十七轮）。搜索 10 次，0 次 403。本轮 `NOASSERTION` 0 条。

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `KelaoHu/dsh-lowtide` | A 原生DSH | **MIT** ✅（仓库/package.json/npm/元数据四源一致） | 规划 / 时间管理 | **重复可强化**（规划页卡片 → 执行端） | 🟢 | skeleton-created | 2026-10-19 | ★174，2026-10-17 push，**npm `dsh-lowtide@0.2.8` 已发布**（锁版成立）。峰谷价窗口调度 + 四策略 + 待裁定 + 执行报告（实花/已省）。中文文案 383 条。⚠ 上游 `cordis.patch.yml` 的 `permission` 块**整行替换**宿主权限行并加 3 个 `approval: never` 预设 → 骨架**只取 insert**。⚠ `POST /ds-lowtide/tasks` 需默认关闭。已出骨架 `dsh-radar-lowtide` |
| `zriyox/dsh-goal-scaffold` | A 原生DSH | MIT ✅ | 计划制定 | 重复可强化（规划页缺验收判据） | 🟡 | proposed | 2026-10-19 | ★2，2026-08-15。一句话大需求先拦截 → plan.md（每条带验收判据）+ 轮次上限 goal。**未发布 npm** → 锁版不成立，只能源码级移植。触发靠 `minLength:80` 长度阈值而非任务规模，仅记思路 |
| `ztl34245881-commits/dsh-task-planner` | A 原生DSH | MIT ✅ | 规划 / 经验复用 | 重复可强化（plans.js 每次从零拆） | 🟡 | proposed | 2026-10-19 | ★3，2026-08-14。`plan_task` 回忆相似旧方案 → 评估 → 拆步，自动落 draft 课。⚠ **仓库仅 5 个文件、无 `src/` 无 `lib/`**，实现缺失、装不上。只记「经验复用」思路 |
| `viyiviyi/dsh-tree-task-flow` | A 原生DSH | MIT ✅ | 任务拆解 | 重复可强化（卡片层级） | 🔵 | proposed | 2026-10-19 | ★3，2026-10-15。目标→任务→子任务三级树；节点完成时**把执行过程从上下文折叠**（省 token 的巧思）。容器是「对话内任务流」，与规划页卡片不同容器，只取折叠思路 |
| `weibaohui/dsh-tasks` | A 原生DSH | MIT ✅ | 定时事项 | 全新（本仓无定时任务） | 🔵 | proposed | 2026-10-19 | ★9，2026-10-09。cron 定时 → 新建 agent 会话提交提示词。与 lowtide 同轴不同层（cron vs 价格窗口，无裁定）。lowtide 通过后本条转「重复无增益」 |
| `godv61/dsh-task-engine` | A 原生DSH | MIT ✅ | 通用（软件工程） | 全新（工程流水线） | 🔵 | proposed | 2026-10-19 | ★9，2026-10-14。任务阶段 + 验证记录 + commit 联动。学生场景弱 |
| `LeemanCheung/dsh-task-dag` | A 原生DSH | MIT ✅ | 通用 | 全新（无子代理编排） | 🔵 | proposed | 2026-10-19 | ★12，2026-09-26。子代理/工作流执行图 DAG 可视化。与 `dsh-radar-plugin-graph`（模块依赖图）同域不同物 |
| 看板簇：`cloader/dsh-taskboard`★65、`callmesoul/deepseek-kanban-plugin`★4、`jerryxff26-alt/dsh-delivery-board`★3、`FiretrUCK666/dsh-task-board`★2、`scwlkq/dsh-task-board`★2、`navid-kianfar/dsh-tasks-manager`★2、`Ericwong5021/dsh-kanban`★2、`GPNUdirichlet/dsh-kanban`★1 | A/— | 混合（`callmesoul` 为 `null`） | 多项目管理 | **重复无增益** | ⛔ | rejected | 2026-10-19 | 全部「侧栏 + 多列 + 拖拽」同形态；本仓无多项目看板需求，`shengsheng90/DSH-taskboard`★336 已在册为同域最强 |
| 状态/通知簇：`p2coder/dsh-task-control`★9、`vlln/dsh-task-status`★8、`PickedAshi/DSH_taskbar_status_display_2.0`★6、`ltao0829/dsh-task-notify`★5、`1514100951/dsh-notify-plugins`★2 | A 原生DSH | MIT / BSD-3 / `null` | 通用 | **重复无增益** | ⛔ | rejected | 2026-10-19 | 暂停/恢复/取消、后台状态条、完成通知，宿主已有；`PickedAshi` 无许可证 |
| 甘特/todo 簇：`xx529/dsh-task-gantt`★2、`liuyuguo99/dsh-task-todo`★1、`Luke-Yong/dsh-plugin-project-management`★1 | A 原生DSH | MIT ✅ | 规划视图 | 重复无增益（前置条件不成立） | ⛔ | rejected | 2026-10-19 | 甘特需预估工期，本仓卡片只有 `due`，无起点可画 |
| 合集/技能文本：`kouyichi/dsh-plugins`★2、`ZhQkYu/dsh-token-saver-plugins`★1、`seanrobertwright/Deepseek-Archon-Plugin`★1、`tcflying/else-workflow-plugins`、`ZG2017/dsh-plugin-insight-mode`★1、`bauerelizabeth07139/plan-guardian-skill`、`akeno6388/dsh-plugin-kirara-dev`★1、`lanbaolu/dsh-plugin-standard`、`LeslieWylie/dsh-plugin-release`★2、`dreamtao2199/dsh-plugin-handbook`、`Mian-mian-hub/dsh-devrel-toolkit`、`Klukai-416-Clukay/dsh-skill-curator`、`qgd1850890306-rgb/dsh-todo-checklist`★1、`863683348/dsh-plugin-academic-writing`★3、`863683348/dsh-plugin-local-life`、`RavenWangChina/yuanzhu`(AGPL-3.0)、`Twofruitsgrape/dsh-comsol`(Python) | A/— | 混合（2 条 `null`，1 条 AGPL） | — | 无关/不可评估 | ⛔ | rejected | 2026-10-19 | 多插件合集、纯 skill 文本、非 JS 栈或与「规划」无关；`yuanzhu` 为 **AGPL-3.0** 红线 |

## 2026-10-19 · 第二十九轮（A 组派生 · **中文检索底层轴**）

> 同日第 3 轮（00:00 B 组第二十七轮 / 03:10 A 组第二十八轮）。搜索 15 次，上限 10，**⚠ 超限 5 次**；0 次 403。
> 本轮 `NOASSERTION` 1 条（`bluelovers/ws-segment`，未采用）。**依据：从本仓空洞出发** ——
> `dsh-zhiyun-page-study/src/layered-search.js` 自述「匹配是字面（不切词、不算相关度）」。

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `xmflswood/pinyin-match` | B 其他JS | **MIT** ✅（仓库/元数据/package.json/npm 四源一致） | 笔记 / 讲义检索 | **重复可强化**（学习页检索换底层） | 🟢 | skeleton-created | 2026-10-19 | ★1072，2025-12-07 push，**npm `pinyin-match@1.2.10`**（锁版成立），**零运行时依赖**。汉字/全拼/首字母/多音字/繁简双字典，`match()` 回**闭区间** `[s,e]|false`。实测本仓 `ddj`/`daodejing`/`lisao`/`ls` 全部 0 命中 → 上游可命中。⚠ **简体入口对纯繁体文本的拼音查询回 false**（须繁体入口懒加载）；⚠ 1440 字块 × 1000 次 = 306ms（Node22）。已出骨架 `dsh-radar-pinyin-match` |
| `nk2028/opencc-js` | B 其他JS | **MIT AND Apache-2.0** ✅（含 `opencc-data` Apache-2.0） | 古文 / 简繁混排 | 重复可强化（但方式冲突） | 🟡 | proposed | 2026-10-19 | ★361，2026-09-21 push，`1.4.2`。实测 `cn→twp` 词级转换正确（头发→頭髮/里面→裡面/后来→後來）。**本轮不采用**：解决方式要么整库转写（`dist/umd/full.js` **1.1MB**，浏览器端首屏不可接受），要么改写用户输入语义；留待「讲义自带简繁切换」独立需求再评 |
| `tongwentang/tongwen-core` | B 其他JS | MIT ✅ | 简繁阅读 | 重复可强化（同上） | 🔵 | proposed | 2026-10-19 | ★71，2024-09 push，npm `tongwen-core@4.1.1`（374KB，零依赖）。纯 JS 简繁转换（词库级）。比 opencc-js 小，但仍属「转换」而非「查询侧多一种读法」 |
| `hotoo/pinyin` | B 其他JS | MIT ✅ | 拼音 | 重复（被 pinyin-match 覆盖） | 🔵 | proposed | 2026-10-19 | ★7830，2026-06 push。汉字→拼音**转换**库（不是检索）。若将来要做「给术语表加注音」可用；检索场景被 pinyin-match 覆盖，**重复无增益** |
| `Kaifuny/pinyin4js` | B 其他JS | MIT ✅ | 拼音 | 重复无增益 | 🔵 | proposed | 2026-10-19 | ★178，2022-02 push，npm `1.3.18`（931KB）。转换+首字母，但**不支持多音字检索/繁简**，且体积大 |
| `breezewish/pinyinlite` | B 其他JS | MIT ✅ | 拼音 | 重复无增益 | 🔵 | proposed | 2026-10-19 | ★238，2017 停更。极轻量转换库，无检索能力 |
| `fengkx/jieba-wasm` | 非 JS 源 | MIT ✅ | 分词 | 全新（本仓无分词） | 🔵 | proposed | 2026-10-19 | ★102，2026-01 push，npm `jieba-wasm@2.4.0`（**15.7MB wasm**）。真正的「先分词再索引 / 相关度」路线；体积与 wasm 加载成本对浏览器首屏不友好，且本仓当前无相关度排序需求 → 只记录 |
| `messense/jieba-rs` | 非 JS 源（Rust） | MIT ✅ | 分词 | 全新 | 🔵 | proposed | 2026-10-19 | ★986，2026-10-15 push。上游 jieba 的 Rust 实现，是 `jieba-wasm` 的底座。非 JS 栈，仅作技术路线参考 |
| `bluelovers/ws-segment` | B 其他JS | **`NOASSERTION`** ⚠ | 分词 | — | 🔵 | proposed | 2026-10-19 | ★12，2026-10-14 push。TS 中文分词。**许可证 `NOASSERTION` → 待人工核验，不采用、不摘码** |
| `maxchang3/web-word-segment` | B 其他JS | MIT ✅ | 中文分词教学 | 无关 | ⛔ | rejected | 2026-10-19 | ★1。一个基于 `jieba-wasm` + `Intl.Segmenter` 的**网页演示**，不是库 |
| `hermanschaaf/jieba-js`★52 / `shataniya/cncut`★5 / `Superjomn/qlin`★2 / `uranbekanarbaev/pinyin-to-chinese`★0 / `Xiej5645/writerHanzi`★0 | B/— | 混合（多为 `null`） | — | 无关 | ⛔ | rejected | 2026-10-19 | 2013–2014 的 jieba 移植 / 无证小工具 / 拼音→汉字（反向，需求不存在）/ 汉字笔顺练习（与本轮轴无关） |
| `Xebec33/Mainland_Traditional_Chinese_Converter`★5 / `fartbagxp/home-simplified-to-traditional`★1 / `holsoma/spotify-web-lyrics-trad-simplified`★1 / `brentwong2020/CopyTradify`★0 / `QiyuanLuo233/simplified2traditional`★0 / `LibreService/my_opencc`★13 / `bluelovers/cjk-convert`★14 | B/— | Apache-2.0 / MIT / **AGPL-3.0** / `null` | — | 无关 | ⛔ | rejected | 2026-10-19 | 在线转换小工具、Tampermonkey 脚本、InDesign 脚本；`my_opencc` 为 **AGPL-3.0** 红线；`cjk-convert` 无许可证 |
| `Yark-yao/Chinese-Stroke-Order-Generator`★50 / `jilldata/hanzi-stroke-data` | B 其他JS | MIT / `null` | 汉字学习 | 无关（本轮轴外） | ⛔ | rejected | 2026-10-19 | 笔顺 GIF 生成器（Puppeteer 依赖）；笔顺数据集无许可证。**轴外误召回** |
| `edvardsr/cc-cedict`★35 / `polo-language/chinese-dictionary`★3 / `joshchaotang/claude-code-i18n`★37 / `n0/GitHub-Achievement-CLI`★87 / `ffzz/match-name-lambda`★0 | B/— | 混合（2 条 `null`） | — | 无关 | ⛔ | rejected | 2026-10-19 | 英汉词典 / Claude Code 汉化 / GitHub 成就脚本。`fuzzy matching chinese language:typescript`（total 1）与 `traditional simplified chinese language:typescript`（total 44）**前排多为误召回** |

## 2026-10-19 · 第三十轮（C 组 · **答案等价判定轴**）

> 同日第 4 轮（00:00 B / 03:10 A / 06:05 A 派生）。搜索 **10 次**（达上限未超限），0 次 403，**0 条 `NOASSERTION`**。
> **依据：从本仓空洞出发** —— `dsh-zhiyun-quiz` 的 `QUIZ_AUTOGRADE_VERDICTS` 有 `unknown`（判不了），
> 但判据只有 `normalizeForTrace()` 的字符串归一；实测 7 类等价写法全部落空。

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `MikeMcl/decimal.js` | B 其他JS | **MIT** ✅（metadata/npm/包内 LICENCE 一致） | 填空判分 | **重复可强化**（作答判定换底层，加等价归一） | 🟢 | skeleton-created | 2026-10-19 | ★7267，2026-08-30 push，**npm `decimal.js@10.6.0`**（锁版成立），0 依赖，~284KB。`Decimal#equals` 任意精度 → `1/2` vs `0.5`、`5e3` vs `5000`。已出骨架 `dsh-radar-answer-equiv` |
| `Achuan-2/chinese_number_to_digits` | B 其他JS | MIT ✅ | 数词→数值 | 重复可强化（但实现有错） | 🔵 | proposed | 2026-10-19 | ★1，4.0KB 单文件、无 ESM、无 npm。**实测 `一千二百万→1002000000`、`十二亿三千四百万→4204000000` 均错**。只作行为观测，不摘码 |
| `spa5k/chinese-numbers-to-arabic` | B 其他JS | MIT ✅ | 同上 | 重复可强化（但实现有错） | 🔵 | proposed | 2026-10-19 | ★5，npm `2.0.0`（24.7KB，0 依赖）。**实测 `一亿二千万→1000020000000` 错**，与上一行错法方向相反 → 取交集亦不成立 |
| `lisez/lib-arabic-chinese` | B 其他JS | MIT ✅ | 数字读法 | 方向相反（阿拉伯→中文） | 🔵 | proposed | 2026-10-19 | ★4，npm `2.0.0`（18KB，0 依赖）。单向，判分所需方向相反 |
| `anton-bot/chinese-numbers-converter.js` | B 其他JS | **Unlicense** ✅ | 数字读法 | 单向且覆盖不全 | 🔵 | proposed | 2026-10-19 | ★24，2020 停更。单向；未覆盖「亿/万」复合读法 |
| `LiuQixuan/ChineseNumerals`（npm `chinesenum`） | B 其他JS | MIT ✅ | 数词转换 | 声称双向、实测单向 | 🔵 | proposed | 2026-10-19 | npm `1.0.2`，115KB。**实测 `chinanumeralsToNum` 对任意输入抛错**（`Cannot read properties of undefined`）→ 只有 `numToChinanumerals` 可用 |
| `MikeMcl/decimal.js-light`★410 / `royNiladri/js-big-decimal`★165 / `shinuza/decimal-js`★56 | B 其他JS | 均 MIT ✅ | 数值判定 | 重复无增益（被 decimal.js 覆盖） | 🔵 | proposed | 2026-10-19 | 精度面/API 均弱于 `decimal.js`；若评审嫌 284KB 可改 light，但需重做等值判定 |
| `Wall-ee/chinese2digits` | 非 JS（Python） | **`null`** ⛔ | 数词→数值 | — | ⛔ | rejected | 2026-10-19 | ★374，描述最贴（含「点二八」「负百分之四十」），但**无许可证** → 只登记「仅供参考」，不摘码不移植 |
| `HardusLom/UnitLab` | B 其他JS | **`null`** ⛔ | 单位换算 | 轴外 | ⛔ | rejected | 2026-10-19 | ★0。单位换算轴同轮唯一命中，无许可证；且本轮不做单位换算 |
| 制卡/cloze 簇：`jsoendermann/ClozedForBusiness`(**GPL-3.0**)、`peterjcarroll/ClozeMaker`、`milwrite/cloze-reader`、`quetzalt52/Flashcard-Generator`、`jackson9413/cloze-forge`、`NovaCards/anki-card-cleaner` 等 | — | 混合（GPL / `null` / MIT） | 制卡 | 无关 | ⛔ | rejected | 2026-10-19 | 制卡工具不是判分层；GPL-3.0 红线 |
| 判分器簇：`qbreader/qb-answer-checker`(JS,`null`)、`Akshint0407/Automated-Answer-Checker`(Py,Apache)、`Junibabng/MyAnswerChecker`(Py,MIT)、`Jay22519/Automatic-Answer-checker-`(Jupyter,`null`)、`arnabm14/Subjective_Answer_Checker`(Py,`null`) 等 | — | 混合 | 判分 | 形态不符 | ⛔ | rejected | 2026-10-19 | quizbowl 答案行判等 / 站内服务，非可复用库；多数非 JS 栈 |

## 2026-10-19 · 第三十一轮（A 组派生 · **渲染底层轴**）

> 同日第 5 轮（00:00 B / 03:10 A / 06:05 A派生 / 09:20 C）。`radar-rotation.mjs` 返回 `same-day(exhausted)` → B，
> B 组今天已跑过，**不采纳**，改跑从未扫过的**渲染底层轴**（Markdown / 代码高亮 / 数学 / 图表 / HTML 净化）。
> 搜索 **12 次（⚠ 超限 2 次）**，0 次 403；第 11 次为发现 `dsh-raw-html` 后的 A 类补扫，第 12 次为去重校验。
> **依据：从本仓空洞出发** —— `dsh-radar-better-markdown/src/index.js` L37 的 TODO（「评估 mermaid + katex + shiki 的体积与首屏影响」）+ `page-notes/src/client.jsx` L23-26（正文渲染交宿主），两条合起来 = 渲染是宿主的事，但**渲染得好不好看无人管**。

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `highlightjs/highlight.js` | B 其他JS | **BSD-3-Clause** ✅（GitHub metadata + npm `license` 两源一致） | 讲义/论文/笔记里的代码块 | **重复且可强化**（着色层从无到有） | 🟢 | skeleton-created | 2026-10-19 | ★25002，2026-09-06 push，**npm `highlight.js@11.12.0`**（锁版成立），**`dependencies` 为空、无构建步骤**。实测：`lib/core.js` 可直接 import；未 register 的语言 `highlight()` **抛 `Unknown language`**（不会静默猜）；`highlightAuto()` 在 core-only 下**仍返回结果**（只认已注册语言）→ **必须禁用**，否则 C 代码会被着成 python 类名。⚠ 全量 `unpackedSize` 5.50 MB（`es/` 2.7 MB、`styles/` 2.4 MB），**core-only 首屏体积未实测**。已出骨架 `dsh-radar-code-highlight` |
| `plolpl789/dsh-raw-html` | **A 原生DSH** | MIT ✅ | 对话正文渲染（非笔记） | 重复但**面板不对**（对话流 vs 笔记/讲义） | 🟡 | proposed | 2026-10-19 | ★80，2026-08-28 push，topics `dsh-plugin` 族，`dsh.bundle.patch` + `dsh.client.inject` 齐全。**本轮不接，三门只过一道**：①形态 ✅ ②许可 ✅ ③**锁版 ❌ —— repo `private:true`，npm `dsh-raw-html` 与 `@plolpl789/dsh-raw-html` 均 404**；且 v1 接入依赖 `patch/patch-frontend.cjs`（改宿主渲染），与本仓「不改上游源码」冲突。字体资产 30+ woff2，作为工作台依赖过重。**价值：DSH 生态里唯一现成的「HTML→卡片 + KaTeX + Mermaid」参考实现（只读参考）** |
| `plolpl789/dsh-raw-html-v2` | A 原生DSH | **`NOASSERTION`** ⚠ | 同上 | 同上 | 🔵 | pending-license | 2026-10-19 | ★74，**2026-10-08 仍活跃**，「官方 Slot API 版、零 bundle 补丁、复用 v1 引擎」——形态上**比 v1 更符合本仓规则**（不需要改宿主）。但 `package.json` 无 `license` 字段 → API 判 `NOASSERTION`，**待人工核验，不采用、不摘码**；且同样 npm 未发布 → 锁版仍不成立 |
| `serkodev/markdown-exit` | B 其他JS | MIT ✅ | 笔记/论文解析 | 重复可强化（增益有限） | 🔵 | proposed | 2026-10-19 | ★1370，2026-08-24 push，npm `markdown-exit@1.3.0`（164 KB tarball，deps 7 个全纯 JS）。markdown-it 的 TS 重写、**同名 API**，可作已出的 `dsh-radar-vault-parse`（锁 `markdown-it@14.1.0`）的替换备选；无实质增益 → 不改现有骨架 |
| `comarkdown/comark` | B 其他JS | MIT ✅ | AI 回答流式渲染 | **全新**（本仓无流式 Markdown） | 🔵 | proposed | 2026-10-19 | ★1063，**2026-10-19 当日活跃**。把 Markdown 流式渲染到 React/Vue/Svelte/Angular/终端；与静态笔记渲染正交。若「问一问」要做流式富文本再回看 |
| `cure53/DOMPurify` | B 其他JS | Apache-2.0 ✅ | — | **全新**（当期无需求） | 🔵 | proposed | 2026-10-19 | ★17472，2026-10-16 push，npm `dompurify@3.4.17`（`(MPL-2.0 OR Apache-2.0)` → 取 Apache 分支）。本仓唯一 `dangerouslySetInnerHTML` 是 `ui-primitives` 的品牌 SVG 常量（非用户内容）→ 无需求。**条件性前置件**：若采纳任何「正文 HTML」通路，必须先上它 |
| `bevacqua/insane` | B 其他JS | MIT ✅ | — | 重复（DOMPurify 的轻量替代） | 🔵 | proposed | 2026-10-19 | ★483，2024-05 停更。白名单式净化器，无需 DOM；只作记录 |
| `wooorm/starry-night` | B 其他JS | MIT ✅ | 代码高亮 | 重复（被 highlight.js 覆盖） | 🔵 | proposed | 2026-10-19 | ★1817，2026-08-30 push。GitHub 同款、521 语法，但依赖 `vscode-textmate`（含 oniguruma wasm 风险）；本轮取一取 highlight.js |
| `mermaid-js/mermaid` | B 其他JS | MIT ✅ | 图表 | **全新**（无需求） | 🔵 | proposed | 2026-10-19 | ★90738，2026-10-19 活跃。npm `mermaid@12.2.0` **`unpackedSize` 122 MB**（d3/cytoscape/elkjs/katex…）→ 首屏绝不可接受；且本仓无「正文图表」需求。**结论：不做**（`better-markdown` TODO 里提到它，可据此关闭该项） |
| `yuzutech/kroki` | 非 JS 库（Java 服务） | MIT ✅ | 图表 | 全新 | 🔵 | proposed | 2026-10-19 | ★4372。服务端出图（Docker），形态不符 |
| `syntax-tree/mdast-util-from-markdown` 等 unified 簇 | B 其他JS | MIT ✅ | Markdown 解析 | 重复无增益（比 markdown-it 更重） | 🔵 | proposed | 2026-10-19 | ★294。需 `micromark` + 多个 `mdast-util-*` 串联，体积与依赖数均大于 markdown-it（已登记并出骨架） |
| `leizongmin/js-xss` | B 其他JS | **`NOASSERTION`** ⚠ | — | 重复（净化） | 🔵 | pending-license | 2026-10-19 | ★5308，2026-05 push，API `NOASSERTION`（LICENSE 非标准文本）→ **待人工核验，不采用**。本轮无净化需求 |
| `sbfkcel/towxml`★2896 / `zhaoxuhui1122/vue-markdown`★471 / `borismus/markdown-preview`★215 | B/— | 均 **`null`** | — | — | ⛔ | rejected | 2026-10-19 | 小程序渲染库 / 归档的 md 编辑器 / 2016 的 Chrome 扩展。**无许可证**，只登记 |
| `MarketingPipeline/Markdown-Tag`（GPL-3.0）★460 / `aaronsw/html2text`（GPL-3.0）★2812 / `sbarex/SourceCodeSyntaxHighlight`（GPL-3.0）★4309 / `elvirbrk/NoteHighlight2016`（GPL-2.0）★3929 / `solancer/sarala`（GPL-3.0）★49 | — | **GPL 族** | — | — | ⛔ | rejected | 2026-10-19 | 许可证红线 |
| `syntaxhighlighter/syntaxhighlighter`★5296（2020 停更、需全局 DOM 注入）/ `720kb/highlighter.js`★379（高亮 DOM 元素非代码）/ `mplewis/src2png`★2177（代码→图片）/ `volca/markdown-preview`★251（扩展） | — | MIT | — | 名不符实 / 过时 | ⛔ | rejected | 2026-10-19 | 「高亮」轴的系统性噪声：多数是**编辑器/扩展/截图工具**，不是可嵌入的着色库 |
| Markdown 应用簇：`gaowei-space/markdown-blog`(Go)、`assemble/assemble`★4256、`colinhacks/devii`★496、`hexojs/hexo-renderer-markdown-it`★369、`CHENXCHEN/...plus`★122、`links` 类 | — | MIT | — | — | ⛔ | rejected | 2026-10-19 | 是「应用/站点生成器/框架适配器」，不是库 |
| 图表 agent-skill 簇：`tt-a1i/archify`★85466、`cathrynlavery/diagram-design`★57834、`ahmedkhaleel2004/gitdiagram`★18313、`Agents365-ai/drawio-skill`★10229、`oh-my-mermaid/oh-my-mermaid`★3166、`axtonliu/axton-obsidian-visual-skills`★3653 | — | MIT | — | — | ⛔ | rejected | 2026-10-19 | **全是 agent skill / 站点 / CLI**，非 JS 可嵌入库；`mermaid diagram` 一词前排几乎全被此簇占据 |
| 非 JS 栈簇：`erweixin/RaTeX`(Rust,`NOASSERTION`)、`PhraseHQ/SwaTex`(Swift)、`lingarajsankaravelu/Katex`(Kotlin,`null`)、`ije/md4w`(Zig)、`CodingSha/SPMathKit`(ObjC)、`zg` 类 | — | 混合 | — | — | ⛔ | rejected | 2026-10-19 | `katex math render` 前列全是各语言重实现，JS 栈只有 `katex` 本体（本仓已有 `dsh-radar-temml` 覆盖公式侧） |

## 2026-10-19 · A 组派生（第三十二轮 · Agent 工作流 / 审查门禁轴）

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `GraySilver/dsh-evolve-modes` | A 原生DSH | **MIT** ✅ | 规划 / 学习工作流 | **重复可强化**（规划页「排一下」+ 独立验收审查） | 🟢 | proposed | 2026-10-19 | ★204，2026-08-16 建 / **2026-09-14 push（已 35 天未动，非活跃）**，TypeScript。npm `@graysilver/dsh-evolve-modes@0.4.1` **已核实可锁版** ✅（MIT，unpacked 499,204 B，运行时依赖仅 `zod`+`@deepseek-ai/schemastery`）。自带 `dsh.bundle.patch` + `dsh.client.inject`（8 个前端包）→ **形态 ✅ / 许可 ✅ / 可锁版 ✅ 三门全过**。内容：可组合的「工作状态（正常/计划）· 思考策略 · 质量门禁（对抗性/验收审查）· 自进化（默认 Propose）」，**质量门禁是独立审查 Agent**。判据③成立：本仓 `dsh-zhiyun-page-planning` 的 `PLAN_PROMPT→readPlanResponse` 是**单次 LLM 调用、无任何审查环节**。**本轮 L2 骨架** `packages/dsh-radar-evolve-modes`。⚠ 三点风险见报告 L-2/L-3：①上游 patch 含 `!!js` 表达式（本仓安全补丁不支持）；②peer 声明 `^0.1.1-rc.2 \|\| ^0.1.2-rc.1` 须与 profile 实际宿主版本交集判定；③**会改全局 Agent 行为**（插输入区 + 写 system prompt section），评审应放最后 |
| `EricWang1358/dsh-web-studyhub` | A 原生DSH | **MIT** ✅ | 习题 / 间隔复习 | **重复且无增益**（习题簇） | ⛔ | rejected | 2026-10-19 | ★124，2026-09-12 建 / 2026-10-18 push，JavaScript。npm 名实际为 **`@ericwang1358/dsh-daily-flashcard@3.5.5`**（仓库名与包名不一致），但 **npm registry 上不存在该包名**（404）→ **不可锁版**；`dependencies` 含 base-ui / codemirror / katex / pdfjs / dompurify 等 13 项，体积远超本仓任何一个已评估候选。**核心能力 = 资料→题目 + SM-2 间隔复习**：题目侧与 `dsh-zhiyun-quiz` 重复，调度侧是 **SM-2，旧于 FSRS**（已在册 `fsrs-browser`/`ts-fsrs`）→ 三条判据全部不成立。**核心代码闭源**（`lib/` 为构建产物）→ 即便许可 MIT，也属「只能装不能读」。只登记 |
| `xuanyuanzhifeng/dsh-plugin-agent-workflow` | A 原生DSH | MIT | 通用（工作流） | 重复（与本轮 🟢 同列，簇内落选） | 🔵 | proposed | 2026-10-19 | **非新仓**（2026-10-15 已登记，本轮在 `dsh plugin agent mode` 中再次浮出）。★267、2026-10-12 push。无可核实的功能细节（描述仅一句），不构成对 `dsh-evolve-modes` 的分流 |
| `sixtysevenlf/dsh-skill-blender-modeling`（`NOASSERTION`）、`cuddly-guacamole/opencode-routing-suite`（`NOASSERTION`）、`PerryLink/dsh-github`（Apache-2.0，CI 工具非教学模式） | A 原生DSH | 混合 | — | 无关 / 待核 | ⚠ 待核 | pending-license | 2026-10-19 | 前两条许可证 **`NOASSERTION`** → 待人工核验、不采用；第三条与本轴（Agent 工作模式）无关，仅记录 |
| 「安全审查门禁」簇：`ateen18/dsh-plugin-security-review`（`null`）★4、`ShanHaiFish/dsh-plugin-security-review`（MIT）★2、`dushaobindoudou/dsh-plugin-security`（MIT）★2 | A 原生DSH | `null` / MIT | — | **重复无增益**（审计簇第 7/8/9 家） | ⛔ | rejected | 2026-10-19 | 全是「插件**安装**前的供应链安全评审」，与在册 `plugin-audit` / `compat-vet` / `skill-pack-security` 同列；与本轮 `dsh-evolve-modes` 的「**产出**质量审查」**不是同一件事**（前者审包，后者审结果）。首条无许可证为红线 |
| 「规划文件 / 计划归档」簇：`Asaka-RUM/dsh-planning-with-files`（`NOASSERTION`）★2、`asd176916847/dsh-plan-first-dev`（MIT）★1、`likesrt/dsh-plugin-plan-archive`（`null`）★0、`Dalizi2026/dsh-model-dispatch`（MIT）★12、`lincong1987/dsh-model-switch`（MIT）★10 | A 原生DSH | 混合 | — | **无关 / 重复无增益** | ⛔ | rejected | 2026-10-19 | 前三条是「Manus 式计划文件 / 强制 plan-first / 计划归档」，属 **DSH plan-mode 的周边**，与「学生周计划表」不同物（见本行 🟢 备注的同名不同物问题）；后两条是模型切换，`dsh plugin plan mode` 一词的**系统性噪声**。许可证 `NOASSERTION`/`null` 两条仅登记不摘码 |

## 2026-10-19 · 第三十三轮（B 组 · 校园数据「读后整理层」轴）

> 关键词（10 次，达上限未超限，0 次 403）：`zju lost found`(0)、`zju notice`(1)、`zju calendar`(6)、
> `zju 失物 OR 招领`(降级作废)、`zju 通知 OR 公告`(降级作废)、`zju bulletin board`(1)、
> `zju useful scripts`(3)、`zju library`(53)、`zju activity`(2)、`zju grade point`(0)。
> 补扫（不在 10 次内、仅用于否决 L2）：`keyword extraction rake`(150)、`textrank sentence ranking`(15)。
> **本轮 0 个 🟢 / 0 个 🟡 / 0 个骨架，未开 PR（门槛未触达）。**

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `Jnove/mentor-agent` | 非 JS（Python） | **`null`** ⛔ | 政策问答 / 通知跟进 | 重复且无增益 | ⛔ | rejected | 2026-10-19 | ★1，2026-07-09 建 / 2026-08-30 push。描述仅一句「帮浙大学生理解政策、跟进最新通知」，无 topics、无可用文档。**无许可证 + 非 JS 栈**，三条判据全不成立 |
| `5dbwat4/ZJU-live-better` | B 其他JS | **GPL-3.0** ⛔ | 校园生活脚本集 | — | ⛔ | rejected | 2026-10-19（`zju` 批量扫时已在册，本轮 `zju useful scripts` 复出） | ★221，2026-10-07 push。**许可证红线**，不摘码 |
| `ChenyuHeee/ZJU-live-better` | B 其他JS | GPL-3.0 | — | — | ⛔ | rejected | 2026-10-19 | ★3，上一条的 fork → 去重归一，不再单列评估 |
| `zhullyb/zjut-useful-scripts` | 非 JS（Shell） | `null` | — | — | ⛔ | rejected | 2026-10-19 | ★0，**浙工大（非浙大）** + 无许可证 |
| `ZJUZhiyuCai/zju-activity-calendar` | 非 JS（Python） | **`NOASSERTION`** ⚠ | 校园活动 | — | 🔵 | pending-license | 2026-10-19 | ★1，2026-04-26。无描述、无 topics。许可证 **`NOASSERTION` → 待人工核验、不采用**。本轮唯一 `NOASSERTION` 新面孔。`zju activity`(total 2) 的第二条是 2014 年 GPL 仓，已弃 |
| `Meteors27/ZJU-Calendar-Maker` | 非 JS（Python） | `null` | 课表导出 | 重复且无增益 | ⛔ | rejected | 2026-10-19 | ★19，**2023-03 停更**。ics 导出，与本仓 `dsh-zhiyun-tongge-schedule` / `career-calendar` 重复且无证 |
| `cmjang/zjut-calendar` | 非 JS | MIT ✅ | — | — | ⛔ | rejected | 2026-10-19 | ★0，2021-10 停更。**浙工大**，非浙大 |
| `zhpywhatever/ZJU_Calendar` | 非 JS（Python） | `null` | 校历 | — | ⛔ | rejected | 2026-10-19 | ★0，2024-11。无许可证 |
| `waseem18/node-rake` | B 其他JS | **MIT** ✅ | 笔记 / 讲义（关键词抽取） | **重复且无增益**（实测由「可强化」降级） | ⛔ | rejected | 2026-10-19 | ★103，2023-07-27 push，npm `node-rake@1.0.1`（2018-03 发布，unpacked **12,459 B**，**零运行时依赖** → 可锁版 ✅）。**实测两处硬伤**：① 中文输入直接 `TypeError`（`index.js:75`），根因 `removeStopWords` 的 `\b` 对 CJK 无词边界 + `stopWords.txt` 无中文词；② `index.js:63` 用频率**值**当键（`Object.values(wordFreq).forEach(freq => wordDegree[freq] += …)`），评分被污染。本仓 `layered-search.js` L10 自述「不切词、不算相关度」→ 需求真实，但**此库不是那个更优底层**。若要做，应本仓自写 30 行中文友好切分 |

> **本轴结论**：B 组「校园信息侧」**封板**。10 次搜索换 1 条无许可 Python 仓库；
> `zju calendar` 6 条、`zju library` 53 条的价值项**全部在册**（多是数据库课设噪声）。
> **建议 B 组由「每 3 天必跑」降为事件驱动**，额度让给仍在稳定出 🟢 的 A 组。
> 另：`中文词 + OR` 在 GitHub search 上是**无效组合**（退化回泛 `zju`，且不返回 `total_count`），后续 B 组禁用。

---

## 2026-10-19 · 第三十四轮（A 组派生 · 模型请求管线「往返面」轴）

> 关键词（13 次搜索 ⚠ 超限 3 次，全程 0 次 403）：`dsh plugin model provider`(190)、
> `dsh plugin provider in:description`(223)、`cordis plugin llm provider`(26)、`dsh plugin fallback`(82)、
> `dsh plugin usage stats`(55)、`dsh plugin token usage`(193)、`dsh plugin gateway`(102)、
> `dsh plugin notification`(179)、`dsh plugin mcp`(534)、`deepseek harness plugin in:name`(162)、
> 补扫 `dsh plugin notification in:description`(74)、`dsh plugin hook in:description`(18)、
> `dsh plugin permission in:description`(33)、`dsh plugin export in:description`(62)、`dsh plugin desktop in:description`(292)。
> 约 2,200 条命中 → 未登记 54 条 → 有效 3 条；**🟢1（`dsh-llm-fallbacks`）+ 🟡1（`loongsuite/dsh-plugin`）+ 🔵2 + ⚠1 + ⛔48 簇**。
> **本轮出骨架** `packages/dsh-radar-llm-fallback`（锁版 `dsh-llm-fallbacks@0.6.7`）。

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `omdsh-dev/dsh-llm-fallbacks` | **A 原生DSH** | **MIT** ✅ | 通用（所有页面共用请求管线） | **重复可强化**（`dsh-llm` 失败路径） | 🟢 | proposed | 2026-10-19 | ★21，2026-10-18 push（活跃），topics `dsh-plugin` 族，`dsh.bundle.patch` + `dsh.client.inject`（6 个前端包）齐全。npm `dsh-llm-fallbacks@0.6.7` **可锁版** ✅（unpacked 905,327 B，dist 696 KB，运行时依赖仅 `use-sync-external-store`）。**三门全过**（形态 / 许可 / 可锁版）。内容：按触发码（`AUTH`/`QUOTA`/`RATE_LIMIT`，可扩 `CONTEXT_WINDOW_EXCEEDED`）沿 fallback 链切换 provider/model + 冷却 + 可选半开恢复；峰谷分时路由；角色化 subagent。**判据③需实测**（本仓无跨 provider 失败转移，但「更优质」未用失败码样本验证）。**本轮 L2 骨架** `packages/dsh-radar-llm-fallback`。⚠ 三点硬风险：**R-1 宿主窗口 `^0.2.1-rc.2` 与本仓 `0.2.0-rc.2`/`0.2.1-alpha.1` 均不相交**（semver prerelease 规则）；R-2 须排在 `dsh-llm-retry` 之后；R-4 npm `package.json` 缺 `license` 字段但 tarball 内有 MIT `LICENSE` |
| `loongsuite/dsh-plugin` | **A 原生DSH** | **Apache-2.0** ✅ | 通用（运维/可观测） | 全新（本仓无追踪） | 🟡 | proposed | 2026-10-19 | ★29，2026-10-12 push，topics `opentelemetry`/`genai`/`tracing`。npm `@loongsuite/dsh-plugin@0.1.3` 可锁 ✅（unpacked 144,637 B）。把每个 agent turn 变成 GenAI span 树（step / LLM 调用含 TTFT / 工具执行 / token），经 OTLP 导出到 Jaeger / Tempo / Langfuse。**不做骨架的理由**：① 本仓没有后端，OTLP endpoint 是「运维配置」不是「学生功能」，默认开启等于把每位同学的使用数据往外发 → **隐私边界**；② 学生场景契合度低（不是「全新面板」而是「没有任何面板」）；留作「若做导师侧性能诊断」的底层 |
| `PolinniZhong/dsh-personal-center` | A 原生DSH | MIT ✅ | 个人配置 / 用量 | **重复且无增益**（与在册 `dsh-bottom-info-bar`/`dsh-usage-*` 同列） | 🔵 | proposed | 2026-10-19 | ★118，2026-09-28 push。把它按功能拆开看：Token 用量统计（在册已有 4 家：`dsh-bottom-info-bar`/`dsh-usage-chart`/`dsh-usage-panel`/`dsh-hud`）、成本估算（同上）、自定义指令、**外观全局字号**（本仓「个人」页唯一外观项就是这个）、桌面宠物。**唯独没被覆盖的是「全局字号」与「自定义指令」**，二者都属本仓「个人」页的自有实现（`dsh-zhiyun-page-me`）→ 按「不简单集成重复功能」不接；npm unpacked **8,233,357 B（8.2 MB，多因桌宠素材）**，作为工作台依赖过重 |
| `0xsline/awesome-deepseek-harness` 等 5 个 awesome 清单 | A 原生DSH（清单） | CC0 / MIT / ⚠`NOASSERTION` | 通用 | 全新（线索源，与在册 `awesome-dsh-plugin` 同列） | 🔵 | proposed | 2026-10-19 | `0xsline/awesome-deepseek-harness` ★1218 CC0 ✅（本轮 `dsh plugin mcp` 第 1 名）；`Zhiyuan-Fan/Awesome-DeepSeek-Harness-Plugins` ★574 MIT ✅；`imsai-sh/awesome-deepseek-harness-plugins` ★300 MIT ✅（自述「11,000+ dsh plugins」的市场）；`Dominic789654/…` ★387 与 `web-casa/…` ★117 为 **`NOASSERTION`** ⚠ 待核。**只作线索源**，不摘内容；★1218 的清单可作为下一次「窄词池」的来源 |
| `dsh-external/*` 系列（本轮 4 个 URL 实测 **404**）、`graygravity/dsh-notify`（404）、`web-casa/dsh-mcp-manager`（404） | — | — | — | — | ⛔ | rejected | 2026-10-19 | 这些名字来自 `pipetow` / `Tania-X` 等 README 的推荐顺带提法，**仓库实际不存在**（`api.github.com/repos/...` 返回 `Not Found`）→ 「README 里出现的仓库名 ≠ 存在的仓库」，登记一行，避免下轮再核 |
| 用量统计簇：`lanlandeli/dsh-usage-stats`(⚠`NOASSERTION`,★11)、`AKS1st/model-usage-plugin`、`zhangzheng25/dsh-token-monitor`、`jkStars/dsh-token-usage-stats`、`jianweideng0515-create/dsh-usage-stats`(BSD-3)、`1841220388zzzcccxxx-star/dsh-token-stats`、`Yolotd/dsh-plugin-duwg`、`kindred-7/dsh-usage-stats`(`null`)、`feiyang-dev/dsh-usage-plugin`(★36)、`HaoyueQin/dsh-usage-statistics-panel`(★27)、`AlfredChaos/dsh-usage-panel`、`Max-Samson/dsh-usage-chart`、`a903067276-rgb/dsh-hud` | A 原生DSH | 多数 MIT，1 条 `NOASSERTION`、1 条 `null` | 用量 | **重复无增益**（第 5–17 家） | ⛔ | rejected | 2026-10-19 | 本轮最大的一簇：**13 个新仓做的是同一件事**（token 用量 / 成本 / 热力图 / 图表）。在册已有 4 家 + 本仓「个人」页有外观分区。**该轴已彻底饱和**，建议封板；`lanlandeli` 一条 `NOASSERTION`（无 `license` 字段）单列待核 |
| Provider/登录簇：`Mars-Sea/dsh-commandcode-provider`(★411)、`cv-superding/dsh-deepseek-web-login`(Apache-2.0,★289)、`Stormycry-cryp/dsh-AuthInOne`(★105)、`mo-n/dsh-provider-qoder`、`wqy8593521/dsh-model-pro`、`tearslee/dsh-workbuddy2api`、`bufeibufei/dsh-openai-codex`、`fan56/dsh-model-sync`(`null`)、`Victor-770/dsh-commandcode-provider`、`viztor/dsh-opencode-patch`、`wingoo/codex-plugin-dsh` | A 原生DSH | 多数 MIT | 通用（接入第三方模型） | **重复无增益 / 不用** | ⛔ | rejected | 2026-10-19 | 全部是「把某个第三方订阅/网页版接成 provider」。**与本仓原则冲突**：① 本仓只用宿主内置 provider，不替用户接入灰色网页登录（ToS 风险）；② 免费额度下的降级策略已由本轮 🟢 覆盖。`dsh-AuthInOne`★105 是同族里唯一做「多 provider 统一登录」的，仍属「换一个登录页」而非强化 |
| 网关/远端簇：`Clarklevis1995/dsh-mobile`(★568)、`Clarklevis1995/dsh-plugin-mobile-gateway`(★88)、`hytime/dsh-thinking-effort`(★53)、`islibaodong/dsh-login`、`litestartup-com/dsh-api-gateway`、`siegfly/dsh-deepseek-vision`、`clarknu/dsh-gateway`、`CaiZongyuan/dsh-ag-ui`、`yybai25/dsh-ssh-desktop`、`grunmin/dsh-acp-enhanced`、`WDahah/portable-dsh-multi-agent-plugin`、`SeverusZh/dsh-plugin-subagent-director`、`Jonah-Wu23/dsh-agy-safe`、`YFY-AI/dsh-llm-fallback` | A 原生DSH | 多数 MIT | — | 与 web 客户端形态不兼容 / 重复 | ⛔ | rejected | 2026-10-19 | 移动端 / 远程 shell / API 网关 / 协议桥。**本仓是 web 工作台**，这些改的是「怎么连上来」，不是「连上来之后能做什么」。`YFY-AI/dsh-llm-fallback`（★1）是其 `publishConfig.registry = npm.pkg.github.com` → **公网 npm 装不了**，且与本轮 🟢 **名字几乎相同、勿混** |
| 通知簇：`hikarioyama/Smart-DSH`(`null`,★33)、`ly6170/dsh-messager`、`c-ling/dsh-plugin-notify`、`117BS/dsh-perlica-ding`、`yuxino/dsh-blue-whale-maid`(⚠`NOASSERTION`,★6)、`halosb/dsh-workmate`、`Mars-Sea/dsh-deeppilot`、`ltao0829/dsh-task-notify`(BSD-3)、`pitetow/dsh-notify-on-complete`、`Tania-X/dsh-notify-macos` | A 原生DSH | 多数 MIT | 学习提醒 | **重复无增益**（第 4–12 家） | ⛔ | rejected | 2026-10-19 | 「回合结束 → 桌面/飞书/钉钉/Webhook 推送」。在册已有 3 家，本仓「今天」页已有提醒语义。**该轴饱和**，封板 3 个月；`Smart-DSH`★33 无许可证（`null`）为红线，`dsh-blue-whale-maid` `NOASSERTION` 待核 |
| 审计/钩子簇：`jkrandom-sudo/dsh-plugin-audit`、`chunfenxiazhi-collab/dsh-stability-audit`、`truelove-dreamer/dsh-plugin-hooks`(`null`)、`wula1223/dsh-plugin-dev`、`rasyidmmz/dsh-ai-memory`、`SeverusZh/dsh-yolo-mode`、`xlxs123/dsh-session-multiselect`、`wingsky-1/dsh-plugin-hub`、`weekitmo/oh-my-dsh-plugins` | A 原生DSH | MIT / `null` | 通用 | **重复无增益** | ⛔ | rejected | 2026-10-19 | 审计/钩子已是在册 `plugin-audit`/`compat-vet`/`upstream-radar` 第 10–12 家；`dsh-yolo-mode`（自动批准沙箱升级）与本仓「学生场景最小权限」原则相反；其余 ★≤5 的清单/模板类。`dsh-plugin-hooks` 无许可证为红线 |
| `Fayelin12/dsh-office`、`HongMing-Huang/dsh-file-upload`、`cinob/dsh-web-search-multi`、`tuojc/dsh-browser-firefox`、`qphotoai/dsh-computer-use-windows`、`songoao25/dsh-bottom-info-bar`(在册)、`JerryLiu369/agent-web-search`、`wingsky-1/dsh-plugin-hub`、`justhalfbit/dsh-plugin-jev-effort-selector`、`HaoyueQin/dsh-diff-stat`、`yuioi666/dsh-plugin-model-capability`、`a86582751/dsh-nexttavern`(GPL-3.0)、`bwndlct/dsh-session-export`、`yangyongzhen/dsh-session-export`(`null`)、`azure5100/huahua-dsh-record-replay` | A 原生DSH | 混合 | — | 无关 / 已覆盖 | ⛔ | rejected | 2026-10-19 | 单点小工具（上传/搜索/浏览器/截图/差异徽章/模型能力表/会话导出/录播回放）。会话导出与本仓「笔记」重复且无更优底层；`dsh-nexttavern` 为 GPL-3.0 红线 |

> **本轴结论（三条）**：
> ① **「用量/通知/审计」三个子轴同时饱和**——本轮 54 条新仓里 40 条落在这三簇，且都是「第 N 家」。
> A 组内卷的主战场已从「新能力」转向「同一能力的复刻」。
> ② **唯一还空着的是「请求管线本身」**：provider 接入（饱和）、网关（形态不合）、
> 而**「失败之后按链降级」** 此前从未被登记——本轮 🟢 正是从这个空档出来的，
> 它也是首条「不面向任何单一页面」的候选（强化的是**所有页面共用的那一层**）。
> ③ **A 类候选的瓶颈已从「找得到」变为「装得上」**：本轮三门全过的 🟢 死在第四道门
> （宿主版本窗口），详见报告 §4。

## 2026-10-20 · 第三十五轮（C 组 · **字幕原文层**轴）

> 跨天首轮（本地 `293 % 3 = 2` → C）。**12 次搜索（⚠超限 2 次）、0 次 403**，约 96 条去重命中 → **首次登记 24 条** → 有效 8 条。
> **🟢1 / 🟡1 / 🔵3 / ⚠1 / ⛔18（含 4 簇）**；骨架 `packages/dsh-radar-media-captions/`。
> 起点是**读代码得出的三处缺口**（F-1 `join("")` 无分隔 / F-2 无标点恢复 / F-3 `english` 轨从未使用），
> **不是**凭印象挑的词。详见 `2026-10-20.md`。

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `vidstack/captions` | B 其他JS | **MIT** ✅（GitHub + npm 两处一致） | 课堂字幕 / 讲义 / 出题（**原文层**） | **重复可强化**（字幕页 + 终稿原文层） | 🟢 | skeleton-created | 2026-10-20 | ★149，push 2026-09-09。**npm 主包名 `media-captions`**（`vidstack-captions` 404）；`latest=0.0.18`(2023) / **`next=1.0.4`**(2024-07-29)，**必须写死 1.0.4**；零运行时依赖，unpacked 162,428 B，纯 ESM。**不提供中文断句 / 标点恢复 / 浙云 JSON 信道**（见报告 §5 结论①）。已出骨架 `dsh-radar-media-captions` |
| `gsantiago/subtitle.js` | B 其他JS | **MIT** ✅ | 字幕导入/导出（外挂字幕、复习材料） | 重复可强化（**方向不同**：格式搬运，非句子化） | 🟡 | proposed | 2026-10-20 | ★435，push 2026-01-24。npm `subtitle@4.2.2`（MIT，unpkg 实测）。**能 stringify 回去** —— 本仓缺「导出 .srt/.vtt 给外部工具」通路。4 个运行时依赖，Node stream 风格，浏览器端需包一层 |
| `plussub/srt-vtt-parser` | B 其他JS | **MIT** ✅ | 字幕解析 | 重复且**无增益**（⊂ 🟢） | 🔵 | proposed | 2026-10-20 | ★31，push 2024-07-29。零依赖 TS 解析器，但 **npm 404（锁版不成立）**、无渲染层、格式面窄于 🟢。第三门不过 |
| `textlint-rule/sentence-splitter` | B 其他JS | **MIT** ✅ | 笔记 / 讲义断句 | 重复可强化（**但中文不成立**） | 🔵 | proposed | 2026-10-20 | ★138，push 2026-04-02。描述明写 `{Japanese, English}`，中文标点无保证 → 对本仓中文课堂无价值 |
| `laubonghaudoi/subtitle-editor` | B 其他JS | MIT ✅ | 字幕校对 | 仅参考（形态不合 + **同名不同物**） | 🔵 | proposed | 2026-10-20 | ★57，纯 Web。但 npm `subtitle-editor@1.0.0` 是 **2019 年的另一个包（ISC / Vue2 / webpack2）** → 不可作依赖来源，只可读交互 |
| `oramasearch/chunker` | B 其他JS | **`NOASSERTION`** ⚠ | 讲义分块 | — | ⚠ 待核 | pending-license | 2026-10-20 | ★33，2024-03 后停更。**待人工核验，不采用、不摘代码** |
| 字幕编辑器簇：`pepri/subtitles-editor`(`null`,★59)、`hamidb80/subtitle-editor`(MIT,★42)、`the-dissidents/subtle`(**GPL-2.0**,★29)、`drakang4/jamak`(MIT,★19,2020停更)、`moaminsharifi/subtitle-flow`(MIT,★18)、`Ratheshan03/ai-subtitle-editor`(`null`,★15) | B 其他JS | 混合 | 字幕校对 | **重复无增益** | ⛔ | rejected | 2026-10-20 | 6 家全是「载入视频 + 手工改时间轴」的**双语单轨编辑器**，**没有一家做中文句读**；且本仓字幕来自 API、不来自用户上传 .srt → 编辑场景不成立。`subtle` 为 GPL 红线 |
| 播放器字幕轨簇：`ApayRus/frazy-parser`(MIT,★9)、`XiangnianZhou/neta`(MIT,★1,2020)、`AlexandreMT/subtitling`(`null`)、`Leawind/srt-parser-ts`(**GPL-3.0**)、`pedromsilvapt/subbox`(`null`)、`ShipItAndPray/pretext-captions`(`null`) | B 其他JS | 混合 | 字幕解析 | **重复且无增益** | ⛔ | rejected | 2026-10-20 | 能力 ⊂ `media-captions`；或 ★≤9；或无许可证。`srt-parser-ts` GPL 红线 |
| 通用断句/分词簇：`sirlancelot/string-segmenter`(`null`)、`chax-at/simple-sentence-splitter`(`null`)、`MarkusBansky/chasm`(GPL-3.0)、`seanghay/split-khmer`(MIT,高棉语)、`nunuhi/sentence-splitter`(`null`)、`stoicaandrei/sentence-splitter`(`null`)、`cli3338198/sentence-splitter`(`null`)、`perezamadorluisenrique-gif/text-format`(MIT,大小写转换) | B 其他JS | 混合 | 笔记断句 | **重复无增益** | ⛔ | rejected | 2026-10-20 | 语言不覆盖中文；或 ★≤2；或无许可证。**`sentence splitter` 前排全是日/高棉/通用分词器 —— 中文断句在 JS 生态为空**（见报告 §5 结论②） |
| 习题/刷题簇：`ZaneH/piano-trainer`(MIT,★2210)、`drbarzaga/react-dojo`(MIT,★33)、`linkedin-faq/linkedin-quizzes-kodyfire`(MIT,★28)、`magentaqin/quiz-me`(MIT,★17)、`iamgideonidoko/linassess`(MIT,★9)、`blackmouse572/quizler-fe`(`null`)、`SohamXYZDev/openboard`(MIT,★6)、`psatler/quiz-nextjs`(`null`)、`Neerajkr7/cca-foundations-exam-practice`(MIT)、`SnakeEye-sudo/Offline-Exam-Practice`(`null`)、`ayozoo/pdf-quiz-practice`(`null`)、`abdullah-khaled0/PDF-Quiz-Generator-with-AI-and-React`(`null`)、`SakshiBhalla77/Pdf-Quiz`(`null`)、`chanchaldabriya/pdf-quiz-app-client`(`null`)、`DHKLeung/life-in-the-uk-test`(`null`)、`notwld/Lab-Exam-Practice`(`null`)、`notwld/lab-exam-practice-react-dotnet`(`null`)、`Didula-Lakminda/Frontend_Practice_Paper`(`null`) | B 其他JS | 多数 `null` | 刷题 | **重复无增益** | ⛔ | rejected | 2026-10-20 | 本仓 `dsh-zhiyun-quiz` 已有「题形状 + 先筛后出 + 四层质检链 + 去重」，远完整于模板类题库。**`piano-trainer`★2210 是键盘乐器练习，与「刷题」仅字面同词 → star 数在此轴第 4 次被证明不可作判据** |
| 笔记 OCR 簇：`zeus-12/uxie`(`null`,★197)、`Waqar-743/SnapNote`(`null`)、`NitinN77/Smart-Note-Taker`(`null`)、`benjamintaito/inknote`(MIT)、`Marwan-Alhindi/notaplus`(`null`)、`Nilesh98-codes/note-sync-docs`(`null`)、`mentor98/Smart-AI-Note-Taking-App`(`null`)、`King-fly/note-taker`(`null`)、`mainit-na-tinapay/Rubric`(`null`) | B 其他JS | 多数 `null` | 笔记 OCR | **重复无增益** | ⛔ | rejected | 2026-10-20 | 9 条里 7 条无许可证 → 红线。`inknote` 是 Windows 手写笔应用，形态不合。OCR 通路 2026-10-17 已判「Trans2Former + parser 视觉路径足够」 |
| 论文阅读簇：`LinzuoZhang/Paper-Lantern`(MIT,★10)、`Tentengg/Paper-Reader`(MIT,★1)、`haunledeshuchang/moyue-reader`(MIT,★1)、`ChangHsiang/PDF-Reader`(MIT,★0)、`GindaChen/scholarly-reader`(MIT,★0)、`martin2026US-lab/paper-space`(MIT,★0)（`zotero-ai-reader` 在册） | B 其他JS | MIT | 论文精读 | **重复无增益** | ⛔ | rejected | 2026-10-20 | 本仓论文页是 `dsh-zhiyun-page-paper` + **锁版上游 `@ggboy123/dsh-paper-reader`** 的完整兼容层（24 路由 + 5 agent 工具 + 选中即译）。这 6 家全是 ★≤10 的独立桌面/扩展应用，**无一家提供可嵌入式解析层** |
| 课表 ICS 复扫：`marioMLLL/ecnu-timetable-calendar`、`computerfan/XJTLU-Timetable-to-ICS`、`khosbilegt/mq-timetable-exporter`、`RunasSudo/allocics.js`(AGPL-3.0)、`0iy/schulportal-hessen-timetable-export`、`Jay-Nepal/sunway-izone-timetable-export`、`PNRYates/knoxi-calendar`、`JustBrandonLim/timetable-grabber-sit`、`romankurakin/dkuzeit`、`NLion74/ics-webuntis`、`vincentdchan/SCAUCourseExporter`、`GarytheNoob/hku-timetable-exporter`、`sceneeeee/xjtlu-timetable-bookmarklet`、`n0x1d3/curtin-calendar`(GPL-3.0)、`naykakashima/UoDTimetables`、`navlemis/timetablext`、`TeoTzeShuen/timetable-exporter`、`Foahh/tpg-timetable-exporter`、`Ishaan-nasir/SnapCal`、`PardhavMaradani/vit-timetable-export-plugin` | B 其他JS | 混合 | 课表 ICS | **重复无增益** | ⛔ | rejected | 2026-10-20 | 前排 10 条**全部已登记**，剩余 10 条同型且 ★≤4。**课表 ICS 轴维持 2026-10-14 的「饱和」判定** |
| 非 JS / 形态不合：`cdown/srt`(Python,MIT,★537)、`byroot/pysrt`(Python,**GPL-3.0**,★491)、`finwarman/kcl-timetable`(Python)、`JaciBrunning/ElsieScraper`(Ruby)、`kilohealth/rn-fitness-tracker`(MIT,★126,RN 原生桥) | — | — | — | 技术栈 / 形态不符 | ⛔ | rejected | 2026-10-20 | C 组限定 JS/TS。`rn-fitness-tracker` 是 Google Fit / HealthKit 原生桥，Web 工作台用不上 |

> **本轴结论（三条）**：
> ① **「格式解析」与「句子化」是两件事** —— `media-captions` 能把 SRT/VTT 拆成 cue，
> 但**不会**把两个 cue 连成一句、也不补句号。本仓 `join("")` 的缺口**没有任何 JS 库能替我们补**。
> ② **中文标点恢复在 JS 生态里是空的**：`punctuation restore language:typescript` → **0**、
> `subtitle segment merge algorithm` → **0**、`subtitle segmentation input:name` → **0**。
> 三个最贴的词全 0 → 这是**事实空缺**，不是搜索姿势问题。中文语义底层连续第三轴（检索/数词/标点）
> 都只能自写薄实现。
> ③ **字幕域能提供的能力只有三样**：格式解析（🟢）、反向序列化（🟡）、双语轨渲染（cue settings）。
> 其余「编辑器 / 播放器轨 / SRT CLI」全是重复劳动 → **字幕域建议封板 3 个月**，
> 下轮 C 组转「作答统计可视化」或「错题变体生成」。

## 2026-10-20 · 第三十六轮（A 组派生 · 检索底层轴）

> 关键词（12 次搜索 ⚠ 超限 2 次，全程 0 次 403；另 3 次纯元数据核实已单列）：
> `dsh-plugin search`(802)、`dsh plugin search`(487)、`cordis plugin search`(80)、`dsh plugin content index`(0)、
> `dsh plugin knowledge base`(45)、`dsh plugin rag`(37)、`dsh plugin lexical`(5)、`dsh plugin session search`(50)、
> `cordis plugin full-text search`(2)、`in:name dsh-search`(515)、`dsh plugin pdf extraction`(8)、`dsh plugin layout parser`(1)、
> `cordis web plugin markdown`(7)。
> **131 个未登记仓库** → 有效 9 条；**🟢1（`minisearch`，B 类）+ 🟡3 + 🔵4 + ⚠1 + ⛔6 簇**。
> **本轮出骨架** `packages/dsh-radar-search-rank`（B 类 · 锁版 `minisearch@7.1.2`）。
> 起点是本仓自述的弱项：`layered-search.js` 第 ⑥ 条「字面、不切词、不算相关度」；
> 实测另发现 **L-2 沉默失败**：`layers` 传空集 → `empty:true` 零命中且不报错。

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `lucaong/minisearch` | **B 其他JS（纯库）** | **MIT** ✅ | 学习页检索 | **重复可强化**（`layered-search.js` 排序层） | 🟢 | proposed | 2026-10-20 | npm `7.1.2` **实查可锁** ✅（`latest` 已 7.2.0；unpacked 820,346 B，含 UMD+ESM+sourcemap，**进 bundle 体积未实测**）；`dependencies: {}` 零传递依赖。能力：字段加权 + 前缀 + 可外接 `tokenize`（中文）+ 打分排序。**判据①②③全成立**：同一检索框 / 同域不同问题（有没有 vs 哪条更贴）/ 新增排序与分词。**边界收窄**：只对页面算好的 `hits` 重排，不增删、不改档位、不改 2×11 维「先筛后扫」。**本轮 L2 骨架** `packages/dsh-radar-search-rank`。风险：R-1 中文分词质量（`Intl.Segmenter` 对「动量守恒定律」的切分需夹具证明）、R-2 体积、R-3 顺序变了但「更好」需差分计数证明 |
| `linkingoscar/dsh-attachment-formats` | **A 原生DSH** | **Apache-2.0** ✅（含 `NOTICE`） | 讲义/课件附件 → 可检索文本 | 全新（本仓无附件文本抽取） | 🟡 | proposed | 2026-10-20 | ★4，2026-09-30 push。形态 ✅：`dsh.bundle.patch` + `dsh.client.inject: ["slots","sessions"]`，patch **仅一行 insert、无 `!!js`**（第三十二轮的挂载障碍此处不存在）。能力：PDF 文本层、docx/xlsx/pptx→MD、扫描件 OCR、长文档溢出成 index card。**第三门不过**：npm `dsh-attachment-formats` 与 `@linkingoscar/dsh-attachment-formats` **均 Not Found**（`publishConfig.access=public` 但从未 publish）→ 只能 vendored 复制 → **违反「不搬运上游源码」**，故不建骨架。**它的价值是「本仓附件缺口的说明书」**：notes 只存 Markdown、paper 用 iframe 扛 PDF、univer-office 管预览，三路不通且都无法把扫描版讲义变成可检索文本；若要做，**自写**、只参照能力清单 |
| `PolinniZhong/dsh-session-workbench` | A 原生DSH | MIT ✅ | 会话历史检索 / 召回 | 重复可强化，但**违反判据①** | 🟡 | proposed | 2026-10-20 | ★50，2026-09-28 push，包体 3.4 MB。会话库全文检索 + 召回 + 会话视图（显示/隐藏/拖拽排序）。**本仓没有「会话」页面**，接进来等于新开面板 → 判据①不成立，不出骨架。⚠ 本轮**未实查 npm 可锁版**（只看 `package.json` 推断），下轮以 npm 实查为准 |
| `omdsh-dev/dsh-kb-sieve` | A 原生DSH | **Apache-2.0** ✅ | 资料库 → 可审计知识包 | 重复无落地增益（学习页已有块级检索） | 🟡 | proposed | 2026-10-20 | ★2，2026-08-12 push。`kb_build`/`kb_query`/`kb_read` 三工具，**纯计算零子代理**；md/txt/docx/pdf → `references/` + SQLite FTS5(BM25, title=10/body=1) + manifest。**第三门不过**：`private: true` + 包名 `@dsh-external/dsh-kb-sieve`，README 自己写的是 `git+https://` 安装 → 不可锁版。⚠ 未实查 npm。**价值**：印证排序层方向——生态里做本地检索的也在用 **FTS5 + BM25 + 字段加权**，与本轮骨架同源 |
| `Zn-Dk/dsh-session-explorer` | A 原生DSH | MIT ✅ | 会话检索 | 无关（本仓无会话页） | 🔵 | proposed | 2026-10-20 | ★4，2026-09-09。消息级全文检索 + 时间线可视化 |
| `121212165/dsh-plugin-transcript-search` | A 原生DSH | MIT ✅ | 归档会话检索 | 无关 | 🔵 | proposed | 2026-10-20 | ★1，2026-10-19。读 `dsh-plugin-transcript` 写的 JSONL 侧车；**本仓会话不落 JSONL** |
| `huangxp12/dsh-plugin-search` | A 原生DSH | MIT ✅ | 「插件」页过滤 | **重复无增益** | 🔵 | proposed | 2026-10-20 | ★1，2026-10-08。给插件页加关键词过滤；本仓插件页已有自建过滤 |
| `JackAIStudio/dsh-robust-search` | A 原生DSH | MIT ✅ | 会话检索 | 无关，但**可作参照实现** | 🔵 | proposed | 2026-10-20 | ★1，2026-09-15。隔离坏会话日志 + **SQLite FTS5 CJK 分词**。与本轮骨架同思路；不采用（依赖 SQLite，浏览器端跑不了） |
| `1parado/dsh-deepseek-web-search` | A 原生DSH | **`NOASSERTION`** ⚠ | 联网搜索 | 原则冲突（灰色网页登录） | ⚠ | proposed | 2026-10-20 | ★5，2026-10-17。中文描述：用网页版 DeepSeek 账号做 web_search。**待人工核验许可证，不采用、不摘码** |
| Web Search provider 簇：`DDDMUC/dsh-free-search`(★501)、`A3Boy/dsh-web-tools`(★36)、`MochiNek0/dsh-web-search-free`(★34)、`anysearch-team/anysearch-dsh`(★559)、`cyijun/dsh-surfing-plugin`、`moguiyu/dsh-tavily`、`rogerdigital/dsh-searxng`、`X-C1811/dsh-web-search-plugin`、`Yuuz12/dsh-tavily`、`bocha-ai/dsh-web-search-bocha`、`gsh150801/dsh-anysearch-plugin`、`Modellix/dsh-modellix`、`SeerableOfficial/dsh-web-search-toggle`、`zHElEARN/dsh-web-search-session-header`(`null`)、`wtoco/dsh-mimo-websearch`(`null`) | A 原生DSH | 多数 MIT，2 条 `null` | 联网搜索 | **重复无增益**（第 4–18 家） | ⛔ | rejected | 2026-10-20 | 宿主已有 `web_search` seam；本仓没有任何「网页搜索」面板。**该轴彻底饱和，建议封板 3 个月**；`wtoco/dsh-mimo-websearch` 与 `zHElEARN/…` 无许可证为红线 |
| RAG 知识库簇：`xiaoshi7915/dsh-kb-manager`、`AlowEnsoul/dsh-rag-kb`、`YYTbit/dsh-plugin-rag`、`mervyn-teo/dsh-plugin-rag`、`zuijiuyueliang/dsh-plugin-rag`(`null`)、`y7d26/dsh-knowledge`、`NaughtDZ/dsh-knowledge`、`CodfishYao/dsh-knowledge-base-local`、`RonnieGex/dsh-cited`、`wangning19940904/dsh-llm-wiki`、`huangfuren/dsh-outline`、`JoeyTrribbiani/dsh-rag-knowledge`(Python)、`SiqiSun42/dsh-rag-evaluate-plugin`(Python)、`yyang8891/dsh-plugin-kb4rag`、`RogueServitor-495/dsh-plugin-knowledge-base`(`null`)、`ds-customize/dsh-plugin-knowledge-base`(`null`) | A 原生DSH | 多数 MIT，3 条 `null` | 资料库问答 | **重复无增益**（第 3–18 家） | ⛔ | rejected | 2026-10-20 | 均为「导入文档 → 向量化 → 语义检索」。本仓「学习」页已有整理后的块级检索，RAG 是另一条数据路径（需重建索引），且多数绑外部 embedding 服务，与本仓「不引入独立后端」冲突 |
| 会话检索簇：`TOBYCAI/dsh-sessions-manager`(★30)、`itsyuyi/dsh-workspace-search`、`Tieboyh/dsh-session-search`(`null`)、`dipertq/dsh-session-search`(`null`)、`fuguoqiang-bnu/dsh-plugin-session-search`、`Victue/dsh-session-search`、`2275803244-cpu/dsh-session-search`、`240xu/dsh-session-search`(`NOASSERTION`)、`ewoowe/dsh-session-messages-plugin`、`Sivan757/dsh-plugin-session-fleet`、`kjx-talesofai/dsh-plugin-session-palette`、`MarchLiu/dsh-graft`(`null`) | A 原生DSH | MIT / `null` / 1 `NOASSERTION` | 会话搜索 | 重复无增益 / 无关 | ⛔ | rejected | 2026-10-20 | 12 家做同一件事：在会话日志上做全文检索。**本仓没有会话页面**，无落点；4 家无许可证、1 家 `NOASSERTION` |
| 记忆簇：`Starry0214/dsh-memory`、`yan5236/dsh-memory`、`Towzai/dsh-memory`、`Frog755/dsh-hybrid-memory`、`AstroLiao/dsh-memory-core`、`boomzikazita/dsh-memory`(Python)、`sglwsjxh/dsh-mem`(**AGPL-3.0**)、`reedflame40224/vcp-memo`(`NOASSERTION`) | A 原生DSH | MIT / AGPL-3.0 / `NOASSERTION` | 记忆 | 重复无增益 | ⛔ | rejected | 2026-10-20 | 跨会话记忆第 4–11 家；AGPL 与 `NOASSERTION` 为红线。同类已在册多轮登记 |
| 非 JS 栈簇：`vshulcz/deja-vu`(Go,★1252)、`Ikalus1988/MisakaNet`(Python,★544)、`Ariestar/sivtr`(Rust,★257)、`chainbase-labs/Agentkey`(Shell,★665)、`jingchangzhao-gif/dsh-errkb`(Go)、`lawcontinue/dsh-vision-tools`(Python) | — | MIT/Apache-2.0 | — | 技术栈不合 | ⛔ | rejected | 2026-10-20 | skill 限定 JS/TS 技术栈；星数再高也不接（deja-vu ★1252 是 Go 的 agent 记忆） |
| 界面微调 / 皮肤 / 市场簇：`MichengAI/dsh-codex-ui`(★178)、`hyzyn/dsh-plugin-kit`(★54)、`FSMargoo/dsh-at-file`(★527)、`keman-ai/dsh-skin-market`、`sakka6868/dsh-skin`、`objectivex666/dsh-settings-search`(**GPL-3.0**)、`lov0vo/dsh-composer-autopair`、`daoyu1993-lab/dsh-plugin-type-to-compose`、`imsai-sh/dsh-1024store` | A 原生DSH | MIT / GPL-3.0 | — | 重复无增益 | ⛔ | rejected | 2026-10-20 | 侧栏/皮肤/@文件补全/插件市场第 N 家；`dsh-settings-search` 为 GPL-3.0 红线。`dsh-at-file`★527 是 Codex 风格 @ 补全，本仓 `page-notes` 已有 `[[` 链接补全，重复 |
| 其余单点小工具：`Tyan66666/billion-context-dsh`、`jermaine123123/agent-context-editor`、`duhu2000/dsh-mcp-connector`、`Mr-remon219/search-boost`、`Lxiayu/DshCockpit`、`Eray114514/dsh-find-plugins`、`taikaikaikai-pixel/dsh-tap`、`everclear077/dsh-progressive-tools`、`ZekaiShi/evo-subagent`、`youdotcom-oss/agent-skills`、`lpeixin/dsh-project-compass`、`Fisfzy/zotero-harvest`、`AbcdefgXW/dsh-toolbox-web`、`Leitarkkk/dsh-research-nudge`、`Pasumao/dsh-plugin-dev-kb`、`chocobo77/dsh-infinite-context`、`shuishuipingan/InkWeaver`(**GPL-3.0**)、`lifensame/dsh-plugin`、`stopchewing/dsh-mcp-view`、`stvlynn/dsh-dify-marketplace`、`meme-dog/dsh-plugin-finder`、`KevinWen7415/dsh-virtual-workspace`、`yancf666/dsh-usage-panel`、`janpauldahlke/dsh-web-missions`、`liuqingman/dsh-hawkeye-scan`、`hrhgit/deepseek-harness-plugin-manager`、`BandieraRosa/dsh-plugin-notion`、`sandbaseai/dsh-kit`(`null`)、`121212165/dsh-plugin-deep-search`、`Lings01/dsh-filepanel-plugin`、`ice5kysl/dsh-workspace-kit`、`honwee/dsh-plugin-mynah`、`fan969690/dsh-desktop-tools`、`xuanyuanluoxue/computer-use-vision`(`NOASSERTION`)、`meliodascz89/dsh-orchestra`、`bloodarea/dsh-knowspace`(`null`)、`feely0208/dsh-content-trust`、`BotonJ/dsh-plugin-sentinel`、`Jeffine322/dsh-tool-pdf`(`null`)、`suomir1995/dsh-link-collect`、`suomir1995/dsh-notes`、`margbug01/dsh-ma-plugins`、`rex178178/dsh-turnbar`、`truelove-dreamer/dsh-plugin-recall`(`null`)、`HIT-HTML/dsh-ENHANCED`、`Kai-ZKH/dsh-branch-tree`、`gaoheng980610/dsh-knowledge-base`、`xzs125/dsh-docs-knowledge`、`nan1010082085/dsh-plugin-ima-sync`、`ralfsqual/dsh-pdf-reader`、`nnma12358/dsh-plugin-win-desktop-kit`、`Qqiutand/dsh-study-reader`、`HaoKuo/dsh-notebook-studio`、`Niobium-41-nb/dsh-html-output`、`Kevoyuan/dsh-skill-fuzzy`(`NOASSERTION`)、`johnhom1024/dsh-ios-input-fix` | A 原生DSH | 混合 | — | 重复 / 无关 / 已覆盖 | ⛔ | rejected | 2026-10-20 | 单点能力（上下文裁剪、MCP 连接器、用量面板、桌面巡检、插件查找、@ 补全、IDE 风格面板…）。在册已有对应项；`dsh-usage-panel` 属已封板的用量轴；`InkWeaver` GPL-3.0、`computer-use-vision`/`dsh-skill-fuzzy` `NOASSERTION`、`bloodarea`/`dsh-kit`/`dsh-tool-pdf`/`dsh-plugin-recall` 无许可证，均为红线 |

> **本轴结论（四条）**：
> ① **「检索」在 A 组已裂成两半**：搜索侧（web search 15 家 / RAG 16 家 / 会话 12 家）**彻底饱和**；
> 排序侧（相关度、字段加权、结果重排）**一家都没有**。本仓 `layered-search.js` 374 行里也没有一行排序。
> ② **本轮最有价值的产出不是候选，是 L-2**：`layers` 传空集 → `empty:true` 零命中且**不报错**。
> 它现在只被 `study-workspace.jsx` 的 `layers ?? defaultSearchLayers` 侥幸绕过。
> ③ **「可锁版」这一门又多一种死法**：第三十四轮是宿主版本窗口，本轮是 **npm 声明 `public` 却从未 publish**
> （`dsh-attachment-formats`）。`private: true`（`dsh-kb-sieve`）、双名 404（`dsh-raw-html`）已是第三、第四种。
> ④ **B 类替换底层需要一条新判据**：差分测试的断言必须是「命中集合 ⊇ 旧实现」。
> 拼音（第二十九轮）、高亮（第三十一轮）、排序（本轮）三轮各自独立得到同一结论。
>
> ⑤ **与同日第三十五轮（C 组 · 字幕原文层）的关系**：两者都落在「文本怎么进检索」这条链上，但**前后段不同**——
> C 组修的是**原料**（字幕 `join("")` 无分隔、缺标点），本轮修的是**排序**（命中顺序 = 数组顺序）。
> 顺序上应先修原料再修排序：没有句子边界的文本，任何相关度打分都只能落在「整块」这一粒度上。

---

## 2026-10-20 · C 组派生（第三十七轮）· **关键路径健全性轴** · 追加

> 关键词：`learned card generation language:javascript`(**0**) / `anki card template language:typescript`(7) /
> `handwriting math recognition language:javascript`(8) / `onnxruntime-web ocr`(22) / `distractor generation question`(47) /
> `text diff match patch chinese`(**0**) / `diff-match-patch language:javascript`(56) /
> `handwritten notes to text language:typescript`(32) / `equation keyboard latex input`(1) /
> `quiz generator language:typescript stars:>100`(1)。
> **10 次搜索（达上限未超限）、0 次 403，本轮完整**。约 120 条去重命中 → 首次登记 13 行（含 2 簇）。
> **🟢1（`ocr-web`，B 类）+ 🔵5 + ⚠2 + ⛔4 簇**；骨架 `packages/dsh-radar-ocr-web`（B 类 · 锁版 `@ocr-web/core@0.2.1`）。
> 起点是读码发现的两处断环：**F-1 `recordAttempt()` 全仓无调用方**、**F-2 出题原料只能来自已解析的讲义块**。

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `bent2685/ocr-web` | **B 其他JS（纯库）** | **MIT** ✅（LICENSE 实文首行已核，非仅 API 字段） | 板书/截图/手写 → 出题原料 | **重复可强化**（补 `quizMaterials()` 只能吃讲义块这一缺环） | 🟢 | proposed | 2026-10-20 | ★3 / fork 0，**2026-05-08 push（约 5 个月未更新）**。npm `@ocr-web/core@0.2.1` **实查可锁** ✅（unpacked **256,788 B**）+ `@ocr-web/models-ppocrv5@0.1.1`（**8,007 B**，**只有 jsDelivr URL 常量，不含模型**）+ peer `onnxruntime-web`（unpacked **144,618,540 B**，全后端）。**零运行时依赖**。能力：PP-OCRv5（DBNet 检测 + CRNN/CTC 识别，字典 18,384 字含 CJK）、**Worker 模式**、字节级 `onProgress`、`OcrLine` 带 `points` 四边形 + `score`。**判据①②③全成立**：同一 `quiz-panel` / 同一条「文字→出题」链的相邻环 / 本仓此前**完全没有**这一层。**本轮 L2 骨架** `packages/dsh-radar-ocr-web`。三条风险：R-1 本仓无 wasm 静态管线、R-2 模型默认外联与离线定位冲突、R-5 ★3 且停更 5 个月。⚠ **上游 peer 写 `^1.25.0`，但 npm 上 `1.25.0` 只有 `-dev.*` 预发布**（稳定版自 `1.25.1` 起）→ 骨架锁 `1.25.1` |
| `JackuB/diff-match-patch` | B 其他JS（纯库） | **Apache-2.0** ✅ | 简答题判分（逐字差异） | 重复可强化，但**当前无消费者** | 🔵 | proposed | 2026-10-20 | ★270，2023-05-18（3 年未更新）。Google `diff-match-patch` 的 npm 封装；逐字 diff，**中文按码点切分，天然可用**。**价值在 F-1 之后**：`attempts` 接上才会需要「答案差在哪」。现在接进来是在空链上加环节 → 不出骨架 |
| `AnsonLai/docx-redline-js` | B 其他JS | **MIT** ✅ | 讲义修订对比 | 无关（本仓讲义是块结构化，不比 docx） | 🔵 | proposed | 2026-10-20 | ★15，**2026-10-18 push**（活跃）。Host-independent OOXML 引擎，原生修订标记。仅作「版本 diff」思路参考 |
| `ECuiDev/obsidian-quiz-generator` | B 其他JS | **MIT** ✅ | 从笔记出闪卡 | **重复无增益** | 🔵 | proposed | 2026-10-20 | ★174。多模型（OpenAI/Gemini/Ollama）从笔记生成交互式闪卡 + quiz UI。**形态强耦合 Obsidian**；出题逻辑与本仓 `dsh-zhiyun-quiz` 的「规则门禁 + 自审 + 待审」相比更弱（无来源锚点、无质检链）→ 不采用 |
| `Gilbetrar/anki-renderer` | B 其他JS | **MIT** ✅ | 卡片模板渲染 | 无关（本仓不导出 Anki 包） | 🔵 | proposed | 2026-10-20 | ★1，2026-06-09。Anki 卡片模板 → WASM 渲染。若本仓未来要「导出到 Anki」才用得上 |
| `Just-anoob/NotesReader` | B 其他JS | **Apache-2.0** ✅ | 手写笔记 → 文本 | 重复可强化（同 `ocr-web`） | 🔵 | proposed | 2026-10-20 | ★0。AI 笔记编译，**依赖外部视觉模型 API**（非本地推理）→ 与 `ocr-web` 相比多一条数据外发，**故不取**，仅登记 |
| `MyScript/myscript-math-web` | B 其他JS | **`NOASSERTION`** ⚠ | 手写公式 → LaTeX | 全新（本仓无公式手写输入） | ⚠ | pending-license | 2026-10-20 | ★244，**2021-01-04 停更**。手写数学公式识别（商业 MyScript 引擎的 Web 封装）。**能力对口**（理工科手写推导），但①许可证 `NOASSERTION` ②停更近 6 年 ③实为商业 API 客户端。**待人工核验许可证，不采用、不摘码** |
| `Fanfulla/OCR-buddy` | B 其他JS | **`NOASSERTION`** ⚠ | 本地 OCR 扩展 | 重复可强化 | ⚠ | pending-license | 2026-10-20 | ★54，2026-09-27。100% 本地 OCR Chrome 扩展（代码/正文/LaTeX 公式）。**能力比 `ocr-web` 更宽**（含公式），但 `NOASSERTION` + 扩展形态难封装。**待人工核验许可证，不采用、不摘码**。若许可证为宽松，**下轮应优先评估它替代 `ocr-web`** |
| `StabRise/ScaleDP-TS` / `Zapca/Math-Notes` | B 其他JS | **AGPL-3.0** / **GPL-3.0** ⛔ | 浏览器内 PDF 解析 / 手写公式求解 | — | ⛔ | rejected | 2026-10-20 | ★38 / ★0。**许可证红线**，无论能力多对口都不接 |
| 无许可证单点：`rotkonetworks/ocr.rotko.net`、`anirbandotdev/PrivacyLens`、`Artemiy111/anki-card`、`Zecat/anki-hanzi-quiz`、`justinmeiners/gesture-recognition`、`samirhssn/richmath-input-react` | B 其他JS | **`null`** ⛔ | — | — | ⛔ | rejected | 2026-10-20 | 全部无许可证。注：`rotko.net` 与 `ocr-web` 同为「PP-OCRv5 mobile + onnxruntime-web 浏览器内」，**能力上等价**，仅因无许可证排除 |
| `distractor generation` 簇：`Yifan-Gao/Distractor-Generation-RACE`(★70)、`harrylclc/LTR-DG`(★28)、`narain280493/Automatic-Question-Generation`(★22)、`DRSY/DGen`(★22)、`umass-ml4ed/prompt_distractor_generation_NAACL`、`ryyrn/Knowledge_Graph_Guided_Distractor_Generation`、`xinzhu-cai/probase-concept-generator`、`obss/disgem`、`FawziElNaggar/Question-MCQ-_Answer_Generation`、`zpqiu/EDGE`(GPL-3.0) | 非 JS / B | 8 条**无许可证**、1 条 `NOASSERTION`、1 条 GPL | 选择题干扰项 | **全新（但技术栈不合）** | ⛔ | rejected | 2026-10-20 | 全部 **Python**（AAAI/EMNLP 论文实现），且 8 条无许可证。本仓 `quiz-panel.jsx` 明确「选择题这一版不出」→ 即便能接也没有落点 |
| `handwritten notes to text` 簇：`csfahad/writeshift`、`heyaryansingh/type-it-up`、`malikmuhammadsaadshafiq-dev/mvp-handwriting-to-text-scann`、`cryptozues/Handwritten-Text-Digitizer`、`harsh-0712/notes-digitize`、`drealdumore/write-it`、`VanshNagpal10/IntelliDocs` | B 其他JS | **全部 `null`** ⛔ | 手写 → 文本 | 重复可强化 | ⛔ | rejected | 2026-10-20 | 全部是 ChatGPT/Gemini 视觉 API 的套壳 App，**零本地推理**、**零许可证**。与 `ocr-web` 相比多一条「学生手写内容上传给第三方」——对本地化工作台是**负面** |

> **本轴结论（四条）**：
> ① **本轮最有价值的产出是 F-1，不是候选**：`grep -rn recordAttempt` 全仓**只有 `store.js:604` 定义处一处，无调用方**。
> `attempts` 轨（错题归因 / 薄弱点统计 / 「近 3 次都错」规则的**唯一**依据）代码全在、测试全过，**却永远没有数据**。
> `quiz-panel.jsx` 只有采纳/丢弃/移出队列，**没有「作答」**。这条**不需要任何外部库**，不应出骨架、应直接修。
> ② **C 组的「功能域」方向确实在枯竭，但「链上缺环」方向还没走完**：本轮 10 次搜索只捞出 1 个 🟢，
> 而读码 10 分钟就找到 2 处断环。**下轮 C 组建议继续用「先读码找断环、再定向搜」的方法**，
> 而不是继续枚举 `quiz practice` / `flashcard` 这类功能词。
> ③ **「PP-OCRv5 + onnxruntime-web 浏览器内 OCR」已经是成熟方案**，本轮 22 条命中里有 **3 条**是同一技术栈
> （`ocr-web` / `rotko.net` / `ScaleDP-TS`），差别只在**许可证**（MIT / 无 / AGPL）。这说明选型不该再纠结
> 「有没有库」，而是「谁的许可证干净、谁的部署成本低」。
> ④ **上游 peer 区间可与 npm 现实脱节**：`@ocr-web/core` 写 `onnxruntime-web: ^1.25.0`，
> 而 npm 上 `1.25.0` **只有 `-dev.*`**。这与第三十四轮「宿主版本窗口」、第三十六轮「声明 public 却从未 publish」
> 同属「文档/元数据与仓库现实不一致」的第五种形态 —— **锁版前必须 `npm view <pkg> versions` 实查，不能只读 peer 区间**。

---

## 2026-10-20 · 第三十八轮（B 组派生 · 校园数据「抓取后解析层」轴）

> 同日第 4 轮（00:00 C / 03:15 A / 06:00 C）。B 组「校园信息侧」已于 10-19 第三十三轮封板，
> 本轮改走「**先读码找断环、再定向搜**」：起点是 `packages/dsh-zhiyun-classroom/src/auth.js:27`
> 的 `executionToken()`（用正则抠 `<input>`）。
> 关键词（9 次，未超限，0 次 403）：`html parser language:javascript stars:>200`(**18**) /
> `html query selector language:typescript stars:>50`(**0**) / `deno dom`(81) / `linkedom`(28) /
> `htmlrewriter`(41) / `cheerio`(5,484) / `html parser`(13,404) / `dom implementation`(4,592) /
> `css selector engine language:javascript`(58)。
> 补扫（不计入 10 次）：`html sanitizer language:javascript`(144)、
> `zju comment scraper javascript`(**0**，A 组探针)。
> 约 19,000 条命中 → 有效候选 4 条；**🟢1（cheerio/slim）🔵1（DOMPurify）⛔2 簇（10 条）**；
> 本轮 **0 条 `NOASSERTION`**、**0 个 A 类**。
> **本轮出骨架** `packages/dsh-radar-dom-parse`（B 类，锁版 `cheerio@1.2.0`，**走 `./slim` 入口**）。

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `cheeriojs/cheerio` | **B 其他JS（纯库）** | **MIT** ✅ | 教务登录 / 抓取页面解析 | **重复可强化**（`auth.js` 的 `executionToken()`） | 🟢 | proposed | 2026-10-20 | ★30,523，**2026-10-19 push**（活跃）。npm `cheerio@1.2.0` **实查可锁** ✅（`engines: node>=20.18.1`，与本仓 `^22.19.0 \|\| >=24.0.0` 兼容）。**⚠ 必须走 `./slim` 子入口**：包根 `dist/esm/index.js:11` 静态 `import * as undici from 'undici'`（只为 `fromURL()`，Node-only）→ 浏览器构建直接失败。esbuild 实测（minify/ESM/browser）：`./slim` **199,966 B**、包根 **384,451 B**、`linkedom` **275,245 B**。**缺口已实测复现（非推断）**：本仓 `executionToken()` 对 `<input name="execution" value="a>b">` 返回 **`undefined`**（`[^>]*` 用 `>` 界定标签边界，而 `>` 在双引号属性值里合法），→ `submitCasForm()` L72 抛 `AUTH_SHAPE: 登录页缺少 execution` → **登录直接失败**；对 `value="abc&amp;def"` 返回 `"abc&amp;def"`（未解码实体，静默错值）。**判据①②③全成立**。**本轮 L2 骨架** `packages/dsh-radar-dom-parse`。⚠ 三点：R-1 `auth.js` 是已上线代码，替换属回归高风险；R-2 CAS 页由服务端取回，客户端无此 HTML → 若只服务端用则 bundle 里是死代码；R-4 与在册 `dsh-radar-vault-parse`（markdown-it）**不重叠**（输入语言不同） |
| `cure53/DOMPurify` | B 其他JS（纯库） | **`(MPL-2.0 OR Apache-2.0)`** ✅（按 Apache-2.0 可用） | 富文本 / 不可信 HTML | 无关（本仓目前不拼 HTML） | 🔵 | proposed | 2026-10-20 | ★17,478，2026-10-16 push。**登记理由只有一条**：防止把「上了 cheerio」误读成「可以不做净化」—— **sanitizer 是「把不可信 HTML 变安全」，解析器是「把 HTML 变可查询」，两件事**。本仓 `grep sanitize packages/*/package.json` **零命中**，净化需求目前由「不拼 HTML」这条纪律覆盖 → 本轮无落点。⚠ 若将来接入，须注意它**不是** MPL 单许可（双许可可选 Apache，不触红线） |
| CF `HTMLRewriter` 绑定簇：`cloudflare/html-rewriter-wasm`(★218, **`null`** ⛔)、`worker-tools/parsed-html-rewriter`(★45)、`ttys026/cfo`(★4)、`akira108/html-rewriter-readability`(★4)、`tldraw/cloudflare-workers-unfurl`(★18) | B 其他JS | 多数 MIT，1 条 `null` | — | 运行时不兼容 | ⛔ | rejected | 2026-10-20 | 全部是 **Cloudflare Workers 专用绑定**（依赖 `HTMLRewriter` 全局或 Workers 运行时）。本仓是 Cordis 宿主 + 浏览器，**跑不了**。`html-rewriter-wasm` ★218 是唯一「wasm 化可移出 Workers」的，但**无许可证** ⛔ |
| 非 JS 的 HTML 解析器簇：`jhy/jsoup`(★11,411 Java)、`AngleSharp/AngleSharp`(★5,543 C#)、`scinfu/SwiftSoup`(★5,127 Swift)、`psf/requests-html`(★13,805 Python)、`opendataloader-project/opendataloader-pdf`(★29,748 Java) | 非 JS | 多数 MIT | — | 技术栈不合 | ⛔ | rejected | 2026-10-20 | skill 限定 JS 技术栈。`opendataloader-pdf` 是 `html parser` 的第 2 名，但它是 **PDF 表格提取**，与本轴（页面表单解析）无关；`requests-html` 停更于 2024-04 |
| 对照件（**不入册**，防下轮重搜）：`WebReflection/linkedom`(ISC, ★2088, `0.18.13`, bundle 275,245 B, **属性名大小写敏感**)、`fb55/htmlparser2`(MIT, ★4793, 无 CSS 选择器)、`capricorn86/happy-dom`(MIT, ★4709, 含 window 全套、过重)、`fgnass/domino`(BSD-2, ★791)、`parse5@8.0.1`(MIT, cheerio 传递依赖)、`dperini/nwmatcher`/`nwsapi`(MIT, **只做选择器匹配不做解析**) | B 其他JS | 均宽松 ✅ | — | 重复但增益不如 cheerio | 🔵 | — | 2026-10-20 | 六件全部实查 npm 版本与许可，**故意不逐行入册**，仅在此记录选型依据。`linkedom` 是唯一真正的次选（能力等价、体积 +37%、且 `NAME="execution"` 时 `querySelector('input[name=execution]')` 匹配不到，cheerio 能） |

> **本轴结论（四条）**：
> ① **B 组「找新插件」确已封板（本轮 0 个新 DSH 插件），但「抓取后解析层」有产出** ——
> 唯一 🟢 是**早就存在**的 cheerio（★30,523），它成为候选**完全是因为先读到了 `auth.js:27` 那段正则**。
> 与第三十七轮（`recordAttempt` 无调用方）、第三十六轮（`layers` 空集静默）同一模式：
> **本仓价值洼地在「已有能力的接缝」上，不在「缺一个外部库」上。**
> ② **「改用解析器」这件事，入口比库重要** —— `cheerio` 包根静态 `import undici`（Node-only，`dist/esm/index.js:11`），
> `./slim` 不带它、体积从 384 KB 降到 200 KB。**第三门「可锁版」应扩成「包存在 + 从哪个入口进」**：
> 第三十六轮查「包是否存在」（四种死法），本轮新增第五种 —— **包存在、但默认入口在目标运行时跑不了**。
> ③ **最有价值的产出仍是缺陷** —— L-1 的 `>` 断点今天没炸（CAS execution 为 `e1s1`），
> 一旦触发，现象是「登录页缺少 execution」，**看起来像官网改版，实际是本仓正则的假设错了**。
> 「把上游变化当原因」比任何缺失能力都更难查。修法有两条（换解析器 / 正则改 1 行），**本骨架只是给出选择**。
> ④ **L-2 `meta.complete` 这条保护目前是空转的** —— `getSchedule()` 走 `result()` 默认 `complete = true`，
> 课表永远不会是 `null`；因此今天页 `agenda.js:16` 的 `incomplete` 分支**只能由 meta 缺失触发**，从未被真实验证。
> 不是 bug，但建议加课表分页时同步补 `meta` 断言。

### 2026-10-20 · 第三十九轮（C 组派生 · 复习队列「排序与容量」轴）

> 起点：读码找断环（`acceptedQuiz` 只有字典序 + `slice(0,20)`；`computeBacklog` 零调用方）。
> 9 次搜索（未超限）、0 次 403；4 个学习语汇词直接返 0（`anki queue sorting` / `review debt` 等）。
> **无 A 类、无 🟢、0 条 NOASSERTION、未出骨架**。

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `xiaohajiayou/Leetcode-Mastery-Scheduler` | B 其他JS | MIT（`package.json` 写 ISC，同属白名单） | 刷题/复习 | 重复可强化（学习页·复习队列排序） | 🟡 | proposed | 2026-10-20 | ★543，2026-04 后未动。可移植的**规则**三条：①`reviewService.js:60-95` 按 `getCurrentRetrievability` 升序（最可能忘的排最前）②`utils.js:168-175` 直接用 `ts-fsrs` 的 `forgetting_curve` + `dateDiffInDays`，不自写公式 ③`sort.js` 把「推迟时长」单列一维（正=逾期/负=未到期）。**判 🟡**：非库形态（Chrome 扩展，算法层绑 `store.js`）；自带 `ts-fsrs ^4.7.0` 与本仓 `5.4.2` 撞大版本；`qualityToRating` 用整数 1–4 + `default→Good` 兜底，与本仓字符串枚举 `['again','hard','good','easy']` 及「不许把判不了当某档」纪律冲突。**前提不成立**：`recordAttempt` 仍无调用方 ⇒ 无 `selfRecall` ⇒ 无 `stability` ⇒ 排序空转，故不出骨架 |
| `luciopaiva/heapify` | B 其他JS | MIT | — | 重复无增益 | 🔵 | rejected | 2026-10-20 | ★743。零依赖优先队列；本仓队列仅 20 条截断，`Array.sort` 足够；只有「答题后增量插队」才需要堆，而本仓尚无答题入口 |
| `ignlg/heap-js` | B 其他JS | BSD-3-Clause | — | 重复无增益 | 🔵 | rejected | 2026-10-20 | ★167。与 heapify 二选一即可，当前两者都不需要 |
| `clauderic/dnd-kit` | B 其他JS | MIT | 复习队列手排 | 全新（但与本轮方向相反） | 🔵 | proposed | 2026-10-20 | ★17730，仍活跃（2026-10-15）。`@dnd-kit/core@6.3.1` + `@dnd-kit/sortable@10.0.0`，依赖 `tslib`/`@dnd-kit/utilities`。仅当允许**手动**调序时才用；与「按遗忘曲线自动排」是相反的两种产品判断，先有数据再谈 |
| 撞车簇：`scheduler`/`knapsack` 前排 | B 其他JS | MIT / `null` / GPL-2.0 混杂 | — | 重复无增益 | ⛔ | rejected | 2026-10-20 | ★774 React 可视化排程、★587 Kettle 调度监控、★344 定时任务、★240 kue-scheduler、★199 Google-Meet 自动上课；knapsack 前排 ★≤6 可视化玩具 → 全是「调度」的另一义项，**建议两词移出 C 组派生词池** |

### 2026-10-20 · 第四十轮（C 组派生 · 笔记库链接解析与图结构轴）

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `remarkjs/remark`（npm `remark-parse@11.0.0`） | B 其他JS | MIT ✅（npm + GitHub 一致） | 笔记/讲义正文结构 | **重复可强化**（「笔记」页反链底座） | 🟢 | skeleton-created | 2026-10-20 | ★9021，push 2026-09-27。产出带类型的 mdast，使「代码块里的 `[[x]]`」能按节点类型排除而非正则猜。⚠ 与 2026-10-19 登记的 `mdast-util-from-markdown`（判 🔵）同族但**换的对象不同**：当时是「替换渲染器」，本轮是「替换『哪段是代码』的判定」。锁版 5 依赖见骨架。已出骨架 `dsh-radar-vault-graph` |
| `syntax-tree/unist-util-visit`（5.1.0） | B 其他JS | MIT ✅ | 同上（遍历层） | 重复可强化 | 🟢 | proposed | 2026-10-20 | ★360，push 2026-01-22。**实测** `visit(tree,'text',…)` 天然跳过 `inlineCode`/`code`。单包 33,781B。合并进上述骨架，不单独出包 |
| `graphology`（0.26.0）+ `graphology-communities-louvain`（2.0.2） | B 其他JS | MIT ✅（两包一致） | 笔记结构/学科簇 | **全新**（本仓零图算法） | 🟡 | proposed | 2026-10-20 | 官方 monorepo 仍活跃。**实测**两簇样例社团检测正确。⚠ 只认无向图；社区编号随遍历顺序变，须规范化；`addEdge` 在节点不存在时抛 `NotFoundGraphError`，须先 `mergeNode`。合并进骨架 |
| `tats-u/markdown-cjk-friendly` | B 其他JS | MIT ✅ | 中文笔记的强调符边界 | 全新（但本仓无渲染入口） | 🔵 | proposed | 2026-10-20 | ★171，push 2026-10-19。**已读其 `specification.md`**：改的是 CommonMark 的 flanking delimiter 定义，不是「中英文加空格」。⚠ 正文由**宿主** `MarkdownText` 渲染（`page-notes/src/client.jsx:26`），本仓接管不了 → 只登记 |
| `escwxyz/remark-obsidian-callout` | B 其他JS | Apache-2.0 ✅ | 笔记（callout 块） | 重复无增益（无渲染入口） | 🔵 | proposed | 2026-10-20 | ★34，push 2025-09-03。与上条同因作废 |
| `flowershow/remark-wiki-link` | B 其他JS | **无许可证** ⛔ | — | — | ⛔ | rejected | 2026-10-20 | ★49，**license 为 null** → 只登记，不摘代码。功能 ⊂ 本仓 `splitWikilink` |
| `wikibonsai/wikirefs` | B 其他JS | **GPL-3.0** ⛔ | — | — | ⛔ | rejected | 2026-10-20 | ★10。传染性许可，直接排除 |
| `upphiminn/jLouvain` | B 其他JS | MIT ✅ | 学科聚类 | 重复且无增益 | ⛔ | rejected | 2026-10-20 | ★156，但 **2021 停更**、无图数据结构配套；被 `graphology-communities-louvain@2.0.2` 完全覆盖 |
| mdast→docx/pdf 簇（`md2docx/mdast2docx` 等 6 个） | B 其他JS | MPL-2.0 ⛔ / 其余 MIT | 讲义导出 | 与「笔记」页无关 | ⛔ | rejected | 2026-10-20 | 全是**导出器**（方向不同的重复劳动）；★ 最高 40 |
| 图可视化簇（`zakjan/pixi-graph` 等） | B 其他JS | MIT / 多个 null | — | 仅参考 | ⛔ | rejected | 2026-10-20 | `graphology <X>` 搜到的**全是渲染/布局插件**，无一图算法；本轮 53 条命中里 0 条可用 → 「算法层要按 npm 包名找，不能按 GitHub 关键词找」 |

### 2026-10-20 · 第四十一轮（B 组 · 浙大场景 / 中文检索底层轴）

> 关键词：`chinese word segmentation javascript`(3) / `jieba in:name`(753) / `chinese search tokenizer language:typescript`(1) /
> `bm25 fuzzy search language:javascript`(2) / `segmentit`(9) / `nodejieba`(25) / `chinese segmentation wasm`(4) /
> `pinyin segmentation language:javascript`(3) / `jieba-wasm`(11) / `chinese full-text search language:javascript`(3)；
> 补扫 `wasm segmenter japanese language:typescript`(**0**)、`lunr-chinese OR elasticlunr chinese`(**114,160 = 纯 `chinese`，OR 限定符再次丢词**)。
> **10 次搜索（达上限未超限）、0 次 403，本轮完整**。约 810 条命中 → 首次登记 12 行（含 3 簇）；**🟢1🔵3⛔8 行**；**0 条 `NOASSERTION`**、**0 个 A 类**；
> 本轮出骨架 `packages/dsh-radar-search-segment`（B 类，锁版 `jieba-wasm@2.4.0`）。

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `fengkx/jieba-wasm`（npm `jieba-wasm@2.4.0`） | B 其他JS（WASM 绑定） | **MIT** ✅（GitHub + npm 一致） | 中文讲义检索 | **重复可强化**（「学习」页检索 `findIn` / 宿主 `knowledge.search`） | 🟢 | skeleton-created | 2026-10-20 | ★102，push 2026-01-27。底层 `messense/jieba-rs`（★986，MIT）。**缺口实测（直接 import 本仓真实 `findIn`）**：`泰勒展开` 对 `泰勒 展开`、`行最简形` 对 `行 最简形` 均返回 `null`，分词后有序词序列命中；对照组 `极值点`/`拉格朗日中值定理` 两侧均命中。**⚠ 缺口不是「词被切开」**（`矩阵的秩`/`行列式` 字面均 true），是**写法不一致**。**⚠ 反例 F-3**：`特征值` 对 `特征 值` 两法皆空（`cut_for_search` 产出 `[特征, 特征值]`）→ 须「主词 + 子词」双轨。**入口差异已实测**：Node 分支 CJS（同步读 wasm，无需 init，且**具名导入会失败**，只能默认导入）；浏览器分支 ESM 且**必须 `await __wbg_init()`**。体积 **wasm gzip 2,815,114 B** + 胶水 2,600 B → **禁止进浏览器 bundle**。**Q-1 阻塞**：`findIn` 是客户端函数，接浏览器就要送 2.8 MB，不接则「学习」页仍不切词 → 评审先裁决走哪侧 |
| `yanyiwu/nodejieba` | B 其他JS | MIT ✅ | 同上 | 重复可强化 | 🔵 | proposed | 2026-10-20 | ★3234，push 2026-10-12（最活跃的 Node 侧 jieba）。**判 🔵 而非 🟢**：原生模块（`node-gyp` 编译），WorkBuddy/DSH 的 electron 与 CI 都要预编译产物；`jieba-wasm` 已能给等价能力且免编译 → 同为 jieba 词典，无理由选重的那个 |
| `linonetwo/segmentit` | B 其他JS | MIT ✅ | 中文切词 | 重复可强化 | 🔵 | proposed | 2026-10-20 | ★322，**push 2023-04-13 已停更 2 年半**。纯 JS（无 wasm）、体积远小于 jieba-wasm，但词典规模与更新频率均劣于 jieba-rs；且依赖 `preval.macro`（Babel 宏，构建链耦合）。**备选**，仅在「拒绝 2.8 MB wasm」时考虑 |
| `louis-1448-2/obsidian-zh-search` | B 其他JS | MIT ✅ | 中文笔记检索 | **重复可强化**（「笔记」页检索） | 🔵 | proposed | 2026-10-20 | ★0，push 2026-10-19（新仓）。思路与本轮骨架**同构**（中文优先 FTS = 分词 + 索引），但形态是 Obsidian 插件、无独立 npm 包 → 只作**设计参照**，不摘代码 |
| `AliceLJY/babel-memory` | B 其他JS | MIT ✅ | 中文全文检索预处理 | 重复可强化 | 🔵 | proposed | 2026-10-20 | ★0，push 2026-09-05。22 语种 FTS 预处理（CJK/泰语切分 + 多语言停用词）。⚠ 无发布包、无测试可见 → 只登记 |
| `messense/jieba-rs` | B 其他JS（Rust） | MIT ✅ | — | 上游依赖 | 🔵 | proposed | 2026-10-20 | ★986，push 2026-10-15。**非 JS**，不进集成候选；登记理由：`jieba-wasm` 的**真正的上游**，其更新节奏决定 wasm 版能否跟进 |
| `maxchang3/web-word-segment` | B 其他JS | MIT ✅ | — | 参考实现 | 🔵 | proposed | 2026-10-20 | ★1，2025-04。`jieba-wasm` + `Intl.Segmenter` 对照 demo，可作**验收基线**（对比「浏览器原生切词」的差距），不入包 |
| `cxumol/jieba-wasm-html` | B 其他JS | MIT ✅ | — | 重复且无增益 | ⛔ | rejected | 2026-10-20 | ★33，**2022 停更**。单页 HTML 打包版，无法作为依赖引入；与 `jieba-wasm` 同源 |
| `hermanschaaf/jieba-js` / `shataniya/cncut` | B 其他JS | **无许可证** ⛔ | — | — | ⛔ | rejected | 2026-10-20 | ★52 / ★5，`license` 均 `null`。只登记，**不摘代码** |
| `Xmader/gse-wasm` / `FlickerReader/jiebago-wasm-bind` / `Anillc/jieba-wasm` / `shouya/jieba-wasm` | B 其他JS | 多数 `null` ⛔ | — | 重复且无增益 | ⛔ | rejected | 2026-10-20 | 全部 ★≤9、2019–2023 停更、且**多数无许可证**；被 `fengkx/jieba-wasm` 完全覆盖 |
| 非 JS 的 jieba 移植簇：`fxsjy/jieba`(★35,202 Python)、`huaban/jieba-analysis`(★2,708 Java)、`fukuball/jieba-php`(★1,379)、`anderscui/jieba.NET`(★1,142)、`wangbin/jiebago`(★506，`null`)、`qinwf/jiebaR`(★365 NOASSERTION) | 非 JS | 多数 MIT | — | 技术栈不合 | ⛔ | rejected | 2026-10-20 | skill 限定 JS 栈。**这是本轮最值得记的一条**：`jieba in:name` 753 条里 ★ 最高的前 10 全部是非 JS 移植 → **「分词」在 GitHub 上是按语言家族分布的，按关键词找必然先撞到 Python/Java 的原版** |
| `Superjomn/qlin` / `epiphany131/novel-platform` / `chankamlam/chinese-search` / `ole3021/lunr-chinese` / `yoch/frozenminisearch` / `ammisaidkaidi/smart-hybrid-search` / `Carpathica/SegmentIt` / `uranbekanarbaev/pinyin-to-chinese` 等 | B 其他JS | MIT / `null` 混杂 | — | 无关或体量过小 | ⛔ | rejected | 2026-10-20 | ★0–8；`novel-platform` 是小说站、`SegmentIt` 是图像分割（**同名不同物**，与 `segmentit` 撞名）、`smart-hybrid-search` 面向阿拉伯语、`pinyin-to-chinese` 是输入法方向。`frozenminisearch` 是 `minisearch` 的只读变体（2026-10-20 新建，★1），第三十六轮已锁版 `minisearch@7.1.2` → 无增益 |

## 2026-10-20 · 第四十二轮（A 组 · **持久记忆 / 归属台账轴**）

> **无搜索超限**：8 次（上限 10），0 次 403 → **本轮完整**。约 460 条未登记命中 → 首次登记 14 行。
> 关键词：`deepseek-harness plugin`(9,720 探针)、`dsh plugin provenance`(15)、`dsh plugin citation`(17)、
> `cordis plugin telemetry`(4)、`provenance tracking javascript`(4)、`content provenance language:typescript`(82)、
> `data lineage javascript`(7)、`dsh plugin memory`(430)。
> **🟢1 / 🟡1 / 🔵4(含 1 结构升级) / ⛔3 簇**；**`NOASSERTION` 2 条待核、无许可证 3 条（均只登记、未摘代码）**。
> **本轮出骨架** `packages/dsh-radar-me-memory`（A 类 · 锁版 `dsh-auto-memory@0.9.0`）。
> 两条判据更新：① **A 类第五道门「宿主编译选项」**——`dsh-memory` 的 FTS5 在无该选项的 `node:sqlite` 上
> **`apply()` 即抛错**；② **`kind:'single'` 槽体系下「外围兼容层」写不出来**——需 UI 的候选只能新开槽。

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `AskTheWay/dsh-auto-memory` | **A 原生DSH** | **MIT** ✅（npm + 仓内一致） | 跨会话记忆 → 「我的」页台账 | **重复可强化**（「我的」页仅有设置、零台账） | 🟢 | skeleton-created | 2026-10-20 | ★137，push 2026-10-20，unpacked 164,828 B、**零 dependencies**。`dsh.bundle.patch` ✅ + `client.platform:web`。peer `>=0.1.5-rc.2 <0.3.0` → **与 `hostVersions` 相容**（不卡第三十四轮那道门）。**存储是纯 Markdown，不用 SQLite** → 不踩 FTS5 坑。⚠ **判据①条件性成立**：已读打包 `lib/client.js:1589–1595`，上游注册 `main`（顶层页）+ `sidebar.panellist`（侧栏项）→ 原样挂载即**新增两处入口**；且 `dsh.client` 是整包级、Loader 无「只挂宿主侧」开关。骨架阻塞于 TODO-0（shell 的 `zhiyun.<page>.content` 是 `kind:'single'`，容不下第二个注册者） |
| `zhan-tz/dsh-plugin-runbook` | A 原生DSH | MIT ✅ | —（科研脚本项目） | 全新，但**不可锁版** | 🟡 | proposed | 2026-10-20 | ★1，push 2026-08-23。`v0.18.0`，`dsh.bundle.patch` ✅、`client.js` **220 KB**。Jupyter 式运行本：稳定脚本 cell + 执行记录 + Evidence 世代 + Git/agent 双作者 + **重跑须确认**。**npm `dsh-plugin-runbook` 404** → A 类「锁版」地基不在；且落 `main` 独立页。可取的只有**规则**（执行记录 / 证据世代 / 重跑确认），不能取 UI → 🟡 待 npm 发布后重评 |
| `Jesse-njx/dsh-memory` | A 原生DSH | MIT ✅ | 跨会话记忆 | 重复可强化，但**加载即失败** | 🔵 | proposed | 2026-10-20 | ★1，npm `0.1.0` 可锁。`node:sqlite` + **FTS5 虚表 + 触发器**，`memory_search` 把每个 token **逐字引号化**（防 FTS 运算符干扰）写得考究。**实测（§2.1）**：无 FTS5 的 `node:sqlite` 上 `apply()` 抛 `ERR_SQLITE_ERROR: no such module: fts5`，并留下 16 KB 半成品 db → **A 类第五道门**。另：全机一份 `$DSH_HOME/memory/memory.db`，与本仓按账号切分冲突。**只作参照，不集成** |
| `Phant0Meow/dsh-meow-memory` | A 原生DSH | MIT ✅ | 跨会话记忆 | 重复可强化 | 🔵 | proposed | 2026-10-20 | ★**229**（本轴最高），push 2026-10-17。七层 SQLite（soul/user/project/…）。**npm 404** → 无法锁版；且同属 SQLite 依赖组 |
| `ZSeven-W/dsh-noema` | A 原生DSH | MIT ✅ | 长期记忆 | 重复可强化 | 🔵 | proposed | 2026-10-20 | ★129，push 2026-10-06。npm 404 → 无法锁版 |
| `yj-liuzepeng/dsh-project-brain` | A 原生DSH | MIT ✅ | —（项目级） | 无关 | 🔵 | proposed | 2026-10-20 | ★101，npm `1.3.0` 可锁，但 **unpacked 3.46 MB**；「项目架构分析」面向代码仓，本仓无此对象 |
| `EternalNight996/memory-eternal` | A 原生DSH | MIT ✅ | 记忆 + 知识卡片 | 重复可强化（边界重叠） | 🔵 | proposed | 2026-10-20 | ★23，npm `0.10.54` 可锁，1.53 MB。对话沉淀知识卡 + 图谱 + 审核/回收。**「知识卡」与知识库边界不清**，且体量大 → 仅登记 |
| `bonerush/dsh-obsidian-mem` | A 原生DSH | MIT ✅ | 记忆 | 重复可强化 | 🔵 | proposed | 2026-10-20 | ★11。npm 404。Markdown 记忆 + 项目文档，思路与本轮骨架同源 |
| `poplarity/dsh-science-workbench` | A 原生DSH | MIT ✅ | —（生物信息） | **无关（结论性）** | 🔵 | proposed（**维持**） | 2026-10-17 | **结构升级不成立**：本轮正是「留待功能域轮次」，复核后判 `0.3.1` 内容为 **9 个 `bio_*` 工具 + Jupyter 环境快照**，与课程讲义/习题无交集 → **结案为 🔵，不再挂起**。★11 为「领域对口度」而非通用价值 |
| `gwsbhqt/dsh-insight` | A 原生DSH | MIT ✅ | —（可观测） | **重复无增益**（维持） | 🔵 | proposed（**维持**） | 2026-10-15 | 第三十二轮已判，本轮复核维持：`page-plugins` 的 `buildView` + 依赖图覆盖其「每个插件来自哪里」 |
| `121212165/dsh-plugin-token-telemetry` | A 原生DSH | **`null`** ⛔ | — | 与 `dsh-plugin-tool-trace` 重叠 | ⛔ | rejected | 2026-10-20 | ★1，**无许可证** → 只登记，**不摘代码** |
| `121212165/dsh-plugin-tool-trace` | A 原生DSH | MIT ✅ | — | 用量轴饱和（第三十四轮） | ⛔ | rejected | 2026-10-20 | ★1，逐工具调用时长/参数/返回体 → 与 `dsh-plugin-token-telemetry` 同人同批，且用量轴已饱和 |
| `liuhange789/data-asset-inspector` / `gulagala001/oh-my-dsh` / `wilburli/onlyMemory-plugin` / `warrenop/open-preset-harness` | A 原生DSH | `null` ×3 / **NOASSERTION** ×1 | — | 无关 | ⛔ | rejected | 2026-10-20 | 三条**无许可证**、一条 **`NOASSERTION` 待核**；数据资产合规模块包与本仓场景无关 → 全部只登记 |
| `chen731215-dev/dsh-tavern-v2` / `a86582751/dsh-nexttavern` / `Amakurai/dsh-liketavern` | A 原生DSH | **NOASSERTION** / **GPL-3.0** / MIT | — | 无关（角色扮演前端） | ⛔ | rejected | 2026-10-20 | ★56 / ★185 / ★123。前两者为 **NOASSERTION 待核**与 **GPL** → 排除；`liketavern` 虽 MIT，但把 dsh web 改造成 SillyTavern 前端，与学习台无交集 |
| `provenance` 三词命中的非 DSH 簇：`bengarvey/lineage`(★122) / `aws-solutions-library-samples/guidance-for-media-provenance-with-c2pa-on-aws` / `Security4Media/c2pa-video-player` / `Tybravo/StellarProof` 等 90 余条 | B 其他JS | 多 MIT / 多 `null` | — | 无关 | ⛔ | rejected | 2026-10-20 | **「溯源」在 GitHub 是媒体取证（C2PA）+ 区块链存证的代名词**，`data lineage` 则是族谱/可视化玩具 → 与「文档来自哪段原文」同形不同义。**本轴在开源生态里没有对应物** |
| `jkStars/dsh-token-usage-stats` / `woosh2010/dsh-usage-dashboard` / `Hjay1101/dsh-plugin-token-usage` / `samecorner/dsh-token-usage` / `lightli369/dsh-llm-usage-stats` / `wellorbetter/dsh-plugin-window-stats` | A 原生DSH | MIT ✅ | — | **重复无增益**（维持第三十四轮） | ⛔ | rejected | 2026-10-20 | ★1–3，六个包做同一件事（token 用量面板）→ 用量轴确认饱和，不再逐条评估 |

### 2026-10-21 · 第四十三轮（A 组 · **计划分解 / 依赖调度轴**）

> 取组：`last_run_at` 为 10-20 21:15 → 跨天重置 → `day_of_year % 3`（294%3=0）→ **A 组**。
> 与第四十二轮同组但**轴不同**（那轮是持久记忆/归属台账），关键词零重叠。
> 12 次 API 调用（其中 2 次是 OR 限定符失效后的重试）、**0 次 403**、本轮完整。
> `dsh plugin` 前两页 60 条里仅 1 条新面孔；**首次登记 3 行，🟢1 / ⛔2**；**0 条 NOASSERTION**；**2 个 A 类**。
> 骨架 `packages/dsh-radar-agent-teams`（A 类锁版 `@nanmicoder/dsh-agent-teams@0.1.25`）。

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `NanmiCoder/dsh-agent-teams`（npm `@nanmicoder/dsh-agent-teams@0.1.25`） | A 原生DSH | **MIT** ✅（GitHub + npm 一致） | 计划分解 / 执行推进 | **重复且可强化**（「规划」周计划 + 「今天」当日待办） | 🟢 | skeleton-created | 2026-10-21 | ★2299，push 2026-10-18，31 个版本，npm unpacked 3,418,813 B。**A 类三件套齐全**：根有 `cordis.patch.yml`（insert `id: agent-teams`）、`exports` 含 `.`/`./client`、21 项 `@deepseek-ai/dsh-*` peer。**强化点**：本仓计划是**扁平清单**（无 `dependsOn`/无中间状态/无执行者，顺序靠学生自排），上游是**依赖感知任务状态机**（依赖未完成不能认领、空闲成员自动认领、失败尝试可安全接管）——对「读讲义→刷题→订正」这类硬顺序课业是底层实质升级。**版本窗口**：上游推荐 Host `0.2.1-rc.2`；本仓 `runtime.lock.json` `preferredHostVersion=0.2.0-rc.2`，**在上游 peer 窗口内但未跑 `scripts/test-host.mjs`** → 只算「交集非空」，不算「已测」。**⚠ 最大未知（评审第一问）**：上游把 14 个 `agent_teams_*` 工具注册进**共享 `tools` 表**、并往**全局 system prompt** 插 usage；本仓是一整个工作台（「问一问」「笔记」共用），可能诱导模型在日常会话里无端组建团队 → **此条不解决则方案作废**。其余见骨架 TODO 3–9（面板可否不自动注册 / `memberProvider` 默认 `spawn` 需改最省 / 体积 3.26 MB） |
| `dsh-tauri/deepseek-harness-desktop` | B 其他JS（Tauri 桌面壳） | MIT ✅ | 无（换承载端） | 重复且无增益 | ⛔ | rejected | 2026-10-21 | ★3362，push 2026-10-20，207 fork，「8 MB 安装包 / 免环境」。本仓是 Web 工作台 + profile 形态，**换承载端不增强任何面板**，也不改变任何功能；且非插件包（无 mount 意图）→ 强化式集成三条第 ① 条即不成立 |
| `dataelement/dsh-desktop` | B 其他JS（桌面壳） | MIT ✅ | 无 | 重复且无增益 | ⛔ | rejected | 2026-10-21 | ★15878，push 2026-10-20。同上；与 `dsh-tauri` 二者择一足够，**本仓两者都不需要** |

### 2026-10-21 · 第四十四轮（C 组 · **复习链闭环 / 复习容量轴**）

> 取组：`last_run_at` 为今天 → 同日续跑。脚本报 `formula(stale-state)`→C，但其 `last_group` 解析失败
> 且**用了 UTC 日期**（自报「今天=10-20」），建议不可信；本轮轴从读码得出、落在 C 组功能域内，故取 **C**
> （偏离脚本一次，理由记于 `2026-10-21-r44.md` 抬头）。
> 11 次搜索（上限 10，1 次为 `stars:>` 归零后的放宽重试）→ **超限 1 次**、0 次 403、本轮完整。
> 命中约 9,800 条、高度重复 → **首次登记 2 行，🟡1 / 🔵1**（另有 3 条已登记项复核、5 条许可证外单列）。
> **0 个 🟢、0 个 A 类、未出骨架**——本轮结论是「先闭环再调度」（见报告的 R-1/R-2/R-3）。

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `femto-fsrs`（npm 包，**无 GitHub 仓**） | B 其他JS（npm） | **MIT** ✅（npm `license`；`repository: null`） | 复习调度 | **重复且无增益**（`ts-fsrs@5.4.2` 已在 `dsh-radar-fsrs-scheduler` 锁版） | 🟡 | proposed（**待复核**） | 2026-10-21 | `femto-fsrs@2.0.0`，**零依赖**，unpacked **18,076 B**（`ts-fsrs` 体积的零头），自称 FSRS 5 最小实现。**判 🟡 不判 🟢 的两条硬理由**：① 本仓已锁 `ts-fsrs`，同功能两套实现为仓规明令禁止（`quiz/src/index.js:26–28`）；② **无 GitHub 仓库** → 无 issue、无可见更新史，答不了「上游还在不在」。保留 🟡 的用途：若将来因**体积**要换浏览器侧调度，它是已核实许可的备选。⚠ **参数集与 FSRS 版本未比对**（是否与 `ts-fsrs 5.4.2` 默认权重等价，本轮**未验证**），报告不声称等价 |
| `kitschpatrol/yanki-obsidian` | B 其他JS（Obsidian 插件） | **MIT** ✅ | 笔记 → 复习卡 | **无关**（载体是 Anki，本仓无此对象） | 🔵 | proposed | 2026-10-21 | ★197，push 2026-10-16（活跃），topics `anki,flashcards,markdown,obsidian`。把 vault 里**纯 Markdown 写法的闪卡**同步进 Anki。**判 🔵**：其价值在「Markdown 能表达复习卡」这一格式约定，而约定绑死 Anki 侧解析器；本仓产出侧是「LLM 生成 → 质检 → 待审 → 采纳」（`quiz/generate.js`），**换载体等于换掉整个产出侧**，不满足强化式集成第 ① 条。只取其**语法设计参照**（`问题::答案` / `==挖空==`），**不摘代码** |
| `femto-fsrs` ↔ `open-spaced-repetition/ts-fsrs` | — | MIT / MIT | — | **同功能双实现** | ⛔（合并入上条） | — | 2026-10-21 | 本轮不再为 `ts-fsrs` 单开行（2026-10-14 已登记 🟢 并已出骨架）。此处记录**关系**：`femto-fsrs` 是它的小体积替代，二选一，**不得并存** |
| `open-spaced-repetition/fsrs.js`（2026-10-14 已判「不登记」） | B 其他JS | MIT | 复习调度 | 重复无增益 | ⛔ | 维持 | 2026-10-21 | 本轮复核：`latest` push **2024-04-10**，停在 FSRS 4 时代，仍在 `ts-fsrs` 之下 → 维持「不登记」 |
| `@open-spaced-repetition/binding@0.5.0` | B 其他JS（Node/WASI 绑定） | **MIT** ✅ | 复习调度（参数优化） | 与 `ts-fsrs` 同仓、**非独立能力** | 🔵 | proposed（仅备查） | 2026-10-21 | 本轮核实许可为 MIT，`optionalDependencies` 覆盖 **11 个平台**（含 `wasm32-wasi`）、`engines.node >= 20`。用途是 **FSRS Optimizer**（用个人作答史拟合参数），与本仓「学生单用户、样本 <3」现状不匹配 → 只备查。⚠ 「当前平台二进制是否真被 npm 装上」**未实测** |
| `ankitects/anki` / `andymatuschak/orbit` / `pieralukasz/true-recall` | 非 JS / B | **NOASSERTION** ⚠ | — | — | ⛔ | rejected | 2026-10-21 | ★32,148（Rust）/ ★1,837（TS）/ ★65。**许可证待人工核验，不采用、不摘代码**。`anki` 即便核出 MIT 也是 Rust 栈，不合 skill 的 JS 限定 |
| `koljapluemer/obsidian-the-queue` / `subconcept-labs/ulangi` / `h16nning/skola` / `debanjandhar12/logseq-anki-sync` | B | **`null`** ⛔ / **GPL-3.0** / **AGPL-3.0** / **AGPL-3.0** | 复习 | — | ⛔ | rejected | 2026-10-21 | 无许可证 1 条、强著佐权 3 条 → **全部只登记、不摘代码**。`skola`（AGPL，★55，本地优先 SRS PWA）形态最贴近「学生自用」，但许可不可用 |
| `ECuiDev/obsidian-quiz-generator`（2026-10-20 已登记 🔵） | B | MIT ✅ | 从笔记出闪卡 | 重复无增益 | 🔵 | 维持 | 2026-10-21 | 复核：★174，**push 2024-11-13 已停更近 2 年**，30 open issues → 维持 🔵，**不再重评** |
| `st3v3nmw/obsidian-spaced-repetition`（2026-10-15 已登记 🔵） | B | MIT ✅ | 复习 | 重复可强化 | 🔵 | 维持 | 2026-10-21 | 复核：★2,591，但 **356 open issues**，插件形态强耦合 Obsidian → 维持 🔵（只作线索） |
| `ctrlaltwill/LearnKit`（2026-10-15 已登记 🟡） | B | MIT ✅ | 复习 / 刷题 | 重复可强化 | 🟡 | 维持 | 2026-10-21 | 复核：★181，push 2026-10-17，仍在活跃。维持「只提取 image-occlusion 思路、不整包集成」 |
| `open-spaced-repetition/awesome-fsrs` | — | CC0-1.0 ✅ | — | **线索源** | 🔵 | proposed | 2026-10-21 | ★727，push 2026-10-20。FSRS 实现索引（含各语言绑定）→ 与 `awesome-dsh-plugin` 同类，作为**后续查绑定的入口**，不入包 |

#### 本轮无 🟢 的原因（写进登记表以免下轮重犯）

`dsh-zhiyun-quiz` 的复习链在**三处同时断开**：① `reviewQueue` 只按 `status` 过滤，**无 `due`、无排序字段**
（`store.js:501`，实测队列项无 `due`/`fsrsRating` 字段）；② `recordAttempt` **全仓零调用方**（`store.js:604` 仅定义）——
`workbench.js:627–630` 的 method 白名单里没有 `quiz-attempt`；③ `openQuizStore`（`workbench.js:376–379`）只 `loadItems`、
不喂 `attempts`，而 `quiz-generate`/`changeQuiz` 用 `store.snapshot()` **整份覆盖写回** → 实测「保存前 1 条 → 写回 0 条」，
随后 `masteryOf()` 报「数据不足（做过 0 题）」。**结论：先闭环（R-1/R-2，约 20 行、零新依赖），再接调度（R-3）。**

---

### 第四十五轮 · 2026-10-21 · A 组（检索口径统一轴）

> 搜索 10 次（`dsh plugin quiz/classroom/calendar/kanban/lecture/paper/reading/flashcard/mindmap/tutor`），
> 约 180 条命中 → **首次登记 8 行（🟡0 🔵5 ⛔3）**；另 3 条 `NOASSERTION` 待核、10 条无许可证、2 条 GPL。
> **零 🟢，未出 A 类骨架**（本轮 L2 出的是 B 类对照物 `dsh-radar-knowledge-fold`）。

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `MrElysium/dsh-md-quiz` | A 原生DSH | **MIT** ✅ | 复习 / 答题式阅读 | **重复且无增益** | ⛔ | rejected | 2026-10-21 | ★6，push 2026-08-18。5 阶段游戏化循环把任意 Markdown 变答题。本仓 `dsh-zhiyun-quiz` 有 `anchorFromMaterial` 源块锚点 + `sourceRevision` + 规则门禁 + 待审，**该插件无来源锚点、无质检链**，接入等于绕过质检。**npm `dsh-md-quiz` 404**（官方 registry 直查），不可锁版。两条独立理由 |
| `mrk-king/dsh-paper-reading` | A 原生DSH | **BSD-3-Clause** ✅ | 论文阅读 | **重复且无增益** | ⛔ | rejected | 2026-10-21 | ★0。pdf.js 阅读器 + 按论文记忆问答 + 预设门控。本仓 `dsh-zhiyun-paper` 已锁版 `@ggboy123/dsh-paper-reader@1.3.1` + `pdfjs-dist` → 同一件事的第二套实现。npm `@dsh-external/dsh-paper-reading` 404 |
| `Madao1210/dsh-deep-reading` | A 原生DSH | **MIT** ✅ | 精读 | **重复且无增益** | ⛔ | rejected | 2026-10-21 | ★3，push 2026-10-10。逐章理解书籍。与已 🟢 的 `PensiveFei/deep-read-summarize`（已出骨架 `dsh-radar-deep-read`，MapReduce + JSON Schema + 解析器层）同域同形态。npm `dsh-deep-reading` 404 |
| `hzxwonder-dsh-plugins/dsh-plugin-latex` | A 原生DSH | **MIT** ✅ | 论文写作 | **重复可强化（弱）** | 🔵 | proposed | 2026-10-21 | ★0，push 2026-09-27。**句级写作地图**是本仓没有的东西，但整体是「本地 LaTeX 编译 + Overleaf 同步」，本仓论文域为 iframe 承载、无编译链 → 接入等于新起管线。npm `dsh-plugin-latex` 404。**只作需求线索：句级写作地图值得自写** |
| `jianyuepei/dsh-session-mindmap` | A 原生DSH | **MIT** ✅ | 笔记 | **全新（弱）** | 🔵 | proposed | 2026-10-21 | ★0。会话 → 自包含交互式 HTML 思维导图。本仓「笔记」是 vault 节点结构（`dsh-zhiyun-vault` + `graph` RPC），导出物语义相反。npm `dsh-session-mindmap` 404 |
| `stuarthu/dsh-chrome` | A 原生DSH | **MIT** ✅ | 通用 | **无关（形态而非能力）** | 🔵 | proposed | 2026-10-21 | ★9。Chrome 侧栏嵌入完整 DSH Web UI + 页面读取 host 插件。**本轮唯一可锁版的 A 类**（`dsh-chrome@0.1.3`/MIT，registry 实测）→ 留作「A 类可锁版」正例 |
| `haoyanzhang123/dsh-plugin-control-your-schedule` | A 原生DSH | **MIT** ✅ | 日程 / 便签 | **重复可强化（弱）** | 🔵 | proposed | 2026-10-21 | ★3。便签 + 画布 + 日程 + 手写面板四合一。**画布与手写**本仓确无；但 ★3、单作者、HTML 为主、无 issue 史。npm 404 → 不上骨架 |
| `yihong89/dsh-teacher` | A 原生DSH | **MIT** ✅ | 苏格拉底辅导 | **重复可强化** | 🔵 | proposed | 2026-10-21 | ★3。「知识缺口追踪」与已 🟢 的 `lookatstudy`（BKT 掌握度）同义项 → 重复；保留线索仅因**苏格拉底引导的 prompt 设计**可借鉴。**不摘代码** |

**`NOASSERTION` 待人工核验（不采用）**：

| 仓库 | 备注 |
| --- | --- |
| `naodeng/dsh-qa` | ★31，push 2026-10-20，本轮 ★ 最高的新面孔（本地 QA Workbench，零依赖）。**许可证待核**，核前不使用 |
| `Trouvaille-xx/dsh-StardewValley-UI` | ★1，星露谷主题 UI 包。与本仓无关，但许可证不明 |
| `zhen-yang-cn/dsh-xmind-mindmap` | ★0，描述自称 **Proprietary**。XMind/Markdown 卡片 + 侧栏 `.xmind` 预览，形态对口但**闭源** → 只登记 |

**无许可证（`null`）⛔ 排除，不摘代码**：`miuzel/dsh-graph`(★24, TS 目标看板)、`callmesoul/deepseek-kanban-plugin`(★4, Vue)、`kouyichi/dsh-plugins`(★2, 自称 31 插件)、`ktao732084-arch/dsh-vibegap`、`ccjlovewsy/dsh-mindmap-live`、`mckenna0625/dsh-langgraph-paper-pipeline`、`gqallen931/paper-gogo-plugin`、`ZEVIN17/PaperViz-dsh`、`LLLin000/paperforge-dsh`、`puremapping/dsh-plugin-reading-pipeline`。

**GPL 红线 ⛔**：`ArisaYamatogi/dsh-lecture-copilot`（**GPL-3.0**，录音+翻译+OneNote 笔记，★4）；`alei37/dsh-cet6-tutor`（AGPL-3.0，2026-10-16 已 ⛔，本轮复现，维持）。

**token 统计族整体 ⛔（不再逐条登记）**：`Hou-DL/dsh-token-pulse`、`skkjkk/dsh-usage-dashboard`、`Fiennes4590/dsh-token-usage-calendar`、`greyhackintoch-dev/dsh-month-tokens`、`KIDLi1412/dsh-token-heatmap`、`xiyi123465/dsh-usage-calendar` —— 六个不同作者做同一件事（本地 token 用量日历/热力图），与本仓任何功能无交集 → **重复且无增益**，只留此一行。

#### 本轮无 🟢 的原因

① **可锁版率崩到 1/7**：8 条新 A 类候选里，官方 registry 直查只有 `dsh-chrome` 存在；
② **形态对口的三条（`dsh-md-quiz` / `dsh-paper-reading` / `dsh-deep-reading`）全部与已采纳候选同域**，
接进来就是第二套实现（仓规明令禁止同功能两套）；
③ 真正的新缺口（**句级写作地图**、**画布/手写**）都只出现在 ★0~★3、单作者、不可锁版的包里
→ **缺口是真的，但这些包接不进来**，应按「自写」而非「集成」处理。

#### 本轮最有价值的产出：C-1（不需要任何新库）

`dsh-zhiyun-quiz/src/quality.js:166` `normalizeForMatch`（全角折叠 + 小写 + 去空白）与
`dsh-zhiyun-knowledge/src/service.js:282` `fragment.text.includes(needle)`（裸 includes）**同仓两套口径**。
→ 修法：`service.js:282` 一行（`fold` 两次），或提为共享工具。**这是第四十二轮 R-1 的第二次独立复现，且落在用户可见的「知识」页检索上。**

#### 方法学修正

`npm view` 走的是腾讯镜像，可能滞后/缺包 → **锁版判定一律以 `https://registry.npmjs.org/<pkg>` 直查为准**。

### 第四十六轮 · 2026-10-21 · A 组（topic 精确检索轴）

> 搜索 8 次（`topic:deepseek-harness-plugin` 835 / `topic:cordis-plugin` 575 / `topic:dsh-plugin` 21197（⚠ 污染） /
> `topic:dsh-extension` 5 / `topic:dsh-ecosystem` 11 / `topic:dsh-desktop` 181 / 前两者的 `language:javascript` 479、`language:typescript` 281），
> 263 个唯一仓库 → **首次登记 190 行（🔵146 / ⚠待核17 / ⛔27，零 🟢 零 🟡）**。
> **零 🟢 → 按技能文档未出「可直接集成」骨架**；L2 出的是 B 类对照物 `dsh-radar-fence-normalize`。
> 自我纠正：`dream-num/dsh-univer-office` 初判「三门全过的新 A 类」，实查后**本章早已锁版接入并写进 profile** → 改判 ⛔（报告 §二 C-2）。
> 本轮把「桌面壳 / token 额度族 / IM 网关 / 趣味」四类噪声各归并成一行口径，逐条独立登记但不逐条读码（见报告 §七）。

| 仓库 | 类型 | 许可证 | 星/推送 | 分级 | 状态 | 理由（归并口径或单条理由） |
| --- | --- | --- | --- | --- | --- | --- |
| `reactive-resume/reactive-resume` | B 其他JS | MIT | ★44605 / 2026-10-20 | 🔵 | proposed | 与浙大/学生场景无明确交集；仅登记 |
| `volcengine/OpenViking` | B 其他JS | AGPL-3.0 | ★40453 / 2026-10-20 | ⛔ | rejected | AGPL-3.0 红线 —— 不摘码 |
| `esengine/DeepSeek-Reasonix` | B 其他JS | MIT | ★35882 / 2026-10-21 | 🔵 | proposed | 任务编排，与本仓「规划/今天」页同域但方向不同（见 §二 C-1） |
| `Tencent/WeKnora` | B 其他JS | NOASSERTION | ★34866 / 2026-10-20 | ⚠ 待核 | proposed | `NOASSERTION` —— 待人工核 LICENSE 文件，不采用、不摘码 |
| `freestylefly/awesome-gpt-image-2` | B 其他JS | MIT | ★34786 / 2026-10-14 | 🔵 | proposed | 与浙大/学生场景无明确交集；仅登记 |
| `anywhere-labs/dsh-desktop` | A 原生DSH | MIT | ★31997 / 2026-10-20 | 🔵 | proposed | **承载端**（Electron 壳，自身即 Cordis 插件 `dsh-plugin-desktop`，npm 可锁版但停在 2.0.0/2026-08-16，落后仓库 2.0.18）；与学生场景无关，见 §二 C-4 |
| `Molunerfinn/PicGo` | B 其他JS | MIT | ★27379 / 2026-10-20 | 🔵 | proposed | 与浙大/学生场景无明确交集；仅登记 |
| `titanwings/distilly` | B 其他JS | MIT | ★25835 / 2026-10-13 | 🔵 | proposed | 与浙大/学生场景无明确交集；仅登记 |
| `nocobase/nocobase` | B 其他JS | NOASSERTION | ★24644 / 2026-10-21 | ⚠ 待核 | proposed | `NOASSERTION` —— 待人工核 LICENSE 文件，不采用、不摘码 |
| `walkinglabs/learn-harness-engineering` | A 原生DSH | MIT | ★21033 / 2026-10-20 | 🔵 | proposed | 与浙大/学生场景无明确交集；仅登记 |
| `EverMind-AI/EverOS` | B 其他JS | Apache-2.0 | ★13537 / 2026-10-20 | 🔵 | proposed | 记忆层，与本仓 `dsh-zhiyun-me`/记忆页同域，待与已登记记忆簇合并评审 |
| `MemTensor/MemOS` | A 原生DSH | Apache-2.0 | ★11978 / 2026-10-20 | 🔵 | proposed | 记忆层，与本仓 `dsh-zhiyun-me`/记忆页同域，待与已登记记忆簇合并评审 |
| `Tencent/BrowserSkill` | B 其他JS | MIT | ★9287 / 2026-10-20 | 🔵 | proposed | 承载端（桌面/启动器/终端壳），非能力；本轮第 4 次确认该簇为 A 组噪声 |
| `anbeime/skill` | B 其他JS | **无** | ★8414 / 2026-10-20 | ⛔ | rejected | 无许可证 —— 只登记，不摘码 |
| `plastic-labs/honcho` | B 其他JS | AGPL-3.0 | ★7712 / 2026-10-20 | ⛔ | rejected | AGPL-3.0 红线 —— 不摘码 |
| `lingfengQAQ/webnovel-writer` | B 其他JS | GPL-3.0 | ★7578 / 2026-10-19 | ⛔ | rejected | GPL-3.0 红线 —— 不摘码 |
| `yjh051108/dsh-routing-suite` | A 原生DSH | MIT | ★6991 / 2026-09-18 | 🔵 | proposed | 承载端（桌面/启动器/终端壳），非能力；本轮第 4 次确认该簇为 A 组噪声 |
| `ZSeven-W/openpencil` | B 其他JS | MIT | ★6304 / 2026-10-20 | 🔵 | proposed | 与浙大/学生场景无明确交集；仅登记 |
| `Q00/ouroboros` | B 其他JS | MIT | ★6253 / 2026-10-20 | 🔵 | proposed | 与浙大/学生场景无明确交集；仅登记 |
| `superdesigndev/treg` | B 其他JS | NOASSERTION | ★5899 / 2026-10-20 | ⚠ 待核 | proposed | `NOASSERTION` —— 待人工核 LICENSE 文件，不采用、不摘码 |
| `iflytek/skillhub` | B 其他JS | Apache-2.0 | ★5251 / 2026-10-20 | 🔵 | proposed | 插件/Skill 市场，与本仓「插件」页同域；仅作线索 |
| `crafter-station/petdex` | A 原生DSH | MIT | ★4261 / 2026-10-10 | 🔵 | proposed | 趣味/角色扮演，与学生场景无关 |
| `QingYunA/answer-me-with-html` | B 其他JS | MIT | ★4104 / 2026-10-21 | 🔵 | proposed | 与浙大/学生场景无明确交集；仅登记 |
| `xiaobright/dsh-anchored-standard` | A 原生DSH | NOASSERTION | ★3744 / 2026-09-10 | ⚠ 待核 | proposed | `NOASSERTION` —— 待人工核 LICENSE 文件，不采用、不摘码 |
| `foryourhealth111-pixel/Vibe-Skills` | B 其他JS | Apache-2.0 | ★3736 / 2026-10-20 | ⛔ | rejected | **token/额度统计族**（第四十五轮 C-4 已整体 ⛔）或账号桥接，重复且无增益 |
| `strukto-ai/mirage` | B 其他JS | Apache-2.0 | ★3699 / 2026-10-20 | 🔵 | proposed | 与浙大/学生场景无明确交集；仅登记 |
| `agentscope-ai/ReMe` | B 其他JS | Apache-2.0 | ★3656 / 2026-10-19 | 🔵 | proposed | 记忆层，与本仓 `dsh-zhiyun-me`/记忆页同域，待与已登记记忆簇合并评审 |
| `T-Auto/dsh-ops` | A 原生DSH | NOASSERTION | ★3477 / 2026-10-20 | ⚠ 待核 | proposed | `NOASSERTION` —— 待人工核 LICENSE 文件，不采用、不摘码 |
| `edison7009/EchoBird` | B 其他JS | MIT | ★3385 / 2026-10-21 | 🔵 | proposed | 承载端（桌面/启动器/终端壳），非能力；本轮第 4 次确认该簇为 A 组噪声 |
| `chuspeeism/dashi-taskboard` | A 原生DSH | Apache-2.0 | ★3370 / 2026-10-16 | 🔵 | proposed | **任务面板**：★3370、2 万行 `AGENTS.md` 的 agent 派工规程。方向与本仓「规划」页**不同**（它是给 agent 派任务，不是给用户排作业），见 §二 C-1 |
| `sopaco/deepwiki-rs` | B 其他JS | MIT | ★3136 / 2026-09-14 | 🔵 | proposed | 与浙大/学生场景无明确交集；仅登记 |
| `shaobeichen/dsh-pocket` | A 原生DSH | GPL-2.0 | ★2021 / 2026-10-17 | ⛔ | rejected | GPL-2.0 红线 —— 不摘码 |
| `myYangyunfan/dsh_desktop` | A 原生DSH | MIT | ★719 / 2026-10-18 | 🔵 | proposed | 承载端（桌面/启动器/终端壳），非能力；本轮第 4 次确认该簇为 A 组噪声 |
| `KimGLee/Cambium` | B 其他JS | NOASSERTION | ★624 / 2026-09-12 | ⚠ 待核 | proposed | `NOASSERTION` —— 待人工核 LICENSE 文件，不采用、不摘码 |
| `dream-num/dsh-univer-office` | A 原生DSH | Apache-2.0 | ★574 / 2026-10-08 | ⛔ | rejected | **重复且无增益**：本仓 `packages/dsh-zhiyun-univer-office` 已锁版 `0.3.7` 接入并写进 profile（`6b09396`）。本行动因是「registry 无此名 → 误判为新候选」，见报告 §二 C-2 |
| `houyanchao/chatgpt-gemini-timeline` | B 其他JS | NOASSERTION | ★469 / 2026-09-27 | ⚠ 待核 | proposed | `NOASSERTION` —— 待人工核 LICENSE 文件，不采用、不摘码 |
| `xing-shuyin/pi-web-ui` | B 其他JS | MIT | ★322 / 2026-10-20 | 🔵 | proposed | 承载端（桌面/启动器/终端壳），非能力；本轮第 4 次确认该簇为 A 组噪声 |
| `Fanch-hui/codex-bridge` | A 原生DSH | Apache-2.0 | ★276 / 2026-10-19 | 🔵 | proposed | 与浙大/学生场景无明确交集；仅登记 |
| `MarcoG-h/DSH-Launcher` | A 原生DSH | **无** | ★269 / 2026-09-18 | ⛔ | rejected | 无许可证 —— 只登记，不摘码 |
| `Devin-AXIS/jev-dsh-decision` | A 原生DSH | **无** | ★258 / 2026-09-20 | ⛔ | rejected | 无许可证 —— 只登记，不摘码 |
| `Astro-Han/pawwork` | A 原生DSH | Apache-2.0 | ★203 / 2026-10-12 | 🔵 | proposed | 承载端（桌面/启动器/终端壳），非能力；本轮第 4 次确认该簇为 A 组噪声 |
| `taxueseek/argo` | B 其他JS | Apache-2.0 | ★203 / 2026-10-20 | 🔵 | proposed | 与浙大/学生场景无明确交集；仅登记 |
| `Anionex/dsh-turn-rewind` | A 原生DSH | BSD-3-Clause | ★136 / 2026-10-18 | 🔵 | proposed | 会话/工作区回退（BSD-3-Clause）；与本仓无对应面板，但与 `PerryLink/dsh-checkpoint-rewind` 同题，仅登记 |
| `sjh9714/dsh-win32` | A 原生DSH | MIT | ★133 / 2026-10-20 | 🔵 | proposed | 承载端（桌面/启动器/终端壳），非能力；本轮第 4 次确认该簇为 A 组噪声 |
| `WestFox-AwA/dsh-wish-specializer` | A 原生DSH | BSD-3-Clause | ★132 / 2026-10-20 | 🔵 | proposed | 与浙大/学生场景无明确交集；仅登记 |
| `fangqian616/consensus-pipeline` | B 其他JS | MIT | ★129 / 2026-10-10 | 🔵 | proposed | 任务编排，与本仓「规划/今天」页同域但方向不同（见 §二 C-1） |
| `BruzWJ/Liang-Saint-Slider` | A 原生DSH | MIT | ★93 / 2026-08-19 | 🔵 | proposed | 与浙大/学生场景无明确交集；仅登记 |
| `like-study1/Oh-My-DSH` | A 原生DSH | MIT | ★93 / 2026-10-20 | 🔵 | proposed | 与浙大/学生场景无明确交集；仅登记 |
| `linhut/gongwen-skill` | A 原生DSH | MIT | ★83 / 2026-10-01 | 🔵 | proposed | Office 文档能力，与本仓文档导入通路相关（见 §二 C-2） |
| `openma-ai/Martty` | A 原生DSH | MIT | ★80 / 2026-10-17 | 🔵 | proposed | 承载端（桌面/启动器/终端壳），非能力；本轮第 4 次确认该簇为 A 组噪声 |
| `WM-CODER/custom-first-control-prompt` | A 原生DSH | MIT | ★75 / 2026-09-01 | 🔵 | proposed | 与浙大/学生场景无明确交集；仅登记 |
| `Ebony-Vinyl/EAC-design-world` | A 原生DSH | AGPL-3.0 | ★71 / 2026-10-18 | ⛔ | rejected | AGPL-3.0 红线 —— 不摘码 |
| `Aa728848/dsh-chatgpt-subscription` | A 原生DSH | MIT | ★69 / 2026-10-20 | ⛔ | rejected | **token/额度统计族**（第四十五轮 C-4 已整体 ⛔）或账号桥接，重复且无增益 |
| `eleckoi/ElecKoi` | A 原生DSH | AGPL-3.0 | ★63 / 2026-10-17 | ⛔ | rejected | AGPL-3.0 红线 —— 不摘码 |
| `zaofan-make/dsh-qqbot` | A 原生DSH | MIT | ★61 / 2026-10-20 | 🔵 | proposed | IM 网关，学生场景无直接对应；仅作线索 |
| `keleus/deepseek-pet` | A 原生DSH | MIT | ★57 / 2026-10-16 | 🔵 | proposed | 趣味/角色扮演，与学生场景无关 |
| `LaplaceYoung/oh-my-dsh` | A 原生DSH | **无** | ★57 / 2026-08-15 | ⛔ | rejected | 无许可证 —— 只登记，不摘码 |
| `zhuiyueya/dsh-im-gateway` | A 原生DSH | MIT | ★53 / 2026-09-27 | 🔵 | proposed | IM 网关，学生场景无直接对应；仅作线索 |
| `houyanchao/dsh-timeline` | A 原生DSH | NOASSERTION | ★47 / 2026-08-20 | ⚠ 待核 | proposed | `NOASSERTION` —— 待人工核 LICENSE 文件，不采用、不摘码 |
| `openma-ai/deepseek-harness-acp` | A 原生DSH | NOASSERTION | ★45 / 2026-10-19 | ⚠ 待核 | proposed | `NOASSERTION` —— 待人工核 LICENSE 文件，不采用、不摘码 |
| `limuyang2/agent-team` | A 原生DSH | MIT | ★43 / 2026-08-26 | 🔵 | proposed | 与浙大/学生场景无明确交集；仅登记 |
| `EdgeTypE/dsh-better-deepseek` | A 原生DSH | **无** | ★37 / 2026-08-14 | ⛔ | rejected | 无许可证 —— 只登记，不摘码 |
| `kw78/dsh-office-tools` | A 原生DSH | MIT | ★34 / 2026-10-13 | 🔵 | proposed | Office 文档能力，与本仓文档导入通路相关（见 §二 C-2） |
| `ZRui-C/dsh-computer-use` | A 原生DSH | Apache-2.0 | ★33 / 2026-10-07 | 🔵 | proposed | 与浙大/学生场景无明确交集；仅登记 |
| `sikadi233-hub/minecraft-dev` | A 原生DSH | MIT | ★31 / 2026-10-19 | 🔵 | proposed | 与浙大/学生场景无明确交集；仅登记 |
| `omdsh-dev/dsh-advisor` | A 原生DSH | MIT | ★31 / 2026-10-20 | 🔵 | proposed | 与浙大/学生场景无明确交集；仅登记 |
| `Lzcdebear/better-dsh-session-deletetool` | A 原生DSH | MIT | ★31 / 2026-10-14 | 🔵 | proposed | 与浙大/学生场景无明确交集；仅登记 |
| `fengyungithub/dsh-short-video-studio` | A 原生DSH | Apache-2.0 | ★30 / 2026-10-20 | 🔵 | proposed | 与浙大/学生场景无明确交集；仅登记 |
| `GaganSD/pi-extensions` | A 原生DSH | MIT | ★28 / 2026-10-19 | 🔵 | proposed | 与浙大/学生场景无明确交集；仅登记 |
| `PerryLink/dsh-checkpoint-rewind` | A 原生DSH | Apache-2.0 | ★27 / 2026-10-19 | 🔵 | proposed | 插件/Skill 市场，与本仓「插件」页同域；仅作线索 |
| `sugarforever/dsh-lark` | A 原生DSH | MIT | ★26 / 2026-09-07 | 🔵 | proposed | IM 网关，学生场景无直接对应；仅作线索 |
| `czcdr/dsh-plugin-rea` | A 原生DSH | MIT | ★25 / 2026-10-20 | 🔵 | proposed | 与浙大/学生场景无明确交集；仅登记 |
| `rootkiller6788/dsh-launcher` | A 原生DSH | MIT | ★25 / 2026-09-16 | 🔵 | proposed | 承载端（桌面/启动器/终端壳），非能力；本轮第 4 次确认该簇为 A 组噪声 |
| `zaizaizhao/dsh-branchmark` | A 原生DSH | MIT | ★25 / 2026-10-08 | 🔵 | proposed | 任务编排，与本仓「规划/今天」页同域但方向不同（见 §二 C-1） |
| `cloveric/tarocub` | A 原生DSH | MIT | ★24 / 2026-10-17 | 🔵 | proposed | IM 网关，学生场景无直接对应；仅作线索 |
| `SpookySandwich/dsh-plugin-message-edit` | A 原生DSH | NOASSERTION | ★23 / 2026-10-05 | ⚠ 待核 | proposed | `NOASSERTION` —— 待人工核 LICENSE 文件，不采用、不摘码 |
| `AlliotTech/deepseek-harness-docker` | A 原生DSH | MIT | ★23 / 2026-10-16 | 🔵 | proposed | 与浙大/学生场景无明确交集；仅登记 |
| `tomowang/dsh-tui` | A 原生DSH | MIT | ★23 / 2026-10-17 | 🔵 | proposed | 承载端（桌面/启动器/终端壳），非能力；本轮第 4 次确认该簇为 A 组噪声 |
| `plyflai/dsh-ux-plus` | A 原生DSH | MIT | ★22 / 2026-10-20 | 🔵 | proposed | 与浙大/学生场景无明确交集；仅登记 |
| `MindLab-Research/dsh-generative-ui` | A 原生DSH | Apache-2.0 | ★22 / 2026-10-20 | 🔵 | proposed | 与浙大/学生场景无明确交集；仅登记 |
| `JustGenius-s/DSH-Desktop` | A 原生DSH | MIT | ★22 / 2026-10-11 | 🔵 | proposed | 承载端（桌面/启动器/终端壳），非能力；本轮第 4 次确认该簇为 A 组噪声 |
| `zangxx66/dsh-prompt-setting` | A 原生DSH | MIT | ★21 / 2026-10-17 | 🔵 | proposed | 与浙大/学生场景无明确交集；仅登记 |
| `datit309/supergraph` | B 其他JS | MIT | ★21 / 2026-10-17 | 🔵 | proposed | 与浙大/学生场景无明确交集；仅登记 |
| `xxxyz/DeepSeekHarness-MCP-Manager` | A 原生DSH | MIT | ★21 / 2026-10-20 | 🔵 | proposed | 承载端（桌面/启动器/终端壳），非能力；本轮第 4 次确认该簇为 A 组噪声 |
| `nullptr-DZF/dsh-academic-research-skills` | A 原生DSH | NOASSERTION | ★21 / 2026-08-27 | ⚠ 待核 | proposed | `NOASSERTION` —— 待人工核 LICENSE 文件，不采用、不摘码 |
| `ZK-Andy/dsh-continual-evolve` | A 原生DSH | MIT | ★21 / 2026-10-20 | 🔵 | proposed | 与浙大/学生场景无明确交集；仅登记 |
| `JunNanLYS/dsh-layered-memory` | A 原生DSH | MIT | ★20 / 2026-09-07 | 🔵 | proposed | 记忆层，与本仓 `dsh-zhiyun-me`/记忆页同域，待与已登记记忆簇合并评审 |
| `LiuJunheng/DeepSeekHarnessGreen` | A 原生DSH | Apache-2.0 | ★19 / 2026-10-17 | 🔵 | proposed | 承载端（桌面/启动器/终端壳），非能力；本轮第 4 次确认该簇为 A 组噪声 |
| `gulagala001/dsh-intelligent-ui` | A 原生DSH | MIT | ★19 / 2026-10-20 | 🔵 | proposed | 趣味/角色扮演，与学生场景无关 |
| `Lenonss/DSH_VsCodeMode` | A 原生DSH | MIT | ★19 / 2026-10-19 | 🔵 | proposed | 承载端（桌面/启动器/终端壳），非能力；本轮第 4 次确认该簇为 A 组噪声 |
| `WLV-ZEDD/dsh-chatgpt-web` | A 原生DSH | MIT | ★19 / 2026-10-18 | 🔵 | proposed | 与浙大/学生场景无明确交集；仅登记 |
| `v587d/capital-generation` | B 其他JS | MIT | ★18 / 2026-10-20 | 🔵 | proposed | 与浙大/学生场景无明确交集；仅登记 |
| `z953218350/dsh-history-tree` | A 原生DSH | MIT | ★17 / 2026-08-31 | 🔵 | proposed | 与浙大/学生场景无明确交集；仅登记 |
| `Z-6354/dsh-mobile-hanui` | A 原生DSH | MIT | ★17 / 2026-10-05 | 🔵 | proposed | 与浙大/学生场景无明确交集；仅登记 |
| `2861292267/DSH-Official-WorkBuddy-Credit-Proxy` | A 原生DSH | MIT | ★17 / 2026-10-19 | ⛔ | rejected | **token/额度统计族**（第四十五轮 C-4 已整体 ⛔）或账号桥接，重复且无增益 |
| `hyqibot/DeepSeek-Harness-Token-Free` | A 原生DSH | NOASSERTION | ★17 / 2026-08-24 | ⚠ 待核 | proposed | `NOASSERTION` —— 待人工核 LICENSE 文件，不采用、不摘码 |
| `wlj521/dsh-ui-tweaks` | A 原生DSH | MIT | ★17 / 2026-10-13 | 🔵 | proposed | 与浙大/学生场景无明确交集；仅登记 |
| `S3K926/dsh-selfwake` | A 原生DSH | MIT | ★16 / 2026-10-16 | 🔵 | proposed | 与浙大/学生场景无明确交集；仅登记 |
| `muyuanjin/dsh-ptc-plus` | A 原生DSH | MIT | ★16 / 2026-10-16 | 🔵 | proposed | 与浙大/学生场景无明确交集；仅登记 |
| `MengYuil/dsh-ponytail` | A 原生DSH | MIT | ★16 / 2026-10-17 | 🔵 | proposed | 与浙大/学生场景无明确交集；仅登记 |
| `baisama-cloud/dsh-galgame-generator` | A 原生DSH | MIT | ★16 / 2026-09-10 | 🔵 | proposed | 趣味/角色扮演，与学生场景无关 |
| `Clizo1209/dsh-playwright-browser` | A 原生DSH | MIT | ★16 / 2026-08-14 | 🔵 | proposed | 与浙大/学生场景无明确交集；仅登记 |
| `Kaalia0912/dsh-whale-musume-persona` | A 原生DSH | MIT | ★14 / 2026-08-20 | 🔵 | proposed | 趣味/角色扮演，与学生场景无关 |
| `panzeyu2013/dsh-chamber` | A 原生DSH | MIT | ★14 / 2026-10-19 | 🔵 | proposed | 承载端（桌面/启动器/终端壳），非能力；本轮第 4 次确认该簇为 A 组噪声 |
| `WNJXYK/dsh-codex-oauth` | A 原生DSH | MIT | ★14 / 2026-08-15 | ⛔ | rejected | **token/额度统计族**（第四十五轮 C-4 已整体 ⛔）或账号桥接，重复且无增益 |
| `yingjian666/dsh-zh-thinking` | A 原生DSH | MIT | ★14 / 2026-10-01 | 🔵 | proposed | 与浙大/学生场景无明确交集；仅登记 |
| `cuddly-guacamole/dsh-auto-approval-llm` | A 原生DSH | BSD-3-Clause | ★14 / 2026-10-18 | 🔵 | proposed | 与浙大/学生场景无明确交集；仅登记 |
| `S3K926/dsh-session-switch` | A 原生DSH | MIT | ★13 / 2026-10-01 | 🔵 | proposed | 记忆层，与本仓 `dsh-zhiyun-me`/记忆页同域，待与已登记记忆簇合并评审 |
| `MrMu666/dsh-lan-tool` | A 原生DSH | **无** | ★13 / 2026-10-18 | ⛔ | rejected | 无许可证 —— 只登记，不摘码 |
| `orrinzeng/dsh-cursor-subscription` | A 原生DSH | MIT | ★13 / 2026-09-30 | ⛔ | rejected | **token/额度统计族**（第四十五轮 C-4 已整体 ⛔）或账号桥接，重复且无增益 |
| `cv-superding/dsh-webin` | A 原生DSH | NOASSERTION | ★12 / 2026-10-16 | ⚠ 待核 | proposed | `NOASSERTION` —— 待人工核 LICENSE 文件，不采用、不摘码 |
| `z953218350/dsh-archive-manager` | A 原生DSH | MIT | ★12 / 2026-08-31 | 🔵 | proposed | 插件/Skill 市场，与本仓「插件」页同域；仅作线索 |
| `Innocent-children/TaskBelay` | B 其他JS | Apache-2.0 | ★12 / 2026-10-19 | 🔵 | proposed | 任务编排，与本仓「规划/今天」页同域但方向不同（见 §二 C-1） |
| `xiaoksio/dsh-solution-explorer` | A 原生DSH | MIT | ★12 / 2026-10-10 | 🔵 | proposed | 与浙大/学生场景无明确交集；仅登记 |
| `SpookySandwich/dsh-plugin-smooth-stream` | A 原生DSH | MIT | ★11 / 2026-09-29 | 🔵 | proposed | 与浙大/学生场景无明确交集；仅登记 |
| `SheltonLiu-N/nano-cordis` | A 原生DSH | MIT | ★11 / 2026-08-18 | 🔵 | proposed | 与浙大/学生场景无明确交集；仅登记 |
| `yxccai/dsh-desktop` | A 原生DSH | MIT | ★11 / 2026-08-21 | 🔵 | proposed | 承载端（桌面/启动器/终端壳），非能力；本轮第 4 次确认该簇为 A 组噪声 |
| `Minglink/dsh-stream-market` | A 原生DSH | MIT | ★11 / 2026-09-04 | 🔵 | proposed | 插件/Skill 市场，与本仓「插件」页同域；仅作线索 |
| `cryjkd/dsh-clawbot` | A 原生DSH | MIT | ★11 / 2026-09-05 | 🔵 | proposed | IM 网关，学生场景无直接对应；仅作线索 |
| `TryDing-T/dsh-Plugin--ChineseChess` | A 原生DSH | MIT | ★11 / 2026-09-09 | 🔵 | proposed | 趣味/角色扮演，与学生场景无关 |
| `xiaozhuyuqing/dsh-repeat-guard` | A 原生DSH | MIT | ★11 / 2026-10-02 | 🔵 | proposed | 与浙大/学生场景无明确交集；仅登记 |
| `xiaolinlin360/dsh-supabase` | A 原生DSH | MIT | ★10 / 2026-08-27 | 🔵 | proposed | 与浙大/学生场景无明确交集；仅登记 |
| `zxmqq1234/dsh-auto-retry` | A 原生DSH | MIT | ★10 / 2026-10-15 | 🔵 | proposed | IM 网关，学生场景无直接对应；仅作线索 |
| `jaibhasin/dsh-browser-agent` | A 原生DSH | MIT | ★10 / 2026-10-11 | 🔵 | proposed | 与浙大/学生场景无明确交集；仅登记 |
| `TH060419/gatherthread` | A 原生DSH | Apache-2.0 | ★10 / 2026-10-20 | 🔵 | proposed | 承载端（桌面/启动器/终端壳），非能力；本轮第 4 次确认该簇为 A 组噪声 |
| `HakureiMonika/dsh-browser-scope` | A 原生DSH | MIT | ★10 / 2026-09-28 | 🔵 | proposed | 与浙大/学生场景无明确交集；仅登记 |
| `yu-wenchao/deepseek-harness-desktop-Install` | A 原生DSH | MIT | ★9 / 2026-08-31 | 🔵 | proposed | 承载端（桌面/启动器/终端壳），非能力；本轮第 4 次确认该簇为 A 组噪声 |
| `dushaobindoudou/dsh-acp` | A 原生DSH | MIT | ★9 / 2026-10-14 | 🔵 | proposed | 与浙大/学生场景无明确交集；仅登记 |
| `walksls/dsh-degeneration-kit` | A 原生DSH | MIT | ★9 / 2026-10-18 | 🔵 | proposed | 与浙大/学生场景无明确交集；仅登记 |
| `bloodtmai-cmyk/dsh-harness-enterprise` | A 原生DSH | MIT | ★9 / 2026-10-16 | 🔵 | proposed | 与浙大/学生场景无明确交集；仅登记 |
| `Gru110110110/dsh-launcher` | A 原生DSH | NOASSERTION | ★9 / 2026-10-01 | ⚠ 待核 | proposed | `NOASSERTION` —— 待人工核 LICENSE 文件，不采用、不摘码 |
| `foolgry/dsh-desktop` | A 原生DSH | **无** | ★9 / 2026-09-22 | ⛔ | rejected | 无许可证 —— 只登记，不摘码 |
| `Zoria-Lind/dsh-behavior-enhancer` | A 原生DSH | MIT | ★9 / 2026-10-19 | 🔵 | proposed | 插件/Skill 市场，与本仓「插件」页同域；仅作线索 |
| `peterwangze/dsh-novel-writing` | A 原生DSH | **无** | ★8 / 2026-10-21 | ⛔ | rejected | 无许可证 —— 只登记，不摘码 |
| `bloodtmai-cmyk/dsh-ai-hub` | A 原生DSH | MIT | ★8 / 2026-10-16 | 🔵 | proposed | 与浙大/学生场景无明确交集；仅登记 |
| `civaapple-alt/mini-dsh` | A 原生DSH | MIT | ★8 / 2026-08-18 | 🔵 | proposed | 与浙大/学生场景无明确交集；仅登记 |
| `vdnight89/InfiniteDSH` | A 原生DSH | MIT | ★8 / 2026-08-18 | 🔵 | proposed | 与浙大/学生场景无明确交集；仅登记 |
| `haoranwang0921/dsh-session-cleaner` | A 原生DSH | Apache-2.0 | ★8 / 2026-09-05 | 🔵 | proposed | 与浙大/学生场景无明确交集；仅登记 |
| `EhsanShahbazii/DeepSeek-Orbit` | B 其他JS | MIT | ★8 / 2026-10-08 | 🔵 | proposed | Office 文档能力，与本仓文档导入通路相关（见 §二 C-2） |
| `zcx960/deepseek-desktop` | A 原生DSH | MIT | ★8 / 2026-09-18 | 🔵 | proposed | 承载端（桌面/启动器/终端壳），非能力；本轮第 4 次确认该簇为 A 组噪声 |
| `CSlawyer1985/dsh-desktop` | A 原生DSH | MIT | ★7 / 2026-08-20 | 🔵 | proposed | 承载端（桌面/启动器/终端壳），非能力；本轮第 4 次确认该簇为 A 组噪声 |
| `Lee-Hilex/dsh-mineru` | A 原生DSH | MIT | ★7 / 2026-09-27 | ⛔ | rejected | **token/额度统计族**（第四十五轮 C-4 已整体 ⛔）或账号桥接，重复且无增益 |
| `sixtysevenlf/dsh-opencode-go-monitor` | A 原生DSH | BSD-3-Clause | ★6 / 2026-09-18 | ⛔ | rejected | **token/额度统计族**（第四十五轮 C-4 已整体 ⛔）或账号桥接，重复且无增益 |
| `jasonrale/dsh-archive-manager` | A 原生DSH | MIT | ★6 / 2026-08-17 | 🔵 | proposed | 与浙大/学生场景无明确交集；仅登记 |
| `Mcd0LUO/dsh-guard-repeat-output` | A 原生DSH | MIT | ★6 / 2026-10-11 | 🔵 | proposed | 趣味/角色扮演，与学生场景无关 |
| `Loping151/dsh-vibeos` | A 原生DSH | NOASSERTION | ★6 / 2026-10-02 | ⚠ 待核 | proposed | `NOASSERTION` —— 待人工核 LICENSE 文件，不采用、不摘码 |
| `sasajun2345/dsh-minigame-plugin` | A 原生DSH | MIT | ★6 / 2026-08-16 | 🔵 | proposed | 趣味/角色扮演，与学生场景无关 |
| `ruler770525/dsh-anchored-flash` | A 原生DSH | NOASSERTION | ★6 / 2026-08-17 | ⚠ 待核 | proposed | `NOASSERTION` —— 待人工核 LICENSE 文件，不采用、不摘码 |
| `wkscc310/dsh-client-ui-cpa-quota` | A 原生DSH | MIT | ★6 / 2026-10-19 | ⛔ | rejected | **token/额度统计族**（第四十五轮 C-4 已整体 ⛔）或账号桥接，重复且无增益 |
| `baisama-cloud/dsh-custom-brand` | A 原生DSH | MIT | ★6 / 2026-10-13 | 🔵 | proposed | 与浙大/学生场景无明确交集；仅登记 |
| `Bernardxu123/dsh-mobile-gate` | A 原生DSH | MIT | ★6 / 2026-08-14 | 🔵 | proposed | IM 网关，学生场景无直接对应；仅作线索 |
| `Luaphes/dsh-web-attention-badge` | A 原生DSH | MIT | ★6 / 2026-09-09 | 🔵 | proposed | 与浙大/学生场景无明确交集；仅登记 |
| `G0K0U/kvmem-agent-16gb` | A 原生DSH | MIT | ★4 / 2026-09-25 | 🔵 | proposed | 承载端（桌面/启动器/终端壳），非能力；本轮第 4 次确认该簇为 A 组噪声 |
| `WTStarMark/dsh-myskin` | A 原生DSH | MIT | ★4 / 2026-10-06 | 🔵 | proposed | 与浙大/学生场景无明确交集；仅登记 |
| `RyanZeeee/dsh-chattree` | A 原生DSH | MIT | ★4 / 2026-09-13 | 🔵 | proposed | 与浙大/学生场景无明确交集；仅登记 |
| `iyam-x/iyam-dsh-desktop` | A 原生DSH | MIT | ★4 / 2026-09-28 | 🔵 | proposed | 承载端（桌面/启动器/终端壳），非能力；本轮第 4 次确认该簇为 A 组噪声 |
| `hnmrxz/deepseek-harness-desktop-HarmonyOS` | A 原生DSH | MIT | ★4 / 2026-09-21 | 🔵 | proposed | 承载端（桌面/启动器/终端壳），非能力；本轮第 4 次确认该簇为 A 组噪声 |
| `huyang218/dsh-desktop` | A 原生DSH | MIT | ★3 / 2026-08-26 | 🔵 | proposed | 承载端（桌面/启动器/终端壳），非能力；本轮第 4 次确认该簇为 A 组噪声 |
| `MIHassan3/DSH-Launcher` | A 原生DSH | MIT | ★3 / 2026-10-10 | 🔵 | proposed | 承载端（桌面/启动器/终端壳），非能力；本轮第 4 次确认该簇为 A 组噪声 |
| `gordan-code/dsh-jev-advisor` | A 原生DSH | MIT | ★3 / 2026-10-18 | 🔵 | proposed | 与浙大/学生场景无明确交集；仅登记 |
| `xingxingbk-git/dsh-deepseek-chat` | A 原生DSH | **无** | ★3 / 2026-10-17 | ⛔ | rejected | 无许可证 —— 只登记，不摘码 |
| `yu-wenchao/dsh-tool-lipsync` | A 原生DSH | MIT | ★3 / 2026-09-05 | 🔵 | proposed | 与浙大/学生场景无明确交集；仅登记 |
| `ling-long-ling/dsh-novel-writer` | A 原生DSH | MIT | ★3 / 2026-10-20 | 🔵 | proposed | 承载端（桌面/启动器/终端壳），非能力；本轮第 4 次确认该簇为 A 组噪声 |
| `MoonlitDropOfBlood/DSH-Desktop` | A 原生DSH | MIT | ★3 / 2026-10-20 | 🔵 | proposed | 承载端（桌面/启动器/终端壳），非能力；本轮第 4 次确认该簇为 A 组噪声 |
| `EternalNight996/dsh-desktop` | A 原生DSH | MIT | ★3 / 2026-09-28 | 🔵 | proposed | 承载端（桌面/启动器/终端壳），非能力；本轮第 4 次确认该簇为 A 组噪声 |
| `nguyenduclong-ict/dsh-session-progress` | A 原生DSH | **无** | ★3 / 2026-10-01 | ⛔ | rejected | 无许可证 —— 只登记，不摘码 |
| `zwqjoy/AgentCabin` | A 原生DSH | Apache-2.0 | ★3 / 2026-10-06 | 🔵 | proposed | 承载端（桌面/启动器/终端壳），非能力；本轮第 4 次确认该簇为 A 组噪声 |
| `oslook/awesome-dsh-plugins` | A 原生DSH | MIT | ★3 / 2026-08-16 | 🔵 | proposed | 与浙大/学生场景无明确交集；仅登记 |
| `LLLike27/One-Time-Link` | B 其他JS | **无** | ★2 / 2026-01-03 | ⛔ | rejected | 无许可证 —— 只登记，不摘码 |
| `m2lan/dsh-desktop` | A 原生DSH | MIT | ★2 / 2026-10-20 | 🔵 | proposed | 承载端（桌面/启动器/终端壳），非能力；本轮第 4 次确认该簇为 A 组噪声 |
| `clclyzybzjsq/dsh-btw` | A 原生DSH | MIT | ★2 / 2026-09-06 | 🔵 | proposed | 与浙大/学生场景无明确交集；仅登记 |
| `qingtan-labs/deepseek-harness-macos` | A 原生DSH | MIT | ★2 / 2026-10-04 | 🔵 | proposed | 与浙大/学生场景无明确交集；仅登记 |
| `988hj7tczd-oss/harness-desktop` | A 原生DSH | MIT | ★2 / 2026-08-31 | 🔵 | proposed | 承载端（桌面/启动器/终端壳），非能力；本轮第 4 次确认该簇为 A 组噪声 |
| `jiuge2467/DSH-Desktop` | A 原生DSH | MIT | ★2 / 2026-08-19 | 🔵 | proposed | 承载端（桌面/启动器/终端壳），非能力；本轮第 4 次确认该簇为 A 组噪声 |
| `TinyPandaGame/SpecsRelay-DSH` | A 原生DSH | MIT | ★2 / 2026-09-25 | 🔵 | proposed | 承载端（桌面/启动器/终端壳），非能力；本轮第 4 次确认该簇为 A 组噪声 |
| `twenty-3rd/dsh-skill-switch` | A 原生DSH | MIT | ★2 / 2026-10-07 | 🔵 | proposed | 与浙大/学生场景无明确交集；仅登记 |
| `toyvfish/dsh-model-seat` | A 原生DSH | MIT | ★2 / 2026-10-11 | 🔵 | proposed | 与浙大/学生场景无明确交集；仅登记 |
| `LBurny/deepseek-harness-desktop-releases` | A 原生DSH | MIT | ★2 / 2026-10-02 | 🔵 | proposed | 承载端（桌面/启动器/终端壳），非能力；本轮第 4 次确认该簇为 A 组噪声 |
| `honghuachen/deepseekharness-desktop` | A 原生DSH | MIT | ★2 / 2026-10-20 | 🔵 | proposed | 承载端（桌面/启动器/终端壳），非能力；本轮第 4 次确认该簇为 A 组噪声 |
| `kirbylynx/deepshell-agent` | A 原生DSH | MIT | ★2 / 2026-09-28 | 🔵 | proposed | 承载端（桌面/启动器/终端壳），非能力；本轮第 4 次确认该簇为 A 组噪声 |
| `canadaeee/dsh-weixin` | A 原生DSH | MIT | ★2 / 2026-08-19 | 🔵 | proposed | IM 网关，学生场景无直接对应；仅作线索 |
| `Sutera-Diffusus/dsh-statusbar` | A 原生DSH | MIT | ★1 / 2026-08-16 | ⛔ | rejected | **token/额度统计族**（第四十五轮 C-4 已整体 ⛔）或账号桥接，重复且无增益 |
| `jhckevin/dsh-request-privacy` | A 原生DSH | MIT | ★1 / 2026-09-05 | 🔵 | proposed | 承载端（桌面/启动器/终端壳），非能力；本轮第 4 次确认该簇为 A 组噪声 |
| `ysyyhhh/agent-ecosystem-observatory` | A 原生DSH | MIT | ★0 / 2026-09-11 | 🔵 | proposed | 与浙大/学生场景无明确交集；仅登记 |
| `zielinski2880/argo` | B 其他JS | NOASSERTION | ★0 / 2026-10-17 | ⚠ 待核 | proposed | `NOASSERTION` —— 待人工核 LICENSE 文件，不采用、不摘码 |
| `canadaeee/dsh-feishu` | A 原生DSH | MIT | ★0 / 2026-08-19 | 🔵 | proposed | IM 网关，学生场景无直接对应；仅作线索 |
| `shine-yu-student/dsh-calm` | A 原生DSH | MIT | ★0 / 2026-08-14 | 🔵 | proposed | 与浙大/学生场景无明确交集；仅登记 |
| `ccr-wer/dsh-dolphin-security` | A 原生DSH | MIT | ★0 / 2026-10-19 | 🔵 | proposed | 与浙大/学生场景无明确交集；仅登记 |
| `Minglink/dsh-community` | A 原生DSH | MIT | ★0 / 2026-10-18 | 🔵 | proposed | 插件/Skill 市场，与本仓「插件」页同域；仅作线索 |
| `chenzhi-clude/dsh-hooks-pack` | A 原生DSH | MIT | ★0 / 2026-08-25 | 🔵 | proposed | 与浙大/学生场景无明确交集；仅登记 |

**本轮 `NOASSERTION` 共 17 条、无许可证 11 条、AGPL/GPL 6 条 —— 均按「只登记、不采用、不摘码」处理。**

### 2026-10-21 · 第四十七轮（B 组 · **zdbk 选课增强轴**）

> 9 次搜索，0 次 403。`zju` / `zju course` / `cc98` / `campus app` / `zju language:typescript`
> 五大轴**连续第 3 轮零增量**；净增量仅来自窄功能词 `zju zdbk`（total 4）。详见 `2026-10-21-r47.md`。

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `0x000005/better-zdbk` | B 其他JS | **MIT** ✅ | 选课 / 课表 | **重复且可强化**（今天页课表行的地点语义） | 🟡 | proposed | 2026-10-21 | ★3。单文件油猴脚本（661 KB，`@version 1.2.1`，`@match zdbk.zju.edu.cn/jwglxt/xsxk*`），**建仓与唯一一次 push 同日 2026-09-15**，36 天无动。主功能是整站 UI 改写，**只取「地点字符串 → 校区 + 校区别名」一层**（`isCampusMismatch` + `campusAliases{紫金港:[银泉]}`）。⚠ 别名仅 1 条，对 `东1/西2/段1/蒙民伟楼` 等不含校区名的地点会**系统性误报**，不可照抄。已出骨架 `dsh-radar-campus-zone` |

**本轮 `NOASSERTION` 0 条、无许可证 2 条（`PMUGO50/ZJUGPA`、`shenluyao/ZJU_zdbk_plan`，后者已在册）、GPL 族 4 条（均已在册）**
—— 均按「只登记、不采用、不摘码」处理。课程资料族与 `campus app` 噪声簇按族处理，不逐条登记。

## 2026-10-22 · B 组（第四十八轮 · 教务服务代号窄词轴）

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `geniucker-dev/zju-learnpilot` | ⛔ 非 JS 栈（Python Skill，`uv run`） | **MIT** ✅ | 智云课堂 / 回放 / 讲师义 | **重复且可强化**（栈不符，不出骨架） | 🔵 | proposed | 2026-10-22 | ★1，建仓 2026-10-04、push 2026-10-20。单文件 `scripts/zju.py`（212 KB）+ `SKILL.md` + 14 个 pytest。**做的是本仓没有的反向链路**：「知识点 → 转写起止时间」「任意 `--at t` 回查窗口内转写 + PPT 候选页 + 音视频分段」「任意时刻取录播真实帧」。谱系：`PeiPei233/zju-learning-assistant`（★532，MIT，Rust）的 Python 重写，**非 JS 包装**；npm `zju` 仅 11 包无一相关（已实查）。只作**设计参考**（`ppt.events` 的 确定/相邻候选/无时间 三分法），**不摘码**。同时暴露本仓缺陷 S-1/S-2/S-3，见当日报告 §3.3 |

**本轮 `NOASSERTION` 0 条**；无许可证 4 条、GPL 族 1 条、WTFPL 1 条 —— **全部已在册**，按「只登记、不采用」处理。

## 2026-10-22 · C 组（第四十九轮 · 知识点归因底层轴）

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `RudrenduPaul/MasteryTrace`（npm `masterytrace-cli`） | B 其他JS（纯库） | **MIT** ✅ | 刷题 → 薄弱点定位 | **重复且可强化** | 🟢 | proposed | 2026-10-22 | ★0，建仓 2026-07-15、push 2026-10-20，npm `0.1.3`（2026-09-25）。**BKT（pInit/pTransit/pSlip/pGuess + 网格拟合）+ 2PL IRT**，TS 源 + 独立 Python 移植。实测 3 次「忘了」→ 后验 0.077→0.064→0.062。`npm i masterytrace-cli@0.1.3` 实测 3 包装好、12 个具名导出。⚠ 依赖 `zod@^4.6.5`（未压缩约 8.1 MB）；★0 单点维护；事件 schema 是「一条事件一个技能」，**一题多点须拆事件**。已出骨架 `dsh-radar-mastery-bkt`（TODO-0 阻塞：`pointIds` 尚未落到题上） |
| `geekie/irt-js`（npm `irt-js`） | B 其他JS（纯库） | **MIT** ✅ | 刷题 → 能力估计 | 重复可强化（**不推荐**） | 🔵 | proposed | 2026-10-22 | ★16，**push 2019-07-15**，npm `0.2.0` 发布于 **2017-09-15**。只导出 `estimateAbilityEAP` / `itemResponseFunction` / `information`，**不含题目参数估计**（`zeta` 要调用方给）→ 本仓每题作答 1–3 次，估不出参数，等于不可用。零依赖、ES5 CJS 是它唯一的优点 |
| `laser-institute/knowledge-tracing` | B 其他JS | **MIT** ✅ | 知识追踪 | 重复可强化 | 🔵 | proposed | 2026-10-22 | ★3，push 2026-05-22，但**仓库 107 MB**（数据/论文产物），无 npm 发版 → **不可锁版**，仅作算法线索 |
| `SottoFM/learning-model` | B 其他JS | **MIT** ✅ | 掌握度 + 练习优先级 | 重复可强化 | 🔵 | proposed | 2026-10-22 | ★0，2026 新建。接口比 MasteryTrace 更贴本仓（贝叶斯掌握度 + 练习优先），但**无发版、仓库小、无测试痕迹** → 只作备选线索 |
| `pieralukasz/true-recall` | B 其他JS | **`NOASSERTION`** ⚠ | 复习（Obsidian 插件） | 重复无增益 | ⚠ | rejected | 2026-10-22 | ★65，FSRS v6 + AI 出卡。**许可证待人工核验，不采用、不摘码** |
| `amangupta9560/SUNSTONE-ARENA` / `muhanedalhilal/Massar` / `jas212-on/adaptive-learning-agent` | B | `null` / `null` / **`NOASSERTION`** ⛔ | — | — | ⛔ | rejected | 2026-10-22 | `bkt knowledge tracing language:javascript` 的全部 3 条结果，★≤1、全部无可用许可证 |
| `quiz analytics dashboard language:typescript` 簇（26 条无许可证 + 2 条 MIT 且互为镜像） | B | 多数 `null` ⛔ | — | — | ⛔ | rejected | 2026-10-22 | 全部是脚手架 / demo / 营销漏斗，**0 条相关**。`krishyadav90/QuiziFy` 与 `marlito0226/Quizfy` 是同一份代码的镜像 |
| `dfsp-spirit/catjs-irt` | B | **GPL-3.0** ⛔ | 自适应测验 | — | ⛔ | rejected | 2026-10-22 | ★1。CAT 的 JS 实现，强著佐权 → 只登记、不摘码 |
| `jilljenn/ktm` / `bigdata-ustc/EduKTM` / `thosgt/kt-algos` / `seewoo5/KT` / `THUwangcy/HawkesKT` 等 10 条 | — | MIT / Apache-2.0 | — | — | ⛔ | rejected | 2026-10-22 | **全部 Python / Jupyter**，栈不符（`kt knowledge tracing` ★ 前 10 无一 JS） |

**本轮 `NOASSERTION` 1 条待核**（`true-recall`）；无许可证 / `null` 约 31 条；GPL 1 条 —— 全部**只登记、不采用、不摘码**。

> **读码结论（非候选，但比候选重要）**：
> ① **撤回第四十四轮 R-2** —— 当前 `workbench.js:375-380` 的 `openQuizStore` **确实** `loadAttempts`，
> 按原样复刻实跑「落库 3 条 → 再采纳一题」仍为 3 条；该段自 `a66bcda`（2026-10-11）起未变。
> 当时是只跑 `store` 层「`loadItems`→`snapshot`」推演得出，漏了那行。
> ② `attributeByPoint` / `masteryOf` / `masteryByPoint`（`store.js:632/678/701`）**全仓零调用、零测试**；
> `pointIds` **到不了题上**（`makeItem` 不收、`itemToJson` 不序列化、`quizMaterials` 不填）
> → 归因与掌握度在真实数据上**恒为空**。
> ③ `byId(a.quizId) === null` 时 `continue`，题被删后作答仍在却**静默归零**
> （实测 `masteryLabel` = `数据不足（做过 0 题，少于 3 题）`）→ 与「不许静默失败」冲突，
> 修法是一条 `unattributed: N` 字段。**三条都不需要新依赖；建议先补环，再接 BKT。**

## 2026-10-22 · A 组（第五十轮 · **跨节深链轴**）

> 本轮 0 个 🟢。核心结论写在报告 §2：**「笔记里的跨节链接跳不过去」是写进 README 的显式设计，不是断环**，
> 且照它跳会 `selectLesson` 清空 `state.content` → 掐断播放。因此本簇**一条 🔴 都不给**。

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `FuWenLianggit/dsh-session-link` | A 原生DSH | **MIT** ✅ | — | **无关**（对话会话深链，不涉课程节/页码/时间轴） | 🔵 | proposed | 2026-10-22 | ★1，push 2026-08-15，8 KB。npm `dsh-session-link` ✅ 但最新为 **`0.2.5`（10 版）**，仓库 `package.json` 写 `0.1.0` → **声明与发布不一致，锁版须以 npm 为准** |
| `hd25071/dsh-plugin-conversation-toolkit` | A 原生DSH | **MIT** ✅ | — | **无关**（复制对话为 Markdown / 复制对话深链） | 🔵 | proposed | 2026-10-22 | ★0，push 2026-10-11。npm **404 不可锁版** → 评审若要只能 `file:` 本地挂载 |
| `ZhijiangTang/dsh-dead-links` | A 原生DSH | **MIT** ✅ | 文档维护 | **看似相关、实则不同义**：只扫 `https?://`（`index.js:20` HEAD→GET），不解析 `zy://` 锚点 | 🔵 | proposed | 2026-10-22 | ★0，push 2026-08-16，12 KB，零依赖。npm `dsh-dead-links@0.1.1` ✅ 可锁版。**本仓锚点校验已有 `parseZySectionUri():197-240` 返回 `BAD_SECTION_LINK`，缺的是消费方** |
| `gxpppp/dsh-obsidian` | A 原生DSH | MIT ✅（**但包名冒用官方 scope**） | 笔记桥 | **重复无增益**（本仓 `parse/links.js` 的 8 条 wikilink 语义已钉测试，比它完整） | ⛔ | rejected | 2026-10-22 | ★5，push 2026-08-31。包名 `@deepseek-ai/dsh-client-ui-obsidian`，**官方 registry 404** → 无人能证明 scope 归属。**冒用 scope 首筛第二次命中**（第一次为第四十五轮 `OoWJZZoO/dsh-read-image`） |
| `iamzcr/dsh-obsidian-assistant` | A 原生DSH | **MIT** ✅ | 笔记检索 / 反链 / 图谱 | **重复无增益**：12 个工具全是"读写本地 vault"，**没有本仓缺的那一环** | ⛔ | rejected | 2026-10-22 | ★5，push 2026-08-17。需 Obsidian Local REST API 才有一半能力；本仓笔记域是纯存储 + 已实现的图算法 |
| `Lion-1209/wiki-web` | B 其他JS | **MIT** ✅ | — | 重复无增益（自托管 wiki 站） | ⛔ | rejected | 2026-10-22 | ★0，push 2026-09-17，64 KB，单 `server.js`。与本仓工作台无接缝 |
| `wuenna/dsh-obsidian-bridge` | A 原生DSH（名不符实） | **无许可证** ⛔ | — | 只登记，不采用、不摘码 | ⛔ | rejected | 2026-10-22 | ★0，push 2026-09-23。**无 `LICENSE` 文件**；`package.json` 无 `dsh` 字段、npm 404 → **根本不是可挂载的 Cordis 包** |
| `yh4922/dsh-workspace` | A 原生DSH | **`null`** ⛔ | 远程工作区 | 无关（本仓单机单人） | ⛔ | rejected | 2026-10-22 | ★10，push 2026-10-21，1.5 MB。**仓库无 `LICENSE`，API `license: null`**；`package.json` 自称 MIT **不采信**（发布声明 ≠ 仓库许可）。npm `@yh4922/dsh-workspace@0.12.3` 存在但不采用 |
| `AKS1st/dock-markdown` | A 原生DSH | **MIT** ✅ | Markdown 查看 | **重复无增益**：依赖 `dock` / `dock-files` 两个**本仓没有**的宿主服务 → 挂上不工作 | ⛔ | rejected | 2026-10-22 | ★3，push 2026-09-11，501 KB。npm `dock-markdown@0.1.2` 可锁版，但依赖面不满足 |
| `james-yao-xj/dsh-plugin-handout` | A 原生DSH | **MIT** ✅ | 讲义共读 | **重复无增益**（与已 🟡 的 `dsh-zotero`、已登记的 `dsh-paper` 同域） | ⛔ | rejected | 2026-10-22 | ★2，push 2026-10-07 |
| `henryxiao709/dsh-pdf` | A 原生DSH | **MIT** ✅ | PDF 转文本 | **重复无增益**（`dsh-pdf-reader` / `dsh-document-reader` / `dsh-tool-pdf` 之后第 4 家） | ⛔ | rejected | 2026-10-22 | ★2，push 2026-08-16。`pdfjs-dist` + OCR，与已登记三家同域 |
| `elegantythos/exam-paper-plugin` | A 原生DSH | **MIT** ✅ | 试卷生成 | 全新（试卷排版）但与本仓「刷题」页无接缝 | 🔵 | proposed | 2026-10-22 | ★1，push 2026-08-19。**Python** → 栈不符，不出骨架 |
| `wly8691-jpg/knowlp-rag` | A 原生DSH | **MIT** ✅ | 笔记 RAG | 重复无增益 | 🔵 | proposed | 2026-10-22 | ★3，push 2026-10-06。**Python** 主体，只记线索 |
| `NoLeakMCP`（`ishamishra0408`） | — | **`NOASSERTION`** ⚠ | — | 无关 | ⚠ | rejected | 2026-10-22 | ★1。**许可证待人工核验，不采用、不摘码** |
| `jackycra/dsh-dead-links` | — | — | — | — | — | rejected | 2026-10-22 | **仓库不存在**：检索结果里出现，但 `GET /repos/jackycra/dsh-dead-links` 返回 404（已删 / 改名）。仅记录，不登记为候选 |

**本轮 `NOASSERTION` 1 条待核**（`NoLeakMCP`）；**无许可证 2 条**（`wuenna/dsh-obsidian-bridge`、`yh4922/dsh-workspace`）；
**仓库不存在 1 条**（`jackycra/dsh-dead-links`）—— 全部**只登记、不采用、不摘码**。

**npm 可锁版核实（官方 registry 直查）**：8 个包名 **4 `✅` / 4 `❌`**（`dsh-dead-links@0.1.1`、
`dsh-session-link@0.2.5`、`dock-markdown@0.1.2`、`@yh4922/dsh-workspace@0.12.3` 存在；
`@deepseek-ai/dsh-client-ui-obsidian` **冒用 scope**、`dsh-plugin-conversation-toolkit`、`dsh-link-plugin`、
`dsh-obsidian-bridge` 全 404）→ **可锁版率 50%，与第四十五轮 1/7 同量级，建议列为常规核查项。**

> **读码结论（非候选，但比候选重要）**：
> ① **本轮推翻了一个假设**：`note-links.js:30` 的 `other-section` 分支看似"漏了一个 case"，
> 但 `page-study/README.md:14` 明写「另一节的链接留在原地并说明跳不过去」，`tests/study.test.mjs:242` 有断言 ——
> **这是设计决定**。按它跳过去会触发 `selectLesson` 清空 13 个字段（含 `content`），
> 而视频栏读的正是 `state.content` → **播放中的视频被掐断**。
> ② 能力其实**在**（`model.js:350-363` 的 `loadRecent` 已有 `loadCourse → selectLesson` 跨课载入先例），
> **入口不在**（`shell/client.jsx:48` 的 `navigate(id)` 不收参数；全仓页面侧无 `URLSearchParams` 消费），
> 而**设计上又不希望它发生** → 三者叠加，结论是「**缺口真实、但不该用集成解决**」，若要做需先开壳的入口参数（旁路画中画）。
> ③ `parseZySectionUri()` 已能报 `BAD_SECTION_LINK`，**缺的是消费方** —— 与第四十九轮"能力已有、出口没有"同一形状，
> 第三/四十九轮结论第三次复现：**本仓的缺口多数是接线问题，不是依赖问题。**
> ④ `gxpppp/dsh-obsidian` 代表 **A 类新常态**：形态对、许可证对，但**包名冒用官方 scope**（npm 404）。
> 建议把「`name` 是否以 `@deepseek-ai/` 开头且 npm 404」列为 A 类**硬性首筛**（已两次独立命中）。
> ⑤ `yh4922/dsh-workspace` 暴露**许可证判定的一个灰区**：仓库无 `LICENSE`、API `license: null`，但 `package.json` 写 MIT。
> 本轮按「以仓库为准」判 ⛔ —— **建议把这条写进硬边界，避免下一轮误判。**

## 2026-10-22 · 第五十一轮（检索域派生 · 「近似 / 容错」轴）

> 关键词（**7 次**，0 次 403，本轮完整；`rotation-state.md` 显示今日 ABC 三组均已跑过 → 走派生轴）：
> `fuzzy search javascript in:name`(2)、`fuzzy match javascript in:name`(**0**)、
> `fuzzy search language:javascript stars:>50`(23)、`typo tolerant search language:javascript`(20)、
> `fuse.js alternative`(**0**)；另 2 次纯元数据核实（GitHub `/repos` ×3、npm registry ×3）。
> **73 条命中 → 首次登记 5 行（其中 1 行是簇）+ 1 行本轮结论**；**🟢1 🔵3 ⛔2 簇**；
> **0 条 `NOASSERTION`、0 条无许可证、0 条 copyleft**。
> **本轮出骨架** `packages/dsh-radar-search-fuzzy`（B 类 · 锁版 `fuse.js@7.5.0`）。
> 起点仍是 `layered-search.js` 第 ⑥ 条自述「字面、不切词、不算相关度」—— 但这次补的是**第四条轴**：
> 前三条（`search-rank` 排序 / `search-segment` 切词 / `pinyin-match` 读音）都不覆盖「**打错一个字**」。

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `krisk/Fuse`（npm `fuse.js@7.5.0`） | **B 其他JS（纯库）** | **Apache-2.0** ✅ | 学习页检索容错 | **重复可强化**（`layered-search.js` 的 `findIn` 判据层） | 🟢 | proposed | 2026-10-22 | ★20,506，push 2026-08-09；npm `7.5.0`（2026-07-13），`dependencies: {}` 零传递依赖，unpacked 417,199 B（**进 bundle 体积未实测**）。能力：bitap 近似匹配 + 回命中区间（**闭区间**）。**判据①②③全成立**：同一检索框 / 同域不同问题（有没有 vs 打错还算不算）/ 新增容错与区间。**实测差分**（8 条语料）：`付里叶` 0→2、`中植定理` 0→1、`离散傅里叶` 0→2；`傅里叶`/`fourier`/`中值定理` 零回归；`量子力学`等 6 条无关词全 0。⚠ **三坑**：R1 命中集合须 ⊇ 旧实现（字面 `indexOf` 不能删）；R2 `minMatchCharLength` **不能固定**（=1 时单字「的」命中 5 条噪声，=2 时「傅利叶」漏掉 → 必须严格→放宽分层扫描）；R3 `matches[].indices` **不保证存在**（多文档实例实测 `undefined`）。⚠ 版本事实：7.5.0 **无** `dist/fuse.min.js`（404），只有 `fuse.mjs`/`fuse.basic.min.mjs`；**只能用 basic 构建**（完整构建的 extended search 会引入 `^ ! ' |` 新语法＝改档位）。⚠ **与 `dsh-radar-pinyin-match` 改同一行 `findIn`** → 须合并裁决，见骨架 README |
| `farzher/fuzzysort`（npm `4.0.2`） | B 其他JS（纯库） | MIT ✅ | 学习页检索 | 重复可强化，**正交不足** | 🔵 | proposed | 2026-10-22 | ★4,356，push 2026-08-13；`4.0.2`（2026-08-13），零依赖，unpacked 78,875 B。只做**子序列**命中（`fbl` 命中 `foobar`），**没有内建错字容差** —— `傅利叶` 这类替换错直接落空，与本轮要解决的问题正交度不足 → 不出骨架。适合做「命令面板式」前缀缩写检索，本仓无此场景 |
| `leeoniya/uFuzzy`（npm `@leeoniya/ufuzzy@1.0.19`） | B 其他JS（纯库） | MIT ✅ | 学习页检索 | 重复可强化，**中文增益不成立** | 🔵 | proposed | 2026-10-22 | ★3,038，push 2026-09-08；`1.0.19`（2025-08-22），零依赖，unpacked 134,546 B，iife 仅 8,410 B（**最省**）。**实测中文**：`intraMode:1 + intraIns:1` 下 `付里叶`/`中植定理`/`离散傅里叶` **全部 0 命中**，只有英文 `fourier` 命中 → 中文场景无增益。若将来只做英文/代码符号检索，它比 Fuse 更省，保留为备选 |
| `bevacqua/fuzzysearch` / `mattyork/fuzzy` | B 其他JS | MIT ✅ | — | 重复且无增益 | ⛔ | rejected | 2026-10-22 | ★2,741（2023-05 停更）/ ★834（2021-12 停更）。两者都只做**子序列**匹配、无容差、无区间打分；被 `fuzzysort` 完全覆盖，而 `fuzzysort` 本轮也只给 🔵 |
| `nextapps-de/flexsearch` / `EthanRutherford/fast-fuzzy` / `DumbWareio/DumbPad` | B 其他JS | Apache-2.0 ✅ / ISC ✅ / **GPL-3.0** ⛔ | — | 重复且无增益 | ⛔ | rejected | 2026-10-22 | `flexsearch`★13,809（2026-06 push）是**索引引擎**（自带 tokenizer + 打分），接进来等于把在途的 `search-rank`（minisearch）与 `search-segment`（jieba-wasm）**同时**推翻 —— 换引擎不是强化；`fast-fuzzy`★388 功能被 Fuse 覆盖且不做中文；`DumbPad`★474 是编辑器应用、**GPL-3.0** 红线。另 `javascript-fuzzy-string-search`★0 / `javascript-text-search`★0（`null`）无发布包 |
| — | — | — | — | — | — | **note** | 2026-10-22 | **本轮结论（读码，与候选无关）**：`layered-search.js` 的 `findIn` 上现已有**四条**在途骨架（`search-rank` 排序 / `search-segment` 切词 / `pinyin-match` 读音 / 本轮 `search-fuzzy` 容错），**四者实现时互斥于同一行代码**。建议评审**合并裁决**：只准一个 → 优先 `pinyin-match`；准多个 → 必须先定义「字面 → 拼音 → 近似」三级链的失败边界，否则会出现**双重猜测**（拼音拆错字、Fuse 再把错字配回去），用户无法判断结果可信度。**未改任何代码**，只记结论 |

## 2026-10-22 · 第五十二轮 · B 组（课程平台媒体 / 生活服务**正交新切片**）· 追加

> 今日已跑 A r50 / B r48 / C r49 / 派生 r51 → 按 README「三组今天都跑过 → 不重跑」，
> 本轮**不重复任何已跑关键词**，改跑两条此前从未扫过的正交轴。
> 13 次搜索（⚠ 超限 3 次，报告 §1.1 有说明）；API 全程 200、0 次 403、本轮**完整**。
> **有效候选 6 条：0 🟢 + 0 🟡 + 3 🔵 + 3 ⛔（族）；无骨架、不开 PR。**
> （`ChenyuHeee/Libot` 已于 2026-10-16 登记为 🔵，本轮不重复登记；`5dbwat4/login-ZJU`、`PeiPei233/zju-learning-assistant` 等已登记项本轮重扫**评级不变**。）

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `xxone111/zju-notes-assistant` | B 其他JS（**Agent Skill**：`SKILL.md` + 10 份 reference + 4 个 Node 脚本） | **MIT** ✅（`LICENSE` 实文已核：`MIT License / Copyright (c) 2026 xxone111`） | 课程笔记 / 转录导出 | **重复且无增益** | ⛔ | rejected | 2026-10-22 | ★4，**2026-10-11 建仓当日推送后未再动**，20 文件 / 136 KB（代码仅 4 脚本）。做「127.0.0.1 网页登录 → 导出智云 ASR 原文 / 课件 PDF / 学在浙大附件 → AI 生成精注或章节笔记」。**逐项对表本仓已全覆盖且更严**：会话管理（`source-classroom`；上游是明文 `~/.zju-notes-assistant/auth.json`）／ASR 逐页转录（`core-parser.transcribeSlides`）／页窗对齐（`fromMs`/`toMs`，且以 PPT 树为骨架）／课件附注（`core-notes.putAsset{page}` + `zy://section` 双链）／附件下载（`source-classroom/src/download.js` 的 Range 续传 + ETag `If-Range` + 并发锁；上游无续传、无锁、无校验）。**强化三判据仅成立 ①**（同一面板），②③ 均不成立 → ⛔。**若产品认定「精注导出成 PDF」是新需求，则应改判 🔵 单列评估**（见报告 §7.2） |
| └ 其 `references/` 文档 | B 其他JS（文档） | MIT ✅ | 论文/笔记（PDF 回写） | 全新（仅思路） | 🔵 | proposed | 2026-10-22 | 10 份**写给 agent 的操作手册**：`matching.md`（页码匹配的失败模式，含「图片型 PDF 无文字层」）、`pdf-integration.md`（PDF 回写）、`safety.md`（权限边界）。将来做「课件精注 → PDF」时是现成的踩坑清单。**只读思路、不摘代码** |
| `phillychi3/tronclass-util` | B 其他JS（**Tampermonkey 用户脚本**，vite 打包发 GreasyFork） | MIT（声明） | 课程视频/课件 | 重复（且**合规红线**） | ⛔ | rejected | 2026-10-22 | ★10，2026-07-21。README 自述 8 项功能里 **6 项红线**：快速观看影片、一键完成每周影音教材观看、一键读取投影片、**防止影片焦点侦测（后台播放不中断）**、自动填期末问卷、自动刷课。本仓课堂模块刻意不做自动刷课（`source-classroom` 定位「只读、不做自动登录」）→ 引入即自毁合规基线 |
| TronClass / 超星**下载器簇**（`YanhuiJessica/TronCUClass`★21 MIT、`BobLiu0518/TronClass-Resource-Download`★11 MIT、`fish-can/TronClass-PDF-Downloader`★39 `null`、`eWloYW8/ZJU-course-material-download`★14 MIT、`eWloYW8/ZJU-course-video-complete`★7 MIT、`ColdThunder11/ChaoXingDownload`★483 GPL-3.0、`RytterMohn/chaoxingDownload`★60 MIT、`iamNCJ/ZJU-Tronclass-Courseware-Downloader`★7 `null`、`Kcalb35/Tronclass-pdf-downloaderforChrome`★9 `null`、`vvirgooo2/Auto-video-tronclass-zju`★8 `null`、`CUC-Life-Hack/tronclass-hack`★9 GPL-3.0） | B 其他JS（浏览器扩展 / 用户脚本） | MIT / `null` / GPL-3.0 | 课件下载 | **重复且无增益** | ⛔ | rejected | 2026-10-22 | 11 条，三条理由任一即足：① 本仓 `download.js` 已有 Range 续传 + ETag + 并发锁，**簇内无一条达标**（判据③不成立）；② 全是扩展/脚本，依赖目标站 DOM，与「服务端取数 + 自绘 UI」正交；③ ★ 最高的几条恰是「下载无权限资源 / 快速完成视频进度」→ 合规红线。**结论：浙大课程平台 JS 生态「高星 = 高违规」** |
| 刷课 / 答题簇（`zhu-hailin/chaoxing-ai-assistant`★89 MIT、`lyj0309/chaoxing-xuexitong-autoflush`★105 `null`、`SSmJaE/XueXiTongSign_Electron`★76 `null`、`RainySY/chaoxing-xuexitong-autoflush`★68 `null`、`dzj0821/ChaoXingScripts`★68 GPL-3.0、`qcxs/chaoxing`★60 MIT、`pang-qin/chaoxing-toolkit`★57 `null`、`bclswl0827/Fuck-ChaoXing`★54 MIT） | B 其他JS | MIT / `null` / GPL-3.0 | — | 无关（对抗教学考核） | ⛔ | rejected | 2026-10-22 | 8 条，全部为自动刷课 / 章节测验 AI 填答案 / 考试切屏 / 过人脸 / 多设备同签。**不登记细节、不摘任何代码**；本仓明确不做此类功能 |
| 生活服务轴新仓（`ZHENG28/zjut_LibrarySeatSystem`★7 `null`、`Midoria7/LeggedGymForG1H1`★0 `null`、`Jnove/mentor-agent`★1 `null`、`congee949/EventChain-For-ZJU`★0 `null`、`Lormited/XMU-TronClass-Helper`★6 MIT 他校） | B 其他JS | `null` / MIT | — | — | ⛔ | rejected | 2026-10-22 | 许可证 `null` ×4 + 词面撞车（`zju gym` 命中的是机器人课程项目）+ 他校工具不可直用 |
| `RinnMoe/TronClassPlusPlus` | B 其他JS（浏览器增强插件） | **NOASSERTION** ⚠ | 课程浏览 | 重复 | ⚠ 待核 | pending-license | 2026-10-22 | ★6，2026-05-23。**许可证无法确认 → 不采用、不摘码**，须人工读 LICENSE 原文。即便核出宽松许可，「课程页增强」也被本仓页面完全覆盖 |
| （无结果记录）`zju campus secondhand` / `zju 二手` / `zju event` | — | — | 二手 / 活动 | — | — | note | 2026-10-22 | `total_count` 分别为 **0 / 0 / 1**（唯一条 `EventChain-For-ZJU` 是 ★0 / `null` / Go 的「校园 Polymarket」概念）。**生活服务轴封板 3 个月** |

> **本轮方法论结论**：
> ① **浙大课程平台 JS 生态「高星 = 高违规」** —— `chaoxing javascript` 前 10 条里 ★ 最高的 6 条全是刷课/答题。**按 `stars` 排序会稳定把违规工具排到最前** → 该轴默认改按 `updated`，并在筛选阶段先看 description 有无「刷 / 绕过 / 自动答题 / 无权限」。
> ② **B 组「可嵌入的 JS 库」存量已在 10-16 扫穿**（`5dbwat4/login-ZJU` 是 10 余轮里唯一 🟢），此后零 🟢；本轮 13 次搜索再次印证。
> ③ **「一条龙导出」型项目一律判重复无增益**（含 ★532 的 `PeiPei233/zju-learning-assistant`、本轮的 `zju-notes-assistant`）：本仓的优势在「在线解析 + 页窗对齐 + 双链」，不在「批量落盘」。

## 2026-10-23 · C 组（第五十三轮 · **「课表带走」轴**）· 追加

> 跨天首轮，`day_of_year % 3` = `296 % 3` = 2 → **C 组**。8 次搜索（上限 10）、API 全程 200、**0 次 403、本轮完整**。
> 因 C 组功能域已被 r30–r49 反复扫过，本轮改用 r37 的方法：**先读码找断环、再定向搜**。
> 读码结论：**iCalendar 序列化在本仓是零实现**（13 个 grep 命中全是 `verticalRule` / `toPhysical` 之类子串误伤），
> 而课表（`page-today/src/agenda.js` 的 `projectAgenda`）与截止时间（`plans.js` 的 `due` + `time.js` 的 `ZONE`）
> **数据齐全** → 缺口是「**带得走**」，不是「缺功能」。**首次登记 10 行（含 2 行簇）→ 🟢1 / 🔵2 / ⛔6 / ⚠1。**

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `adamgibbons/ics` | B 其他JS（纯生成器库） | **ISC** ✅（GitHub `spdx_id` + npm `versions['3.12.1'].license` 两处一致） | 课表 / 作业截止 → 系统日历 | **重复且可强化** → **强化式集成** | 🟢 | proposed | 2026-10-23 | ★787，push **2026-10-01**，npm `ics@3.12.1`（同日发布）✅ 可锁版。`unpackedSize` 72,079 B；esbuild bundle **实测 75 KB**（大头 yup）。依赖 `yup@^1.2.0`/`nanoid@^3.1.23`/`runes2@^1.1.2` **全 MIT**、无 copyleft、无 `node:` 内置依赖 → 可进前端 bundle。**强化三判据全成立**：①同一面板（「规划」页页头一个导出动作，不新增导航）②相似正交（站内「接下来做什么」vs 日历里「看得到」）③本仓 iCalendar **零实现**。**实测三条「不报错的错」**：**R1** 不传 `uid` 时 UID 随机（`aXPsYcWAV4xBuUE_N_2JP`），而课表条目**无稳定 id** → 每导出一次日历多一套重复事件；传 `uid` 后两次逐字相同 → 必须由 `(termKey, courseTitle, startMs)` 确定性派生。**R2** `timezone` 字段**被拒**（`unspecified keys`）→ 无 VTIMEZONE，只能「浮动」或「UTC」，建议 UTC。**R3** 把 `Date(ms).getUTC*()` 当本地时间传 → `DTSTART` **早 8 小时且不报错**。另：多传 `id` → 整条 `ValidationError`（yup `noUnknown`）。**已出骨架 `dsh-radar-ics-export`** |
| `jens-maus/node-ical` | B 其他JS（解析器） | **Apache-2.0** ✅ | 日历回流（未来） | 全新（但**方向相反**） | 🔵 | proposed | 2026-10-23 | ★173，push 2026-10-19，npm `0.27.3`（2026-10-03）。RFC 5545 **解析** + RRULE 展开。本仓缺的是**生成**不是解析；同批检索另有 `mifi/ical-expander`（MIT，★72，依赖 `ical.js`）亦为解析器，同判。**依赖 `rrule-temporal` + `temporal-polyfill`**，体积远大于 `ics`。仅当将来做「外部日历 → 本仓」回流时才需要，且**必须先有冲突合并策略** |
| `marioMLLL/ecnu-timetable-calendar` | B 其他JS | **MIT** ✅ | 他校（华东师大）课表导出 | 重复无增益 | 🔵 | proposed | 2026-10-23 | ★8，push 2026-09-22。教务系统 → .ics 的思路可看，但**数据源完全不同**，且导出逻辑只有几十行（`ics` 的薄壳）→ 只作思路参考，不摘码 |
| `ical-generator@11.1.2`（npm，★ 未统计） | B 其他JS（备选上游） | **MIT** ✅ | 同上 | 强化式集成（**换上游备选**） | 🔵 | proposed | 2026-10-23 | 不单独登记为候选，只在骨架 README 的「拍板项 2」点名：**它支持 `timezone` 参数**，是 R2（时间显示北京时间）的唯一解。代价：bundle 814 KB 源体积。**若产品要求日历里必须显示北京时间，则 `ics` 不满足、需换它** |
| `NLion74/ics-webuntis` | B 其他JS | **NOASSERTION** ⚠ | 他校课表导出 | — | ⚠ | pending-license | 2026-10-23 | ★11，push 2026-09-14。**许可证待人工核验，不采用、不摘码**；且 WebUntis 数据源不可复用 |
| `finwarman/kcl-timetable`(★14) / `Treeki/myplace-timetable-export`(★2) / `mcpower/icallate`(★5) | B | `null` ⛔ | 他校 | — | ⛔ | rejected | 2026-10-23 | Python / Ruby / HTML，无许可证。只登记 |
| 他校课表导出器（`JustBrandonLim/timetable-grabber-sit`★34 MIT、`computerfan/XJTLU-Timetable-to-ICS`★4 MIT、`romankurakin/dkuzeit`★4 MIT、`clemmbn/auriga-extract`★5 MIT） | B | **MIT** ✅ | 他校 | **重复且无增益** | ⛔ | rejected | 2026-10-23 | 许可证没问题，但**数据源不可复用**且导出逻辑极薄（都是 `ics` 的薄壳）→ 判据③不成立 |
| `icalgen` 簇（`wysie/icalgen`★35、`touch4it/ical-timezones`★11、`chichow5/heuicsgen`★1、`localift/ical-generator`★0、`hkwi/WorkingDays.ics`★0） | B | `null` ×4 / `NOASSERTION` | — | 重复无增益 | ⛔ | rejected | 2026-10-23 | 全部无可用许可证；能力被 `adamgibbons/ics` 完全覆盖 |
| `tritech/node-icalendar`（★233） | B | **MIT** ✅ | — | 重复无增益 | ⛔ | rejected | 2026-10-23 | **push 2020-02-15**，六年未动；功能被 `ics`（生成）/ `node-ical`（解析）覆盖 |
| web PDF 批注簇（`techs-targe/pdfmark`★0 MIT、`kimuchi0141/Web-pdf-editor`★0 MIT、`pujunru/PDF-Viewer`★0 `null`、`BhargavBorse/pdf-viewer-with-annotation`★5 `null`、`Comet-Suite/smilo-pdf-viewer`★0 `null`、`gLUK00/OpenMark`★1 MIT） | B | 混杂 | 论文批注 | **重复且无增益** | ⛔ | rejected | 2026-10-23 | ★≤5、多为 demo；本仓「论文」页已有 PDF 阅读器 + 选中即译（`dsh-zhiyun-page-paper`）。**且「批注要不要能带走」本仓尚无明确需求** → 先按兵不动 |
| 刷题簇（`ceo-0168/life-in-the-uk-practice`★1 MIT、`cLeffNote44/Geo-Locate`★0 MIT、`AKIB-UZ-ZAMAN/Solvix-v2`★0 `null`、`JDenn0514/Dendro`★0 `null`、`renumalu/QuizForge-AI`★1 `null`、`ryanmcgann4/med-qbank`★0 `null`、`Elfi91/Quiz-practice`★0 MIT、`Papaperun/study-quiz-builder`★0 `null`、`tson2809/quiz`★1 `null`） | B | MIT / `null` | 刷题 | **重复且无增益** | ⛔ | rejected | 2026-10-23 | ★≤4 的单人小站 / 单科专用。本仓已有 FSRS 调度（r24）+ BKT 掌握度（r49）→ 三者都不缺 |
| （无结果记录）`fitness tracker language:typescript` | — | — | 锻炼 | — | — | note | 2026-10-23 | `total_count` = **0**，**第三次零结果**（r35 / r52 / 本轮）。Web 端锻炼追踪**结构性无解**（接触不到 Google Fit / HealthKit，r35 已登记 `rn-fitness-tracker` 为「原生桥，Web 用不上」）→ **建议把「锻炼」移出 C 组默认词池** |

**本轮 `NOASSERTION` 1 条待核**（`NLion74/ics-webuntis`）；**无许可证 8 条**；**0 条 copyleft** —— 只登记、不采用、不摘码。

> **方法论结论（非候选，但比候选重要）**：
> ① **C 组第四次复现「能力/数据已在、出口没有」**（r37 关键路径 / r49 掌握度 / r50 锚点校验 / 本轮 iCalendar）。
> 但本轮补了一层**判别线**：缺的是「一行调用」→ 补接线；缺的是「一套规范实现」→ 才接依赖。
> iCalendar 属后者（RFC 5545 的 75-octet 折行与 `,` `;` `\` 转义不该手写）。**这条判别线防的是把接线问题当依赖问题。**
> ② **本轮候选的失败模式全是「不报错的错」**：随机 UID（每次导出多一套重复事件）、浮动时间（跨时区错）、
> `getUTC*` 当本地时间（早 8 小时）—— 三者产出的 `.ics` **语法完全合法**，只在内容上错。
> → 接入「序列化 / 格式化」类上游时，验收**必须**含两条断言：**同一输入两次输出逐字相同**、**时区往返守恒**。
> ③ **R1 暴露一个接线缺口**：`stableUid` 需要 `termKey`，而 `projectAgenda` 只输出 `day`、**没有学期标识**。
> 若决定做，需先在 `dsh-zhiyun-source-campus` 补学期字段 —— **这是接线活，不需要新依赖**。
> ④ **「限定符别叠加」再被验证两次**（`paper annotation + stars:>30` → 0、`exam dragdrop` → 0）。
> 建议升级为流程硬性要求：**首个查询一律不加 `stars:` / `language:`**，只在结果里过滤。

## 2026-10-23 · B 组派生（第五十四轮 · **「专注计时底座」轴**）· 追加

> 同日第 2 轮（今日 r53 已跑 C 组）。B 组三组主词（`zju` / `cc98` / `campus app`）已在 r41 / r48 / r51 / r52
> 连续判枯竭，故本轮不重跑主词，改用 **先读码找断环、再定向搜**：
> `grep -rniE "pomodoro|番茄|focus session"` 全仓 **0 命中**；本仓「时间」只有 `time.js` 的 `focusOf()`（五档）
> 与 `focusSummary()`（数三个数）→ **「今天还剩多少整块时间」数据已在、出口没有**。
> 8 次搜索（上限 10）、API 全程 200、**0 次 403、本轮完整**。**首次登记 11 行（含 3 行簇）→ 🟢1 / 🔵3 / ⛔6 / ⚠1。**

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `statelyai/xstate` | B 其他JS（纯状态机库，无 patch） | **MIT** ✅（GitHub `spdx_id` + npm `versions['5.33.3'].license` 两处一致） | 专注计时 / 规划页 | **重复且可强化** → **强化式集成** | 🟢 | proposed | 2026-10-23 | ★30,342，push 2026-10-21，npm **`xstate@5.33.3`**（2026-10-17，`dist-tags.latest` 实查）✅ 可锁版。`unpackedSize` **2,313,880 B**；**零运行时依赖**。**强化三判据**：①同一面板（「规划」页摘要条加一个数，不新增导航/插槽）②相似正交（「哪些事在逼近」vs「今天还剩多少整块时间」）③本仓时间逻辑**零离线测试**，上游可整根换时钟。⚠ ③ **仅成立于「可测性」一层**，不声称「接上后体验更好」。**三条实测（本轮最有价值的产出）**：**M3** `after: ({context}) => ({[context.remain]:'x'})` **静默失效**（注入时钟一次未被调用、不抛错不告警；CJS/ESM 各复现一次，与 v5 文档说法不一致）→ 动态时长**只能**用常量对象形式；**M4** `getPersistedSnapshot()` **无 deadline 字段** → 刷新后定时器从头开始；**M5** 暂停期间 `Date.now()` 照走，沿用旧 deadline 会「一恢复就到点」。另 **M6** 上游**确实**会 `clearTimeout`（日志 `set1/clear1/set2`）；**M7** `after` 未 stop 的 actor 会让 Node 进程不退出；**M8** `getSnapshot()` ≠ `getPersistedSnapshot()`（前者不可 JSON 化）；**M9** `@xstate/react@6.1.0` 带两个 peer 依赖，React 19 用 `useSyncExternalStore` 手接即可。**已出骨架 `dsh-radar-focus-machine`** |
| `super-productivity/super-productivity` | B 其他JS（完整桌面应用） | **MIT** ✅ | 时间盒 / 待办 | 仅供参考（算法） | 🔵 | proposed | 2026-10-23 | ★23,064，push 2026-10-22。Electron + Angular **成品**，自带宿主 → 与「仍是同一个面板」直接冲突。可借的只有时间盒算法（几百行），且与 Angular 状态强耦合 → 不摘码 |
| `zidoro/pomatez` | B 其他JS（Electron 应用） | **MIT** ✅ | 专注计时 | 重复无增益（**且不可锁版**） | 🔵 | proposed | 2026-10-23 | ★4,913，push 2026-05-19。**npm 上 `pomatez` 404**（本轮实查）→ B 类第二门「可锁版」不过；形态为完整桌面应用 |
| `afonsopacifer/react-pomodoro` | B 其他JS（单页） | **MIT** ✅ | 专注计时 | **重复且无增益** | 🔵 | proposed | 2026-10-23 | ★398，**push 2023-01-27**（近四年未动）。只有 300 行级 UI，**无状态机可借** → 判据③不成立 |
| 单页计时器簇（`KeziahMoselle/tempus`★120 MIT·2020、`astroud/pomodoro-react-app`★60 MIT、`luizbatanero/pomodoro-react`★60 `null`、`nmsn/pomo`★50 MIT、`dejwid/react-pomodoro-timer`★32 `null`、`mihajlija/pomodoro`★27 `null`、`mbogdan0/simple-pomodoro`★1 MIT） | B | MIT / `null` | 专注计时 | **重复且无增益** | ⛔ | rejected | 2026-10-23 | **与 r44（2026-10-17「番茄钟类」）同一结论的第二次复现**：计时器本体是 300 行级实现，**不存在「更优底层」** |
| 嵌入式 / 原生簇（`dryjak/STM32-Pomodoro-Timer`★1 C、`yenuka23/Spidey-Pomodoro-Companion` C++、`PaulRychkov/pomodoro`★0 Go、`sakagenoan-svg/devdroidai-dogfood-focusclock`★0 Kotlin、`872000/focusforge`★0 Swift、`eltech-online/eltech-esp32-desk-timer`★0 C++） | B | MIT / `null` | — | 无关 | ⛔ | rejected | 2026-10-23 | **非 JS 栈**，Web 工作台结构性用不上 |
| 计时底层陈旧簇（`Pjaerr/PWA-Timer`★30 Unlicense·2018、`daniellmb/perfnow.js`★46 **`null`**·2016、`heycato/Timer.js`★3 `null`·2014、`BinaryMuse/timex`★2 MIT·2016、`Splode/worker-timer-demo`★7 MIT·2020） | B | 混杂 | — | 重复无增益 | ⛔ | rejected | 2026-10-23 | 全部停在 2014–2020；`performance.now` polyfill 在 2026 已无意义（浏览器原生）。2026 年的新包全是 ★0 的 `high-resolution-timer` 变体（疑似模板仓），无一个 ★>0 |
| Electron 计时器簇（`p32929/PotatoTimer`★6 MIT、`Piotr-Gala/TimeTimer`★0 `null`、`ChristianTedeschini/alura-timer`★0 `null`、`YuBan834/star-focus`★1 MIT、`screamman-ssh/Counties`★1 MIT、`univdev/ww-timer`★1 `null`、`rendfall/test-web-worker-timer`★1 `null`、`alfonso-lopez-dev/chronoMaster-studio`★1 `null`、`heyoboo/web-worker-timer`★0 `null`） | B | MIT / `null` | — | 重复无增益 | ⛔ | rejected | 2026-10-23 | ★≤6，与 `pomatez` 同形（成品应用 / demo），不构成可锁版底层 |
| `maxbeyer1/pomo` | B | **MPL-2.0** ⛔ | — | — | ⛔ | rejected | 2026-10-23 | ★1，push 2022-06-11。**许可证不在宽松白名单**（MPL-* 明确排除）→ 只登记、不采用、不摘码 |
| `alexqgon93/ChessClock` / `alfindigital/fokusin` | B | `null` / MIT | — | 无关 | ⛔ | rejected | 2026-10-23 | 均 ★0；前者 Kotlin 无证、后者零依赖单页印尼语番茄钟 → 不可锁版亦无增益 |
| `normandhoni-cs/blink-eye`（★263） | B | **NOASSERTION** ⚠ | 护眼提醒 | — | ⚠ | pending-license | 2026-10-23 | push 2026-10-17，TS，跨平台护眼/休息提醒（Electron）。**许可证待人工核验，不采用、不摘码**；且形态为成品桌面应用 |

**本轮 `NOASSERTION` 1 条待核**（`normandhoni-cs/blink-eye`）；**无许可证 12 条**；**copyleft 1 条**（`maxbeyer1/pomo` MPL-2.0）—— 只登记、不采用、不摘码。

> **方法论结论（非候选，但比候选重要）**：
> ① **r53 的判别线要再切一刀**。r53 写的是「缺一行调用 → 补接线；缺一套规范实现 → 接依赖」。
> 本轮暴露**第三种情况**：**缺的是一层不变量**（「暂停期间时钟不被回溯」）。这时接进来的不是工具函数，而是**一个模型** ——
> 而模型的价值恰恰在它的**边界**（M3/M4/M5），不在 API。建议写成三条判别线。
> ② **M3 是「不报错的错」第五次复现**（r50 F-1 / r51 R3 / r53 R1·R2·R3 / 本轮 M3）。
> 凡引入「调度 / 序列化 / 时钟」类上游，验收**必须**含「同一输入两次结果逐字相同」与「不变量在暂停 / 恢复 / 重载三种转移下守恒」两条断言。
> ③ **GitHub 上「专注计时」没有可用的底层，只有成品**：★ 高的全是完整应用（★23k / ★4.9k，有宿主不可嵌），
> ★ 低的全是 2018–2023 的单页 demo，计时底层停在 2014–2016 且多为 `null`。
> 与 r40（图算法）、r41（中文分词）**第三次同构**：**基础能力在 npm 上，GitHub 只用来发现新包**。本轮真正该锁的是 `xstate`，不是任何 pomodoro 仓库。
> ④ 流程自查：首轮探针用「手动持有点火函数」的假时钟，把已 `clearTimeout` 的回调又点了一次，误判成「上游没撤销定时器」，
> 第二轮用真 `setTimeout` 纠正（M6）。**假时钟必须实现「撤销后回调永不再触发」的语义**，否则任何基于假时钟的结论都不可信。
| `NanmiCoder/dsh-agent-teams` | A 原生DSH | MIT | 规划/今天 | **重复且无增益**（骨架已在） | ⛔ | rejected | 2026-10-23 | ★2366。**已出骨架 `packages/dsh-radar-agent-teams`（2026-10-15）**，本轮仅重跑命中，不构成新候选、不改骨架 |
| `dsh-market/dsh-market` | A 原生DSH | MIT | 插件 | **重复且无增益**（骨架已在） | ⛔ | rejected | 2026-10-23 | ★8243（骨架出时 ★6494）。**已有 `packages/dsh-radar-dsh-market` + `dsh-radar-market` 两份骨架未裁决**，不再出第三份 |
| `YELEBAI/dsh-plugin-marketplace` | A 原生DSH | MIT | 插件 | 重复无增益（插件市场第 N 家） | ⛔ | rejected | 2026-10-23 | ★21。npm 0.5.5 / 仓库 0.9.5 **版本错位**，锁版无意义；`dsh.marketplace.profiles` 写死 `["web","desktop"]`，与本仓 `zhiyun-bench` 不匹配 |
| `kingOfSoySauce/dsh-skin-market` | A 原生DSH | MIT | 通用（主题） | **重复且无增益**（主题域已自建） | ⛔ | rejected | 2026-10-23 | ★247。npm 0.1.67 与仓库一致。主题域累计第 14 条 ⛔；接皮肤市场会再开一个主题源，破坏 paper 包 `frame-theme.js` 的 `--zy-*` 映射 |
| `zhu1090093659/dsh-skins` | A 原生DSH | BSD-3-Clause（仓库）/ Apache-2.0（npm）**不一致** | 通用（主题） | **重复且无增益**（主题域已自建） | ⛔ | rejected | 2026-10-23 | ★24。npm 名 `@linxin666/dsh-client-ui-skin-center@0.4.8`。**两源许可证不一致须人工核**；按更严者 BSD-3-Clause 仍在白名单，但同属主题域第 15 条 ⛔ |
| `luobosibing2/dsh-jev-plugin` | A 原生DSH | MIT | 通用（审批/监督门控） | 全新（本仓**零实现**：approval/supervision/interjection 全 0 命中） | ⛔→观察 | proposed | 2026-10-23 | ★196，2026-10-22 仍在推。**`@dsh-jev/plugin` npm 404 未发布** → A 类「锁版引入」不成立，无法出骨架。**一旦发布即升 🟡 复评；在此之前不得摘码**。功能域为本仓真空白 |
| `maddogfinance/dsh-trading` | A 原生DSH | MIT | 通用（交易研究） | 全新（域外） | ⛔ | rejected | 2026-10-23 | ★41，2026-08-23 最后推送（近 2 月未动）。monorepo；子包 `@dsh-trading/tool-market@0.2.0` 可锁版但根包 `version: null`。**学生场景契合 0**。⚠ 与 `zhu1090093659/dsh-trading` **同名不同仓，勿混** |
| `FishBottle7/opencode2dsh` | A 原生DSH | MIT | 通用（第三方模型源） | 全新（域外） | ⛔ | rejected | 2026-10-23 | ★330。接 OpenCode Zen 免费模型。与工作台单一 provider 策略冲突，「免费源」类插件生命周期极短 |
| `yannicksong0106/dsh-550c-boot` | A 原生DSH | MIT | 通用（启动动画） | 重复无增益（外壳启动画面已自建） | ⛔ | rejected | 2026-10-23 | ★178。纯装饰；「首帧由宿主半边注入」会改宿主渲染时序，与本仓外壳 Loading 卡接管冲突 |
| `YishenTu/claudian` | B 其他 JS | MIT | 笔记（Obsidian） | 重复且无增益（平台错配） | ⛔ | rejected | 2026-10-23 | ★15767（本轮最高星）。**宿主是 Obsidian 不是 DSH**，不可挂载；仅可作「vault 内嵌 AI 协作者」交互参考 |
| `ZJUSCT/mirror-front` | B 其他 JS | MIT | 无（浙大镜像站前端） | 全新（域外，属 B 组） | ⛔ | rejected | 2026-10-23 | ★36。**DSH 无关**，被 `dsh plugin` 查询误捞。**转交 B 组**：可作「校内服务状态」线索，但与本仓 DSH 集成目标无交集 |
| `hust-open-atom-club/oh-dsh` | A 原生DSH | MIT（仅 GitHub 元数据，**未核 LICENSE 文件**） | 通用（runtime 分发） | 全新（跨形态） | 🔵 | proposed | 2026-10-23 | ★323。Desktop/Web/TUI 三形态 runtime。**不是插件是宿主分发**，无法挂 `dsh.bundle.patch`。仅作架构参考；引用前须核 LICENSE 文件 |
| `zhu1090093659/dsh-trading` | A 原生DSH | **NOASSERTION** | 通用（交易终端） | 全新（域外） | ⚠ 待核 | pending-license | 2026-10-23 | ★274。Agent 原生交易终端（Crypto/US/CN/HK）。**许可证待人工核，不采用、不摘码**。⚠ **与 `maddogfinance/dsh-trading`(MIT) 同名不同仓**，最易误判的一对 |
| `See-Sol-Lab/DeepSeekGUI` | A 原生DSH | **NOASSERTION** | 通用（桌面端） | 全新（桌面端簇本仓不自建） | ⚠ 待核 | pending-license | 2026-10-23 | ★280。桌面 GUI（Git/内置浏览器/记忆）。**许可证待核，不采用**。桌面端簇全线已登记，无集成意图 |
| `citation-js/citation-js` | B 其他JS | **MIT** ✅（GitHub `spdx_id` / npm 三包 `license` / `LICENSE.md` 三处一致） | 论文（文献条目） | **重复且可强化**（判据①②③全成立：同一抽屉 + 库填充≠库导航 + 本仓零解析能力） | 🟢 | skeleton-created | 2026-10-18 | ★213，push **2026-10-22**。**本轮 r55 由 🟡 升 🟢 并出骨架 `dsh-radar-refs-import`**。升的理由：10-18 判 🟡 是因「要自建整条 UI」=新功能页；本轮只取第一段（粘贴文本→条目列表），出口是**既有** `LibraryPanel.jsx` 的 `uploadPaper()`，引文样式/插引用/文献表**明确排除**（也因此**不引** `plugin-csl`，绕开 `citeproc-js`=NOASSERTION 那个未决点）。锁版 `@citation-js/{core,plugin-bibtex,plugin-ris}@0.9.0`（三包**必须同版本**：core 0.9.0+plugin-bibtex 0.8.4 → `ETARGET`）。实测 M1–M8：BibTeX/RIS/中文/多条目均通（`王, 小明`→`{family:'王',given:'小明'}`）；非法输入抛 `This format is not supported or recognized`（唯一失败信号，因格式靠**内容嗅探**）。⚠ 体积 **698,183 B unpacked（≈682 KB）** 是唯一真成本（对照 r53 `ics` 75 KB），浏览器打包体积**未测**→ 在 `upstream.js` TODO-A-1 出数前**不得**升「已采纳」 |
| `sunshine-lang/dsh-pdf` | A 原生DSH | **MIT** ✅ | 论文（PDF 文本/元数据） | **重复且无增益** | 🔵 | proposed | 2026-10-23 | ★8，push 2026-09-21，topics 含 `dsh-plugin`。`pdfjs-dist` 取文本/元数据/页范围。本仓 `dsh-zhiyun-host-paper` **已锁版** `pdfjs-dist@6.4.299` 且上游转录链路在用 → 同一件事的第二个封装，**不出骨架**。⚠ npm 端包名未核（本轮搜索次数已用于主候选） |
| `hash-bang/reflib-ris` | B 其他JS | MIT | 论文（RIS） | 重复无增益（被 citation-js 覆盖） | ⛔ | rejected | 2026-10-23 | ★0，**2021-09 停更**。`ris parser language:javascript`(13) 里唯一有效的纯 RIS 解析器；能力被 `@citation-js/plugin-ris@0.9.0` 完全覆盖 |

## 2026-10-23 · C 组派生（第五十七轮 · **「文献库近邻检索 / 混合检索底座」轴**）· 追加

> 同日第 4 轮（承接 r53 / r54 / r55）。起点是读码：`page-paper` 的「检索」实为**锁版上游**的
> `search_paper`（本仓只配一个可选「重排端点」，`SettingsSection.jsx:67`），且全仓无**跨文献**检索。
> 搜索 11 次（⚠ 超限 1 次）、0 次 403。首次登记 11 行（含 3 行簇）→ **🟢1 🟡1 🔵3 ⚠1 ⛔5**。
> 骨架 `dsh-radar-kb-rag`（**A 类**，锁版 `dsh-kb-rag@1.6.8`）。
> `Vncntvx/dsh-zotero` 已在册（L126/L344），本轮只补新事实、**不重复登记**：★35→**46**，npm `dsh-zotero@0.13.0`（2026-10-20）已核可锁版。

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `Breeze136/dsh-kb-rag` | **A 原生DSH** | **MIT** ✅ | 论文（文献库跨篇检索） | **重复可强化**（论文页问答抽屉） | 🟢 | proposed | 2026-10-23 | ★15，建仓 2026-08-16，push 2026-10-22。npm **`dsh-kb-rag@1.6.8`**（2026-10-21，23 版）**可锁版**；679 KB、`dependencies` **空**；**只注册 10 个 model tool + command，无页面/侧栏/slot** → 过「注入面限于本包 ctx」。引擎为进程外 `kb_engine.py`（`sqlite3` + **内存 BM25 CJK + 本地 bge-small 向量** + 可选本地 rerank），工具名 `kb_ingest/kb_search/kb_rag/kb_zotero/kb_dedup/kb_clear/kb_fetch/kb_scope/kb_stats/kb_status`。**判 🟢 的三条**：①仍是同一面板（回答落在已有 `AssistantDrawer`）；②与上游 `search_paper`（单篇内定位）是同一件事的两个粒度，非并行实现；③换了更优检索底座（混合召回 + 章节/页码/DOI 出处 + 本地推理不外发正文）。**前置**：宿主须有 `subprocess` 服务（缺则**静默 return**，见 M2）、需 Python 运行时、会写 `<workspace>/.kb-rag/state.json` 与 `kb.sqlite`（与「笔记库只有 .md」冲突）。⚠ 引擎**未实跑**，检索质量**未测** |
| `Hongcheng-LI/dsh-zotero` | A 原生DSH | MIT ✅ | 论文（文献库） | 重复可强化 | 🔵 | proposed | 2026-10-23 | ★19，JS，2026-08-15 建仓 / push **2026-10-07**（半月未动）。只做 Zotero 读写工具（搜库、元数据、全文、列条目），**无面板** → 能力被 `dsh-kb-rag`（检索）+ `Vncntvx/dsh-zotero`（面板）夹住 |
| `peijiping/dsh-plugin-zotero` | A 原生DSH | MIT ✅ | 论文（文献库） | 重复无增益 | 🔵 | proposed | 2026-10-23 | ★6，建仓 2026-10-08，npm `dsh-plugin-zotero@0.1.2` 可锁版。同域第 4 家，描述无差异化 |
| `nftuoa/dsh-zotero` | A 原生DSH | MIT ✅ | 论文（文献库） | 重复可强化 | 🔵 | proposed | 2026-10-23 | ★0，**当建仓**；topics 含 `deepseek-harness/dsh/pdfjs/plugin/zotero`。「原生 DSH 形态」的正面样本，但 ★0 + 当日建仓 → 不评 🟢。**M1**：它无对应 npm 发布，npm 上的 `dsh-zotero` 属 `Vncntvx` |
| `toustifer/zotero-dsh`、`toustifer/dsh-zotero` | A 原生DSH | **AGPL-3.0** ⛔ / MIT | — | — | ⛔ | rejected | 2026-10-23 | **同一作者两个仓库同名不同许可**：`zotero-dsh`（★2）AGPL 红线，只可参考**不可摘码**；`dsh-zotero`（★0）MIT 但 ★0。同名消歧的现实样本 |
| `LiuFangshuo666/DSH-for-Zotero` | A 原生DSH | **NOASSERTION** ⚠ | 论文 | — | ⚠ 待核 | pending-license | 2026-10-23 | ★2，TS，push 2026-10-19。**方向相反**（在 Zotero 里跑 DSH），即便许可清晰也是「另装一个 Zotero 插件」→ **不采用、不摘码**。许可证待核 |
| `yuzh2001/dsh-zotero`、`Fisfzy/zotero-wave-rag` | A 原生DSH | **`null`（无许可证）** ⛔ | — | — | ⛔ | rejected | 2026-10-23 | 无许可证红线，仅登记，不摘任何代码 |
| Zotero-DSH 单点工具簇：`evanliu3594/dsh-zotero-plugin`(★0,MIT)、`H-xie/zotero4DSH`(★0,MIT,npm 404)、`careyourcake/dsh-plugin-litsearch-zotero`(★0,MIT)、`JARRY-DJH/zotero-harness-bridge`(★1,MIT,无依赖 MCP)、`NanyuC/dsh-zotero-assistant`(★1,MIT)、`guoxinlu17-cmyk/dsh-bridge`(★1,MIT)、`XZJ-top/dsh-paperforge`(★0,MIT,让 agent 写论文，npm 404)、`anonymous99-Rise/awesome-dsh-zotero`(★1,MIT,清单) | A 原生DSH（混合） | MIT | 论文 | 重复无增益 | ⛔ | rejected | 2026-10-23 | 8 条（含 1 条清单）。★ 全 ≤1；能力被 `dsh-kb-rag` + `Vncntvx/dsh-zotero` 覆盖；`dsh-paperforge` 与产品定位无关 |
| 复核组：`timetable ics export` 前 10（`JustBrandonLim/timetable-grabber-sit` ★34 MIT、`marioMLLL/ecnu-timetable-calendar` ★8 MIT、`romankurakin/dkuzeit` ★4 MIT、`computerfan/XJTLU-Timetable-to-ICS` ★4 MIT 等）、`paper annotation reader` 27 条、`ocr notes taking` 73 条前端 | B 其他JS | MIT / `null` / NOASSERTION | 课表 / 论文 / 笔记 | 重复无增益 | ⛔ | rejected | 2026-10-23 | 均为**单体 CLI / 浏览器扩展 / 独立桌面应用**，无可嵌入层；`ics` 底座已由 r53 出骨架 `dsh-radar-ics-export`，论文簇 2026-10-20 已整簇判决 → 判决不变，**课表轴 3 个月内不再扫** |
| 词义污染组：`quiz practice`（★前十 `piano-trainer`★2211、`Major-project-list`★259…）、`fitness tracker`（★前十宽松许可仅 `workout-cool`★8637 且已登记） | B 其他JS | 混合 | — | 无关 | ⛔ | rejected | 2026-10-23 | **`practice` 在 GitHub 第一语义是「乐器练习」** → 该词移出 C 组词池；锻炼轴 ★ 前十 AGPL/GPL/MPL/NOASSERTION 占 9 条 → **封板**（第 3 次），改按 npm 包名搜 |

## 2026-10-24 · A 组（第五十八轮 · **「插件页的『这包从哪来、能做什么』」轴**）· 追加

> 取组：`date +%F` = 2026-10-24，年积日 297，`297 % 3 = 0` → **A 组**（跨天重置，与公式一致；
> 脚本按 UTC 判成 10-23 → 不采纳，第五次记录该缺陷）。起点是**读码**：`page-plugins` 的行只有
> 身份/开关/依赖/叶/相位，**没有** version / license / 来源 / 能力；`grep -rniE "spdx|license"
> packages/dsh-zhiyun-*/src` → **0 条**。
> 搜索 10 次（**未超限**）、0 次 403、本轮完整。首次登记 8 行（含 2 行簇）→ **🟢1 🟡1 🔵2 ⚠1 ⛔3**。
> 骨架 `dsh-radar-plugin-ledger`（**A 类**，锁版 `@zseven-w/dsh-harbor@0.1.0-rc.4`）。
> 已在册本轮只复核、不重复登记：`gwsbhqt/dsh-insight`（维持 ⛔）、`ChaoYuZhang001/dsh-gate`、`PerryLink/dsh-score`。

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `ZSeven-W/dsh-harbor` | **A 原生DSH** | **MIT** ✅ | 通用（插件台账） | **重复可强化**（插件页） | 🟢 | proposed | 2026-10-24 | ★25，建仓 2026-08-22，push 2026-10-23。npm **`@zseven-w/dsh-harbor@0.1.0-rc.4`** 可锁版（`dist-tags.latest` 就指向 rc 版；`repository.url` 指向本仓库）。1.15 MB、`dependencies` 空、peer 仅 react 18。**宿主 `inject` 只有 `['webServer']`** → 挂 6 条回环路由；客户端只有 1 个 `settings.section`，**无 main 页/无侧栏** → 过「注入面限于本包 ctx」。扫描器 `exports: "./scan"`，`inspectPlugin({dir,name})` + `reconcile()` 是**同步纯函数**（实测 12 ms / 129 ms）。**判 🟢 的三条**：①同一张表的同一行；②结构维（谁依赖谁）vs 能力维（起进程/外发/开路由/读写别人配置）正交；③从「零字段」变成 13 项词表 + `file:line` 证据 + 声明对账。**⚠ 成色折扣**：M3 实测证据会命中**注释行**（`source-campus` 的 `network-egress` 6 条证据全在 `src/egress.js` 注释里、另 18 条省略）→ 「更优」≠「更准」。**⚠ 四个前置**：无 license 维度（自写）；`dsh.capabilities` 是社区公约宿主不读；扫描根 `~/.dsh/profiles` 与本仓 `profiles/` 是否同一处**未核**（TODO-0）；`/updates`、`/preflight*` 两条**会联网** |
| `feely0208/dsh-license-guard` | A 原生DSH | MIT ✅ | 通用（许可合规） | 重复可强化（**但入口不对**） | 🟡 | proposed | 2026-10-24 | ★1，**Shell**，建仓 2026-10-13 / push 2026-10-22。形态是 **CLI + Agent Skill**：`inject=['skills']`，`apply()` 只注册 `skill/license-guard.md`，缺 `skills` 时 `logger.warn` 后 return（不报错）。规则集 `rules/0{1..5}-*.json`（GPL/弱传染/未知/自许可）**是可复用的数据**，但不导出库 API、不供 UI。→ 它答的是「依赖树的许可」、出口是 **agent 对话**；插件页要的是「每行的许可字段」→ **换的是出口不是底座**，判 🟡 不判 🟢 |
| `feely0208/dsh-sbom` | A 原生DSH | MIT ✅ | 通用（物料清单） | 重复可强化 | 🔵 | proposed | 2026-10-24 | ★1，**Shell**，2026-10-16 建仓 / 10-21 push。审的是 **SBOM 文件本身**（有没有、全不全、格式对不对、新不新），不是这个工作台的包。全词池 `dsh plugin sbom` **只命中 1 条** ⇒ 该轴在 DSH 生态只有这一个玩具 |
| `anxinyuanshiyu/dsh-plugin-zh-inventory` | A 原生DSH | ⚠ **npm `license` 为空** | 通用（插件清单中文化） | 重复可强化（插件页） | ⚠ 待核 | pending-license | 2026-10-24 | ★1，`dsh-plugin-zh-inventory@0.2.0` 的 `package.json` **无 `license` 字段**。功能是「给插件列表加中文表签与简述」—— 同一张表，但只做**文案**。**许可证未识别 → 不采用、不摘码** |
| `AphyTOT/dsh-plugin-preflight` | A 原生DSH | MIT ✅ | 通用（插件开发期） | 重复无增益 | 🔵 | proposed | 2026-10-24 | ★1，**零依赖**。校验的是**插件仓库自己**的 `dsh.bundle` / `cordis.patch.yml` 接线 / client bundle 形状 / peer 范围 → **作者侧发布前自检**，不是用户侧的装后台账。与 `dsh-radar-plugin-audit` 骨架同域 |
| `Tim-ReJet/dsh-plugin-doctor` | A 原生DSH | MIT ✅ | 通用（插件开发期） | 重复无增益 | 🔵 | proposed | 2026-10-24 | ★0，push 2026-10-04（三周未动）。审「仓库是否符合 dsh-plugin 上架规则」（manifest / bundle 行 / prerelease peer / 仓库年龄 / topic）→ 同为**作者侧上架体检** |
| `lookingsbfor/dsh-audit`、`dongsheng123132/dsh-license-obligation-proof`、`qingshanjiluo/dsh-security-audit` | A 原生DSH（混合） | MIT ✅ / MIT ✅ / **`null`** ⛔ | 通用 | 重复无增益 | ⛔ | rejected | 2026-10-24 | `dsh-audit`（★1）自称 CLI tool，2026-09-04 后无更新；`license-obligation-proof`（★0）是 MCP/证据链，非本仓形态；`dsh-security-audit`（★0）**无许可证红线**，仅登记 |
| `Gty2408/dsh-plugin-publish`、`KaramachiA217/dsh-bundle-manager`、`123twtd/dsh-plugin-manager`、`NewBeeJack/dsh-extension-manager` | A 原生DSH | MIT（均在白名单内） | 通用（插件管理） | 重复无增益 | ⛔ | rejected | 2026-10-24 | 四个「插件管理器/发布器」：发布器是**作者侧工具**；其余三个都要**自己的面板**管插件列表 —— 与插件页**同概念双入口**，且本仓 `pluginManager` 已有行级开关。`dsh-bundle-manager` ★1、2026-08-19 后无更新 |
| 同作者安全 guard 簇：`feely0208/dsh-plugins`（**无许可证**，市场索引，49 插件）、`feely0208/dsh-phishing-guard`（Python）、`feely0208/dsh-secret-scan`、`feely0208/dsh-env-audit` | A 原生DSH（混合） | `null` ⛔ / MIT | 通用（安全） | 全新（安全域，非本仓面板） | 🔵 | proposed | 2026-10-24 | 2026-10-16 同日三连发，★ 均 1。与本仓「插件依赖」页无交集 → 只登记一行备查；`dsh-plugins` 无许可证，**仅作线索源**、不摘码 |


## 2026-10-24 · B 组（第五十九轮 · **「笔记 → CC98 写出」轴**）· 追加

> 同日第 2 轮（承接 r58 的 A 组）。取组：今日 A 已跑 → 规则 2 `same-day(unused)`，B(17) < C(19) → **B**。
> 起点是读码：全仓 UBB 相关只有 `dsh-zhiyun-source-cc98/src/ubb.js`，且只有 `ubbToText`（**读**方向）；
> `markdownToUbb|toUbb|toUBB` **0 命中**；笔记页 `grep -i cc98` **0 命中** → **有进口、没出口**。
> 搜索 11 次（⚠ 超限 1 次，见报告 §5）、0 次 403、本轮完整。首次登记 9 行（含 2 行簇）。
> 骨架 `dsh-radar-cc98-ubb-bridge`（**B 类** · 能力提取 · 零依赖 · 零上游代码）。
> **自动验收四项全过**：报告/registry ✅；骨架 `json`+`yaml`+`node --check` ✅ 且 `apply()` 抛错 ✅；commit `5f76fec` 已 push 并由 `ls-remote` 验证 ✅；PR 复用滚动 PR #21（head 已前进到 `5f76fec`）✅。
> 已在册本轮只复核：`baihe26/zju-literature-downloader`（★35，push 10-23，维持 🟡）、
> `burriedalien666/zju842-practice`（★22，维持 🟡）、`memset0/Learning-at-ZJU-Helper`（★59 但 push 2024-12，维持 🟡）、
> `upupming/zju-grs-ics`（`null`，维持 ⛔）。

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `stevenstg/obsidian-cc98-publish` | **B 其他JS** | **MIT** ✅（GitHub `spdx_id` / `package.json.license` / `LICENSE` 三处一致） | 笔记 → 论坛（CC98 写出口） | **重复可强化**（判据①②③全成立） | 🟢 | proposed | 2026-10-24 | ★8，push 2026-10-19。Obsidian 插件（TS），**未发布 npm** → 只能锁 git 提交。核心三层 `md-to-ubb.ts`+`links.ts`+`convert.ts` = 1207 行**零宿主依赖纯函数**，实测可在 `node --experimental-strip-types` 下直接跑；`obsidian` 只出现在 `images.ts`/`settings.ts` 一类外围文件 → **能力提取**（非锁版挂载，`obsidian` 是虚拟模块装不上）。骨架 `dsh-radar-cc98-ubb-bridge` 已出。⚠ 三处存疑：**引用块丢 `[quote]`**、表格原样透传、硬换行原样；⚠ 读/写不对偶（内联代码含 `[b]` 时方括号被剥） |
| `Coran-tech/cc98-reborn` | B 其他JS | **MIT** ✅（`LICENSE` 1081 B 实读） | 论坛阅读 | **重复无增益** | 🔵 | proposed | 2026-10-24 | ★4，push 2026-10-16，**本簇最活跃**。Chrome/Edge 扩展（`manifest.json`，无 `package.json`）；`src/content.js` **1.1 MB 单文件**、`styles.css` 552 KB → **整站 UI 重构**，与本仓「数据层 + 原生页面」不同构。`markup-converter.js` / `extended-ubb.js` 可**只读借鉴**其方言覆盖面，**不摘码**。另含 `question-service/`（PHP+SQLite）与 `question-mark-sites-source/`（Next.js）两个子项目 |
| `ZJU-CC98/CC98.Achievement` | B 其他JS | Apache-2.0 ✅ | 论坛 | 全新（域外：成就系统） | 🔵 | proposed | 2026-10-24 | ★1，push 2026-07-20（3 月未动）。与阅读/写作均无关，登记备查 |
| `shellRaining/cc98` | B 其他JS | **MIT** ✅ | 论坛 | 重复且无增益 | 🔵 | proposed | 2026-10-24 | ★3，建仓 2026-07-08 / push 2026-10-16，18.5 MB。Vue3+Vite+ 第三方整站客户端 → 与「笔记导出」零交集，且是第二个论坛界面 |
| `EviterLesRoses2/cc98-mcp` | B 其他JS | **MIT** ✅ | 论坛 | **重复且无增益**（与 `dsh-zhiyun-source-cc98` 十方法逐条对应） | ⛔ | rejected | 2026-10-24 | ★4，仅 28 KB，只读 MCP。10 个工具与本仓 `cc98.*` 一一对应；形态是「给别的 Claude 用」而非本仓插件 |
| `lwsher/CC98_AI_frontend` | B 其他JS | **MIT** ✅ | — | 未知 | ⚠ 待核 | pending-relevance | 2026-10-24 | ★4，2026-08-12 建仓 / push 2026-09-06。**仓库 description 为空**、README 未取到 → **相关度不明**，许可证虽明确但按「阶段 3 第 8 条」不采用、不排期，待人工看一眼 |
| `zjufishboy/TalkTrue` | B 其他JS | **MIT** ✅ | 选课/评课 | 全新（域外） | 🔵 | proposed | 2026-10-24 | ★3，**2023-01 停更**。「内网版浙大查老师（CC98 言果平台）」，**只有前端**，后端不在仓里 → 不可独立运行 |
| `biu9/cc98-summary` | B 其他JS | **`null`** ⛔ | 论坛 | — | ⛔ | rejected | 2026-10-24 | ★14（本簇最高星），**无许可证红线**，只登记不摘码；description 为空、2026-04 后未动 |
| `Slowist-Lee/cc98-highlight` | B 其他JS | MIT ✅ | 论坛 | 重复无增益 | 🔵 | proposed | 2026-10-24 | ★1，2025-07 停更；浏览器端高亮脚本，与数据层无关 |
| `Aleph-000/cc98-cleaner`、`walavave/CC98-CLI` | B 其他JS | **`null`** ⛔ / MIT ✅ | 论坛 | 重复无增益 | ⛔ / 🔵 | rejected / proposed | 2026-10-24 | `cc98-cleaner` ★4 **无许可证** → 不摘码；`CC98-CLI` ★5 与本仓已登记的 `Lucent-Snow/CC98-CLI`（★19）同型且更小 → 取已在册那条 |
| `sel-fish/md2ubb`、`varHarrie/md2ubb`、`zjjncsn/markdown-to-ubb` | B 其他JS | MIT / MIT / **`null`** ⛔ | 笔记 → 论坛 | 重复且无增益 | ⛔ | rejected | 2026-10-24 | 同为 Markdown→UBB 但各有一条硬伤：`sel-fish` ★3 是 **Python**（技术栈不符）；`varHarrie` ★2 **2017-04 停更**且不认识 `[size=7]`/`[bili]`/`[upload]`；`zjjncsn` **无许可证**。**同簇归一取一**，取 `obsidian-cc98-publish` |
| `AsukaSong/react-ubb-editor` | B 其他JS | WTFPL | 论坛 | 重复无增益 | 🔵 | proposed | 2026-10-24 | ★3，**2021-08 停更**。React UBB 编辑器组件；本仓 CC98 只读，不需要第二个编辑器 |

## 2026-10-24 · C 组（第六十轮 · **学习活动的日粒度底色 / 连击**轴）

> 同日第 3 轮。脚本判 `same-day(unused)` → C，与人工一致。**先读码找断环**：`grep -rniE "heatmap|热力|streak|连击|打卡|contribution"` 全仓 **0 命中**，
> 而 `core-quiz/src/store.js` 的 `attempts`（`makeAttempt` 带 ISO `at`）与 `core-study/src/learning-space.js` 的 `updatedAt` 都已落盘 → **数据在、出口没有**（r53/r54/r59 之后第四次同型）。
> 12 次搜索（10 主搜 + 2 定向探针，**⚠ 超限 2 次**，理由见报告 §5.1）、0 次 403，本轮完整。有效候选 4 行（簇内合并 12+ 条）；🟢1 + 🔵3 + ⛔4；骨架 `dsh-radar-activity-heatmap`（**B 类**，锁版 `react-activity-calendar@3.2.1`）。

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `grubersjoe/react-activity-calendar` | B 其他JS | **MIT** ✅ | 学习节律（全页底色） | **全新**（补缺视图，**非强化**） | 🟢 | skeleton-created | 2026-10-24 | ★599，TS，push **2026-10-21**。npm `3.2.1` 实核：`peerDependencies` 仅 `react ^18\|\|^19`；`dependencies` = `date-fns@^4.2.1` + `@floating-ui/react@^0.27.19`；`exports` 含独立 `./tooltips.css`；`type: module`。**判据③不成立**：本仓 `grep heatmap/热力/streak` = 0，无被替换的底层 → 这是「无→有」，判 🟢 的理由是「接进来就有东西看、不新增页面/存储/开关」（与 `cytoscape.js`/`temml` 同处置），**定性须人工拍**。⚠ **唯一真成本**：两传递依赖会撞 `scripts/build.mjs` + `tests/build-seeds.test.mjs` 的「零 node_modules 进包」断言 → README 的 TODO-B-1 把「打包策略」写成**阻塞项**（A 全 bundle / B 加 external / C 去 tooltip），出数前不得升「已采纳」。已出骨架 `dsh-radar-activity-heatmap` |
| `fishdev20/shadcn-heatmap` | B 其他JS | MIT ✅ | 同上 | 重复（簇内落选） | 🔵 | proposed | 2026-10-24 | ★39，push 2026-08-20。**copy-paste 组件**（shadcn 范式：源码搬进你的仓）→ 与本仓「不搬运上游源码」直接相反；主题绑 tailwind/shadcn（本仓是裸 CSS + `shell-ui` 令牌）。仅作配色与交互参考 |
| `Richardsl/heatmap-calendar-obsidian` | B 其他JS（Obsidian 插件） | **Apache-2.0** ✅ | 笔记（活动日历） | 重复（簇内落选） | 🔵 | proposed | 2026-10-24 | ★961（簇内最高），**但**：Obsidian 插件（`obsidian` 为宿主注入虚拟模块、装不上，r59 已确证该形态）、npm **404**（只以插件形式分发）、push **2025-02-10（20 个月未动）** → 不可嵌入。只借它的分层范式：「数据源 / 配色 / tooltip 文案」三件拆干净 |
| `pearpages/heatmap`(MIT,★0)、`Sylvo6642/CommitGrid`、`arnabjena007/gitmap`、`n4tly-darkgonet/Bloom`、`mhuzaifa0/HabitTrack`、`Harshil1335/HabitForge` | B 其他JS | MIT 1 条 / `null` 5 条 | — | 重复无增益 | ⛔ | rejected | 2026-10-24 | `github-style contribution heatmap react` 全站仅 **6 条**（产品词极窄）：**5 条 ★0**、4 条无许可证。唯一 MIT 的 `pearpages/heatmap` 亦 ★0 且无发布 → 全部未经使用验证，不能作底座 |
| 习惯追踪 App 簇：`iotawise`(★263)、`s-petr/longhabit`(★127)、`DoHabit`(**AGPL-3.0**,★63)、`n4ze3m/habit-watcher`(★51)、`takanome-dev/habit-tracker-app`(★48)、`vincenzo-afk/Synapse`(★39)、`hasibhaque07/open-source-habit-tracker-app`(★37) 等 10 条 | B 其他JS | MIT / **AGPL-3.0** | — | 重复无增益 | ⛔ | rejected | 2026-10-24 | `habit tracker react language:typescript`(1584) ★ 头部。**共性硬伤**：每条都自带完整存储层（SQLite / Prisma / Cloudflare D1 / Expo SecureStore）。本仓「今天要做什么」已在 `page-planning`、数据在自己手里 → 接进来 = **第二套待办 + 第二份落盘**，正是强化原则明令禁止的形态。`DoHabit` 另触许可证红线 |
| 学习统计 / 番茄钟成品：`Hassanmahmood4/StudyPilot`(★23,`null`)、`TheusHen/study-dashboard`(★3)、`hema-code06/Learning_Analytics`、`rabinregmi188/StudyTracker`、`AAAAAshainiya/ielts-study-dashboard` 等 9 条 + `pomodoro statistics react` 前 8 条 | B 其他JS | 多数 `null` / MIT | — | 无关或重复无增益 | ⛔ | rejected | 2026-10-24 | ★ 全 ≤23 且 `null` 居多；`pomodoro statistics react` 前 8 条 **★全 ≤1**。与 r54（专注计时底座）同结论：**这类能力的底层在 npm，GitHub 上只有成品 App** |
| `mrmagic2020/Wrong-Question-Notebook`(★6)、`helemazuba-boop/Wrong-Question-Notebook`(★2，同名 fork) | B 其他JS | **GPL-3.0** ⛔ | 刷题（错题） | — | ⛔ | rejected | 2026-10-24 | **许可证红线**（fork 同许可，两条都排除）。本轮唯一真做「错题本」的仓，**不得摘取任何代码**，仅作形态参考 |
| `ninime09/quiz-builder` | B 其他JS | MIT ✅ | 刷题 | 重复无增益 | ⛔ | rejected | 2026-10-24 | ★3，单文件 HTML 生成器（资料 → 自包含离线答题页）。**输出形态与本仓相反**：本仓题库要落 `quiz_*` 三轨道并与复习调度共用，它产出的是"不再回流的文件" |
| token 用量族（借 `dsh plugin stats` 复核）：`PolinniZhong/dsh-personal-center`(★113,MIT)、`songoao25/dsh-bottom-info-bar`(★51,MIT)、`lanlandeli/dsh-usage-stats`(★11,**NOASSERTION**，在册 ⚠) | A 原生DSH | MIT / NOASSERTION | 通用 | **重复无增益**（第 6 次） | ⛔ | rejected | 2026-10-24 | `dsh plugin stats` 前十里 **6 条**是 token 用量/成本/热力图。注意**名字欺骗性**：`dsh-personal-center` 的 description 自述「Token 用量统计 / 成本估算」、`dsh-usage-stats` 自述「年度活跃热力图」——**"个人中心"/"活跃"在 DSH 生态里≈token 用量**，选型时须读 description 不读名字。10-19 已判该簇 ⛔（13 家），本轮不再逐条登记 |

### 第六十一轮 · 2026-10-24 · A 组

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `chen8923/dsh-task-progress` | A 原生DSH | MIT ✅ | 通用（长任务） | **重复但无增益**（不同面板/不同数据源） | 🔵 | proposed | 2026-10-24 | ★0，push 2026-09-24，零依赖，**可锁版** npm `0.3.0`。给外部脚本开「jsonl 进度文件 → 会话头胶囊 + 右侧栏」的第二通道。强化三判据 ①②③ **全不成立**（它是全局任务面板，讲义的进度是本仓 `assemble()` 自算的），故不出骨架。**可白拿的三条做法**：按卷序报（前缀和）/ 上报节流 250 ms / 超 30 s 无上报补一条「重试中」提示 |
| `MorixMa/dsh-download-progress` | A 原生DSH | MIT ✅ | 通用（下载） | 无关（会话头插槽） | 🔵 | proposed | 2026-10-24 | ★0，push 2026-10-17。**npm 404 不可锁版**。注册在 `conversation.session.header.utilities`，不在本仓 `zhiyun.*` 插槽体系内。工程完成度最高（`dsh-plugin.json` 逐条声明权限+scope+reason），可作**manifest 范本** |
| `Asong6824/dsh-llm-rate-limit` | A 原生DSH | MIT ✅ | 通用（LLM 限流） | **可强化但属基础设施层**（非单面板） | 🔵 | proposed | 2026-10-24 | ★2，push 2026-08-20，**可锁版** npm `0.1.1`。provider 级 RPM/TPM + 并发 + FIFO + 429 冷却，进程内状态、不重试。是 `polish.js` 内 `limiter.run` 的上位替代，但接管整进程所有 LLM 调用 → 判据①不成立，属**部署层决策** |
| `orangeofcarl0-sys/dsh-large-proj-perf` | A 原生DSH | MIT ✅ | 通用（性能） | 重复且无增益 | ⛔ | rejected | 2026-10-24 | ★2，push 2026-10-23，可锁版 npm `1.3.3`。解决**超大会话前端渲染**（fork/projection/chunked materialize），与本轮「LLM 进度」仅共享 `chunked` 一词。本仓学习页 `sessionRows(limit=30)` 无此场景 |
| `HuanLinOTO/dsh-plugin-yet-another-subagent` | A 原生DSH | **NOASSERTION** ⚠ | 通用（子代理） | — | ⚠ 待核 | proposed | 2026-10-24 | ★18，push 2026-10-18。可配置 subagent profile + 实时进度/子代理树。**许可证待人工核验，不采用、不摘取任何代码** |
| `Jackson366/dsh-plugin-learning-accelerator` | A 原生DSH | **MIT** ✅（本体）/ ⛔ **上游无 LICENSE** | 刷题 / 复习节奏 | **重复且无增益**（跨页面全局能力，非单面板强化） | 🔵 | proposed | 2026-10-24 | ★0，push 2026-10-21，JavaScript，**零 dependencies**（4 条 `@deepseek-ai/*` peer）。**npm 404 不可锁版**（仓库 `0.2.2`）。把上游 skill `Maolipeng/Learning-Accelerator` 移植为 harness 原生（两条 `systemPrompt` 运行时上下文 + 确定性间隔重复 + 5 个工具）。**⚠ 上游仓库 `LICENSE` = 404 无许可证** → 不得摘取其协议内容。**可白拿两条**：①`systemPrompt` 按需注入（有状态才注入，否则零 token）②`tests/store-equivalence.test.js` 用同一串操作跑 Python/JS 双实现、要求 `state.json` **逐字节相同** —— 本仓 50+ 骨架无一有这层，可作「移植等价性测试」范本 |
| `windli93/dsh-anki-plugin` | 待判（`language=null`） | **`license=null`** ⚠ | 复习（Anki 形态） | 无法判定（信息不足） | ⚠ 待核 | proposed | 2026-10-24 | ★0。描述仅 `deepseek harness anki plugin`。**npm `dsh-anki-plugin` = 404**。**⚠ 查询中途撞 GitHub API 403，LICENSE/README/提交历史均未核实** —— 故标「待核」而非直接 ⛔。人工 30 秒可结案：看根目录有无 `LICENSE`、`package.json.license`、`cordis.patch.yml` |
| `leinasi2014/dsh-agent-swarm` | A 原生DSH | MIT ✅（列表页口径） | 规划 / 多 agent | **重复且无增益**（同 `dsh-agent-teams` 域） | ⛔ | rejected | 2026-10-24 | ★2，TypeScript。Durable multi-agent Team orchestration + budgets + memory。与已登记的 `NanmiCoder/dsh-agent-teams`（★2366，**已有骨架 `packages/dsh-radar-agent-teams`**）同能力域，★差三个数量级；且该骨架自身另有未解决阻塞项（全局 `tools` 表 + system prompt 注入）→ 再进同域候选只增评审负担，不构成强化 |
| `Auspiow/ZYNotes` | B 其他JS | **无许可证** ⛔ | 智云课堂 PPT+字幕 → 讲义 | **重复且可强化（但无证不可取码）** | ⛔ | rejected | 2026-10-25 | ★8，Chrome 扩展，push 2025-11-27（约 11 个月未更新），`license: null`。**价值在「问题证据」不在代码**：它写了 `isSameImage()`，说明智云回放页的 PPT 序列里**确实有重复帧**。⚠ **算法不可照抄**：`inject.js:556-562` **只与相邻上一张**比对 → 对「A→B→A→C」回看**命中率为 0**（实测 6 页一页未删）。**另一发现（本轮实质产出）**：本仓 `buildLectureTree` 的标题判据 `pageCountOf>=2`（`tree.js:366`）会被回看副本**误满足**，把正文行升级成吞页伪知识点（实测 5 页树裂成 2 个节点、2 个真标题消失）→ 已出骨架 `packages/dsh-radar-slide-dedup`（**自建实现，零代码采用**） |
| `He1438911443/n8n-zju-news-agent` | B 其他JS | **MIT** ✅ | 校园通知 → 个性化日报 | **全新**（本仓无通知聚合能力） | 🔵 | proposed | 2026-10-25 | ★1，建仓 2026-01-19 后无提交，实体是 **n8n workflow JSON + Tampermonkey 脚本**，无复用模块。**需求证据价值**：「教务网/办公网/学院官网/就业网 分散 + 错过截止」的产品叙事比 10-16 的 `zju-bulletin-board`（无证）更完整。**不取码、不出骨架**；将来做「今天」页通知源**由本仓自建** |
| `YangShu233-Snow/Learning_at_ZJU_third_client` | B 其他JS（Python） | **NOASSERTION** ⚠ | 学在浙大（课程/回放） | 重复可强化（但**栈不符**） | ⚠ 待核 | pending-license | 2026-10-25 | ★88，push **2026-10-23**（本轮最活跃）。学在浙大第三方客户端，争取覆盖网页端绝大部分功能。**许可证待人工核验，不采用、不摘码**。即便核验通过，Python 栈与本仓正交，最多作接口形状参考 |
| `awmleer/zju-library` | B 其他JS | **无许可证** ⛔ | 图书馆（座位/借阅） | 全新（场景本仓没有） | ⛔ | rejected | 2026-10-25 | ★22，TypeScript，**2022-05 后停更**，`license: null`。图书馆座位预约场景本仓空缺，但无证 + 四年停更 → 出局，不留需求证据 |
| `biu9/cc98-summary` | B 其他JS | **无许可证** ⛔ | CC98 帖子摘要 | — | ⛔ | rejected | 2026-10-25 | ★14，TypeScript，push 2026-04-02，`license: null` 且无描述。无证 → 不碰 |
| `ZJUSCT/mirror-front` | B 其他JS | **MIT** ✅ | 校园镜像站前端 | 无关（非学生场景） | 🔵 | proposed | 2026-10-25 | ★36，TypeScript，push 2026-10-20。ZJU 镜像站前端。与本仓任一页面无交集，**仅登记** |
| `quark-zju/vscode-line-history` | B 其他JS | **MIT** ✅ | 编辑器行历史 | 无关 | 🔵 | proposed | 2026-10-25 | ★13，TypeScript。VSCode 行级编辑历史追踪插件。属作者个人工具，与学习工作台无关 |
| `CrazySpottedDove/fiz` | ⛔ 非 JS 栈（Rust） | **无许可证** ⛔ | 学在浙大第三方 | — | ⛔ | rejected | 2026-10-25 | ★56，Rust，push 2025-11-11，`license: null`。双红线：栈不符 + 无证。与 `Learning_at_ZJU_third_client` 同域，两者均不可用 |
| `xlab-hackson/zju-agent` | B 其他JS | **无许可证** ⛔ | 校园问答 agent | — | ⛔ | rejected | 2026-10-25 | ★1，TypeScript，建仓 2026-07，`license: null`。★1 + 无证 + 无描述，出局 |

### 第六十四轮 · 2026-10-25 · B 组 · 轴「学分核对 / 培养方案达成度」

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `Kepler16f/zju-kezhou` | B 其他JS（Flutter App + 纯 stdlib Python 引擎） | **MIT** ✅（`LICENSE` 1,664 B 逐字 MIT 正文 + 「第三方说明」附件；GitHub spdx 因附件报 `NOASSERTION`，**已通读全文**判定为 MIT） | 学分核对 / 培养方案 / 选课风险 | **重复且可强化** | 🟢 | proposed | 2026-10-25 | ★0，建仓 2026-10-15、push 2026-10-21（6 天 8 次迭代，`ENGINE_VERSION=1.7`）。**非 DSH 插件（无 `cordis.patch.yml`/`package.json`，contents API 实测 404）、npm 无包** → 不能锁版挂载，只能 vendor。可复用资产：`engine/`（`audit.py` 54 KB + `common.py` 3 KB，纯 stdlib）+ `schema/`（`plan`/`record`/`report` 三份 JSON Schema 2020-12）。**强化三判据全成立**：①落点是 `reads.js` 的 `earned_credits`，本包 `inject=[]` **没有 slots 注入点，结构上不可能新建页**；②现有=一个总数，接入后=同一数的模块拆分（同粒度不同层次）；③上游有本仓全无的口径：选课组「至少 N 门」折算、外语 L1/L2/L3 封顶、`selected_no_credit` 与 `earned` 分列、在修证据降级 red→yellow、并列选项组取最优、结论可回方案页码。**明确不取** `assets/`（OFL 字体）、`compass_app/`（Flutter）。骨架 `packages/dsh-radar-credit-audit`，TODO-0（vendor 方式）/TODO-1（学期口径）为阻塞项 |
| `Jnove/ZJUCoursetrace` | B 其他JS（React Native/Expo，TypeScript） | **MIT** ✅ | 课表 / 成绩 / 考试 | 重复且无增益 | 🔵 | proposed | 2026-10-25 | ★3，push 2026-10-08，`package.json` 45 个依赖（Expo 54 全家桶），**npm 404**。`lib/` 下有 `ics-export.ts`/`grade-watcher.ts`/`calendar-service.ts`，与本仓 `dsh-radar-ics-export` 及 `source-zdbk` 的 grades/exams **同域**。唯一可确认的价值是架构决策：v2.0.0 起**移除后端、认证全在客户端**（与本仓「数据不出本机」一致，属**确认**而非增量）。不取码 |
| `bfyes/ZJUSCORE` | B 其他JS（Tampermonkey 单文件） | **MIT** ✅ | 学在浙大页内成绩标注 | 重复且无增益 | 🔵 | proposed | 2026-10-25 | ★1，push 2026-09-09，仓库 34 KB / 单文件 `zjuscore.user.js`。**价值在数据源发现**：它把成绩**内联标注进学在浙大课程活动列表**，说明该列表已带可解析的成绩字段 → 对本仓 `dsh-zhiyun-source-xxt` 有线索价值。无可复用 JS 模块 |
| `memset0/Learning-at-ZJU-Helper` | B 其他JS（userscript + webpack） | **MIT** ✅ | 学在浙大 / 智云课堂辅助 | 重复且无增益 | 🔵 | proposed | 2026-10-25 | ★59（本轮第二高），但 **push 2024-12-05（23 个月未动）**。功能（学在浙大/智云）已被本仓 `source-classroom` + `source-xxt` 覆盖；构建链是 webpack 打包 userscript，无可嵌入模块。**★ 高不等于值得接** |
| `eWloYW8/ZJU-course-material-download` | B 其他JS（userscript） | MIT ✅ | 下载学在浙大课件 | 无关 | ⛔ | rejected | 2026-10-25 | ★14，push 2026-01-24。description 自述「下载**无权限**的课件资源」→ **用途是绕过访问控制**，与本仓「只读自己有权访问的数据」边界冲突。**排除理由不是许可证，是用途**；不取码、不作需求证据 |
| `ADSR1042/Lazuli` | B 其他JS（浏览器插件） | **GPL-3.0** ⛔ | 选课助手 + 老师评分 | — | ⛔ | rejected | 2026-10-25 | ★50，push 2025-06-20。**许可证红线**，只登记不摘码。功能域与已登记的 `mycoursereviews` 重合 |
| `PeiPei233/zju-score-push-template` | B 其他JS | **`license: null`** ⛔ | 成绩更新推送（钉钉） | — | ⛔ | rejected | 2026-10-25 | ★26，push 2024-06-26。无证 + 停更 16 个月 |
| `Colamentos2023/ZJU_NewScoreGetter`（★2）、`YooLc/zju-score-monitor`（★2，MIT 但 2023 停更） | B 其他JS（Python） | **`null`** ⛔ / MIT | 成绩爬取 / 钉钉机器人 | 重复无增益 | ⛔ | rejected | 2026-10-25 | 「成绩出分推送」本轮**再次**四次撞到无证或停更（10-16 已有 `zjuGradeMonitor`、`ZJU-GRADES` 两条同因出局）→ 该能力在 GitHub 上只有个人爬虫、无可复用底座，**建议封板 3 个月** |

### 第六十五轮 · 2026-10-25 · C 组 · 轴「时间预算：截止时间是点，还是块」

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `SifisoScS/scheduler` | B 其他JS（TS 值对象库） | **MIT** ✅（spdx MIT；`LICENSE` 1,066 B；`package.json.license=MIT`） | 截止时间 / 周期计数 | **重复且可强化**（但增益不足） | 🟡 | proposed | 2026-10-25 | ★0，建仓 2026-10，push 2026-10-13，**npm 404（`registry.npmjs.org/@sifiso-guy%2Fscheduler` → Not Found）**。源码 13.1 KB 全文通读：只导出 `Deadline` + `Interval` + 两行 `validate`，是**值对象层不是调度器**。增益核算：本包需要 5 个语义，上游只覆盖 2 个（`msUntil` / `countBetween`），二者自写共约 7 行 → 判据③只部分成立，故 **🟡 不是 🟢**。硬约束：`new Deadline(null)` 抛错（本仓 `due:null` 是常态）、`everyMs` 只能等距（课表 13 节次有 3 种间隔 {50,70,105}）、`occurrencesBetween` 物化且上限 1000。骨架 `packages/dsh-radar-deadline-budget`，TODO-0（npm 404：等发布/vendor/自写 三选一）为阻塞项 |
| `yhwlwl/study-planner` | B 其他JS（React+PWA，TS） | **AGPL-3.0** ⛔ | 学习计划排期 / schedule repair | 重复（排程引擎） | ⛔ | rejected | 2026-10-25 | ★7/4 fork，push 2026-08-22，`src/lib/planner.ts` 160 KB + `conflicts.ts` 18.8 KB + `versions.ts` 7.5 KB，topics 含 `constraint-scheduling`/`schedule-repair`/`minimal-disturbance`。**`LICENSE` 34,022 B 全文 AGPL-3.0**（首行写明 AGPLv3-or-later）→ 许可证红线，**只作需求证据、零代码摘取**。需求证据价值高：它证明「改计划要尽量少改（minimal disturbance）+ 先出候选再应用（preview before apply）」是真实产品需求，而本仓 `plans.js`/`pet.js` 无此概念。→ 该能力**只能自建**（§7-4） |
| `a2105z/Chronos` | B 其他JS（Python） | MIT ✅ | 约束感知时间块排程 | 无关 | ⛔ | rejected | 2026-10-25 | ★0，push 2026-08-19。**Python，非 JS 栈**（能力描述「schedules tasks under availability and hard constraints」有价值，但栈不符） |
| `KarimBk7/ReflowTask` | B 其他JS（Java） | MIT ✅ | 错过时间块自动重排 | 无关 | ⛔ | rejected | 2026-10-25 | ★0，push 2026-09-29。**Java，非 JS 栈**。能力描述「missed blocks are replanned automatically」与上一条同域 |
| `pchinso/time-blocks-app` | B 其他JS（TS） | **`license: null`** ⛔ | 10 分钟粒度时间块 | — | ⛔ | rejected | 2026-10-25 | ★0，push 2026-01-07，仓库 82 KB。无证出局 |
| `nishit546/OpenPrep-AI` | B 其他JS（JS/React） | MIT ✅ | 考试备考工作区 | 重复且无增益 | 🔵 | proposed | 2026-10-25 | ★20（本轮最高）、push 2026-10-24（活跃）、20.9 MB。形态是**一整个备考工作区**（笔记解析 + PYQ + 自动排程 + Quiz），与本仓「学习/论文/今天/规划」四页**全域重叠** → 接它 = 第三套实现。不留模块 |
| `itssourov13/study-planner-apk` | B 其他JS（RN/Expo） | MIT ✅ | 离线学习计划 App | 重复且无增益 | 🔵 | proposed | 2026-10-25 | ★3，push 2026-07-16。RN 整包 App，无可嵌入模块 |
| `TiagoSBittencourt/Smart-Schedule` | B 其他JS（TS 全栈） | MIT ✅ | 生成周学习计划 | 重复且无增益 | 🔵 | proposed | 2026-10-25 | ★3，push 2025-07-22。全栈 Web（含后端），与本仓「数据不出本机」相悖 |
| `nizarmah/calendar-javascript-lib` | B 其他JS（JS） | MIT ✅ | 日历/事件库 | 重复且无增益 | 🔵 | proposed | 2026-10-25 | ★70（本轮第二高），但 **push 2021-02-20（5 年 8 个月停更）**，且本仓 `buildMonthCalendar` 已自写日历视图 |
| `ramya0715/Student_Study_Planner` | B 其他JS（JS） | **`license: null`** ⛔ | 学习计划 | — | ⛔ | rejected | 2026-10-25 | ★70、push 2026-01-22，但 **无描述 + 无证**。本轮「★ 高 ≠ 可接」第二样本（第一是 r64 `Learning-at-ZJU-Helper` ★59 停更 23 个月） |

---

### 第六十六轮 · 2026-10-25 · A 组 · 轴「重复规则的不变量：每两周 / 假期 / 撤销」

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `MAGMA27/dsh-calendar` | A 原生DSH（双面插件：`dsh.bundle.patch` + `dsh.client`） | **Apache-2.0** ✅（GitHub `spdx_id`；仓库根 `LICENSE` 11,338 B **逐字读过全文**，无附加限制；npm `license` 同口径） | 规划 / 重复规则 / 日历视图 | **重复且可强化** | 🟢 | proposed | 2026-10-25 | ★1，建仓 2026-08-19，push 2026-10-01；npm **`@magma27/dsh-calendar@0.1.7`**（`dist-tags.latest`，2026-10-01 发布）→ **可锁版**。**宿主窗口一次对上**：README 明写 targets DSH `0.2.0-rc.2`，与本仓 `runtime.lock.json.preferredHostVersion` 一致（A 类第四道门首次免争议通过）。**判 🟢 的依据是「有本仓没有的口径」不是星数**：`materialized`（已生成日期记账、日粒度幂等）/ `originTaskId`（副本回链模板）/ `alignSeries`（规则收窄时剪副本并清账）/ `skipHolidays` 与推进解耦 / `<RepeatScopeConfirm>` 三问（这次·系列·取消）。**⚠ 整包是 UI 插件**：`client/index.ts:97/104/113` 注册 `shell.overlay` / `sidebar.footer.action` / `settings.plugins.tab` → 判据①**只在「只取 `src/core/repeat.ts`」时成立**，故骨架 `mountUpstreamUi: false`、patch 的 id 故意改名避免与上游 `ui-calendar` 双挂。骨架 `packages/dsh-radar-repeat-law`，TODO-0（npm `exports` 只开 `.`/`./src/*`/`./client`/`./invariant`，`lib/core/repeat.js` 无子路径 → R1 阻塞）待拍板 |
| `Chinesezjc/dsh-tool-todo-tree` | A 原生DSH | **MIT** ✅ | 会话内任务树 | 重复且无增益 | 🔵 | proposed | 2026-10-25 | ★6，push 2026-09-23，npm **`dsh-tool-todo-tree@0.5.0`** 可锁版。`todo_write` 的**树形替代**（会话内工具），与本仓「规划」页本地条目是**两个数据源、两个界面**；接入需替换会话工具语义 → 无增益。不取码 |
| `XiaoWind/dsh-cron` | A 原生DSH | **MIT** ✅ | Agent 定时循环 | 无关（agent 调度 ≠ 人的日程） | ⛔ | rejected | 2026-10-25 | ★0，push 2026-09-29，`package.json` version `0.1.2`、**未发布到自己的 npm 包**（README 明写「只写 `dsh-cron` 会去 npm 查找、安装会失败」，须 `github:owner/repo` 规格）。**⚠ 方法论样本**：npm 上确有 `dsh-cron@0.1.0`，但那是**另一个包**（description = Cron 解析库、`repository` 为空）→ 「npm 有同名包」≠「本仓库发布了」。功能是 `/cron` 斜杠命令，与本仓「学生自己的重复待办」不同域 |
| `XiaoWind/dsh-loop` | A 原生DSH | **MIT** ✅ | Agent 定时循环 | 无关 | ⛔ | rejected | 2026-10-25 | ★1，push 2026-09-29。`/loop` 斜杠命令，同上域。npm `dsh-loop` 已 `unpublished`（registry 元数据 `time.unpublished`）→ 不可锁版 |
| `Stolyarovmn/dsh-schedule-tab` | A 原生DSH | **MIT** ✅ | 全局提醒面板 | 重复且无增益 | ⛔ | rejected | 2026-10-25 | ★1，push 2026-10-08，npm `dsh-schedule-tab` **404**。README 自述「builds from a **pinned source snapshot of DSH `0.2.0-rc.2` TaskManagerPage/TaskDetail** and applies one narrow row-actions patch」→ **复制宿主页面再打补丁**，与本仓「不搬运上游源码」硬边界冲突。**排除理由不是许可，是做法**（建议写进 skill 硬边界清单） |
| `moziforge/calendar-plugins` | A 原生DSH | **Apache-2.0** ✅ | iCloud 日历（CalDAV） | 全新（场景本仓没有），但不可接 | ⛔ | rejected | 2026-10-25 | ★0，push 2026-09-17。把 CalDAV 事件暴露成 4 个 agent tool。**三条硬伤**：① 需用户提供 iCloud **应用专用密码** → 违反「无独立 API key/账号」原则；② `@moziforge/calendar-icloud-plugin` npm **404** 不可锁版；③ 方向相反（它是「读外部日历」，本仓缺的是「把计划写出去」，后者已有骨架 `dsh-radar-ics-export`） |
| `qgd1850890306-rgb/dsh-todo-checklist` | A 原生DSH | **MIT** ✅ | 划词加待办 / 到期提醒 | 重复且无增益 | ⛔ | rejected | 2026-10-25 | ★2，push 2026-10-20，npm `dsh-todo-checklist@1.5.12` 可锁版。功能域（划词加待办 / 对话自动捕获 / 左侧栏面板 / 到期提醒 / 导出）与「今天」页 + 「规划」页**全域重叠**，且没有本仓缺的口径（它是待办清单，不是重复规则） |
| `shuxidemosheng/dsh-tool-todo-plus` | A 原生DSH | **NOASSERTION** ⚠ | 会话内任务清单 | — | ⚠ 待核 | pending-license | 2026-10-25 | ★96（本轮最高）、push 2026-10-18，官方 `todo_write` 的**增强 fork**。**许可证待人工核验，不采用、不摘取任何代码**。⚠ 额外风险：血缘上是「官方工具的 fork」，即便许可核清，也属「搬运上游」范畴，需另议 |
| `runcat-tommy/dsh-panda-calendar` | A 原生DSH | MIT ✅ | 日历（公历/农历/节气/天气） | 重复可强化（今天页） | 🔵 | proposed（**维持原判，不升不降**） | 2026-10-15 | **复用户态复核**（非新候选，仅补一行「后来者关系」）：r66 从 `dsh plugin schedule` 再次命中，registry 已有登记（`:235`，判 🔵「需裁定」）→ 不改判。它与本轮 `MAGMA27/dsh-calendar` **能力正交**：前者解决「日历从哪来」（公历/农历/节气/天气/调休），后者解决「重复规则的语义」（记账/回链/剪枝/跨假期）。⚠ 若将来两条都接，需裁定「日历视图」由谁渲染 —— 那是 `page-planning` 的 `buildMonthCalendar` 归属问题，不在本轮 |
| `8eoyw/zju-learning-cli` | B 其他JS（实为 Python，见备注） | **MIT** ✅ | 学在浙大/智云课堂 CLI（同步/PPT→PDF/转录/待办） | **重复且可强化**（只取契约不取码） | 🟢 | proposed | 2026-10-25 | ★14，push 2026-10-21，`LICENSE` 1,137 B 逐字读过无附加限制。**语言不是 JS**（Python，单文件 1,542 行、PEP 723 依赖），按 B 类「JS 栈」本不该计分 → 仅因本轮用途是「读别人的端点取舍」而计 🟢，评审可降为 🔵。价值点：`zju.py:739` 的 `ACT_TYPES` 给出真机活动类型 **13 种**（本仓 `docs/todos-vs-zju-mcp.md:53` 引用的 `TODO_TYPE_CN` 在仓库里**完全不存在**）；`zju.py:807-815` 判「进行中」用 `is_closed/is_started` 而**不读 `published`**。⚠ 它的 `todo` 命令也直接打印 `todo_list`（`zju.py:1117`），**不能证明聚合端点不漏**。骨架 `dsh-radar-todo-fence` |
| `ZakWang1229/zju-cli` | B 其他JS（实为 Python） | **无许可证** ⛔ | 待办/课程/作业/课表/回放音频 | 重复且无增益 | 🟡 | pending-license | 2026-10-25 | ★1，push **2026-10-24**（本轮最新）。功能表与「今天/规划」页高度重合。**`license: null` → 不得摘取任何代码**，仅可作需求证据。判 🟡 而非 ⛔ 的理由：领域完全对口、仍在活跃，一旦补上许可即可重评 |
| `linhuiyu123/zju-course-notes-skill` | B 其他JS（实为 Python） | **MIT** ✅ | 课程笔记 → ChatGPT/Notion | 重复且无增益 | 🔵 | proposed | 2026-10-25 | ★0，push 2026-10-22，29 KB。形态是 skill（提示词+脚本），与「讲义」链路（`dsh-zhiyun-core-lecture`）同域且不可复用为库。作者自述「附维护者个人规范，仅供参考」→ 不建议接入 |
| `macanine/zju-vibe-skill` | B 其他JS（实为 Python） | **MIT** ✅ | 「Vibe ZJU」 | 无法判定 | 🔵 | proposed | 2026-10-25 | ★0，push 2026-10-14，description 仅四字、无 topics、无 README 摘要 → 信息不足，只登记 |
| `YangShu233-Snow/Learning_at_ZJU_third_client` | B 其他JS（实为 Python） | **NOASSERTION** ⚠ | 学在浙大第三方客户端（全功能） | 重复且可强化 | ⚠ 待核 | pending-license | 2026-10-25 | ★88（本轮最高），push 2026-10-23。**许可证待人工核验，不采用、不摘取任何代码**。⚠ 即便核清：它是「争取实现绝大部分网页端功能」的整站客户端，与本仓 6 个 `source-*` 包**大块重复**，且 Python 侧不可直接复用 |
| `Gvrzizo/lazy-tui` | B 其他JS | **无许可证** ⛔ | LAZY CLI 的 TUI 前端 | 无关 | ⛔ | rejected | 2026-10-25 | ★7，**C++**，`license: null`。两条硬门槛同时不过（非 JS 栈 + 无许可）。另：`language` 字段必须在 `repos/{owner}/{repo}` 详情里读，搜索结果页看不出来 |
| `Light-zju/Zju-AI-Homework` | B 其他JS（实为 Python） | **MIT** ✅ | 2025 秋 AI 课程大作业答案 | 无关 | ⛔ | rejected | 2026-10-25 | ★80，push 2025-11-28。**是作业答案不是工具**，与本仓无功能关系；且「学生作业答案」进工作台有学术诚信风险，建议连线索都不留 |
| `KqSMea8/zjuGradeMonitor` | B 其他JS（实为 Python） | **无许可证** ⛔ | 教务网成绩监控 | 重复且无增益 | ⛔ | rejected | 2026-10-25 | ★0，push 2019-01-25，7 年前的脚本。成绩读取已被 `dsh-zhiyun-source-zdbk` 覆盖 |

---

### 第六十八轮 · 2026-10-25 · A 组 · 轴「间隔重复的两处空转：`dueAt` 无人写、调度面无插座」

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `omdsh-dev/DSH-better-sidebar` | A 原生DSH（**待核**：未见 `dsh.bundle.patch`） | **MIT** ✅ | 通用底座（侧栏宿主，第三方注册页面） | **全新**（侧栏宿主层） | 🟢 | proposed | 2026-10-25 | ★4,526（本轮最高）、push 2026-10-24、TS、7.6 MB、topics 含 `dsh-plugin`。价值是**被硬依赖**：`tyfforu/dsh-flashcard` 的 `cordis.patch.yml` 明写「must be installed and enabled in the same profile」，`inject` 三个 `@deepseek-ai/dsh-client-*`。⚠ **本轮未读其 `package.json`/patch/npm 元数据** → 可锁版性未核、A 类归属待核。⚠ **不出骨架**：需 `react@18` + client 注入，与本仓 `dsh-zhiyun-shell-workbench` 侧栏**只能二选一**（架构决策）。**不出骨架** |
| `863683348/dsh-plugin-education` | A 原生DSH（`dsh.bundle.patch` 已核） | **MIT** ✅ | 备课/出题/闪卡/量规 | **重复且无增益** | 🔵 | proposed | 2026-10-25 | ★0、JS、npm `dsh-plugin-education@0.3.2` **存在**（可锁版 ✅）。它的 quiz 是「出题语料脚手架」而**无锚点**（本仓 `QUIZ_TYPES` 四型 + `blockIndex`/`page`/`atSec` 三点回链）→ 第二套互不连通的题模型。**M-2 风险**：仓库根提交了 4 个 `.npm-cache-pub*` 目录（`_cacache`/`_logs`），锁版会拖入缓存体积 |
| `tyfforu/dsh-flashcard` | A 原生DSH（`dsh.bundle.patch` 已核） | **MIT** ✅ | 复习（右栏闪卡） | **重复且无增益** | ⛔ | rejected | 2026-10-15 | **维持原判（10-15 已登记），本轮补两条硬理由**：① `npm view dsh-flashcard` → **E404**（不可锁版，只能源码移植）；② 卡模型（自建 SM-2 卡）与 `dsh-zhiyun-core-quiz` 的 `QUIZ_TYPES` **不互通**，连「接进 `fsrsRating`」这一步都做不到。原 ⛔ 理由「SM-2 旧于 FSRS」较弱，本轮被这两条替代 |
| `windli93/dsh-anki-plugin` | A 原生DSH（仅描述，无码） | **`license: null`** ⛔ | 复习 | 无法判定 | ⛔ | rejected | 2026-10-25 | ★0、**`size: 0 KB`**、`language: null`、`created` 与 `pushed` 同为 `2026-09-02T08:14`、描述 4 词 → **空仓库**。登记一行以免重扫 |
| `ysr666/dsh-vision-router` | A 原生DSH | **MIT** ✅ | 截图/手写/公式识别 | 与 `modlens`/`dsh-ocr-web` **重复** | 🔵 | proposed | 2026-10-25 | ★1,174、JS、push 2026-10-24。独有形态是**「无 key 免费视觉链 + 多模型路由」**→ 增益在成本/可用性而非能力；与本仓「数据不出本机」（`host-office` 本地 OCR）相冲突，属产品决策 → 建议人工裁决 |
| `Han-1413141/dsh-cost-meter` | A 原生DSH | **MIT** ✅ | 用量/成本/预算 | 与 `dsh-context`/`context-dashboard` **重复** | 🔵 | proposed | 2026-10-25 | ★524、JS、push 2026-10-25（最活跃）。会话与模型成本、token、预算、余额 —— 本仓 `context-dashboard` 已覆盖 |
| `e2mcc/dsh-popout-sidebar` | A 原生DSH | **MIT** ✅ | 侧栏弹出到独立标签页 | 无增益（形态，非功能） | 🔵 | proposed | 2026-10-25 | ★205、JS、push 2026-10-10。多显示器使用场景，与浙大/考试/刷题/笔记/论文/锻炼**均无关**；仅登记 |
| `Microqian2th/dsh-codex-effort-slider` | A 原生DSH | **MIT** ✅ | 推理等级滑条（UI） | 无增益 | 🔵 | proposed | 2026-10-25 | ★205、JS、push 2026-10-18。纯 UI 外观件，**不产生能力**；登记以示已扫过 |
| `howmp/dsh-pentest` | A 原生DSH | **无许可证** ⛔ | 渗透测试模式 | 无关 | ⛔ | rejected | 2026-10-25 | ★608、JS、push 2026-10-09、`license: null`。功能域无关 + 无证，两条都不过 |
| `csyangwen/dsh-memory-evolve` | A 原生DSH | **MIT** ✅ | 跨会话长期记忆 + 技能自进化 | 与 `dsh-memory-toolkit`/`me-memory` **重复** | 🔵 | proposed | 2026-10-25 | ★441、JS、push 2026-09-29。五轨记忆 + git 分支感知 + 四轨待办 —— 与本仓「记忆」链路及「今天」页的待办**双域重叠** |

---

### 第六十九轮 · 2026-10-25 · B 组派生 · 轴「月历分格：先证伪自己的缺陷报告，再评估替换方案」

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `fullcalendar/fullcalendar` | B 其他JS | **MIT** ✅（npm `license` / GitHub `spdx_id` / 包内 `LICENSE.txt` 三处一致） | 规划页月历网格 | **重复且可强化** | 🟢 | proposed | 2026-10-25 | ★20,719 / fork 3,717 / push 2026-10-16。**锁 `5.11.5` 不是 latest**：v7 `7.1.3` 解包 **4.1 MB** 且依赖 `preact`+`@full-ui/headless-calendar`，v5.11.5 **零依赖、1.5 MB、UMD**。esbuild 实测 **JS 77.7 KB + CSS 10.0 KB（gzip）**。⚠ **判 🟢 的理由本轮被削弱**：`buildMonthCalendar()` 实测 **2020–2030 共 132 个月 + 264 次翻月全对**（`dowOf(firstAt)` 与 `dowOf(firstUtc)` 在 `Asia/Shanghai` 下恒等）→ 本包**修不了任何缺陷**，只提供「同一口径的第二份实现」。骨架 `dsh-radar-fc-month`，README 首屏要求「**先补 12 行性质断言，再决定要不要 77 KB**」，并新增 **H-0**「是否还需要外部兜底」 |
| `bigcalendar/react-big-calendar` | B 其他JS | **MIT** ✅ | 月/周/日视图 | 重复且无增益 | 🔵 | proposed | 2026-10-25 | ★8,766、push 2026-06-01（**五个月未动**）、解包 **103 MB**。React 组件、**不导出「只算格子」的纯函数** → 与 🟢 同一件事的更大方案 |
| `ggaabe/rrule-temporal` | B 其他JS | **MIT** ✅ | 重复规则展开 | 重复且无增益 | 🔵 | proposed | 2026-10-25 | ★118、npm `rrule-temporal@2.2.8`（2026-10-01）、1.8 MB。RRULE→Temporal 区间展开。本仓**没有 RRULE 概念**（`{every,unit,anchor}`），接进来 = 第二套重复规则模型；真正的落点是 r66 的 `MAGMA27/dsh-calendar` |
| `elastic/rrule-es` | B 其他JS | **Apache-2.0** ✅ | 同上 | 重复且无增益 | 🔵 | proposed | 2026-10-25 | ★20、141 KB、push 2025-11-20。同域更小实现，同上理由 |
| `rrulenet/core` | B 其他JS | **MIT** ✅ | 同上 | 重复且无增益 | ⛔ | rejected | 2026-10-25 | ★0 / fork 0 / 2026-10-20 建仓。topics 齐全但零使用者；又一套 recurrence engine |
| `fullcalendar/temporal-polyfill` | B 其他JS | **`license: null`** ⛔ | 日期运算底层 | — | ⛔ | rejected | 2026-10-25 | ★783、push 2026-10-13、9.1 MB。**无许可证 → 硬门槛排除、不摘码**。⚠ 若真需要 Temporal，用 npm `temporal-polyfill@1.0.6`（**MIT**，esbuild 实测 gzip **19.8 KB**），不要这个无证 fork |
| `INTECH-Software-House/chronera-js` | B 其他JS | **Apache-2.0** ✅ | 日期/时区工具箱 | 无关（全域重叠） | ⛔ | rejected | 2026-10-25 | ★3、2026-10-19 建仓。「date/time/calendar/era/locale/timezone toolkit」—— 本仓 `time.js` 已把时区归日/周界/月历全做了，且它新到无人验证 |
| `jkbrzt/rrule` | B 其他JS | **`NOASSERTION`** ⚠ | 重复规则 | — | ⚠ 待核 | pending-license | 2026-10-25 | ★3,748、push 2024-06-27（停更）。rrule 主仓，但 `LICENSE` 是长期双许可、GitHub 判 NOASSERTION → **许可证待人工核验，不采用、不摘取任何代码** |

> **流程注记（本轮最重要的一条，建议写进 skill）**：本轮第一版报告据「手抄算式复算」判
> `buildMonthCalendar()` **漏格**，并已写进骨架 README；后来**改为直接 import 本仓模块实跑**，
> 132 个月全对 → **整条结论撤回**。翻车原因两次：① 手抄上海日归日时按宿主时区近似；
> ② `Intl.DateTimeFormat('en-US', { dateStyle, weekday })` 在 Node 22.13 **抛
> `TypeError: Invalid option : option`**，改完又让 `weekday` 被静默忽略。
> → **规则：任何「本仓行为」的断言必须 import 实跑；复算只能解释，不能下判断。**

---

### 第七十轮 · 2026-10-26 · C 组派生 · 轴「重复规则的第二套口径：跳月 vs 夹月末」

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `nradawg/rrule-expand` | B 其他JS（零依赖 TS） | **MIT** ✅（`LICENSE` 1,068 B 逐字读过，`Copyright (c) 2026 Nick Raddon`，无附加限制；`package.json` `license: MIT` 同口径） | 重复任务展开（规划页底座） | **重复且可强化**（强化点是记账口径，不是展开） | 🟡 | proposed | 2026-10-26 | ★0 / fork 0 / 33 KB / push 2026-08-20 / topics `icalendar`·`recurrence`·`rfc5545`·`typescript`·`zero-dependencies`。**npm 双路径均 404**（`rrule-expand` 与 `@nradawg/rrule-expand`）→ **不可锁版**、只能源码移植 → 按 §4.1 **不出骨架**。esbuild 实测 **14,756 B raw / 5,857 B gzip**。**实跑**（clone→`tsc`→调用）：`FREQ=MONTHLY` 从 1/31 起给 `01-31 03-31 05-31 07-31 08-31 10-31` —— **跳过 2 月不夹月末**，源码注释明说是避开「billing bug」；`WKST` 与 RFC 5545 自带例子逐条对上（`WKST=MO` → 8/10、8/24；`WKST=SU` → 8/17、8/31）；无 `COUNT`/`UNTIL` 且不给 `limit` 时**拒绝猜**（抛错）。**语义与本仓冲突**：本仓「每月 31 日」意图是**夹月末**（`1/31→2/28→3/31`，本轮 F-1 已修成此语义），它选**跳月** —— 两者各对，但「月报」≠「扣款」。✅ 只借它的三处**记账口径**（原日号携带 / 链回第一代 / 无 `limit` 不猜），⚠ 这三处本仓已用 ~60 行自建（`repeatDay` / `repeatFrom` / `nextOccurrence` 返回 null），故它的价值是**给 F-1 的决定提供反面先例**，不是提供实现。判 🟡 非 🟢：锁版门不过；判 🟡 非 🔵：唯一把「跳月 vs 夹月末」当**显式设计决策**写进注释的实现 |
| `jkbrzt/rrule` | B 其他JS | **`NOASSERTION`** ⚠ | 重复规则 | — | ⚠ 待核 | pending-license | 2026-10-26 | ★3,748、push 2024-06-27（停更近两年）。rrule 主仓，`LICENSE` 为长期双许可 → GitHub 判 NOASSERTION。**许可证待人工核验，不采用、不摘取任何代码**。r69 亦命中同仓（`:2740`），本轮由 `rrule recurrence typescript` 二次命中，判决不变 |
| `kanunnykov/rrule-by-pattern` | B 其他JS | **`NOASSERTION`** ⚠ | 重复规则（模式串，非 RRULE） | — | ⚠ 待核 | pending-license | 2026-10-26 | 展开输入是自定义模式串而非 RFC 5545，接入等于第二套规则语法 → 即便许可核清也只是 🔵。**不摘码** |
| `martinhipp/rrule` | B 其他JS | **MIT** ✅ | 重复规则 | 重复且无增益 | 🔵 | proposed | 2026-10-26 | ★1、211 KB。rrule 的一份拷贝/精简，无独立口径 —— 与本仓 `{every,unit,anchor}` 三字段模型不可互换（它是完整 RRULE 语法） |
| `rrulenet/rrule` | B 其他JS | **MIT** ✅ | 重复规则 | 重复且无增益 | 🔵 | proposed | 2026-10-26 | ★3、零依赖引擎。同域第三份实现。⚠ 与 `rrulenet/core`（r69 已登 ⛔，`registry.md:2737`）**同组织不同仓**，勿混 |
| `lsndr/rrule-rust` | B 其他JS | **MIT** ✅ | 重复规则 | 重复且无增益 | 🔵 | proposed | 2026-10-26 | ★44，rust 核心 + wasm 绑定。本仓**无 wasm 工具链**，且 DSH 插件侧加载 `.wasm` 未验证过 → 接入成本远高于 60 行自建 |
| `GhostPawJS/questlog` | B 其他JS | **MIT** ✅ | 任务管理（MCP + SQLite） | 重复且无增益 | 🔵 | proposed | 2026-10-26 | ★1、1,666 KB。MCP 服务 + SQLite 任务库，形态是「独立数据源」；本仓规划页已有 `local.json` + `entries.json` 两套存储，**再加一套 = 第三个真源**。另：`node:sqlite` 在无 FTS5 构建上出过事（见 `Jesse-njx/dsh-memory` 的 A 类第五道门） |
| `Hukutus/todo-calendar` | B 其他JS | **MIT** ✅ | 待办 + 月历 | 重复且无增益 | 🔵 | proposed | 2026-10-26 | ★0。todo + 日历视图，**无重复规则**；月历部分与 `buildMonthCalendar()` 同域（r69 已证 132/132 全对） |
| `benginN/caltask` | B 其他JS | **MIT** ✅ | 日历任务 | 重复且无增益 | 🔵 | proposed | 2026-10-26 | ★54。同上，无重复规则实现 |
| `careilly/obsidian-rrule` | B 其他JS | **无许可证** ⛔ | Obsidian 插件内 RRULE | 无法判定 | ⛔ | rejected | 2026-10-26 | ★0、2023-07-17 停更、`license: null`。两条都不过（无证 + Obsidian 插件形态不可复用到 DSH 插件侧） |
| `Roughbot/RRule-with-timezone` | B 其他JS | **无许可证** ⛔ | 带时区的 RRULE | — | ⛔ | rejected | 2026-10-26 | ★0、`license: null`。⚠ 反向印证：**"带时区"正是本仓 F-3 撤回的那条线** —— 存储 ISO 里没有设备时区信息，加了 `TZID` 也只在"发生时刻"层面正确，解决不了「写入时按谁的表」 |
| `Aschenbath/Sysiphus` | B 其他JS | **MIT** ✅ | 待办 | 无关 | ⛔ | rejected | 2026-10-26 | ★7、5 年未动。纯 UI demo，无可嵌入逻辑 |
| `zainali297/todo-app` | B 其他JS | **MIT** ✅ | 待办 CRUD | 无关 | ⛔ | rejected | 2026-10-26 | ★1。CRUD 练习项目 |
| `Boisti13/project-manager` | B 其他JS | **MIT** ✅ | 项目管理 CRUD | 无关 | ⛔ | rejected | 2026-10-26 | ★1。同上 |
| `hadi-es/todo-app-recurring` | B 其他JS | **MIT** ✅ | 重复待办 | 重复且无增益 | ⛔ | rejected | 2026-10-26 | ★0。**名字里有 `recurring`，代码里没有重复规则实现**（只有一次性 `due`）→ 只能当"这个词被滥用"的证据。⚠ 方法论：`in:name` 类关键词必须开仓验证，别信名字 |
| `Matt-Vance/todo-list-app` | B 其他JS | **无许可证** ⛔ | 待办 CRUD | 无关 | ⛔ | rejected | 2026-10-26 | ★0、`license: null` |
| `Arik2097/todo-api` | B 其他JS | **无许可证** ⛔ | 待办 API | 无关 | ⛔ | rejected | 2026-10-26 | ★0、`license: null` |

> **流程注记（本轮最重要）**：本轮实质产出**全在本仓**，且其中两条是**我自己先判错、再撤回**。
> ① **F-1 已修**：`1/31 → 2/28 → 3/28 → 4/28 …` 实跑复现 → 根因**不是 `advanceBy`**（夹月末是定义），
> 而是"把夹过的结果当下一次起点"这一**用法**；改为 `nextOccurrence` 直接算目标月 + `repeatDay` 携带原日号，
> 8 代实测 `[28,31,30,31,30,31,31,30]`。并**专门写一条测试钉住 `advanceBy` 的旧行为**，防止下轮有人把定义当缺陷改掉。
> ② **F-2 已修**：r66 记的「勾→撤→再勾出两条副本」实跑复现（`同 due 副本数 2`）→ 加 `repeatFrom`（**恒指第一代**）
> + `recallGenerated` 在同一次 `save()` 内收回，store / client / `local-done` 路由三处接线。判定顺序踩坑 40 分钟：
> 取消勾选清掉 `doneAt` 后「勾错原始那条」与「勾错副本」**完全同形**，第一版先比 `due` 等于拿自己比自己，恒收不到；
> 改「先判 `id`、`due` 相等一律不收」后通过。**同 `due` 副本是症状不是可收对象** —— 收它等于随机删用户待办。
> ③ **F-3 撤回**：v1 判据（钟点漂移）双向误判、v2 判据（分钟一致性）实跑 5 个时区**全部存出 `:59` → 零判别力**，
> `due-shape.js` 已删除，只留一条测试记录"为什么撤"；真解是写入侧钉 `+08:00`（TODO-1）。
> ④ **测试**：`planning-repeat-chain` + `planning-repeat` + `planning-local` 共 **64 条全绿**；全量测试因
> `dsh-radar-credit-audit-vendor@1.7.0`（npm 404）装不上而跑不了 —— 用 `git stash` 撤掉本轮改动重跑，
> 剩余 9 条失败**一条不少在原地**，确认是环境性。⑤ **脚本日期仍错**：`radar-rotation.mjs` 用 UTC 取「今天」，
> 此刻报 `2026-10-25 / same-day(exhausted)`，真日期是 **10-26（年积日 299 → C）**；两条路径都算 C **纯属巧合**。
> 该缺陷在 `rotation-state.md` 已记 3 次仍未修 → **本轮人工按真日期取组**，修法见 TODO-0（1 行）。

---

### 第七十一轮 · 2026-10-26 · A 组 · 轴「公式取串：写完整的 `$$` 为什么会被吞」

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `TianzeLuo/dsh-tex-block-normalizer` | A 原生DSH（`dsh.bundle.patch` 已核；`dsh.client.external: [@deepseek-ai/dsh-client-ui-primitives]`） | **MIT** ✅（`LICENSE` 1,078 B 逐字读过，`Copyright (c) 2026 s11phere`，无附加限制；`package.json` `license: MIT` 同口径） | 笔记 / 讲义 / 论文（含数学的一切实体正文） | **重复且可强化**（强化点在**取串**，不在渲染） | 🟡 | proposed | 2026-10-26 | ★1 / fork 0 / 40 KB / JS / push 2026-09-27。**不可锁版**：`package.json` **`private: true`** + `npm view` **E404** → 只能源码移植 → 按 §4.1 **不出骨架**。**机制**：不碰解析器，只在 `props.text` 进解析器前把 `$$` 搬到各自独占一行（`normalize.js` 135 行纯函数，`client.js` 258 行 patch `MarkdownText` 的 memo 内层函数）。**本轮实跑复现（用其从 `0.1.7-rc.1` 逐字提取的 `cjkFriendlyStrong()`+`mathCompatibility()` 拼同一管线）**：五种 `$$` 形状中 ① 围栏 ✅ ② 单行 ✅ ③ 开独占/闭粘连 → value 吞掉后文段落并报 KaTeX ERR ④ **开粘连/闭独占 → `value=""` 而 `meta="E = mc^2"`，公式整条消失且 `failures=0`（假通过）** ⑤ Pandoc → 丢首行 + 吞掉 `## 标题` 与后文 → **修复后 failures 1→0、`heading`/`paragraph` 节点恢复**；同一管线在「像人写的笔记」（3 个 `$$` + 代码块 + 双链 + 列表）上 failures 1→0、nodes 2→3；**幂等**；代码块内 `$$`、`[[双链]]`、`#期末`、未闭合块**均未被误伤**；上游自带测试 `normalize` 11/11 + `client` 10/10 全绿。**判 🟡 非 🟢 三条**：① 锁版门不过；② 集成方式是**改宿主组件对象**（`component.type=`），依赖 memo/未冻结/同实例三条非契约事实（失配则静默 no-op）；③ 分析对象 **`0.1.7-rc.1` ≠ 本仓 `0.2.0-rc.2`**，宿主是否已修**未验证**（TODO-4）。**与 `better-markdown`（换渲染器）正交，不构成 r19 的「二选一」** |
| `EnhydraLutristus/dsh-math-tex` | A 原生DSH（`dsh.bundle.patch` 已核；`dsh.compatibility.dshReleases: {"0.2.0-rc.2":"compatible"}`） | **MIT** ✅（`LICENSE` MIT + `Copyright (c) 2026 dsh-math-tex contributors`） | 笔记 / 讲义 / 论文 | 重复且无增益（对**笔记库**而言） | 🔵 | proposed | 2026-10-26 | ★0 / 1,727 KB / push 2026-10-23（本轮最活跃）/ `private` 未设但 **npm E404**。**host 侧**方案：`systemPrompt.section` 事前规则 + **`llm/stream` waterfall** 事后兜底（改写在落盘前，屏幕与记录同时修好），`lib/` 共 2,671 行，自称 706 条断言。**实跑**（装 `katex@0.16.47` 作 oracle）：Pandoc 与丢首行两种**修对了**；但 ① **段落中间的 `$$` 会被提升成块级** → `推导如下：$$∫…$$` 变成三个段落，`[[双链]]` 与其前的引导句被拆开（对笔记库是副作用）；② **代码围栏里的 `$$` 识别为 0 个区域**（与 tex-block-normalizer 的保守取向相反）；③ 无 katex 时 `inspect` **一律返回 `verdict:'ok'`**（"oracle unavailable"）→ 误配即假通过。适合**对话流**而非**笔记/讲义正文** |
| `thomasly/dsh-markdown-preview` | A 原生DSH | **MIT** ✅ | 输入框上方的实时预览 | 重复且**面板不对** | ⛔ | rejected | 2026-10-26 | ★1、npm `dsh-markdown-preview@0.4.0` **可锁版 ✅**（本轮唯一）。但它是 **composer slot 的预览面板**，不是笔记/讲义/论文的正文渲染面 → 落在已饱和的「呈现」轴且面板不对，不构成强化 |
| `WuShichao/dsh-ipynb-preview` | A 原生DSH | **MIT** ✅ | 实验课 / 数据分析 notebook | **全新**（本仓无 notebook 形态） | 🔵 | proposed | 2026-10-26 | ★1、npm `dsh-ipynb-preview@0.2.0` **可锁版 ✅**。渲染 `.ipynb`（语法高亮 + 离线 LaTeX）。学生场景真实，但属**新面板**而非强化既有面板；且本仓「学习/笔记」链路无 notebook 概念 → 只登记 |
| `xiaxi626/dsh-math-input` | A 原生DSH | **MIT** ✅ | 手写公式录入 | 无接缝 | ⛔ | rejected | 2026-10-26 | ★0、npm **E404**。手写笔迹 → ONNX（束搜索）→ LaTeX，零 token。需客户端 ONNX 运行时；与「输入」页无对应物 → 成本远超收益 |
| `A1eksib286/dsh-plugin-mathtype` | A 原生DSH | **`NOASSERTION`** ⚠ | Word 公式 → MathType OLE | 无关 | ⚠ 待核 | pending-license | 2026-10-26 | ★0 / Python / push 2026-10-25。**许可证待人工核验，不采用、不摘取任何代码**；且 Word/OLE 与本仓技术栈无关，即便核清也只是 ⛔ |
| `OrinVoss/dsh-math-team` | A 原生DSH | **MIT** ✅ | 数学建模竞赛 | 无关 | ⛔ | rejected | 2026-10-26 | ★7 / Python / 1,941 KB。两个 role agent 预设（建模 / 论文），**与公式渲染无关** —— 是 `math` 关键词的歧义来源，登记以免下轮重复评估 |

> **流程注记（本轮最重要）**：① **A 组主词已封板（r68），本轮改走「连接面派生轴」**——起点是 r19 的一行旧结论
> 「本仓无公式渲染器，`$k_1$` 原样交给宿主 `MarkdownText`」。本轮把它拆成两个问题：**ⅰ 能不能渲染**（能，宿主自带 KaTeX）
> 与 **ⅱ 写完整的会不会被吃**（会，且吃掉的是后文）。r19 只看了 ⅰ，故把 Temml 判成「无 → 有」。**ⅱ 才是真缺口**。
> ② **形状 4 是本轮最有价值的一条**：`value=""` + `meta="E = mc^2"` + **`failures=0`** —— 公式整条消失，而只查
> 「KaTeX 抛没抛错」的验收全都判通过。**「渲染成功」≠「渲染出来的东西对」**，与 r69「单测全绿 ≠ 用户看到的对」同族，
> 但这次连**异常都没有**。
> ③ **上游自述 ≠ 已验证**：上游 `limitations.md` 说未闭合 `$$`「保持原样」，实测是**把后文一起吞进公式且不报错**
> —— 因果描述比源码保守。**凡「无害地保留」这类断言必须自己跑一遍**。
> ④ **`math` / `formula` 在 A 组是脏词**（召回数学建模、Kimi API）；**`katex` / `tex` 才干净**，且两者第 6、7 次搜索都只剩
> 1 条 → **该轴已见底**，建议下轮不再扫。
> ⑤ **两个候选都去修同一件事，但取向相反**：`tex-block-normalizer` 只动行首 `$$`（代码块/引用块/未闭合全不碰），
> `dsh-math-tex` 用 oracle 判红字并**重排段落级结构**——后者对**对话流**是对的，对**笔记库**会拆段落。
> ⑥ **未出骨架**：五条门（🟢 / 许可 / 可锁版 / 不改上游 / 宿主窗口一致）只过两条，硬出即再造一个
> `dsh-radar-credit-audit-vendor@1.7.0` 式占位依赖。

---

## 2026-10-26 · B 组（浙大场景）· 派生轴「拼题A 做题进度」· r72

> 关键词：`pintia in:name` / `pintia language:typescript` / `pintia language:javascript` / `pintia language:python` /
> `online judge submit language:javascript` / `zju cc98 language:typescript` / `zju webvpn language:javascript` /
> `competitive programming judge sandbox language:javascript` 等 14 次（#4 传输截断）。**0 次 403，本轮完整。**
> 许可证以 GitHub API `license.spdx_id` 为准，`vscode-pintia` 另通读 `LICENSE` 全文。
> 本轮首次登记 **10 行** → 🟢 0 / 🟡 1 / 🔵 4 / ⚠ 1 / ⛔ 4（⚠ 那条同时满足「无许可证 → ⛔」，列上按 ⚠ 待核保留，实际已排除）。

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `jinzcdev/vscode-pintia` | B 其他JS（VS Code 扩展，TS） | **MIT** ✅（仓库根 `LICENSE` 1,073 B **全文读过**，`Copyright (c) 2022-present jinzcdev`，标准 MIT 无附加；`package.json.license` 同口径） | 刷题（拼题A 做题进度 / 提交 / 评测结果 / 答题计时） | **重复且可强化** | 🟡 | proposed | 2026-10-26 | ★36 / fork 2 / 27,410 KB / `0.11.0`（`preview:true`），建仓 2022-04-19、push 2026-10-24。**不可锁版**：`registry.npmjs.org/vscode-pintia` → **HTTP 404 `{"error":"Not found"}`**；且 `engines.vscode ^1.66.0`、`main: ./out/extension`、业务层深耦合 `vscode.*` → 只能「借语义自写」。**判据①✅**：落点是既有 `ptaRead` 动作面（`campus/src/index.js:583`）与规划页既有拼题A 行（`page-planning/src/index.js:534-548`），不新增面板。**判据②✅**：现有答「哪些题集没截止」，新增答「这套题做了几道」。**判据③⚠ 部分成立**（有本仓没有的三态口径/提交链路/轮询语义，但调不到它的实现）→ **因此判 🟡 不判 🟢**。**三处交叉核对**（TS/Python/本仓）在**读侧**逐字一致（`problemSetProblem` / `problemSetProblems` / `/exam-problem-status`）→ 读侧协议可信；**写侧只有两个别人的实现跑过** → 要用必须真机验证。骨架 `packages/dsh-radar-pta-progress`（B 类，`dependencies` 空） |
| `jinzcdev/pintia-solutions` | B 其他JS | MIT ✅ | 刷题 | 重复且无增益（内容库） | 🔵 | proposed | 2026-10-26 | 本轮再访，**维持 r39 的 🔵 不改判**（PTA 700+ 题解，C++，不可机器消费）。登记以免重扫 |
| `lj200612/pintia-problemset-toolkit` | B 其他JS（Python CLI + WebUI） | **MIT** ✅ | 刷题 / 题库导出 | 仅供参考（**交叉核对物**） | 🔵 | proposed | 2026-10-26 | ★0 / 186 KB / push 2026-08-03。**非 JS，不进集成候选**，但它在本轮承担了一个不可替代的角色：**第三方独立实现**，用来交叉核对本仓的协议假设。三条贡献：①`problemSetProblem` 键与本仓逐字一致；②「缺字段」的确只应视为未作答；③ 它**另有一个**状态端点 `GET /api/exams/{examID}/problem-sets/{psID}/problem-status`（本仓与 vscode-pintia 都用 `/exam-problem-status`）→ **两套端点是否等价本轮未核**（TODO-4），不据此判本仓读法有误 |
| `Dichgrem/Pintia_to_md` | B 其他JS（油猴脚本 + TS） | MIT ✅ | 题库导出 Markdown | 重复且无增益 | 🔵 | proposed | 2026-10-26 | ★2 / 8.6 MB（大头是截图）/ push 2026-04-11。`src/pintia-api.ts` 3.5 KB + `src/export-selected.ts` 10 KB。**增益核算**：本仓 `pta.problem()` 已返回完整题面（含 LaTeX，支持 offset 分页），导出成 Markdown 的核心是「题面 → md」，本仓 `core-parser` 已有 md 管线 → 只剩一个 `fetch` 循环，自写约 20 行。**判据③不成立** |
| `qixuancao/pintiaskillmcp` | B 其他JS（Agent Skill） | **MIT** ✅ | 刷题（AI 助教） | 仅供参考（**伦理边界范本**） | 🔵 | proposed | 2026-10-26 | ★0 / 20 KB / push 2026-04-24。名字带 `mcp` 但仓库里是 `.agents/skills/pintia-learning-assistant/`（SKILL.md + 3 个 reference md），**没有 server 代码**。唯一实质内容是 `references/safety-boundaries.md`：「*No bypassing authentication, captchas, or rate limits. No exam cheating workflows. No unattended bulk submission. Never expose cookie/token/password in output.*」→ 本轮把它当作**提交链路的伦理基线**写进骨架 TODO-3 |
| `bzjdtc/pintia_paste` | B 其他JS（油猴脚本） | MIT ✅ | 刷题 | **无关**（绕过平台限制） | ⛔ | rejected | 2026-10-26 | ★10 / 19 KB。把代码粘进 PTA 答题框以绕过粘贴限制。**本仓不做这类事**：其一它绕的是平台限制，其二 19 KB 无可复用层 |
| `LuBanQAQ/pintia-script` | B 其他JS（油猴脚本） | MIT ✅ | 刷题 | **无关**（绕过平台限制） | ⛔ | rejected | 2026-10-26 | ★7 / **8 KB** / push 2025-11-25。同上，体量过小 |
| `HZ-Abox/pta-auto-submit` | B 其他JS（Agent Skill） | MIT ✅ | 刷题 | **无关**（伦理红线） | ⛔ | rejected | 2026-10-26 | ★2 / 33 KB / push 2026-07-07。自述「**自动登录，抓题、解题、提交，一条龙跑完一套试卷**」。与 `qixuancao` 的边界文件**正相反** → 即使 MIT 也**不采纳、不借鉴**：自动解题 + 批量代交正是本仓明确不做的事 |
| `gautammehendale/codearena` | B 其他JS（MERN 全栈） | MIT ✅ | 判题 | **无关**（自建平台） | ⛔ | rejected | 2026-10-26 | ★0 / 276 KB。自建 OJ 平台（自带题库 + Docker 判题）。**不是可嵌入层**，且方向相反（我们要接**别人的**题库，不是另建一个） |
| `diredocks/pintia-mcp` | B 其他JS（MCP server，TS） | **无许可证**（`license: null`） | — | — | ⚠ | rejected | 2026-10-26 | ★0 / 217 KB / **archived=true**（2025-10-02 归档）。无许可证 + 已归档 → **⛔ 排除，不摘任何代码**。列在 ⚠ 位是为留下「曾评估过」的痕迹 |

> **本轮已登记再访（不改判）**：`Slowist-Lee/website-converter`（⛔，无许可证）、`3-Tian/zju-paper-fetcher`（🔵）、
> `baihe26/zju-literature-downloader`（🟡，★35 push 10-23 仍在维护）。

---

## 2026-10-26 · C 组（学生功能域）· 轴「题库练习链」· r73

> 关键词：**0 次 GitHub 搜索**（C 组已跑 22 轮、登记 1,283 个仓库、主词均已见底或判污染；改用 r37/r66/r70
> 的「先读码找断环」方法）。**本轮搜索环节未执行 → 标注「本轮不完整」**。
> 首次登记 **5 行** → 🟢 0 / 🟡 0 / 🔵 3 / ⚠ 1 / ⛔ 1。**不出骨架**（无 🟢）。
> **实质产出全在本仓**：题库练习链 4 条断链 + 1 条测试误导，全部沙箱实跑（Node 22.13.0，直接 import
> `dsh-zhiyun-core-quiz` 源码；`npm ci` 因 `dsh-radar-credit-audit-vendor@1.7.0` registry 404 而失败）。

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `unjs/ohash` | B 其他JS（零依赖 TS） | **MIT** ✅ | — | 仅供参考（id 设计参照，不接入） | 🔵 | proposed | 2026-10-26 | **非搜索结果**，是已知实现，本轮用来对照 F-3。契约是「同一语义输入 → 同一 id」；本仓知识点 id 含 `revision`（每次生成随机 UUID，`workbench.js:356/363`）→ 输入不唯一 → id 必然漂移。**本仓不需要引入**：`concepts.js` 已有 `contentHash`，改成 `digest([courseId,subId,blockIndexes])` 即可，零依赖 → 判据③不成立，故 🔵 非 🟢 |
| `Rich-Harris/devalue` | B 其他JS | **MIT** ✅ | — | 仅供参考（序列化契约参照） | 🔵 | proposed | 2026-10-26 | 对照 F-1：它把「序列化→反序列化**往返相等**」当作**库的对外承诺**。本仓 `itemToJson`/`itemFromJson` 也是这样一对，但 `quality.js:458` 的 `jsonRoundTrip` 只是**质检的一条检查项**，不在写路径上 → 往返相等应当作为写路径准入条件。零代码摘取 |
| `SifisoScS/scheduler` | B 其他JS | MIT ✅ | 截止时间 | 重复可强化（增益不足） | 🔵 | **再访，不改判**（原 🟡，`registry.md:2674`） | 2026-10-25 | 本轮当 F-3 的**概念参照**：`Interval.countBetween` 把「区间」与「时刻」拆成两个值对象，**标识不掺时间**；本仓反例是把随时变 `revision` 混进标识 |
| 「稳定 id」同名/近名条目（`uuid-stable` 一类） | B 其他JS | **`NOASSERTION`** ⚠ | — | — | ⚠ | pending-license | 2026-10-26 | 核「内容寻址 id」时命中的近名条目，`LICENSE` 非标准文本 → **待人工核验，不采用、不摘码**。登记以免下轮重扫 |
| `google/closure-library` | B 其他JS | **Apache-2.0** ✅ | — | **无关**（词面撞车） | ⛔ | rejected | 2026-10-26 | 想找现成「稳定标识」实现，`goog.Uri#getDomain` 只做 URL 归一，不管实体标识 → 与「知识点 id 该不该含 revision」不同域。留痕防重撞 |

> **本轮读码确证（不是候选，是本仓缺陷，明细见 `2026-10-26-r73.md` §2–§3）**：
>
> | # | 断链 | 位置 | 实跑结论 |
> | --- | --- | --- | --- |
> | **F-1** | **任何一道题都读不回 store** | `model.js:531` `type: item.type.code`，而 `makeItem` 不规范化 `type`（`model.js:379-412`） | 传代号 `'cloze'` → 落盘 `type: undefined` → `itemFromJson` 返回 `null` → `loadItems` **`loaded: 0`**，只留一条 `notes` 字符串。**无异常** |
> | **F-2** | `type` **两种形状并存**，消费方按代号比对 | `points.js:189`（字符串）/ `question-bank.js:52`（`codeOf`）/ `model.js:379`（对象原样存）；消费方 `question-bank.js:204,207` | 若为对象：**简答题走填空精确比对（恒判错）且跳过自评校验**；前端 `QUESTION_TYPES[q.type]` 全失效。**判 P1 非 P0**：本轮未确证真实库中对象形态的占比 |
> | **F-3** | 知识点 `pointId` 嵌 `revision`，而 `revision` **每次生成都是 `randomUUID()`** | `knowledge-points.js:27` + `workbench.js:356/363` | 同一份讲义一次成稿内 id 变 **2 次**（`v28 → uuid → 另一个 uuid`）。⚠ **校准**：不能简单换 `sourceVersion` —— `finalVersion` 含 `semanticPlan`（`workbench.js:66`），实测「仅重出讲义」时它**也会变**。正解是**语义身份** `contentHash([courseId,subId,blockIndexes])` |
> | **F-4** | 「已勾选知识点」练习筛出 `[]` | `question-bank.js:191` | **F-3 的下游**，非参数解构问题（本轮第一版判错，已撤回）。全量 `mixed` 练习仍有 2 道可用 |
> | **T-1** | 生成链与序列化链**各自有测、中间没测** | `tests/point-question-bank.test.mjs:74` vs `quality.js:458` | 测试断言 `type` 是字符串（对生成链成立），但从未把生成的题交给 `itemToJson→itemFromJson` 走一遍 → F-1 漏网。与 r66 F-2 同族但更隐蔽 |
>
> **本轮撤回的两条**（自己造的错，留痕）：① 误把 `loadItems` 返回的 `{loaded, notes}` 当数字 →
> 错判「吞掉作答记录」，实际 `loadAttempts` 返回 3 条、**无误**；② 误判 F-4 是 `planPractice` 平铺传参，
> 实际 payload 是对象、解构正常。
>
> **不出骨架的理由**：四条断链**全部零依赖**（1+1+0+3 行）；此时引入 BKT/FSRS/内容寻址库，
> 等于在「读不回的数据」上算得更精确 —— `dsh-radar-mastery-bkt` 的 `TODO-0` 已阻塞四十四轮，
> **不再往同一断点叠第四个骨架**。

---

## 2026-10-26 · B 组（浙大场景）· 第七十四轮 · 轴「课表导出成日历：RRULE 的前提成不成立」

> 关键词 10 次（上限）、0 次 403、**本轮完整**。首次登记 **14 行** → 🟡 1 / 🔵 2 / ⛔ 11。
> `zju stars:>20 language:javascript` **total=7 且全部已登记** → B 组在 `language:` 限定下**实证见底**，
> 下轮应改跑 `topic:`。`campus app`（20 条全为海外就业门户）与 `智云课堂`（含大量政治宣传仓库）**判词面污染，建议移出词池**。
> **本轮 `NOASSERTION` 待核 0 个**：`zju` 语系许可证两极化 —— 要么 `null`（无 LICENSE 文件），要么干净 MIT/Apache。

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `jakubroztocil/rrule` | B 其他JS | **BSD-3-Clause** ✅ | 课表 / 截止时间导出日历 | **重复且可强化**（`dsh-radar-ics-export`） | 🟡 | proposed | 2026-10-26 | ★3.4k，锁版 `rrule@2.8.1`（2023-11-10 后未发新版，**行为冻结恰合锁版要求**）。bundle 后 **51.9 KB**，传递依赖仅 `tslib`(0BSD)。**已出骨架 `dsh-radar-ics-rrule`**。三条实测坑：①`import { RRule }` 在 ESM 下加载期崩（CJS 无 `exports`）；②`getDay()` 整数透传 `byweekday` **整体错一天且不报错**；③`COUNT` 表达不了不连续停课 → 组内须严格每 7 天一条才可转 RRULE |
| `Phil-Fan/awesome-zju-tools` | B 其他JS | **CC0-1.0** ✅ | 浙大工具合集（线索源） | 全新（线索源） | 🔵 | proposed | 2026-10-26 | ★242，2026-10-15 仍在推。作为线索源翻检：条目与其他轮次高度重叠，**未带出新的 🟢** |
| `burriedalien666/zju842-practice` | B 其他JS | MIT ✅ | 842 专业课题库 | 重复可强化（`core-quiz`） | 🔵 | proposed | 2026-10-26 | ★23，2026-10-25 仍在推。本地题库 + 答案照片 + 逐轮记录；算法层无更优实现，不构成强化 |
| `EviterLesRoses2/vibe-learning-in-zju` | B 其他JS | **无许可证** ⛔ | 学在浙大待办 / 课表 / 转录 / 作业提交 | 重复且无增益 | ⛔ | rejected | 2026-10-26 | ★8，单文件 36 KB MCP。API `license:null` + 根目录**无 LICENSE 文件**（已逐项核 contents）。**不得摘码**。README 所称「courses 与 cmc 两套站点各走一次 CAS」本仓 `source-campus/src/index.js:408-419` 已记过，无增量 |
| `upupming/zju-grs-ics` | B 其他JS | **无许可证** ⛔ | 浙大研究生课表 → ics | 重复且无增益 | ⛔ | rejected | 2026-10-26 | ★8，2022-09 停更。与本轮轴同名但无许可，只可作线索 |
| `5dbwat4/zjuphylab.ics` | B 其他JS | **LGPL-2.1** ⛔ | 物理实验课表 → ics | 重复且无增益 | ⛔ | rejected | 2026-10-26 | ★4。LGPL 红线，只可参考不摘码 |
| `ZJU-AIRA/awesome-zju-opensource` | B 其他JS | **无许可证** ⛔ | 浙大开源聚合（线索源） | 全新（线索源） | ⛔ | rejected | 2026-10-26 | ★8。线索价值高但无许可；仅抄仓库名清单不涉代码，已据此核查 3 仓，未发现新的宽松许可项 |
| `Ltto123/zju-guide` | B 其他JS | **无许可证** ⛔ | 课程学习路径共建 | 全新 | ⛔ | rejected | 2026-10-26 | ★4，Next.js + Prisma 全栈，无 LICENSE |
| `DemoHn/cc98-node-api`、`FrazierLei/cc98-drawcard`、`6769/MyNewCC98`、`ZJU-CC98/Share` | B 其他JS | **全部无许可证** ⛔ | CC98 周边 | 重复且无增益（`source-cc98` 已覆盖） | ⛔ | rejected | 2026-10-26 | 4 仓合并一行。最早的 `cc98-node-api` 停在 2014 |
| `Fafa-DL/2021-ZJU-Machine-Learning`、`RyanFcr/ZJU_Course`、`Yva1nne/ZJU_Course`、`LBruyne/ZJU-SE-CourseMaterial`、`lhmd/ZJU-course`、`zyxNova/ZJU-CKCMix-CS-Course-Material`、`HobbitQia/ZJU-Courses-Resources`、`IMMORTAL23/ZJU-Course_info`、`jiangshibiao/Course-Review`、`haochengxia/ZJU-CS-3_1`、`yujincheng08/ZJU-UGCourse`、`smd1121/zju-course`、`euphoniumm/isee-zju`、`yinze00/ZJU-OPT` | B 其他JS | **全部无许可证** ⛔ | 课程资料 | — | ⛔ | rejected | 2026-10-26 | 14 仓合并一行（与 `QSCTech/zju-icicles` 同性质：**内容版权**，只作线索）。`Yva1nne/ZJU_Course` 自述「请遵守版权与学术诚信」，进一步确认非代码许可 |
| `LBruyne/blockchain-course-demos`、`ZJUSCT/www.zjusct.io`、`konicyQWQ/jobse-fe`、`Ray8mu34/ZJUAAA_Web`、`Winfred666/ZJU_multimedia` | B 其他JS | **全部无许可证** ⛔ | 课程 / 社团站点 | — | ⛔ | rejected | 2026-10-26 | 5 仓合并一行 |
| `ADSR1042/ZJU_VocabBoost`、`tangjinzhou/PAT`、`QSCTech/ZJUintl-gRPC`、`73-SEVENTYTHREE/B-S-`、`ryf1123/Oasis-in-the-Sky`、`chenzq-98/zjut-java_web_course_design-SoftwareTestSystem`、`zyayoung/ego-planner-web-control`、`ZJUDDP2015/ZJU_APRS_2015` | B 其他JS | **全部无许可证** ⛔ | 课程作业 / 实验 | — | ⛔ | rejected | 2026-10-26 | 8 仓合并一行，技术栈与本仓无关 |
| `huiihao/ZJU-daka` | B 其他JS | MIT ✅ | 每日打卡 | **无关** | ⛔ | rejected | 2026-10-26 | ★11。打卡流程已下线，功能不适用（非许可问题） |
| `destoryD/chaoxing-api`、`HualuozhE/YunKeTangZhiHuiZhiJiao-Crack`、`hzlgames/zju-autosign` | B 其他JS | MIT ✅ / GPL-3.0 ⛔ | 网课刷课 / 自动签到 | — | ⛔ | rejected | 2026-10-26 | **原则性排除**（违反平台规则），即使 MIT 也不采用 |
| `prakharepo/campus_placement_app` 等 20 个 `campus app` 结果 | B 其他JS | MIT / 无 | 印度 / 菲律宾 / 美国高校就业门户 | — | ⛔ | rejected | 2026-10-26 | **词面污染**：英文 `campus app` 指「校园招聘门户」。与 `fitness tracker` 同族，**建议移出词池** |

> **本轮读码产出**（不是候选，是校准；明细见 `2026-10-26-r74.md` §3）：
>
> | # | 校准点 | 实跑结论 |
> | --- | --- | --- |
> | **P0** | `rrule` 的 weekday 枚举与 `Date#getDay()` **差一位** | `getDay()`=3（周三）透传 → `BYDAY=TH` → 展开 **周四**。不报错不告警。必须用 `RRule.WE` 一类枚举 |
> | **P1** | `import { RRule } from 'rrule'` 在 ESM 下**加载期崩** | `rrule@2.8.1` 无 `exports` 字段，只有 CJS `main`；本仓全是 `"type":"module"` |
> | **P1** | RRULE 在**本仓课表**上只覆盖「无空洞」的组 | 9 条（含 1 次调课）分组后 `COUNT`=4/4/**1**，条数守恒、语义不守恒；停课不连续时 `COUNT` 无法表达 → 必须 `contiguous()` 才放行 |
> | **校准** | `dsh-radar-ics-export` 中「再加 RRULE 会重复生成」的理由需补 | 真正的风险是 RFC 5545 下「独立 DTSTART + RRULE」被当作序列起点，即**同日出现「N 条」与「1 条带 RRULE」**。本轮**未改**该包 |

<!-- r75 · 2026-10-26 · C 组 · 轴「笔记页过滤框只比 path，正文零参与」 -->

| `lucaong/minisearch` | B 其他JS（纯库） | MIT ✅ | 笔记·全文检索 | **重复且可强化**（笔记页 `buildRows()` 过滤框） | 🟡 | proposed | 2026-10-26 | ⚠ **非重复登记**：2026-10-20 登记的是它在「学习」页 `layered-search.js` 上的**重排**用途（骨架 `dsh-radar-search-rank`，锁 7.1.2）。本轮是**「笔记」页** `page-notes/src/client.jsx` 的**召回**用途（另一个面板 / 另一条代码路径 / 另一种职责：从零算命中集）。npm `minisearch@7.2.0` MIT，`dependencies: {}`。实测：默认分词对中文**完全无效**（查「动量」→0 条），必须外接 `Intl.Segmenter('zh')`；接后 `弹道学`→`弹道\|学` 过度切分产生假阳性且 `AND` 兜不住，必须加原文子串复核。本包锁 **7.2.0**（与 search-rank 的 7.1.2 不一致 → 打包去重与体积待实测）。骨架 `packages/dsh-radar-note-search` |
| `nextapps-de/flexsearch` | B 其他JS（纯库） | Apache-2.0 ✅ | 笔记·全文检索 | 重复且无增益（引擎已由 minisearch 占位） | ⛔ | rejected | 2026-10-26 | ★13811。功能与 minisearch 重叠，本仓 `dsh-radar-search-rank` 已选定 minisearch 作检索底层；同一功能域再引入第二个引擎 = 两套并行实现，按「强化式集成」原则拒绝（与 2026-10-22 判断一致，本轮在「笔记页」上下文复核后维持） |
| `scambier/obsidian-omnisearch` | B 其他JS（Obsidian 插件） | **GPL-3.0** ⛔ | 笔记·检索 | — | ⛔ | rejected | 2026-10-26 | ★2180（活跃 2026-10-24）。功能对口（Obsidian 全文检索），但 **GPL-3.0 红线** + 依赖 `obsidian` 运行时插件 API，形态亦不符。**不得摘取任何代码**，仅登记参考 |
| `FlokeStudio/glyph-sO` | B 其他JS（Obsidian 插件） | **GPL-3.0** ⛔ | 笔记·检索 | — | ⛔ | rejected | 2026-10-26 | ★1。Obsidian 全文检索插件 + 片段预览。GPL 红线 + 插件形态，仅登记 |
| `vaniwiki/obsidian-search-highlight` | B 其他JS（Obsidian 插件） | **无许可证** ⛔ | 笔记·检索 | — | ⛔ | rejected | 2026-10-26 | ★0。`[[page?s=词]]` 语法高亮链接页。**无许可证 → 只登记，不得摘取任何代码** |
| `nanthansr/second-brain-mcp` | B 其他JS（MCP 服务） | MIT ✅ | 笔记·检索 | 形态不符（MCP server，非可嵌入库） | 🔵 | proposed | 2026-10-26 | ★1（2026-08-27）。只读 MCP server，索引优先检索 + 原子笔记。**是服务而非库**，无法嵌入笔记页客户端；其「索引优先」思路可参考 |

> **r75 负面结论（不登记仓库，记于此供后续轮次复用）**：双链解析方向（`obsidian wikilink parser` 等 3 次搜索）
> 全部跑空 —— 最高 ★36 且为 Go，其余 ★0–7。本仓 `createResolver()` 三级解析（精确路径 → 同目录 → 全库唯一 basename）
> 在「几千篇」量级上已是合理实现，**不建议**为此引入任何外部依赖。
>
> **r75 本仓线索（非外部候选）**：`vault-index.js` 的 `buildIndex()` 已产出 `unresolved`（含 `missing`/`ambiguous`）
> 与 `orphans`，`host.js` 已暴露 `case 'unresolved'` / `case 'orphans'`，`describe` 已统计 `unresolvedCount`/`orphanCount`，
> 但 `page-notes/src/client.jsx` **一次都没调用**。数据与服务面就绪、仅缺 UI —— 属本仓缺口，非候选。

---

## 2026-10-26 · A 组派生轴「笔记页检索的分词层」· 第七十六轮 · r76

> 关键词：`minisearch chinese tokenizer` / `chinese word segmentation language:javascript stars:>200` /
> `cjk tokenizer search language:typescript` / `full text search javascript stars:>1000` / `fuzzy search chinese` /
> `intl segmenter polyfill` / `n-gram index javascript search` / `elasticlunr` / `@orama/orama tokenizer` /
> `nextapps flexsearch language:javascript` 共 **10 次**。**0 次 403，本轮完整。**
> 许可证以 `npm view <pkg> license`（实装）+ GitHub API `license.spdx_id` 双口径核对。
> 首次登记 **9 行** → 🟢 0 / 🟡 2（含 1 条三度登记） / 🔵 3 / ⚠ 1 / ⛔ 4。
> 骨架 **1 个**：`packages/dsh-radar-note-search-tokenizer`（B 类，锁 `minisearch@7.2.0`）。

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `lucaong/minisearch`（**分词用途**） | B 其他JS（纯库） | **MIT** ✅ | 笔记·库内检索 | 重复且可强化（笔记页 `buildRows()` 的**分词层**） | 🟡 | proposed | 2026-10-26 | **第三次登记、第三种用途**（r36 学习页重排 7.1.2 / r76 笔记页正文召回 7.2.0 / 本轮 `tokenize` 钩子）。实测上游默认 `tokenize` 只按空白标点切 → 中文 `佩亚诺`（标题中间）**`prefix:true` 也是 0 命中**。`dependencies: {}`。⚠ 与 `note-search` 同面板两级须合并评审；bigram 口径有假阳性（未加原文复核不能上线）；与 `search-rank` 的 7.1.2 冲突 |
| `nextapps-de/flexsearch` | B 其他JS | Apache-2.0 ✅ | 笔记·库内检索 | 重复且无增益 | ⛔ | 再访维持（第 3 次） | 2026-10-26 | **首次实跑** `0.8.212`：默认 `Index` 中文 0 命中，`tokenize:'full'` 才命中 → 中文能力不比 minisearch 好，换引擎即推翻在途方案 |
| `@orama/orama` | B 其他JS（检索库） | Apache-2.0 ✅ | 笔记·库内检索 | 重复且无增益 | ⛔ | rejected | 2026-10-26 | 实装 `3.1.18`：`fulltext`/默认中文 **全 0**；`hybrid` **抛异常**。要用得外接 embedding |
| `orama`（同名不同物） | — | Apache-2.0（图表库） | — | 无关 | ⛔ | rejected | 2026-10-26 | `npm i orama` 装进来的是 **D3 图表库**（`Chart`/`Axis`/`Bars`…），最后发布 2018-08-31。登记防下轮按名字误装 |
| `yanyiwu/nodejieba` | B 其他JS（C++ 绑定） | **MIT** ✅ | 中文分词 | 重复且无增益（相对 bigram） | ⛔ | rejected | 2026-10-26 | ★8.7k，需 `node-gyp` + ~50 MB 词典；Web 工作台 + Electron 两端打包成本远超收益 |
| `zhangfisher/segmentit` | B 其他JS | **MIT** ✅ | 中文分词 | 重复且可强化（**未验证**） | 🔵 | proposed | 2026-10-26 | 纯 JS 分词，无原生依赖。**未实跑**，留作下轮与 bigram 做 A/B 的候选 |
| `joe-re/jieba-wasm` | B 其他JS（WASM） | **MIT** ✅ | 中文分词 | 与 `dsh-radar-search-segment` 同目标 | 🔵 | proposed | 2026-10-26 | 只确认许可证；不新增骨架（避免同域第三个） |
| `elasticlunr-js/elasticlunr` | B 其他JS | **MIT** ✅ | 笔记·检索 | 重复且无增益 | ⛔ | rejected | 2026-10-26 | ★4.4k，2019 后基本停更，能力被 minisearch 覆盖且同样无中文分词 |
| `buhichan/asdf`（近名小仓） | B 其他JS | **`NOASSERTION`** ⚠ | — | — | ⚠ | pending-license | 2026-10-26 | `LICENSE` 非标准文本 → **待人工核验，不采用、不摘码** |

> **本轮方法论（写给下一轮）**：
> ① **「库支持某功能」≠「库对该语言的该功能有效」**。minisearch 文档写明了 `tokenize` 可外接，看起来像「中文只要传个分词器」——
>    但默认分词对中文是 **0 命中**，而不是「命中得少」。**必须拿中文语料实跑一遍**，空白语料永远测不出来。
> ② **`prefix:true` 是陷阱**：它让人以为「中文也能用了」（`数学`、`泰勒` 确实从 0 变 2），但它只覆盖**token 开头**。
>    标题中间的字（`佩亚诺`）依然 0。**「参数能救」的直觉在这里是错的。**
> ③ **npm 名字 ≠ GitHub 名字**：`orama`（图表库）vs `@orama/orama`（检索库）；`nextapps-de-flexsearch` **不存在**。
>    两个坑都只有 `npm i` 才知道 —— **凡是准备锁版的包，先真的装一次**。
> ④ **本轮发现仓库自带的 `tests/radar-packages.test.mjs` 在 `radar` 上 42 条失败**（历史骨架），
>    而前几轮的「自动验收」只做 `json.load` / `yaml.safe_load` 两条**语法级**检查 —— **语法通过 ≠ 合规**。
>    骨架模板缺 `cordis.patch.yml`、README 顶部缺声明，语法检查一律放行。建议后续验收直接跑该测试并只断言**本轮新增目录**的断言全绿。

---

## 第七十七轮（2026-10-26 · C 组 · 轴「错题重练：记录、归因、入口三层全断」）

> 搜索 **7 次**（0 次 403，**完整**）。首次登记 **9 行** → 🟢 0 / 🟡 1 / 🔵 5 / ⚠ 1 / ⛔ 2。**A 类 0 个**（C 组关键词不含 DSH 类词；A 组 3 小时前由 r76 扫过）。
> 骨架 **0 个**：无 🟢；唯一 🟡 实装验证后主动放弃（§4）。
> 本仓实测三条：F-1 两条 attempts 轨形状不一致（`study` 写 `verdict/questionId`，`quiz` 读 `autoVerdict/quizId` → 装载抛错或静默归零）；F-2 `review` 模式只判「做过」不判「错过」；F-3 归因结果零调用方。详见 `2026-10-26-r77.md` §3。

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `kitschpatrol/yanki` | B 其他JS（TS 库+CLI） | **MIT** ✅ | 笔记→复习卡 | 重复且可强化（**收窄后**：仅「导出到 Anki」渲染层） | 🟡 | proposed | 2026-10-26 | ★61，2026-10-16，`yanki@3.2.1` **实装验证**：`~~x~~`→`{{c1::x}}`、`$x$`→`\(x\)`、选择题→Basic 前后卡 **均可**；但 **54 个直接依赖 / 261 个安装包 / node_modules 72 MB**，`engines` 要 Node ≥22.18，`getNoteFromMarkdown(markdown, options)` **参数顺序反直觉**，`deckName` 恒空。**不解错题重练**，仅作 FSRS 骨架之后的可选下游 |
| `rzhang569/study-guide` | B 其他JS（Agent Skill） | **MIT** ✅ | 期末复习 | 全新（**形态**可借） | 🔵 | proposed | 2026-10-26 | ★1，2026-10-22。HTML 产物：引用式笔记 + 每选项解释 + 计时模拟考 + **错题本** + 进度驱动练习。**是提示词不是库**，无可锁版代码；「每选项解释」本仓 `quality.js` 已覆盖 |
| `wencharmwang/study-mistake-notebook` | B 其他JS（Agent Skill） | **MIT** ✅ | 错题 | 全新（**错因记录**可借） | 🔵 | proposed | 2026-10-26 | ★0，2026-07-28，Python。**「保留可检索的多轮错题记录」= 本仓真正缺的那一维**。只借数据设计，不摘码 |
| `Fundaments-Work/Lemma` | B 其他JS（Obsidian 插件） | **MIT** ✅ | 闪卡 FSRS-5 | 重复且无增益 | 🔵 | proposed | 2026-10-26 | ★2，2026-10-22。纯 Markdown 卡片 + CouchDB 同步。**调度层与 `dsh-radar-fsrs-scheduler` 同算法**，且强耦合 Obsidian 宿主 |
| `zhaoqianbiao/ElectronicCorrectionNotebook` | B 其他JS（C# WinForm） | **MIT** ✅ | 错题本 | 重复且可强化（**非 JS，不可封装**） | 🔵 | proposed | 2026-10-26 | ★78，2025-10-14。**本轮唯一真做对了「错题本」的成熟项目**，但 C# 桌面应用，无库无 API → 仅形态参考 |
| `nianhua666/ncre-practice-desktop` | B 其他JS（Python） | **MIT** ✅ | 错题本/刷题 | 重复且可强化（**非 JS**） | 🔵 | proposed | 2026-10-26 | ★0，2026-03-20。「错题本 + AI 判分 + 按错题练」形态完整，但 Python Tkinter 桌面，不可复用 |
| `orange233-g/aixue` | B 其他JS（TS/Capacitor） | **MIT** ✅ | 出题+复习 | 重复且无增益 | 🔵 | proposed | 2026-10-26 | ★0，2026-10-22。完整 App 非库；出题能力本仓 `core-quiz/generate.js` 已更细（含可溯源校验） |
| `ObsidianToAnki/Obsidian_to_Anki` | B 其他JS（Python） | **GPL-3.0** ⛔ | Markdown→Anki | — | ⛔ | rejected | 2026-10-26 | ★2049，2024-06-16。**许可证红线**，与 `yanki` 同向且更弱（Python 脚本） |
| `Congmoow/QuestPilot` | B 其他JS（TS 桌面） | **`NOASSERTION`** ⚠ | 题库管理 | — | ⚠ | pending-license | 2026-10-26 | ★2，TS 桌面应用。**待人工核验，不采用、不摘码** |

> **本轮方法论（写给下一轮）**：
> ① **C 组「刷题」主词已见底**：7 次搜索里 5 次的返回**要么 ★<5、要么许可证 `null`**。
>    中文词（`错题 spaced`）**total 0** —— GitHub 检索对中文仓库名/描述覆盖极差，别再指望中文主词。
> ② **「错题重练」缺的不是算法，是「错因」这一维数据**。外部库（Markdown 闪卡 / 错题本 App / Agent Skill）
>    **全都不提供它**。这意味着：**该自己长，不该靠集成** —— 这是第一次出现「本仓该写代码而不是接库」的结论。
> ③ **验收要区分「抛错」与「静默归零」**：`loadAttempts` 对缺 `autoVerdict` **抛**（诚实），
>    但对缺 `quizId` 静默 `String(??'')` → `attributeByPoint()` 返回 `{}` 且 `loadAttempts` 返回 `1`。
>    **后者更危险**：它让「装配成功」与「数据全丢」长得一模一样。
> ④ **npm 库的「能装」≠「能锁版薄封装」**：`yanki` 装得上、跑得通、渲染对，
>    但 54 个直接依赖 + 261 包 + 72 MB，已经超出「薄封装」的定义。**先 `npm i` 量体积，再谈集成。**

## 第七十八轮（2026-10-27 · A 组 · 轴「勾选状态的所有权：同一份 ticks.json 被两个实例各写各的」）

> 搜索 **5 次**（0 次 403，**完整**）。首次登记 **2 行** → 🟢 0 / 🟡 1 / 🔵 1 / ⚠ 0 / ⛔ 0。**A 类 2 个**。
> 骨架 **0 个**：无 🟢；唯一 🟡（插件门控）压在「插件页 profile 写入归谁」这个**权责问题**上，不宜当天出骨架。
> 本仓实测三条：P-1 两个 `TickStore` 实例并存时 `save()` **整份覆盖** → 先勾的那条被抹掉（**已修 + 4 条回归测试**）；
> P-2 今天页 `Boolean(ticks[key])` 按值的真值判勾 → 脏值让交掉的作业复活（**已修**）；
> P-3 `prune()` 全仓零调用方（**只记录未修**，需动 `index.js` 取数流程）。详见 `2026-10-27.md` §3。

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `Noob-stupid/dsh-plugin-gating-hub` | **A 原生DSH** | **MIT** ✅ | 通用（装/升插件不搞挂工作台） | **重复且可强化**（插件页：`dsh-zhiyun-page-plugins` + `dsh-radar-plugin-audit` / `-plugin-ledger` / `-plugin-score` / `-compat-vet`） | 🟡 | proposed | 2026-10-27 | ★113，2026-10-26。`@noob-stupid/dsh-plugin-console` **0.5.92**，**零运行时依赖**，自带 `dsh.bundle.patch`+`cordis.patch.yml`（完整插件，非库）。升级前契约预检 / 回滚点 / 失败自动回滚 / **有证据才自动禁用** = 本仓没有的一层。**降 🟡 的原因**：它要接管 profile 写入，与本仓插件页**同时写 profile** → 先定「唯一写入者」再谈锁版挂载 |
| `kenz1117/dsh-engram` | **A 原生DSH** | **MIT** ✅ | 笔记 / 论文 / 问一问 | **重复且无增益** | 🔵 | proposed | 2026-10-27 | ★38，2026-10-25。`@kenz1117/dsh-engram` **0.11.0**，22 个窄工具，SQLite FTS5 + 本地向量 + SM-2 + 证据门。五条能力本仓**全有且更细**（`me-memory`/`session-notebook`/`note-search*`/`kb-rag`/`knowledge-graph`/`fsrs-scheduler`）；唯一增量 `@huggingface/transformers` 正是最重的体积项。**不接** |

> **本轮方法论（写给下一轮）**：
> ① **A 组主词已见底**：`deepseek-harness plugin` / `cordis plugin` / `dsh plugin` 三次搜索首屏共 30 条，
>    未登记仅 3 个（其中 1 个是本仓已建骨架的 `dsh-context`）。新增全部来自**中词** `dsh-market`。
>    下一轮 A 组改用中词：`dsh-plugin upgrade` / `dsh plugin rollback` / `dsh plugin profile lock`。
> ② **「同一份小 JSON、两个写入者」是本仓一类系统性隐患**，`ticks.json` 只是第一个被撞上的。
>    凡是「宿主进程写、页面只读」的状态文件，都要问一句：**重启时的两个进程会不会互相覆盖？**
> ③ **判「有没有」不要判「值是不是真」**：`Boolean(obj[key])` 在值恒为对象时看起来没问题，
>    但脏值会静默翻转语义。存"键在即事实"的表，一律 `hasOwnProperty`。

## 第七十九轮（2026-10-27 · A 组·中词 · 轴「插件页说它是叶，它却在等一个上游服务」）

> 搜索 **10 次**（全部为**中词**，0 次 403，**完整**）。首次登记 **15 行** → 🟢 0 / 🟡 3 / 🔵 8 / ⚠ 1 / ⛔ 3。**全部为 A 类**。
> 骨架 **0 个新建**；**改写 1 个旧骨架** `dsh-radar-plugin-graph`（去掉等不到服务的 `inject:['slots']`）。
> 本仓实测三条：F-1 插槽图方向是「外壳 ← 页面」，页面不提供 `slots` → 旧骨架的 inject 恒 pending（**已改**）；
> F-3 上游提供者被静默丢弃 → `deps=[]`/`leaf`/`cancellable`，页面写「不依赖任何包」（**已钉测试，待产品决定**）；
> F-4 环内 `layerViolations` 只报 1 条（**已钉测试**）。详见 `2026-10-27-r79.md`。

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `lire1131/dsh-undo-savepoint` | **A 原生DSH** | **MIT** ✅ | 通用（配置/插件代码改坏能退回） | **重复且可强化**（插件页只开关、无回滚点） | 🟡 | proposed | 2026-10-27 | ★191，2026-10-20。撤销配置与插件代码改动、脱敏（secret-safe）。**降 🟡**：接进来 = 本仓开始写备份目录，与 r78 P-1 同族（两个写入者），须先定权责；未安装未实跑 |
| `Airmetro/dsh-update-checker` | **A 原生DSH** | **MIT** ✅ | 通用（版本落后能看见） | **重复且可强化**（插件页不显示版本/新版本） | 🟡 | proposed | 2026-10-27 | ★19，2026-10-21。npm/GitHub 双源 semver 比对、多语言横幅、主程序自动备份。只读、无写入 → 安全面干净；**降 🟡** 仅因它是完整插件（自带 patch），会多出一个「更新」入口 |
| `oh-my-dsh/dsh-plugin-upgrade-skill` | **A 原生DSH（skill）** | **MIT** ✅ | 通用 | 重复且无增益 | 🔵 | proposed | 2026-10-27 | ★306，2026-10-18。**是 skill 不是插件面板**，帮插件跟 DSH 升级对齐。本仓不装 skill 驱动自身升级 |
| `SiriLee/dsh-rewind` | **A 原生DSH** | **MIT** ✅ | 通用（对话回退） | 重复且无增益 | 🔵 | proposed | 2026-10-27 | ★201，2026-10-26。同窗口对话回退 + 轻量工作区备份（Claude Code `/rewind` 语义）。改的是**对话**，不是插件/profile |
| `lxzy-7/dsh-plugin-guard` | **A 原生DSH** | **MIT** ✅ | 通用 | 重复且无增益 | 🔵 | proposed | 2026-10-27 | ★42，2026-08-18。装前快照 + 一键回滚 ≈ `dsh-radar-plugin-audit`；且需接管安装流程 |
| `PerryLink/dsh-plugin-upgrade` | **A 原生DSH（skill）** | **Apache-2.0** ✅ | 通用（面向插件作者） | 重复且无增益 | 🔵 | proposed | 2026-10-27 | ★2，2026-10-26。一包一 cordis 的升级 skill，受众是**插件作者**不是工作台用户 |
| `MicroMilo/upstream-radar` | **A 原生DSH** | **Apache-2.0** ✅ | 通用 | 重复且无增益 | 🔵 | proposed | 2026-10-27 | ★10，2026-10-16。**在册**（本仓 `dsh-radar-upstream-radar` 即其对应骨架）。常驻兼容测试，与本仓 plugin-audit 重叠 |
| `DuFehlst/dsh-plugin-management` | **A 原生DSH** | **MIT** ✅ | 通用 | 重复且无增益 | 🔵 | proposed | 2026-10-27 | ★0，2026-10-16。"plugin cockpit"：设置里列/开关 web-profile 插件 = 本仓插件页的子集 |
| `SongYuhui14/dsh-plugin-conflict-advisor` | **A 原生DSH** | **MIT** ✅ | 通用 | **重复且可强化**（冲突检测） | 🔵 | proposed | 2026-10-27 | ★1，2026-08-19 后未再 push。能力对口（重复插件/冲突检测），但单星 + 停更 → 只作线索 |
| `EasonMWS/dsh-plugin-health` | **A 原生DSH** | **MIT** ✅ | 通用 | **重复且可强化**（兼容矩阵 vs `compat-vet`） | ⚠ | pending-license | 2026-10-27 | ★3，2026-10-26。升级检查 + 多宿主兼容矩阵。**判 ⚠ 的唯一原因**：npm 包名与版本未核，无法确认可锁版；核完可升 🟡 |
| `zuwenyin/dsh-plugin-upgrader` | **A 原生DSH** | **MIT** ✅ | 通用 | **重复且可强化**（版本历史 + 回滚） | 🟡 | proposed | 2026-10-27 | ★1，2026-10-26。一键升级 + 版本历史 + 回滚，与 `undo-savepoint` 重叠 → **两个 🟡 里应二选一**，不建议都挂 |
| `KYinCode/dsh-hot-installer` | **A 原生DSH** | **MIT** ✅ | 通用 | 重复且无增益 | ⛔ | rejected | 2026-10-27 | ★9，2026-09-22。插件热管理器（装卸升即时生效），要**接管启动/热替换流程**，与本仓「不做第二套启动器」冲突 |
| `loudMore/dsh-launcher` | **A 原生DSH** | **MIT** ✅ | 通用 | 重复且无增益 | ⛔ | rejected | 2026-10-27 | ★37，2026-09-18。**第二套启动器**（一键安装/更新/环境检测），`apps/desktop` 已足 |
| `xiaxi626/dsh-skills-nexus` | **A 原生DSH（skill 管理器）** | **MIT** ✅ | 通用 | 重复且无增益 | ⛔ | rejected | 2026-10-27 | ★4，2026-10-26。**skill 包管理器**（注册/版本锁/批量启停），不是插件管理器；本仓无 skill 分发面 |
| `AdamPlatin123/dsh-plugin-radar` | **A 原生DSH** | **MIT** ✅ | 通用 | 重复且无增益 | 🔵 | proposed | 2026-10-27 | ★**1484**，2026-10-26。**与本任务同名但不同物**：插件目录/发现页，不读运行时依赖真源；registry 已登记 2 次，本轮仅备注防误认 |

> **本轮方法论（写给下一轮）**：
> ① **A 组改中词是对的**：10 次中词 → 新面孔 31 个（去重 23）；r78 的 5 次主词只捞出 3 个。
>    但中词必须是「**两个名词**」（`plugin + rollback` / `plugin + snapshot`）；
>    「名词 + 泛化词」（`plugin + lockfile`）会立刻掉进无关生态。
> ② **「自带 `dsh.bundle.patch` 就是完整插件」这一条正在变成主要降级理由**：
>    r78 的 `gating-hub`、本轮的 `update-checker` / `undo-savepoint` 全卡在这 —— 能力对、形态不对。
>    下一轮起，A 类候选先查一件事：**它有没有 `dependencies` 以外的可独立调用入口？** 没有就只能是 🟡。
> ③ **插槽图的边方向是「外壳 ← 页面」**，页面**不提供** `slots` 服务。
>    任何「等页面加载」的插件都**不能**用 `inject: ['slots']` —— 这是本仓第四例「等一个不存在的插座」（前三次在 r68/r77）。

## 第八十轮（2026-10-27 · A 组 · 变体词「插件页 / 市场 / 面板」· 轴「锁版到底能不能装」）

> 搜索 **9 次**（0 次 403，**完整**；上限 10 未达）。首次登记 **5 行** → 🟢 0 / 🟡 2 / 🔵 2 / ⛔ 1。**全部为 A 类**。
> 骨架 **0 个新建**：登记表 🟢 已积压 58 行、骨架 67 个里仅 18 行标 `skeleton-created` ——
> 缺的不是候选，是**已有的 67 个都没被验证过能不能装**。本轮改为让这个数字第一次可检验。
> 本仓实测（新增 `scripts/radar-baseline-check.mjs`，61 条锁版）：
> F-1 `dsh-radar-credit-audit-vendor@1.7.0` **npm 上不存在**（L-15 的唯一根因，两个源各测一次）；
> F-2 60/61 存在且 0 条落后 latest；F-3 **43 对**上游包无法同装（`--holdout` 实测）；
> F-4 静态「区间相交」只报 3 对，**漏报 93%**；F-5「两两能装 ≠ 三个能装」。详见 `2026-10-27-r80.md`。

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `yunhuantian/dsh-plugin-hub` | **A 原生DSH** | **MIT** ✅ | 通用（装插件不搞挂工作台） | **重复且可强化**（插件页：冲突检测 / 依赖影响图 / npm 探测，本仓零实现） | 🟡 | proposed | 2026-10-27 | ★7，2026-10-26。`dsh-plugin-hub@0.2.6`，自带 patch，**21 个内部插件打成一包**（22 行插件清单）→ 锁版挂载 = 一次引入 21 行，与「不做第二套启动器」冲突。**只借 `hub-ext-npm-probe` 一个能力**（正好补本轮检查器的在线部分），不接整包 |
| `NanmiCoder/dsh-plugin-market` | **A 原生DSH** | **MIT** ✅ | 通用 | **重复且可强化**（但与 `dsh-radar-market` / `dsh-radar-dsh-web` **三方同质**） | 🟡 | proposed | 2026-10-27 | ★7，2026-08-17。`@nanmicoder/dsh-plugin-market@0.2.0`，catalog 3,518 → 可装 936 → npm 存在 716 → 源码可验 220。**唯一增量**：「确定性规则决定能不能装，模型摘要只展示不授权」—— 与 F-1 是同一个问题。先读规则、不先接 |
| `Yui-Little/dsh-mobile-shell` | **A 原生DSH** | **MIT** ✅ | 通用（窄屏） | 重复且无增益（`dsh-zhiyun-shell-ui` 已管外壳/布局，工作台定位桌面） | 🔵 | proposed | 2026-10-27 | ★8，2026-08-21。**版本号三处不一致**：README 徽章 & `package.json` = `0.1.8`，npm latest = **`0.7.2`** → 无法确认锁的是哪版。仅作线索 |
| `MorGogh/widget-dock` | **A 原生DSH** | **MIT** ✅ | 通用（用量/成本/上下文） | **重复且无增益**：27 张卡片里余额/Token/成本/上下文/热度基本仓已覆盖，且形态是「对话两侧常驻拖拽台」，**面板形态冲突**（强化式第 1 条不成立） | 🔵 | proposed | 2026-10-27 | ★4，最后 push **2026-08-15**（73 天前）。`widget-dock@1.0.2`，自带 patch。不接 |
| `1624318455/dsh-plugin-tts` | **A 原生DSH** | **MIT** ✅ | 通用（朗读） | 重复且无增益（本仓无朗读功能 → 装了就是新开一条语音链路，五后端） | ⛔ | rejected | 2026-10-27 | ★42（本批最活跃），`@memef1f1y/dsh-plugin-tts@0.6.7`。**排除理由**：`dsh.client.inject: ['@deepseek-ai/dsh-client-ui-slots']` —— 与 r79 F-1 同类（页面**不提供** `slots` 服务）；且 peer `dsh-web >=0.1.0-rc.6` + `react ^18` 引入面过重。评审成本 >> 收益 |

> 单列待核（**不登记为候选行、不摘码**）：
> `huantest2024/dsh-anime-theme`（★1，2026-10-23，`NOASSERTION`）—— 二次元主题插件，LICENSE 正文未核。
> 本轮复核仍为旧结论的：`WYH66666666/DSH-Transparent-UI-Plugin`（**AGPL-3.0** ⛔）。

> **本轮方法论（写给下一轮）**：
> ① **A 组主词、中词、变体词三类词都见底了**：本轮 9 次「宿主面板形态」变体词只捞出 5 个新面孔，
>    命中率 0.55/次（r79 中词是 3.1/次）。**下一轮 A 组不要再换词，换轴** —— 沿着已登记的
>    1,524 行往回看，而不是往外捞。
> ② **「锁版」是个承诺，不是写法**：`"x.y.z"` 只保证「版本字符串看起来精确」。
>    必须另有一步去 registry 验证它存在、去 npm 验证它装得上。本轮之前，61 条锁版**一次都没验过**。
> ③ **peer 区间相交 ≠ 可共装**：判共装只能用真解析器（`npm --dry-run`）。
>    静态推断会漏掉「约束落在不同宿主子包」的冲突 —— 本轮实测漏报 40/43。
> ④ 本轮还修了检查器自己的两个缺陷：`||` 分支被当成单一区间（会把 `^0.1.x || ^0.1.y` 的上界算成 1.0）、
>    不可解析的分支被静默丢弃（会把「未知」误判成「不相交」）。**检查器也要被检查。**

### 第八十一轮（2026-10-27 · B 组 · 轴「装得上 ≠ 跑得起来」）

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `yumorie/ZJU_sqtp_LibraryCrawler` | B 其他JS（HTML 脚本） | Apache-2.0 | 图书馆座位 | 全新 | 🔵 | proposed | 2026-10-27 | ★1、无 README/description、单文件爬虫；非库形态不可锁版，且绕开 campus 合规出口，仅作线索 |
| `junyudev/Auto-Fill-Verification-Code-Box-of-ZJU` | B 其他JS | 无许可证 | 图书馆预约 | 全新 | 🔵 | rejected | 2026-10-27 | ⛔ 无许可证不得摘码；已归档、2021 年 DOM 注入脚本、验证码弹窗早改版。只登记一行 |
| `smd1121/ZJU_AutoScoreQuery_Archive` | B 其他JS（Python） | MIT | 成绩查询 | 全新 | 🔵 | proposed | 2026-10-27 | ★0、已归档、无 description；仓库名自带 _Archive，作者自己都不维护，不锁版 |

> **本轮口径**：B 组首屏未登记 58 条，相关性过滤后只留 3 行；**0 个 🟡/🟢**。
> 其余 55 条为课程资料库（内容版权，`NOASSERTION`/`null`）或与浙大/考试/刷题/笔记/论文/锻炼无明确交集。
> **B 组「找新插件」第 6 次封板确认**：首屏新面孔率约 1.7%，且全是 ★≤3 的归档仓。
>
> **声明层结论（不新增登记行，记在此处以免丢）**：骨架锁版引入的 21 个 DSH 插件包里
> **14 个**的 `dsh.client.inject` 没有 `peerDependencies` 背书，共 **16 个**宿主服务
> 被 inject 却无人声明（`dsh-client-ui-settings` / `dsh-client-locale` 各 7 包）。
> 检查器：`scripts/radar-inject-audit.mjs`；明细见 `2026-10-27-r81.md` §4.3。
>
> ⚠ **r80 的 P0-1 复核：仍未修。** `dsh-radar-credit-audit-vendor@1.7.0` 在 npm 仍 E404，
> 仓库根目录 `npm install` 直接失败（今天第 2 次提，见 r81 §6）。

### 第八十二轮（2026-10-27 · C 组 · 轴「复习模式到底复习了什么」）

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `brandonp2412/Flex` | B 其他JS（**Flutter/Dart**，非 JS 栈） | MIT | 锻炼 | 全新（本仓无锻炼面板） | 🔵 | proposed | 2026-10-27 | ★451，2026-10-27 push，**仓库 362 MB**。Flutter 成品 App，**Dart 非 JS 栈**，按 A/B 两类口径均为「不采用」；仅作「连击/周目标/进度图」交互形态参考。**不摘码** |
| `Horizon-42/paperloom` | B 其他JS（TS） | MIT | 论文批注 | 重复且无增益（⛔） | ⛔ | rejected | 2026-10-27 | ★0、2026-10-25 push、5 MB。整包论文阅读器（词级批注 + 术语表 + 笔记画布），**与 `dsh-zhiyun-page-paper` 同面板同功能**，无「更优底层」可抽 → 按强化原则排除 |
| `pph-hpp/yidu` | B 其他JS（TS） | MIT | 论文翻译阅读 | 重复且无增益（⛔） | ⛔ | rejected | 2026-10-27 | ★2、21 MB。整包「PDF 翻译阅读器」，译文对齐与批注均已有（`dsh-radar-deep-read` / paper 页），且**自带 LLM Key 体系**与宿主模型层冲突 → 排除 |
| `TOHgoto/cuhk-timetable-exporter` | B 其他JS（**Python**，非 JS 栈） | MIT | 课表导出 | 重复且无增益（本仓已有 `ics-export`+`ics-rrule`） | 🔵 | proposed | 2026-10-27 | ★2。港中文课表 → ICS/CSV/JSON，**Python**；解析逻辑绑死 CUSIS 页面结构，ICS 序列化部分本仓已锁版 `ics@3.12.1` → 无增益，仅形态参考 |

> **本轮口径**：C 组 10 次搜索、首屏未登记 **135 条**，相关性 + 语言栈 + 许可证三重过滤后只留 **4 行**。
> **0 个 🟡 / 0 个 🟢** → **不生成骨架**。
> 淘汰主因（逐条计数见报告 §2）：`timetable ics export` 22 条新面孔里 **14 条无许可证**、4 条 GPL/AGPL/LGPL，
> 宽松许可只剩 3 条且全是 ★≤5 的单一学校导出器；`fitness tracker` 首屏 ★ 前 16 名宽松许可仅 `Flex`（Dart）与 `fud-ai`（Kotlin）两条，
> **均非 JS 栈** —— 锻炼轴**第四次**同结论，正式建议从词池移除（见报告 §6）。
>
> **本轮实质产出不在登记表**：「复习」错题路由检查器 `scripts/radar-review-route.mjs`
> 实测 `review` 模式错题占比 **50.3%**（等价随机），与 r77 的源码推断一致且已黑盒复现；
> 5 条单测含**阴性对照**。明细见 `2026-10-27-r82.md` §3–§4。

### 第八十三轮（2026-10-27 · A 组·中词「dsh plugin manager / dsh plugin graph / plugin marketplace deepseek」· 轴「被关掉的包还在替别人顶着服务」）

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `LX2000WASD/dsh-web-plugin-manager` | A 原生DSH（`dsh.bundle.patch` + `dsh.client`，宿主+浏览器双面） | **MIT** ✅（`LICENSE` 1,067 B 逐字读过，`Copyright (c) 2026 LX2000WASD`，无附加限制；GitHub `spdx_id` 与 npm `license` 同口径） | 通用（插件管理） | **重复且可强化**（强化点在**「谁在等谁」的可用性分析**，不在启停） | 🟡 | proposed | 2026-10-27 | ★66 / TS / 2.1 MB / push 2026-09-20。**npm `dsh-web-plugin-manager@0.6.3` 可锁版** ✅。**判 🟡 不是 🟢 的三条**：① `cordis.patch.yml` 直接 `insert id: plugin-manager` 并 `disabled: true` 遮蔽官方 `ui-settings-plugin-inventory` → 与宿主同名行/同名服务**抢位**，r79 记过的「一行 id 撞车 → profile 起不来」同族风险；② 作者 README 首屏自述**已停维护**、DSH ≥ `0.1.6-alpha.2` 会 `duplicate loader entry id: plugin-manager` 直接启动失败（本仓宿主 `0.2.0-rc.2`，**未实测**）；③ 它整套写权（安装/卸载/profile 写）与本仓「profile 唯一写入者」权责冲突，**不能整包挂载**。**可摘的能力只有一层**：`src/analyze.ts`（39 KB）的 `disabled-dependency` 判定 —— 把「行被关掉」并入图，并对每个下游给一条 `enable-entry` 修复动作；`src/guard.ts` 的「按 shell 段判裸 CLI 变更」思路。**与 r79 F-1 / r82 的 `dependents` 口径直接相关**：本轮的 F-1 正是「关了之后图未更新」。后继为 `LX2000WASD/dsh-plugin-manager-companion`（★7，MIT，npm `0.1.4`，**未评估**，见报告 §5 待办） |
| `hikariming/dshfind` | A 原生DSH（插件市场 / 学习站） | **无许可证**（GitHub `license: null`，`spdx_id` 缺失）⛔ | 通用 | 重复且无增益 | ⛔ | rejected | 2026-10-27 | ★331 / TS / 26 MB / push 2026-10-27（当日）。**`license: null` → 按硬边界只登记、不采用、不摘任何代码**。形态为「DSH 原理教程 + 插件市场」，与在册 `dsh-market`（★9151）/ `imsai-sh/awesome-deepseek-harness-plugins`（★329）同一能力，**无更优底层** |
| `thomasguillot/fettlr` | B 其他JS（Rust 宿主 + React/TS 前端） | **MIT** ✅ | 通用（插件管理） | 重复且无增益 | ⛔ | rejected | 2026-10-27 | ★0 / 993 KB / push 2026-10-24。**它是 Claude Code 的 skill/子代理/插件/MCP 桌面管理器，不是 DSH 插件**（`topics` 全为 `claude-code-*`）；且主体是 Rust/Tauri，B 类要求 JS 栈。**「插件市场形态」已由在册 `dsh-market`/`dsh-web` 覆盖，无增益** |
| `xiajiajun516/dsh-config-manager` | A 原生DSH | MIT | 通用（配置备份） | 已有（备份/迁移） | 🔵 | proposed | 2026-10-27 | **已在册（第 80 轮登记）**，本轮仅作**交叉核对物**：它在同一生态内提供「导出/导入/迁移 profile 配置」，可佐证「profile 目录是可整体搬迁的工件」这一前提；**不重复登记为候选**，此处一行仅为追溯来源 |

> **本轮口径**：A 组中词 8 次搜索（`dsh plugin manager` 350 / `dsh plugin graph` 99 / `plugin marketplace deepseek` 103 /
> `tauri plugin marketplace` 5 / `tauri plugin registry` 1 / `extension registry plugin manager language:typescript` **0** /
> `feature flag dependency graph language:typescript` **0** / `vscode extension manifest parser language:typescript` **0**），
> 8 次 0 次 403，**完整**；首屏 45 个未登记 `owner/repo`，与在册去重后 **3 个新面孔 + 1 个在册交叉核对**。
> **实质产出全在本仓**：`scripts/radar-provider-liveness.mjs`（新检查器）+ `tests/radar-provider-liveness.test.mjs`（7 条，含阳性变异）。

## 第八十四轮（2026-10-27 · A 组 · 轴「这个锁版，到底能挂在哪个宿主上」）

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `LouisHaoL/dsh-timer-agent` | **A 原生DSH** | **MIT** ✅ | 通用（今天/规划页的「到时提醒」） | **重复且可强化**（页面内只有计时，无宿主常驻 ticker） | 🔵 | proposed | 2026-10-27 | ★13，TS，2026-10-09。`dsh-timer-agent@0.8.0` 未发 npm（**双名 404**）→ A 类锁版不成立。**形态最值得注意**：自报 `dsh.compatibility.dshReleases = {"0.2.0-rc.2":"compatible"}`，peer 全对 rc 快照。三条强化判据都成立，唯锁版不成立 → 观察，不判 🟢 |
| `skyjjgw/dsh-version-guard` | **A 原生DSH** | **MIT** ✅ | 通用（插件崩了能回退） | 重复且无增益（`undo-savepoint`/`upgrader`/`version-guard` 同列） | 🔵 | proposed | 2026-10-27 | ★1，JS，2026-10-20。`cordis.patch.yml` + PowerShell 脱离 DSH 进程回滚。**不新增第四家同列候选** |
| `hytime/dsh-thinking-effort` | **A 原生DSH** | **MIT** ✅ | 通用 | 重复且无增益（本仓不设模型档位面板） | 🔵 | proposed | 2026-10-27 | ★57，2026-10-2x。推理档位默认值 + 协议适配，能力落在宿主设置里 |
| `Player-MINEPIG/dsh-tavern` | **A 原生DSH** | **MIT** ✅ | 无 | 重复且无增益 | ⛔ | rejected | 2026-10-27 | ★25。对接 SillyTavern 的分支/角色玩法；**第二套会话执行机制**，触碰「不做第二套启动器」 |
| `luowang-ui/dsh-purge-plus` | **A 原生DSH** | **MIT** ✅ | 无 | 重复且无增益 | ⛔ | rejected | 2026-10-27 | ★58。**破限插件**：卸掉宿主提示词限制与审批拦截，与本仓安全补丁方向相反 |
| `lehhair/dsh-diff-viewer` | **A 原生DSH** | **`null`** ⛔ | 通用 | — | ⛔ | rejected | 2026-10-27 | ★25，JS，2026-10-19。根目录**无 LICENSE**、API `license: null` → 按硬边界只登记不采用、**不得摘码** |
| `CREAIT-nl/dsh-plugins` | **A 原生DSH（多包）** | **MIT** ✅ | 通用 | 重复且无增益（调研/按模型路由） | 🔵 | proposed | 2026-10-27 | ★6。一仓多插件（deep research preset / per-model 路由），能力域与本仓页面无交集 |
| `dsh-plugins/dsh-loader` | **A 原生DSH** | **LGPL-3.0** ⛔ | — | — | ⛔ | **rejected（结案）** | 2026-10-15 | **在册项结案**：原记 `NOASSERTION`/⚠ 待核，本轮通读 `LICENSE` 全文为 **GNU LGPL v3**（GitHub 认不出该变体才报 NOASSERTION）。copyleft → 排除，**不得摘取任何代码**。★2，TS。挂了 12 天的「待核」，核完是 LGPL |
| `ben-lau/deps-conflict-resolver` | B（非 DSH） | **MIT** ✅ | 通用（构建期） | 重复且无增益（解决依赖冲突，非 peer 版本窗口） | ⛔ | rejected | 2026-10-27 | ★2，TS，npm `1.1.0`（`semver`+`yaml`）。webpack/vite 插件，解决的是「别名消解冲突」，与本轮「宿主快照对不对得上」是两件事 |

> **本轮口径**：A 组 4 次搜索（`dsh plugin host` 462 / `plugin peer dependency` 16 / `dsh plugin compatibility` 73 /
> `cordis plugin version` 21），4 次 0 次 403，**完整**（未达上限，未为凑额度加搜）。
> 首屏 26 个未登记 `owner/repo`，其中 19 个是前两词的同集重叠或纯噪声（14 条是 webpack/vite 的 peer 冲突插件）；
> **首次登记 7 行 + 在册结案 1 行**。🟢 0 / 🟡 0 / 🔵 4 / ⛔ 4（含 1 条 LGPL 结案）。
>
> **实质产出全在本仓**：`scripts/radar-host-window.mjs`（新检查器，宿主层/框架层/锁版三层分离）+
> `tests/radar-host-window.test.mjs`（**13 条**，含框架层、预发布区间、交集、`UNKNOWN≠DRIFT` 四组边界）+
> **6 次真实 `npm install` 校准**（双向：过/不过各一组，另两对共存性）。
>
> **核心结论（M-3）**：宿主不是「版本窗口」而是**两个互斥快照** —— `dsh-tools@0.2.1-alpha.1` 把同代包 peer 写成
> **精确版本**，混搭两个快照直接 `ERESOLVE`（3 组实测）。由此 M-4：**11 个可判骨架里 0 个同时满足两个快照**
> （5 只对 rc / 1 只对 alpha / 6 两个都不对）。`preferredHostVersion = 0.2.0-rc.2` 不变的前提下，
> 「只对 alpha」的 `tool-plus` 现在装不上，而宿主换代会让「只对 rc」的 5 个当场失效 ——
> **这张表是换代前必须重算的，不是缺陷清单**。
>
> **自我纠正 2 处**：M-1 首版把 `@deepseek-ai/cordis`（4.x，框架层）当宿主比，13 个包全判 ❌（已分离）；
> M-2 首版拿 `dist-tags.latest` 的 peer 去评锁版（`dsh-panda-calendar` 锁 1.2.4 无 peer、latest 1.2.5 有四条），
> 凭空造出一个不相容（已改为按 `包@锁版` 取 manifest）。探针另错 6 次（`ETARGET` 误判为放行、latest/锁版混用）。

## 2026-10-27 · B 组（浙大场景 · **论文模板 / 许可证嵌套**轴）· 第八十五轮 · 追加

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `Shuenhoy/modern-zju-thesis` | B 其他JS（Typst） | MIT（根 LICENSE）**但含 CPAL-1.0/AGPL-1.0** | 论文（排版） | 重复且无增益 | ⛔ | rejected | 2026-10-27 | ★107，push 2026-05-13。浙大 Typst 学位论文模板（本科 CS + 研究生通用），`assets/gb-t-7714-2015-numeric-bilingual-title-case.csl` + 封面/中英标题页/声明页齐全。**排除理由（三层嵌套）**：参考文献页 `pages/bibliography.typ` 仅 8 行，实现全在 `utils/citext/`（嵌套副本，`README` 明写 copied from `Shuenhoy/citext`）；其 `dist/third-party-licenses.txt` 12 条依赖里 **`citeproc@2.4.63` = `CPAL-1.0 OR AGPL-1.0`**，不在宽松白名单 → 按硬边界**不得摘取任何代码**。⚠ **版式部分（cover/title/decl/style）确为 MIT 且不经过 citext**，若将来立项「论文排版」面板可单独评估，但属**新面板**（生产 vs 本仓 page-paper 的消费），不构成强化式集成 |
| `Shuenhoy/citext` | B 其他JS（Typst） | 声明 MIT（`typst.toml` `license = "MIT"`）**实际含 CPAL-1.0/AGPL-1.0** | 论文（引用格式） | 重复且无增益 | ⛔ | rejected | 2026-10-27 | ★6，push 2026-03-17。用 `@citation-js` + `citeproc`（WASM/QuickJS）让 Typst 支持 CSL-M 与双语参考文献。**声明与实际不符**：`typst.toml` 写 MIT，`dist/third-party-licenses.txt` 里 `citeproc@2.4.63` 为 `CPAL-1.0 OR AGPL-1.0`。**这是 r55 `dsh-radar-refs-import` 那条「绕开 `citeproc`/NOASSERTION」策略的硬证据**：此路确实绕不过去，需在本仓做 CSL 输出则落点必是 citeproc → 应保持「明确不做引文样式输出」 |
| `cyc-987/zju-isee-bachelor-thesis-template` | B 其他JS（TeX） | **GPL-3.0** | 论文 | 无关 | ⛔ | rejected | 2026-10-27 | ★16。ZJU ISEE 本科论文 LaTeX 模板。GPL-3.0 不在宽松白名单 |
| `cyc-987/zju-isee3in1-bachelor-thesis-template` | B 其他JS（TeX） | **GPL-3.0** | 论文 | 无关 | ⛔ | rejected | 2026-10-27 | ★11。同作者第二套（isee3in1.cls，含文献综述）。GPL-3.0 |
| `szcf-weiya/zju-thesis` | B 其他JS（TeX） | **LPPL-1.3c** | 论文 | 无关 | ⛔ | rejected | 2026-10-27 | ★19。ZJU 本科论文 TeX 模板。LPPL-1.3c 不在宽松白名单（LaTeX 项目文档许可，常被误认为宽松） |
| `ZhenHuangLab/ZJU-CAB-thesis-zotero-csl` | B 其他JS（CSL） | **NOASSERTION** → 核为 **CC BY-SA 衍生** | 论文（引用样式） | 全新（极窄） | ⛔ | rejected | 2026-10-27 | ★3。浙大农学院本科毕设 Zotero 引用样式，「**修改自 415zhejiang-university.csl**」= CSL 官方样式库的衍生作品（上游默认 CC BY-SA 3.0）→ 须继承 CC BY-SA，**不在白名单（仅收 CC0-1.0）**。**当日核清，不拖过夜**；排除理由不是"没写许可"而是"派生自何处" |
| `Magnetization/zju-thesis-QA` | — | **null** | — | — | ⛔ | rejected | 2026-10-27 | ★24 但 **license=null**、无 description、2019-06 最后 push。`null` 直接排除，不展开评估 |
| `denil1111/ZJU-Thesis-Template-for-Mac` | B 其他JS（TeX） | MIT | 论文（Mac 适配） | 无关 | 🔵 | proposed | 2026-10-27 | ★27，**最后 push 2017-03-27（9 年未更新）**。Mac 字体适配说明仍有史料价值，但学校格式早已变更，不可作为格式依据 |
| `kaitokuroba7/zju-eng-master-thesis-template` | B 其他JS（TeX） | MIT | 论文（工程师学院） | 无关 | 🔵 | proposed | 2026-10-27 | ★10，2026-04 新建。**仅覆盖工程师学院一个学院**，样本太窄；格式细节可作 `zjuthesis` 的补充参照 |
| `corenel/zju-thesis` | B 其他JS（TeX） | MIT | 论文 | 无关 | 🔵 | proposed | 2026-10-27 | ★7，2020 最后 push。研究生 LaTeX 模板，已被在册 `TheNetAdmin/zjuthesis`（★3795）覆盖 |
| `charlie1587/zju-cst-thesis-template` | B 其他JS（TeX） | MIT | 论文（软件学院） | 无关 | 🔵 | proposed | 2026-10-27 | ★2，2026-07 新建，"out-of-the-box" 软院模板，宣称适配最新格式要求；★过低、未经校验，仅作参照 |

> **本轮 0 行 🟢 / 0 行 🟡、0 个骨架。** 论文模板域三条强化式判据（同一面板 / 功能正交 / 更优底层）**全部不成立**：
> 模板是**生产**（出 .pdf 终稿），本仓 `dsh-zhiyun-page-paper` 是**消费**（读 / 存 / 标），不属同一面板；
> 唯一像"更优底层"的引用排版实现被 §许可证链条否决。
>
> **方法层产出（可复用）**：许可证审计须三层 —— ①GitHub `spdx_id` ②`LICENSE` 首行 / 包清单 `license` ③**嵌套副本的 `dist/third-party-licenses.txt`**。
> 本轮 `modern-zju-thesis` 是「①② 全绿、③ 一票否决」的典型：12 条依赖里 11 条合规，仅 `citeproc` 一条 CPAL/AGPL，但 CSL 能力**只**由它提供。
>
> **B 组封板建议**：11 次搜索中 **7 次 total_count=0**，`zju thesis language:javascript` / `language:typescript` **均为 0** → 论文域无 JS 项目。
> `zju` 存量已挖尽（registry 1415 行），建议 3 个月内不再重扫常规词库，仅保留 `zju created:>YYYY-MM-DD` 增量轴。

---

## r86 · 2026-10-27（C 组 · 轴「论文库从哪来」）

> 搜索 7 次（≤10）、0 次 403、**完整**。新面孔 **7 行**（🔵6 / ⛔2）。
> **1 行在册复核升级：`nftuoa/dsh-zotero` 🔵 → 🟢**（L2560），理由：4 天内由「★0 + 当日建仓 + 无 npm」
> 变为「**有 GitHub Release v1.0.1 + 打好的 tgz 可锁版 + 标准 A 类形态**」。
> 骨架 `dsh-radar-zotero-bridge`（A 类，锁版 `@local/dsh-zotero@1.0.1`，强化式集成）。
> **两条硬坑已写进骨架待决清单**：① 上游 `vendor/pdfjs/standard_fonts/LICENSE_LIBERATION` = GPL-2.0 字体例外（嵌套一票否决）；② 包名 `@local/` 永不发 npm，依赖须改 tarball。

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `nftuoa/dsh-zotero`（复核升级，见 L2560） | A 原生DSH | **MIT** ✅ | 论文（文献库来源） | **重复可强化**（论文页·只借 `/zotero/*` 路由，弃其客户端） | **🟢** | proposed | 2026-10-27 | 复核打穿 L2560 的两条挡板：**① 已有 Release `v1.0.1` + `dsh-zotero-1.0.1.tgz`（2026-10-23T12:52Z，4.26 MB）→ 可锁版，M1 作废**；② 形态已确认为标准 A 类（`dsh.bundle.patch` + `cordis.patch.yml`，`insert id: zotero`）。**结构两意外**：(a) `dependencies`/`peerDependencies` **全空**、`lib/` 无任何 `@deepseek-ai/*` → 「锁版 DSH 包」不适用，能锁的只有它自己；(b) 自带 `vendor/`（pdf.js+KaTeX+字体，3.7 MB），**7 项宽松 ✅、`standard_fonts/LICENSE_LIBERATION` = GPL-2.0+字体例外 ⛔**。**与现有功能**：本仓 page-paper 的库是上游自建，`grep -i zotero` 在 page-paper/host-paper **零命中** → Zotero 原生高亮/子笔记回写是完全缺失来源；但**客户端抢 `sidebar.panellist`+`slots.register`** = 第二套布局主张，故必须弃客户端、只借路由。骨架 `packages/radar/dsh-radar-zotero-bridge`（依赖写法故意留缺陷待评审） |
| `GindaChen/scholarly-reader` | B 其他JS | **MIT** ✅ | 论文批注 | 重复且无增益 | 🔵 | proposed | 2026-10-27 | ★0，单 HTML 页，arXiv 导入 + 可变批注 + 数学渲染。push **2026-03-02**（7 个月未动）；无模块边界可摘 |
| `ChangHsiang/PDF-Reader` | B 其他JS | **MIT** ✅ | 论文批注 | 重复且无增益 | 🔵 | proposed | 2026-10-27 | ★1，Chrome/Edge 扩展（标注 + 文献卡片 + 划词翻译），push 2026-10-19。**强耦合 `chrome.*`**，与 iframe 路线不兼容 |
| `AJboos/paper-loom` | B 其他JS | **MIT** ✅ | 论文精读 | 重复且无增益 | 🔵 | proposed | 2026-10-27 | ★1，Windows 桌面 AI 阅读器（翻译/双语/批注/问答）。与在册 `Paper-Lantern` 同质，★1 |
| `martin2026us-lab/paper-space` | B 其他JS | **MIT** ✅ | 论文精读 | 重复且无增益 | 🔵 | proposed | 2026-10-27 | ★1，本地优先 AI 阅读工作台。与上条同族，无差异点 |
| `haunledeshuchang/moyue-reader` | B 其他JS | **MIT** ✅ | 无（电子书阅读） | 无关 | 🔵 | proposed | 2026-10-27 | ★1，Windows EPUB/PDF/TXT/MOBI 双页阅读器。非论文域，不构成强化 |
| `guillermoscript/calistenia-app` | B 其他JS | **MIT** ✅ | 锻炼 | 全新（本仓无锻炼面板） | 🔵 | proposed | 2026-10-27 | ★9，TS，2026-10-25 活跃，PocketBase 自托管 + AI 教练。**完整产品形态**（RN Expo + Web PWA），非可嵌入底层 → 强化式第③条不成立 |
| `Scyyyy4/quizdesk` | B 其他JS | **`null`（无许可证）** ⛔ | 刷题 | 重复且无增益 | ⛔ | rejected | 2026-10-27 | ★3，TS。Word 导入 + 练习 + 错题本，与题库页同域；**无许可证红线，不摘码** |
| `ayozoo/pdf-quiz-practice` | B 其他JS | **`null`（无许可证）** ⛔ | 刷题 | 重复且无增益 | ⛔ | rejected | 2026-10-27 | ★7，TS，React19+NestJS+SQLite。PDF 试题按正则模板自动拆分 —— 思路可参考，**无许可证，不摘任何代码** |

> **本轮方法论（可复用）**：**「★0 + 当日建仓」是一条会过期的理由。**
> L2560 当时判 🔵 完全正确，但它的两个挡板（★ 与「无 npm」）在 4 天内**都可以被独立证据推翻** ——
> 本轮推翻的是后者（有 Release + tgz）。→ 凡以「太新 / 没发布 / 还没动静」为由压级的条目，
> 应在 `备注` 里写清**哪条证据能让它翻案**，否则它会在 registry 里沉底，永远不再被复核。
>
> **嵌套许可证的新样本**：这是本仓第一次遇到「上游 A 类包自带 pdf.js vendor」。
> `LICENSE_LIBERATION`（GPL-2.0 + 字体例外）是 pdf.js **官方发行版的标配**，
> 意味着**任何**自带 pdf.js 的候选都会踩到它 → 建议单独立一条判定口径
> （「字体作为渲染资源不构成衍生」是否成立），而不是每次临场决定。

## 2026-10-28 · 第八十七轮（B 组 · 轴「登录链的上游替换 + 会议/期刊判定的真实输入」）

> 真日期 **2026-10-28**（年积日 301，`301%3=1` → **B**）。搜索 **10 次**（达上限未超限），0 次 403，**本轮完整**。
> 新面孔 **4 行**（🟡1 🔵2 ⛔1，**🟢 0**）；在册复核 **4 条**（全部维持）。
> **骨架 1 个**：`packages/radar/dsh-radar-zju-login`（B 类，锁版 `login-zju@1.0.9`）。
> **实质产出**：`scripts/radar-rotation.mjs` 时区缺陷已修（上海 00:00–08:00 场次绕过当日去重），测试 14 → **18**。

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `holly1226/zotero-venue-tagger` | B 其他JS（Zotero 10 插件 `bootstrap.js` 1281 行 + Node/Python 脚本） | **MIT** ✅（`LICENSE` 首行 `Copyright (c) 2026`，GitHub `spdx_id` 一致） | 论文（会议/期刊分级） | **重复且可强化**（形态受限 → 不出码） | 🟡 | proposed | 2026-10-28 | ★35，push **2026-10-17**（11 天未动）。51 条规则（`rule_set=zju-design-2021_ccf-hci-2022`）+ DOI→轨道纠正表。**本仓空洞是真的**：`page-paper/src/library.js:52` 的文献只是 `{topic,name,pdfPath}`，全仓 grep `venue`/`ccf`/`影响因子` **零命中**（唯一「会议」在 `core-lecture/tree.js:119` 是腾讯会议）。**但实测三条硬约束**：① 输入字段不存在 —— `venue_text()` 只读 `publicationTitle/proceedingsTitle/conferenceName/series/bookTitle/pages`，本仓 item 喂进去 `match=null`（空串），只有把 `name` 当 `publicationTitle` 才命中；② 学科只覆盖 HCI/普适计算（OSDI/SIGCOMM/INFOCOM/JMLR **0 命中**）；③ `npm view zotero-venue-tagger` **404**、无 `package.json` → **不可锁版**。→ 判据①③均不成立，**不出骨架**。**只带走思想**：`references/policy.md` 四条口径（非全文轨道不给评级 / ZJU 直取优先、CCF 仅兜底 / EA·Companion·Workshop 单独成标签 / 列表必须版本化）——将来自建分级时照此写规则，**不搬它这 51 条** |
| `ZJU-CC98/CC98-TeacherEvaluationSystem` | B（名不副实：**C# / ASP.NET Core**） | Apache-2.0 ✅（`LICENSE` 全文） | 选课 / 评课 | 全新但**技术栈不符** | 🔵 | proposed | 2026-10-28 | ★1，push **2020-03**（6 年未动）。GitHub 标 `JavaScript` 只因 `wwwroot/js/site.js` 一个模板脚本；实质是 `CC98.TeacherEvaluationSystem.sln` + EF Core（`Data/{Teacher,Department,Vote,Mark}.cs` + `Migrations/`）。**不可作 JS 依赖**；唯一价值是「评课数据模型」的四张表 + `Department`→`DepartmentParent` 自引用可作只读参考。与在册 `zjufishboy/TalkTrue`（★3，只有前端）同簇，本条补上缺失的后端形态 |
| `WestQuake/zju-reveal-md-template` | B 其他JS（Node 脚本 + `reveal-md`） | **`null`（模板自身无 LICENSE；`.vendor/reveal-md/` 自带的是上游 MIT 副本）** ⛔ | 课程展示 / 答辩 | 无关 | ⛔ | rejected | 2026-10-28 | ★4，push 2026-09-23。浙大幻灯片模板；无许可证 → **不摘码**。且本仓 `page-study/src/lecture-export.jsx` 已有讲义导出，模板类不构成底层增强 |
| `zju plugin language:typescript` 查询本身 | — | — | — | — | **total=0** | — | 2026-10-28 | **结构性负结果**：浙大生态**不存在**「DSH 插件」层 → B 组永远挖不到 A 类候选。建议 B 组后续**不再尝试** `plugin` 类词，改「每 3 天一轮、只走 `created:>` 增量轴」 |
| `Coran-tech/cc98-reborn`（复核） | B 其他JS | MIT ✅ | 论坛 | 重复且无增益（**维持**） | 🔵 | proposed | 2026-10-24 | 本轮浅克隆核了 API 面，补齐一手资料：收藏分组 `GET /me/favorite-topic-group`；收藏列表 `GET /topic/me/favorite?from=&size=&order=2&groupid=`，**上游页大小 11、游标步长 10**（多取一条 lookahead）。本仓 `source-cc98` 的 10 个只读方法**没有收藏**，但「给反馈页接 CC98」不是当前需求 → 仍判重复无增益 |
| `5dbwat4/login-ZJU`（复核 → 出骨架） | B 其他JS | **MIT** ✅ | 账号/登录（全场景前置） | **重复可强化**（判据②**仅部分成立**） | 🟢 | skeleton-created | 2026-10-16 | 骨架 `packages/radar/dsh-radar-zju-login`。npm `login-zju@1.0.9`（2026-07-03）**真·可锁版**：`deps` 仅 `nanoid`、`peer`/`engines` 空、MIT 三处一致、导出 12 个服务。**三条待决**：① 上游 README「上次成功时间」最新 **2026/4/14**（6 个月未真机复验）；② **上游无 WebVPN** → `source-netproxy` 不可撤（`describeCoverage()` 输出 `overlap=classroom,courses` / `uncovered=xzzd,pta,card,netproxy`）；③ 上游只收明文 `new ZJUAM(u,p)`，本仓账号加密落盘 → 需评审批准或否决。README 首屏把判据②写成「⚠ 部分成立」并附「若答否 → 撤销」表 |
| `memset0/Learning-at-ZJU-Helper`（复核） | B 其他JS | MIT ✅ | 学在浙大/智云课堂 | 重复且无增益（**维持 🔵**） | 🔵 | proposed | 2026-10-16 | ★**60**（较 r85 的 59 +1），但 push 仍 **2024-12-05**，停更 22 个月 |
| `burriedalien666/zju842-practice`（复核） | B 其他JS | MIT ✅ | 刷题 | 重复且可强化（**维持 🟡**） | 🟡 | proposed | 2026-10-19 | ★23，push 2026-10-25（仍活跃）。题库版本化（`library.json` 指针 + `edition-<hex16>`）仍是可借点 |

> **本轮方法论（可复用）**：
> ① **「上游有一份规则库」≠「它对本仓可用」** —— 用之前先把它**喂本仓的真实 item 形状**跑一遍（本轮 `match=null`）。
> 凡是 `venue_text`/`match_rule` 这类**按字段名取值**的实现，都要先查「本仓到底有没有那个字段」。
> ② **`total=0` 有时是结论而不是失败**：`zju plugin` = 0 直接证明「B 组挖不到 A 类」是结构性的。
> ③ **判据② 只判「部分成立」时也要照常出骨架，但必须把「哪一部分不成立」写在 README 第一屏**，
> 并附「若答否 → 撤销」——否则评审完没人回来把结论写回去（r86 的三条坑至今悬着）。

## 2026-10-28 · r88 · C 组（轴「**复习队列的时间维度**」）· 追加

> 搜索 10 次，0 次 403。🟢 新增 **0**；1 条在册项实质复核（`ts-fsrs`）。
> 骨架 1 个：`packages/radar/dsh-radar-review-due`（B 类，锁版 `ts-fsrs@5.4.2`，**实跑通过**）。

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `Sthabiso10/recall-srs` | B 其他JS | MIT | 复习调度 | 重复可强化（学习·题库复习队列） | 🔵 | proposed | 2026-10-28 | ★1 / TS / push 2026-09-26。**形态最对口**（headless FSRS + React），但 ★1 无 release → 不足以锁版；调度层同源 `ts-fsrs`，不重复造。仅记线索 |
| `Sandaliy/Neuron` | B 其他JS | MIT | 复习排期 | 重复可强化（学习·排期） | 🔵 | proposed | 2026-10-28 | ★1 / TS / push 2026-10-16。「排时间不排卡片数」的思路值得抄（本仓正缺时间维度），项目本身不可依赖 |
| `elianiva/nook` | B 其他JS | MIT | 闪卡 | 重复可强化（复习） | 🔵 | proposed | 2026-10-28 | ★5 / TS / push 2026-10-23。完整 SRS app，无可摘模块边界 |
| `kylianmarceau/qard-obsidian` | B 其他JS | MIT | 闪卡 | 重复无增益 ⛔ | 🔵 | proposed | 2026-10-28 | ★6。Obsidian 插件，强耦合宿主（同 r85/r86 对 Obsidian 系一贯判断） |
| `Nina-noSchool/ByeByeBaGu` | B 其他JS | MIT | 面试八股 | 重复无增益 ⛔ | 🔵 | proposed | 2026-10-28 | ★3 / HTML。Markdown 题源 + FSRS，与本仓题库同构到「重写一遍更便宜」 |
| `Emadab/Synapse` | B 其他JS | MIT | 闪卡 | 重复无增益 ⛔ | 🔵 | proposed | 2026-10-28 | ★7，但 **Rust**，非 JS 栈 → 硬规则出局 |
| `klutometis/srs-mcp` | B 其他JS | MIT | 复习 | 无关 | 🔵 | proposed | 2026-10-28 | ★2 / Python。MCP server；本仓已有 deeptutor MCP 路径，不另起 |
| `vincenzo-afk/PenFlow` | B 其他JS | **null** ⛔ | 手写笔记 | 重复无增益 ⛔ | ⛔ | rejected | 2026-10-28 | ★25 / TS。**无许可证** → 不采用、不摘码。手写笔记域与 `dsh-radar-ocr-web` 重叠 |
| `JudgePeach/math-question-bank` | B 其他JS | **AGPL-3.0** ⛔ | 题库 | 重复且可强化 | ⛔ | rejected | 2026-10-28 | ★357 / push 2026-10-27（高活跃）。AGPL 一票否决。**仅作设计参考**：本地题库 + LaTeX 实时渲染 + OCR 公式识别三段式，不摘任何代码 |
| `mengxi-ream/read-frog` | B 其他JS | **GPL-3.0** ⛔ | 语言学习 | — | ⛔ | rejected | 2026-10-28 | ★10202，搜索中最高星。GPL 一票否决，**不入候选池** |
| `designfuchen/word-atlas` | B 其他JS | **NOASSERTION** | 词汇 | — | 🔵 | proposed | 2026-10-28 | ★2422。许可证 NOASSERTION → **待人工核验，不采用** |
| `masaok/metastack` | B 其他JS | MIT | 刷题 | 重复无增益 | 🔵 | proposed | 2026-10-28 | ★2 / TS。系统设计面试闪卡；已在上轮 `spaced repetition` 搜索中错失去重，本轮补记 |
| `MHK-ctrl/notesnap` | B 其他JS | MIT | 笔记 | 重复可强化（OCR） | 🔵 | proposed | 2026-10-28 | ★1。「拍照→可编辑文本」，与 `dsh-radar-ocr-web` 同域但 ★1，仅线索 |
| `suburb6/StudySky` | B 其他JS | **AGPL-3.0** ⛔ | 课表/笔记 | 重复无增益 | ⛔ | rejected | 2026-10-28 | ★5。自托管学生工作台（课表+笔记+任务）；AGPL 一票否决 |
| `heig-tin-info/heig-quiz` | B 其他JS | **null** ⛔ | 刷题 | 重复无增益 | ⛔ | rejected | 2026-10-28 | ★7。无许可证 |
| `stella-wood/tijian-quiz` | B 其他JS | MIT | 刷题 | 重复无增益 | 🔵 | proposed | 2026-10-28 | ★2。TXT/Markdown 本地刷题；与本仓题库同域，★2 无增益 |
| `hyggg222/ise-quiz-drill` | B 其他JS | **null** ⛔ | 刷题 | 重复无增益 | ⛔ | rejected | 2026-10-28 | ★5。还原某课程 quiz 界面的刷题器；无许可证 |
| `Trotter84/web-quiz-project` | B 其他JS | **null** ⛔ | 刷题 | 重复无增益 | ⛔ | rejected | 2026-10-28 | ★4。课程作业项目；无许可证 |
| `HadiYoussef2005/LeetLeitner` | B 其他JS | **null** ⛔ | 刷题 | 重复无增益 | ⛔ | rejected | 2026-10-28 | ★2。LeetCode + Leitner；无许可证 |

### 在册项复核（不改行，只记结论）

| 仓库 | 原判定 | 复核结论 | 依据 |
| --- | --- | --- | --- |
| `open-spaced-repetition/ts-fsrs` | 🟢（2026-10-14，「已出骨架 dsh-radar-fsrs-scheduler」） | **🟢 维持，但「已出骨架」须降级为「骨架为占位」** | npm `latest` 仍 `5.4.2`（`6.0.0-beta.15` 为 beta）→ 锁版正确；★835；MIT 实文已读。**骨架 `src/index.js` 只有 `export const name` + TODO，无任何可执行代码**，14 天零进展 |

### 本轮钉住的旧断言修正

- `packages/radar/dsh-radar-ocr-web/src/index.js:74` 写「`recordAttempt` 定义处一处」——**结论对、路径错**：
  正确路径是 `packages/dsh-zhiyun-core-quiz/src/store.js:608`（不是 `dsh-zhiyun-quiz`，行号已漂移）。
  下轮若要复核「作答通路是否接通」，请按正确路径 grep。

### r89 · 2026-10-28 06:05 · A 组「插件市场的『谁来担保』」

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `dsh-research/dsh-research` | A 原生DSH | MIT | 论文/文献/写作 | 重复可强化（插件页） | 🟢 | skeleton-created | 2026-10-28 | ★10，push 2026-10-21。LICENSE 实文 `MIT / (c) 2025 ai4scholar`；npm `latest=0.4.4` 单 tag、**零运行时依赖**、`dsh.bundle.patch` 齐。**是叠在通用市场之上的限定目录**（上游自述：官方市场装得下所有，但答不了「哪些是我的」）→ 不是 `dsh-market` 的替代。已出骨架 `dsh-radar-research-market`，锁 `0.4.4` |
| `bruc3van/safer-dsh-market` | A 原生DSH | MIT | 通用 | 重复可强化（插件页·审核维度） | 🟡 | proposed | 2026-10-28 | ★9，push 2026-10-22。通用市场 + **装后只读 AI 审查** —— 本仓插件页**无审核维度**，是真空白。但索引来自第三方域名 `bruc3van.com`，且上游自承「事后审查挡不住安装期执行」→ 作「审核 UI 参考实现」，不做锁版依赖 |
| `Sivan757/dsh-agent-plugins-market` | A 原生DSH | MIT | 通用（技能/MCP） | 重复可强化（技能簇） | 🟡 | proposed | 2026-10-28 | ★17，push 2026-10-27。skills / subagent / MCP / LSP 四合一管理器，**原地读** Claude Code·Codex·Cursor 布局、不转格式不复制。本仓有 `host-deeptutor` 与 MCP 路径 → 技能簇若要开轴的首选。★17 偏小、14 MB，本轮不动 |
| `liangmianya/dsh-synapse` | A 原生DSH | MIT | 通用（会话分支） | 重复且可强化（**形态待定**） | 🔵 | proposed | 2026-10-28 | **★598，本轮最值得记但判不了的一条**。会话地图/分支画布，保留 DSH 原生 fork 为唯一事实源；本仓「问一问」线性无分支视图 → 形态上真空白。**但 `files` 只发 `index.js`/`client.js`/`app.js`，画布实现全内嵌 `app.js`，无可独立复用包** → 「锁版挂载 + 外围兼容层」拿不到东西。整套挂载=替换「问一问」交互（超出强化边界），摘代码=违反「不搬运源码」。**需人工拍板** |
| `web-casa/DeepSeek-Harness-Desktop` | A 原生DSH | MIT | — | 无关（宿主壳） | 🔵 | proposed | 2026-10-28 | ★124。Windows/macOS 打包，本仓是 profile 插件仓，不涉及 |
| `qufei1993/dsh-desktop` | A 原生DSH | MIT | — | 无关（宿主壳） | 🔵 | proposed | 2026-10-28 | ★56。同上的社区桌面客户端 |
| `FlashingChen/dsh-desktop-hub` | A 原生DSH | MIT | 通用 | 重复无增益 | 🔵 | proposed | 2026-10-28 | ★62。Electron 多 Tab 管 Harness/Plugin/MCP/Skills。本仓插件页在仓内，不靠外部控制台 |
| `pingfanfan/hello-dsh` | A 原生DSH | MIT | 通用 | 无关（教程） | 🔵 | proposed | 2026-10-28 | ★104。22 个中文技能实例的**教程**，作 `docs/` 写作参考，不集成 |
| `Devin-AXIS/deepseek-design` | A 原生DSH | **NOASSERTION** ⚠ | 通用（PPT） | 待核 | ⛔ | pending-license | 2026-10-28 | **★1607，本轮最高星**。可编辑设计系统 + 模板市场。许可证待人工核验，**不采用、不摘任何代码** |
| 通用市场 / 皮肤 / 桌面壳簇：`acryldev/store`(★10)、`DSH-PackForge/dsh-pack-market`(★10 CC0)、`w2112515/dsh-plugin-marketplace`(★17)、`springbrand-lab/dsh-plugin-market`(★9)、`keman-ai/dsh-skin-market`(★9)、`AIcivilization/dsh-vps`(★10)、`arcships/rutis`(★160 **Rust**)、`youdotcom-oss/agent-skills`(★97)、`wh000wh000/awesome-claude-mods`(**NOASSERTION**) | A 原生DSH | MIT / CC0 / NOASSERTION | — | 重复无增益 / 非 JS 栈 | ⛔ | rejected | 2026-10-28 | 市场簇已判 ⛔ 六条在册，这批是第 7 个及以后；`rutis` 为 Rust（非 JS 栈）；`awesome-claude-mods` 许可证待核。**本轮起市场类去重改判据：先问「是通用目录还是限定目录」「是否要求另一个市场存在」「安装通路是否自建」** |
| 许可证红线簇：`liguobao/ds-harness-remote`(**null**,★898)、`urzeye/ophel`(**GPL-3.0**,★1003)、`polang233/dsh-plugin-index`(**GPL-3.0**)、`losebird/dsh-plugin-market`(**null**)、`dsh-plugins/dsh-launcher`(**null**)、`2439816947/DSH-Desktop`(**null**)、`xingj404-lab/dsh-desktop`(**null**) | A 原生DSH | null / GPL-3.0 | — | — | ⛔ | rejected | 2026-10-28 | 6 条 `null` + 2 条 GPL-3.0。**星级与许可证质量零相关**：★1003 与 ★898 全在这一簇 |
| 桌面旁挂簇：`Clarklevis1995/dsh-mobile`(★666 Kotlin)、`cocode-agency/cocode`(★166)、`MichengAI/dsh-codex-desktop`(★124)、`bruc3van/dsh-desktop`(★93)、`ningbainb/deepseek-harness-desktop`(★875)、`liyupi/dsh-kun-like-pet`(★110)、`xiaoshihou514/dsh-desktop-pet`(★59)、`chromoany/dsh-notify-me`(★69)、`Phant0Meow/dsh-meow-smooth`(★65)、`AnacondaKC/dsh-stock-market`(★20) | A 原生DSH | 多为 MIT | — | 重复无增益 | ⛔ | rejected | 2026-10-28 | 与 32 个 `dsh-zhiyun-*` 包无功能交集：宿主壳 / 终端侧外挂 / 皮肤。桌宠类本仓 `page-planning` 已有 pet（七条 `planning-pet*.test.mjs` 在册），换宠物属皮肤不是生态 |
| `zenstory-ai/oh-story-dsh` | A 原生DSH | MIT | 无关（网文） | 重复无增益 | ⛔ | rejected | 2026-10-28 | ★629。小说/短剧/游戏/视频解说四个工作台，与浙大·考试·论文场景无交集 |
| `yexi-by/dsh-unrestricted` | A 原生DSH | MIT | — | — | ⛔ | rejected | 2026-10-28 | ★714。提示词破限插件。**不登记为候选、不集成**：与雷达用途无关且方向不当 |

**r89 判据订正（重要）**

- r88 把 `dsh-research` 记为「第四个插件市场 → ⛔」，**判据错了**：它是**向通用市场请求目录的叠加层**，
  不是替代品。市场类候选的正确判据见上表「通用市场簇」备注。结论：`dsh-radar-market`（`dshmarket@1.66.21`）
  与 `dsh-radar-research-market`（`dsh-research@0.4.4`）**可共存，但只能有一个 `allowInstall` 开着**。
- `dsh-synapse` 的方法层教训：**高星候选先看 `files` 字段**。它只发 3 个 js、画布全内嵌 → 锁版挂载路线直接出局，
  一个字段省掉一次误判。

### r90 · 2026-10-28 09:10 · C 组「双语字幕那条轨，一直都在」

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `rockbenben/subtitle-translator` | B 其他JS | MIT | 课堂字幕 / 讲义原文层 | 重复可强化 | 🟡 | proposed | 2026-10-28 | ★1181，TS，push 2026-10-20，5.5 MB。核心设计（README 首句）：「**时间码在本地剥离，只把台词发给引擎**」—— 正是本仓缺的层。**但根包是 Next.js App**（deps 含 next/antd/deepl-node，**无 main/exports**）→ 不可 `npm i` 锁版；有价值处 `src/app/lib/translation/formats/subtitle.ts` **1525 行 83 KB、仅 1 个仓内 import**（`@/app/utils/textUtils` 的 `splitBySpaces`）→ 移植 ∝ 抄源码。`pipeline.ts`(91KB)/`registry.ts`(**245KB**) 是 27 家 LLM 适配矩阵，**与 DSH 模型层完全重复** ⛔。只取**方法**：`detectSubtitleFormat → filterSubLines(记物理行号) → assembleSubtitle(原位回填)`，即 F-1/F-2 修复该用的结构。**教训：高星 + 单一巨型源文件 → 先看有无 `main`/`exports`**（与 r89 `dsh-synapse` 看 `files` 同类） |
| `Genei-Ltd/jssbd` | B 其他JS | MIT | 讲座 / 字幕断句 | 重复可强化（F-2 邻近） | 🔵 | proposed | 2026-10-28 | ★**0**，TS，2026-09 建仓。pySBD 的 JS 移植，**零依赖**、`exports` 双格式齐。**npm 包名 `@coloop-ai/jssbd@0.1.0`，registry 返回 `Not found`** → 不可锁版；★0 无外部使用。只作「断句规则从哪借」的线索；本仓 F-2 的信号（停顿 / 翻页 / section）已足够，不必引入 |
| `plutado/0-0` | B 其他JS | MIT | 课堂回放 / 时间轴 | 重复无增益 | 🔵 | proposed | 2026-10-28 | ★0，2026-10-21 建仓。零依赖 Web Component（视频 + 定时转写 + 章节卡）。**未发布 npm**（`0-0` 无 `dist-tags`）。功能面 ⊂ `core-player` + `page-study` → 边缘重复 |
| `eatgrass/obsidian-lyrics` | B 其他JS | MIT | 音频 / 逐行高亮 | 重复无增益 | 🔵 | proposed | 2026-10-28 | ★37，2024-02 后未动。Obsidian 插件（运行时依赖 `obsidian`），**只处理 LRC 歌词**，非字幕 → 对象不同，无增益 |
| `hockyy/miteiru` | B 其他JS | **NOASSERTION** ⚠ | 外语视频学习 | 待核 | ⛔ | pending-license | 2026-10-28 | ★120，push 2026-10-26。日/粤/越语点击查词播放器。**许可证待人工核验 → 不采用、不摘任何代码** |
| `CK-Explorer/DuoSubs` | B 其他JS | Apache-2.0 | 双语字幕合并 | 重复无增益 | ⛔ | rejected | 2026-10-28 | ★15，**Python**（语义对齐 + 合并）→ 非 JS 栈 |
| `NLINEA/SubDuet` | B 其他JS | MIT | 双语字幕 | 重复无增益 | ⛔ | rejected | 2026-10-28 | ★94，**Python**，面向 Plex/Jellyfin 落盘 → 非 JS 栈、非 Web 形态 |
| `jasperchou57/subtitleops` | B 其他JS | **NOASSERTION** ⚠ | 字幕格式转换 | 重复无增益 | ⛔ | rejected | 2026-10-28 | ★0 在线工具站。能力 ⊂ 在册 `vidstack/captions`（media-captions），且许可证不明 |
| `begin0808/LiveCaption_Global`、`begin0808/LiveCaption` | B 其他JS | **`null`** ⛔ | 实时双语字幕 | — | ⛔ | rejected | 2026-10-28 | ★40 / ★102，实时 ASR + 翻译。**无许可证** → 仅线索；且实时识别是另一条路（本仓走存档回放） |

**r90 审计结论：`english` 字段断链（可复现）**

- 断言复核：`grep -rn '\.english\b' packages/ --include=*.js | grep -v node_modules` → **仅 1 条**，
  且是 radar 骨架自己的注释（`dsh-radar-media-captions/src/index.js:30`）。**确认 `english` 无任何读者**。
- 生产端：`packages/dsh-zhiyun-source-classroom/src/models.js:63` `subtitle()` 返回
  `{startMs, endMs, text, english}`，`english` 取自浙云 API 的 **`TransText`**（自带中英对照列）。
- **顺序修正（本轮增量）**：F-1（`workbench.js` 的 `join("")` 无分隔）**必须先修**，再上双语；
  否则双语只是把「无分隔的中文」复制成两份。F-2 断句信号（`endMs→startMs` 停顿 /
  `slide.startMs` 翻页 / section 时间链）**已在手，无需引入上游**。
- ⚠ 边界：`grep` 未覆盖 `apps/` 与 `deploy/`；且**未验证 `TransText` 在所有课程上非空**
  （上游字段存在 ≠ 每节课都有英文）。**若多数为空，应从 `subtitle()` 返回值里删掉该字段，而不是为它建 UI。**

**r90 方法沉淀**

- **「窄词 total=1~5」同样没有信息量**：第 5/6/9 次搜索 total 分别 1/1/1，剩下来的是 ★0 新仓或非 JS。
  建议把放宽门槛从「=0」改为「**< 5 且前排无 JS 库**」；若放宽后**只会回到已扫过的宽词**，
  应**显式放弃并写明理由**（本轮即如此，非疏漏）。
- **「字幕」方向记已见底**（`subtitle aligner` 109 / `bilingual subtitles` 422 前排几乎全为 Python 或独立 App；
  JS 生态无第二个可锁版字幕库）。下轮若跑 C 组，改「考试 / 刷题」或「锻炼」侧。
- **同日第 4 轮（00/03/06/09）第二次撞上 `same-day(exhausted)`**：该分支只报「三组都跑过」，
  不给「哪组最早 / 哪组还有未挖关键词」→ 建议 `radar-rotation.mjs` 加 `--why`。本轮人工取 **C**。
