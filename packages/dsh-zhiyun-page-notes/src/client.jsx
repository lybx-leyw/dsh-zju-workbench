// 「笔记」页：Obsidian 式的笔记库。
//
// # 这一页与「学习」页里的节笔记不是一回事
//
//   学习页的「笔记」  一节课一份，键是 `账号.节次`，链接是 `zy://section` 跳回播放位置
//   本页              一棵 `.md` 文件树，靠 `[[双链]]` 连成网络
//
// 同一段正文可以**同时**带这两种链接。两者各有各的用处：前者绑定课程上下文，
// 后者是跨课程的知识网。
//
// # 布局按 Obsidian 的真实结构来
//
//   ribbon（窄图标列）│ 文件树 │ 标签页 + 编辑器 + 状态栏 │ 右栏（可折叠）
//
// 每一块都对应 Obsidian 里真实存在的东西，不是装饰：
//   - **ribbon**：新建笔记 / 新建文件夹 / 过滤 / 开关两侧面板；
//   - **文件树**：文件夹可折叠、笔记与附件分形状、拖到文件夹上即移动；
//   - **标签页**：同时开多篇，各自带自己的草稿与未保存状态；
//   - **面包屑**：`← →` 是打开历史（后退/前进），右边是所在目录 + 文件名；
//   - **编辑器**：文件名即大标题（改标题就是改文件名），
//   - **状态栏**：反链条数 / 词数 / 字符数，以及保存状态。
//
// # 为什么正文用宿主的 MarkdownText
//
// 宿主已经提供了渲染助手消息的**同一个**组件（`@deepseek-ai/dsh-client-ui-primitives`
// 的 `MarkdownText`），论文页与讲义阅读器都在用。自己写一套 Markdown 渲染
// 意味着代码块高亮、脚注、表格、复制按钮全都要重做一遍，而且与宿主的表现不一致。
//
// # 四条交互决定
//
// 1. **自动保存**（停顿 800ms 后写盘）。手动保存按钮在笔记应用里是反模式：
//    用户会忘。写失败时**不动**编辑器内容，并在状态栏如实报错。
// 2. **反链是只读的**，点一条跳过去。改反链要改的是**对方**的正文 ——
//    那属于在别人的笔记里做手术，不该在这里顺手做。
// 3. **标题即文件名**，改名走 `rename`（服务端会一并改写全库指向它的链接）。
//    不提供"只改标题不改文件"——那会让 `[[标题]]` 与文件名对不上，
//    正是 Obsidian 用户最常见的困惑来源。
// 4. **切标签页/关标签页之前先落盘**。未保存的改动丢在切换里，是最难解释的
//    一类数据丢失（也是"我明明写了"的来源）。
//
// ⚠️ 每个打开过的文件都要有人回收：`tabs` 里的草稿是**内存里的第二份正文**，
// 关标签页时必须连同 `pending` 一起清掉，否则那一份会被下一次自动保存写回磁盘，
// 把用户删掉的内容又救回来。
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives';
import { Icon, Notice, mountStyle } from 'dsh-zhiyun-shell-ui';
// 图谱渲染是独立包（`dsh-zhiyun-graph-render`，整包移植自雷达候选 note-graph）：
// 页面只负责把 vault 的 graph 读数递进去，不背 cytoscape 这份依赖。
import { NoteGraph, css as graphCss } from 'dsh-zhiyun-graph-render';
import css from './style.css';

export const name = 'zhiyun-page-notes-client';
export const inject = ['slots'];

/**
 * 宿主 Markdown 渲染器的文案。
 *
 * 必须是**模块级常量**：`MarkdownText` 按 `labels` 的身份缓存组件表，
 * 每次渲染新建字面量会让它反复重建。论文页与讲义阅读器都这么写。
 */
const MARKDOWN_LABELS = { code: { copyLabel: '复制', copiedLabel: '已复制' }, footnotes: '注释' };

const NOTES_ROUTE = '/api/zhiyun-vault-notes';
const VAULT_ROUTE = '/api/zhiyun-vault';
/**
 * PDF 阅读器的同源地址（宿主路由，见 `src/pdf-viewer.js`）。
 *
 * 阅读器是 iframe 而不是本 bundle 里的组件：pdf.js 的 worker 必须是独立脚本，
 * 而本包客户端有「不许内联 src/ 之外文件」的构建守卫。同源则是为了把主题送进去。
 */
const PDF_VIEWER_PREFIX = '/zhiyun-vault-pdf/';
const AUTOSAVE_MS = 800;
/** 历史栈上限：够来回找，又不会把内存当日记本。 */
const HISTORY_LIMIT = 60;

/**
 * 两次滚动键间隔小于这个值，就算"连续操作"，走 `instant` 而不是 `smooth`。
 *
 * 为什么需要：`smooth` 的缓动动画约 300ms，而键盘重复约 30 次/秒。若每次都从
 * 当前位置重新起动画，按住不放反而几乎不动（实测 1.2 秒只走了一次的量）。
 * 350ms 比一次缓动略长，刚好覆盖"上一段动画还没结束就来了下一次"。
 */
const REPEAT_WINDOW_MS = 350;

