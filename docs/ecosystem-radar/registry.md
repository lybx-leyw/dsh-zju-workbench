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
| `p16e0nd/zju-recorder` | B 其他JS | **MIT** ✅ | 课堂直播/录制 | **重复可强化** | 🟢 | proposed | 2026-10-16 | ★0，2026-09-30。**LICENSE 实文已核**（`Copyright (c) 2026 ZJU Recorder contributors`）✅。**智云课堂本地版**（Node.js，`app/server.js` 149KB）。**三块可提取能力**：① **OAuth2 授权码链路**（`casapi`→`oauth2.0/authorize`→`tgmedia get-info?code=ST-xxx`→`_token` cookie 内藏 JWT）—— 本仓 `dsh-zhiyun-classroom/src/auth.js` 是 **CAS 直连**，**无此链路**；② `CookieJar` 显式处理 `domain`/host-only/`path`；③ RSA **密码反转 + 分块** 实现（本仓为整块，可交叉验证）。**强化对象**：课堂页直播通路。⚠ **① 形态不兼容**（Windows 本地工具，`127.0.0.1:8787`）→ **只提取能力，不挂载整体**；⚠ **② 凭据流向**（支持明文账密自动登录，须确认不落盘）；⚠ **③ 录制须承接上游 `DISCLAIMER.md` 边界且默认关闭**；⚠ ④ `flv.min.js`/`hls.min.js` 为**第三方构建产物，许可证未核，不得引入**。**本轮 L2 骨架** → `packages/dsh-radar-zju-recorder` |
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
