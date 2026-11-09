# ATTRIBUTION — @lybx-leyw/dsh-zju-core-classroom-generate

本包是 [OpenMAIC](https://github.com/THU-MAIC/OpenMAIC) **生成管线**的移植，**不是**上游产物的副本：
`src/` 下的 JS 全部按上游 TS 重写，每个文件头写了 `// 源：…:<行范围>`。

| 项 | 值 |
| --- | --- |
| 上游仓库 | https://github.com/THU-MAIC/OpenMAIC |
| 上游版本 | v1.3.0（本地只读快照 `ref/OpenMAIC/`，被 `.gitignore` 忽略） |
| 上游 commit | `03dee2bb4e1bf2e3296ad05ca1f78ce863452921` |
| 许可证 | MIT（`ref/OpenMAIC/LICENSE`，Copyright (c) 2026 THU-MAIC） |
| 本包 `vendor/` | **无**（本包不含任何逐字节副本） |

## 移植范围

| 本仓文件 | 上游来源 |
| --- | --- |
| `src/index.js` | `lib/server/generation/run/service.ts`；`app/api/generation-runs/**/route.ts` |
| `src/pipeline.js` | `lib/server/generation/run/{engine,runner,plan,retry}.ts` |
| `src/events.js` · `src/errors.js` · `src/json.js` | `lib/server/generation/run/{types,sse,failure-code,start}.ts`、`lib/chat/structured-output.ts`、`packages/@openmaic/generation/src/json-repair.ts` |
| `src/brief.js` · `src/llm.js` | `lib/server/generation/run/input.ts`、`lib/server/provider-config.ts`、`app/api/server-providers/route.ts` |
| `src/prompts.js` | `packages/@openmaic/generation/src/{outline-generator,scene-prompts,prompt-formatters}.ts` 与 `prompts/*.md` |
| `src/scene.js` | `packages/@openmaic/generation/src/{scene-builder,scene-generator,outline-generator}.ts`、`packages/@openmaic/dsl/src/action.ts` |
| `src/phases/*.js` | `lib/server/generation/run/{engine,plan,media,document}.ts` 等 |
| `src/html-deck.js` · `html-slide-shell.js` · `html-slide-fit.js` · `html-slide-audit.js` · `llm-pool.js` · `media-port.js` · `actions.js` | **本仓新增**，上游没有对应实现（HTML 优先的横版 slides 产物、逐页落盘、池子适配） |

## 改动

- **提示词重写为中文**，并按「画面只放精华、长解释放画布外讲解区」重新组织；未复制上游模板原文。
  保留的上游设计：画面简洁、详解归口播、单教师连续讲解、公式自然口述。
- 上游的 TTS / 配图媒车道在本仓的 HTML 产物下**不启用**（`outputFormat: 'html'` 直接跳过 media 段）。
- 终稿句级来源遍历、Base 差分账本、补充独立存储与审核修补为**本仓新增机制**，不宣称上游已有。
- `html-*` 系列（横版 1600×900 画布、逐页边界校验、公式拆行、断点续做）为**本仓自研**，
  与上游无对应关系。

## 未使用的上游依赖

上游工作区包 `packages/mathml2omml` 为 **LGPL-3.0-or-later**，本包**未使用**，
公式渲染走 MathML / Unicode；OMML 映射见 `@lybx-leyw/dsh-zju-core-classroom-export` 的自写实现。

## 升级流程

1. 按新 commit 重新拉取 `ref/OpenMAIC/`；
2. 对照上游 `lib/server/generation/` 与 `packages/@openmaic/generation/` 检查各 `// 源：` 注释；
3. 更新本文件与各文件头的行范围；
4. 跑 `node --test tests/classroom*.test.mjs`。
