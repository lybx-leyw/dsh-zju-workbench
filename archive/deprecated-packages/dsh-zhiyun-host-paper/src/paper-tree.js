/**
 * 论文库的**多级文件树**：在"上游只认一层 topic"的硬约束下，把层级编码进目录名。
 *
 * # 为什么必须编码，而不是直接建多级目录
 *
 * 上游的 `listPapers`（`dist/library.js:42-53`）只做**一层**遍历：
 * `join(dataDir, topic)` 下面直接读文件。也就是说磁盘上若真建成
 * `dataDir/理学/力学/讲义.pdf`，上游会认为 `dataDir/理学` 里没有 PDF
 * （它把 `力学` 当目录跳过），这篇文献就**在上游眼里不存在** ——
 * 整篇翻译、伴读会话、search_paper 全都用不了。
 *
 * 所以磁盘布局必须是 `dataDir/<单段 topic>/<name>.pdf`，多级路径编码进 topic：
 *
 *     理学/力学/讲义.pdf   →   dataDir/理学+力学/讲义.pdf
 *     理学/讲义.pdf        →   dataDir/理学/讲义.pdf
 *
 * **磁盘上的目录名就是唯一真相**：上游按它工作，本文件把 `+` 解码成 `/` 供树展示。
 * 展示层解码不会引入第二套真相。
 *
 * # 编码必须可逆且无撞名
 *
 * 朴素方案 `join('__')` 会让「真名就叫 `a__b` 的目录」与「深层 `a/b`」撞车
 * （两者都会变成 topic `a__b`，于是两篇文献抢同一个目录）。
 * 因此把分隔符自身也转义：`%` → `%25`，`+` → `%2B`，段间用 `+`。
 * 已实测往返无损，且 `a+b` 与 `a/b` 编码后不同。
 */

import { readdir } from 'node:fs/promises';
import path from 'node:path';

/** 译文产物后缀：它们不是独立文献（同一篇论文的变体）。 */
const VARIANT_SUFFIX = /-(?:zh|dual)$/i;

/** 隐藏文件与上游的临时/虚拟环境目录都不列。 */
const SKIP = new Set(['.pdf2zh-tmp', '.venv-pdf2zh']);

/**
 * 深层路径 → 上游能接受的**单段** topic。
 * @param rel - 形如 `理学/力学` 的相对路径；空串表示库根。
 * @returns 单段 topic。
 */
export function encodeTopic(rel) {
  return String(rel ?? '')
    .split('/')
    .filter((segment) => segment !== '')
    .map((segment) => segment.replace(/%/g, '%25').replace(/\+/g, '%2B'))
    .join('+');
}

/**
 * `encodeTopic` 的逆运算。
 * @param topic - 单段 topic。
 * @returns 形如 `理学/力学` 的相对路径。
 */
export function decodeTopic(topic) {
  return String(topic ?? '')
    .split('+')
    .map((segment) => segment.replace(/%2B/g, '+').replace(/%25/g, '%'))
    .join('/');
}

/**
 * 读论文库，产出**扁平条目表**（文件夹 + 文献）。
 *
 * 与笔记库的 `tree` 同形，所以两边的树可以用同一套「按 `/` 分层」的渲染。
 *
 * @param dataDir - 论文库根目录。
 * @returns `{ type: 'folder'|'paper', path, title, topic, name }[]`
 */
export async function readPaperTree(dataDir) {
  const out = [];
  let dirs;
  try {
    dirs = await readdir(dataDir, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    if (dir.name.startsWith('.') || SKIP.has(dir.name)) continue;
    // 目录名就是编码后的 topic；解码成多级路径供展示。
    const relDir = decodeTopic(dir.name);
    const segments = relDir.split('/').filter(Boolean);
    let acc = '';
    for (const segment of segments) {
      acc = acc === '' ? segment : `${acc}/${segment}`;
      if (!out.some((row) => row.type === 'folder' && row.path === acc)) {
        out.push({ type: 'folder', path: acc, title: segment });
      }
    }

    let files;
    try {
      files = await readdir(path.join(dataDir, dir.name), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.isFile()) continue;
      if (!/\.pdf$/i.test(file.name)) continue;
      const stem = file.name.slice(0, -4);
      // `x-zh.pdf` / `x-dual.pdf` 是译文产物，不单独成行。
      if (VARIANT_SUFFIX.test(stem)) continue;
      out.push({
        type: 'paper',
        path: relDir === '' ? file.name : `${relDir}/${file.name}`,
        title: stem,
        // 打开上游要的两个坐标：topic 就是磁盘目录名，name 是文件名去掉 .pdf。
        topic: dir.name,
        name: stem,
      });
    }
  }

  return out;
}

/**
 * 一份文献在**上游坐标系**里的位置。
 *
 * @param relPath - 树里给的路径（`理学/力学/讲义.pdf`）。
 * @returns `{ topic, name }`：topic 是编码后的单段目录名。
 */
export function upstreamRefFor(relPath) {
  const text = String(relPath ?? '');
  const slash = text.lastIndexOf('/');
  const dirRel = slash === -1 ? '' : text.slice(0, slash);
  const file = slash === -1 ? text : text.slice(slash + 1);
  return { topic: encodeTopic(dirRel), name: file.replace(/\.pdf$/i, '') };
}
