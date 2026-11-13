// 「题库」页：跨课程按知识点出题、练习与历史题目管理。
//
// 领域状态（取数、出题任务、题库持久化）在 @lybx-leyw/dsh-zju-core-study 提供的
// `zwStudyController` 服务里；本包只负责渲染与交互。
//
// 这一页原本寄居在 dsh-zju-page-study 里（`pageBundle('quiz')` 指向它），
// 但题库与「学习」是两件独立的事：学习页按课程/节次走，题库页跨课程按知识点走。
// 拆成独立包之后，题库页可以单独停用、单独审查，也不会再把 900 行样式压在
// 学习页的那张样式表里。
import React from 'react';
import { QuestionBankPage } from './question-bank.jsx';
import { QuizPanel } from './quiz-panel.jsx';
import { GenerationModels } from './generation-models.jsx';
import { Icon, mountStyle, publishComponent, registerPageContent } from '@lybx-leyw/dsh-zju-ui-shared';
import css from './style.css';

export const name = 'zw-page-quiz-client';
export const inject = ['slots'];
export function apply(ctx) {
  mountStyle(ctx, { attribute: 'zwQuizStyle', css, label: 'zw: quiz page styles' });
  // 把跨页复用的两块**发布**出去，而不是等需要它的页来 import 本包。
  // 每次 apply 一条 effect：本包被停用时自动撤下，使用方当场回到降级形态。
  ctx.effect(() => publishComponent('quiz.pointPanel', QuizPanel), 'zw: publish quiz.pointPanel');
  ctx.effect(() => publishComponent('quiz.generationModels', GenerationModels), 'zw: publish quiz.generationModels');
  // 惰性取领域状态：停用状态包时这一页只是空着，不会把整个前端拖成 pending。
  ctx.inject(['zwStudyController'], (scope) => {
    registerPageContent(scope, {
      id: 'quiz',
    // 导轨图标：ui-shared 的统一描边集，与内建页同源同风格。
    icon: () => <Icon name="bulb"/>,
    // 应用型页面：自己管布局与滚动，不套 720px 文章版心。
    fullBleed: true,
      label: '题库',
      render: () => <QuestionBankPage controller={scope.zwStudyController} />,
    });
  });
}

// 学习页的知识点面板里也嵌着一块点级出题目板（`zws-qz` 那段）。
//
// ⚠️ **不再依靠「对方 import 本包」提供**。那会让两页硬耦合：用户取消题库页
// 之后学习页还 require 这个模块，运行时解析不到，整页空白。现在改成向
// `ui-shared` 的组件契约表**发布**，对方按名字取：
//   - 学习页：`usePublishedComponent('quiz.pointPanel')`；
//   - 讲义生成：`usePublishedComponent('quiz.generationModels')`。
// 取不到时它们各自降级，本包没装配就不影响学习页。
// 守旧导出：外部（测试、旧调用方）仍可按包名 import。页面内部**不再它用**
// —— 学习页走的是上面那两条 publish 的契约名。
export { QuizPanel, GenerationModels };
