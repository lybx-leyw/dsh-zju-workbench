# dsh-radar-paper-sentalign

> ⚠️ **候选骨架：未评审、未接入 profile、不可直接使用。**
> 由「DSH 生态雷达」自动生成（2026-11-09 12:00 · r158 · C 组）。采用前请**重写**并走正常包流程。

**集成方式：强化式集成**（不是全新功能）。落点是既有的论文页，不是新开页面。

## 上游

| 项 | 值 |
| --- | --- |
| 仓库 | https://github.com/Chuanyunux/pararead |
| npm | **无** —— `registry.npmjs.org/pararead` 与 `@chuanyunux/pararead` 均 `Not found` |
| 许可证 | **Apache-2.0** ✅（`LICENSE` + `NOTICE` + `CLA.md`） |
| 语言 / 运行依赖 | TypeScript / **`dependencies: null`（零运行时依赖）** |
| 版本 / ★ / 活跃 | `0.6.1` ｜ ★3 ｜ `pushed 2026-09-30`（**41 天无更新**） |
| 形态 | VS Code 扩展（`engines.vscode ^1.95.0`，`activationEvents: onStartupFinished`） |

## 集成判定

- **类型**：**B · 其他 JS 项目**（VS Code 扩展，**不是** DSH 原生插件包 —— 无 `dsh.bundle.patch`、无 `cordis.patch.yml`）⇒ 本包**不含上游 DSH 依赖**。
- **与现有功能的关系**：**重复可强化**。论文页已有翻译，但只有两个粒度。
- **强化而非重复 —— 三条同时成立**：

| 判据 | 结论 | 依据 |
| --- | --- | --- |
| ① 仍是同一个面板 | ✅ | 上游是 VS Code 扩展，**本身没有面板**，只有 `src/translation/`（9 文件 ≈ 49 KB，**不 import `vscode`**）。这里迁移的是**引擎语义**，落点是本仓既有 `packages/client/page-paper`。不存在「上游面板与本仓面板二选一」的问题 —— 这比 A 类锁版候选更干净 |
| ② 功能相似且正交 | ✅ | 现有两个出口：**选中即译**（`ReaderFrame.jsx` `readSelection()` → 浮层）与**整篇翻译**（`SettingsSection.jsx:59`，babeldoc 路线，另存 `-zh`/`-dual`）。上游补的是**第三个粒度：页内句级、与原文同高对齐**。同一批消费者，三种粒度，互不取代 |
| ③ 底层多调了更优质实现 | ✅ | 本仓**无句级切分**：全仓 `grep -E "sentenceSplit\|splitSentences\|句级.*切分"` = **0 命中**。`selection-text.js` 只有 `normalizeSelectionText()`（清 PDF 断词/软连字符）与 `isTranslatableSelection()`，**输入恒为用户手动选区**，粒度是整段、且不看目标语言 |

## 为什么不锁版（`dependencies: {}` 是刻意的）

| 前置条件 | 本包是否满足 |
| --- | --- |
| 无 tag / 未发 npm | ✅ `registry.npmjs.org/pararead` → `Not found` |
| 上游零运行时依赖 | ✅ `dependencies: null` |
| 引擎层可剥离 | ✅ `src/translation/*.ts` 不 import `vscode`；`pdf-viewer-provider.ts` / `webview-collection.ts` / `webview/` 才绑 VS Code Webview API |
| 可迁移决策 ≥3 条且有名字 | ✅ 四条，见下 |

⇒ 按仓库 r155 §③ 定下、r158 再次确认的「**B 类契约提取**」口径：**空 `apply()` + 导出白名单 + 明写不可锁版 + 说明可迁移的是哪几条决策**。

## 可迁移的四条决策

| # | 决策 | 骨架实现 | 上游出处 | 为什么本仓需要 |
| --- | --- | --- | --- | --- |
| **C-1** | **按 id 契约返回，不接受自由文本** | `sentenceId()` + `mergeById()` | `src/translation/parse.ts` `parseTranslations(content, expectedIds)` | **句级对齐的前提**。若让模型自由生成，译文无法钉回某一句。本仓 `translateSelection` 是整段进出，**没有 id 概念** |
| **C-2** | **字符预算分批 + 缺漏单句重试** | `planBatches()`；`mergeById().missing` 即重试清单 | `src/translation/translator.ts`（`maxCharsPerRequest` / `maxSentencesPerRequest` / `concurrency`） | 「一页 60 句」时的成本与延迟由它决定。**一批 40 句错 1 句，重发 1 句而非 40 句** |
| **C-3** | **逐句语言检测，已是目标语言就跳过** | `detectScript()` + `isAlreadyInLanguage()` | `src/languages.ts` `detectLanguage()` | 中文段落、中文注释、中文参考文献标题**全部不送模型**。本仓只在整段层面判「像不像英文」 |
| **C-4** | **术语表 / 提示词版本进缓存键** | `cacheKey()` + `glossaryHash()` | `translator.ts` `#glossaryHash` + `prompt.ts` `PROMPT_VERSION` | 改术语表**必须**失效旧译文，否则用户改完发现没变。本仓论文页翻译缓存是内存缓存，**无版本维度** |

> 上游还有一条本骨架**未实现**的：**只缓存成功的译文**（失败也入缓存会让一次网络抖动永久留疤）。这条不需要函数，属于调用侧纪律，写在本 README 里提醒评审。

## 本骨架**没有**做的事

- **没有搬运上游源码**。四个函数都是照「上游解决了什么问题」重写的，行数与结构均不同。上游路径仅作评审对照。
- **没有写 UI**。句级对照的「悬停描边 + 箭头 + 译文同高」在 `src/webview/` 内，与 VS Code 的 split-panel 布局耦合，本仓不能搬。本仓论文页是**同源 iframe**（`ReaderFrame.jsx`），文本层在 iframe 内 ⇒ 对齐要靠 iframe 内 `getBoundingClientRect()` 回传父页，是**新代码**。
- **没有接 profile、没有测试**（按仓库硬边界）。

## 评审待决（三条，按重要性排序）

1. **iframe 坐标回传是否接受？** 句级对齐要求「译文与原文同高」。本仓文本层在 iframe 内，必须靠 `getBoundingClientRect()` + `postMessage` 回传。**不接受则本骨架整体作废。**
2. **繁简是否要区分？** 现在 `isAlreadyInLanguage('zh-CN')` 把任何汉字句都跳过。若要做繁简区分，`detectScript()` 必须升级成上游的三层判断（书写系统 + 简繁高频字表 + 拉丁语系函数词）。
3. **与 `dsh-radar-pdf-dual` 的边界**：那条是 **babeldoc 整篇另存 `-zh` / `-dual`**（文件级、离线、产物落盘）；本条是**页内句级对齐**（渲染级、实时）。**两条通道消费者相同但产物不同，勿合并目录**；若评审认为二者应收敛成一条，收敛方向应是「整篇翻译复用句级引擎」，而不是「句级降级成整篇」。

## 相关候选

同域另有 `pph-hpp/yidu`（MIT，Electron，`private: true`）已登记 `proposed`，**本轮未出骨架**。分工：**引擎层取 pararead / 产品层取 yidu** —— yidu 有两条值得抄的产品决策：① 免费引擎兜底（无 Key 默认微软翻译，大模型失败自动回退）；② 全文总结反哺翻译（阅读报告作领域提示词背景）。
