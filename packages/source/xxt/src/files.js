/**
 * 学习通的**文件与名称**纯函数层：类型判定、按名字找人、按章节/文件夹圈定范围、落盘命名。
 *
 * # 为什么单列一个文件
 *
 * 上游 `chaoxing/cli.ts` 里有近一半篇幅在干这件事（`similarity` / `chapterScope` /
 * `folderScope` / `pick` / `distinct` / `localName`），而它夹在命令注册里 ——
 * 于是「按名字找文件」这套规则只有 CLI 能用，别人想复用只能抄。
 *
 * 本仓的分工是 **source 给完整的基础函数，tool 只做话术翻译**。那么
 * 「用户说『等厚干涉那一节的视频』」→「具体哪几个文件」这件事必须在 source 里
 * 做完，而且必须能被单独测：它全是纯函数，输入是章节与文件列表，没有网络。
 *
 * # 一条贯穿全文件的口径
 *
 * 用户能给出的形式是不确定的：章节可能是「5.2」「等厚干涉」「第一章 / 5.2 等厚干涉G」
 * 或清单里原样的 `location`；文件可能是全名、去掉扩展名的名字，或名字里的一段。
 * 这些形式全部**在这里**归一，调用方不需要知道有几种写法。
 *
 * # 与上游的差别（都是本仓必须改的）
 *
 * | 上游 | 这里 | 为什么 |
 * | --- | --- | --- |
 * | `NeedsUser` + `detail.candidates` | `ClassroomError('NEEDS_USER')` + `details.candidates` | 全仓一套错误形状（见 `docs/contributing`） |
 * | `kindOf` 只分 video / document | 多一个 `audio` | 上游 `courses.ts:20-26` 本来就分三类；只留两类会让录音附件混进课件清单 |
 */

import { ClassroomError } from '@lybx-leyw/dsh-zju-source-http';

/* ────────────────────────────────────────────── 文件类型 */

/**
 * 视频扩展名（与上游 `courses.ts` 的 `VIDEO` 同一份）。
 *
 * 为什么要把 `rmvb` / `ts` / `f4v` 这些老格式也列上：学习通上大量存量课件是
 * 十几年前录的，判错类型会让「视频清单」漏掉一整门课。
 */
const VIDEO_EXT = new Set([
  'mp4', 'flv', 'avi', 'wmv', 'mkv', 'mov', 'm4v', 'rmvb', 'rm', 'webm',
  'mpg', 'mpeg', '3gp', 'ts', 'f4v', 'asf',
]);

/** 音频扩展名。英语听力、讲座录音都会以附件形式挂在章节里。 */
const AUDIO_EXT = new Set(['mp3', 'm4a', 'wav', 'wma', 'aac', 'flac', 'ogg']);

/**
 * 按扩展名判附件类型。
 *
 * @param {string} name - 文件名（要带扩展名；没带的一律当文档）。
 * @returns {'video'|'audio'|'document'}
 */
export function kindOf(name) {
  const extension = String(name ?? '').split('.').pop()?.toLowerCase() ?? '';
  if (VIDEO_EXT.has(extension)) return 'video';
  return AUDIO_EXT.has(extension) ? 'audio' : 'document';
}

/**
 * 下载时「课件」与「视频」两组的**互斥**划分。
 *
 * # 为什么两组必须互斥
 *
 * 上游的 `--all` 是 `inGroup(kind)`：视频组只要 `video`，**课件组是其余全部**。
 * 如果「课件」按「不筛」实现，`materialDownload --all` 会把整门课的视频
 * 也一起下下来 —— 几百 MB，而用户要的只是讲义。所以两组各自列清 kind。
 *
 * 列表接口（`materials()`）不吃这张表：它原有的契约是「返回全部」，
 * 页面与脚本已经按那个形状在用。
 */
export const KIND_GROUPS = Object.freeze({
  video: Object.freeze(['video']),
  material: Object.freeze(['audio', 'document']),
});

/* ────────────────────────────────────────────── 名称归一 */

