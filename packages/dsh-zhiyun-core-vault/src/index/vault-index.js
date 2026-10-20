/**
 * 库索引：把一堆笔记**解析成一张可查询的网络**（纯逻辑：零 IO / 零 UI）。
 *
 * # 这个文件在做什么（Obsidian 模型的核心）
 *
 * 一篇笔记里的 `[[另一篇]]` 是**单向**写下的，但用户期望的是**双向**的能力：
 * 「哪些笔记提到了我」（反向链接）、「这篇连到哪、从哪来」（图谱）、
 * 「我写了一个不存在的笔记名」（未解析链接 = Obsidian 的"未创建笔记"）。
 *
 * 这三样都必须**全库重算**才能得到：只看一篇笔记无法知道谁引用它。
 * 所以索引是对的粒度 —— 输入全库笔记，输出可查询的网络。
 *
 * # 三条设计决定
 *
 * 1. **索引是纯函数的产物，不是持久化状态**。给定同一批笔记必须得到同一个索引。
 *    这样它可以在每次保存后整份重算（笔记量级是几千篇，不是几百万），
 *    也就不会出现"索引与正文不一致"这种最难查的错。
 *    调用方若要缓存，缓存的是**这个函数的返回值**，而不是另有一套增量逻辑。
 *
 * 2. **解析链接要按「同目录优先，其次全库 basename」**。Obsidian 的规则是
 *    最具体的路径优先：`[[b]]` 在 `a/b.md` 附近时指的是同目录那个 `b`，
 *    而不是任意一个 `b`。跳过这条会让"看似解析成功、其实连错笔记"。
 *
 * 3. **解析不了就如实报"未解析"**，绝不静默丢弃。Obsidian 里点一个不存在的
 *    `[[名字]]` 会创建新笔记 —— 那个"未解析"状态本身就是功能，
 *    丢掉它用户就再也找不到自己写错的链接了。
 */

import { parseNoteLinks, normalizeTarget, basenameOf } from '../parse/links.js';

/** 一篇笔记的最小形状（本包不认识"笔记"的其余字段，只要求这几个）。 */
const isNote = (n) => n && typeof n === 'object' && typeof n.path === 'string';

/**
 * 从一个笔记路径推出它的**标题**（Obsidian 用文件名当标题）。
 *
 * 去目录、去 `.md`。空路径给空串而不是抛错 —— 索引不该因为一条坏记录整份失败。
 */
export function titleOf(path) {
  const base = String(path ?? '').replace(/\\/g, '/');
  const slash = base.lastIndexOf('/');
  const name = slash === -1 ? base : base.slice(slash + 1);
  return /\.md$/i.test(name) ? name.slice(0, -3) : name;
}

/** 目录部分（含结尾斜杠）；顶层返回空串。 */
function dirOf(path) {
  const p = String(path ?? '').replace(/\\/g, '/');
  const slash = p.lastIndexOf('/');
  return slash === -1 ? '' : p.slice(0, slash + 1);
}

/**
 * 链接解析器：把 `[[目标]]` 映射到一篇真实笔记的 path。
 *
 * 按 Obsidian 的顺序找：
 *   1. **精确路径**（带了目录的 `[[a/b]]`，或顶层 `[[b]]` 命中顶层 `b.md`）；
 *   2. **同目录**（`[[b]]` 写在 `a/x.md` 里 → `a/b.md` 优先于别处的 `b.md`）；
 *   3. **全库 basename**（唯一命中才认；多个同名 → 未解析，而不是随便挑一个）。
 *
 * 第 3 条为什么"多个同名就不认"：随便挑一个会让 `[[笔记]]` 静默连到**别人的**
 * 同名笔记上，用户看到的反向链接是无意义的。宁可报未解析，让用户补全路径。
 */
