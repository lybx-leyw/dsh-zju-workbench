// 共享 UI 原语：无状态、纯展示，被壳与各页面包共同引用。
//
// 这里**没有**领域状态：账号、课程、解析任务属于 dsh-zhiyun-core-study，
// 通过 Cordis 服务传递（见下面的 useStudy）。这个包只回答「长什么样」。
import React, { useSyncExternalStore } from 'react';
import brandMark from './assets/zhiyun-mark.svg';
import compactBrandMark from './assets/zhiyun-mark-compact.svg';

const paths = {
  sun: 'M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  book: 'M12 5v15M12 5C9 3 5 3 3 4v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-2-1-6-1-9 1Z',
  chat: 'M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 3v-3a2 2 0 0 1-2-2V6a2 2 0 0 1 3-2Zm2 5h10M7 13h6',
  layers: 'm12 3 10 5-10 5L2 8l10-5Zm-9 9 9 5 9-5M3 16l9 5 9-5',
  user: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2a8 8 0 0 1 16 0v2',
  search: 'M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0Zm-1 5 5 5',
  arrow: 'M5 12h14m-5-5 5 5-5 5',
  collapse: 'M8 4v16M3 4h18v16H3V4Zm14 4-4 4 4 4',
  plus: 'M12 5v14M5 12h14',
  clock: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-5v5l3 2',
  moon: 'M20 14A9 9 0 0 1 10 4a9 9 0 1 0 10 10Z',
  check: 'm5 12 4 4L19 6',
  calendar: 'M7 2v4M17 2v4M3 9h18M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2Z',
  chevron: 'm9 5 7 7-7 7',
  close: 'M6 6l12 12M18 6 6 18',
  history: 'M3 12a9 9 0 1 0 2.6-6.4M3 4v5h5M12 8v4.2l3 1.8',
  menu: 'M4 7h16M4 12h16M4 17h16',
  more: 'M12 6h.01M12 12h.01M12 18h.01',
  // 论文阅读：一页带折角的稿纸。折角是「这是一份文档而不是一本书」的通用记号
  // （book 图标已被「我的课」占用，两者在侧栏相邻，形状必须一眼可分）。
  paper: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Zm0 0v5h5M9 13h6M9 17h4',
  // 翻译：两段互译的文字（上游「中」按钮与悬停浮层共用）。
  translate: 'M4 5h9M8.5 5v2c0 3-2 6-5 7m2-5c0 2 2 4 5 5m3-1 4 7 4-7m-7 7h6',
  // 插件依赖：三个节点用折线连起来 —— 「谁依赖谁」这件事的最小图形记号。
  graph: 'M8 6.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Zm13 11a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Zm0-11a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0ZM8 6.5h5.5M13.5 6.5v11M13.5 17.5H16',
  // ── 文件树（笔记页）────────────────────────────────────────────────
  // 文件夹 / 文档 / 附件是文件树里三种不同的东西，形状必须一眼可分：
  // 文件夹是「装东西的」，文档是「折角的纸」。
  folder: 'M3 7a2 2 0 0 1 2-2h3.6a2 2 0 0 1 1.6.8l.8 1.2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z',
  folderPlus: 'M3 7a2 2 0 0 1 2-2h3.6a2 2 0 0 1 1.6.8l.8 1.2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Zm9 5v5m-2.5-2.5h5',
  fileText: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Zm0 0v5h5M9 12h6M9 16h6',
  pencil: 'M4 20h4L20 8a2.83 2.83 0 0 0-4-4L4 16v4Zm10-14 4 4',
  trash: 'M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-8 0 1 13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l1-13',
  arrowLeft: 'M19 12H5m5-5-5 5 5 5',
  // 右侧栏开关：一个矩形加一条竖分割线 —— 与「收起侧栏」的 collapse 方向相反。
  panelRight: 'M3 4h18v16H3V4Zm11 0v16',
  // ── 侧栏导轨的页面图标 ──────────────────────────────────────────────
  //
  // 导轨**只有图标、没有常驻文字**（名字靠悬停浮出），所以每个图标必须自带含义、
  // 且彼此一眼可分。旧版直接复用现成的通用图标，于是：
  // 「论文」与「笔记」都是折角稿纸、「问一问」与「反馈」都是对话气泡、
  // 「我的课」与「看课」都是书 —— 一排里出现两个一模一样的图形，导轨就没法用了。
  //
  // 取名规则：按**它画的是什么**取（calendarToday / cap / bulb…），不按页面取。
  // 同一个图形将来被别的页面看上时可以直接复用，而 `icon: 'notes'` 这种名字
  // 会让人以为它只属于笔记页。
  calendarToday: 'M8 3v4M16 3v4M4 10h16M6 5h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2ZM10.5 13.5h3v3h-3Z',
  // 学士帽：读材料（课程）的通用记号，比一本「书」更难与阅读/论文混淆。
  cap: 'M2.5 9.2 12 4.6l9.5 4.6L12 13.8 2.5 9.2ZM6.2 11.4v4.2c0 1.6 2.6 2.8 5.8 2.8s5.8-1.2 5.8-2.8v-4.2M21.5 9.2v4.6',
  // 播放：一帧画面加播放三角（「看课」是从「我的课」进来的子页，不出现在导轨上，
  // 但它会出现在 Ctrl+K 的结果里，同样不能与「我的课」同形）。
  play: 'M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1ZM10 9.5l5 2.5-5 2.5v-5Z',
  // 带问号的对话气泡：「问一问」是提问，与「反馈」（喇叭）是两种东西。
  askBubble: 'M4 5h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-4 3v-3H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2ZM9.9 9.6a2.3 2.3 0 1 1 3.1 2.1c-.6.3-.9.7-.9 1.3v.3M12.1 15.8h.01',
  // 灯泡：把学过的东西「想明白」。
  bulb: 'M18 9.5a6 6 0 1 1-12 0 6 6 0 0 1 12 0ZM9.2 15.3c.2.6.3 1.2.3 1.8h5c0-.6.1-1.2.3-1.8M9.8 19.6h4.4M10.6 21.6h2.8',
  // 线圈笔记本：左边三道装订圈，与「折角稿纸」（论文）一眼可分。
  notebook: 'M7 4h12a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H7M7 4v16M4 8h3M4 12h3M4 16h3',
  // 插头：插件 = plug-in，字面意思，比抽象的三个节点更好认。
  plug: 'M9 3v4M15 3v4M6 7h12v3.5a6 6 0 0 1-12 0V7ZM12 16.5V21',
  // 喇叭：提需求、把意见「说出来」，与提问气泡形状完全不同。
  megaphone: 'M15 5 6.5 9H5a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h1.5L15 19V5ZM18 9.5a4 4 0 0 1 0 5M8.2 15.3v3.2a1.2 1.2 0 0 0 1.2 1.2h1',
  // ── 导轨的「···」与固定 ──────────────────────────────────────────
  // 横向三点：那是一个「还有别的」的按钮，和竖向的 `more`（菜单项里的省略）
  // 形状要分开 —— 两者在界面上会同时出现。
  // 点用 0.4 长的圆头短线画：纯 `h.01` 在 16px 下几乎看不见（stroke 只有 1.65）。
  moreHorizontal: 'M5.8 12h.4M11.8 12h.4M17.8 12h.4',
  // 图钉：钉住的页面会出现在导轨上。头 + 裙边 + 针，三段一眼能认出是「钉住」。
  pin: 'M9 10.8V6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v4.8l2 3.2H7l2-3.2ZM12 14v6',
  // ── 账号面板（头像点开那一层）─────────────────────────────────────
  // 登录：一个箭头进「门」。比钥匙更直白 —— 这一项的动作是"进去"，不是"钥匙"。
  signIn: 'M9.5 4H6.5A1.5 1.5 0 0 0 5 5.5v13A1.5 1.5 0 0 0 6.5 20h3M14.5 8l4 4-4 4M18.5 12H10',
  // 设置：齿轮。中心孔 + 外圈 + 八颗齿（齿用短径向笔画，比整条轮廓短得多，
  // 在 16px 下也一样清楚）。
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM12 5.2a6.8 6.8 0 1 0 0 13.6 6.8 6.8 0 0 0 0-13.6ZM12 2.6v2.6M12 18.8v2.6M2.6 12h2.6M18.8 12h2.6M5.3 5.3l1.9 1.9M16.8 16.8l1.9 1.9M18.7 5.3l-1.9 1.9M7.2 16.8l-1.9 1.9',
};
export function Icon({ name, size = 19 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] ?? paths.book}/></svg>;
}
export function Mark({ large = false, compact = false }) {
  return <span className={`zy-mark${large ? ' zy-mark-large' : ''}${compact ? ' zy-mark-compact' : ''}`} aria-hidden="true" dangerouslySetInnerHTML={{ __html: compact ? compactBrandMark : brandMark }}/>;
}

