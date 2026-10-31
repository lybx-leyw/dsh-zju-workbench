/**
 * 「课堂生成」页的宿主半边 + 插槽名。
 *
 * # 宿主侧是空壳，但必须存在
 *
 * 客户端 bundle 靠宿主 Loader 的 `ctx.loader.entries()` 进启动图谱；没有宿主入口的包
 * 不会被扫描，`dsh.client` 声明也就读不到（见 `dsh-zhiyun-page-docs/src/index.js` 的同段说明）。
 *
 * # `inject: ['slots']` 为什么不写在这里
 *
 * 规范与 `docs/contributing` 的页面包约定都要求**浏览器半边**导出
 * `inject: ['slots']`（见 `dsh-zhiyun-page-study/src/client.jsx:17`）。宿主侧**没有**
 * `slots` 服务，它是 dsh-client-ui-slots 在浏览器里挂的。
 *
 * 如果本文件写 `export const inject = ['slots']`，Cordis 会在宿主上一直等这个永远不会
 * 出现的服务：插件永不 apply、Loader 条目状态停在 pending，profile 启动时多一个
 * 未就绪项。也就是说那一条会把「页面没注册」换成「整个包没启动」，更难查。
 *
 * 所以：`inject` 与真正的 `slots.register` 都在 `src/client.jsx`；本文件只把**插槽名**
 * 与**注册动作**集中一处，避免两处字符串漂移（客户端从这里 import）。
 *
 * # 插槽名
 *
 * `zhiyun.classroom.build`。注意外壳当前渲染的是 `zhiyun.<page>.content`
 * （`shell-workbench/src/components.jsx:386`），而 NAV 里还没有 `classroom-build` 这一页；
 * 也就是说本包注册的插槽要等外壳加页面 + NAV 条目之后才会被渲染。那部分在壳里，
 * **不在本包范围**，README「边界」一节写明了这一点。
 */

export const name = 'zhiyun-page-classroom-build';

/** 页面内容插槽。客户端与测试共用这一个常量。 */
export const SLOT_NAME = 'zhiyun.classroom.build';

/** 优先级 10：外部扩展用默认 0 就能盖住这一页（与「今天」「播放」页一致）。 */
export const SLOT_PRIORITY = 10;

/**
 * 把页面组件注册进插槽。
 *
 * 抽在这里而不是在 client.jsx 里内联 `ctx.slots.inject(...)`：插槽名是跨包契约，
 * 测试要断言、外壳将来要对接，集中一处比复制字符串可靠。
 *
 * @param {object} scope 浏览器侧 Cordis 上下文（需已 inject `slots`）
 * @param {Function} component React 组件
 * @returns {void}
 */
export function registerSlot(scope, component) {
  scope.slots.inject(SLOT_NAME, () => scope.slots.register(
    { name: SLOT_NAME, priority: SLOT_PRIORITY },
    component,
  ));
}

/**
 * 宿主侧无行为。
 *
 * 本页只读 `ctx.zhiyunClassroomStudio`（浏览器侧惰性取），不落盘、不注册路由、
 * 不新增宿主种子。
 */
export function apply() {}
