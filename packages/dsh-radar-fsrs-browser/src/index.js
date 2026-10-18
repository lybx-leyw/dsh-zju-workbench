// 【候选骨架 · 未评审 · 未接入 profile · 不可直接使用】
//
// 目标：把上游 fsrs-browser（FSRS 的浏览器侧 WASM 实现，含 Optimizer + Scheduler）
//       封装成工作台可调用的能力，用来给「学习」页 /「习题」的复习安排
//       提供比「固定顺序刷题」更优质的调度底层，并补上参数优化（Optimizer）能力。
//
// 上游：https://github.com/open-spaced-repetition/fsrs-browser
//       npm: fsrs-browser（本骨架锁版 6.6.0，不用 ^）
//       许可证：BSD-3-Clause ✅（宽松白名单）
//
// 性质：B 类（其他 JS 项目）—— 能力提取 + 封装；不引入 DSH 上游包
//       （上游无 dsh.bundle.patch / cordis.patch.yml，故本包不含上游 DSH 依赖）。
//
// 强化式集成：三条同时成立 ——
//   ① 仍是同一个面板：「学习」页（dsh-zhiyun-page-study）不新增页面、不改交互；
//   ② 功能仍相似正交：仍是在做题与复习，只是「先复习谁 / 参数从哪来」由调度器决定；
//   ③ 底层多调了更优质实现：引入本仓没有的 WASM 加速 Optimizer（既有的 ts-fsrs 无此路径）。
//
// ⚠ 关键前置裁决（采用前必须由人工决定）：
//   本包与既有的 packages/dsh-radar-fsrs-scheduler（锁版 ts-fsrs@5.4.2）同属
//   open-spaced-repetition 组织，**是分层而非竞品**。二者【不应同时采用】，
//   否则违反「功能仍相似正交」判据。三个方案：
//     ① 替换：用 fsrs-browser 取代 ts-fsrs（获得 WASM Optimizer，代价是引入 WASM 构建链）
//     ② 分层：ts-fsrs 管纯算法、fsrs-browser 管优化器（能力最全，代价是两个依赖）
//     ③ 维持现状：认为当前阶段 WASM 优化器属过度设计
//   本骨架按【方案 ①】出具；若裁决为 ②/③，请改写或废弃本骨架。
//
// TODO（采用前必须完成）：
//   1. 核实 fsrs-browser 6.6.0 的 API 表面（module: fsrs_browser.js，
//      types: fsrs_browser.d.ts），只做薄封装，不重新实现算法。
//      wasm 产物的加载方式需确认（打包器 / 静态资源路径），这是本方案主要技术风险。
//   2. 确定调度状态落在哪里：优先复用 dsh-zhiyun-study-core 的领域状态层
//      （学习空间 / 学习控制器），【不要】自建落盘；每道题的 card 状态按
//      「账号 + 课程 + 节次」维度存放，与 dsh-zhiyun-knowledge 的粒度保持一致。
//   3. 与 dsh-zhiyun-quiz 的接缝：quiz 只负责出题与质检，本包只负责
//      「下一次该复习谁」与「参数如何优化」，两者不要互相侵入。
//   4. UI 预期：不新增页面、不改交互 ——「学习」页仍是同一棵树，
//      只是题目排序 / 到期标记 / 参数来源变了。
//   5. 不搬运上游源码；完成后按 CONTRIBUTING 流程补测试、接入 profile、写 OWNERS。

export const name = 'dsh-radar-fsrs-browser';

// TODO: 薄封装上游 fsrs-browser（示例，待实现）
// import { ... } from 'fsrs-browser';
// export function createScheduler(params) { /* 返回 { review(card, rating), nextDue(card) } */ }
// export function createOptimizer(history) { /* 返回 { train(), parameters } */ }