/** 一次同源 RPC。两个路由的信封形状相同（`{type,rpcId,payload}`）。 */
async function rpc(route, method, args, signal) {
  const response = await fetch(route, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: `n-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, payload: { method, args } }),
    signal,
  });
  const answer = await response.json().catch(() => null);
  if (answer?.result?.ok !== true) {
    throw new Error(answer?.result?.error?.message ?? `HTTP ${response.status}`);
  }
  return answer.result.value;
}

const notes = (method, args, signal) => rpc(NOTES_ROUTE, method, args, signal);
const vault = (method, args, signal) => rpc(VAULT_ROUTE, method, args, signal);

/** 从正文里数出外链数。 */
const countLinks = (markdown) => (String(markdown).match(/\[\[[^\]\n]+\]\]/g) ?? []).length;
/** 从正文里数出标签数（去重）。 */
const countTags = (markdown) => new Set((String(markdown).match(/(^|[\s(【（「,，、;；:：!！?？"'“”‘’])#([\p{L}\p{N}_][\p{L}\p{N}_\-/]*)/gu) ?? []).map((m) => m.replace(/^[\s(【（「,，、;；:：!！?？"'“”‘’]*#/u, ''))).size;

/**
 * 词数：中日韩**按字**算，拉丁文按词算。
 *
 * 为什么不直接按空格切：中文笔记没有空格，那样整篇只算一个词，
 * 状态栏上的读数会永远显示 1。Obsidian 对 CJK 也是按字计的。
 */
function countWords(text) {
  const source = String(text ?? '');
  const cjk = (source.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff]/g) ?? []).length;
  const latin = (source.match(/[A-Za-z0-9_'’-]+/g) ?? []).length;
  return cjk + latin;
}

/** 相对路径的目录部分（`a/b` → `a`）；顶层给空串。 */
function dirOf(rel) {
  const slash = String(rel).lastIndexOf('/');
  return slash === -1 ? '' : String(rel).slice(0, slash);
}

/** 目录的显示名（`a/b` → `b`）。 */
function baseOf(rel) {
  const slash = String(rel).lastIndexOf('/');
  return slash === -1 ? String(rel) : String(rel).slice(slash + 1);
}
/** 去掉末尾扩展名（`a/b.pdf` → `a/b`）。标签标题用它，与笔记的「标题即文件名」一致。 */
function stripExt(rel) {
  const text = String(rel);
  const dot = text.lastIndexOf('.');
  const slash = text.lastIndexOf('/');
  return dot <= slash ? text : text.slice(0, dot);
}

/** 这条路径是不是 PDF（决定标签页渲染 iframe 还是编辑器）。 */
function isPdfPath(rel) {
  return /\.pdf$/i.test(String(rel));
}

/**
 * 把 `File` 读成 base64（不带 data URL 前缀）。
 *
 * 用 `FileReader` 而不是 `arrayBuffer()` + 手写编码：后者要处理分块（几十 MB 的
 * PDF 一次性 `String.fromCharCode.apply` 会爆调用栈），而 `FileReader` 是浏览器
 * 原生实现，不需要我们操心。
 *
 * @param file - `File`。
 * @returns base64 字符串。
 */
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'));
    reader.onload = () => {
      const text = String(reader.result ?? '');
      // `readAsDataURL` 给的是 `data:application/pdf;base64,XXXX`，只要逗号之后那段。
      const comma = text.indexOf(',');
      resolve(comma === -1 ? text : text.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}

/**
 * 把扁平的条目表拼成文件树的行。
 *
 * 排序：文件夹在前，其次笔记，最后附件；同一组里按名称排。中文用 `localeCompare`
 * 的默认排序（拼音），不然「阿」会排到「z」后面。
 */
function buildRows(entries, expanded, filter) {
  const query = filter.trim().toLowerCase();

  // 过滤时退化成**扁平的命中列表**：树里搜索要处理"祖先是否展开、命中在几层"，
  // 而那些上下文在搜索时并不重要 —— 用户此刻只想看到匹配的那几篇。
  if (query !== '') {
    return entries
      .filter((e) => e.type !== 'folder' && `${e.path}`.toLowerCase().includes(query))
      .sort((a, b) => a.path.localeCompare(b.path))
      .map((e) => ({ ...e, depth: 0 }));
  }

  const children = new Map();
  for (const entry of entries) {
    const parent = dirOf(entry.path);
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(entry);
  }
  const rank = (e) => (e.type === 'folder' ? 0 : e.type === 'note' ? 1 : 2);
  for (const list of children.values()) {
    list.sort((a, b) => rank(a) - rank(b) || baseOf(a.path).localeCompare(baseOf(b.path)));
  }

  const rows = [];
  const walk = (parent, depth) => {
    for (const entry of children.get(parent) ?? []) {
      rows.push({ ...entry, depth });
      // 折叠的文件夹只出自己那一行 —— 子孙不进来。
      if (entry.type === 'folder' && expanded.has(entry.path)) walk(entry.path, depth + 1);
    }
  };
  walk('', 0);
  return rows;
}

/** 一个条目的祖先目录链（用于"打开笔记时自动展开它所在的目录"）。 */
function ancestorsOf(rel) {
  const parts = String(rel).split('/').slice(0, -1);
  const out = [];
  let acc = '';
  for (const part of parts) {
    acc = acc === '' ? part : `${acc}/${part}`;
    out.push(acc);
  }
  return out;
}

export function apply(ctx) {
  mountStyle(ctx, { attribute: 'zhiyunNotesPageStyle', css, label: 'zhiyun: notes page styles' });
  // 图谱的样式随包走（`dsh-zhiyun-graph-render` 导出自己的 css），
  // 页面只负责在同一个 ctx 里挂上 —— 样式归属跟着组件走，不散落在页面里。
  mountStyle(ctx, { attribute: 'zhiyunGraphRenderStyle', css: graphCss, label: 'zhiyun: graph render styles' });
  ctx.slots.inject('zhiyun.notes.content', () => ctx.slots.register(
    { name: 'zhiyun.notes.content', priority: 10 },
    NotesLibrary,
  ));
}

/** 文件树的一行。`dropTarget` 让文件夹既是行也是拖放目标。 */
function TreeRow({ row, current, cursor, expanded, onOpen, onToggle, onDropOn, onDragStart, dragging }) {
  const isFolder = row.type === 'folder';
  const isOpen = isFolder && expanded.has(row.path);
  return <li
    className={`zs-nt-row${row.path === current ? ' is-current' : ''}${row.path === cursor ? ' is-cursor' : ''}${isOpen ? ' is-expanded' : ''}${dragging === row.path ? ' is-dragging' : ''}`}
    style={{ '--zs-nt-depth': String(row.depth) }}
    draggable
    onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', row.path); onDragStart(row.path); }}
    onDragEnd={() => onDragStart(null)}
    onDragOver={isFolder ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } : undefined}
    onDrop={isFolder ? (e) => { e.preventDefault(); e.stopPropagation(); onDropOn(e.dataTransfer.getData('text/plain'), row.path); } : undefined}
  >
    <button
      type="button"
      className="zs-nt-rowbtn"
      title={row.path}
      /* 键盘删除的落点：keydown 处理里靠 `data-path` 认出"焦点落在哪一行"。
         比维护一个 `selected` state 更贴合真实操作 —— 行的焦点**就是**选中，
         而且点击行本来就会让它获得焦点（按钮天然可聚焦）。 */
      data-path={row.path}
      data-kind={row.type}
      onClick={() => (isFolder ? onToggle(row.path) : onOpen(row.path))}
    >
      <span className="zs-nt-caret">{isFolder ? <Icon name="chevron" size={13} /> : null}</span>
      <span className={`zs-nt-rowicon${isFolder ? ' zs-nt-folder' : ''}`}>
        <Icon name={isFolder ? 'folder' : row.type === 'note' ? 'fileText' : 'paper'} size={14} />
      </span>
      <span className={`zs-nt-rowname${isFolder && isOpen ? ' is-open' : ''}`}>{baseOf(row.path)}</span>
      {row.type === 'attachment' ? <span className="zs-nt-ext">{row.ext}</span> : null}
    </button>
  </li>;
}

/**
 * PDF 标签页的正文：一个同源 iframe，指向宿主的 PDF 阅读器路由。
 *
 * # 为什么是 iframe
 *
 * 见 `pdf-viewer.js` 顶部：pdf.js 的 worker 必须是独立脚本，而客户端 bundle
 * 不许内联本包 `src/` 之外的文件。iframe 同时解决这两件事，并且**同源** ——
 * 只有同源才能把主题 `postMessage` 进去，PDF 才会跟着亮暗切换。
 *
 * # 主题同步
 *
 * 外层 `body[data-ds-dark-theme]` 是宿主的暗色开关（`shell-workbench` 在用它）。
 * 这里用 `MutationObserver` 盯着它，变了就通知 iframe；加载完成时也补发一次，
 * 否则首帧会停在 iframe 自己猜的颜色上。
 *
 * @param page - 库内相对路径（含 `.pdf`）。
 * @param title - 标签标题（不含扩展名）。
 */
function PdfViewer({ page, title }) {
  const frameRef = useRef(null);
  const src = `${PDF_VIEWER_PREFIX}?path=${encodeURIComponent(page)}`;

  useEffect(() => {
    const frame = frameRef.current;
    if (frame === null) return undefined;
    const readTheme = () => (document.body.dataset.dsDarkTheme !== undefined
      || document.body.classList.contains('data-ds-dark-theme')
      ? 'dark'
      : 'light');
    const push = () => {
      // `contentWindow` 在同源下拿得到；拿不到说明被隔离了，那就只能维持默认。
      frame.contentWindow?.postMessage({ type: 'zhiyun-pdf-theme', theme: readTheme() }, '*');
    };
    // 加载完成时补发（iframe 自己解析完才有 listener）。
    frame.addEventListener('load', push);
    // 宿主切主题时同步。观察 `data-ds-dark-theme` 与 class 两种写法。
    const observer = new MutationObserver(push);
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme', 'class'] });
    push();
    return () => {
      frame.removeEventListener('load', push);
      observer.disconnect();
    };
  }, [src]);

  return <iframe
    ref={frameRef}
    className="zs-nt-pdf"
    src={src}
    title={title}
    /* 同源（要读写主题），但不要给它 `allow-same-origin` 之外的权限。 */
    sandbox="allow-same-origin allow-scripts allow-downloads"
  />;
}

/** 标签页条。每一页带自己的 ×；右侧的 ＋ 新建一篇。 */
/** 标签页条。每一页带自己的 ×；右侧的 ＋ 新建一篇。 */
function TabStrip({ tabs, active, onPick, onClose, onCreate }) {
  return <div className="zs-nt-tabs" role="tablist">
    {tabs.map((tab) => <span key={tab.path} className={`zs-nt-tab${tab.path === active ? ' is-active' : ''}`}>
      <button type="button" role="tab" aria-selected={tab.path === active} className="zs-nt-tabname" onClick={() => onPick(tab.path)} title={tab.path}>
        {tab.title}
        {tab.dirty ? <b className="zs-nt-dot" aria-label="未保存" /> : null}
      </button>
      <button type="button" className="zs-nt-tabclose" aria-label={`关闭 ${tab.title}`} onClick={() => onClose(tab.path)}><Icon name="close" size={12} /></button>
    </span>)}
    <button type="button" className="zs-nt-tabnew" aria-label="新建笔记" title="新建笔记" onClick={() => onCreate()}><Icon name="plus" size={14} /></button>
  </div>;
}

/** 右栏：这篇笔记的操作 + 反链 / 出链 / 标签。 */
function NoteRelations({ name, markdown, backlinks, tags, graph, onOpen, onRename, onRemove, busy }) {
  const parse = useMemo(() => {
    const links = [...String(markdown).matchAll(/\[\[([^\]\n]+)\]\]/g)]
      .map((m) => m[1].split('|')[0].split('#')[0].trim())
      .filter(Boolean);
    const tagSet = new Set((String(markdown).match(/(^|[\s(【（「,，、;；:：!！?？"'“”‘’])#([\p{L}\p{N}_][\p{L}\p{N}_\-/]*)/gu) ?? [])
      .map((m) => m.replace(/^[\s(【（「,，、;；:：!！?？"'“”‘’]*#/u, '')));
    return { links: [...new Set(links)], tags: [...tagSet] };
  }, [markdown]);

  const [renameOpen, setRenameOpen] = useState(false);
  const [nextName, setNextName] = useState(name);
  useEffect(() => { setNextName(name); setRenameOpen(false); }, [name]);

  return <aside className="zs-nt-side" aria-label="链接与标签">
    <section>
      <h3>{name ? baseOf(name) : '这篇笔记'}</h3>
      {name ? <>
        <button type="button" className="zs-nt-sidebtn" disabled={busy} onClick={() => setRenameOpen((v) => !v)}>
          <Icon name="pencil" size={13} />{renameOpen ? '取消改名' : '改标题（改写全库链接）'}
        </button>
        {renameOpen && <div className="zs-nt-rename">
          <input value={nextName} onChange={(e) => setNextName(e.target.value)} aria-label="新标题" onKeyDown={(e) => { if (e.key === 'Enter' && nextName.trim()) void onRename(name, nextName.trim()); }} />
          <button className="zs-button" disabled={busy || !nextName.trim()} onClick={() => void onRename(name, nextName.trim())}>确定</button>
        </div>}
        <button type="button" className="zs-nt-sidebtn zs-nt-danger" disabled={busy} onClick={() => void onRemove(name)}>
          <Icon name="trash" size={13} />删除这篇笔记
        </button>
      </> : <p className="zs-muted">左边选一篇，或按 ＋ 新建。</p>}
    </section>

    <section>
      <h3>反向链接 <span>{backlinks.length}</span></h3>
      {backlinks.length === 0
        ? <p className="zs-muted">还没有别的笔记提到它。</p>
        : <ul className="zs-nt-refs">{backlinks.map((b, i) => <li key={`${b.from}-${i}`}>
          <button type="button" className="zs-nt-ref" onClick={() => onOpen(b.from.replace(/\.md$/i, ''))}>{b.fromTitle}</button>
        </li>)}</ul>}
    </section>

    <NoteGraph graph={graph} current={name ? `${name}.md` : ''} onOpen={(p) => onOpen(p.replace(/\.md$/i, ''))} />

    <section>
      <h3>指向 <span>{parse.links.length}</span></h3>
      {parse.links.length === 0
        ? <p className="zs-muted">还没有链接到别的笔记。</p>
        : <ul className="zs-nt-refs">{parse.links.map((target) => <li key={target}>
          <button type="button" className="zs-nt-ref" onClick={() => onOpen(target)}>{target}</button>
        </li>)}</ul>}
    </section>

    <section>
      <h3>标签 <span>{parse.tags.length}</span></h3>
      {parse.tags.length === 0
        ? <p className="zs-muted">还没有标签（写 <code>#标签</code>）。</p>
        : <p className="zs-nt-tags">{parse.tags.map((t) => <span key={t}>#{t}</span>)}</p>}
    </section>

    {tags.length > 0 && <section>
      <h3>全库标签 <span>{tags.length}</span></h3>
      <p className="zs-nt-tags">{tags.slice(0, 20).map((t) => <span key={t.tag}>{t.tag}<b>{t.count}</b></span>)}</p>
    </section>}
  </aside>;
}

/**
 * 上次挂载时的笔记库状态（模块级，跨挂载存活）。
 *
 * # 为什么必须有它
 *
 * 壳每次切页都会**卸载**当前页、再挂载目标页。而这一页挂载时要先
 * `refreshTree()` 拉整棵树、再 `openNote()` 打开第一篇 —— 期间一直停在
 * `phase === 'loading'`，整页只有一个占位。于是「切到笔记」永远要等一轮
 * 网络，哪怕数据一点没变。
 *
 * 放在模块作用域而不是 `useState`：组件卸载后模块仍在（ESM 只求值一次），
 * 所以这份值能跨挂载留下来。**它只用于首屏渲染**，挂载后照常刷新。
 */
let lastLibrary = null;

export function NotesLibrary() {
  // 有缓存时直接以它为初始值 —— 切回来第一帧就是上次的目录与当前笔记
  const [phase, setPhase] = useState(lastLibrary ? 'ready' : 'loading');
  const [entries, setEntries] = useState(() => lastLibrary?.entries ?? []);
  const [tabs, setTabs] = useState([]);
  const [active, setActive] = useState(() => lastLibrary?.active ?? null);
  const [expanded, setExpanded] = useState(() => new Set(lastLibrary?.expanded ?? []));
  const [explorerOpen, setExplorerOpen] = useState(true);
  // ⚠️ 右栏**默认收起**：宿主里这一页的可用宽度只有窗口减去它自己的侧栏，
  //    再常驻一列 250px 会把正文挤到读不下去（实测状态栏都换行了）。
  //    Obsidian 的右栏同样是默认收起的。开关在 ribbon 上，状态栏的反链数也能叫出来。
  const [rightOpen, setRightOpen] = useState(false);
  // 阅读态是**默认**：笔记大多是拿来读的，而 Markdown 源码对读者不友好。
  // 想写就按工具栏那个「编辑」。
  //
  // ⚠️ 例外只有一个：**新建笔记**后自动切到编辑态（见 createNote）。否则用户
  //    新建完看到的是一句「（空笔记）」，还得自己再点一次「编辑」才能开始写。
  const [preview, setPreview] = useState(true);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [backlinks, setBacklinks] = useState([]);
  const [allTags, setAllTags] = useState([]);
  // 全库链接图。`null` = 索引器没给，`{nodes:[],edges:[]}` = 真的没有笔记。
  const [graph, setGraph] = useState(null);
  const [history, setHistory] = useState({ stack: [], cursor: -1 });
  const [dragging, setDragging] = useState(null);
  /**
   * 待确认删除的那一条（`{ path, kind }`）；`null` = 没有。
   *
   * 删除在这里**不可撤销**（没有回收站），所以键盘删除要求一次就地确认。
   * 不做成 `window.confirm`：这个仓库统一用页面内的确认，规划页的 `confirming`
   * 就是同一做法 —— 系统弹窗在 Electron 里会被窗口样式割裂，而且无法本地化。
   */
  const [pendingDelete, setPendingDelete] = useState(null);
  /**
   * 树上"当前游标"所在的行（用于 ↑/↓ 移动）。
   *
   * 为什么不用浏览器焦点：真机实测点完树行 `activeElement` 是 `BODY`、
   * `focusin` 日志为空 —— 宿主把焦点拿走了，行按钮根本留不住焦点。
   * 所以"选中哪一行"这件事必须由我们自己持有，并且在界面上**看得见**
   * （`.is-cursor` 高亮），否则按了 ↑/↓ 用户毫无反馈。
   */
  const [treeCursor, setTreeCursorPath] = useState(null);
  const filterRef = useRef(null);
  /** 正文滚动容器（`.zs-nt-scroll`）。阅读态与编辑态共用这一个，翻页键的目标就是它。 */
  const scrollRef = useRef(null);
  /** 本页根节点：document 级键盘处理器靠它判断"我还在不在页面上"。 */
  const rootRef = useRef(null);
  /** 隐藏的 `<input type="file">`：导入 PDF 的入口。 */
  const pdfInputRef = useRef(null);
  /**
   * 最近一次交互过的树行路径（`null` = 不在树上）。
   *
   * ⚠️ 为什么不用 `document.activeElement` 判断"用户在树上"：真机实测不成立。
   *    点完树行 `activeElement` 是 `BODY`、`focusin` 日志为空 —— 宿主把焦点收走了，
   *    树行根本留不住焦点。任何以焦点为前提的键盘分派在真机上都是死的。
   *    改成记录"用户最后一次用鼠标落在哪一行"，点正文时清掉。
   *
   * 同时存一份 state（`treeCursor`）用于**可见高亮**：只记 ref 的话，按 ↑/↓
   * 移动了也没有任何视觉反馈，用户会以为键没反应。
   */
  const treeCursorRef = useRef(null);
  /**
   * 上一次滚动键的时间戳与方向（用于判断"这是不是连续操作"）。
   *
   * 存在 ref 里而不是 state：它只影响下一帧的滚动行为，不该触发重渲染 ——
   * 每按一次方向键就重渲染一次整页，代价远大于收益。
   */
  const lastScroll = useRef(null);
  // 用 ref 存"最后一次发出的正文"：定时器回调里读 state 会拿到闭包里的旧值。
  const pending = useRef(null);
  const saveTimer = useRef(null);

  const activeTab = tabs.find((t) => t.path === active) ?? null;
  const rows = useMemo(() => buildRows(entries, expanded, filter), [entries, expanded, filter]);
  const canBack = history.cursor > 0;
  const canForward = history.cursor >= 0 && history.cursor < history.stack.length - 1;

  const refreshTree = useCallback(async () => {
    const next = await notes('tree');
    const list = Array.isArray(next) ? next : [];
    setEntries(list);
    // 记下来供**下次挂载**直接用（见 `lastLibrary` 的说明）
    lastLibrary = { ...(lastLibrary ?? {}), entries: list };
    return next;
  }, []);

  /** 刷新右栏（反链 / 标签来自索引器；索引器缺席时只是空着）。 */
  const refreshSide = useCallback(async (name) => {
    if (!name) { setBacklinks([]); setAllTags([]); setGraph(null); return; }
    try {
      const [links, tags, graph] = await Promise.all([
        vault('backlinks', { path: `${name}.md` }),
        vault('tags'),
        // 图谱是**全库**的，不随当前笔记变；`null` 表示索引器没给出（不是「没有图」）。
        vault('graph').catch(() => null),
      ]);
      setBacklinks(Array.isArray(links) ? links : []);
      setAllTags(Array.isArray(tags) ? tags.slice(0, 30) : []);
      setGraph(graph && typeof graph === 'object' ? graph : null);
    } catch {
      // 索引器不可用时右侧留空，不打扰用户 —— 正文本身还能读写。
      setBacklinks([]);
      setAllTags([]);
      setGraph(null);
    }
  }, []);

  /**
   * 立刻落盘当前挂起的改动。
   *
   * ⚠️ 失败时把 job **放回** `pending`：用户敲的字还在编辑器里，只是"还没存上"，
   * 下一次自动保存或切换会再试一遍。
   */
  const flush = useCallback(async () => {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    const job = pending.current;
    if (!job) return true;
    pending.current = null;
    try {
      await notes('write', { name: job.path, markdown: job.markdown });
      setTabs((ts) => ts.map((t) => (t.path === job.path ? { ...t, dirty: false, savedAt: Date.now() } : t)));
      return true;
    } catch (error) {
      pending.current = job;
      setNotice({ tone: 'bad', text: `保存失败（改动还在编辑器里）：${error.message}` });
      return false;
    }
  }, []);

  const pushHistory = useCallback((path) => {
    setHistory((h) => {
      // 后退之后又打开新的一篇：把"未来"截掉，否则前进会走到一条已经不存在的分支。
      const stack = [...h.stack.slice(0, h.cursor + 1), path].slice(-HISTORY_LIMIT);
      return { stack, cursor: stack.length - 1 };
    });
  }, []);

  /** 打开（或切到）一篇笔记。已经开着的标签页直接激活，不重读磁盘。 */
  const openNote = useCallback(async (path, options = {}) => {
    if (!path) return;
    if (options.history !== false) pushHistory(path);
    // 展开它所在的目录，否则打开后树上看不到它。
    setExpanded((set) => new Set([...set, ...ancestorsOf(path)]));
    setActive(path);
    setNotice(null);
    setFilter('');

    const existing = tabs.find((t) => t.path === path);
    if (existing) { await refreshSide(path); return; }

    setBusy(true);
    try {
      // PDF 走另一条路：它不是文本，没有 `read` 可读，也不需要草稿与自动保存。
      // 标签项用 `kind` 区分，正文区据此决定渲染 iframe 还是编辑区。
      if (isPdfPath(path)) {
        setTabs((ts) => (ts.some((t) => t.path === path) ? ts : [...ts, {
          path, title: stripExt(baseOf(path)), kind: 'pdf', draft: '', dirty: false, savedAt: null,
        }]));
        // PDF 不进反链/图谱（索引器只认 .md），右栏如实留空。
        await refreshSide(null);
        return;
      }
      const found = await notes('read', { name: path });
      if (!found) { setNotice({ tone: 'bad', text: `没有名为「${baseOf(path)}」的笔记。` }); return; }
      setTabs((ts) => (ts.some((t) => t.path === path) ? ts : [...ts, {
        path, title: baseOf(path), kind: 'note', draft: found.markdown, dirty: false, savedAt: null,
      }]));
      await refreshSide(path);
    } catch (error) {
      setNotice({ tone: 'bad', text: `打不开这篇笔记：${error.message}` });
    } finally {
      setBusy(false);
    }
  }, [tabs, pushHistory, refreshSide]);

  // 挂载：读库，并自动打开第一篇。写在 `openNote` **之后** —— 放在前面也能跑
  // （effect 在 render 结束后才执行），但读代码的人得先往后翻才知道它调了什么。
  useEffect(() => {
    void (async () => {
      /**
       * 有缓存时：**先把上次的内容画出来，再后台刷新**。
       *
       * 缓存里的 `active` 是一个路径，正文由下面的子组件按路径读一次 ——
       * 那是单文件读取，毫秒级；整棵树的重建（`tree`）才是慢的那一步，
       * 它挪到后台，不阻塞首屏。
       */
      if (lastLibrary) {
        try {
          if (lastLibrary.active) await openNote(lastLibrary.active, { history: false });
          else await refreshSide(null);
        } catch { /* 单篇读失败不该让整页进 error */ }
        // 后台刷新目录树：失败就保持旧树，不打扰用户
        void refreshTree().catch(() => {});
        return;
      }
      try {
        const items = await refreshTree();
        setPhase('ready');
        // 按路径排序取第一篇：`tree()` 的顺序来自 `readdir`，不同机器不一样，
        // 直接取第一条会让"打开时看到哪一篇"变成随机的。
        const first = items
          .filter((e) => e.type === 'note')
          .sort((a, b) => a.path.localeCompare(b.path))[0];
        if (first) await openNote(first.path, { history: false });
        else await refreshSide(null);
      } catch (error) {
        setNotice({ tone: 'bad', text: `读不到笔记库：${error.message}` });
        setPhase('error');
      }
    })();
    // 只在挂载时跑一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * 把「当前打开的笔记」与「展开的目录」同步进模块级缓存。
   *
   * 只同步这两个 UI 位置，不碰 `tabs`：标签页里有未保存的草稿，跨挂载恢复
   * 草稿会让"上次没保存的东西"突然又出现，那是另一类意外，不做。
   */
  useEffect(() => {
    lastLibrary = { ...(lastLibrary ?? {}), active, expanded: [...expanded] };
  }, [active, expanded]);

  /** 编辑当前标签页：立刻反映到界面，800ms 后写盘。 */
  const edit = (value) => {
    if (!active) return;
    setTabs((ts) => ts.map((t) => (t.path === active ? { ...t, draft: value, dirty: true } : t)));
    pending.current = { path: active, markdown: value };
    setNotice(null);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { void (async () => {
      const ok = await flush();
      if (ok) { await refreshTree(); await refreshSide(active); }
    })(); }, AUTOSAVE_MS);
  };

  const closeTab = async (path) => {
    // 关之前先落盘：这一篇的草稿马上就不在内存里了，丢了就真丢了。
    if (pending.current?.path === path) await flush();
    const rest = tabs.filter((t) => t.path !== path);
    setTabs(rest);
    if (path === active) {
      // 关掉当前页就落到最后一个还开着的页（Obsidian 同此），没有就空着。
      const next = rest[rest.length - 1] ?? null;
      setActive(next ? next.path : null);
      if (next) await refreshSide(next.path);
    }
  };

  const createNote = async (folder = '') => {
    await flush();
    setBusy(true);
    setNotice(null);
    try {
      const made = await notes('create', { title: '新笔记', folder });
      await refreshTree();
      await openNote(made.name);
      // 新建是为了写，不是为了读：直接进编辑态，省掉一次「点编辑」。
      setPreview(false);
    } catch (error) {
      setNotice({ tone: 'bad', text: `新建失败：${error.message}` });
    } finally {
      setBusy(false);
    }
  };

  /**
   * 导入 PDF 到库里（落在当前笔记所在的文件夹）。
   *
   * # 为什么用 `<input type="file">` 而不是拖拽
   *
   * 拖拽在这个页面上已经有含义了 —— 拖动树行到文件夹是「移动」。再让「拖文件进来」
   * 也触发导入，两种拖放会互相干扰（用户拖一张 PDF 到树上是想移动还是想导入？）。
   * 文件选择器语义单一，也不会误伤现有交互。
   *
   * # 为什么读成 base64 走 RPC
   *
   * 宿主的路由只给了「按 JSON 信封收发」的通道（`connection.fetch.register`），
   * 没有 multipart 解析。PDF 走 base64 会膨胀约 33%，但换来的是：不需要在宿主侧
   * 写一个 multipart 解析器，也没有临时文件要清理。上限 64MB 由宿主再挡一次。
   *
   * @param file - `File`（来自 `<input type="file">`）。
   * @param folder - 目标文件夹（相对库根，可空）。
   */
  const importPdf = async (file, folder = '') => {
    if (!file) return;
    const ext = (file.name.split('.').pop() ?? '').toLowerCase();
    if (ext !== 'pdf') {
      setNotice({ tone: 'bad', text: `只能导入 PDF，这个文件是 .${ext}。` });
      return;
    }
    setBusy(true);
    setNotice({ tone: 'ok', text: `正在导入「${file.name}」…` });
    try {
      const base64 = await fileToBase64(file);
      const made = await notes('importAsset', {
        // 标题取文件名去掉扩展名 —— 与「标题即文件名」一致。
        title: stripExt(file.name),
        folder,
        ext: 'pdf',
        base64,
      });
      await refreshTree();
      // 导入完直接打开，用户不用再去树上找一遍。
      await openNote(made.path);
      setNotice({ tone: 'ok', text: `已导入「${made.title}」。` });
    } catch (error) {
      setNotice({ tone: 'bad', text: `导入失败：${error.message}` });
    } finally {
      setBusy(false);
    }
  };

  const createFolder = async (folder = '') => {
    setBusy(true);
    setNotice(null);
    try {
      const made = await notes('mkdir', { title: '新文件夹', folder });
      setExpanded((set) => new Set([...set, ...ancestorsOf(made.path), made.path]));
      await refreshTree();
    } catch (error) {
      setNotice({ tone: 'bad', text: `新建文件夹失败：${error.message}` });
    } finally {
      setBusy(false);
    }
  };

  /** 拖到文件夹上 = 移动（笔记改名走 rename 时才会改写全库链接）。 */
  const dropOn = async (from, toFolder) => {
    setDragging(null);
    if (!from || from === toFolder) return;
    const to = `${toFolder}/${baseOf(from)}`;
    if (from.startsWith(`${toFolder}/`)) return; // 原地不动
    await flush();
    setBusy(true);
    try {
      const result = await notes('move', { from, to });
      // 打开着的标签页要跟着换 key，否则它指向一个不存在的路径。
      setTabs((ts) => ts.map((t) => (t.path === from ? { ...t, path: to, title: baseOf(to) } : t)));
      setActive((cur) => (cur === from ? to : cur));
      if (pending.current?.path === from) pending.current = { ...pending.current, path: to };
      await refreshTree();
      if (result?.rewrote > 0) setNotice({ tone: 'ok', text: `已移动，并改写了 ${result.rewrote} 篇笔记里指向它的链接。` });
    } catch (error) {
      setNotice({ tone: 'bad', text: `移动失败：${error.message}` });
    } finally {
      setBusy(false);
    }
  };

  const rename = async (from, to) => {
    await flush();
    setBusy(true);
    setNotice(null);
    try {
      const result = await notes('rename', { from, to });
      await refreshTree();
      const moved = `${dirOf(from) === '' ? '' : `${dirOf(from)}/`}${to}`;
      setTabs((ts) => ts.map((t) => (t.path === from ? { ...t, path: moved, title: baseOf(moved) } : t)));
      setActive((cur) => (cur === from ? moved : cur));
      if (pending.current?.path === from) pending.current = { ...pending.current, path: moved };
      await openNote(moved, { history: false });
      if (result?.rewrote > 0) {
        setNotice({ tone: 'ok', text: `已改名，并改写了 ${result.rewrote} 篇笔记里指向它的链接。` });
      }
    } catch (error) {
      setNotice({ tone: 'bad', text: `改名失败：${error.message}` });
    } finally {
      setBusy(false);
    }
  };

  /**
   * 删掉一条路径（笔记 / 附件 / 文件夹）。
   *
   * ⚠️ 「删掉的不该被自动保存救回来」这条对**文件夹**同样成立，而且更危险：
   *    删一个文件夹时，里面的笔记可能在别的标签页开着，`pending.current` 里还挂着
   *    它们某一次的正文。旧代码只挡 `pending.path === path`（笔记自身路径），
   *    于是 800ms 后那次挂起的保存把 `理学/概率论` 又一个字不差地写回磁盘 ——
   *    连同刚刚被递归删掉的文件夹一起**整棵复活**。这是实测出来的形状，不是推测：
   *    探针里 `remove('理学')` 返回 `removed:true`、树变空，随后自动保存让
   *    `folder:理学, note:理学/概率论` 原样回来。
   *
   *    所以这里按**前缀**判断：被删路径是 `p` 本身，或它下面的任何一条（`p/...`），
   *    都要从挂起任务与标签页里清掉。
   *
   * @param path - `tree` 给的路径：笔记不带 `.md`，附件与文件夹是完整相对路径。
   */
  const remove = async (path) => {
    setBusy(true);
    setNotice(null);
    // 这次删除会波及哪些路径：自己 + 它下面的一切。
    const covers = (other) => other === path || other.startsWith(`${path}/`);
    try {
      if (pending.current !== null && covers(pending.current.path)) {
        pending.current = null;
        if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
      }
      const result = await notes('remove', { path });
      if (result?.removed !== true) {
        // 后端说没删到东西：如实说出来，而不是报一个假的成功。
        setNotice({ tone: 'bad', text: `没有删除任何东西：「${baseOf(path)}」可能已经不在了。` });
        await refreshTree();
        return;
      }
      setTabs((ts) => ts.filter((t) => !covers(t.path)));
      setActive((cur) => (cur !== null && covers(cur) ? null : cur));
      await refreshTree();
      if (active !== null && covers(active)) await refreshSide(null);
      // 删文件夹要说清连带了什么 —— 这是这一页唯一会顺手删掉别的文件的动作。
      const extra = result.kind === 'folder' && Number(result.contained) > 0
        ? `（含 ${result.contained} 个文件）`
        : '';
      setNotice({ tone: 'ok', text: `已删除「${baseOf(path)}」${extra}。` });
    } catch (error) {
      setNotice({ tone: 'bad', text: `删除失败：${error.message}` });
    } finally {
      setBusy(false);
    }
  };

  const walkHistory = async (step) => {
    const next = history.cursor + step;
    if (next < 0 || next >= history.stack.length) return;
    setHistory((h) => ({ ...h, cursor: next }));
    await openNote(history.stack[next], { history: false });
  };

  const toggleFolder = (path) => {
    setExpanded((set) => {
      const copy = new Set(set);
      if (copy.has(path)) copy.delete(path); else copy.add(path);
      return copy;
    });
  };

  /**
   * PageUp / PageDown / ↑ / ↓ 的四个键：滚**当前打开的笔记**。
   *
   * # 实测出来的三条事实（决定了这份实现的形状）
   *
   * 1. **不能指望浏览器原生滚动**。正文是 `.zs-nt-scroll`，它没有焦点时浏览器
   *    对 `PageDown` 毫无反应（实测焦点在 `<body>` 上按 PageDown，`scrollTop`
   *    仍是 0）。所以必须自己 `scrollBy`。
   * 2. **焦点在树行上时，这四个键归树**（B 方案）。否则用户在树里按 `↓` 想选下一篇，
   *    正文却滚走了 —— 那正是要避免的错位。
   * 3. **焦点在 `textarea` 里必须放行**。编辑态正文是一个**会自己滚**的 textarea
   *    （实测 `scrollHeight 5888 > clientHeight 420`，按 PageDown 滚的是它自己），
   *    而且 `↑/↓` 在那里是移动光标。接管它等于把人家的输入框变砖。
   *
   * # 为什么是"滚一个视口的 85%"
   *
   * `PageDown` 的语义是"翻一页但要保留衔接"。整屏滚动会丢掉上一页最后一行，
   * 读者会失去位置感；少滚一行又显得没翻动。85% 是阅读器里常见的折中。
   *
   * @param event - keydown 事件。
   * @returns 是否接管了这次按键。
   */
  const handleScrollKeys = (event) => {
    const { key } = event;
    if (key !== 'PageDown' && key !== 'PageUp' && key !== 'ArrowDown' && key !== 'ArrowUp') return false;
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;
    const target = event.target;
    if (!(target instanceof Element)) return false;
    // 输入区一律放行：原因见上面第 3 条（textarea 自己会滚，↑/↓ 是移光标）。
    if (target.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]')) return false;

    const isPage = key === 'PageDown' || key === 'PageUp';
    const step = key === 'PageDown' || key === 'ArrowDown' ? 1 : -1;

    // 焦点在树行上：↑/↓ 移焦点，PageUp/PageDown 交给树自己原生滚（A 的结论）。
    //
    // ⚠️ 真机上**不能只靠 `event.target`**：实测点完树行再点正文之后，
    //    `document.activeElement` 会是宿主的正文标题 `H2`，甚至是 `BODY`，
    //    树行永远不是 keydown 的 target。若只认 target，B 方案（树上 ↑/↓ 选笔记）
    //    在真机上等于不存在。所以补一条：**最近一次在树里按过方向键**也算在树上，
    //    由 `treeCursor`（ref）记住，任何一次点击正文/别处都会清掉它。
    const rowFromTarget = target.closest('.zs-nt-rowbtn[data-path]');
    const row = rowFromTarget ?? (treeCursorRef.current !== null
      ? rootRef.current?.querySelector(`.zs-nt-rowbtn[data-path="${CSS.escape(treeCursorRef.current)}"]`) ?? null
      : null);
    if (row !== null) {
      if (isPage) return false;           // 让浏览器滚树容器本身
      const root = row.closest('.zs-nt');
      if (root === null) return false;
      const buttons = [...root.querySelectorAll('.zs-nt-rowbtn[data-path]')];
      const at = buttons.indexOf(row);
      const next = at < 0 ? undefined : buttons[at + step];
      // 移得动就接管；移不动（已到头）也不拦，保持"没反应"的一致观感。
      if (next === undefined) return false;
      const nextPath = next.dataset.path ?? null;
      // 亮点跟着走：真机上焦点留不住，这份 state 才是用户**看得见**的"选中"。
      setTreeCursorPath(nextPath);
      treeCursorRef.current = nextPath;
      // 顺手尽力把焦点也放上去（普通浏览器上有效；真机上无效也不影响功能）。
      next.focus?.();
      event.preventDefault();
      return true;
    }

    const scroller = scrollRef.current;
    if (scroller === null) return false;
    // ↑/↓ 一次一行不够明确（行高随排版变），按"约三行"的量滚，读长文才跟得上。
    const lineStep = Math.round(parseFloat(getComputedStyle(scroller).lineHeight) || 24) * 3;
    const amount = isPage ? Math.round(scroller.clientHeight * 0.85) * step : lineStep * step;

    // ⚠️ 连续快速按键时**必须**用 `instant`，不能用 `smooth`。
    //
    // 实测（真机）：一次 `↓` 滚 63px 是舒服的，但——
    //   - 连按 10 次只走了 130px（应为 ≈630）；
    //   - 按住 1.2 秒只走了 63px，等于一次按键。
    // 原因是 `behavior:'smooth'` 会起一个约 300ms 的缓动动画，而键盘重复约 30 次/秒；
    // 每次新的 `scrollBy` 都**取消上一次动画、从当前（几乎没动的）位置重新加速**，
    // 于是按住不放反而几乎不动 —— 用户观感就是"长按变缓了"。
    //
    // 两条判据，任一条成立就走 `instant`：
    //   1. `event.repeat`：浏览器对"这次是长按自动重复"的权威回答；
    //   2. 同方向上一个滚动键发生在 `REPEAT_WINDOW_MS` 内：连敲（每次 repeat 都是
    //      false）同样会互相取消，这条把它们也归为"连续操作"。
    // 单次点按仍走 smooth，保留"轻轻一按、平滑一屏"的手感。
    const now = Date.now();
    const prev = lastScroll.current;
    const sameDirection = prev !== null && prev.key === key;
    const rapid = prev !== null && now - prev.at <= REPEAT_WINDOW_MS;
    const instant = event.repeat || (sameDirection && rapid);
    lastScroll.current = { key, at: now };
    scroller.scrollBy({ top: amount, behavior: instant ? 'instant' : 'smooth' });
    event.preventDefault();
    return true;
  };

  /**
   * Delete / Backspace：删**文件树里焦点所在的那一行**。
   *
   * # 为什么作用对象是"焦点行"而不是"当前打开的笔记"
   *
   * 删除是这一页唯一不可逆的动作。删"你刚用手指点的那个东西"是可预期的；
   * 删"你碰巧打开着的那一篇"则要用户在动手前先确认一次自己开着什么，误触代价高
   * 得多。而且行本身就是 `<button>`，点击即获得焦点 —— 不需要另造一个 `selected`
   * 状态，真正的选择就是焦点。
   *
   * # 为什么挂在容器上而不是 `document`
   *
   * 宿主里同时只有一个页面在挂载，但 `document` 上的监听在整个会话期间都可能活着
   * （effect 的清理时机不受本页控制），把别处的 Delete 也吃掉就成了全局副作用。
   * 挂在本页容器上，事件只在本页内的按键冒泡过来时才触发。
   *
   * # 三条豁免
   *
   * 1. **焦点在输入框/正文里**：那是改字符，不是删笔记 —— 直接放行（不 `preventDefault`）。
   *    笔记正文就是 `textarea`，这一条是绝对前提。
   * 2. **有修饰键**：`Ctrl/⌘+Backspace` 在输入框里是"删到行首"，别抢。
   * 3. **焦点不在树行上**：没有明确对象就不猜，什么都不做。
   */
  const onKeyDownCapture = (event) => {
    // 确认条挂着时，Esc 先撤掉它 —— 这是"我按错了"最自然的反应。
    if (event.key === 'Escape' && pendingDelete !== null) {
      event.stopPropagation();
      setPendingDelete(null);
      return;
    }
    // 滚动键先跑：它自己有完整的豁免判断，接管了就到此为止。
    if (handleScrollKeys(event)) return;
    if (event.key !== 'Delete' && event.key !== 'Backspace') return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    // 豁免：正在输入的地方。`isContentEditable` 覆盖将来换成富文本编辑器的情况。
    if (target.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]')) return;
    const row = target.closest('.zs-nt-rowbtn[data-path]');
    if (row === null) return;
    const path = row.dataset.path;
    if (!path) return;
    // 真的接管了这次按键才 preventDefault：否则浏览器层面会把它当成"返回"之类。
    event.preventDefault();
    setPendingDelete({ path, kind: row.dataset.kind ?? 'note' });
  };

  /**
   * 把键盘处理器挂到 `document` 上，**且只在本页确实存在时生效**。
   *
   * # 为什么不能挂在页面根节点上（实测）
   *
   * 读笔记时用户点的是正文，而正文不可聚焦 —— 于是 `activeElement` 落回 `<body>`。
   * 探针实测：此时按键只在 `document` 上收到，挂在 `<section>` 上的监听**一次都收不到**
   * （`<body>` 是 `<section>` 的祖先，事件不向下冒泡）。
   * 也就是说"挂在容器上"对滚动键是死的，只有焦点恰好在页内某个可聚焦元素上才有效。
   *
   * # 挂 `document` 之后怎么不越界
   *
   * 1. 用 `rootRef` 记本页根节点：卸载时置空，处理器立刻失效；
   * 2. 每次按键都问一句"焦点/事件目标是不是在本页里"。焦点在 `body` 上时用
   *    `document.contains(root)` 判"本页还在不在"—— 宿主同一时刻只挂一个页面，
   *    所以"本页存在"就等于"用户正在看这一页"。
   */
  useEffect(() => {
    const onKeyDown = (event) => {
      const root = rootRef.current;
      if (root === null) return;
      // ⚠️ 判"这一页是不是当前页"，**不能**只看 `root.contains(target)`。
      //
      // 真机实测：读笔记时 `activeElement` 是正文渲染出来的 `H2`（宿主 MarkdownText
      // 产出的标题），而 `root.contains(h2) === false` —— 那个 h2 与我们的 `<section>`
      // 不在同一棵子树里（宿主把正文切进了自己的容器）。于是"目标在我这棵树里"
      // 的判断对最常见的场景**恒为假**，handler 静默返回，按键全哑。
      //
      // 改成三层：
      //   1. 目标落在本页内部（树行、按钮、过滤框）→ 是本页；
      //   2. 目标落在正文滚动容器里，或就是它的后代 → 是本页；
      //   3. 其余情况（焦点在 h2、body、宿主容器上）→ 只要**本页此刻可见**就算本页。
      //      宿主同一时刻只挂一个页面，可见就等于用户正在看。
      const target = event.target;
      const scroller = scrollRef.current;
      const inRoot = target instanceof Node && root.contains(target);
      const inScroller = scroller !== null && target instanceof Node && scroller.contains(target);
      const visible = root.isConnected && root.getClientRects().length > 0;
      if (!inRoot && !inScroller && !visible) return;
      onKeyDownCapture(event);
    };
    document.addEventListener('keydown', onKeyDown, true);
    // 记录"用户把注意力放在哪一行"：mouse 落在树行上 → 记下；落在正文/别处 → 清掉。
    // 用 pointerdown 而不是 click：click 发生时焦点可能已经被宿主挪走了。
    const onPointerDown = (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const row = target.closest('.zs-nt-rowbtn[data-path]');
      const path = row === null ? null : (row.dataset.path ?? null);
      treeCursorRef.current = path;
      setTreeCursorPath(path);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  });

  if (phase === 'loading') return <section className="zs-nt"><p className="zs-muted">正在读取笔记库…</p></section>;
  if (phase === 'error') {
    return <section className="zs-nt">
      <Notice>{notice?.text}</Notice>
      <button className="zs-button" onClick={() => void refreshTree()}>重试</button>
    </section>;
  }

  const draft = activeTab?.draft ?? '';
  const folderOfActive = activeTab ? dirOf(activeTab.path) : '';

  return <section className="zs-nt" ref={rootRef}>
    <div className="zs-nt-work">
      {/* ribbon：最左的窄图标列 */}
      <nav className="zs-nt-ribbon" aria-label="笔记库操作">
        <button type="button" title="文件树" aria-pressed={explorerOpen} className={explorerOpen ? 'is-on' : ''} onClick={() => setExplorerOpen((v) => !v)}><Icon name="collapse" size={16} /></button>
        <button type="button" title="新建笔记" disabled={busy} onClick={() => void createNote(folderOfActive)}><Icon name="plus" size={16} /></button>
        <button type="button" title="新建文件夹" disabled={busy} onClick={() => void createFolder(folderOfActive)}><Icon name="folderPlus" size={16} /></button>
        <button type="button" title="导入 PDF" disabled={busy} onClick={() => pdfInputRef.current?.click()}><Icon name="paper" size={16} /></button>
        <button type="button" title="过滤笔记" onClick={() => { setExplorerOpen(true); filterRef.current?.focus(); }}><Icon name="search" size={16} /></button>
        <span className="zs-nt-ribbon-gap" />
        <button type="button" title="右栏" aria-pressed={rightOpen} className={rightOpen ? 'is-on' : ''} onClick={() => setRightOpen((v) => !v)}><Icon name="panelRight" size={16} /></button>
      </nav>
      {/* 隐藏的文件选择器：导入 PDF 的唯一入口（见 importPdf 里为什么不用拖拽）。
          选完立刻清空 value，否则同一个文件第二次选不会触发 onChange。 */}
      <input
        ref={pdfInputRef}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0] ?? null;
          event.target.value = '';
          if (file !== null) void importPdf(file, folderOfActive);
        }}
      />

      {explorerOpen && <aside className="zs-nt-explorer" aria-label="文件树">
        <div className="zs-nt-explorer-head">
          <button type="button" title="新建笔记" disabled={busy} onClick={() => void createNote(folderOfActive)}><Icon name="plus" size={14} /></button>
          <button type="button" title="新建文件夹" disabled={busy} onClick={() => void createFolder(folderOfActive)}><Icon name="folderPlus" size={14} /></button>
          <button type="button" title="全部折叠" onClick={() => setExpanded(new Set())}><Icon name="collapse" size={14} /></button>
          <button type="button" title="收起文件树" onClick={() => setExplorerOpen(false)}><Icon name="close" size={14} /></button>
        </div>
        <input
          ref={filterRef}
          type="search"
          className="zs-nt-filter"
          placeholder="过滤笔记"
          value={filter}
          aria-label="过滤笔记"
          onChange={(e) => setFilter(e.target.value)}
        />
        {/* 键盘删除的确认条：就地出现在文件树顶部，贴着被操作的对象。
            删除没有回收站，所以这一步不省；但也不弹系统窗 —— 见 `pendingDelete` 的说明。 */}
        {pendingDelete !== null && <div className="zs-nt-confirm" role="alertdialog" aria-label="确认删除">
          <p>
            删除「{baseOf(pendingDelete.path)}」
            {pendingDelete.kind === 'folder' ? '（含整个文件夹）' : ''}？删掉就找不回来了。
          </p>
          <div className="zs-nt-confirm-actions">
            <button
              type="button"
              className="zs-button zs-nt-danger"
              disabled={busy}
              onClick={() => {
                const target = pendingDelete.path;
                setPendingDelete(null);
                void remove(target);
              }}
            >确认删除</button>
            <button type="button" className="zs-button" onClick={() => setPendingDelete(null)}>取消</button>
          </div>
        </div>}
        {entries.length === 0
          ? <p className="zs-muted zs-nt-hint">还没有笔记。点 ＋ 开始写第一篇。</p>
          : rows.length === 0
            ? <p className="zs-muted zs-nt-hint">没有匹配「{filter.trim()}」的笔记。</p>
            : <ul
              className="zs-nt-tree"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); void dropOn(e.dataTransfer.getData('text/plain'), ''); }}
            >
              {rows.map((row) => <TreeRow
                key={row.path}
                row={row}
                current={active}
                cursor={treeCursor}
                expanded={expanded}
                onOpen={(p) => void openNote(p)}
                onToggle={toggleFolder}
                onDropOn={(from, to) => void dropOn(from, to)}
                onDragStart={setDragging}
                dragging={dragging}
              />)}
            </ul>}
      </aside>}

      <main className="zs-nt-main">
        <TabStrip
          tabs={tabs}
          active={active}
          onPick={(p) => void openNote(p)}
          onClose={(p) => void closeTab(p)}
          onCreate={() => void createNote(folderOfActive)}
        />

        {activeTab === null
          ? <div className="zs-nt-empty">
            <strong>还没有打开任何笔记</strong>
            <p>从左边选一篇，或者点标签栏的 ＋ 新建一篇。</p>
          </div>
          : <>
            <div className="zs-nt-crumbs">
              <button type="button" className="zs-nt-nav" title="后退" disabled={!canBack} onClick={() => void walkHistory(-1)}><Icon name="arrowLeft" size={14} /></button>
              <button type="button" className="zs-nt-nav" title="前进" disabled={!canForward} onClick={() => void walkHistory(1)}><Icon name="arrow" size={14} /></button>
              <span className="zs-nt-crumb-path">
                {folderOfActive !== '' ? <>{folderOfActive}<em>/</em></> : null}
                <strong>{baseOf(activeTab.path)}</strong>
              </span>
              <span className="zs-nt-crumbs-right">
                {activeTab.kind === 'pdf' ? <span className="zs-nt-saving">只读 · PDF</span> : <>
                  {activeTab.dirty
                    ? <span className="zs-nt-saving">未保存…</span>
                    : activeTab.savedAt
                      ? <span className="zs-nt-saving">已保存 {new Date(activeTab.savedAt).toLocaleTimeString('zh-CN', { hour12: false })}</span>
                      : null}
                  <button type="button" className={`zs-nt-mode${preview ? ' is-on' : ''}`} aria-pressed={preview} onClick={() => setPreview((v) => !v)}>
                    {preview ? '编辑' : '阅读'}
                  </button>
                </>}
              </span>
            </div>

            {activeTab.kind === 'pdf'
              ? <PdfViewer page={activeTab.path} title={activeTab.title}/>
              : <div className="zs-nt-scroll" ref={scrollRef}>
              <h1 className="zs-nt-title">{baseOf(activeTab.path)}</h1>
              {preview
                ? <div className="zs-nt-preview-body">
                  {draft.trim() === ''
                    ? <p className="zs-muted">（空笔记）</p>
                    // ⚠️ 不要传 `variant="compact"`。那个变体是给**聊天里夹一段短
                    //    Markdown** 用的：字号压到 13px/20px、正文用三级灰、而且
                    //    `.compact :is(h1..h6){font:inherit}` 会把标题压平、
                    //    `p/ul/ol/blockquote` 的 margin 收到 4px。用在整页长文上就是
                    //    「又小又挤、标题不起作用」，这是这页此前显得简陋的根因。
                    //    笔记正文要的是长文排版，用默认变体 + 本页的 .zs-nt-preview-body。
                    : <MarkdownText text={draft} labels={MARKDOWN_LABELS} />}
                </div>
                : <textarea
                  className="zs-nt-input"
                  value={draft}
                  spellCheck={false}
                  aria-label="笔记正文（Markdown）"
                  onChange={(e) => edit(e.target.value)}
                  placeholder={'写点什么。用 [[另一篇笔记]] 连过去，#标签 归类。'}
                />}
              </div>}
          </>}

        <div className="zs-nt-status">
          <span className="zs-nt-status-left">
            <Icon name="book" size={12} />笔记库
          </span>
          <span className="zs-nt-status-right">
            {activeTab ? <>
              <button type="button" className="zs-nt-stat" onClick={() => setRightOpen(true)}>{backlinks.length} 条反向链接</button>
              <span className="zs-nt-stat">{countWords(draft)} 个词</span>
              <span className="zs-nt-stat">{draft.length} 个字符</span>
              <button type="button" className="zs-nt-stat" onClick={() => setRightOpen(true)}>{countLinks(draft)} 条链接 · {countTags(draft)} 个标签</button>
            </> : <span className="zs-nt-stat">{entries.filter((e) => e.type === 'note').length} 篇笔记</span>}
          </span>
        </div>
      </main>

      {rightOpen && <NoteRelations
        name={active ?? ''}
        markdown={draft}
        backlinks={backlinks}
        tags={allTags}
        graph={graph}
        onOpen={(p) => void openNote(p)}
        onRename={rename}
        onRemove={remove}
        busy={busy}
      />}
    </div>

    <Notice>{notice?.tone === 'bad' ? notice.text : ''}</Notice>
    {notice?.tone === 'ok' && <p className="zs-nt-note-ok">{notice.text}</p>}
  </section>;
}
