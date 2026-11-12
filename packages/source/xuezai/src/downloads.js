/**
 * 学在浙大的**下载**：课件附件、作业附件、本人提交（含老师批改后传回的文件）。
 *
 * # 为什么下载执行放在 source（与 D21 的关系）
 *
 * D21 的原话是「下载由 `packages/core/*` 执行；`source/*` 只暴露下载所需的
 * 全部参数」。它的原文曾被转述成「`source/*` 不碰文件系统」，而**用户从未
 * 这样裁决过** —— 2026-11-12 明确更正（见 `.work/abandoned.md` 1.1 与
 * `.work/zju-assistant-impl-fusion-checklist-v2.md`）。所以本文件落盘不违规，
 * 原先的「缺口」只是工作量问题。
 *
 * 而 `core/*` 里至今**没有**下载执行方（`grep downloadParams|saveFiles|downloadTo`
 * 全空）。所以选「在 source 补齐」而不是「等 core 建一个执行方」，理由有三条：
 *
 * 1. 「怎么把一个 upload id 换成一个签名 URL」是站点协议（`/api/uploads/<id>/url`），
 *    只有数据源知道；
 * 2. 「哪个 id 属于哪条活动、`allow_download=false` 要不要尊重」也是站点知识；
 * 3. 真正与业务无关的只有**字节搬运**那一层，它已经上移到 tier 0 的
 *    `@lybx-leyw/dsh-zju-source-http` 的 `download()`（断点续传 / 原子发布 /
 *    错误码表）。core 里若将来要接，接的是这个函数，不是再抄一遍协议。
 *
 * # 目录由谁决定（安全边界）
 *
 * **调用方不能传路径。** 目录根在装配时定（`config.downloadDir`，默认
 * `<dataDir>/downloads`），往下的层级由本文件按「课程 → 类别 → 作业」拼出来。
 * 每一段都要过 `safeFileName()`，拼完还要再用 `contains()` 核一次真实路径
 * 仍在根之下 —— 两道，因为文件名是**平台给的**（老师能把附件起名叫
 * `../../../.ssh/authorized_keys`），而一次拼接失误就等于把任意写权限交出去。
 *
 * 这条与 `source/cc98` 的 `topicDownload` 同口径：那边的 `downloadDir` 也只在
 * 装配时配置，理由是「让调用方传路径等于让一条帖子把文件写到任意位置」。
 *
 * # 同名文件永不覆盖
 *
 * 三档，从强到弱：
 *
 *   1. 目标已存在且大小与平台给的一致 → **复用**（不重下）—— 课件发布后不会换内容；
 *   2. 目标已存在但大小不同（或不知道）→ 换一个 `名字 (1).ext`，**不覆盖** ——
 *      覆盖会把用户上一次下的那份（可能是老师旧版）悄悄换掉；
 *   3. 同一批里两个文件本来同名（各章都叫「课件.pdf」）→ 名字后带平台 id，
 *      这样**重复运行得到的文件名是稳定的**，不会每跑一次多一个 `(1)`。
 *
 * 提交类文件（本人提交 / 老师批改）每次都重下：重交时同名文件的内容会变，
 * 而复用判据只有大小，那会把新版当成"已下过"。也正因如此，它们**更不能**
 * 覆盖旧文件 —— 旧的那份是上一次提交的证据。
 */

import path from 'node:path';
import { stat } from 'node:fs/promises';

import { ClassroomError, download } from '@lybx-leyw/dsh-zju-source-http';


/* ────────────────────────────────────── 文件名与路径 */

/**
 * Windows 保留设备名。叫 `con.pdf` 的文件在任何目录里都打不开，
 * 而它是老师起的名字 —— 我们能改的就只有本地这份。
 */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

