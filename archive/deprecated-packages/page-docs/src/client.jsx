// 「文档」页：把仓库里的协作规范搬进工作台。
//
// # 版式照文档站来
//
//   分区 tab（入门 / 协作 / 参考）
//   ┌─────────┬──────────────────────────┬─────────┐
//   │ 左侧目录 │ 正文                     │ 页内目录 │
//   └─────────┴──────────────────────────┴─────────┘
//                        上一篇 / 下一篇
//
// 为什么值得摆成这样，而不是一个长滚动页：
//   - **左侧目录负责"我在哪一片"**。十篇文档分三片，光靠标题列表看不出章节关系；
//     分区 tab 让人一眼知道自己在"协作"还是"参考"，不用滚到顶。
//   - **右侧页内目录负责"这一篇里有什么"**。规范类文档动辄几个小节，
//     找「提交前要检查什么」这种人只需要直接跳。
//   - **翻页是跨分区连着的**。从头读是一条连续的路，不因为走到分区末尾就断掉。
//
// # 这一页是整幅铺开的
//
// 它在壳的 `FULL_BLEED_PAGES` 里：不套 `.zw-content` 的 980px 版心。原因是它自己
// 就是三栏布局 —— 再套一层版心，左右两栏会把正文挤成一条缝。滚动也由这一页自己
// 负责（正文区单独 overflow），所以整页不再纵向滚动。
//
// # 为什么正文用宿主的 MarkdownText
//
// 自己写一套 Markdown 渲染意味着代码块高亮、表格、复制按钮、数学公式全都要重做一遍，
// 而且与宿主里其他地方的表现不一致。宿主已经提供了渲染助手消息的同一个组件，
// 笔记页、论文页、讲义阅读器都在用。
//
// 两个必须绕开的坑（细节见 `outline.js` 与 `style.css` 的注释）：
//   1. 宿主渲染标题时**不写 id**，`[x](#foo)` 这种 fragment 链接还会被 allowlist
//      降级成纯文本 —— 所以页内目录不能靠锚点，只能按"第几个标题"滚动。
//   2. 宿主的 `.markdown` 类名在产物里是哈希过的，跟着它写样式会静默失效。
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Empty, Icon, mountStyle, registerPageContent, useRegisterPageSidebar } from '@lybx-leyw/dsh-zju-ui-shared';
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives';
import { DEFAULT_PAGE, SECTIONS } from './docs-manifest.js';
import { contentOf } from './docs-content.js';
import { isInstantScroll, scrollAmount, scrollIntent } from './keys.js';
import { filterPages, flattenPages, neighbors, scanHeadings, stripHeading1 } from './outline.js';
import css from './style.css';

export const name = 'zw-page-docs-client';

export const inject = ['slots'];

/**
 * 这个宽度下目录是**浮层**而不是并排的一栏。
 *
 * 与 `style.css` 的 `@media (max-width: 640px)` 是同一个数 —— 那边决定"怎么画"，
 * 这边决定"默认开不开"。两处必须一致，测试里钉着这一条。
 */
export const PHONE_MAX_WIDTH = 640;

/**
 * 当前视口是不是手机档。
 *
 * 用 `matchMedia` 而不是 `innerWidth`：SSR / 测试环境没有 `window` 时直接返回
 * `false`（按桌面处理），不会在模块求值阶段就抛错。真正跟着视口变化的那种
 * 「用户拖窗口」不需要处理 —— 那是**初始值**的判断，之后一律由用户显式开关。
 *
 * @returns 是否窄屏。
 */
export function isPhoneViewport() {
  try {
    return globalThis.matchMedia?.(`(max-width: ${PHONE_MAX_WIDTH}px)`)?.matches ?? false;
  } catch {
    return false;
  }
}

export function apply(ctx) {
  mountStyle(ctx, { attribute: 'zwDocsStyle', css, label: 'zw: docs page styles' });
  // 直接注册给页面壳的 `page.content`（keyed），不再依赖外壳为它声明子槽。
  registerPageContent(ctx, {
    id: 'docs',
    // 导轨图标：ui-shared 的统一描边集，与内建页同源同风格。
    icon: () => <Icon name="fileText"/>,
    label: '文档',
    // 文档页是「应用型」版式：分区栏 + 目录 + 正文各自滚动，不套 980px 版心。
    fullBleed: true,
    render: () => <Docs/>,
  });
}

