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
const AUTOSAVE_MS = 800;
/** 历史栈上限：够来回找，又不会把内存当日记本。 */
const HISTORY_LIMIT = 60;

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
function TreeRow({ row, current, expanded, onOpen, onToggle, onDropOn, onDragStart, dragging }) {
  const isFolder = row.type === 'folder';
  const isOpen = isFolder && expanded.has(row.path);
  return <li
    className={`zs-nt-row${row.path === current ? ' is-current' : ''}${isOpen ? ' is-expanded' : ''}${dragging === row.path ? ' is-dragging' : ''}`}
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
  const [preview, setPreview] = useState(false);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [backlinks, setBacklinks] = useState([]);
  const [allTags, setAllTags] = useState([]);
  // 全库链接图。`null` = 索引器没给，`{nodes:[],edges:[]}` = 真的没有笔记。
  const [graph, setGraph] = useState(null);
  const [history, setHistory] = useState({ stack: [], cursor: -1 });
  const [dragging, setDragging] = useState(null);
  const filterRef = useRef(null);
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
      const found = await notes('read', { name: path });
      if (!found) { setNotice({ tone: 'bad', text: `没有名为「${baseOf(path)}」的笔记。` }); return; }
      setTabs((ts) => (ts.some((t) => t.path === path) ? ts : [...ts, {
        path, title: baseOf(path), draft: found.markdown, dirty: false, savedAt: null,
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
    } catch (error) {
      setNotice({ tone: 'bad', text: `新建失败：${error.message}` });
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

  const remove = async (path) => {
    setBusy(true);
    setNotice(null);
    try {
      // 删掉的文件不该再由自动保存救回来：先把挂起的任务摘掉。
      if (pending.current?.path === path) pending.current = null;
      await notes('remove', { path });
      setTabs((ts) => ts.filter((t) => t.path !== path));
      setActive((cur) => (cur === path ? null : cur));
      await refreshTree();
      await refreshSide(null);
      setNotice({ tone: 'ok', text: `已删除「${baseOf(path)}」。` });
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

  if (phase === 'loading') return <section className="zs-nt"><p className="zs-muted">正在读取笔记库…</p></section>;
  if (phase === 'error') {
    return <section className="zs-nt">
      <Notice>{notice?.text}</Notice>
      <button className="zs-button" onClick={() => void refreshTree()}>重试</button>
    </section>;
  }

  const draft = activeTab?.draft ?? '';
  const folderOfActive = activeTab ? dirOf(activeTab.path) : '';

  return <section className="zs-nt">
    <div className="zs-nt-work">
      {/* ribbon：最左的窄图标列 */}
      <nav className="zs-nt-ribbon" aria-label="笔记库操作">
        <button type="button" title="文件树" aria-pressed={explorerOpen} className={explorerOpen ? 'is-on' : ''} onClick={() => setExplorerOpen((v) => !v)}><Icon name="collapse" size={16} /></button>
        <button type="button" title="新建笔记" disabled={busy} onClick={() => void createNote(folderOfActive)}><Icon name="plus" size={16} /></button>
        <button type="button" title="新建文件夹" disabled={busy} onClick={() => void createFolder(folderOfActive)}><Icon name="folderPlus" size={16} /></button>
        <button type="button" title="过滤笔记" onClick={() => { setExplorerOpen(true); filterRef.current?.focus(); }}><Icon name="search" size={16} /></button>
        <span className="zs-nt-ribbon-gap" />
        <button type="button" title="右栏" aria-pressed={rightOpen} className={rightOpen ? 'is-on' : ''} onClick={() => setRightOpen((v) => !v)}><Icon name="panelRight" size={16} /></button>
      </nav>

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
                {activeTab.dirty
                  ? <span className="zs-nt-saving">未保存…</span>
                  : activeTab.savedAt
                    ? <span className="zs-nt-saving">已保存 {new Date(activeTab.savedAt).toLocaleTimeString('zh-CN', { hour12: false })}</span>
                    : null}
                <button type="button" className={`zs-nt-mode${preview ? ' is-on' : ''}`} aria-pressed={preview} onClick={() => setPreview((v) => !v)}>
                  {preview ? '编辑' : '阅读'}
                </button>
              </span>
            </div>

            <div className="zs-nt-scroll">
              <h1 className="zs-nt-title">{baseOf(activeTab.path)}</h1>
              {preview
                ? <div className="zs-nt-preview-body">
                  {draft.trim() === ''
                    ? <p className="zs-muted">（空笔记）</p>
                    : <MarkdownText text={draft} labels={MARKDOWN_LABELS} variant="compact" />}
                </div>
                : <textarea
                  className="zs-nt-input"
                  value={draft}
                  spellCheck={false}
                  aria-label="笔记正文（Markdown）"
                  onChange={(e) => edit(e.target.value)}
                  placeholder={'写点什么。用 [[另一篇笔记]] 连过去，#标签 归类。'}
                />}
            </div>
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