export function createResolver(notes) {
  const byPath = new Map();
  const byBasename = new Map();
  for (const note of notes) {
    if (!isNote(note)) continue;
    const path = note.path.replace(/\\/g, '/');
    byPath.set(normalizeTarget(path), path);
    const base = basenameOf(path);
    if (!byBasename.has(base)) byBasename.set(base, []);
    byBasename.get(base).push(path);
  }

  return {
    /** @returns {string|null} 命中的笔记 path；解析不了给 null。 */
    resolve(target, fromPath = '') {
      const norm = normalizeTarget(target);
      if (norm === '') return null; // `[[#小节]]` 是本文内跳转，不是跨笔记链接

      // 1) 精确路径
      if (byPath.has(norm)) return byPath.get(norm);

      // 2) 同目录
      const dir = dirOf(fromPath);
      if (dir !== '') {
        const sameDir = normalizeTarget(`${dir}${norm}`);
        if (byPath.has(sameDir)) return byPath.get(sameDir);
      }

      // 3) 全库 basename（唯一命中才认）
      const hits = byBasename.get(basenameOf(norm));
      if (hits && hits.length === 1) return hits[0];
      return null;
    },

    /** 是否存在同名多篇（用来解释"为什么这个链接解析不了"）。 */
    isAmbiguous(target) {
      const hits = byBasename.get(basenameOf(target));
      return Array.isArray(hits) && hits.length > 1;
    },
  };
}

/**
 * 建立全库索引。
 *
 * @param {Array<{path: string, markdown?: string}>} notes - 全部笔记。
 * @returns {{
 *   notes: Map<string, object>,
 *   backlinks: Map<string, Array<object>>,
 *   tags: Map<string, string[]>,
 *   unresolved: Array<object>,
 *   graph: {nodes: object[], edges: object[]},
 *   orphans: string[],
 * }}
 */
export function buildIndex(notes) {
  const list = (Array.isArray(notes) ? notes : []).filter(isNote);
  const resolver = createResolver(list);

  const notesMap = new Map();
  const backlinks = new Map();
  const tags = new Map();
  const unresolved = [];
  const edges = [];

  // ── 第一遍：逐篇解析链接与标签，登记出链 ──
  for (const note of list) {
    const path = note.path.replace(/\\/g, '/');
    const { wikilinks, embeds, tags: noteTags } = parseNoteLinks(note.markdown ?? '');
    const title = titleOf(path);

    const outlinks = [];
    for (const link of wikilinks) {
      // `[[#小节]]`（空目标）是**本文内跳转**，不是跨笔记链接。
      // 它不该进未解析清单 —— 那是用户自己文内的锚点，本来就没有对应的笔记文件。
      // （这条最初漏了：空目标被 resolver 判成"找不到"，于是一篇正常的笔记
      //   会在"未解析链接"面板里显示一堆假断链。）
      if (normalizeTarget(link.target) === '') continue;
      const target = resolver.resolve(link.target, path);
      if (target === null) {
        // 未解析要分类说明原因：「真有这个名字但找不到」与「同名多篇无法确定」
        // 是两回事，后者要能提示用户补全路径。
        unresolved.push({
          from: path,
          target: link.target,
          alias: link.alias,
          heading: link.heading,
          blockId: link.blockId,
          reason: resolver.isAmbiguous(link.target) ? 'ambiguous' : 'missing',
        });
        continue;
      }
      outlinks.push({ target, heading: link.heading, blockId: link.blockId, alias: link.alias });
      edges.push({ from: path, to: target, kind: 'link' });
    }

    // 嵌入也连边，但标成另一种 kind：图谱要能区分"引用"与"把内容搬过来"。
    for (const embed of embeds) {
      const target = resolver.resolve(embed.target, path);
      if (target === null) {
        unresolved.push({
          from: path,
          target: embed.target,
          alias: embed.alias,
          heading: embed.heading,
          blockId: embed.blockId,
          embed: true,
          reason: resolver.isAmbiguous(embed.target) ? 'ambiguous' : 'missing',
        });
        continue;
      }
      edges.push({ from: path, to: target, kind: 'embed' });
    }

    notesMap.set(path, { path, title, outlinks, tags: noteTags.map((t) => t.tag) });

    // ── 反向链接：写进目标那一侧 ──
    for (const out of outlinks) {
      if (!backlinks.has(out.target)) backlinks.set(out.target, []);
      backlinks.get(out.target).push({
        from: path,
        fromTitle: title,
        heading: out.heading,
        blockId: out.blockId,
        alias: out.alias,
      });
    }

    for (const t of noteTags) {
      if (!tags.has(t.tag)) tags.set(t.tag, []);
      const owners = tags.get(t.tag);
      if (!owners.includes(path)) owners.push(path);
    }
  }

  // ── 孤立节点：没有任何入链、也没有任何出链的笔记 ──
  // Obsidian 里这对应"没有被连接的想法"，用户会想找出它们补链接。
  const connected = new Set();
  for (const e of edges) { connected.add(e.from); connected.add(e.to); }
  const orphans = [...notesMap.keys()].filter((p) => !connected.has(p));

  // 每个目标的反链排序：按来源路径稳定排序，避免"每次刷新顺序都不一样"。
  for (const arr of backlinks.values()) arr.sort((a, b) => a.from.localeCompare(b.from));

  const graph = {
    nodes: [...notesMap.values()].map((n) => ({
      id: n.path,
      title: n.title,
      inDegree: (backlinks.get(n.path) ?? []).length,
      outDegree: n.outlinks.length,
      tags: n.tags,
    })),
    edges,
  };

  return { notes: notesMap, backlinks, tags, unresolved, graph, orphans };
}

