/**
 * 一门课的**文件清单**与**下载执行**。
 *
 * # 为什么从 `reads.js` 里分出来
 *
 * 上游把这两件事放在 `courses.ts`（清单）与 `download.ts`（落盘）两个文件里，
 * 理由很实在：清单要读**两条互不相通的通路**（章节卡片 / 资料栏），下载要处理
 * 变体、重名、复用、并发 —— 混在一起后，改下载的人会顺手改坏清单的缓存口径。
 *
 * 本文件接受一个 `reader`（`XxtReader`）而不是继承它：`reader` 上有 `client`、
 * 课程缓存与 `downloadParams`，这些都是「发一个请求、拿一份数据」的既有能力，
 * 复制一份只会让两处口径分叉。
 *
 * # 两条通路的区别（漏-6 的直接结论）
 *
 * | 通路 | 内容 | 拿什么 | 关键字段 |
 * | --- | --- | --- | --- |
 * | 章节卡片 | 每一节挂的附件 | `knowledge/cards?num=0,1,…` | `objectId`（32 位 hex） |
 * | 资料栏 | 「资料」里逐层文件夹的文件 | `coursedata/stu-datalist` | `dataId` + `enc` + `downloadable` |
 *
 * 老师把课件放「资料」里是常态。只读章节会得到「这门课没有课件」的**错误结论**，
 * 所以 `chapterList` / `materialList` / `videoList` 默认两条都读。
 *
 * # 缓存口径
 *
 * 清单留 30 分钟：先看清单再下载、连着下几次时不必重读每个章节。缓存按课程分，
 * 只放**已读到的**节与资料栏，读到一半出错时已经读到的部分仍然留下（下一次
 * 只需要补没读到的），这也是上游 `finally` 里那段写入的用意。
 */

import path from 'node:path';
import { rm, stat } from 'node:fs/promises';

import { ClassroomError } from '@lybx-leyw/dsh-zju-source-http';

import { XXT_ENDPOINTS } from './hosts.js';
import {
  chapterScope,
  distinctFiles,
  folderScope,
  inData,
  kindOf,
  localName,
  safeFileName,
  variantName,
} from './files.js';
import { parseCards, parseDataList, roughBytes } from './parse.js';
import { downloadTo } from './download.js';

/** 一节的卡片数上限（上游 12）：正常一章不会那么多张卡，超出就是异常页。 */
const MAX_CARDS = 12;

/** 资料栏一个文件夹的最大页数（上游 50）。 */
const MAX_DATA_PAGES = 50;

/** 资料栏的最大嵌套层数（上游 8）。超出的目录不再打开，避免病态页面把请求打爆。 */
const MAX_DATA_DEPTH = 8;

/** 清单缓存时长。 */
export const INVENTORY_TTL_MS = 30 * 60 * 1000;

/** 同时下载几个文件（上游 3）。 */
const FILES_AT_ONCE = 3;

/**
 * 「教师课件」入口的类型。
 *
 * 它不是文件，而是一个跳到章节卡片页的链接。当成文件列出来会让清单里多一条
 * 永远下不下来的东西 —— 用户点了没反应，只会以为是坏的。
 */
const TCH_COURSEWARE = 'tch-courseware';

/**
 * 一节的卡片里的附件。
 *
 * `num` 从 0 递增，取到「这一页没有卡片」为止。`notOpen` 表示这一节还没开放
 * （老师设置了定时开放），此时页面回的是提示而不是卡片 —— 那**不是错误**，
 * 要如实报出来，否则用户会以为这门课缺了几节。
 *
 * @param {object} reader - `XxtReader`。
 * @param {object} course - 原始课程对象。
 * @param {{id: string, title: string, path: string[]}} chapter - 一节。
 * @param {AbortSignal} [signal] - 取消信号。
 * @returns {Promise<{notOpen: boolean, files: Array<{objectId: string, name: string, size: number|null}>}>}
 */
export async function chapterCards(reader, course, chapter, signal) {
  const files = [];
  for (let num = 0; num < MAX_CARDS; num += 1) {
    const html = await reader.client.get(XXT_ENDPOINTS.chapterCards, {
      clazzid: course.clazzid,
      courseid: course.courseid,
      knowledgeid: chapter.id,
      num,
      ut: 's',
      cpi: course.cpi ?? '',
      v: '2025-0424-1038-3',
      mooc2: '1',
      isMicroCourse: 'false',
      editorPreview: 0,
    }, { signal });
    const card = parseCards(html);
    if (card.notOpen) return { notOpen: true, files: [] };
    if (!card.found) break;
    for (const file of card.files) {
      if (!files.some((item) => item.objectId === file.objectId)) files.push(file);
    }
  }
  return { notOpen: false, files };
}