/**
 * 默认头像：**一个戴学士帽的学生剪影**（圆形由外层的 CSS 裁）。
 *
 * 为什么不用 `Icon`：那一套是 24×24 纯描边（`fill:none` + stroke），而头像要**实心**
 * 剪影 —— 描边画不出「一坨人形」。所以这里逐段给 fill，颜色用 `currentColor`，
 * 由使用方（`.zy-rail-avatar`）决定配色，明暗主题自动跟随。
 *
 * ⚠️ 肩部特意收窄到 5.4–18.6：再宽就会超出直径 24 的圆，被 `border-radius` 切出
 *    一条直边 —— 头像的圆边出现直边是很显眼的破绽。
 */
export function StudentAvatar({ size = 26 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    {/* 学士帽：菱形帽板 + 右侧流苏 */}
    <path d="M12 2.6 20.8 6.5 12 10.4 3.2 6.5 12 2.6Z" fill="currentColor"/>
    <path d="M20.2 7.4v4.1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    {/* 头 */}
    <circle cx="12" cy="13" r="3.1" fill="currentColor"/>
    {/* 肩（弧顶约 16.8，与头相接） */}
    <path d="M5.4 22.6c0-3.5 2.9-5.8 6.6-5.8s6.6 2.3 6.6 5.8H5.4Z" fill="currentColor"/>
  </svg>;
}

export function Empty({ icon = 'book', title, children, action }) {
  return <div className="zy-empty"><span className="zy-empty-icon"><Icon name={icon} size={27}/></span><h3>{title}</h3><p>{children}</p>{action}</div>;
}
export function SectionTitle({ children, aside }) { return <div className="zy-section-title"><h2>{children}</h2>{aside && <span>{aside}</span>}</div>; }

/** 订阅宿主的客户端 store（快照 + 订阅就是它的全部接口）。 */
export function useStore(store) {
  return useSyncExternalStore(
    listener => store.subscribe(listener),
    () => store.getSnapshot(),
    () => store.getSnapshot(),
  );
}

/** 领域状态包通过服务交出来的控制器：订阅 + 快照。 */
export const useStudy = (controller) => useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);

/** 一句话的提示条；没有内容时不占位。 */
export function Notice({ children }) {
  return children ? <div className="zs-notice" role="alert">{children}</div> : null;
}

/**
 * 把一份 CSS 挂成受生命周期管理的 `<style>`。
 *
 * 每个客户端包都带来自己那份样式表，卸载时必须一起走 —— 宿主按 `data-plugin` 认领
 * 卸载时新增的 `<style>`，这里用自命名属性 + `ctx.effect` 的清理函数达到同一效果，
 * 且不依赖宿主内部实现。四个页面包都要做同一件事，所以它属于共享原语。
 */
export function mountStyle(ctx, { attribute, css, label }) {
  return ctx.effect(() => {
    const style = document.createElement('style');
    style.dataset[attribute] = 'true';
    style.textContent = css;
    document.head.append(style);
    return () => style.remove();
  }, label);
}
