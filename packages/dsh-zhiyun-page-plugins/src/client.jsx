// 「插件」页的浏览器半边：读浏览器面的依赖事实，取宿主面的读数，折成一张图交给页面。
//
// 三份读数各有各的归属，这里不复制任何一份：
//   - 开关状态与包清单：宿主自带的 `remote.pluginManager`（启用/停用的唯一真源）；
//   - 模块边与拓扑序：`ctx.modules.manifest.modules`（DSH 的 `orderByModuleGraph` 已排好）；
//   - 硬边：浏览器面就地读（`ctx.loader`/`ctx.registry`/`ctx.reflect`），宿主面由本包
//     `/api/zhiyun-plugins` 读出来 —— 两棵树互不可见，缺一面就会把 parser 这种「被
//     study-core 硬依赖」的包误判成叶，而取消它的后果正是本仓 README 反复警告的那种。
import { mountStyle } from 'dsh-zhiyun-ui-primitives';
import { createStore } from './store.js';
import { Panel } from './Panel.jsx';
import css from './style.css';

export const name = 'zhiyun-page-plugins-client';

/**
 * 只声明注册页面必需的服务，外加读图要用的几个。
 *
 * `remote.pluginManager` 是宿主的插件管理 Remote（与宿主「插件」页同一条路径）；
 * `loader`/`modules` 是浏览器自己那棵树与那份模块图。刻意**不**把
 * `zhiyunStudyController` 之类的领域服务写进来 —— 这一页要在领域包被停用时照样打得开，
 * 那正是它存在的意义。
 */
export const inject = ['slots', 'connection', 'remote', 'remote.pluginManager', 'loader', 'modules'];

export function apply(ctx) {
  mountStyle(ctx, { attribute: 'zhiyunPluginsStyle', css, label: 'zhiyun: plugins page styles' });
  const store = createStore(ctx);
  ctx.effect(() => () => store.dispose(), 'zhiyun: plugins page store');
  // 宿主说「装了什么、开了什么、组合变了」就重读 —— 从这一页、从宿主的插件页、或从命令行改的都算。
  ctx.effect(() => ctx.remote.$on('plugin-manager/changed', () => { void store.refresh(); }),
    'zhiyun: plugins page invalidation');
  ctx.slots.inject('zhiyun.plugins.content', () => ctx.slots.register({
    name: 'zhiyun.plugins.content',
    inject: () => ({ store }),
  }, Panel));
}

export { Panel };