/**
 * 重命名一篇笔记时，**改写全库指向它的链接**（纯函数，不落盘）。
 *
 * 为什么不落盘：本包零 IO（与本仓其他包同一条纪律）。调用方拿到改写后的
 * 正文列表，自己决定何时写、写几篇 —— 那里才有事务与失败重试的上下文。
 *
 * 改写的三种形态都要覆盖，否则重命名会留下断链：
 *   - `[[旧名]]` → `[[新名]]`
 *   - `[[旧名|别名]]` → `[[新名|别名]]`（**别名必须原样保留**）
 *   - `[[旧名#小节]]` → `[[新名#小节]]`（锚点必须原样保留）
 *
 * ⚠️ 只改指向**被重命名那一篇**的链接：用 resolver 判定，而不是按字符串相等。
 * 否则 `[[同名]]` 在别的目录里指向另一篇时会被误改。
 *
 * @returns {Array<{path: string, markdown: string, changed: number}>}
 */
export function renameLinks(notes, oldPath, newPath) {
  const list = (Array.isArray(notes) ? notes : []).filter(isNote);
  const resolver = createResolver(list);
  const oldNorm = normalizeTarget(oldPath);
  const newTitle = titleOf(newPath);
  const out = [];

  for (const note of list) {
    const path = note.path.replace(/\\/g, '/');
    const markdown = note.markdown ?? '';
    const { wikilinks, embeds } = parseNoteLinks(markdown);
    // 从后往前替换：倒序改写下标才不会被前面的替换位移影响。
    const all = [...wikilinks, ...embeds].sort((a, b) => b.start - a.start);
    let text = markdown;
    let changed = 0;
    for (const link of all) {
      if (normalizeTarget(link.target) !== oldNorm) continue;
      // 双保险：resolver 也必须认为它指向老路径（挡住"同名但不同目录"的误改）。
      if (resolver.resolve(link.target, path) !== oldPath.replace(/\\/g, '/')) continue;
      const bang = link.embed ? '!' : '';
      const alias = link.alias === null ? '' : `|${link.alias}`;
      const anchor = link.blockId ? `#^${link.blockId}` : link.heading ? `#${link.heading}` : '';
      text = `${text.slice(0, link.start)}${bang}[[${newTitle}${anchor}${alias}]]${text.slice(link.end)}`;
      changed += 1;
    }
    if (changed > 0) out.push({ path, markdown: text, changed });
  }
  return out;
}

/**
 * 把链接目标规范化后的**候选键**列出来（供"自动补全"与"查找未链接提及"用）。
 *
 * 与 `normalizeTarget` 的区别：那个给"唯一键"，这个给"所有可能的写法"，
 * 输入法补全要后者。
 */
export function targetCandidates(note) {
  const path = String(note?.path ?? '').replace(/\\/g, '/');
  const noExt = /\.md$/i.test(path) ? path.slice(0, -3) : path;
  const base = basenameOf(path);
  return [...new Set([noExt, base, titleOf(path)])].filter(Boolean);
}
