// 共享 UI 原语：把「共享原子样式」注入一次，并把原语本身交给其它客户端包 require。
//
// 页面包用 `import { Icon } from '@lybx-leyw/dsh-zju-ui-shared'`：构建时它是 external，
// 运行时由客户端的模块表解析到**这个** bundle 的 exports（见 dsh.client.external）。
import * as primitives from './primitives.jsx';
import css from './style.css';

export const name = 'zhiyun-ui-primitives-client';
/** 纯展示包：除了客户端的 `slots` 什么都不依赖。 */
export const inject = [];
export function apply(ctx) {
  /**
   * `data-zhiyun` 属性：全仓 CSS 的限界开关。
   *
   * 所有页面的选择器都写成 `body[data-zhiyun] .xxx`。这个属性原来由
   * `shell-workbench` 设置，而它已归档 —— 没有它，规则一条都不匹配，
   * 页面看起来就是「只有裸 HTML、没有 CSS」。
   *
   * 现在由 ui-shared 设：它是所有页面的公共依赖，且本来就在管样式挂载。
   *
   * ⚠️ **必须在 `ctx.effect` 里做操作，返回清理函数**。写成
   * 「外面 set、effect 里 remove」会在 effect 求值时立刻执行 remove，
   * 等于设了又删（实测日志：after set true → cleanup → null）。
   */
  ctx.effect(() => {
    const previous = document.body.getAttribute('data-zhiyun');
    document.body.setAttribute('data-zhiyun', 'true');
    return () => {
      if (previous === null) document.body.removeAttribute('data-zhiyun');
      else document.body.setAttribute('data-zhiyun', previous);
    };
  }, 'zhiyun: body attribute');

  // 样式随本包的生命周期装卸；卸载后页面回到宿主原生外观。
  primitives.mountStyle(ctx, {
    attribute: 'zhiyunPrimitivesStyle',
    css,
    label: 'zhiyun: shared primitive styles',
  });
}
// ⚠️ 这张清单是**逐个列**的，新增原语必须同时加到这里，否则它在 `primitives.jsx` 里
//    定义得好好的、产物里也有那个字符串，但**入口 bundle 不往外传** —— 使用方拿到
//    `undefined`，React 报 #130（Element type is invalid），表现是那一整块插槽崩掉、
//    界面上凭空少一片。这个坑真踩过：新加的 `StudentAvatar` 漏在了这里。
//    `tests/ui-primitives.test.mjs` 会比对两个文件的导出名，防止再漏。
export const { Icon, Mark, Empty, SectionTitle, Notice, StudentAvatar, useStore, useStudy, mountStyle } = primitives;
// 页面框：页面包自己注册 `page.content` 时用它把内容包成「一页」，从而不依赖外壳。
export { PageFrame } from './page-frame.jsx';
// 页面自注册助手：一步完成「包框 + 注册到页面壳的内容槽」。
export { registerPageContent } from './page-registration.jsx';
// AI 助手右侧抽屉：页面内部的对话面板（不碰宿主右栏）。
// 传输层由调用方通过 `send` 回调决定，外壳（折叠/拖宽/滚动/输入）共用。
export { AssistantDrawer } from './assistant-drawer.jsx';
// 轻量 Markdown 渲染（无第三方依赖、不用 dangerouslySetInnerHTML）。
// 抽屉用它渲染正文；别的页面要展示模型输出也用它，避免各家引一个 markdown 库。
export { Markdown } from './markdown.jsx';
// 页面目录与导航纯函数（原 `shell-workbench/src/model.js`，外壳退休后搬到共享层）。
// 它们只被测试与脚本用于断言，**当前 profile 不装配任何页面**。
export {
  FULL_BLEED_PAGES,
  NAV,
  RAIL_ACCOUNT,
  RAIL_DEFAULT,
  activePage,
  beijingDate,
  hiddenPageIds,
  matchingPages,
  pageBundle,
  pageSlot,
  panelKey,
  visiblePages,
} from './pages-model.js';
// 设置分区工具箱：各 source 包的设置面板共用同一套外观与 i18n 注册。
export {
  REGISTER_NAMESPACE_PREFIX,
  SETTINGS_CSS,
  Actions,
  Card,
  Field,
  Intro,
  PageTitle,
  Rows,
  Section,
  StatusLine,
  TextArea,
  TextInput,
  registerText,
  textOf,
} from './settings-kit.jsx';

// ⚠️ 这里**不能**写 `export default primitives`。
//
// 宿主 Loader 解析 bundle 的 exports 时优先取 `default`（见 vendor/loader 的 `unwrapExports`：
// `exports = exports.default ?? exports`），于是 default 会顶掉真正的插件面 —— 它拿到的是
// 原语命名空间对象（没有 `apply`），整页直接 "Failed to load plugins:
// invalid plugin, expect function or object with an \"apply\" method, received object"。
// 具名导出就够了：别的包 `import { Icon } from '@lybx-leyw/dsh-zju-ui-shared'` 走的是本 bundle
// 的 exports 表（dsh.client.external 建立的行），与 ESM default 无关。