/**
 * 资料栏的根页面要的 `stuenc`。
 *
 * # 为什么不能用正文里的隐藏域兜底当主路径
 *
 * 课程中间页会 **302 到** `…/studentstudy?…&enc=<stuenc>`，`stuenc` 只在
 * **落地地址的查询串**里。取不到就传空串：平台多数情况下不校验它，
 * 而编一个「看起来像」的值会被服务端静默当成另一门课的资料栏。
 *
 * @param {object} reader - `XxtReader`。
 * @param {object} course - 原始课程对象。
 * @param {AbortSignal} [signal] - 取消信号。
 * @returns {Promise<string>}
 */
export async function dataEntryKey(reader, course, signal) {
  const query = {
    courseid: course.courseid,
    clazzid: course.clazzid,
    cpi: course.cpi ?? '',
    ismooc2: 1,
    v: 2,
  };
  try {
    if (typeof reader.client.redirect === 'function') {
      const landing = await reader.client.redirect(XXT_ENDPOINTS.stuMiddle, { query, signal });
      return new URL(landing).searchParams.get('enc') ?? '';
    }
    const middle = await reader.client.get(XXT_ENDPOINTS.stuMiddle, query, { signal });
    return /id="enc"[^>]*value="([^"]*)"/.exec(middle)?.[1]
      ?? /value="([^"]*)"[^>]*id="enc"/.exec(middle)?.[1]
      ?? '';
  } catch {
    // 取不到 `stuenc` 不该让整份清单读不出来：多半是课程页换了跳转形态。
    return '';
  }
}

/**
 * 资料栏的全部文件（逐层逐页）。
 *
 * 文件夹要用**它自己那一行**给的 `enc` 才能打开 —— 拿父层的 `enc` 去开子层
 * 会被拒绝，而且拒绝方式是回一个空列表（看起来像「这个文件夹是空的」）。
 *
 * @param {object} reader - `XxtReader`。
 * @param {object} course - 原始课程对象。
 * @param {AbortSignal} [signal] - 取消信号。
 * @returns {Promise<Array<object>>} 内部文件对象（`source: 'data'`）。
 */
export async function dataRows(reader, course, signal) {
  const stuenc = await dataEntryKey(reader, course, signal);
  const files = [];
  const seen = new Set();

  const walk = async (folder, folders) => {
    for (let page = 1; page <= MAX_DATA_PAGES; page += 1) {
      if (folders.length > MAX_DATA_DEPTH) return;
      const html = await reader.client.get(XXT_ENDPOINTS.dataList, {
        courseid: course.courseid,
        clazzid: course.clazzid,
        cpi: course.cpi ?? '',
        ut: 's',
        stuenc,
        ...(folder
          ? {
            dataName: folder.name,
            dataId: folder.dataId,
            type: 1,
            parent: '',
            flag: 0,
            enc: folder.enc,
            microTopicId: 0,
            isAjax: 'isAjax',
          }
          : {}),
        t: Date.now(),
        ...(page > 1 ? { pages: page } : {}),
      }, { signal });
      const list = parseDataList(html);
      for (const row of list.rows) {
        if (row.type === 'afolder') {
          if (row.dataId && row.name) await walk(row, [...folders, row.name]);
          continue;
        }
        if (row.type === TCH_COURSEWARE) continue;
        if (!row.dataId || !row.name) continue;
        const name = row.type && !row.name.toLowerCase().endsWith(`.${row.type}`)
          ? `${row.name}.${row.type}`
          : row.name;
        const objectId = /^[0-9a-f]{32}$/i.test(row.objectId) ? row.objectId : null;
        // 同一份文件可能既在章节里又在资料栏里，也可能在两个文件夹里；
        // 有 objectId 时按它去重，没有时按「路径 + 名字」。
        const identity = objectId ?? `${folders.join('/')}\u0000${name}`;
        if (seen.has(identity)) continue;
        seen.add(identity);
        files.push({
          name,
          kind: kindOf(name),
          location: ['资料', ...folders],
          source: 'data',
          dataId: row.dataId,
          objectId,
          // 资料栏只给页面上的约数（310KB）。跨通路合并时，章节里那一份的
          // 准确字节数会覆盖它 —— 见 `inventory` 里的 `same` 那段。
          size: roughBytes(row.size),
          downloadable: row.downloadable,
        });
      }
      if (page >= list.totalPages) return;
    }
  };

  await walk(undefined, []);
  return files;
}