/**
 * 名称归一：全角转半角、去空白、小写。
 *
 * 用户从页面上复制来的标题常常带全角空格与不换行空格，直接比会「明明一样却找不到」。
 *
 * @param {string} value - 任意名称。
 * @returns {string}
 */
export const normalizeName = (value) => String(value ?? '')
  .normalize('NFKC')
  .toLowerCase()
  .replace(/\s+/g, '');

/**
 * 把多个说法拆开：竖线、顿号、逗号、分号、换行都算分隔符。
 *
 * 上游用 `|`，但用户在中文输入法下更常说「、」。两种都收，重复的去掉。
 *
 * @param {string} value - 原文。
 * @returns {string[]}
 */
export function splitPhrases(value) {
  const seen = new Set();
  return String(value ?? '')
    .split(/[|｜、，,；;\n]+/)
    .map((item) => item.trim())
    .filter((item) => item && !seen.has(normalizeName(item)) && seen.add(normalizeName(item)));
}

/**
 * 简称按字序出现在全名里（计组 → 计算机组成）。
 *
 * 至少两个字才算简称：一个字什么都能命中（「课」几乎每门课里都有）。
 *
 * @param {string} query - 用户写的简称。
 * @param {string} name - 全名。
 * @returns {boolean}
 */
export function abbreviates(query, name) {
  const short = [...normalizeName(query)];
  const full = normalizeName(name);
  let at = 0;
  for (const char of short) {
    at = full.indexOf(char, at);
    if (at < 0) return false;
    at += char.length;
  }
  return short.length > 1;
}

/* ────────────────────────────────────────────── 唯一匹配 */

/**
 * 在一组候选里按名字找唯一的一个；不唯一或找不到时抛错并给出候选。
 *
 * # 为什么不「退回第一个」
 *
 * 学习通里同名文件极多（每一章都有个「作业.pdf」）。默默取第一个的后果是
 * 用户以为自己下到了「等厚干涉」那份，实际拿到的是别一章的 —— 而且没有任何
 * 迹象表明选错了。所以歧义必须抛出去，让调用方（或用户）明确选。
 *
 * @param {Array<object>} rows - 候选。
 * @param {string} query - 用户写的名字。
 * @param {(row: object) => string[]} names - 一行有哪些可比的名字。
 * @param {(row: object) => unknown} describe - 候选怎么展示。
 * @param {string} label - 类别名（错误文案用）。
 * @returns {object} 命中的那一行。
 * @throws {ClassroomError} `NEEDS_USER`：找不到，或候选不唯一。
 */
export function uniqueMatch(rows, query, names, describe, label) {
  const wanted = normalizeName(query);
  if (!wanted) {
    throw new ClassroomError('INVALID_ARGUMENT', `需要${label}名称。`);
  }
  const exact = rows.filter((row) => names(row).some((name) => normalizeName(name) === wanted));
  const matches = exact.length
    ? exact
    : rows.filter((row) => names(row).some((name) => normalizeName(name).includes(wanted)));
  if (matches.length === 1) return matches[0];
  const error = new ClassroomError(
    'NEEDS_USER',
    matches.length ? `${label}不唯一，请从候选中明确目标。` : `没有找到${label}“${query}”。`,
    { candidates: (matches.length ? matches : rows).slice(0, 12).map(describe) },
  );
  throw error;
}

/* ────────────────────────────────────────────── 课程 */

/**
 * 课程页面的地址。
 *
 * 原样写回 `course` 就是这门课 —— 重名的、名字互相包含的课都能靠它区分，
 * 而这是用户从浏览器地址栏里**唯一**能整段复制的东西。
 *
 * @param {{courseid: string, clazzid: string, cpi: string}} course - 原始课程对象。
 * @returns {string}
 */
export const courseLink = (course) => 'https://mooc1.chaoxing.com/visit/stucoursemiddle'
  + `?courseid=${course.courseid}&clazzid=${course.clazzid}&cpi=${course.cpi ?? ''}&ismooc2=1&v=2`;

