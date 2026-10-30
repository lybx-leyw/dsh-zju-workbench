import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Empty, Icon } from 'dsh-zhiyun-shell-ui';
import { AssistantDrawer } from './AssistantDrawer.jsx';
import { ReaderFrame } from './ReaderFrame.jsx';
import { createTopic, loadPaper, loadTranslateState, transcribePaper, translateSelection, uploadPaper } from './library.js';
import { PaperTree, ancestorsOf } from './PaperTree.jsx';
import { RenameDialog } from './RenameDialog.jsx';

/**
 * 「论文」页：左边读 PDF，右边是对着这篇文献说话的 AI 抽屉。
 *
 * 三块拼装：
 *   - `PaperTree`：左侧栏的论文库文件树（栏头就是导入/新建/折叠/收起）；
 *   - `ReaderFrame`：同源 iframe 承载上游阅读器（pdf.js + 可选中文本层 + 选中即译浮层）；
 *   - `AssistantDrawer`：右侧抽屉，订阅上游的会话 SSE。
 *
 * 阅读器里链接到别处（或抽屉里点页码）都只用页内状态跳转，不刷整页 ——
 * iframe 换 src 会重建 pdf.js，代价高；所以用 `reloadKey` 触发重挂载。
 */

const LAST_KEY = 'zhiyun.paper.last';

