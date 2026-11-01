# dsh-radar-lecture-note-lint

> **候选骨架：未评审、未接入 profile、不可直接使用。**
> 本包**没有**被写进 `profiles/zhiyun-bench/package.json` 的 `dsh.profile.bundles`；
> `apply()` 故意抛错，挂载即失败。它随 `radar` 分支交付，供人工 review 后决定
> 「采纳 / 废弃 / 改成两行改动」。

## 一句话

给「智云回放 → 讲义」链路的**最后一格**补一道闸：讲义写盘前静态检查 Markdown
能不能正常渲染（表格被裸竖线截断、公式未闭合、`\frac` 缺花括号、单行 `<details>` 塌陷…）。

## 集成定性：**强化式集成**（不是全新）

| 判据 | 本包 |
| --- | --- |
| 仍是同一个面板？ | ✅ 讲义仍在课堂页出，**没有新增入口、不抢 UI** |
| 功能仍相似正交？ | ✅ `core-lecture` 管「内容对不对」（书面语验收），本包管「渲染得出来吗」 |
| 底层多调了更优质实现？ | ✅ 借上游 11 条规则中本仓**完全没有**的那几条 |

**它不是「重复且无增益」**：本仓 `packages/` 下 grep
`table_bare_pipe|frac_no_brace|inline_math_unclosed|details_single_line` **零命中**
（2026-11-01 实测），即这道闸**当前不存在**。

## 上游是什么，为什么**不**整包挂载

上游 [`chenqianyu486-sys/dsh-zju-lecture-note`](https://github.com/chenqianyu486-sys/dsh-zju-lecture-note)
（MIT，`1.3.3`，2026-10-30 建仓）是 **A 类原生 DSH 插件**：`package.json` 有
`dsh.bundle.patch` → `./cordis.patch.yml`，`lib/`（JS 桥）+ `zju_lecture/`（Python 核心，约 2.2k 行）。

它提供 7 个工具：

| 工具 | 本仓是否已有 |
| --- | --- |
| `zju_parse_url` | ✅ `dsh-zhiyun-source-classroom` 已有链接解析 |
| `zju_fetch_transcript`（免登录字幕） | ✅ `dsh-zhiyun-source-classroom` + `core-playback/transcript.js` |
| `zju_fetch_slides`（投影 PPT + OCR） | ✅ 课堂数据源已有 `getLessonContent` |
| `zju_extract_courseware`（本地课件提取） | ✅ `dsh-zhiyun-core-parser` |
| `zju_get_video_url` | ✅ 回放链路已有 |
| `zju_read_browser_cookie`（读 Edge） | ⚠ 与本仓「浙大一卡通会话」路线**冲突**，且读浏览器凭据属敏感面 |
| **`zju_check_note`（讲义渲染校验）** | ❌ **没有** ← 本包只取这一块 |

前三行占上游价值的大头，但**本仓同位置已有等价实现** —— 整包挂载就是
「重复且无增益」，按本任务规则 ⛔。因此**不锁版挂载、不引入其 npm 包、不复制其 Python 源**，
只按 [CONTRIBUTING 3.3] 借鉴规则判据、用 JS 重写。见 `ATTRIBUTION.md`。

## 评审时要回答的三个问题

1. **规则一条不落都要吗？** 上游 11 条里，`\dfrac`、裸 `i`、`\text{}` 装中文这 3 条偏「个人书写习惯」，
   可能与本仓既有导出格式冲突 —— 建议先只上 8 条 `error` 级。
2. **闸放在哪？** 建议 `core-lecture` 的 `polish.js` 输出之后、`register.js` 书面语验收**之前**，
   这样能先拦渲染问题、再谈文风。
3. **失败策略？** 建议 `error` 级**阻断写盘并回灌给 agent 重写**（最多 2 轮），`warn` 级只记录，
   **不要**自动修 —— 自动修会把公式改坏（上游的 `fix_markdown` 是另一件事，需单独评审）。

## 现状

`src/index.js` 只有规则表 `RULES` 与三个占位函数，全部抛错。**没有任何实现代码。**

## 不做什么

- 不写测试（radar 包不写测试）。
- 不接 profile。
- 不整包 vendor 上游。