/** 一门课的缓存条目：按节记（每节一次卡片读取）+ 资料栏一层。 */
function cacheOf(reader, course) {
  const key = `${course.courseid}/${course.clazzid}`;
  const saved = reader.inventoryCache.get(key);
  if (saved) return saved;
  const fresh = { at: 0, points: new Map(), data: undefined };
  reader.inventoryCache.set(key, fresh);
  // 缓存按课程数增长：一个账号的课是有限的，但也不能无限攒（长期运行的进程）。
  for (const stale of [...reader.inventoryCache.keys()].slice(8)) {
    reader.inventoryCache.delete(stale);
  }
  return fresh;
}

/**
 * 一门课的完整清单：章节附件 + 资料栏。
 *
 * @param {object} reader - `XxtReader`。
 * @param {object} course - 原始课程对象。
 * @param {object} options
 * @param {Array<object>} options.chapters - 要读的节；空数组表示不读章节。
 * @param {boolean} [options.data] - 是否读资料栏。
 * @param {boolean} [options.fresh] - 不用缓存。
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{files: Array<object>, notOpen: string[], dataError?: string, cached: boolean}>}
 */
export async function inventory(reader, course, { chapters, data = true, fresh = false, signal } = {}) {
  const entry = cacheOf(reader, course);
  const alive = (at) => !fresh && at > 0 && Date.now() - at < INVENTORY_TTL_MS;
  const result = { files: [], notOpen: [], cached: false };

  try {
    for (const chapter of chapters) {
      let point = entry.points.get(chapter.id);
      if (point && alive(point.at)) result.cached = true;
      else {
        point = chapter.locked
          // 锁住的节读了也是空页：直接记成「未开放」，省一次请求，
          // 也让用户知道漏了哪一节。
          ? { at: Date.now(), notOpen: true, files: [] }
          : { at: Date.now(), ...await chapterCards(reader, course, chapter, signal) };
        entry.points.set(chapter.id, point);
      }
      if (point.notOpen) result.notOpen.push(chapter.title);
      for (const file of point.files) {
        result.files.push({
          name: file.name,
          kind: kindOf(file.name),
          location: chapter.path,
          source: 'chapter',
          size: file.size,
          objectId: file.objectId,
          downloadable: true,
        });
      }
    }

    if (data) {
      if (alive(entry.dataAt)) {
        result.cached = true;
      } else {
        try {
          entry.data = await dataRows(reader, course, signal);
          entry.dataAt = Date.now();
        } catch (error) {
          // 资料栏读不出来时，章节那部分照常返回：只读一条通路失败不该把
          // 整份清单一起带走。登录失效、被限流则照旧抛出 —— 那几种再试也一样。
          const fatal = ['COOKIE_EXPIRED', 'COOKIE_IMPORT_REQUIRED', 'RATE_LIMITED', 'CANCELLED']
            .includes(error?.code);
          if (fatal || !(error instanceof ClassroomError)) throw error;
          result.dataError = String(error.message);
          entry.data = [];
          entry.dataAt = Date.now();
        }
      }
      for (const file of entry.data ?? []) {
        // 章节里有同一份时用它的准确字节数，清单里两处的大小一致。
        const same = file.objectId
          ? result.files.find((item) => item.source === 'chapter' && item.objectId === file.objectId)
          : undefined;
        result.files.push({ ...file, size: same?.size ?? file.size });
      }
    }
  } finally {
    entry.at = Date.now();
  }

  return result;
}

/**
 * 按组取一门课的文件，可限定章节或资料栏文件夹。
 *
 * # 「课件」与「视频」的边界
 *
 * 上游把文件分成两组：`video` 就是 `kind === 'video'`，`material` 是**其余全部**
 * —— 文档、音频、压缩包都算课件。本包沿用这条边界，但把它做成一个可选的
 * `kinds` 过滤而不是两个互斥的入口：`materials()` 不给 `kinds` 时返回**全部**
 * （这是它原有的对外契约，页面与脚本已经按那个形状在用），`videos()` 给
 * `['video']`。两种口径都能表达，而不会让「要全部」这件事没有方法可用。
 *
 * # 章节写的是资料栏位置时只读资料栏
 *
 * 只写「资料 / 第一章」时没必要把整门课的章节卡片都读一遍 —— 30 节要十秒。
 * 但**课程自己有一章就叫「资料」时不算**（见 `files.js` 的 `inData`）：
 * 那种课里「资料」指的是章节，按资料栏解释会读到另一个地方去。
 *
 * @param {object} reader - `XxtReader`。
 * @param {string} courseQuery - 用户给的课程（id / 名字 / 链接）。
 * @param {object} options
 * @param {string[]} [options.kinds] - 只要这几种 `kind`；不给就是全部。
 * @param {string} [options.chapter] - 章节或资料栏文件夹。
 * @param {boolean} [options.fresh] - 不用缓存。
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{course: object, files: Array<object>, notOpen: string[], dataError?: string, cached: boolean, scope?: string[]}>}
 */
