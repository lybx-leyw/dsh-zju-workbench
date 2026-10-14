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
