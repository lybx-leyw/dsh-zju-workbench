/**
 * 智云桥接 = 产品外观层。
 *
 * 页面外壳（导轨 + 页面管理 + 原生工作台作为首页）由 profile 直接挂载的
 * `@lybx-leyw/dsh-pages` 提供。本包**不**再安装它 —— 那会让 `pages` 服务被注册两次
 * （`service "pages" has been registered`），整条 entry 启动失败、导轨根本不渲染。
 *
 * 本包只做两件与产品有关、页面壳不该知道的事：
 *
 *   1. 挂产品外观：背景取智云主题变量；
 *   2. 把原生首页那句 slogan 换成智云文案（见 `hero-copy.js`）。
 *
 * 页面壳的配置（槽名、首页 key、管理器 key）写在 profile 的 `cordis.patch.yml` 里 ——
 * 那是「怎么装配」的问题，属于 profile 而不是插件代码。
 */
import { installHeroCopy } from './hero-copy.js';
import css from './style.css';

export const name = 'zhiyun-shell-bridge-client';

/**
 * 只声明本包真正用到的服务。
 *
 * 页面壳需要 `slots` / `locale`，但它由 profile 自己挂载，依赖由它自己声明；
 * 这里声明了反而会掩盖「谁装的页面壳」这件事。
 */
export const inject = [];

/**
 * @param ctx - 客户端上下文。
 */
export function apply(ctx) {
  // 产品外观：背景取智云主题变量。布局规则的唯一来源在 dsh-pages。
  ctx.effect(() => {
    const style = document.createElement('style');
    style.dataset.zhiyunBridge = 'true';
    style.textContent = css;
    document.head.append(style);
    return () => style.remove();
  }, 'zhiyun: workbench frame background');

  installHeroCopy(ctx);
}