export async function groupedFiles(reader, courseQuery, { kinds, chapter, fresh = false, signal } = {}) {
  const course = await reader.findCourse(courseQuery, { signal });
  const chapters = (await reader.chapters({ course: course.courseid, signal })).chapters;
  const ofKind = kinds ? (file) => kinds.includes(file.kind) : () => true;

  if (chapter && inData(chapters, chapter)) {
    const only = await inventory(reader, course, { chapters: [], data: true, fresh, signal });
    const keep = folderScope(only.files, chapter);
    if (keep) {
      return {
        course,
        files: distinctFiles(only.files.filter(ofKind).filter(keep)),
        notOpen: [],
        ...(only.dataError ? { dataError: only.dataError } : {}),
        cached: only.cached,
      };
    }
  }

  const scope = chapter ? chapterScope(chapters, chapter) : undefined;
  const full = await inventory(reader, course, {
    chapters: scope ? scope.chapters : chapters,
    // 指定了章节就不再读资料栏：用户要的是那一节，而资料栏与章节是两条通路，
    // 读它只会让「第三节课件」里混进整个资料栏的文件。
    data: !scope,
    fresh,
    signal,
  });

  let keep = scope?.keep;
  if (chapter && !keep) {
    keep = folderScope(full.files, chapter);
    if (!keep) {
      throw new ClassroomError('NEEDS_USER', `没有找到章节或资料文件夹“${chapter}”。`, {
        candidates: chapters.slice(0, 20).map((item) => item.path.join(' / ')),
      });
    }
  }

  return {
    course,
    files: distinctFiles(full.files.filter(ofKind).filter(keep ?? (() => true))),
    notOpen: full.notOpen,
    ...(full.dataError ? { dataError: full.dataError } : {}),
    cached: full.cached,
    ...(scope ? { scope: scope.prefix } : {}),
  };
}

/**
 * 章节清单：每节下列出课件与视频（含「资料」栏每个文件夹）。
 *
 * 这是「一次给出整门课有什么」的读法，与上游 `chapter list` 同形。
 *
 * @param {object} reader - `XxtReader`。
 * @param {string} courseQuery - 用户给的课程。
 * @param {object} [options]
 * @param {boolean} [options.fresh] - 不用缓存。
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<object>}
 */
export async function chapterInventory(reader, courseQuery, { fresh = false, signal } = {}) {
  const course = await reader.findCourse(courseQuery, { signal });
  const chapters = (await reader.chapters({ course: course.courseid, signal })).chapters;
  const full = await inventory(reader, course, { chapters, data: true, fresh, signal });
  return { course, chapters, inventory: full };
}

/** 资料栏「教师课件」入口之外，两个通路的说明：写进返回值，别只写在 README 里。 */
const DATA_NOTE = '资料栏与章节附件是两条通路；已按 objectId 合并去重，'
  + '同一份文件在章节里给出的准确字节数优先于资料栏的约数。';

/** 把内部清单结果收成对外的形状（附注 + 失败信息）。 */
export function summarize(course, files, full) {
  return {
    course: course.name,
    course_id: course.courseid,
    class_id: course.clazzid,
    count: files.length,
    notOpen: full.notOpen,
    ...(full.dataError ? { warning: `资料栏没有读到：${full.dataError}` } : {}),
    ...(full.cached ? { cached: true } : {}),
    note: DATA_NOTE,
  };
}

/* ────────────────────────────────────────────── 落盘 */

/**
 * 已有文件的字节数；没有为 0。
 *
 * 空文件是上次没写成的（进程在写完之前被杀），先删掉再下 —— 留着它会让
 * 「复用」逻辑把一个 0 字节文件当成已下载。
 *
 * @param {string} file - 绝对路径。
 * @returns {Promise<number>}
 */
async function sizeOf(file) {
  const info = await stat(file).catch(() => undefined);
  if (info?.isFile() && !info.size) {
    await rm(file, { force: true });
    return 0;
  }
  return info?.isFile() ? info.size : 0;
}

