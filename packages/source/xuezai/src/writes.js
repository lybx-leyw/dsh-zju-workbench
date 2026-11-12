/**
 * 学在浙大的写操作：**算参数 + 执行**两段。
 *
 * # 契约（与 `cc98` / `lab` / `sztz` / `zdbk` / `tyys` 同一套）
 *
 * | 方法 | 做什么 | 会不会改变状态 |
 * | --- | --- | --- |
 * | `xxxPrepare(args)` | 查作业、判能不能交、算出一句说明 | 不会 |
 * | `xxxExecute(signal)` | 上传并提交 | **会** |
 *
 * # 交作业为什么带二进制上传（与 D21 的关系）
 *
 * D21 说「下载归 core」，理由是「只有那一层知道用户想把文件放哪」。
 * **上传不同**：文件从哪来是调用方给的参数（绝对路径），
 * 而「怎么把字节送到平台」是**平台协议**，属于数据源的知识。
 *
 * 而且占位与上传是**连续步骤**：
 *
 * ```text
 * POST /api/uploads          → 拿 id 与 upload_url（占位）
 * PUT  upload_url (FormData) → 真正的字节
 * POST .../submissions       → 提交
 * GET  .../submission_list   → 回查确认
 * ```
 *
 * 拆开会让「占位了但没上传」变成常态（孤儿占位），所以整条链路在本文件里。
 * `core` 只负责**给出文件路径**，不碰上传协议 —— D21 的边界仍然成立。
 *
 * # 两处照上游实测的做法，别改
 *
 * 1. **上传时 `auth: false`**：签名 URL 自带授权，不附带任何 Cookie。
 *    把会话 Cookie 发给对象存储域名是没必要的暴露面。
 * 2. **点名是 GPS 应答，不是口令**：`PUT /api/rollcall/{id}/answer?api_version=1.1.2`
 *    的 body 是经纬度等定位字段。本仓**不伪造定位** —— 那需要调用方给真实坐标。
 */

import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { ClassroomError } from '@lybx-leyw/dsh-zju-source-http';

/**
 * 校园参考点（经纬度）。
 *
 * 照上游 `rollcall.ts:38` 的实测值。点名是 GPS 应答，而这 13 个点是**校园里的
 * 已知位置** —— 逐个试到签上为止，是上游验证过的做法。
 *
 * `RADAR_AT` 是首选点（紫金港东 1 区），大多数课在它上面就能签上。
 */
const RADAR_AT = 'ZJGD1';

/** 参考点名 → `[经度, 纬度]`。上游的顺序有意义（先试最可能命中的）。 */
const RADAR_POINTS = Object.freeze({
  ZJGD1: [120.089136, 30.302331],
  ZJGX1: [120.085042, 30.30173],
  ZJGB1: [120.077135, 30.305142],
  YQ4: [120.122176, 30.261555],
  YQ1: [120.123853, 30.262544],
  YQ7: [120.120344, 30.263907],
  ZJ1: [120.126008, 30.192908],
  HJC1: [120.195939, 30.272068],
  HJC2: [120.198193, 30.270419],
  ZJ2: [120.124267, 30.19139],
  YQSS: [120.124001, 30.265735],
  ZJG4: [120.073427, 30.299757],
});

/**
 * 点名应答算不算签上了。
 *
 * 上游判 `status` 或 `status_name` 是 `on_call` / `on_call_fine` 之一。
 * 只看 HTTP 200 是不够的 —— 平台对「位置不对」也回 200。
 *
 * @param payload - 应答体。
 * @returns 是否签上。
 */
const answered = (payload) => [payload?.status, payload?.status_name]
  .some((value) => value === 'on_call' || value === 'on_call_fine');

/**
 * 把响应体解析成对象（解析不出来就是 `undefined`）。
 *
 * @param response - `transport.request` 的返回。
 * @returns 解析后的对象。
 */
