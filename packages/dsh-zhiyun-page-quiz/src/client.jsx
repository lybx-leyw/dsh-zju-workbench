// 「题库」页：跨课程按知识点出题、练习与历史题目管理。
//
// 领域状态（取数、出题任务、题库持久化）在 dsh-zhiyun-core-study 提供的
// `zhiyunStudyController` 服务里；本包只负责渲染与交互。
//
// 这一页原本寄居在 dsh-zhiyun-page-study 里（`pageBundle('quiz')` 指向它），
// 但题库与「学习」是两件独立的事：学习页按课程/节次走，题库页跨课程按知识点走。
// 拆成独立包之后，题库页可以单独停用、单独审查，也不会再把 900 行样式压在
// 学习页的那张样式表里。
import React from 'react';
import { QuestionBankPage } from './question-bank.jsx';
import { mountStyle } from 'dsh-zhiyun-shell-ui';
import css from './style.css';

export const name = 'zhiyun-page-quiz-client';
export const inject = ['slots'];
export function apply(ctx) {
  mountStyle(ctx, { attribute: 'zhiyunQuizStyle', css, label: 'zhiyun: quiz page styles' });
  // 惰性取领域状态：停用状态包时这一页只是空着（壳显示占位），不会把整个前端拖成 pending。
  ctx.inject(['zhiyunStudyController'], (scope) => {
    scope.slots.inject('zhiyun.quiz.content', () => scope.slots.register(
      { name: 'zhiyun.quiz.content' },
      () => <QuestionBankPage controller={scope.zhiyunStudyController} />,
    ));
  });
}

// 学习页的知识点面板里也嵌着一份点级出题目板（`zs-qz` 那段），由 page-study
// 从这里取，避免两份实现。方向是**单向**的：page-study → page-quiz。
export { QuizPanel } from './quiz-panel.jsx';
export { GenerationModels } from './generation-models.jsx';
