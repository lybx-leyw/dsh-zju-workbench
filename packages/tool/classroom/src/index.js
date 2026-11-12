/**
 * `@lybx-leyw/dsh-zju-tool-classroom` —— 智云课堂工具包。
 *
 * 把已整理好的讲义、支线黑板、原始证据挂进 agent 的工具表，
 * 让模型能按需浏览 / 读取 / 检索当前账号的课程资料。
 *
 * # 为什么叫 classroom 而不是 study
 *
 * 本仓的 `tool/*` 与 `source/*` 按**同一个域**配对，包名带前缀区分层：
 * `source-classroom` 是智云课堂的**平台接口**，`tool-classroom` 是它的
 * **工具面**。两者是同域的上下层，不是同一个包 —— 前缀已经把这件事说清了。
 * 原先叫 `tool-study` 的代价是：它读的是课堂讲义，却与 `core/study`
 * （学习空间聚合页）同名，而那个才是 "study" 在别处指的东西。
 *
 * # 为什么是一个独立的包
 *
 * 工具定义（`tools.js` + `classroom-materials.js`）是**纯数据与纯函数**：
 * 只依赖 `GENERATION_VERSION` 这个常量，不碰 Cordis、不碰网络、不碰 `core/study`
 * 的任何内部模块。原先它住在 `core/study/src/` 里，导致两件不理想的事：
 *
 *   - `core/study` 必须知道「工具怎么注册」（`ctx.inject(['tools'])`、
 *     遍历、`effect`）—— 那是基础设施的职责，不是学习服务的；
 *   - 想单独测工具的行为，得先把整个 study 宿主拖起来。
 *
 * # 取 workbench 的方式
 *
 * 本包通过 `inject: ['zhiyunStudy']` 从宿主取 —— `core/study` 早就
 * `ctx.provide("zhiyunStudy", workbench)`，两个包之间因此只剩**服务契约**，
 * 没有模块级 import。
 *
 * # 可选能力
 *
 * 两条注入都是惰性的：宿主没有 `tools` 服务时这一包不起作用，
 * 学习页照常可用 —— 工具表是附加能力，不该成为学习功能的前置。
 *
 * # 本包不带自己的挂载行
 *
 * `package.json` **没有** `dsh.bundle.patch`，仓库里**没有** `cordis.patch.yml`。
 * 这不是遗漏：工具包只负责“怎么注册”，不负责“什么时候装”—— 后者是 preset
 * 的决定。两边各写一份挂载行的后果是同一个工具在表里出现两次（一次来自
 * profile 的 bundle，一次来自 preset 的 `plugins` 树）。
 *
 * 目前唯一的注入点是 `@lybx-leyw/dsh-zju-preset-lecture` 的
 * `cordis.patch.yml`（`- id: tool-classroom`）。要把它给别的 preset，
 * 在那个 preset 的 plugins 树里加一行即可，不要把它加进 profile 的 bundles。
 */
import { createStudyMaterialTools } from './tools.js';
import { createReadToolRegistrar } from '@lybx-leyw/dsh-zju-tool-kit';
import { createClassroomReadTools } from './reads.js';

export const name = 'zhiyun-tool-classroom';

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

  /**
   * 平台原始数据的读工具（课程 / 节次 / 课件 / 字幕 / 直播状态）。
   *
   * ⚠️ **不把 `zhiyunClassroom` 写进 `inject`**：那样课堂数据源没装时，
   * 连 `study_*` 三个讲义工具都会一起不激活。它只提供平台取证，是附加能力，
   * 缺席时那一个工具如实报 `SERVICE_MISSING`，`study_*` 照常可用。
   */
  createReadToolRegistrar({
    ctx,
    build: createClassroomReadTools,
    serviceSources: { zhiyunClassroom: '@lybx-leyw/dsh-zju-source-classroom' },
  }).register(createClassroomReadTools);
}

export { createClassroomReadTools } from './reads.js';

export { createStudyMaterialTools } from './tools.js';
export { materialEntries, catalogEntry, searchEntries } from './classroom-materials.js';