async function jsonOf(response) {
  const text = await response?.text?.();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** 一次写操作的会话。执行后清空，避免重放。 */
class WriteSession {
  constructor() {
    this.prepared = null;
  }

  set(summarized, run) {
    this.prepared = { summarized, run };
    return summarized;
  }

  async run(signal) {
    if (!this.prepared) {
      throw new ClassroomError('NEED_PREPARE', '写操作必须先 Prepare 再 Execute —— 参数还没算出来，不能直接发请求。');
    }
    return this.prepared.run(signal);
  }

  clear() {
    this.prepared = null;
  }
}

/** 参数错误。 */
const invalid = (message) => new ClassroomError('INVALID_ARGUMENT', message);

/**
 * 校验要上传的文件。
 *
 * Prepare 阶段要**如实报出文件名与大小**（审批框上要显示「即将上传
 * report.pdf，2.3 MB」）。所以这里 `stat` 拿大小，但**不读内容** ——
 * 大文件在 Prepare 阶段读进内存是没必要的。
 *
 * @param file - 绝对路径。
 * @returns `{ absolute, name, size }`。
 */
const inspect = async (file) => {
  const absolute = String(file ?? '').trim();
  if (!absolute) throw invalid('需要 file（要上传的文件绝对路径）');
  if (!path.isAbsolute(absolute)) throw invalid(`文件路径必须是绝对的：${absolute}`);
  let info;
  try {
    info = await stat(absolute);
  } catch {
    throw invalid(`文件不存在或读不到：${absolute}`);
  }
  if (!info.isFile()) throw invalid(`不是文件：${absolute}`);
  return { absolute, name: path.basename(absolute), size: info.size };
};

/**
 * 把学在浙大的写方法挂到 reader 上。
 *
 * @param reader - `XzzdApi` 实例（用到 `api` / `transport` 与只读查询）。
 * @returns 写操作集合。
 */
export function createXuezaiWrites(reader) {
  /** `XzzdApi` 自己就是 JSON 客户端（`json()` 带会话失效重试）。 */
  const api = reader;

  /**
   * 造一对 Prepare / Execute。
   *
   * @param name - 动作名（报错时用）。
   * @param build - `(args) => Promise<{ summarized, run }>`。
   * @returns `{ prepare, execute }`。
   */
  const pair = (name, build) => {
    const session = new WriteSession();
    return {
      prepare: async (args = {}) => {
        if (session.prepared) {
          throw new ClassroomError('WRITE_BUSY', `${name} 上一次还没执行完，先别重复准备。`, { action: name });
        }
        const { summarized, run } = await build(args);
        session.set(summarized, run);
        return summarized;
      },
      execute: async (signal) => {
        try {
          return await session.run(signal);
        } catch (error) {
          if (error instanceof ClassroomError && !error.details?.action) {
            error.details = { ...(error.details ?? {}), action: name };
          }
          throw error;
        } finally {
          session.clear();
        }
      },
      cancel: async () => { session.clear(); },
    };
  };

  /**
   * 把 id、名称或「活动对象」统一成活动对象。
   *
   * `activitySubmission` 要的是**活动对象**（它从中读 `course_id` 与
   * `group_set_id`），不是裸 id。所以这里要么用调用方给的对象，
   * 要么去待办/作业列表里找出来。
   *
   * # 为什么名称也要收
   *
   * 用户与模型手里通常只有作业**名字**（「第三次作业」），而接口要数字 id。
   * 先前只认数字，于是工具层传名字就抛 `需要 homework（作业编号）` ——
   * 用户看到的是一句他无从照做的话。查一次名字→id 是**这个数据源的知识**
   * （要知道去哪个接口、按哪个字段匹配），不该让每个调用方各写一遍。
   *
   * 名字匹配是**唯一**才算命中：重名作业（同一门课的「作业1」很常见）
   * 要给用户看清有哪些候选，而不是替他挑一个。
   *
   * @param input - id、作业名，或活动对象。
   * @param signal - 中止信号。
   * @returns 活动对象。
   */
  const resolveActivity = async (input, signal) => {
    if (input && typeof input === 'object' && Number(input.id) > 0) return input;

    const todos = await reader.todos?.({ signal }).catch(() => null);
    const rows = Array.isArray(todos?.xzzd?.rows) ? todos.xzzd.rows : [];

    const numeric = Number(input);
    if (Number.isSafeInteger(numeric) && numeric > 0) {
      const row = rows.find((item) => Number(item.id) === numeric);
      if (row) return row;
      throw invalid(`没找到编号 ${numeric} 的作业（用 assignments 或 todos 看真实编号）`);
    }

    const name = String(input ?? '').trim();
    if (!name) throw invalid('需要 homework（作业编号或作业名，来自 assignments）');

    // 先按「标题等于」找，找不到再退到「标题包含」—— 用户往往只记得一部分。
    const exact = rows.filter((item) => String(item.title ?? '').trim() === name);
    if (exact.length === 1) return exact[0];
    const partial = rows.filter((item) => String(item.title ?? '').includes(name));
    const hits = exact.length > 1 ? exact : partial;

    if (hits.length === 1) return hits[0];
    if (hits.length === 0) {
      throw invalid(`没有标题匹配「${name}」的作业（用 assignments 看真实标题）`);
    }
    const candidates = hits.slice(0, 5)
      .map((item) => `${item.id}：${item.title}`)
      .join('；');
    throw invalid(`「${name}」匹配到 ${hits.length} 个作业，请改用编号：${candidates}`);
  };

  return {
    submitHomework: pair('xuezai.submitHomework', async (args) => {
      const activity = await resolveActivity(args.homework ?? args.activityId);
      const activityId = Number(activity.id);
      // comment 与 content 都收：前者是平台的字段名（提交接口用 comment），
      // 后者是工具层对用户暴露的说法（「要提交的正文」）。
      // 先前只读 comment，工具传 content，于是正文被**静默丢弃**、
      // 随后报「交作业至少要有一个文件或一段正文」—— 用户以为工具坏了。
      const comment = String(args.comment ?? args.content ?? '').trim();
      const files = [];
      for (const file of Array.isArray(args.files) ? args.files : []) {
        files.push(await inspect(file));
      }
      if (!files.length && !comment) throw invalid('交作业至少要有一个文件或一段正文，不能交空');

      // 小组作业的提交接口不同（要 `groups/{id}` 路径），本包只做个人作业。
      if (activity.group_set_id != null || activity.submit_by_group) {
        throw new ClassroomError(
          'UNSUPPORTED',
          '这是小组作业，本仓的提交接口只支持个人作业，请到网页上用小组入口提交。',
          { activityId },
        );
      }

      const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
      const parts = [];
      if (files.length) parts.push(`${files.length} 个文件（${formatBytes(totalBytes)}）`);
      if (comment) parts.push(`${comment.length} 字正文`);

      return {
        summarized: `交作业：${parts.join(' + ')}${files.length ? `；${files.map((f) => f.name).join('、')}` : ''}`,
        run: async (signal) => {
          const uploads = [];
          for (const file of files) {
            signal?.throwIfAborted();

            // 1) 占位。拿 id 与签名上传地址。
            const reserved = await api.json('/api/uploads', {
              method: 'POST',
              body: {
                name: file.name,
                size: file.size,
                parent_type: 'submission_upload',
                parent_id: 0,
                is_scorm: false,
                embed_material_type: '',
              },
              signal,
            });
            if (!reserved?.id || typeof reserved.upload_url !== 'string') {
              throw new ClassroomError('SHAPE', '上传占位响应缺少 id / upload_url。', { name: file.name });
            }

            const target = new URL(reserved.upload_url);
            if (target.protocol !== 'https:') {
              throw new ClassroomError('URL', '上传地址不是 HTTPS，拒绝把文件发出去。', { url: target.href });
            }

            // 2) 上传字节。`auth: false` —— 签名 URL 自带授权，不带 Cookie。
            const body = new FormData();
            body.append('file', new Blob([await readFile(file.absolute)]), file.name);
            const response = await reader.transport.request(target.href, {
              method: 'PUT',
              body,
              auth: false,
              signal,
              timeoutMs: 300_000,
            });
            if (response.status < 200 || response.status >= 300) {
              throw new ClassroomError('HTTP', `上传「${file.name}」失败（HTTP ${response.status}）。`, {
                name: file.name,
                status: response.status,
              });
            }
            uploads.push(Number(reserved.id));
          }

          // 3) 提交。失败也可能已经落地，所以先不抛，回查后再判。
          signal?.throwIfAborted();
          let submitError;
          try {
            await api.json(`/api/course/activities/${activityId}/submissions`, {
              method: 'POST',
              body: { uploads, comment, slides: [], is_draft: false },
              signal,
            });
          } catch (error) {
            submitError = error?.message ?? String(error);
          }

          // 4) 回查：这一步决定「到底交成没交成」。
          let after;
          try {
            after = await reader.activitySubmission(activity, { signal });
          } catch (error) {
            throw new ClassroomError(
              'UNVERIFIED',
              '提交请求已发出，但回查失败 —— 无法确认是否交上去了。请打开网页看一眼，不要直接重试。',
              { activityId, uploads, submitError, verifyError: error?.message ?? String(error) },
            );
          }

          const hit = matchSubmission(after?.latestSubmission, uploads, comment);
          if (!hit) {
            throw new ClassroomError(
              'UNVERIFIED',
              '提交结果没能确认。请打开网页看一眼再决定是否重试，不要直接重复提交。',
              { activityId, uploads, submitError, latest: after?.latestSubmission?.id ?? null },
            );
          }
          return { ok: true, activityId, uploads, submission: hit };
        },
      };
    }),

    retractHomework: pair('xuezai.retractHomework', async (args) => {
      const activity = await resolveActivity(args.homework ?? args.activityId);
      const activityId = Number(activity.id);

      const detail = await reader.activitySubmission(activity).catch(() => null);
      const latest = detail?.latestSubmission;
      if (!latest?.id) throw invalid(`作业 ${activityId} 还没有提交记录，没有可撤回的东西`);
      if (latest.is_draft) {
        return {
          summarized: `最近一次提交已经是草稿，无需撤回（作业 ${activityId}）`,
          run: async () => ({ ok: true, alreadyDraft: true, activityId }),
        };
      }

      return {
        summarized: `撤回作业 ${activityId} 的最近一次提交`,
        run: async (signal) => {
          await api.json(`/api/course/activities/${activityId}/submissions/${latest.id}`, {
            method: 'DELETE',
            signal,
          });
          const after = await reader.activitySubmission(activity, { signal }).catch(() => null);
          const still = after?.latestSubmission;
          if (still?.id === latest.id && !still.is_draft) {
            throw new ClassroomError(
              'UNVERIFIED',
              '撤回请求已发出，但回查时那条提交还在。请打开网页确认。',
              { activityId, submissionId: latest.id },
            );
          }
          return { ok: true, activityId, retracted: latest.id };
        },
      };
    }),

    rollcall: pair('xuezai.rollcall', async (args) => {
      // `rollcall` / `activity` / `homework` / `course` 都收。
      //
      // 点名在待办表里与作业是**同一类行**（`xzzd.rows`），用户与模型看到的
      // 是「哪门课在点名」，工具层自然会传课程名或作业名。先前只读
      // `rollcall`/`activity`，于是工具传 `course` 时必抛「需要 homework」——
      // 连错误文案都在说另一件事。
      const activity = await resolveActivity(
        args.rollcall ?? args.activity ?? args.homework ?? args.course,
      );
      const rollcallId = Number(activity.id);
      const label = String(activity.title ?? activity.course_name ?? rollcallId);
      const code = args.code === undefined ? undefined : String(args.code).trim();
      const radar = args.radar !== false && !code;

      // # 坐标从哪来（这是先前判错的地方）
      //
      // 我先前要求**调用方给经纬度**，理由是「本仓不伪造位置」。那个理由把
      // 两件事混了：上游的做法是**用一组固定的校园参考点逐个试** —— 那不是在
      // 伪造「用户到过哪」，而是在说「这个账号在校园里的某个已知位置」。
      // 参考点是上游实测出来的常量（`rollcall.ts:38`），不是编的。
      //
      // 所以坐标按三档取，从高到低：
      //   1. 调用方明确给了 `latitude` / `longitude` —— 用它（最准）；
      //   2. 给了 `point`（参考点名，如 `ZJGX1`）—— 用它；
      //   3. 都没有 —— 按上游顺序把 13 个参考点逐个试，成功即停。
      const explicitLat = Number(args.latitude ?? args.lat);
      const explicitLng = Number(args.longitude ?? args.lng);
      const hasExplicit = Number.isFinite(explicitLat) && Number.isFinite(explicitLng);
      if (hasExplicit && (explicitLat < -90 || explicitLat > 90 || explicitLng < -180 || explicitLng > 180)) {
        throw invalid('经纬度超出有效范围');
      }
      const named = args.point === undefined ? undefined : String(args.point).trim().toUpperCase();
      if (named !== undefined && !RADAR_POINTS[named]) {
        throw invalid(`不认识的参考点 ${named}（可用：${Object.keys(RADAR_POINTS).join('、')}）`);
      }

      const candidates = hasExplicit
        ? [[explicitLng, explicitLat]]
        : named
          ? [RADAR_POINTS[named]]
          : [RADAR_POINTS[RADAR_AT], ...Object.values(RADAR_POINTS)];

      const where = hasExplicit
        ? `给定位置 ${explicitLat.toFixed(5)}, ${explicitLng.toFixed(5)}`
        : named
          ? `参考点 ${named}`
          : `${candidates.length} 个校园参考点逐个试`;

      return {
        summarized: `课堂签到：${label}（${where}${code ? `，数字口令 ${code}` : ''}）`,
        run: async (signal) => {
          signal?.throwIfAborted();

          // 数字点名走另一条接口（要口令，不要坐标）。
          if (code !== undefined) {
            const response = await reader.transport.request(
              `/api/rollcall/${rollcallId}/answer_number_rollcall?api_version=1.1.2`,
              {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ number: code, deviceId: crypto.randomUUID() }),
                signal,
              },
            );
            const parsed = await jsonOf(response);
            if (!answered(parsed)) {
              throw new ClassroomError(
                'REJECTED',
                `数字点名没有签上：${parsed?.message ?? parsed?.msg ?? '平台没有说明原因'}`,
                { rollcallId, code },
              );
            }
            return { ok: true, rollcallId, kind: 'number', answer: parsed };
          }

          // 雷达点名：逐个参考点试，成功即停。每次失败把距离记下来 ——
          // 全部失败时上游用它们做最小二乘反推位置，本仓不做那一步（见下）。
          const tries = [];
          for (const [lng, lat] of candidates) {
            signal?.throwIfAborted();
            const response = await reader.transport.request(
              `/api/rollcall/${rollcallId}/answer?api_version=1.1.2`,
              {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  deviceId: crypto.randomUUID(),
                  latitude: lat,
                  longitude: lng,
                  speed: null,
                  accuracy: 68,
                  altitude: null,
                  altitudeAccuracy: null,
                  heading: null,
                }),
                signal,
              },
            );
            const parsed = await jsonOf(response);
            if (answered(parsed)) return { ok: true, rollcallId, kind: 'radar', tried: tries.length + 1, answer: parsed };
            const distance = Number(parsed?.distance ?? parsed?.data?.distance ?? parsed?.result?.distance);
            tries.push({ lng, lat, distance: Number.isFinite(distance) ? distance : null });
          }

          // 全试完还没签上。上游会再用「≥3 个距离」做球面最小二乘反推一个位置；
          // 那一步**尚未实现**（已记进 coverage-gaps.md 的 W-29）。
          // 早先这里写的是 W-6 —— 那是 classroom 的 `setup`，引用错了条目。
          // 这里如实报试了多少个点、拿到了几个距离，让用户知道下一步怎么办。
          const distances = tries.filter((t) => t.distance !== null);
          throw new ClassroomError(
            'REJECTED',
            `签不上：试了 ${tries.length} 个参考点都没成功`
            + `（拿到 ${distances.length} 个距离数据）。`
            + '可能不在点名范围内，或点名已结束。',
            { rollcallId, tries: tries.length, distances: distances.length },
          );
        },
      };
    }),  };
}

/**
 * 回查结果里那条提交是不是刚才那次。
 *
 * 判据：上传 id 全对得上，或者正文对得上。**草稿不算交上去**。
 * 两者都没有就算「没确认」—— 宁可让用户去看一眼，也不要报一个假成功。
 *
 * @param latest - `activitySubmission` 返回的 `latestSubmission`。
 * @param uploads - 本次的上传 id 列表。
 * @param comment - 本次的正文。
 * @returns 命中时返回 `latest`，否则 `undefined`。
 */
function matchSubmission(latest, uploads, comment) {
  if (!latest || latest.is_draft) return undefined;
  const ids = Array.isArray(latest.uploads) ? latest.uploads.map(Number) : [];
  if (uploads.length && uploads.every((id) => ids.includes(id))) return latest;
  if (comment && String(latest.comment ?? '').trim() === comment) return latest;
  return undefined;
}

/**
 * 把字节数写成「2.3 MB」这样的串。
 *
 * 审批框里给人看，不是给机器解析。
 *
 * @param bytes - 字节数。
 * @returns 可读大小。
 */
function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '未知大小';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
