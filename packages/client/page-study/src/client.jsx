// 「学习」页：学习工作台（课程树 / 视频 / 知识点 / 检索 / 解析模型选择）。
//
// 领域状态（取数、任务、持久化）在 @lybx-leyw/dsh-zju-core-study 提供的 `zwStudyController`
// 服务里；本包只负责渲染与交互，以及「这一页特有的检索与格式化」。
import React from 'react';
// ⚠️ **本页不 import 题库页**。两页之间只通过 `ui-shared` 的组件契约名认识：
//   题库页 apply 时 publish 出 `quiz.generationModels` / `quiz.pointPanel`，
//   本页按名字取。拿不到（用户把题库页关掉了）就是一块说明，不是白屏。
import { Icon, mountStyle, Notice, registerPageContent, usePublishedComponent } from '@lybx-leyw/dsh-zju-ui-shared';
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
    registerPageContent(scope, {
      id: 'study',
    // 导轨图标：ui-shared 的统一描边集，与内建页同源同风格。
    icon: () => <Icon name="book"/>,
    // 应用型页面：自己管布局与滚动，不套 720px 文章版心。
    fullBleed: true,
      label: '学习',
      // 版式与迁移前一致：`FULL_BLEED_PAGES` 只有 notes / docs，学习页仍走文章版心。
      render: () => <Study controller={scope.zwStudyController} />,
    });
  });
}

/**
 * 模型/并发配置的壳。真身由题库页发布；没装题库页时把它换掉，**不要抛**。
 *
 * 为什么需要一个壳而不是直接传组件：`usePublishedComponent` 是 hook，
 * 只能在组件里调用；`StudyWorkspace` 只是把它当 prop 渲染。
 */
function ModelSettings(props) {
  const Panel = usePublishedComponent('quiz.generationModels');
  if (!Panel) {
    return <p className="zws-muted" role="status">模型与并发配置由「题库」页提供；该页未启用时用设置里的默认模型。</p>;
  }
  return <Panel {...props} />;
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
