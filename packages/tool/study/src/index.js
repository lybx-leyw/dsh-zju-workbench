/**
 * `@lybx-leyw/dsh-zju-tool-study` —— 学习资料工具包。
 *
 * 把已整理好的讲义、支线黑板、原始证据挂进 agent 的工具表，
 * 让模型能按需浏览 / 读取 / 检索当前账号的课程资料。
 *
 * # 为什么是一个独立的包
 *
 * 工具定义（`tools.js` + `study-materials.js`）是**纯数据与纯函数**：
 * 只依赖 `GENERATION_VERSION` 这个常量，不碰 Cordis、不碰网络、不碰 `core/study`
 * 的任何内部模块。原先它住在 `core/study/src/` 里，导致两件不理想的事：
 *
 *   - `core/study` 必须知道「工具怎么注册」（`ctx.inject(['tools'])`、
 *     遍历、`effect`）—— 那是基础设施的职责，不是学习服务的；
 *   - 想单独测工具的行为，得先把整个 study 宿主拖起来。
 *
 * # 取 workbench 的方式变了
 *
 * 原先 `core/study` 把它的 `workbench` 实例当参数直接传进注册函数。
 * 现在本包通过 `inject: ['zhiyunStudy']` 从宿主取 —— `core/study` 早就
 * `ctx.provide("zhiyunStudy", workbench)`，两个包之间因此只剩**服务契约**，
 * 没有模块级 import。
 *
 * # 可选能力
 *
 * 两条注入都是惰性的：宿主没有 `tools` 服务时这一包不起作用，
 * 学习页照常可用 —— 工具表是附加能力，不该成为学习功能的前置。
 */
import { createStudyMaterialTools } from './tools.js';

export const name = 'zhiyun-tool-study';

/**
 * `zhiyunStudy` 由 `core/study` 提供；`tools` 由宿主提供。
 * 取不到时整包不激活，不影响学习面板。
 */
export const inject = ['zhiyunStudy', 'tools'];

export function apply(ctx) {
  const workbench = ctx.zhiyunStudy;
  for (const tool of createStudyMaterialTools(workbench)) {
    // 每个工具一条 effect：fiber 卸载时逐条注销，不留半套。
    ctx.effect(() => ctx.tools.register(tool));
  }
}

export { createStudyMaterialTools } from './tools.js';
export { materialEntries, catalogEntry, searchEntries } from './study-materials.js';
