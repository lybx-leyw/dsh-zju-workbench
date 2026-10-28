// 「学习」页：学习工作台（课程树 / 视频 / 知识点 / 检索 / 解析模型选择）。
//
// 领域状态（取数、任务、持久化）在 dsh-zhiyun-core-study 提供的 `zhiyunStudyController`
// 服务里；本包只负责渲染与交互，以及「这一页特有的检索与格式化」。
import React from 'react';
// 题库页已经独立成 `dsh-zhiyun-page-quiz`：本页只保留「知识点上用同一套出题器」的那块面板，
// 以及讲义生成要用的模型选择器。依赖方向单向（study → quiz），不会成环。
import { GenerationModels } from 'dsh-zhiyun-page-quiz';
import { Notice, mountStyle } from 'dsh-zhiyun-shell-ui';
import { StudyWorkspace } from './study-workspace.jsx';
import css from './style.css';
// 视频栏是第二套样式（`zs-video-*`）：它有自己的网格与窄屏断点，不跟正文共用规则。
// 两个属性名不同 → 两张独立 <style>；同包内后写的赢，顺序在文件里就看得见。
import videoCss from './video.css';

export const name = 'zhiyun-page-study-client';
export const inject = ['slots'];
export function apply(ctx) {
  mountStyle(ctx, { attribute: 'zhiyunStudyStyle', css, label: 'zhiyun: study page styles' });
  mountStyle(ctx, { attribute: 'zhiyunStudyVideoStyle', css: videoCss, label: 'zhiyun: study video pane styles' });
  // 惰性取领域状态：停用状态包时这一页只是空着（壳显示占位），不会把整个前端拖成 pending。
  ctx.inject(['zhiyunStudyController'], (scope) => {
    scope.slots.inject('zhiyun.study.content', () => scope.slots.register(
      { name: 'zhiyun.study.content' },
      () => <Study controller={scope.zhiyunStudyController} />,
    ));
  });
}

export const ModelSettings = GenerationModels;
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