/**
 * 下载一个课程文件到本地。
 *
 * # 复用与核对
 *
 * 下载过的直接复用，不再问平台：章节里的原文件按清单的**准确字节数**核对；
 * 资料栏文件与播放版事先不知道准确大小，有就用。核对不上就重下 ——
 * 一个被截断的文件比没有更糟，因为它看起来是好的。
 *
 * @param {object} reader - `XxtReader`。
 * @param {object} course - 原始课程对象。
 * @param {object} file - 内部文件对象。
 * @param {object} options
 * @param {string} options.root - 这门课的根目录。
 * @param {string} options.base - 已归一的基础文件名。
 * @param {boolean} options.playback - 视频要不要播放版。
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<object>} 一行结果（`reused` / `note` 可选）。
 */
async function saveOne(reader, course, file, { root, base, playback, signal }) {
  const dir = path.join(root, ...file.location.map(safeFileName));
  const asked = playback && file.kind === 'video' && file.source === 'chapter' ? 'playback' : 'original';
  const expected = variantName(base, asked);
  const have = await sizeOf(path.join(dir, expected));
  const sized = asked === 'original' && file.source === 'chapter';
  if (have && (!sized || file.size === have || (file.size === null && file.kind !== 'video'))) {
    return { name: expected, path: path.join(dir, expected), bytes: have, reused: true };
  }

  const params = await reader.downloadParams({
    ...(file.objectId ? { objectId: file.objectId } : {}),
    ...(file.dataId ? { dataId: file.dataId } : {}),
    course: course.courseid,
    clazzid: course.clazzid,
    cpi: course.cpi,
    playback,
    signal,
  });

  const name = variantName(base, params.variant);
  const out = path.join(dir, name);
  const note = params.note ? { note: params.note } : {};
  const existing = name === expected ? have : await sizeOf(out);
  if (existing) {
    if (params.size === undefined || params.size === existing) {
      return { name, path: out, bytes: existing, reused: true, ...note };
    }
    await rm(out, { force: true });
  }

  const saved = await downloadTo(reader.client, {
    url: params.url,
    destination: out,
    headers: params.headers,
    ...(params.size ? { maxBytes: params.size } : {}),
    signal,
  });
  return { name, path: out, bytes: saved.bytes, ...note };
}

/**
 * 把若干课程文件保存到本地。
 *
 * # 目录怎么定
 *
 * 根目录在**装配时**确定（`XxtReader` 的 `downloadDir`），工具层不给路径 ——
 * 让模型传路径等于让它写到任意位置。章节分目录用的是清单里的 `location`，
 * 所以落盘结构与用户在页面上看到的层次一致。
 *
 * # 一个失败不影响其余
 *
 * 结果总是 `files` 列表，个别失败列进 `failed`；只有**全部**失败时才抛错 ——
 * 那样用户得到的是一句原因，而不是一个空列表。
 *
 * @param {object} reader - `XxtReader`。
 * @param {object} course - 原始课程对象。
 * @param {Array<object>} wanted - 要下载的文件（已按用户选择筛过）。
 * @param {Array<object>} all - 同一门课的全部文件（数重名用）。
 * @param {object} options
 * @param {boolean} [options.playback] - 视频要播放版。
 * @param {string} [options.outDir] - 覆盖根目录（排障/脚本用）。
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<object>}
 */
export async function saveFiles(reader, course, wanted, all, { playback = false, outDir, signal } = {}) {
  const configured = outDir ?? reader.downloadDir;
  if (!configured) {
    throw new ClassroomError(
      'CONFIG',
      '本包没有配置下载目录，下载做不了。请让数据源以 downloadDir 参数装配（默认落在 profile 数据目录下）。',
    );
  }
  const root = path.join(path.resolve(configured), safeFileName(course.name));
  if (!wanted.length) {
    throw new ClassroomError('INVALID_ARGUMENT', `${course.name} 没有可下载的文件。`);
  }

  const saved = new Array(wanted.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(FILES_AT_ONCE, wanted.length) }, async () => {
    while (next < wanted.length) {
      const index = next;
      next += 1;
      const file = wanted[index];
      try {
        saved[index] = await saveOne(reader, course, file, {
          root,
          base: localName(file, all),
          playback,
          signal,
        });
      } catch (error) {
        saved[index] = { name: file.name, reason: String(error?.message ?? error) };
      }
    }
  }));

  const files = saved.filter((row) => 'path' in row);
  const failed = saved.filter((row) => 'reason' in row);
  const result = {
    course: course.name,
    dir: root,
    count: files.length,
    files,
    ...(failed.length ? { failed } : {}),
  };
  if (!files.length && failed.length) {
    throw new ClassroomError(
      'REJECTED',
      failed.length === 1 ? failed[0].reason : '文件都没有下载成功。',
      { failed },
    );
  }
  return result;
}
