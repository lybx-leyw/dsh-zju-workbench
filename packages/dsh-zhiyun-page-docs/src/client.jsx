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
// 它在壳的 `FULL_BLEED_PAGES` 里：不套 `.zy-content` 的 980px 版心。原因是它自己
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
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Empty, Icon, mountStyle } from 'dsh-zhiyun-shell-ui';
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives';
import { DEFAULT_PAGE, SECTIONS } from './docs-manifest.js';
import { contentOf } from './docs-content.js';
import { filterPages, flattenPages, neighbors, scanHeadings, stripHeading1 } from './outline.js';
import css from './style.css';

export const name = 'zhiyun-page-docs-client';

export const inject = ['slots'];

export function apply(ctx) {
  mountStyle(ctx, { attribute: 'zhiyunDocsStyle', css, label: 'zhiyun: docs page styles' });
  ctx.slots.inject('zhiyun.docs.content', () => ctx.slots.register(
    { name: 'zhiyun.docs.content' },
    Docs,
  ));
}

/**
 * 宿主 Markdown 渲染器的文案。
 *
 * 必须是**模块级常量**：`MarkdownText` 按 `labels` 的**身份**缓存组件表，每次渲染
 * 新建一个字面量会让它反复重建。`dsh-zhiyun-page-feedback` 与
 * `dsh-zhiyun-page-paper` 也是这么写的。
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
const HEADING_SELECTOR = '.zyd-md h2, .zyd-md h3';

export function Docs() {
  const [pageId, setPageId] = useState(DEFAULT_PAGE);
  const [query, setQuery] = useState('');
  const [activeHeading, setActiveHeading] = useState(-1);
  const [copied, setCopied] = useState(false);
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

  const current = FLAT.find(page => page.id === pageId) ?? FLAT[0];

  // 正文：去掉开头那个 h1 再渲染。文件里保留 `# 标题` 是为了这些 md 单独打开时
  // 也自带标题；页面上标题由 `.zyd-head` 画，两处都画就重复了。
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

  return <div className="zyd">
    {/* 分区 tab。与左侧目录是两种粒度：这里是"哪一片"，左边是"哪一篇"。 */}
    <div className="zyd-sections" role="tablist" aria-label="文档分区">
      {SECTIONS.map(item => {
        const selected = item.id === current.sectionId;
        return <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={selected}
          className="zyd-section"
          onClick={() => open(item.pages[0].id)}
        >{item.label}</button>;
      })}
    </div>

    <div className="zyd-body">
      {/* 左：目录。按分区成组，组头不可点。 */}
      <nav className="zyd-nav" aria-label="文档目录">
        <label className="zyd-filter">
          <Icon name="search" size={14}/>
          <input
            type="search"
            value={query}
            placeholder="筛选文档"
            aria-label="筛选文档"
            onChange={event => setQuery(event.target.value)}
          />
        </label>
        {SECTIONS.map(item => {
          const pages = item.pages.filter(page => matched.has(page.id));
          // 分区里一篇都没命中就整组收掉 —— 留一个空组头只会让人以为下面没加载出来。
          if (pages.length === 0) return null;
          return <div className="zyd-group" key={item.id}>
            <p className="zyd-group-title">{item.label}</p>
            {pages.map(page => <button
              key={page.id}
              type="button"
              className="zyd-link"
              aria-current={page.id === current.id ? 'page' : undefined}
              title={page.summary}
              onClick={() => open(page.id)}
            >{page.title}</button>)}
          </div>;
        })}
        {matched.size === 0 && <p className="zyd-nav-empty">没有匹配的文档</p>}
      </nav>

      {/* 中：正文。整页唯一的滚动容器。 */}
      <div className="zyd-main" ref={scrollRef}>
        <article className="zyd-article">
          <header className="zyd-head">
            <p className="zyd-crumb">{section.label}</p>
            <h1>{current.title}</h1>
            <p className="zyd-summary">{current.summary}</p>
          </header>

          {body === ''
            /* 清单里写了这一篇、但 `docs-content.js` 没把它 import 进来。
               `tests/docs-page.test.mjs` 会拦这种情况，这里只是运行时的兜底。 */
            ? <Empty icon="fileText" title="这一篇暂时读不到">文档清单里有它，但包内没有对应的 markdown 文件。</Empty>
            /* `MarkdownText` 产出的是一组块元素（p / ul / pre / table），
               所以容器用 `<div>` 而不是包在 `<p>` 里 —— 块元素嵌进 `<p>` 是无效 HTML。 */
            : <div className="zyd-md"><MarkdownText text={body} labels={MARKDOWN_LABELS}/></div>}

          {/* 翻页。跨分区连着走，首/末页各少一个方向。 */}
          <nav className="zyd-pager" aria-label="上下篇">
            {prev
              ? <button type="button" className="zyd-pager-item" onClick={() => open(prev.id)}>
                <span className="zyd-pager-dir">← 上一篇</span>
                <span className="zyd-pager-title">{prev.title}</span>
              </button>
              : <span/>}
            {next
              ? <button type="button" className="zyd-pager-item zyd-pager-next" onClick={() => open(next.id)}>
                <span className="zyd-pager-dir">下一篇 →</span>
                <span className="zyd-pager-title">{next.title}</span>
              </button>
              : <span/>}
          </nav>

          {/* 如实标出这一篇的出处。文档站最怕让人以为看到的就是权威版本。
              清单里给了 `source` 就用它（比如口述整理的那篇，仓库里没有原文，
              照默认写法会把人引去找一份不存在的东西）。 */}
          <p className="zyd-source">{current.source ?? DEFAULT_SOURCE}</p>
        </article>
      </div>

      {/* 右：页内目录。只有一个标题时不摆 —— 那一栏会显得空。 */}
      {headings.length > 1 && <nav className="zyd-toc" aria-label="本页目录">
        <p className="zyd-toc-title">本页</p>
        {headings.map((heading, index) => <button
          key={`${heading.text}-${index}`}
          type="button"
          className={`zyd-toc-link${index === activeHeading ? ' zyd-toc-active' : ''}`}
          data-depth={heading.depth}
          onClick={() => jumpTo(index)}
        >{heading.text}</button>)}
        {/* 复制的是**原文**（含被摘掉的那个 h1），不是屏幕上渲染出来的这份 ——
            要粘出去时，人想要的是能独立成立的整篇文档。 */}
        <button
          type="button"
          className="zyd-copy"
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
