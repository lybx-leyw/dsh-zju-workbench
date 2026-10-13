# human-factors-screen-design

一套面向**屏幕内容与界面设计**的人体工效学知识库，从 8 份权威工程标准中提炼而成。约 7.5 万词，每个数字都能追溯到某份标准的某一节。

这是一个标准形态的 Agent Skill：入口是 [`SKILL.md`](SKILL.md)（带 `name` / `description` front matter）。它**不会自动加载**——由你自己决定装到哪个宿主：把本目录整个复制到宿主的 skills 根目录即可（`.agents/skills/`、`.claude/skills/` 等）。本目录**自包含**，复制走不需要带上仓库里的其它文件。

## 先读哪个

| 你想… | 读 |
| --- | --- |
| **边写界面边查** | [`SKILL.md`](SKILL.md) — 9 条核心规则，覆盖大多数决策 |
| **快速拿数字** | [`cheatsheet.md`](cheatsheet.md) — 全部阈值与决策规则，一页 |
| **照抄落地做法** | [`patterns.md`](patterns.md) — 可实施的技术，含取舍 |
| **搞清术语** | [`glossary.md`](glossary.md) — 按标准自身的定义 |
| **知道该信哪一份标准** | [`CROSS-SOURCE-REGISTER.md`](CROSS-SOURCE-REGISTER.md) — 8 份标准互相矛盾时怎么办 |
| **知道数据从哪来** | [`SOURCES.md`](SOURCES.md) — 出处、许可、SHA-256 |
| **自己再跑一遍** | [`tools/`](tools/README.md) — 脚本与流水线 |
| **把方法用在别的材料上** | [`METHODOLOGY.md`](METHODOLOGY.md) — 流程、提示词、7 条教训 |

## 覆盖什么

| 章 | 主题 |
| --- | --- |
| [ch01](chapters/ch01-text-size-legibility.md) | 字号与可读性：视角弧分、换算、笔画宽度、大小写、字体选择 |
| [ch02](chapters/ch02-spacing-line-length-density.md) | 间距、行长、显示密度 |
| [ch03](chapters/ch03-contrast-luminance-colour.md) | 对比度、亮度、配色与色觉缺陷 |
| [ch04](chapters/ch04-reading-in-motion-and-dynamic-display.md) | 阅读中的移动、更新率、闪烁、冻结 |
| [ch05](chapters/ch05-response-time-and-feedback.md) | 响应时延与反馈 |
| [ch06](chapters/ch06-targets-layout-workstation.md) | 目标尺寸、布局、视距与视角 |
| [ch07](chapters/ch07-user-adjustable-parameters-and-defaults.md) | **可调参数与默认值设计** |
| [ch08](chapters/ch08-alerts-warnings-messages.md) | 告警、警告与消息 |
| [ch09](chapters/ch09-navigation-menus-forms.md) | 导航、菜单、表单与数据录入 |
| [ch10](chapters/ch10-accessibility-consistency.md) | 无障碍、一致性、可配置性的边界 |

## 来源

全部为**美国联邦政府作品**（依 17 U.S.C. §105 属公有领域）或**开放许可**标准。**没有使用任何受版权保护的商业教科书**，也没有从影子图书馆获取任何内容。

| 来源 | 年份 | 作用 |
| --- | --- | --- |
| FAA HF-STD-001B 人体工效学设计标准 | 2016 | 最完整，可调参数与默认值材料最丰富 |
| NASA HIDH 人因整合设计手册（第 10 章） | 2014 | 规则背后的**理由**，以及航天级触控与延迟数据 |
| MIL-STD-1472G 人因工程设计准则 | 2012 | 规范性的 `shall` 条款 |
| NUREG-0700 Rev.4 人机接口设计评审指南 | 2020 | **最接近现代屏幕 UI**，当前有效版本 |
| NUREG-0700 Rev.1 Vol.1 | 2002 | 已被取代，保留因它留有 Rev.4 删掉的数值 |
| FAA-HF-STD-010A ATC 显示配色 | 2020 | 可直接落地的数值最多，含 ANSI/HFES 与 ISO 9241 汇总 |
| FHWA-HRT-16-060 交通管理中心人因指南 | 2018 | 面向密集监控工作台 |
| WCAG 2.2 | 2023 | 唯一直接规范屏幕/网页内容的来源 |

原文约 160 MB，**不随仓库分发**——`SOURCES.md` 记录出处与校验和，`tools/fetch_sources.py` 可重新获取。

## 诚实的局限

- **物理移动中阅读**覆盖很薄：这些标准假定读者坐在固定工作台前。真正的「速度 vs 阅读时间」文献（Dudek 2006、Lerner et al. 2009）被它们**引用但未摘录**，本项目没有获取。
- **部分数值只存在于图里**，纯文本提取拿不到（如 NASA HIDH Figure 10.3-16 的字号弧分图），已作为缺口记录，**没有臆测填补**。
- **多数标准早于现代交互范式**：多点触控、手势、响应式布局、深色模式、OLED、可变刷新率。WCAG 2.2 是唯一当代来源；凡是假定 CRT、固定视距的规则，都标注了该前提。
- **这是设计指导，不是合规证书。** FAA 标准在自己前言里就说，应用这些条款需要专业人因判断。把数字用在错误的语境是真实的失败模式——`CROSS-SOURCE-REGISTER.md` 的存在就是为了让它更难发生。

## 许可与归属

- 本目录内容为本仓库原创整理；引用的标准按各自许可（公有领域或开放许可）。
- 唯一第三方工具依赖是 [`book-to-skill`](https://github.com/virgiliojr94/book-to-skill)（MIT），**未随仓库分发**，由 `tools/run_extract.py` 调用外部检出。
