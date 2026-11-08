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
 * 迁移到 `@lybx-leyw/dsh-pages` 后，「生成」页与其它页面一样：内容注册到页面壳
 * 拥有的 `page.content`，key 是本页 id（`classroom-build`）。`SLOT_NAME` 保留为
 * 本包对外的标识（README 与测试引用它），但**不再**用它注册槽。
 */

export const name = 'zhiyun-page-classroom-build';

/** 页面内容插槽。客户端与测试共用这一个常量。 */
export const SLOT_NAME = 'zhiyun.classroom.build';

/** 优先级 10：外部扩展用默认 0 就能盖住这一页（与「今天」「播放」页一致）。 */
export const SLOT_PRIORITY = 10;

/**
 * 把页面组件注册进页面壳的内容槽。
 *
 * 抽在这里而不是在 client.jsx 里内联：页面 id 是跨包契约（README 与测试引用它），
 * 集中一处比复制字符串可靠。
 *
 * 依赖 `shell-ui` 的 `registerPageContent`，但本文件同时被**宿主半边**加载 ——
 * 那里没有 React/DOM，所以只能做转发，不能直接 import 客户端模块。实际绑定在
 * `client.jsx` 里完成。
 *
 * @param {object} scope 浏览器侧 Cordis 上下文
 * @param {Function} register 由 client 传入的 `registerPageContent`
 * @param {Function} component React 组件
 * @param {Function} [icon] 导轨图标组件。由 `client.jsx` 传入 —— 本文件是纯 JS，
 *   写不了 JSX；而图标必须在 JSX 环境里构造（`<Icon name="pencil"/>`）。
 * @returns {void}
 */
export function registerSlot(scope, register, component, icon) {
  register(scope, {
    id: 'classroom-build',
    label: '生成',
    // 应用型页面：自己管两栏布局与滚动，不套 720px 文章版心。
    fullBleed: true,
    ...(icon === undefined ? {} : { icon }),
    render: () => component(),
  });
}

/**
 * 宿主侧无行为。
 *
 * 本页只读 `ctx.zhiyunClassroomStudio`（浏览器侧惰性取），不落盘、不注册路由、
 * 不新增宿主种子。
 */
export function apply() {}
