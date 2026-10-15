// 【候选骨架 · 未评审 · 未接入 profile · 不可直接使用】
//
// 目标：把上游 ts-fsrs（FSRS 间隔重复调度算法）封装成工作台可调用的能力，
//       用来给「学习」页 /「习题」的复习安排提供比「固定顺序刷题」更优质的调度底层。
// 性质：B 类（其他 JS 项目）—— 能力提取 + 封装；不引入 DSH 上游包。
//       强化式集成：① 仍是同一个「学习/习题」面板 ② 功能仍是做题与复习（正交）
//       ③ 底层多调用了更优质的实现（FSRS 记忆模型调度）。
//
// TODO（采用前必须完成）：
//   1. 确认 ts-fsrs 的版本（当前锁 5.4.2）与 API 表面（createEmptyCard / fsrs.repeat /
//      Rating / State 等），只做薄封装，不重新实现算法。
//   2. 确定调度状态落在哪里：优先复用 dsh-zhiyun-study-core 的领域状态层
//      （学习空间 / 学习控制器），【不要】自建落盘；每道题的 card 状态按「账号 + 课程 + 节次」
//      维度存放，与 dsh-zhiyun-knowledge 的粒度保持一致。
//   3. 与 dsh-zhiyun-quiz 的接缝：quiz 只负责出题与质检，本包只负责「下一次该复习谁」，
//      两者不要互相侵入；由集成层（页面或 study-core）把两者串起来。
//   4. UI 预期：不新增页面、不改交互 ——「学习」页仍是同一棵树，只是题目排序/到期标记变了。
//   5. 不搬运上游源码；完成后按 CONTRIBUTING 流程补测试、接入 profile、写 OWNERS。

export const name = 'dsh-radar-fsrs-scheduler';

// TODO: 薄封装上游 ts-fsrs（示例，待实现）
// import { fsrs, createEmptyCard, Rating, generatorParameters } from 'ts-fsrs';
// export function createScheduler(params) { /* 返回 { review(card, rating), nextDue(card) } */ }
