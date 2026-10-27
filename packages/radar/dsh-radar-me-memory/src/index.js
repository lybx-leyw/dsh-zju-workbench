/**
 * dsh-radar-me-memory —— 候选骨架，**未评审、未接入 profile、不可直接使用**。
 *
 * 本文件是**占位**，只标注适配点与 TODO，不写业务逻辑。
 * 评审通过后再逐条落实；评审驳回则整个包删除。
 *
 * ── 这个包想做什么 ───────────────────────────────────────────────
 *
 * 把 `dsh-auto-memory@0.9.0`（MIT，★137）的**跨会话记忆能力**接到「我的」页
 * （`packages/dsh-zhiyun-page-me`）里，做成一块**只读台账**：
 * 「它记得我什么、什么时候记的、从哪句话来的、怎么删」。
 *
 * ── 为什么是「强化式集成」（三条同时成立）────────────────────────
 *
 *   1. **仍是同一个面板** —— 落在「我的」页既有内容区，不新增导航项。
 *      ⚠️ 这一条**目前做不到**，见下方 TODO-0/TODO-1 与 README「阻塞项」。
 *   2. **功能仍相似正交** —— 「我的」页答「**怎么用**」（外观 / AI 服务 / 网络偏好）；
 *      本包答「**它记得我什么**」。同属「我的」域，不重叠。
 *   3. **底层多调了更优质实现** —— 本仓**零持久记忆**（全仓无 memory 子系统），
 *      上游给了类型化记忆 + 提示段注入 + 查重更新语义，是新增的更优底层，
 *      而不是把已有功能再包一层。
 *
 * ── 起点是断环，不是搜索 ──────────────────────────────────────────
 *
 * 第四十二轮先读到一个真实缺口：`dsh-zhiyun-knowledge/src/service.js:257` 的
 * `search()` 是 `String.includes`（大小写敏感、不切词、不算相关度）。
 * 但那个缺口**不需要新库**就能修（见报告 §6 R-1，复用同仓 `quality.js` 的
 * `normalizeForMatch`），所以本轮没有拿它当候选，转而去找
 * 「本仓完全没有、且外部有更优底层」的那一格 —— 也就是持久记忆。
 *
 * ── TODO（评审通过后再动）────────────────────────────────────────
 *
 *   [ ] TODO-0（**阻塞，评审前置**）：`dsh-zhiyun-shell/src/client.jsx:143` 把每页
 *       内容槽声明为 `zhiyun.<page>.content: { kind: 'single' }`，
 *       另只有 `zhiyun.me.network` 一个是单点扩展。**single 槽没有第二个注册者位置**，
 *       所以本包现在无处注册 UI。两条出路，须评审选一：
 *         (a) shell 新增 `zhiyun.me.memory` 槽（`kind: 'list'`，与 `me.network` 同法）
 *             —— 改动在 shell，不在本包；这是**本包唯一能「落在同一个面板」的路**；
 *         (b) 放弃 UI，仅「记忆能力可用、不可见」—— 那就不满足判据①，本包应被驳回。
 *   [ ] TODO-1：**上游 client 必须不挂**。已核 `lib/client.js:1589–1595`：
 *       它注册 `main`（顶层页）与 `sidebar.panellist`（侧栏项）。而 `dsh.client`
 *       是**整包级**的，Loader 没有「只挂宿主侧」的开关 → 需要确认宿主是否支持
 *       按 `dsh` 字段裁剪，否则**这个候选在 A 类形态下无法满足判据①**，
 *       应降级为「需移植改造」（只取宿主侧工具，另起 B 类包）。
 *   [ ] TODO-2：**按账号切分**。上游用 `$DSH_HOME/memory/` 一份全机库；
 *       本仓一切数据都带 `accountId`。接之前必须先证明「换账号看不到别人的记忆」，
 *       做法建议：让本包把 `accountId` 写进每条记忆的 tag，读取时强过滤（不改上游源码）。
 *   [ ] TODO-3：**提示预算重测**。上游 `promptMaxChars` 默认 2000 字符，是按英文估的；
 *       中文同字符数携带的信息量不同，须用本仓真实讲义（线性代数 / 大学写作两门）
 *       实测「2000 字符里能放几条、命中率掉多少」，再定值。**不许直接沿用上游默认值**。
 *   [ ] TODO-4：**边界**。记忆（关于我的事实）与知识库（这节课的原文）不得互相回填；
 *       本包**只读**记忆，不写知识库，也不让模型把「我记得」说成「库里有」。
 *   [ ] TODO-5：**删除可追溯**。上游 `memory_delete` 删掉即没了；本轴的另一半是「归属」，
 *       所以本包须在本地记一条「何时、删了哪条、谁让删的」—— 这是上游**没有**的，
 *       是本包唯一真正的增量（其余都是接线）。
 *   [ ] TODO-6：补 `tests/radar-me-memory.test.mjs`，至少钉住：
 *       声明版本 === 安装版本；上游 client 未被注册（`slots` 上不存在 `PANEL_ID`）；
 *       TODO-2 的账号隔离（两个 accountId 互不可见）。
 *   [ ] TODO-7：打包体积 —— 上游 unpacked 164,828 B、零 `dependencies`；
 *       若 TODO-1 裁决为「挂 client」，须先测它对首屏的影响（本仓首屏敏感）。
 *
 * @module dsh-radar-me-memory
 */

import {
  UPSTREAM_PACKAGE, UPSTREAM_VERSION, MUST_NOT_MOUNT,
} from './upstream.js';

export const name = 'radar-me-memory';

/**
 * 本包**不 inject 任何宿主服务**：它是一个外围兼容层，评审后应可整体摘除而不牵连别的包。
 * 需要读账号时由调用方（页面）传入，而不是在插件里 `ctx.get(...)` 隐性绑定。
 */
export const inject = [];

export function apply(ctx) {
  ctx.provide('radarMeMemory', {
    /** 上游标识（诊断用；不参与业务）。 */
    upstream: { package: UPSTREAM_PACKAGE, version: UPSTREAM_VERSION },

    /** 评审时用来核对「上游 client 没被挂上」的那几条槽名。 */
    mustNotMount: MUST_NOT_MOUNT,

    /**
     * 读当前账号的记忆台账（只读）。**不增删、不改写上游存储。**
     *
     * @param {string} _accountId 必填 —— 记忆按账号切分（TODO-2），不许跨账号
     * @returns {Promise<Array<{id: string, text: string, tags: string[], createdAt: number}>>}
     * @throws {Error} 未实现 —— 评审通过后按 TODO-2 / TODO-5 落实
     */
    list(_accountId) {
      throw Object.assign(
        new Error('radar-me-memory: 候选骨架，未实现（见 src/index.js TODO-0，先解决落点）'),
        { code: 'NOT_IMPLEMENTED' },
      );
    },
  });
}
