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