function readLast() {
  try {
    const raw = globalThis.localStorage?.getItem(LAST_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed.topic === 'string' && typeof parsed.name === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

function writeLast(value) {
  try { globalThis.localStorage?.setItem(LAST_KEY, JSON.stringify(value)); } catch { /* 隐私模式就算了 */ }
}

/**
 * `topic` → 多级路径（`理学+力学` → `理学/力学`）。
 *
 * ⚠️ 页面必须自己有一份：宿主侧的 `paper-tree.js` 是 **node** 模块
 * （用 `node:fs/promises`），客户端 bundle 不能 import 它。
 *
 * 规则必须与宿主**逐字一致**（`%`→`%25`、`+`→`%2B`，段间 `+`），
 * 否则树的高亮会错位 —— 而错位不会报错，只会让"当前打开的那篇"不高亮，
 * 是最难注意到的一类不一致。`tests/paper-tree.test.mjs` 与
 * `tests/paper-tree-collapse.test.mjs` 一起守着这条。
 */
function decodeTopic(topic) {
  return String(topic ?? '')
    .split('+')
    .map((segment) => segment.replace(/%2B/g, '+').replace(/%25/g, '%'))
    .join('/');
}

/** 树栏展开状态的键。收起是用户的长期偏好，不该每次切页就重置。 */
const TREE_OPEN_KEY = 'zhiyun.paper.treeOpen';

function readTreeOpen() {
  try {
    // 没存过就是展开（首次进入要看得到库里有什么）。
    return globalThis.localStorage?.getItem(TREE_OPEN_KEY) !== '0';
  } catch {
    return true;
  }
}

function writeTreeOpen(open) {
  try { globalThis.localStorage?.setItem(TREE_OPEN_KEY, open ? '1' : '0'); } catch { /* 隐私模式就算了 */ }
}

export function Paper({ controller }) {
  const [paper, setPaper] = useState(readLast);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [cornellOpen, setCornellOpen] = useState(false);
  const [selection, setSelection] = useState(null);
  const [jump, setJump] = useState(null); // { page, q, key }
  const [meta, setMeta] = useState(null);
  const [transcript, setTranscript] = useState(null);
  const readerApiRef = useRef(null);
  // 论文库的文件树（多级）。`entries` 是扁平表，层级由 `PaperTree` 按 `/` 还原。
  const [tree, setTree] = useState([]);
  const [treeError, setTreeError] = useState(null);
  const [treeBusy, setTreeBusy] = useState(false);
  const [expanded, setExpanded] = useState(() => new Set());
  /** 树的过滤词（栏头下方的搜索框）。 */
  const [treeFilter, setTreeFilter] = useState('');
  /** 键盘游标：Delete / F2 作用在它上面（先选中、再操作）。 */
  const [treeCursor, setTreeCursor] = useState(null);
  /** 等待确认删除的行（Delete 不直接删，见键盘分派的说明）。 */
  const [pendingDelete, setPendingDelete] = useState(null);
  /** 正在重命名的行：`{ path, title }`。输入框 portal 到 body，见 RenameDialog。 */
  const [renaming, setRenaming] = useState(null);
  /** 隐藏的文件选择器：栏头「导入 PDF」用它。 */
  const paperInputRef = useRef(null);
  /**
   * 树栏是否展开。
   *
   * 默认展开：第一次进这一页时，用户需要看到库里有什么。收起是**用户主动的选择**，
   * 所以之后要记住它（见 `TREE_OPEN_KEY`），否则每次切页回来都会被重新撑开，
   * 那对"我想专心读 PDF"的人是持续的干扰。
   */
  const [treeOpen, setTreeOpen] = useState(readTreeOpen);

  const pick = useCallback((next) => {
    // 展开到这篇文献所在的目录：页头下拉切换、或从树里打开，都要让树上看得见它。
    const relPath = [decodeTopic(next.topic), `${next.name}.pdf`].filter(Boolean).join('/');
    setExpanded((set) => new Set([...set, ...ancestorsOf(relPath)]));
    setPaper({ topic: next.topic, name: next.name });
    setSelection(null);
    setJump(null);
    setMeta(null);
    setTranscript(null);
    writeLast({ topic: next.topic, name: next.name });
  }, []);

  // 打开一篇文献就顺手读一次元信息（页数 / 是否已转录）与译文状态。
  useEffect(() => {
    if (!paper) return undefined;
    let live = true;
    loadPaper(paper.topic, paper.name).then(
      (value) => { if (live) setMeta(value); },
      () => { if (live) setMeta(null); },
    );
    loadTranslateState(paper.topic, paper.name).then(
      (value) => { if (live) setTranscript(value); },
      () => { if (live) setTranscript(null); },
    );
    return () => { live = false; };
  }, [paper]);

  // 跨窗口进来的 `zhiyun.paper.open`（例如从「问一问」的回答里点链接）也接住。
  useEffect(() => {
    const onMessage = (event) => {
      const data = event?.data;
      if (!data || data.type !== 'zhiyun.paper.open') return;
      if (typeof data.topic !== 'string' || typeof data.name !== 'string') return;
      pick({ topic: data.topic, name: data.name });
      if (data.page) setJump({ page: Number(data.page), q: data.q, key: Date.now() });
    };
    globalThis.addEventListener?.('message', onMessage);
    return () => globalThis.removeEventListener?.('message', onMessage);
  }, [pick]);

  const jumpToPage = useCallback((page, q) => {
    if (!Number.isFinite(page) || page < 1) return;
    const api = readerApiRef.current;
    if (api?.jumpTo) { api.jumpTo(page, q); return; }
    // 阅读器还没就绪（或用户刚切论文）：记下来，等 `load` 后补跳。
    setJump({ page, q, key: Date.now() });
  }, []);

  const askAbout = useCallback((payload) => {
    setSelection(payload);
    setDrawerOpen(true);
  }, []);

  // 选中即译的出口。走本包自己的 `/api/translate`（宿主 llm + 内存缓存），
  // 不是上游的整篇翻译端点 —— 两者共用设置里的同一个端点配置，但请求路径不同。
  const translate = useCallback((text, signal) => translateSelection(text, signal), []);

  const onTranscribe = useCallback(async () => {
    if (!paper) return;
    setTranscript((current) => ({ ...(current ?? {}), busy: true }));
    try {
      const result = await transcribePaper(paper.topic, paper.name);
      setTranscript({ ...result, busy: false });
    } catch (error) {
      setTranscript((current) => ({ ...(current ?? {}), busy: false, error: error instanceof Error ? error.message : String(error) }));
    }
  }, [paper]);

  /** 重读论文库的树。 */
  const refreshTree = useCallback(async () => {
    setTreeBusy(true);
    setTreeError(null);
    try {
      const response = await fetch('/zhiyun-paper/api/tree');
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? `HTTP ${response.status}`);
      const entries = Array.isArray(body?.entries) ? body.entries : [];
      setTree(entries);
      return entries;
    } catch (error) {
      setTreeError(error instanceof Error ? error.message : String(error));
      return [];
    } finally {
      setTreeBusy(false);
    }
  }, []);

  // 挂载时读一次；之后只在用户手动刷新或导入后才重读（目录树不会自己变）。
  useEffect(() => { void refreshTree(); }, [refreshTree]);

  /** 打开树里的一篇文献：把多级路径交给宿主换算成上游坐标。 */
  const openFromTree = useCallback(async (row) => {
    try {
      const response = await fetch(`/zhiyun-paper/api/ref?path=${encodeURIComponent(row.path)}`);
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? `HTTP ${response.status}`);
      // 顺手展开它所在的目录，否则打开后树上看不到它。
      setExpanded((set) => new Set([...set, ...ancestorsOf(row.path)]));
      pick({ topic: body.topic, name: body.name });
    } catch (error) {
      setTreeError(error instanceof Error ? error.message : String(error));
    }
  }, [pick]);

  /**
   * 上传或新建文件夹之后：
   *   1. 重读树（它是另一份数据源，读盘，不重读就看不到新文件）；
   *   2. 把目标文件夹展开，否则新文件藏在折叠的目录里，用户以为没传上去。
   */
  const handleUploaded = useCallback(async ({ folder }) => {
    await refreshTree();
    if (typeof folder === 'string' && folder !== '') {
      setExpanded((set) => new Set([...set, ...ancestorsOf(`${folder}/x`), folder]));
    }
  }, [refreshTree]);

  /**
   * 上传 PDF 到**当前选中的文件夹**（或库根）。
   *
   * 走上游的 `/api/library/upload`：原始字节 + `x-dpr-topic` / `x-dpr-name` 头。
   * 上游的 topic 只能是单段目录名，所以深层路径要先经 `/api/ref` 编码 ——
   * 编码规则只在宿主侧一份，页面不复刻。
   *
   * @param files - `FileList`。
   */
  const uploadPapers = useCallback(async (files) => {
    const list = [...(files ?? [])].filter((f) => f.name.toLowerCase().endsWith('.pdf'));
    if (list.length === 0) { setTreeError('只支持 PDF 文件'); return; }
    setTreeBusy(true);
    setTreeError(null);
    try {
      for (const file of list) {
        // 传到「当前打开文献所在的文件夹」；没有打开的就放库根。
        const folder = paper ? decodeTopic(paper.topic) : '';
        let topic = '';
        if (folder !== '') {
          const response = await fetch(`/zhiyun-paper/api/ref?path=${encodeURIComponent(`${folder}/x.pdf`)}`);
          const ref = await response.json().catch(() => null);
          if (!response.ok) throw new Error(ref?.error ?? `HTTP ${response.status}`);
          topic = ref.topic;
        }
        const bytes = new Uint8Array(await file.arrayBuffer());
        const uploaded = await uploadPaper({ topic, name: file.name, bytes });
        // 新的坐标交给 pick：上传完直接打开它，用户不用再去树上找。
        if (uploaded?.name) {
          pick({ topic: uploaded.topic, name: uploaded.name });
        }
      }
      await refreshTree();
    } catch (error) {
      setTreeError(error instanceof Error ? error.message : String(error));
    } finally {
      setTreeBusy(false);
    }
  }, [paper, pick, refreshTree]);

  /**
   * 新建文件夹（栏头的 folderPlus 按钮）。
   *
   * 建在**当前打开的文献所在目录**下；没打开就建在库根。
   * 名字先给一个默认值，用户可以马上在树上看到它 —— 与笔记库的
   * 「新建文件夹 → 直接出现一个"新文件夹"」同一手感（那边也没做命名弹窗）。
   */
  const createPaperFolder = useCallback(async () => {
    setTreeBusy(true);
    setTreeError(null);
    try {
      const parent = paper ? decodeTopic(paper.topic) : '';
      // 先问宿主当前有哪些目录，推一个不重名的默认名。
      const existing = new Set(tree.filter((e) => e.type === 'folder').map((e) => e.path));
      let name = '新文件夹';
      for (let n = 2; n < 100; n += 1) {
        const candidate = parent === '' ? name : `${parent}/${name}`;
        if (!existing.has(candidate)) break;
        name = `新文件夹 ${n}`;
      }
      const relDir = parent === '' ? name : `${parent}/${name}`;
      // 上游建 topic 的能力是 `/api/library/topic`，但它只收单段名 ——
      // 所以深层路径仍旧要走编码。
      const response = await fetch(`/zhiyun-paper/api/ref?path=${encodeURIComponent(`${relDir}/x.pdf`)}`);
      const ref = await response.json().catch(() => null);
      if (!response.ok) throw new Error(ref?.error ?? `HTTP ${response.status}`);
      await createTopic(ref.topic);
      await refreshTree();
      setExpanded((set) => new Set([...set, ...ancestorsOf(`${relDir}/x`), relDir]));
    } catch (error) {
      setTreeError(error instanceof Error ? error.message : String(error));
    } finally {
      setTreeBusy(false);
    }
  }, [paper, tree, refreshTree]);

  /**
   * 把树上的路径换算成上游坐标（`{topic, name}`）。
   * @param relPath - 形如 `理学/力学/讲义.pdf`。
   */
  const refForPath = useCallback(async (relPath) => {
    const response = await fetch(`/zhiyun-paper/api/ref?path=${encodeURIComponent(relPath)}`);
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.error ?? `HTTP ${response.status}`);
    return body;
  }, []);

  /**
   * 删除一条文献或一个文件夹。
   *
   * ⚠️ 这是**不可逆**的，而且删文献会**连带**删掉它的 `.txt` / `.pages.json` /
   *    `-zh.pdf` / `-dual.pdf` / `.study.json`（上游 `PAPER_SIDECARS`）——
   *    转录、译文、学习档案都会一起没。所以必须确认，不能按一下就删。
   *
   * @param row - 树上的行（`{ type, path }`）。
   */
  const removeRow = useCallback(async (row) => {
    setTreeBusy(true);
    setTreeError(null);
    try {
      if (row.type === 'folder') {
        const ref = await refForPath(`${row.path}/x.pdf`);
        const response = await fetch('/paper-reader/api/library/delete-topic', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ topic: ref.topic }),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(body?.error ?? `HTTP ${response.status}`);
      } else {
        const ref = await refForPath(row.path);
        const response = await fetch('/paper-reader/api/library/delete-paper', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ topic: ref.topic, name: ref.name }),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(body?.error ?? `HTTP ${response.status}`);
        // 删的正是当前打开的那篇 → 退回空态，别让阅读器指着已不存在的文件。
        if (paper !== null && ref.topic === paper.topic && ref.name === paper.name) {
          setPaper(null);
          try { globalThis.localStorage?.removeItem(LAST_KEY); } catch { /* 隐私模式 */ }
        }
      }
      setTreeCursor(null);
      await refreshTree();
    } catch (error) {
      setTreeError(error instanceof Error ? error.message : String(error));
    } finally {
      setTreeBusy(false);
    }
  }, [paper, refForPath, refreshTree]);

  /**
   * 改名（F2）。
   *
   * 文献改名会**连带**改掉派生文件名（上游 `renamePaper` 逐个跟随），
   * 所以译文/转录/学习档案不会失联 —— 这一点比自己拼路径 rename 可靠。
   *
   * @param row - 树上的行。
   * @param next - 用户输入的新名字（不含扩展名）。
   */
  const renameRow = useCallback(async (row, next) => {
    const name = String(next ?? '').trim();
    if (name === '') return;
    const oldTitle = row.title ?? row.path.split('/').pop();
    if (name === oldTitle) return;
    setTreeBusy(true);
    setTreeError(null);
    try {
      const ref = await refForPath(row.path);
      if (row.type === 'folder') {
        const response = await fetch('/paper-reader/api/library/rename-topic', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ topic: ref.topic, to: name }),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(body?.error ?? `HTTP ${response.status}`);
      } else {
        const response = await fetch('/paper-reader/api/library/rename-paper', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ topic: ref.topic, name: ref.name, to: name }),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(body?.error ?? `HTTP ${response.status}`);
        // 改的是当前打开的那篇 → 同步 `paper`，否则阅读器还指着旧名。
        if (paper !== null && ref.topic === paper.topic && ref.name === paper.name) {
          pick({ topic: ref.topic, name });
        }
      }
      await refreshTree();
      // 游标跟着走：改完名后用户往往还要接着操作这一行。
      const parent = row.path.slice(0, row.path.lastIndexOf('/') + 1);
      setTreeCursor(row.type === 'folder' ? `${parent}${name}` : `${parent}${name}.pdf`);
    } catch (error) {
      setTreeError(error instanceof Error ? error.message : String(error));
    } finally {
      setTreeBusy(false);
    }
  }, [paper, pick, refForPath, refreshTree]);

  const toggleFolder = useCallback((path) => {
    setExpanded((set) => {
      const next = new Set(set);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }, []);

  /**
   * Delete / F2 的键盘分派。
   *
   * # 作用对象是**树上游标**，不是"当前打开的文献"
   *
   * 删除与改名都是"针对某个具体文件"的动作。用游标（用户刚点过的那一行）
   * 比用"碰巧打开着的那篇"可预期得多 —— 与笔记库同一套心智。
   *
   * # 三条豁免（缺一条都会出事）
   *
   * 1. **焦点在输入区**：改名输入框、过滤框里按 Delete 是改字符，不能拦。
   * 2. **有修饰键**：`Ctrl/⌘+Backspace` 是"删到行首"，别抢。
   * 3. **没有游标**：没有明确对象就不猜。
   *
   * # Delete 不直接删
   *
   * 删文献会连带删掉转录/译文/学习档案（上游 `PAPER_SIDECARS`），不可逆。
   * 所以先弹一次就地确认；F2 则直接进重命名（改名可再改回，代价小）。
   */
  useEffect(() => {
    const onKeyDown = (event) => {
      // 重命名 / 确认条挂着时，Esc 先撤掉它们。
      if (event.key === 'Escape' && (pendingDelete !== null || renaming !== null)) {
        setPendingDelete(null);
        setRenaming(null);
        return;
      }
      const target = event.target;
      if (!(target instanceof Element)) return;
      // 豁免 1：输入区
      if (target.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]')) return;
      // 豁免 2：修饰键
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      // 豁免 3：没有游标
      if (treeCursor === null) return;
      const row = tree.find((entry) => entry.path === treeCursor);
      if (row === undefined) return;

      if (event.key === 'F2') {
        event.preventDefault();
        setPendingDelete(null);
        // 进重命名态。输入框由 `RenameDialog` 渲染 —— 它 **portal 到 body**，
        // 见那个组件顶部的说明（工作台内部拿不到焦点）。
        setRenaming({ path: row.path, title: row.title ?? String(row.path).split('/').pop() });
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        setPendingDelete({ path: row.path, type: row.type, title: row.title });
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  });

  /**
   * 重命名对话框。它自己 portal 到 `document.body` —— 工作台内部是 `inert` 的，
   * 里面任何输入框都拿不到焦点（见 `RenameDialog.jsx` 顶部的证据链）。
   */
  const renameDialog = <RenameDialog
    open={renaming !== null}
    initial={renaming?.title ?? ''}
    onSubmit={(next) => {
      const row = renaming === null ? null : tree.find((entry) => entry.path === renaming.path);
      setRenaming(null);
      if (row !== undefined && row !== null) void renameRow(row, next);
    }}
    onCancel={() => setRenaming(null)}
  />;

  const treeNode = <PaperTree
    entries={tree}
    // 树的路径是**解码后**的多级路径，而 `paper.topic` 是编码过的目录名，
    // 直接拼会永远匹配不上（高亮消失，但不报错）。
    // 树的 `row.path` **带 `.pdf`**，而 `paper.name` 去掉了扩展名。
    current={paper ? [decodeTopic(paper.topic), `${paper.name}.pdf`].filter(Boolean).join('/') : null}
    expanded={expanded}
    filter={treeFilter}
    onFilter={setTreeFilter}
    onToggle={toggleFolder}
    onOpen={(row) => void openFromTree(row)}
    // 栏头四个按钮：与笔记库同一排。上传/新建都在栏内完成，
    // 用户不必离开这棵树去页头找入口。
    onUploadClick={() => paperInputRef.current?.click()}
    onNewFolder={() => void createPaperFolder()}
    onCollapseAll={() => setExpanded(new Set())}
    onCollapse={() => {
      setTreeOpen((open) => {
        writeTreeOpen(!open);
        return !open;
      });
    }}
    cursor={treeCursor}
    onCursor={setTreeCursor}
    busy={treeBusy}
    error={treeError}
  />;

  /**
   * 树栏（收起时只剩窄条）。
   *
   * 收起后**不是完全消失**：留一个 28px 的窄条，上面有展开按钮。
   * 如果整栏拔掉，用户就找不到把它叫回来的入口了。
   */
  const treePane = <aside
    className={`zp-tree-pane${treeOpen ? '' : ' is-collapsed'}`}
    aria-label="论文库"
    aria-expanded={treeOpen}
  >
    {treeOpen
      ? <>
        {/* 删除确认条：删文献会连带删掉转录/译文/学习档案，不可逆，所以必须确认。 */}
        {pendingDelete !== null && <div className="zp-tree-confirm" role="alertdialog" aria-label="确认删除">
          <p>
            删除「{pendingDelete.title ?? pendingDelete.path.split('/').pop()}」
            {pendingDelete.type === 'folder' ? '（含其中全部文献）' : '（连同转录与译文）'}？找不回来了。
          </p>
          <div className="zp-tree-confirm-actions">
            <button
              type="button"
              className="zp-tree-danger"
              disabled={treeBusy}
              onClick={() => {
                const row = tree.find((entry) => entry.path === pendingDelete.path);
                setPendingDelete(null);
                if (row !== undefined) void removeRow(row);
              }}
            >确认删除</button>
            <button type="button" onClick={() => setPendingDelete(null)}>取消</button>
          </div>
        </div>}
        {treeNode}
      </>
      : <button
        type="button"
        className="zp-tree-toggle"
        onClick={() => {
          setTreeOpen((open) => {
            writeTreeOpen(!open);
            return !open;
          });
        }}
        title="展开论文库"
        aria-label="展开论文库"
      >
        <Icon name="arrow" size={13} />
      </button>}
  </aside>;

  // 隐藏的文件选择器：栏头「导入 PDF」的唯一落点。
  // 选完清空 value，否则同一个文件第二次选不会触发 onChange。
  const paperFileInput = <input
    ref={paperInputRef}
    type="file"
    accept="application/pdf,.pdf"
    multiple
    hidden
    onChange={(event) => {
      const files = event.target.files;
      event.target.value = '';
      void uploadPapers(files);
    }}
  />;

  if (!paper) {
    return <div className={`zp-page zp-page-with-tree${treeOpen ? '' : ' is-tree-collapsed'}`}>
      {treePane}
      {paperFileInput}
      {renameDialog}
      <div className="zp-landing">
        <Empty icon="paper" title="还没有打开文献">
          {/* 入口统一在左边栏头（＋ 导入 PDF），这里只指路，不再放第二个上传按钮。 */}
          <p>左边栏头点 ＋ 导入 PDF。选中英文会自动翻译，右侧抽屉可以就着这一段提问。</p>
        </Empty>
      </div>
    </div>;
  }

  const pages = meta?.pageCount ? `${meta.pageCount} 页` : '页数未知';
  const transcribed = meta?.hasTranscript ?? transcript?.hasTranscript;

  return <div className={`zp-page${drawerOpen ? ' is-drawer-open' : ''} zp-page-with-tree${treeOpen ? '' : ' is-tree-collapsed'}`}>
    {treePane}
    {paperFileInput}
    {renameDialog}
    <div className="zp-main">
      <div className="zp-bar">
        <button type="button" className="zp-cornell-toggle" aria-expanded={cornellOpen}
          onClick={() => setCornellOpen((value) => !value)} title="展开或收起康奈尔笔记">
          {cornellOpen ? '‹' : '›'} 康奈尔笔记
        </button>
        {/* 页头不再放文献库下拉：打开/上传/新建都在左侧树栏里，
            两套入口会让人不知道该用哪个。 */}
        <span className="zp-bar-meta">{pages}{transcribed ? ' · 已转录' : ''}</span>
        <div className="zp-bar-actions">
          <button type="button" onClick={onTranscribe} disabled={transcript?.busy} title="转录成文本，让检索与问答能定位到原文">
            <Icon name="layers" size={15}/>{transcript?.busy ? '转录中…' : transcribed ? '重新转录' : '转录'}
          </button>
          <button type="button" className={drawerOpen ? 'is-primary' : undefined} onClick={() => setDrawerOpen((value) => !value)} title="展开或收起 AI 助手">
            <Icon name="chat" size={15}/>AI 助手
          </button>
          {controller && <button type="button" onClick={() => controller.navigate('ask')} title="去「问一问」继续这段对话">
            <Icon name="arrow" size={15}/>问一问
          </button>}
        </div>
      </div>

      {transcript?.error && <div className="zp-bar-error">{transcript.error}</div>}

      <ReaderFrame
        key={JSON.stringify([paper.topic, paper.name])}
        cornellOpen={cornellOpen}
        topic={paper.topic}
        name={paper.name}
        page={jump?.page}
        q={jump?.q}
        reloadKey={jump?.key}
        translate={translate}
        onAskAbout={askAbout}
        registerApi={(api) => {
          readerApiRef.current = api;
          if (api && jump?.page) api.jumpTo?.(jump.page, jump.q);
        }}
      />
    </div>

    <AssistantDrawer
      topic={paper.topic}
      name={paper.name}
      open={drawerOpen}
      onToggle={() => setDrawerOpen((value) => !value)}
      selection={selection}
      onSelectionConsumed={() => setSelection(null)}
      onJumpToPage={(page) => jumpToPage(page)}
    />
  </div>;
}