/**
 * 宿主 Markdown 渲染器的文案。
 *
 * 必须是**模块级常量**：`MarkdownText` 按 `labels` 的**身份**缓存组件表，每次渲染
 * 新建一个字面量会让它反复重建。`@lybx-leyw/dsh-zju-page-paper` 也是这么写的。
 */
const MARKDOWN_LABELS = { code: { copyLabel: '复制', copiedLabel: '已复制' }, footnotes: '注释' };

/** 摊平后的顺序表，整个模块共用一份 —— 它只依赖静态清单。 */
const FLAT = flattenPages(SECTIONS);

/**
 * 页脚的默认出处说明。
 *
 * 页脚是纯文本（`current.source` 也是字符串），所以这里不用 `<code>` 包路径 ——
 * 想强调路径的页面自己在 `source` 里写。
 */
const DEFAULT_SOURCE = '摘写自仓库文档，原文见 docs/contributing/；两处冲突时以原文为准。';

/**
 * 正文区的滚动容器里，所有会出现在目录里的标题。
 * 用后代选择器而不是给标题挂 id：宿主不写 id，我们只能按出现顺序认。
 */
const HEADING_SELECTOR = '.zwd-md h2, .zwd-md h3';

/**
 * 量一次「这次按键该滚多少」所需的两个尺寸。
 *
 * `height` 取滚动容器自己的 `clientHeight`（就是"一屏"）。
 * `lineHeight` 必须从**正文块**上量：`.zwd-main` 自己不设行高，它继承到的是
 * `normal`（`parseFloat` 得 `NaN`）；真正的行高写在 `.zwd-md > div` 上
 * （`style.css` 的 1.85）。量错对象会让 ↑/↓ 每次只走 `FALLBACK_LINE_HEIGHT`
 * 兜底值 —— 不报错、只是"按了几乎不动"。
 *
 * 正文为空（`Empty` 空态）时没有 `.zwd-md`，此时返回 `NaN` 让纯函数层退回兜底值。
 *
 * @param scroller - `.zwd-main` 那个元素。
 * @returns `{ height, lineHeight }`，交给 `scrollAmount`。
 */
function measureScroll(scroller) {
  const block = scroller.querySelector('.zwd-md > div');
  return {
    height: scroller.clientHeight,
    lineHeight: block === null ? Number.NaN : Number.parseFloat(getComputedStyle(block).lineHeight),
  };
}

/**
 * 宿主是否开着一个**模态**对话框（`:modal`）。
 *
 * 用 `:modal` 而不是 `[role="dialog"]`：宿主里有些非模态浮层（生成长面板、任务队列）
 * 也带 `role="dialog"`，它们**不**该拦键盘 —— 那些浮层开着时用户仍需要在正文里读。
 * `:modal` 只命中 `showModal()` / `alert()` 这类真正夺走交互的对话框。
 *
 * 宿主那两个会用到：Ctrl+K 的「跳转到」、账号浮层（`components.jsx` 里都是
 * `dialog.current.showModal()`）。它们开着时按键归它们，这一页不抢。
 *
 * 老浏览器没有 `:modal` 支持时会抛 —— 那时按"没有模态框"处理，退回本页自己滚，
 * 与加这个判据之前的行为一致，不会更差。
 *
 * @returns 是否有模态对话框开着。
 */
function hasModalDialog() {
  try {
    return document.querySelector('dialog:modal') !== null;
  } catch {
    return false;
  }
}

