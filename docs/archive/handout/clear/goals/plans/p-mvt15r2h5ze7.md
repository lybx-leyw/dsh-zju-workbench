# 阶段归档 · p-mvt15r2h5ze7

- 收束时间:2026-10-29T05:53:15.417Z
- 所属目标:g-mvt12jsjhc9t
- 收束之辞:旧计划收束。已交付的前四步留下实物：dsh-zhiyun-core-handout 包（codec.js / version.js / store.js / index.js）与 5 个测试文件、共 49 条测试；page-notes 的归档拆分代码也已写入（第 5 步实物在、测试 20/20 通过，仅交付记录未能落地，故作废留痕）。后续 5 步按用户指示随本计划一并作废，改由新计划重立。

## 步骤
- [advanced] 1. 新建 packages/dsh-zhiyun-core-handout（package.json / OWNERS / README / cordis.patch.yml / src），实现 src/codec.js：baselineToMarkdown(chapters, title) 与 markdownToChapters(markdown) 双向编解码，块类型限于五种，例题用 `##### 解答` 分隔题干与解答；未知类型行按「讲解」处理并记 warnings，不抛错。 → packages/dsh-zhiyun-core-handout/src/codec.js, packages/dsh-zhiyun-core-handout/package.json
- [advanced] 2. 实现 src/version.js：纯函数描述版本对与归档布局——归档根名/版本目录命名/state.json 形状/下一个版本号/swap 计划（把哪些文件搬到哪、record.lecture 换成哪份基线）、以及「归档路径」与「当前 md 路径」的推导。零 IO，全部输入输出为数据结构。 → packages/dsh-zhiyun-core-handout/src/version.js
- [advanced] 3. 写 tests/handout-codec.test.mjs 与 tests/handout-version.test.mjs。编解码覆盖五种块、例题两段、空章节、未知类型降级、含 `####` 字样的正文；版本覆盖换版搬运清单、swap 与 regenerate 互逆、归档路径判定、版本号不回退。 → tests/handout-codec.test.mjs, tests/handout-version.test.mjs
- [advanced] 4. 实现 src/store.js 与 src/index.js 的宿主半边：通过注入的笔记服务（zhiyunVaultNotes 的形状）读写文件，提供 zhiyunHandout 服务——exportLecture（生成后写 md 并登记版本）、regenerate（归档当前对 + 写新版）、swapTo（回退）、hideUserChanges（返回基线渲染）、listVersions。文件操作全部经注入服务，包内不 import node:fs。 → packages/dsh-zhiyun-core-handout/src/store.js, packages/dsh-zhiyun-core-handout/src/index.js
- [void] 5. 改 packages/dsh-zhiyun-page-notes/src/index.js：把 walk() 拆成「列树用」与「索引输入用」两条路径——文件树含归档目录，readAll() 排除归档目录。归档目录名由 dsh-zhiyun-core-handout 导出，page-notes 不硬编码。 → packages/dsh-zhiyun-page-notes/src/index.js (作废:交付记录通路故障：第 5 步实物与测试已就位（20/20 通过）但连续 6 次 AdvancePlan 返回 outcome unknown，进度无法前进。按用户指示收束本计划，改按用户给定的 10 条重新立一份，前四步的既有产物在新计划中以证据重新交付。)
- [void] 6. 改讲义的两处读取路径：packages/dsh-zhiyun-core-knowledge/src/service.js 的 handoutFragments 与 packages/dsh-zhiyun-page-study/src/layered-search.js 的讲义层，改为优先读用户版 md（经注入的通道），取不到时退回 record.lecture；model.js:228 的 layer:"final" 不动。 → packages/dsh-zhiyun-core-knowledge/src/service.js, packages/dsh-zhiyun-page-study/src/layered-search.js (作废:同上：随旧计划整体收束作废，改由新计划重立。)
- [void] 7. 在 packages/dsh-zhiyun-core-study/src/workbench.js 的生成完成处（两次 save 之后）调用 zhiyunHandout 的导出方法，把新版讲义写进笔记库并按节登记版本；基线仍完整写进 record.lecture。用 ctx.get 惰性取，缺席时只警告不阻断生成。 → packages/dsh-zhiyun-core-study/src/workbench.js (作废:同上：随旧计划整体收束作废，改由新计划重立。)
- [void] 8. 写 src/client.jsx 与 src/style.css：在学习页注册一个版本面板插槽，列出版本、支持回退（swap）、支持「隐藏我的更改」（渲染基线）。样式只用壳的 --zy-* 变量，类名前缀不与既有 zs- 冲突。 → packages/dsh-zhiyun-core-handout/src/client.jsx, packages/dsh-zhiyun-core-handout/src/style.css (作废:同上：随旧计划整体收束作废，改由新计划重立。)
- [void] 9. 完成全部登记：profiles/zhiyun-bench/package.json 的 bundles、scripts/build.mjs 的 CLIENT_PACKAGES、本包 cordis.patch.yml 自我 insert、tests/profile.test.mjs 期望清单。 → profiles/zhiyun-bench/package.json, scripts/build.mjs, packages/dsh-zhiyun-core-handout/cordis.patch.yml, tests/profile.test.mjs (作废:同上：随旧计划整体收束作废，改由新计划重立。)
- [void] 10. 跑与本改动相关的既有测试与构建，收集失败项并逐个判定是「本改动引入」还是「既有失败」。 → reports/handout-regression.md (作废:同上：随旧计划整体收束作废，改由新计划重立。)