/**
 * 平台给的文件名 → 可以安全落盘的文件名。
 *
 * # 逐条说明为什么这么过滤
 *
 * - **路径分隔符与冒号**：`../`、`C:`、`\\server\share` 都能把文件写到别处。
 *   一律替换成 `_`，而不是「保留子目录」—— 子目录名来自老师，不该由它决定结构。
 * - **控制字符**：`\x00` 截断文件名、`\n` 破坏日志。
 * - **结尾的点与空格**：Windows 会静默剥掉，于是 `a.` 与 `a` 撞成同一个。
 * - **长度 180**：给 `.part.json` 之类的后缀留余量（Windows 单段上限 255）。
 * - **整段是 `.` / `..`**：那两段本身就是穿越。
 * - **保留设备名**：加前导 `_`。
 *
 * @param value - 原始名字（可能是空串、null）。
 * @param [fallback] - 全被过滤掉时用什么。
 * @returns 非空、无路径分隔符的文件名。
 */
export function safeFileName(value, fallback = 'file') {
  let name = String(value ?? '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    // 结尾的点与空格 Windows 会静默剥掉，于是两个不同名字会撞在一起
    .replace(/[. ]+$/g, '')
    .slice(0, 180);
  if (!name || /^\.+$/.test(name)) name = fallback;
  if (RESERVED.test(name)) name = `_${name}`;
  return name;
}

/**
 * 相对路径是否**指到根之外**。
 *
 * ⚠️ 判据不能写成 `relative.startsWith('..')`：那样会把**合法的**名字
 * （`.._.._.._.ssh_...`、活动标题 `..章节`）当成越界拒掉 —— 而 `..` 开头的
 * 文件名并不穿越，它只是名字。真正越界的是 `..` 本身、`../x` 这种。
 *
 * @param relative - `path.relative(root, target)` 的结果。
 * @returns 是否越界。
 */
const escapes = (relative) => relative === '..'
  || relative.startsWith(`..${path.sep}`)
  || path.isAbsolute(relative);

/**
 * 把若干段拼成一个**保证在 root 之下**的绝对路径。
 *
 * 为什么 `safeFileName` 之后还要再核一次：过滤是「字符级」的，而越界是
 * 「路径语义级」的 —— 保留名、大小写不敏感文件系统上的别名、以及将来某个
 * 分支忘了过 `safeFileName`，都只有真正 resolve 一遍才能发现。
 *
 * @param root - 绝对路径根。
 * @param segments - 相对层级（每段都会过 `safeFileName`）。
 * @returns 绝对路径。
 * @throws {ClassroomError} `INVALID_ARGUMENT`：拼到了根之外。
 */
export function underRoot(root, ...segments) {
  const base = path.resolve(root);
  const dir = path.resolve(base, ...segments.map((segment) => safeFileName(segment)));
  const relative = path.relative(base, dir);
  if (relative === '' || escapes(relative)) {
    throw new ClassroomError('INVALID_ARGUMENT', '下载目录落到了根目录之外，已拒绝', { segments: segments.map(String) });
  }
  return dir;
}

/**
 * 一批文件里的本地文件名：**本批重名**时带上平台 id。
 *
 * 为什么按整批算而不是逐个算：两章都叫「课件.pdf」时，逐个算会给第二个加
 * `(1)`，而"谁是第一个"取决于平台的返回顺序。带上平台 id 之后，同一次运行
 * 与下一次运行得到的是同一批名字。
 *
 * @param name - 平台给的名字。
 * @param id - 平台 upload id。
 * @param all - 本批全部文件（用来判重名）。
 * @returns 文件名。
 */
export function batchName(name, id, all) {
  const safe = safeFileName(name);
  const twins = all.filter((file) => safeFileName(file.name) === safe);
  if (twins.length < 2) return safe;
  const ext = path.extname(safe);
  return `${safe.slice(0, safe.length - ext.length)} (${id})${ext}`;
}

/**
 * 在 dir 里给 `name` 找一个不冲突的位置。
 *
 * @param dir - 目标目录。
 * @param name - 候选文件名。
 * @param expectedSize - 平台给的大小（null = 不知道）。
 * @param reuse - 大小一致时是否复用已有文件。
 * @returns `{ path, reuse }` —— `reuse` 为真表示「已存在且可用，不必下载」。
 */
async function locate(dir, name, expectedSize, reuse) {
  for (let index = 0; index < 100; index += 1) {
    const candidate = index === 0
      ? name
      : `${name.slice(0, name.length - path.extname(name).length)} (${index})${path.extname(name)}`;
    const file = path.join(dir, candidate);
    let info = null;
    try { info = await stat(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (info === null) return { path: file, reuse: false };
    // 同名的是个目录（用户自己的布局，或上一次中断留下的怪东西）→ 换下一个序号。
    if (!info.isFile()) continue;
    // 大小对得上才算同一个文件；不知道大小时不敢复用（可能是另一个版本）
    if (reuse && expectedSize != null && info.size === expectedSize) return { path: file, reuse: true };
  }
  throw new ClassroomError('DOWNLOAD_IO', '同名文件过多，无法确定落盘位置', { name });
}

/* ────────────────────────────────────── 下载器 */

/** 平台给的文件对象里，本文件真正要用的那几个字段。 */
const shapeOf = (file, extra) => ({
  id: file?.id ?? file?.upload_id ?? null,
  name: String(file?.name ?? file?.file_name ?? ''),
  size: Number.isFinite(Number(file?.size)) ? Number(file.size) : null,
  allowDownload: file?.allowDownload ?? file?.allow_download ?? null,
  ...extra,
});

/**
 * 按名字挑文件。**不做模糊匹配** —— 理由与 `tool/xuezai` 的 `pickHomework` 相同：
 * 「课件」对上五个文件时替他挑一个，用户拿到的是他没要的那份，而且两边都不报错。
 *
 * 唯一化：先精确、再包含；命中数不等于 1 就报错并列出候选。
 *
 * @param list - 文件数组（每项有 `name` / `id` / `activityTitle`）。
 * @param names - 用户给的名字列表。
 * @returns 挑中的文件。
 * @throws {ClassroomError} `INVALID_INPUT`：一个名字对不上 / 对上多个。
 */
function pickByName(list, names) {
  const picked = [];
  for (const wanted of names) {
    const exact = list.filter((file) => file.name === wanted);
    // 活动名也算：用户手里往往是「哪次课的课件」，那指的是**活动**的标题。
    const byActivity = list.filter((file) => file.activityTitle === wanted);
    const hits = exact.length ? exact : byActivity.length ? byActivity : list.filter((file) => file.name.includes(wanted));
    if (hits.length === 1) { picked.push(hits[0]); continue; }
    if (hits.length === 0) {
      const known = list.slice(0, 10).map((file) => `${file.name}（${file.id}）`).join('、');
      throw new ClassroomError(
        'INVALID_INPUT',
        `没有叫「${wanted}」的文件。先列举一下有哪些：${known || '（这一类是空的）'}`,
        { name: wanted },
      );
    }
    const candidates = hits.slice(0, 8).map((file) => `${file.name}（${file.id}）`).join('、');
    throw new ClassroomError(
      'INVALID_INPUT',
      `「${wanted}」对上了 ${hits.length} 个文件：${candidates}。请写更完整的文件名，或直接用 id。`,
      { name: wanted, matched: hits.length },
    );
  }
  // 同一个文件被两个名字指到（`A.pdf` 与活动名同时命中）时只下一次
  return [...new Map(picked.map((file) => [String(file.id), file])).values()];
}

/**
 * 学在浙大的下载器。
 *
 * 只做两件事：把「要下哪些文件」算出来，然后交给共享下载器搬字节。
 */
export class XzzdDownloads {
  /**
   * @param options.api - 已登录的 `XzzdApi`（用作 JSON 客户端与传输层来源）。
   * @param options.reader - `XzzdReader`（复用它的列表 / 详情 / 提交读取）。
   * @param options.root - 下载根目录（绝对路径，由装配层决定）。
   * @param [options.maxBytes] - 单文件上限（0 = 不限）。
   * @param [options.pageSize] - 列举课件时的每页条数。
   * @param [options.maxPages] - 列举课件的最多页数（防跑飞）。
   */
  constructor({ api, reader, root, maxBytes = 2 * 1024 ** 3, pageSize = 50, maxPages = 40 }) {
    this.api = api;
    this.reader = reader;
    this.root = root;
    this.maxBytes = maxBytes;
    this.pageSize = pageSize;
    this.maxPages = maxPages;
  }

  /**
   * 一个 upload id → 签名下载地址。
   *
   * 为什么每次都现取：签名每小时换一次，落盘缓存等于给未来的自己一个
   * 必然过期的链接（而且把可用链接写进磁盘本身就是信息泄露）。
   *
   * @param uploadId - 平台 upload id。
   * @returns HTTPS 地址。
   * @throws {ClassroomError} `INVALID_INPUT` / `API_SHAPE`。
   */
  async fileUrl(uploadId) {
    const id = Number(uploadId);
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new ClassroomError('INVALID_INPUT', '文件 id 不合法', { uploadId: String(uploadId) });
    }
    const data = await this.api.json(`https://courses.zju.edu.cn/api/uploads/${id}/url`);
    const url = data?.url;
    if (typeof url !== 'string' || !/^https:\/\//i.test(url)) {
      // 明文地址直接拒：签名在 query 里，走 http 等于把「谁能下」交给链路上每一跳。
      throw new ClassroomError('API_SHAPE', '学在浙大没有给出可用的文件下载地址', { uploadId: id });
    }
    return url;
  }

  /**
   * 把一批文件落到 dir。
   *
   * 顺序执行而不是并发：每个文件都要先换一次签名地址，而学在浙大对同一会话
   * 的并发请求本就是排队处理的（`xzzd.js` 里有实测）。并发只会让「第几个失败」
   * 变得不可复现，而失败信息恰恰是这里最要紧的输出。
   *
   * @param dir - 绝对目录（已做过越界检查）。
   * @param wanted - `{ id, name, size, allowDownload }[]`。
   * @param options.reuse - 已存在且大小一致时是否复用。
   * @param options.signal - 中止信号。
   * @param options.onProgress - 进度回调（带上是哪个文件）。
   * @returns `{ dir, files, skipped, failed }`。
   */
  async saveAll(dir, wanted, { reuse = true, signal, onProgress } = {}) {
    const files = [];
    const skipped = [];
    const failed = [];
    for (const file of wanted) {
      signal?.throwIfAborted();
      // 平台明确写了「不允许下载」的，**不替它放行**。这条标记是老师设的，
      // 而本包正好是那个会把字节变成本机文件的地方 —— 忽略它就等于绕过设置。
      if (file.allowDownload === false) {
        skipped.push({ name: file.name, id: file.id, reason: '平台标记为不允许下载' });
        continue;
      }
      const name = batchName(file.name, file.id, wanted);
      const target = await locate(dir, name, file.size, reuse);
      if (target.reuse) {
        files.push({ name: path.basename(target.path), path: target.path, bytes: file.size, reused: true });
        continue;
      }
      try {
        const url = await this.fileUrl(file.id);
        const done = await download(this.api.transport, {
          url,
          destination: target.path,
          signal,
          maxBytes: this.maxBytes,
          onProgress: onProgress ? (event) => onProgress({ ...event, file: { name: file.name, id: file.id } }) : undefined,
        });
        files.push({ name: path.basename(target.path), path: done.destination, bytes: done.bytes, resumed: done.resumed });
      } catch (error) {
        // 单个文件失败不影响其余（上游 `saveUploads` 同口径）：一批 20 个课件里
        // 一个 404 就整批失败，用户得逐个重试，而他能做的其实只是「下其余 19 个」。
        failed.push({
          name: file.name,
          id: file.id,
          code: error?.code ?? 'DOWNLOAD_IO',
          reason: String(error?.message ?? error),
        });
      }
    }
    return { dir, files, skipped, failed };
  }

  /**
   * 列举一门课的课件文件（**按需翻页**）。
   *
   * 只在 `all` 或「还没凑齐指定 id」时翻页：只为下一个文件而把整门课的
   * 30 页课件全拉一遍，是白花几十个请求。
   *
   * @param courseId - 课程 id。
   * @param options.uploadIds - 只要这些（null = 全部）。
   * @param options.all - 是否要全部。
   * @param options.signal - 中止信号。
   * @returns 文件数组（带 `activityTitle`）。
   */
  async listMaterialFiles(courseId, { uploadIds = null, all = false, signal } = {}) {
    const wantedIds = Array.isArray(uploadIds) ? new Set(uploadIds.map((id) => String(id))) : null;
    const files = [];
    for (let page = 1; page <= this.maxPages; page += 1) {
      const listed = await this.reader.materials(courseId, { page, pageSize: this.pageSize, signal });
      for (const row of Array.isArray(listed?.materials) ? listed.materials : []) {
        for (const file of Array.isArray(row?.files) ? row.files : []) {
          if (file?.id == null) continue;
          files.push(shapeOf(file, { activityTitle: String(row.title ?? '') }));
        }
      }
      if (!all && wantedIds) {
        const found = new Set(files.map((file) => String(file.id)));
        if ([...wantedIds].every((id) => found.has(id))) break;
      }
      if (listed?.nextPage == null) break;
    }
    return files;
  }

  /**
   * 下载课件附件。
   *
   * @param options.courseId - 课程 id。
   * @param [options.courseLabel] - 课程名（只用来起目录名，会过 `safeFileName`）。
   * @param [options.uploadIds] - 只下这些；不给且 `all` 为假时**报错**（不默认下全课）。
   * @param [options.names] - 按文件名（或它所在活动的标题）挑，**唯一命中**才算数。
   * @param [options.all] - 下这门课的全部课件。
   * @param [options.signal] - 中止信号。
   * @param [options.onProgress] - 进度回调。
   * @returns 见 `saveAll`，另外带 `course` / `count` / `note`。
   */
  async materials({ courseId, courseLabel = null, uploadIds = null, names = null, all = false, signal, onProgress } = {}) {
    if (!all && !(Array.isArray(uploadIds) && uploadIds.length) && !(Array.isArray(names) && names.length)) {
      throw new ClassroomError(
        'INVALID_INPUT',
        '要么给 uploadIds / names（先列举课件再挑），要么显式要全部（all）。不默认下整门课 —— 一门课的视频常有几个 GB。',
      );
    }
    // 按名字挑时要把整门课的课件列完（名字可能落在后面几页）；按 id 挑则可以提前停。
    const listed = await this.listMaterialFiles(courseId, { uploadIds, all: all || Boolean(names && names.length), signal });
    const pool = all
      ? listed
      : names
        ? pickByName(listed, names)
        : listed.filter((file) => uploadIds.map(String).includes(String(file.id)));
    if (!pool.length) {
      throw new ClassroomError('NOT_FOUND', '这门课没有匹配的课件文件', { courseId: String(courseId), uploadIds: uploadIds ?? null });
    }
    const dir = underRoot(this.root, courseLabel || `course-${courseId}`, '课件');
    const result = await this.saveAll(dir, pool, { reuse: true, signal, onProgress });
    return {
      course: courseLabel ?? null,
      courseId: String(courseId),
      ...result,
      count: result.files.length,
      note: '课件发布后不会换内容，因此大小一致的已有文件直接复用；同名不同大小的会加 (n) 另存，不覆盖。',
    };
  }

  /**
   * 下载作业相关的文件：老师给的附件、本人最近一次提交、老师批改后传回的文件。
   *
   * @param options.activityId - 作业 id。
   * @param options.courseId - 课程 id（判小组作业要用）。
   * @param [options.courseLabel] - 课程名（目录名）。
   * @param [options.uploadIds] - 只下这些（三类合起来按 id 过滤）。
   * @param [options.names] - 只下这些名字（三类合起来按文件名挑，**唯一命中**才算数）。
   * @param [options.parts] - 取哪几类，默认三类全取。
   * @param [options.signal] - 中止信号。
   * @param [options.onProgress] - 进度回调。
   * @returns `{ dir, files, skipped, failed, count, kinds, note }`。
   */
  async homework({
    activityId, courseId, courseLabel = null, uploadIds = null, names = null,
    parts = ['attachments', 'submission', 'corrections'], signal, onProgress,
  } = {}) {
    const wanted = new Set(parts);
    const detail = await this.reader.activity(activityId, { signal });
    const dir = underRoot(this.root, courseLabel || `course-${courseId ?? detail.courseId ?? 'unknown'}`, detail.title || `activity-${activityId}`);

    const emit = (list, kind) => list.map((file) => shapeOf(file, { kind }));
    const groups = [];

    if (wanted.has('attachments')) {
      groups.push({ kind: 'attachments', dir, files: emit(detail.files ?? [], 'attachments'), reuse: true });
    }

    let submission = null;
    if (wanted.has('submission') || wanted.has('corrections')) {
      submission = await this.reader.activitySubmission({
        id: detail.id,
        course_id: detail.courseId ?? courseId,
        group_set_id: detail.groupSetId ?? null,
        // `activitySubmission` 认的是**原始活动的字段名**（`submit_by_group`），
        // 而 `activity()` 给的是归一化后的 `isGroup`。这里把两者对上 ——
        // 传错了的后果是小组作业走进个人作业那条路径，然后必然查不到提交。
        submit_by_group: detail.isGroup === true,
      }, { signal });
    }
    const latest = submission?.latestSubmission ?? null;
    if (wanted.has('submission')) {
      groups.push({ kind: 'submission', dir, files: emit(latest?.uploads ?? [], 'submission'), reuse: false });
    }
    if (wanted.has('corrections')) {
      // 老师的批改文件单独一层：混在一起的后果是「哪几个是我交的」看不出来。
      groups.push({
        kind: 'corrections',
        dir: underRoot(this.root, courseLabel || `course-${courseId ?? detail.courseId ?? 'unknown'}`, detail.title || `activity-${activityId}`, '老师批改'),
        files: emit(latest?.correctionFiles ?? [], 'corrections'),
        reuse: false,
      });
    }

    const pick = (list) => {
      if (Array.isArray(names) && names.length) return pickByName(list, names);
      if (Array.isArray(uploadIds) && uploadIds.length) {
        return list.filter((file) => uploadIds.map(String).includes(String(file.id)));
      }
      return list;
    };

    const files = [];
    const skipped = [];
    const failed = [];
    const counts = {};
    for (const group of groups) {
      const list = pick(group.files);
      counts[group.kind] = list.length;
      if (!list.length) continue;
      const outcome = await this.saveAll(group.dir, list, { reuse: group.reuse, signal, onProgress });
      files.push(...outcome.files.map((file) => ({ ...file, kind: group.kind })));
      skipped.push(...outcome.skipped.map((file) => ({ ...file, kind: group.kind })));
      failed.push(...outcome.failed.map((file) => ({ ...file, kind: group.kind })));
    }

    const notes = [];
    if (wanted.has('submission') && !latest) {
      notes.push(detail.isGroup
        ? '这是小组作业，没有以你个人名义提交的记录，所以「本人提交」这一类是空的。'
        : '这条作业还没有提交记录，所以「本人提交」这一类是空的。');
    }
    if (counts.corrections === 0 && wanted.has('corrections')) notes.push('还没有老师批改后传回的文件。');

    return {
      activityId: String(activityId),
      course: courseLabel ?? null,
      title: detail.title,
      dir,
      files,
      skipped,
      failed,
      count: files.length,
      kinds: counts,
      ...(notes.length ? { note: notes.join(' ') } : {}),
    };
  }
}
