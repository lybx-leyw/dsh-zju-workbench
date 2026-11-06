/**
 * 论文页的**多级文件树**（左侧栏）。
 *
 * # 这是照抄笔记库那棵树，不是"像素对齐"
 *
 * 笔记库（`dsh-zhiyun-page-notes`）的树栏结构是：
 *
 *     ┌─ 栏头：一排 26×26 图标按钮（新建 / 新建文件夹 / 全部折叠 / 收起）
 *     ├─ 过滤框
 *     └─ 树（文件夹可折叠、任意层级）
 *
 * **操作就在栏里**：用户不必离开这棵树去别处找"上传"。
 * 论文页最初把上传放在页头的下拉面板里，栏内只有一个"导入 PDF"文字按钮 ——
 * 那不是同一个交互模型，是两套。
 *
 * # 与上游的关系
 *
 * 上游只认 `topic/name` 两段式，所以磁盘上深层路径编码进单段目录名
 * （`理学/力学` → `理学+力学`）。这里拿到的是 `/api/tree` 给的**已解码**路径，
 * 用户看不到 `+`；编码只发生在宿主侧（`/api/ref`），页面不复刻规则。
 */
import React, { useMemo } from 'react';
import { Icon } from 'dsh-zhiyun-shell-ui';

/** 相对路径的目录部分（不含结尾斜杠）；顶层给空串。 */
function dirOf(rel) {
  const slash = String(rel).lastIndexOf('/');
  return slash === -1 ? '' : String(rel).slice(0, slash);
}

/** 最后一段。 */
function baseOf(rel) {
  const slash = String(rel).lastIndexOf('/');
  return slash === -1 ? String(rel) : String(rel).slice(slash + 1);
}

/**
 * 把扁平条目表拼成树的行。
 *
 * 与笔记库的 `buildRows` 同一套规则（文件夹在前、同级按名称排序、
 * 折叠的文件夹不出子孙）。过滤时退化成扁平命中列表。
 */
export function buildTreeRows(entries, expanded, filter) {
  const query = String(filter ?? '').trim().toLowerCase();

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
  for (const list of children.values()) {
    list.sort((a, b) => (a.type === 'folder' ? 0 : 1) - (b.type === 'folder' ? 0 : 1)
      || baseOf(a.path).localeCompare(baseOf(b.path)));
  }

  const rows = [];
  const walk = (parent, depth) => {
    for (const entry of children.get(parent) ?? []) {
      rows.push({ ...entry, depth });
      if (entry.type === 'folder' && expanded.has(entry.path)) walk(entry.path, depth + 1);
    }
  };
  walk('', 0);
  return rows;
}

/** 一个路径的祖先目录链（打开文件时自动展开它所在的目录）。 */
export function ancestorsOf(rel) {
  const parts = String(rel).split('/').slice(0, -1);
  const out = [];
  let acc = '';
  for (const part of parts) {
    acc = acc === '' ? part : `${acc}/${part}`;
    out.push(acc);
  }
  return out;
}

/**
 * 树本身（含栏头操作、过滤框）。
 *
 * @param props.entries - 扁平条目表。
 * @param props.current - 当前打开的文献路径。
 * @param props.expanded - 展开集合。
 * @param props.filter - 过滤词。
 * @param props.onToggle - 展开/折叠文件夹。
 * @param props.onOpen - 打开一篇文献。
 * @param props.onFilter - 过滤词变化。
 * @param props.onUploadClick - 点「导入 PDF」。
 * @param props.onNewFolder - 点「新建文件夹」。
 * @param props.onCollapseAll - 点「全部折叠」。
 * @param props.onCollapse - 点「收起侧栏」。
 * @param props.busy - 忙碌时禁用操作。
 * @param props.error - 错误提示。
 */
export function PaperTree({
  entries, current, expanded, filter = '',
  onToggle, onOpen, onFilter,
  onUploadClick, onNewFolder, onCollapseAll, onCollapse,
  // 键盘游标：Delete / F2 作用在它上面（与笔记库同一套心智：先选中，再操作）。
  cursor = null,
  onCursor = () => {},
  busy = false, error = null,
}) {
  const rows = useMemo(() => buildTreeRows(entries, expanded, filter), [entries, expanded, filter]);

  return <>
    {/* 栏头：与笔记库同一排 26×26 图标按钮。
        上传与新建文件夹都在这里 —— 用户不必离开树去页头找入口。 */}
    <div className="zp-tree-head">
      <button type="button" title="导入 PDF" disabled={busy} onClick={onUploadClick}>
        <Icon name="plus" size={14} />
      </button>
      <button type="button" title="新建文件夹" disabled={busy} onClick={onNewFolder}>
        <Icon name="folderPlus" size={14} />
      </button>
      <button type="button" title="全部折叠" onClick={onCollapseAll}>
        <Icon name="collapse" size={14} />
      </button>
      <button type="button" title="收起论文库" onClick={onCollapse}>
        <Icon name="close" size={14} />
      </button>
    </div>

    <input
      type="search"
      className="zp-tree-filter"
      placeholder="过滤文献"
      aria-label="过滤文献"
      value={filter}
      onChange={(event) => onFilter?.(event.target.value)}
    />

    {error !== null && <p className="zp-tree-error">{error}</p>}

    {entries.length === 0
      ? <p className="zp-tree-hint">还没有文献。点上面的 ＋ 导入 PDF。</p>
      : rows.length === 0
        ? <p className="zp-tree-hint">没有匹配「{String(filter).trim()}」的文献。</p>
        : <ul className="zp-tree-list">
          {rows.map((row) => {
            const isFolder = row.type === 'folder';
            const open = isFolder && expanded.has(row.path);
            return <li
              key={row.path}
              className={`zp-tree-row${row.path === current ? ' is-current' : ''}${open ? ' is-expanded' : ''}${row.path === cursor ? ' is-cursor' : ''}`}
              style={{ '--zp-depth': String(row.depth) }}
            >
              <button
                type="button"
                className="zp-tree-btn"
                title={row.path}
                data-path={row.path}
                data-kind={row.type}
                onClick={() => {
                  onCursor(row.path);
                  if (isFolder) onToggle(row.path); else onOpen(row);
                }}
              >
                <span className="zp-tree-caret">{isFolder ? <Icon name="chevron" size={13} /> : null}</span>
                {/* 文件夹与文献分色：与笔记库一致。 */}
                <span className={`zp-tree-icon${isFolder ? ' is-folder' : ''}`}>
                  <Icon name={isFolder ? 'folder' : 'paper'} size={14} />
                </span>
                <span className="zp-tree-name">{row.title ?? baseOf(row.path)}</span>
              </button>
            </li>;
          })}
        </ul>}
  </>;
}