/**
 * 从课程页链接里取 `courseid` / `clazzid` / `cpi`。
 *
 * 参数名在真机上出现过 `clazzid` 与 `classid` 两种写法，都要认。
 *
 * @param {string} query - 用户给的东西。
 * @returns {{courseId: string, clazzId: string, cpi: string} | undefined}
 */
export function linkOf(query) {
  const text = String(query ?? '').trim();
  if (!/^https?:\/\//i.test(text)) return undefined;
  let url;
  try {
    url = new URL(text);
  } catch {
    return undefined;
  }
  const pick = (...keys) => {
    for (const [key, value] of url.searchParams) {
      if (keys.includes(key.toLowerCase()) && /^\d+$/.test(value)) return value;
    }
    return '';
  };
  const courseId = pick('courseid');
  const clazzId = pick('clazzid', 'classid');
  const cpi = pick('cpi');
  return courseId ? { courseId, clazzId, cpi } : undefined;
}

/**
 * 用户给的东西（课程页链接 / 课程 id / 全名 / 简称）→ 本人课程。
 *
 * # 为什么链接优先
 *
 * 课程名会重名（「大学物理」在好几个学期都有），而链接里带 `courseid` + `clazzid`，
 * 是**无歧义**的。先认链接，才能让「同一门课的两个班」分得开。
 *
 * @param {Array<object>} courses - `courses()` 的结果。
 * @param {string} query - 用户给的东西。
 * @returns {object} 命中的课程。
 * @throws {ClassroomError} `NEEDS_USER` / `COURSE_NOT_FOUND`。
 */
export function resolveCourse(courses, query) {
  const text = String(query ?? '').trim();
  if (!text) throw new ClassroomError('INVALID_ARGUMENT', '需要给出课程 id、课程名或课程页面的链接。');
  const link = linkOf(text);
  if (link) {
    const hit = courses.find((course) => course.courseid === link.courseId
      && (!link.clazzId || course.clazzid === link.clazzId));
    if (hit) return hit;
    throw new ClassroomError(
      'COURSE_NOT_FOUND',
      '这个链接不是本人课程页面的地址，请改给课程名称。',
      { courseid: link.courseId },
    );
  }
  const byId = courses.filter((course) => course.courseid === text);
  // 课程 id 是精确匹配，命中就是它 —— 不用再拿它去比名字（那会让
  // 「111」这种纯数字 id 掉进「名字包含」的分支，然后报「没找到课程 111」）。
  if (byId.length === 1) return byId[0];
  const short = courses.filter((course) => abbreviates(text, course.name));
  return uniqueMatch(
    byId.length ? byId : courses,
    text,
    (course) => [course.name, ...(short.includes(course) ? [text] : [])],
    (course) => ({ name: course.name, teacher: course.teacher, link: courseLink(course) }),
    '课程',
  );
}

/* ────────────────────────────────────────────── 章节与文件夹范围 */

/** 最长公共子序列的长度（逐行滚动，不建二维表）。 */
function commonLength(a, b) {
  let row = new Array(b.length + 1).fill(0);
  for (const left of a) {
    const next = [0];
    for (let index = 0; index < b.length; index += 1) {
      next.push(left === b[index] ? row[index] + 1 : Math.max(row[index + 1], next[index]));
    }
    row = next;
  }
  return row[b.length];
}

/** 去掉序号与符号后的字符数组：用来比「标题像不像」。 */
const bare = (value) => [...normalizeName(value).replace(/^[\d.]+/, '').replace(/[^\p{L}\p{N}]/gu, '')];

/**
 * 两个标题有多像（0..1）。
 *
 * 共同的字不到 4 个、或只占较长一方不到六成的，一律算 0 —— 短词之间
 * 随便就能对上两个字，不设门槛会让「第 3 章」匹配到任何一章。
 *
 * @param {string} a - 标题一。
 * @param {string} b - 标题二。
 * @returns {number}
 */
export function similarity(a, b) {
  const left = bare(a);
  const right = bare(b);
  const shared = commonLength(left, right);
  const longest = Math.max(left.length, right.length);
  if (shared < 4 || !longest || shared / longest < 0.6) return 0;
  return shared / Math.min(left.length, right.length);
}

/**
 * 章节路径能当范围用的全部前缀（大章、大章/节、大章/节/小节）。
 *
 * 用户写「第三章」时命中的是**它下面的全部节**，所以范围必须是前缀而不是单个节点。
 *
 * @param {Array<{path: string[]}>} chapters - 章节目录。
 * @returns {string[][]}
 */
function pathScopes(chapters) {
  const scopes = new Map();
  for (const chapter of chapters) {
    chapter.path.forEach((_part, index) => {
      const prefix = chapter.path.slice(0, index + 1);
      scopes.set(prefix.join('\n'), prefix);
    });
  }
  return [...scopes.values()];
}

/**
 * 用户写的章节 → 要读的节 + 哪些文件属于这个范围。
 *
 * 命中顺序：整条 `location` 或末级标题 → 任一级标题包含 → 只差一两个字的标题。
 * 命中的范围互相包含时取**最外层**（写「第三章」不该只命中恰好也叫「第三章」的那一节）。
 *
 * @param {Array<{id: string, title: string, path: string[]}>} chapters - 章节目录。
 * @param {string} query - 用户写的章节。
 * @returns {{chapters: Array<object>, keep: (file: object) => boolean, prefix: string[]} | undefined}
 *   `keep` 收的是**文件对象**（与 {@link folderScope} 同形，两者可以互换地喂给同一个
 *   `Array.filter`）。`undefined` 表示没对上任何章节（调用方据此再试资料栏文件夹）。
 * @throws {ClassroomError} `NEEDS_USER`：对上了多个互不包含的范围。
 */
export function chapterScope(chapters, query) {
  const wanted = normalizeName(query);
  if (!wanted) return undefined;
  const scopes = pathScopes(chapters);
  const names = (path) => [normalizeName(path.at(-1)), normalizeName(path.join('/'))];
  const exact = scopes.filter((path) => names(path).includes(wanted));
  let hit = exact.length ? exact : scopes.filter((path) => names(path).some((name) => name.includes(wanted)));
  if (!hit.length) {
    // 字面对不上时找只差一两个字的（实验课表写「…的测定」，课程里叫「…的测量」）。
    // 只有一个明显最像时才算，否则宁可报「没找到」，也不要猜错一节。
    const close = scopes
      .map((path) => ({ path, score: similarity(query, path.at(-1)) }))
      .filter((item) => item.score >= 0.85)
      .sort((a, b) => b.score - a.score);
    if (close.length && (close.length === 1 || close[0].score - close[1].score >= 0.1)) hit = [close[0].path];
  }
  if (!hit.length) return undefined;
  const outer = hit.filter((path) => !hit.some((other) => other.length < path.length
    && other.every((part, index) => part === path[index])));
  if (outer.length > 1) {
    throw new ClassroomError('NEEDS_USER', '章节不唯一，请从候选中明确。', {
      candidates: outer.slice(0, 12).map((path) => path.join(' / ')),
    });
  }
  const prefix = outer[0];
  const within = (location) => prefix.every((part, index) => location?.[index] === part);
  return {
    chapters: chapters.filter((chapter) => within(chapter.path)),
    // 只认章节通路的文件：资料栏的文件即使位置看起来像章节，也不属于这次范围
    // —— 两条通路是用不同的请求读出来的，混进来会把「第 3 节」变成「整门课」。
    keep: (file) => file?.source === 'chapter' && within(file.location),
    prefix,
  };
}

/**
 * 用户写的资料栏位置（「资料」「资料/第一章」）→ 判定哪些文件在范围内。
 *
 * @param {Array<{location: string[], source: string}>} files - 已读到的文件。
 * @param {string} query - 用户写的东西。
 * @returns {((file: object) => boolean) | undefined} 对不上时 `undefined`。
 */
export function folderScope(files, query) {
  const wanted = normalizeName(query);
  const keep = (exact) => (file) => {
    if (file.source !== 'data') return false;
    const parts = file.location.map(normalizeName);
    const joined = parts.join('/');
    return exact
      ? parts.includes(wanted) || joined === wanted || joined.startsWith(`${wanted}/`)
      : joined.includes(wanted);
  };
  if (files.some(keep(true))) return keep(true);
  return files.some(keep(false)) ? keep(false) : undefined;
}

/**
 * 写的是不是资料栏的位置（「资料」「资料 / 文件夹」）。
 *
 * 课程自己有一章就叫「资料」时不算 —— 那种课里「资料」指的是章节，
 * 按资料栏解释会读到另一个地方去。
 *
 * @param {Array<{path: string[]}>} chapters - 章节目录。
 * @param {string} query - 用户写的东西。
 * @returns {boolean}
 */
export function inData(chapters, query) {
  const head = normalizeName(query).split('/')[0];
  return head === normalizeName('资料') && !chapters.some((chapter) => normalizeName(chapter.path[0]) === normalizeName('资料'));
}

/* ────────────────────────────────────────────── 文件列表 */

/**
 * 同一份文件只留一条。
 *
 * 一章里的同一份附件会出现在多张卡片里，资料栏里也可能挂在两处；上游按
 * `objectId` 去重并**保留最先出现的**（章节在资料栏之前），于是大小用的是章节里
 * 那份准确字节数。
 *
 * @param {Array<{objectId?: string|null}>} files - 文件列表。
 * @returns {Array<object>}
 */
export function distinctFiles(files) {
  const seen = new Set();
  return files.filter((file) => {
    if (!file.objectId) return true;
    if (seen.has(file.objectId)) return false;
    seen.add(file.objectId);
    return true;
  });
}

/**
 * 用户写的文件名 → 命中的文件（可多个）。
 *
 * 认三种写法：全名、去掉扩展名的名字、名字里的一段。命中的名字各自按
 * {@link uniqueMatch} 判唯一 —— 一次问两个名字时，每个都必须唯一。
 *
 * @param {Array<{name: string}>} files - 候选文件。
 * @param {string[]} names - 用户写的名字。
 * @param {(file: object) => unknown} [describe] - 候选怎么展示。
 * @returns {Array<object>} 命中的文件（去重，保持给出的顺序）。
 */
export function pickFiles(files, names, describe = (file) => file.name) {
  const out = [];
  for (const name of names) {
    const hit = uniqueMatch(
      files,
      name,
      (file) => [file.name, file.name.replace(/\.[^.]+$/, '')],
      describe,
      '文件',
    );
    if (!out.includes(hit)) out.push(hit);
  }
  return out;
}

/** 字节数 → 「8.3 MB」这类可读大小。`null` 表示不知道（页面只给了约数或干脆没给）。 */
export function fileSize(bytes) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return null;
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit ? value.toFixed(1) : value} ${units[unit]}`;
}

/**
 * 文件行（清单里的形状）。
 *
 * # `location` 保持数组，另给一个 `locationText`
 *
 * `location` 从第一版起就是**数组**（从大章到所在节的标题），页面与脚本按它
 * 判断层级、拼路径。改成拼好的字符串会让所有按 `location[0]`、`location[1]`
 * 取值的调用方静默拿到单个汉字 —— 那种错不会抛，只会让人看到「第一章 / 第一节」
 * 变成「一」。所以数组那一份保留，另给 `locationText`。
 *
 * `locationText` 才是**可以原样写回 `chapter`** 的形式：用户看到清单后要
 * 「只下这一节」，手里能复制的就是这一串。
 *
 * @param {object} file - 内部文件对象。
 * @returns {object}
 */
export const fileRow = (file) => ({
  name: file.name,
  kind: file.kind,
  size: file.size,
  sizeText: fileSize(file.size),
  location: [...file.location],
  locationText: file.location.join(' / '),
  source: file.source,
  ...(file.objectId ? { objectId: file.objectId } : {}),
  ...(file.dataId ? { dataId: file.dataId } : {}),
  ...(file.downloadable === false ? { downloadable: false } : {}),
});

/**
 * 按节（或资料栏文件夹）分组 —— 对应上游 `chapter list` 的输出形状。
 *
 * 顺序跟着 `files` 给的顺序（也就是课程里的顺序），不在这里重排：
 * 用户在页面上看到的顺序就是讲课顺序，重排会让「先看第三章」变得反直觉。
 *
 * @param {Array<object>} files - 内部文件对象（已去重）。
 * @returns {Array<{location: string, path: string[], materials: object[], videos: object[]}>}
 */
export function groupBySection(files) {
  const sections = new Map();
  for (const file of files) {
    const key = file.location.join('\n');
    const section = sections.get(key) ?? {
      location: file.location.join(' / '),
      path: [...file.location],
      materials: [],
      videos: [],
    };
    sections.set(key, section);
    // 音频归到课件那一组：它不是视频，下载也不需要转码。
    (file.kind === 'video' ? section.videos : section.materials).push(fileRow(file));
  }
  return [...sections.values()];
}

/* ────────────────────────────────────────────── 落盘命名 */

/**
 * 把平台上的名字变成能落盘的名字。
 *
 * 平台上的文件名是老师上传时随手起的，里面有 `/`、`:`、`*`、控制字符都不奇怪。
 * 不处理的后果在 Windows 上是写入直接失败（`EINVAL`），而错误信息不会指出
 * 「是文件名里的一个冒号」—— 用户会以为是下载坏了。
 *
 * 保留扩展名：落盘后要靠它决定用什么打开。
 *
 * @param {string} name - 平台上的文件名。
 * @returns {string}
 */
export function safeFileName(name) {
  const text = String(name ?? '').trim() || '未命名';
  // 控制字符 + Windows 保留字符（<>:"/\|?*）+ 结尾的点与空格（Windows 会吞掉）。
  const cleaned = text
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/[. ]+$/, '');
  // 长度留给扩展名与去重后缀：Windows 的路径上限比文件名上限更容易撞。
  const limited = cleaned.length > 120 ? cleaned.slice(0, 120) : cleaned;
  return limited || '未命名';
}

/**
 * 同一位置里重名时给名字后加一段编号。
 *
 * 学习通里「作业.pdf」在每一章都有，而落盘是按章节分目录的 —— 同一目录下
 * 重名的才会撞。撞了不加编号，后一个会把前一个覆盖掉，且用户看不出少了谁。
 *
 * @param {object} file - 要落盘的文件。
 * @param {Array<object>} all - 同一门课的全部文件（用来数重名）。
 * @returns {string}
 */
export function localName(file, all) {
  const name = safeFileName(file.name);
  const same = all.filter((other) => other.name === file.name
    && other.location.join('/') === file.location.join('/'));
  if (same.length < 2) return name;
  const dot = name.lastIndexOf('.');
  const extension = dot > 0 ? name.slice(dot) : '';
  const base = dot > 0 ? name.slice(0, dot) : name;
  return `${base} (${String(file.objectId ?? file.dataId ?? '').slice(0, 6)})${extension}`;
}

/**
 * 变体文件名。
 *
 * `original` 用平台上的名字；`playback`（平台转码后的播放版）与 `preview`
 * （文档预览 PDF）另起名字，与**原文件分开存、互不顶替** —— 共用名字会让
 * 「要原文件却拿到播放版」这件事没有任何痕迹。
 *
 * @param {string} base - 已归一的基础文件名。
 * @param {'original'|'playback'|'preview'} variant - 变体。
 * @returns {string}
 */
export function variantName(base, variant) {
  if (variant === 'playback') return `${base.replace(/\.[^.]+$/, '')}（播放版）.mp4`;
  if (variant === 'preview') return /\.pdf$/i.test(base) ? base : `${base}.pdf`;
  return base;
}
