// 「学习」页：学习工作台（课程树 / 视频 / 知识点 / 检索 / 解析模型选择）。
//
// 领域状态（取数、任务、持久化）在 @lybx-leyw/dsh-zju-core-study 提供的 `zwStudyController`
// 服务里；本包只负责渲染与交互，以及「这一页特有的检索与格式化」。
import React from 'react';
// 模型/并发配置组件（`generation-models.jsx`）住在本包 —— 它原先由「题库」页
// 发布、经 `quiz.generationModels` 契约取用，题库页归档后那个契约没有发布方了。
// 点级出题面板仍走契约（`quiz.pointPanel`），拿不到就显示一行说明。
import { Icon, mountStyle, Notice, registerPage } from '@lybx-leyw/dsh-zju-ui-shared';
import { GenerationModels } from './generation-models.jsx';
import { StudyWorkspace } from './study-workspace.jsx';
import css from './style.css';
// 视频栏是第二套样式（`zws-video-*`）：它有自己的网格与窄屏断点，不跟正文共用规则。
// 两个属性名不同 → 两张独立 <style>；同包内后写的赢，顺序在文件里就看得见。
import videoCss from './video.css';
import courseGraphCss from './course-graph.css';

export const name = 'zw-page-study-client';
export const inject = ['slots'];
export function apply(ctx) {
  mountStyle(ctx, { attribute: 'zwStudyStyle', css, label: 'zw: study page styles' });
  mountStyle(ctx, { attribute: 'zwStudyVideoStyle', css: videoCss, label: 'zw: study video pane styles' });
  mountStyle(ctx, { attribute: 'zwStudyCourseGraphStyle', css: courseGraphCss, label: 'zw: course graph styles' });
  // 惰性取领域状态：停用状态包时这一页只是空着（页面壳显示占位），不会把整个前端拖成 pending。
  ctx.inject(['zwStudyController'], (scope) => {
    // 成对注册到 DSH 原生槽：导轨图标（sidebar.panellist）+ 中央面板（main）。
    registerPage(scope, {
      id: 'study',
      order: 30,
      // 导轨图标：ui-shared 的统一描边集，与内建页同源同风格。
      icon: size => <Icon name="book" size={size}/>,
      label: '学习',
      render: () => <Study controller={scope.zwStudyController} />,
    });
  });
}

/**
 * 模型/并发配置的壳。真身由题库页发布；没装题库页时把它换掉，**不要抛**。
 *
 * 为什么还要一个壳而不是直接传组件：`StudyWorkspace` 把它当 prop 渲染，
 * 包一层能在这里集中处理「组件升级 / 缺失」这类判断。
 */
function ModelSettings(props) {
  // 同 `teaching-generate.jsx` 的 ConfigPanel：组件现在住在本包内。
  return <GenerationModels {...props} />;
}
function Study({ controller }) { return <StudyWorkspace controller={controller} Notice={Notice} ModelSettings={ModelSettings} safeLink={safeLink} />; }
export function safeLink(value) {
  if (typeof value !== "string" || !value.trim()) return void 0;
  try {
    const url = new URL(value, globalThis.location?.href);
    return ["https:", "http:"].includes(url.protocol) ? url.href : void 0;
  } catch {
    return void 0;
  }
}