export function Docs() {
  const [pageId, setPageId] = useState(DEFAULT_PAGE);
  const [query, setQuery] = useState('');
  const [activeHeading, setActiveHeading] = useState(-1);
  const [copied, setCopied] = useState(false);
  /**
   * 左侧目录是否展开。
   *
   * 这一页原先**没有**收起态：目录栏恒占 229px。窄窗口下靠 `@media` 断点自动让位，
   * 但那不给用户任何主动选择 —— 想专心读一篇时没法把目录收掉。
   *
   * 默认展开（第一次进来看得到「这一片有哪些篇」），收起后由导轨那只鲸鱼叫回来。
   * 与论文库不同，这里**不记进 localStorage**：文档页是「读哪一篇」的临时位置，
   * 宽度偏好那种跨会话的东西不属于它（与 `pageId` 本身一样不留存）。
   *
   * # 手机（≤ 640）：默认**收起**，展开时是浮层
   *
   * 手机屏宽 390 减去导轨 51 只剩 339，目录按桌面那样占 229 就只剩 110 给正文 ——
   * 一行不到 5 个汉字。所以窄屏下目录改成**盖在正文上的浮层**（见样式表那条
   * `@media (max-width: 640px)`），并且默认不展开：进来先读，要挑篇再点鲸鱼。
   *
   * ⚠️ 默认值必须跟着视口走，不能写死 `true`。写死 `true` 时手机上一进来就是
   * 「目录盖住正文」，而用户并不知道盖住它的东西能收；写死 `false` 则桌面用户
   * 每次都要多点一下才看得到目录（桌面 229 + 正文 740 明明放得下）。
   */
  const [navOpen, setNavOpen] = useState(() => !isPhoneViewport());
  /** 把目录开关交给导轨鲸鱼（见 `ui-shared/page-sidebar.js`）。 */
  const toggleNav = useCallback(() => setNavOpen((value) => !value), []);
  useRegisterPageSidebar('docs', { expanded: navOpen, toggle: toggleNav, label: navOpen ? '收起文档目录' : '展开文档目录' });
  const scrollRef = useRef(null);
  /**
   * 点目录之后"钉住"的那一条。
   *
   * 为什么需要它：点第 15 条目录会把第 15 个标题滚到顶，但短文档滚不到那么远，
   * 于是滚动事件里的位置判据算出的是第 13 条 —— **刚点完，高亮就跳回上一节了**。
   * 位置判据本身没写错，它错在"点目录"这件事上：人点了哪一条，那一条就是当前节，
   * 不该由滚动位置投票推翻。
   *
   * 所以这里记下"这一条是我点出来的"，滚动判据在看到它时不接管；
   * 直到用户**自己**动手滚动（滚轮 / 触摸 / 键盘 / 拖滚动条）才清空，
   * 那时位置判据重新说了算。平滑滚动的动画不会触发这些事件，所以不会被误清。
   */
  const pinned = useRef(null);
  /**
   * 本页根节点。键盘处理器靠它判"是不是本页"（见下面那条 effect）。
   *
   * ⚠️ 别在 effect 的清理函数里把它置空 —— 严格模式下会「挂载 → 清理 → 再挂载」，
   *    ref 不会跟着重新赋值，置空之后处理器就永远拿不到根节点。详见那条 effect 的注释。
   */
  const rootRef = useRef(null);
  /**
   * 上一次滚动键：`{ key, at }`，给 `isInstantScroll` 判"是不是连按"。
   *
   * 用 ref 而不是 state：它只在两次按键之间传递，改它不该引起重渲染。
   */
  const lastScroll = useRef(null);

  const current = FLAT.find(page => page.id === pageId) ?? FLAT[0];

  // 正文：去掉开头那个 h1 再渲染。文件里保留 `# 标题` 是为了这些 md 单独打开时
  // 也自带标题；页面上标题由 `.zwd-head` 画，两处都画就重复了。
  const markdown = contentOf(current.id);
  const body = useMemo(() => stripHeading1(markdown), [markdown]);
  const headings = useMemo(() => scanHeadings(body), [body]);

  const { prev, next } = neighbors(FLAT, current.id);
  const section = SECTIONS.find(item => item.id === current.sectionId);

  // 过滤后的可见页 id 集合。用来同时收窄左侧目录与"这一片还剩几篇"。
  const matched = useMemo(() => new Set(filterPages(query, FLAT).map(page => page.id)), [query]);

  /** 换页：回到顶部，并清掉上一页的目录高亮（新页的标题还没量出来）。 */
  useEffect(() => {
    pinned.current = null;
    setActiveHeading(-1);
    setCopied(false);
    scrollRef.current?.scrollTo({ top: 0 });
  }, [current.id]);

  /**
   * 用户自己动手滚动时，把"钉住"交还给位置判据。
   *
   * 只认**人的动作**（滚轮 / 触摸 / 键盘 / 按下指针），不认 `scroll` 事件 ——
   * 平滑滚动的动画本身会连续触发出几十个 `scroll`，用它来解钉等于没钉。
   */
  useEffect(() => {
    const host = scrollRef.current;
    if (!host) return undefined;
    const release = () => { pinned.current = null; };
    const types = ['wheel', 'touchstart', 'keydown', 'pointerdown'];
    for (const type of types) host.addEventListener(type, release, { passive: true });
    return () => {
      for (const type of types) host.removeEventListener(type, release);
    };
  }, [current.id]);

  /**
   * 跟着滚动高亮页内目录。
   *
   * 用「最后一个已经滚过顶部若干像素的标题」而不是 IntersectionObserver：
   * 目录条数通常只有个位数，逐个量 `getBoundingClientRect` 的代价可以忽略，
   * 而 observer 在"一屏里有三个标题同时可见"时要额外处理优先级。这里
   * `SCROLL_ANCHOR` 给标题留一点余量，否则刚点完跳转会看到上一节还是高亮的。
   *
   * # 滚到底要换个判据
   *
   * 只有四个小节的短文档滚不了多远：最后一节的标题可能永远到不了顶线（它会停在
   * 屏幕中部），于是按顶线判断时，点最后一节看着像**没跳** —— 高亮还停在前一节。
   * 真机量过：`offsetTop=825` 的标题在 `maxScroll=615` 的容器里最多只升到距顶 210px。
   *
   * 所以到底以后改用屏幕中线：最后一节能滚到哪算哪，只要它在中线以上就算"当前这节"。
   * 加 `scrollTop > 0` 是给"整篇不足一屏"的情况留退路 —— 那时既滚不动也不该高亮到末尾。
   */
  useEffect(() => {
    const host = scrollRef.current;
    if (!host) return undefined;
    const sync = () => {
      const nodes = host.querySelectorAll(HEADING_SELECTOR);
      if (nodes.length === 0) { setActiveHeading(-1); return; }
      // 刚点过目录：那一条是人的明确选择，位置判据不投票（见 `pinned` 的注释）。
      if (pinned.current !== null) { setActiveHeading(pinned.current); return; }
      const box = host.getBoundingClientRect();
      const anchor = box.top + SCROLL_ANCHOR;
      let active = 0;
      nodes.forEach((node, index) => {
        if (node.getBoundingClientRect().top <= anchor) active = index;
      });
      const atBottom = host.scrollTop > 0
        && host.scrollTop + host.clientHeight >= host.scrollHeight - 2;
      if (atBottom) {
        const middle = box.top + host.clientHeight / 2;
        nodes.forEach((node, index) => {
          if (node.getBoundingClientRect().top <= middle) active = index;
        });
      }
      setActiveHeading(active);
    };
    host.addEventListener('scroll', sync, { passive: true });
    sync();
    return () => host.removeEventListener('scroll', sync);
  }, [current.id, headings.length]);

  /**
   * 跳到第 index 个标题。
   *
   * 这里**只能**按序号：宿主渲染标题时不写 id，写 `[x](#foo)` 又会被链接 allowlist
   * 降级成纯文本，所以既拿不到锚点也造不出锚点。序号来自同一套扫描规则
   * （`scanHeadings` 跳过围栏代码块），元素对不齐时——比如渲染器比扫描器多认了一个
   * 标题——下标会越界，此时直接不动，不做"猜一个最近的"这种兜底：跳错地方比不跳更糟。
   *
   * 跳完要 `pinned` 住这一条：滚动到底的短文档里，位置判据算不出这一节（见上方
   * `pinned` 的注释），不钉住的话高亮会在平滑滚动结束的瞬间跳回上一节。
   */
  const jumpTo = index => {
    const host = scrollRef.current;
    if (!host) return;
    const node = host.querySelectorAll(HEADING_SELECTOR)[index];
    if (node === undefined) return;
    node.scrollIntoView({ block: 'start', behavior: 'smooth' });
    pinned.current = index;
    setActiveHeading(index);
  };

  /** 切到某一篇。分区 tab 用它跳到该分区第一篇。 */
  const open = id => {
    setPageId(FLAT.some(page => page.id === id) ? id : DEFAULT_PAGE);
    setQuery('');
    // 手机上目录是盖在正文上的浮层：挑完这一篇就该让开，否则用户还得再去找那只鲸鱼。
    // 桌面（并排的一栏）不收 —— 那一栏本来就该一直在。
    if (isPhoneViewport()) setNavOpen(false);
  };

  /**
   * 复制整页原文。
   *
   * 失败**静默**：`navigator.clipboard` 在非安全上下文（http + 非 localhost）
   * 或用户拒绝授权时会被浏览器直接挡掉，抛一个 promise rejection。这时给用户弹一个
   * "复制失败"，除了让人多读一行字没有任何补救手段 —— 他重试一次也一样失败。
   * 所以只在成功时把按钮文案切成「已复制」，失败就当没点。
   * 2 秒后复位，避免"已复制"一直挂着、下次点之前看不出还能点。
   */
  const copyPage = text => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }, () => {});
  };

  /**
   * PageUp / PageDown / ↑ / ↓：滚正文。
   *
   * # 为什么必须自己接管（真机实测）
   *
   * 改这一版之前先量过现状（1200×700，三栏铺开，`maxScroll=3168`）：
   *
   *   · 焦点在 `<body>`（点过正文之后就是这样）：Chrome **原生就会滚**
   *     `.zwd-main`（PageDown 576px、↓ 40px）。所以"完全没反应"并不是全貌。
   *   · 焦点在一个**按钮**上（点过左侧目录、页内目录之后就是这样）：
   *     `scrollTop` **一动不动**（实测连按两个键仍是 0）。而"点目录跳到某篇、
   *     某节，然后接着往下读"正是这一页最常走的路径 —— 用户遇到的"不支持"
   *     就是这个。原生之所以不滚：按钮所在的 `.zwd-nav` 没有溢出，再往外
   *     `html/body` 是 `overflow:hidden`，浏览器找不到可滚的东西。
   *   · 焦点在筛选框里：↑/↓ 归输入框，**不能碰**（见下面第 1 条豁免）。
   *
   * 于是判据只能自己写：**四个键一律滚正文**。
   *
   * # 为什么不照抄笔记库的「焦点在树上时 ↑/↓ 移游标」
   *
   * 笔记库那么做是对的：它的树是**文件管理器**，行上有改名/删除这类
   * "先选中、后操作"的动作，方向键在那里天然属于树。这一页的左目录只是
   * "这一篇 ↔ 那一篇"的跳转按钮，点一下就换篇，没有"选中态"可言；
   * 若再给它加一套方向键游标，用户点完目录随手按 ↓ 想继续读，只会看到
   * 高亮在目录里挪、正文纹丝不动 —— 那正是他要报的 bug。右目录更不能加：
   * 它的高亮由滚动位置算出来（`.zwd-toc-active`），再加一个游标高亮会在
   * 同一栏里打架。
   *
   * # 输入区豁免（只有这一条）
   *
   * 筛选框是 `<input type="search">`：那里 ↑/↓ 是光标、PageUp/PageDown 有
   * 原生含义（部分浏览器在 search 上翻候选）。接管它等于把输入框变砖。
   *
   * @param event - keydown 事件。
   * @returns 是否接管了这次按键。
   */
  const handleScrollKeys = event => {
    const intent = scrollIntent(event.key, {
      ctrl: event.ctrlKey,
      meta: event.metaKey,
      alt: event.altKey,
      shift: event.shiftKey,
      composing: event.isComposing === true,
    });
    if (intent === null) return false;

    const target = event.target;
    if (!(target instanceof Element)) return false;
    if (target.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]')) return false;

    const scroller = scrollRef.current;
    if (scroller === null) return false;
    // 量不出高度时什么都不做：在 0 高的容器上 `scrollBy` 也是 0，
    // 但那时不该 `preventDefault` 掉一个本来交给浏览器的键。
    const amount = scrollAmount(intent, measureScroll(scroller));
    if (amount === 0) return false;

    const now = Date.now();
    const instant = isInstantScroll(lastScroll.current, event.key, now, event.repeat);
    lastScroll.current = { key: event.key, at: now };

    // 键盘滚动是**人的动作**：解掉"点目录钉住"的那一条，让位置判据重新说话。
    // 不写这一句的话，点完目录再按 ↓，右目录高亮会一直停在点过的那一节。
    pinned.current = null;
    scroller.scrollBy({ top: amount, behavior: instant ? 'instant' : 'smooth' });
    event.preventDefault();
    return true;
  };

  /**
   * 把键盘处理器挂到 `document` 上，且只在本页确实存在时生效。
   *
   * # 为什么不能挂在页面根节点上（笔记页同款实测结论）
   *
   * 读文档时用户点的是正文，而正文不可聚焦 —— `activeElement` 落回 `<body>`，
   * 而 `<body>` 是本页根节点的**祖先**，事件不向下冒泡，挂在根节点上的监听
   * 一次都收不到。必须挂 `document`。
   *
   * # 挂 `document` 之后怎么不越界
   *
   *   1. 清理函数把监听摘掉 —— 这是主闸门；
   *   2. 每次按键再问一句"是不是本页"：目标落在本页内 → 是；或者**本页此刻可见** → 也算
   *      （宿主同一时刻只挂一个页面，可见就等于用户正在看它。焦点在 `<body>`、
   *      在宿主容器上时只能靠这一条）。
   *
   * ⚠️ **不要在清理函数里把 `rootRef.current` 置空**。听起来更保险，实际会挖一个坑：
   *    React 严格模式下 effect 会「挂载 → 清理 → 再挂载」，而 ref 不会跟着重新赋值，
   *    清理里置空之后就永远是 `null`，上面那句 `if (root === null) return` 会让
   *    键盘在整个页面生命周期里彻底失效。ref 由 React 自己管，我们不碰。
   *
   * 依赖数组留空：处理器只读写 ref，捕到第一次渲染的闭包就够；每次渲染重挂一遍
   * 反而会让"按住不放"中途断掉监听。
   */
  useEffect(() => {
    const onKeyDown = event => {
      const root = rootRef.current;
      if (root === null) return;
      const target = event.target;
      const inRoot = target instanceof Node && root.contains(target);
      const visible = root.isConnected && root.getClientRects().length > 0;
      if (!inRoot && !visible) return;
      // 宿主开着一个**模态**对话框（Ctrl+K 的「跳转到」、账号浮层）时，按键归它。
      // 这两个都是 `showModal()` 打开的：此时用户看的是对话框而不是这一页，
      // 让他按 ↓ 把背后的文档滚走，只会让人以为"在选下一页"。
      if (hasModalDialog()) return;
      handleScrollKeys(event);
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, []);

  return <div className="zyd" ref={rootRef}>
    {/* 分区 tab。与左侧目录是两种粒度：这里是"哪一片"，左边是"哪一篇"。 */}
    <div className="zwd-sections" role="tablist" aria-label="文档分区">
      {SECTIONS.map(item => {
        const selected = item.id === current.sectionId;
        return <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={selected}
          className="zwd-section"
          onClick={() => open(item.pages[0].id)}
        >{item.label}</button>;
      })}
    </div>

    <div className="zwd-body">
      {/* 左：目录。按分区成组，组头不可点。收起时整栏退场（导轨那只鲸鱼负责叫回来）。 */}
      {navOpen && <nav className="zwd-nav" aria-label="文档目录">
        <label className="zwd-filter">
          <Icon name="search" size={14}/>
          <input
            type="search"
            value={query}
            placeholder="筛选文档"
            aria-label="筛选文档"
            /* 手机键盘上的回车键文案与大小写行为。
               默认是「换行」键 —— 而这个框按回车不换行，只会让人以为按错了。
               `enterKeyHint="search"` 让它显示「搜索 / 前往」，与这个框的实际作用一致。
               `autoCapitalize="none"`：中文输入法本身不受影响，但中英混排时
               英文关键词会被自动首字母大写，反而搜不到。 */
            enterKeyHint="search"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            onChange={event => setQuery(event.target.value)}
          />
        </label>
        {SECTIONS.map(item => {
          const pages = item.pages.filter(page => matched.has(page.id));
          // 分区里一篇都没命中就整组收掉 —— 留一个空组头只会让人以为下面没加载出来。
          if (pages.length === 0) return null;
          return <div className="zwd-group" key={item.id}>
            <p className="zwd-group-title">{item.label}</p>
            {pages.map(page => <button
              key={page.id}
              type="button"
              className="zwd-link"
              aria-current={page.id === current.id ? 'page' : undefined}
              title={page.summary}
              onClick={() => open(page.id)}
            >{page.title}</button>)}
          </div>;
        })}
        {matched.size === 0 && <p className="zwd-nav-empty">没有匹配的文档</p>}
      </nav>}

      {/* 中：正文。整页唯一的滚动容器。 */}
      <div className="zwd-main" ref={scrollRef}>
        <article className="zwd-article">
          <header className="zwd-head">
            <p className="zwd-crumb">{section.label}</p>
            <h1>{current.title}</h1>
            <p className="zwd-summary">{current.summary}</p>
          </header>

          {body === ''
            /* 清单里写了这一篇、但 `docs-content.js` 没把它 import 进来。
               `tests/docs-page.test.mjs` 会拦这种情况，这里只是运行时的兜底。 */
            ? <Empty icon="fileText" title="这一篇暂时读不到">文档清单里有它，但包内没有对应的 markdown 文件。</Empty>
            /* `MarkdownText` 产出的是一组块元素（p / ul / pre / table），
               所以容器用 `<div>` 而不是包在 `<p>` 里 —— 块元素嵌进 `<p>` 是无效 HTML。 */
            : <div className="zwd-md"><MarkdownText text={body} labels={MARKDOWN_LABELS}/></div>}

          {/* 翻页。跨分区连着走，首/末页各少一个方向。 */}
          <nav className="zwd-pager" aria-label="上下篇">
            {prev
              ? <button type="button" className="zwd-pager-item" onClick={() => open(prev.id)}>
                <span className="zwd-pager-dir">← 上一篇</span>
                <span className="zwd-pager-title">{prev.title}</span>
              </button>
              : <span/>}
            {next
              ? <button type="button" className="zwd-pager-item zwd-pager-next" onClick={() => open(next.id)}>
                <span className="zwd-pager-dir">下一篇 →</span>
                <span className="zwd-pager-title">{next.title}</span>
              </button>
              : <span/>}
          </nav>

          {/* 如实标出这一篇的出处。文档站最怕让人以为看到的就是权威版本。
              清单里给了 `source` 就用它（比如口述整理的那篇，仓库里没有原文，
              照默认写法会把人引去找一份不存在的东西）。 */}
          <p className="zwd-source">{current.source ?? DEFAULT_SOURCE}</p>
        </article>
      </div>

      {/* 右：页内目录。只有一个标题时不摆 —— 那一栏会显得空。 */}
      {headings.length > 1 && <nav className="zwd-toc" aria-label="本页目录">
        <p className="zwd-toc-title">本页</p>
        {headings.map((heading, index) => <button
          key={`${heading.text}-${index}`}
          type="button"
          className={`zwd-toc-link${index === activeHeading ? ' zwd-toc-active' : ''}`}
          data-depth={heading.depth}
          onClick={() => jumpTo(index)}
        >{heading.text}</button>)}
        {/* 复制的是**原文**（含被摘掉的那个 h1），不是屏幕上渲染出来的这份 ——
            要粘出去时，人想要的是能独立成立的整篇文档。 */}
        <button
          type="button"
          className="zwd-copy"
          onClick={() => copyPage(markdown)}
        >{copied ? '已复制' : '复制本页'}</button>
      </nav>}
    </div>
  </div>;
}

/**
 * 滚到标题时，判定"已经过了这个标题"的余量（像素）。
 *
 * 给小一点、而不是贴着容器顶端：`scrollIntoView({ block: 'start' })` 会把标题顶到
 * 容器最上沿，若余量是 0，那这一刻的比较是浮点数边缘情况，偶尔会出现"点完第 3 节、
 * 高亮还停在第 2 节"。留 12px 让判定稳稳落在标题下方。
 */
const SCROLL_ANCHOR = 12;
