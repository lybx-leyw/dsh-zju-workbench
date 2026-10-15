# 生态雷达 · 候选登记表

> **追加式**去重真值。状态取值：`proposed` / `adopted` / `rejected`。
> 每次扫描只追加**新出现**的仓库；已登记的不再重复。

| 仓库 | 类型 | 许可证 | 学生场景 | 与现有功能 | 分级 | 状态 | 首次发现 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
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
