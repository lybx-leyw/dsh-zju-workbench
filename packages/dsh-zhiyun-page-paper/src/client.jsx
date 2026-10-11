import { mountStyle } from 'dsh-zhiyun-ui-primitives';
import css from './style.css';
import { Paper } from './Paper.jsx';
import { SettingsSection } from './SettingsSection.jsx';

/**
 * 「论文」页的客户端入口。
 *
 * 三处注册：
 *   1. `zhiyun.paper.content` —— 外壳 `main` 插槽为每一页声明的 children 之一
 *      （`shell/src/client.jsx` 里 generator 的那一段），只注册内容，页框架归外壳；
 *   2. `settings.section` —— 设置集中管理。壳里的 `PersonalSettingsBridge` 会把
 *      所有 `settings.section` 注册按 order 摊成折叠分组，所以新插件零改壳；
 *   3. 样式挂载。
 *
 * 阅读器本体活在宿主同源的 iframe 里（上游 `/paper-reader/` 页面），
 * 因为客户端 bundle 有「不许内联本包 src 之外的文件」的构建守卫，
 * pdf.js 那 1.8MB 不能进这个 bundle —— 这是选 iframe 而不是 react-pdf 的硬理由。
 *
 * 这里的 `controller` 由外壳通过插槽 inject 递进来（就是 `zhiyunNavigation`），
 * 用来跳去「问一问」；拿不到也不影响本页，所以不做硬依赖。
 */

export const name = 'zhiyun-page-paper-client';

export const inject = ['slots'];

export function apply(ctx) {
  mountStyle(ctx, { attribute: 'zhiyunPaperStyle', css, label: 'zhiyun: paper page styles' });

  ctx.slots.inject('zhiyun.paper.content', () => ctx.slots.register(
    { name: 'zhiyun.paper.content' },
    Paper,
  ));

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'paper-reader',
    order: 60,
    label: () => '论文阅读',
  }, SettingsSection));
}
