/**
 * 批 1：生成 / 运行 / 舞台（20 条 route）。
 *
 * # 出处（逐条，行号是本仓 `sed -n` 数出来的，不是估的）
 *
 * | # | 上游 route | 本文件方法 | 源行 |
 * |---|---|---|---|
 * | 1 | `generate-classroom/route.ts` POST | `generate.start` | 30-83 |
 * | 2 | `generate-classroom/capabilities/route.ts` GET | `generate.capabilities` | 32-58 |
 * | 3 | `generate-classroom/[jobId]/route.ts` GET | `generate.job` | 24-56 |
 * | 4 | `generation-runs/route.ts` GET / POST | `runs.list` / `runs.start` | 83-106 / 43-81 |
 * | 5 | `generation-runs/events/route.ts` GET | `runs.allEvents` | 35-82 |
 * | 6 | `generation-runs/[id]/route.ts` GET / DELETE | `runs.get` / `runs.cancel` | 42-76 / 78-93 |
 * | 7 | `generation-runs/[id]/confirm-outline/route.ts` POST | `runs.confirmOutline` | 37-66 |
 * | 8 | `generation-runs/[id]/events/route.ts` GET | `runs.events` | 42-107 |
 * | 9 | `generation-runs/[id]/hold-outline/route.ts` POST | `runs.holdOutline` | 33-54 |
 * | 10 | `generation-runs/[id]/retry/route.ts` POST | `runs.retry` | 41-73 |
 * | 11 | `stages/route.ts` GET / POST | `stages.list` / `stages.create` | 47-64 / 71-148 |
 * | 12 | `stages/[id]/route.ts` GET / PUT / PATCH / DELETE | `stages.get` / `stages.put` / `stages.patch` / `stages.remove` | 68-78 / 121-180 / 81-118 / 183-198 |
 * | 13 | `stages/[id]/freshness/route.ts` GET | `stages.freshness` | 44-154 |
 * | 14 | `stages/[id]/generation-complete/route.ts` POST | `stages.markComplete` | 25-75 |
 * | 15 | `stages/[id]/manifest/route.ts` GET | `stages.manifest` | 28-37 |
 * | 16 | `stages/[id]/publish/route.ts` POST | `stages.publish` | 24-76 |
 * | 17 | `stages/[id]/scenes/route.ts` GET（**上游没有 POST**） | `stages.scenes` / `stages.putScenes` | 48-80 |
 * | 18 | `stages/[id]/status/route.ts` GET | `stages.status` | 21-44 |
 * | 19 | `stages/[id]/unpublish/route.ts` POST | `stages.unpublish` | 21-62 |
 * | 20 | `stage-meta/[stageId]/route.ts` GET | `stages.meta` | 39-88 |
 *
 * # 端口（`deps.ports` 是惰性 getter，每次访问现取，可能为 `null`）
 *
 * ```js
 * ports.generate = ctx.zhiyunClassroomGenerate   // start(brief,opts) / stream(id) / cancel / resume / get / list / status
 * ports.vault    = ctx.zhiyunClassroomVault      // classroom.{list,load,save,create,remove,meta}
 *                                                // runs.{put,get,list,patch,remove,appendEvent,events,
 *                                                //       putStep,steps,putCommand,command}
 * ports.stage    = ctx.zhiyunClassroomStage      // 可选：access / setPublished / markComplete / library
 * ports.media    = ctx.zhiyunClassroomMedia      // 可选：extractableMimeTypes（capabilities 的 formats）
 * ```
 *
 * # 端口缺失时的行为（逐条，与上游「没有持久层」那一条分支同答案，不自造错误）
 *
 * | 端口 | 缺了以后 |
 * |---|---|
 * | `generate`（`start`） | **抛** `E_NOT_IMPLEMENTED`（`generate.start` / `runs.start`）。上游这两条没有「无持久层」分支：没有 store 就没有 run，route 本身不存在。 |
 * | `vault` | 查询类回上游的 `404` 纯文本 `Not found`（`ownerNotFound` 是同答案）；`runs.events` / `allEvents` 回空流或 404。 |
 * | `vault`（GET `stages*`） | `404 'Not found'`，即上游 `if (!isServerPersistenceConfigured()) return new Response('Not found', { status: 404 })` 那一行。 |
 * | `stage.setPublished` | **抛** `E_NOT_IMPLEMENTED`（publish / unpublish 是变更类，上游没有可照抄的无持久层分支；`ROUTES.md` §5 记为差异）。 |
 * | `media.extractableMimeTypes` | `materials.formats: []`：上游「一台 extractor 都没有」时 `resolveExtractableMimeTypes` 就是空集，同答案。 |
 *
 * # 流式接口的两种返回
 *
 * `runs.events` / `runs.allEvents` / `stages.freshness` 成功时返回
 * `AsyncIterable<event>`（形状见 `src/events.js`）；失败时（404 / 429）返回
 * `{ httpStatus, body, headers }`。调用方用 `isEventStream(result)` 区分。
 * 上游这几条 route 的 `Set-Cookie` 挂在 `Response` 头上，本包的事件流没有
 * 头部通道（`events.js` 定了形状），owner 头由 HTTP 桥从请求侧补 —— 记入差异。
 *
 * # 与上游的实测差异（全部记在 `ROUTES.md` §5）
 *
 * 1. `isRunId` 上游只认 `/^run-[A-Za-z0-9_-]{16}$/`；`ports.generate` 生成的 id 是
 *    UUID，照抄会让「刚生成的 run 自己取不到」。本文件**额外接受 UUID**。
 * 2. run 的命令（confirm / hold / retry / discard）上游在**一个事务**里做「锁行 +
 *    幂等表 + 事件」，端口只有 `runs.patch` / `appendEvent` / `putCommand`，
 *    没有事务 → 本文件按「先查幂等表，再写」的顺序做，并发下可能出现重复事件。
 * 3. `manifest` / `freshness` 的 `rev` 上游由 DB 触发器维护（单调）；端口只有
 *    `updatedAt`（毫秒）→ 同一毫秒内的两次写在这里可能看不到变化。
 * 4. `runMediaStates` / `runSnapshot` / `stateForRetry` / `mediaState` 逐行照搬，
 *    但 `RunLogDetails`（`failureSeq` / `mediaFailureSeqs` / `materialKinds` /
 *    `materialTruncated`）上游是一条 SQL 算出来的，这里改由**同一份事件日志**重算。
 * 5. `acquireRunStreamSlot` 的 429 与上限（默认 16，`OPENMAIC_GENERATION_RUN_STREAMS_PER_OWNER`）
 *    逐行照搬；`NOTIFY` 唤醒没有端口，只有轮询（`events.js` 已记这条）。
 */

import { randomBytes } from 'node:crypto';

import { notImplemented } from '../errors.js';
import { emptyEventStream, runEventStream } from '../events.js';
import { apiError, apiSuccess } from '../upstream/api-response.js';
import {
  classroomJobView,
  parseClassroomJobBody,
  requiredModelRefusal,
} from '../upstream/classroom-job.js';
import { degradedGenerationCapabilities } from '../upstream/health.js';
import {
  MAX_CLASSROOM_MATERIALS,
  MAX_COMMAND_BODY_BYTES,
  MAX_START_BODY_BYTES,
  parseRunInput,
  readJsonBody,
} from '../upstream/run-input.js';
import { generationRunConfig, materialUploadLimits } from '../upstream/run-config.js';
import {
  localOwner,
  NOT_FOUND,
  headerOf,
  jsonResponse,
  plainResponse,
  searchParam,
  serviceOf,
  withOwner,
} from './support.js';

// ─────────────────────────────────────────────────────────────────────────────
// 上游常量（源:lib/server/generation/run/types.ts:35-59、stage-limits.ts、classroom-materials.ts）
// ─────────────────────────────────────────────────────────────────────────────

/** 源:types.ts:35。 */
export const EXECUTABLE_RUN_STATES = Object.freeze(['preparing', 'outlining', 'generating']);
/** 源:types.ts:39-45。 */
export const ACTIVE_RUN_STATES = Object.freeze([
  'preparing',
  'outlining',
  'awaiting_outline_confirmation',
  'generating',
  'paused',
]);
/** 源:types.ts:53。 */
export const LIMITED_RUN_STATES = Object.freeze(['preparing', 'outlining', 'generating']);
/** 源:agent-runtime/stage-limits.ts:9（发布框客户端侧同一条 120 字规则）。 */
export const STAGE_NAME_MAX_LENGTH = 120;
/** 源:lib/document/bundle.ts:5。 */
export const MAX_CLASSROOM_MATERIAL_TOTAL_BYTES = 150 * 1024 * 1024;
/** 源:run/input.ts:17-19。 */
export { MAX_START_BODY_BYTES, MAX_COMMAND_BODY_BYTES };

/** 源:generation-runs/events/route.ts:27。 */
export const OWNER_RUN_EVENTS_POLL_INTERVAL_MS = 30_000;
/** 源:generation-runs/events/route.ts:33（一笔事务的 `updated_at` 是它的开始，晚提交的可能带着更旧的戳）。 */
const COMMIT_SKEW_MS = 60_000;
/** 源:generation-runs/[id]/events/route.ts:35。 */
export const RUN_EVENTS_POLL_INTERVAL_MS = 5_000;
/** 源:generation-runs/[id]/events/route.ts:36。 */
const PAGE = 500;
/** 源:stages/[id]/freshness/route.ts:36-40。 */
export const STAGE_FRESHNESS_POLL_INTERVAL_MS = 5_000;
/** 源:stages/[id]/freshness/route.ts:38。 */
export const STAGE_FRESHNESS_HEARTBEAT_MS = 25_000;
/** 源:stages/[id]/freshness/route.ts:40。 */
export const STAGE_FRESHNESS_RETRY_MS = 3_000;
/** 源:stages/[id]/scenes/route.ts:33。 */
export const MAX_BATCH_SCENE_IDS = 200;
/** 源:generation/run/plan.ts:122。 */
const MEDIA_STEP_PREFIX = 'media:';

/** 源:generation/run/store.ts:1139-1148（`COURSE_GENERATING` 的文案，逐字保留）。 */
const COURSE_GENERATING_MESSAGE =
  'This course is still being generated; it can be edited once its generation completes.';

/**
 * 源:store.ts:1138-1146 的失败码清单（`lib/media/media-failure.ts:52-56` + `plan.ts:153`）。
 * 这些失败 Retry 改不了。
 */
const FINAL_RUN_MEDIA_FAILURE_CODES = Object.freeze([
  'CONTENT_SENSITIVE',
  'GENERATION_DISABLED',
  'ASSET_REFUSED',
  'MEDIA_ELEMENT_REMOVED',
]);

/**
 * `WORKBENCH_MATERIAL_FORMATS`（源:lib/workbench/material-upload-policy.ts:47-59 +
 * `lib/document/mime.ts` 的 `DOCUMENT_FORMATS`）。顺序即上游的顺序：
 * `formats` 是 `WORKBENCH_MATERIAL_FORMATS.filter(...)` 的输出，顺序会进 body。
 */
const WORKBENCH_MATERIAL_FORMATS = Object.freeze([
  { id: 'pdf', mime: 'application/pdf', extensions: ['.pdf'] },
  { id: 'pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', extensions: ['.pptx'] },
  { id: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', extensions: ['.docx'] },
  { id: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', extensions: ['.xlsx'] },
  { id: 'png', mime: 'image/png', extensions: ['.png'] },
  { id: 'jpeg', mime: 'image/jpeg', extensions: ['.jpg', '.jpeg'] },
  { id: 'webp', mime: 'image/webp', extensions: ['.webp'] },
  { id: 'txt', mime: 'text/plain', extensions: ['.txt'] },
  { id: 'markdown', mime: 'text/markdown', extensions: ['.md', '.markdown'] },
  { id: 'csv', mime: 'text/csv', extensions: ['.csv'] },
  { id: 'mp4', mime: 'video/mp4', extensions: ['.mp4'] },
  { id: 'mov', mime: 'video/quicktime', extensions: ['.mov'] },
  { id: 'webm', mime: 'video/webm', extensions: ['.webm'] },
  { id: 'mp3', mime: 'audio/mpeg', extensions: ['.mp3'] },
  { id: 'wav', mime: 'audio/wav', extensions: ['.wav'] },
  { id: 'm4a', mime: 'audio/mp4', extensions: ['.m4a'] },
  { id: 'aac', mime: 'audio/aac', extensions: ['.aac'] },
  { id: 'audio/webm', mime: 'audio/webm', extensions: [] },
]);

// ─────────────────────────────────────────────────────────────────────────────
// 小工具（只换 Next 的形状，不动判据）
// ─────────────────────────────────────────────────────────────────────────────

/** 取一个端口；`deps.ports` 是惰性 getter，每次现取可能为 null，取不到不抛。 */
function port(deps, key) {
  try {
    return serviceOf(deps?.ports ?? {}, key) ?? null;
  } catch {
    return null;
  }
}

/**
 * 上游 host 侧的所有响应都带 owner 头（`withRequestOwner`）。本包默认单机单用户
 * （`support.js` 的 `localOwner`）；注入真身份服务后行为与上游一致。
 */
function ownerDeps(deps) {
  const owner = deps?.owner;
  return typeof owner?.resolve === 'function' ? deps : { ...(deps ?? {}), owner: localOwner };
}

/** `ownerJson(body, status, headers)`（源:agent-runtime/route-response.ts:470-472）。 */
function ownerJson(body, status = 200) {
  return jsonResponse(body, status, new Headers());
}

/** `ownerApiError(code, status, message, headers)`（源:route-response.ts:475-483）。 */
function ownerApiError(code, status, message, details) {
  const { httpStatus, body } = apiError(code, status, message, details);
  return jsonResponse(body, httpStatus, new Headers());
}

/** `apiSuccess(...)` 的返回形状 + 头部（源:lib/server/api-response.ts:78）。 */
function ok(data, status = 200) {
  const { httpStatus, body } = apiSuccess(data, status);
  return jsonResponse(body, httpStatus, new Headers());
}

/** `ownerNotFound(headers)`（源:route-response.ts:490-492）：纯文本 404，不是 JSON 信封。 */
function ownerNotFound() {
  return plainResponse(404, NOT_FOUND);
}

/**
 * 请求体：上游 `readJsonBody(req, max)` 读的是 `Request` 流；宿主层没有 Request，
 * 调用方把**已读好的字节**（`Buffer` / `Uint8Array` / 字符串）或**已解析的对象**交上来。
 * 判据与上游同：超过上限 413，解析失败 400。
 */
function readBody(raw, maxBytes) {
  if (raw === undefined || raw === null) {
    return { ok: false, status: 400, message: 'Invalid JSON body' };
  }
  if (typeof raw === 'object' && !(raw instanceof Uint8Array)) {
    return { ok: true, value: raw };
  }
  return readJsonBody(raw, maxBytes);
}

/** 事件流的判定：成功时是 `AsyncIterable`，失败时是响应对象。 */
export function isEventStream(result) {
  return Boolean(result) && typeof result[Symbol.asyncIterator] === 'function';
}

// ─────────────────────────────────────────────────────────────────────────────
// run id（源:store.ts:219-221）
// ─────────────────────────────────────────────────────────────────────────────

const RUN_ID_PATTERN = /^run-[A-Za-z0-9_-]{16}$/;
/**
 * 生成端口（`dsh-zhiyun-core-classroom-generate`）用 `randomUUID()` 造 runId，
 * 不是上游的 `run-<16>`。照抄 `isRunId` 会让刚生成的 run 自己取不到，
 * 所以这里额外接受 UUID —— 已记进 `ROUTES.md` §5。
 */
const PORT_RUN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRunId(value) {
  return typeof value === 'string' && (RUN_ID_PATTERN.test(value) || PORT_RUN_ID_PATTERN.test(value));
}

/**
 * `withRequestOwner(req, (principal, responseHeaders) => …)` 的完整版：
 * `support.js` 的 `withOwner` 只把 `{ ownerId, headers }` 交给 body，而上游的
 * `principal` 还带 `kind` / `roles`（publish 的角色判定要它），所以这里多这一层。
 */
async function withPrincipal(deps, request, run) {
  const resolved = await ownerDeps(deps).owner.resolve(request ?? {});
  if (resolved?.ok === false) {
    return {
      httpStatus: resolved.httpStatus ?? 401,
      body: resolved.body ?? NOT_FOUND,
      headers: resolved.headers ?? new Headers(),
    };
  }
  const headers = resolved?.headers instanceof Headers ? resolved.headers : new Headers();
  const result = await run(resolved, headers);
  if (result && result.headers instanceof Headers) {
    for (const [key, value] of headers) result.headers.append(key, value);
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// run 视图（逐行照搬 store.ts / media.ts / plan.ts）
// ─────────────────────────────────────────────────────────────────────────────

/** 源:store.ts:196-213。 */
function runSnapshot(run) {
  return {
    id: run.id,
    state: run.state,
    step: run.step ?? null,
    seq: Number(run.seq ?? 0),
    input: run.input,
    outline: run.outline ?? null,
    agents: run.agents ?? null,
    stageId: run.stageId ?? null,
    progress: run.progress ?? { scenesTotal: 0, scenesCompleted: 0 },
    error: run.error ?? null,
    ...(run.outlineAutoConfirmAt ? { outlineAutoConfirmAt: run.outlineAutoConfirmAt } : {}),
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}

/** 源:plan.ts:162-166。 */
function isRetryableRunMedia(failure) {
  return failure?.errorCode === undefined || !FINAL_RUN_MEDIA_FAILURE_CODES.includes(failure.errorCode);
}

/** 源:media.ts:82-110。 */
function mediaState(checkpoint) {
  const { mediaType } = checkpoint;
  switch (checkpoint.status) {
    case 'queued':
      return { mediaType, status: 'pending' };
    case 'generating':
    case 'submitted':
    // Stored bytes are done once the course names them.
    case 'stored':
      return { mediaType, status: 'generating' };
    case 'skipped':
      return { mediaType, status: 'disabled' };
    case 'done':
      return {
        mediaType,
        status: 'done',
        assetId: checkpoint.assetId,
        ...(checkpoint.posterAssetId ? { posterAssetId: checkpoint.posterAssetId } : {}),
      };
    case 'failed':
      return {
        mediaType,
        status: 'failed',
        message: checkpoint.message,
        ...(checkpoint.errorCode ? { errorCode: checkpoint.errorCode } : {}),
        retryable: isRetryableRunMedia(checkpoint),
      };
    default:
      return { mediaType, status: 'pending' };
  }
}

/** 源:media.ts:113-122。 */
function runMediaStates(checkpoints) {
  return Object.fromEntries(
    [...checkpoints.entries()].map(([elementId, checkpoint]) => [elementId, mediaState(checkpoint)]),
  );
}

/** 源:plan.ts:36-43。 */
function parseStepId(id) {
  if (id === 'material-analysis' || id === 'research' || id === 'outline' || id === 'agents') {
    return { id, kind: id };
  }
  const match = /^scene:(\d+):(content|actions|narration)$/.exec(id);
  if (!match) return null;
  return { id, kind: match[2], sceneIndex: Number(match[1]) };
}

/** 源:plan.ts:68-72。 */
function phaseOfStep(step) {
  if (step.kind === 'material-analysis' || step.kind === 'research') return 'preparing';
  if (step.kind === 'outline') return 'outlining';
  return 'generating';
}

/** 源:plan.ts:107-111。 */
function stateForRetry(stepId) {
  const step = parseStepId(stepId);
  if (!step) throw new Error(`Unknown run step ${JSON.stringify(stepId)}`);
  return phaseOfStep(step);
}

/**
 * 端口里的 run 记录 → 上游 `StoredRun` 的最小可用形状。
 *
 * 生成端口的快照是 `{ runId, stageId, status, startedAt, endedAt, error, phases }`
 * （`dsh-zhiyun-core-classroom-generate/src/index.js` 的 `snapshot()`），没有上游的
 * `state` / `step` / `progress` 三件事。这里只做**状态词映射**，不补 `step` 与
 * `progress`（补了就是编数据：`jobProgress` 的档位会凭空跳）。
 */
const PORT_STATUS_TO_STATE = Object.freeze({
  running: 'preparing',
  preparing: 'preparing',
  outlining: 'outlining',
  generating: 'generating',
  awaiting_outline_confirmation: 'awaiting_outline_confirmation',
  paused: 'paused',
  cancelled: 'ended',
  canceled: 'ended',
  ended: 'ended',
  failed: 'paused',
  completed: 'completed',
  done: 'completed',
  succeeded: 'completed',
});

function runViewFromPort(snapshot) {
  const status = String(snapshot?.status ?? '');
  return {
    id: snapshot?.runId ?? snapshot?.id,
    state: PORT_STATUS_TO_STATE[status] ?? 'preparing',
    step: snapshot?.step ?? null,
    seq: Number(snapshot?.seq ?? 0),
    input: snapshot?.input ?? { materialIds: [] },
    outline: snapshot?.outline ?? null,
    agents: snapshot?.agents ?? null,
    stageId: snapshot?.stageId ?? null,
    progress: snapshot?.progress ?? { scenesTotal: 0, scenesCompleted: 0 },
    error: snapshot?.error ?? null,
    createdAt: snapshot?.createdAt ?? snapshot?.startedAt,
    updatedAt: snapshot?.updatedAt ?? snapshot?.endedAt ?? snapshot?.startedAt,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 命令入参（逐行照搬 `lib/server/generation/run/input.ts:220-300`）
// ─────────────────────────────────────────────────────────────────────────────

/** Command ids are the caller's idempotency keys. */
const COMMAND_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;

function parseCommandId(value) {
  if (typeof value !== 'string' || !COMMAND_ID_PATTERN.test(value)) {
    return {
      ok: false,
      message: 'commandId must be 1 to 128 characters of letters, digits and ._:-',
    };
  }
  return { ok: true, value };
}

function record(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : null;
}

/**
 * 源:input.ts:237-239（`parseOutlines`）。上游是 `normalizeSceneOutlines`，
 * 属 `lib/server/generation/outline-schema.ts`（未搬）。注入 `ports.generate.normalizeOutlines`
 * 就走真归一化，否则只做数组级校验并放行 —— 记入 `ROUTES.md` §5。
 */
function makeParseOutlines(deps) {
  return (value) => {
    const normalize = port(deps, 'generate')?.normalizeOutlines;
    if (typeof normalize === 'function') return normalize(value);
    if (!Array.isArray(value)) return { ok: false, message: 'outlines must be an array' };
    return { ok: true, value };
  };
}

/** 源:input.ts:241-268。 */
function makeParseConfirmOutline(deps) {
  const parseOutlines = makeParseOutlines(deps);
  return (raw) => {
    const body = record(raw);
    if (!body) return { ok: false, message: 'The body must be a JSON object' };
    const commandId = parseCommandId(body.commandId);
    if (!commandId.ok) return commandId;
    const revision = body.outlineRevision;
    if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 1) {
      return { ok: false, message: 'outlineRevision must be a positive integer' };
    }
    if (body.outlines === undefined) {
      return { ok: true, value: { commandId: commandId.value, outlineRevision: revision } };
    }
    // Orders follow the list, as the browser's outline editor numbers them
    // after every edit (position 1, 2, 3, ...).
    const outlines = parseOutlines(
      Array.isArray(body.outlines)
        ? body.outlines.map((outline, index) => {
            const item = record(outline);
            return item ? { ...item, order: index + 1 } : outline;
          })
        : body.outlines,
    );
    if (!outlines.ok) return outlines;
    return {
      ok: true,
      value: { commandId: commandId.value, outlineRevision: revision, outlines: outlines.value },
    };
  };
}

/** 源:input.ts:270-276。 */
function parseHoldOutline(raw) {
  const body = record(raw);
  if (!body) return { ok: false, message: 'The body must be a JSON object' };
  const commandId = parseCommandId(body.commandId);
  if (!commandId.ok) return commandId;
  return { ok: true, value: { commandId: commandId.value } };
}

const MAX_ELEMENT_ID_CHARS = 128;

/** 源:input.ts:286-300。 */
function parseRetry(raw) {
  const body = record(raw);
  if (!body) return { ok: false, message: 'The body must be a JSON object' };
  const commandId = parseCommandId(body.commandId);
  if (!commandId.ok) return commandId;
  if (body.media === undefined) return { ok: true, value: { commandId: commandId.value } };
  const elementId = record(body.media)?.elementId;
  if (typeof elementId !== 'string' || !elementId || elementId.length > MAX_ELEMENT_ID_CHARS) {
    return {
      ok: false,
      message: `media must be { elementId } with an element id of 1 to ${MAX_ELEMENT_ID_CHARS} characters`,
    };
  }
  return { ok: true, value: { commandId: commandId.value, media: { elementId } } };
}

// ─────────────────────────────────────────────────────────────────────────────
// 命令错误（源:store.ts:80-107 的两个错误类）
// ─────────────────────────────────────────────────────────────────────────────

class RunConflict extends Error {
  constructor(reason, message) {
    super(message);
    this.name = 'RunConflict';
    this.reason = reason;
  }
}

class ActiveRunLimit extends Error {
  constructor(limit) {
    super(
      `At most ${limit} course generation${limit === 1 ? '' : 's'} may be in progress at once `
        + '(paused ones and ones waiting for their outline to be confirmed do not count); wait for '
        + 'one to finish or pause, or delete its course, and try again.',
    );
    this.name = 'ActiveRunLimit';
    this.limit = limit;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 存储侧的小实现（上游在 store.ts 里，靠 SQL/事务；这里靠 vault 端口）
// ─────────────────────────────────────────────────────────────────────────────

function vaultErrorCode(error) {
  return String(error?.code ?? error?.kind ?? '');
}

function isVaultNotFound(error) {
  return vaultErrorCode(error) === 'E_NOT_FOUND';
}

/** 端口里的 run 行是不是这个 owner 的（没有 ownerId 字段的历史行按「是」处理）。 */
function ownedBy(run, ownerId) {
  if (!run) return false;
  if (run.ownerId === undefined || run.ownerId === null) return true;
  return String(run.ownerId) === String(ownerId);
}

/** 读一条 run；不可见（不存在 / 别人的）一律 null —— 上游的 no-existence-oracle。 */
async function readRun(vault, runId, ownerId) {
  if (!vault?.runs?.get) return null;
  const run = await vault.runs.get(runId);
  if (!ownedBy(run, ownerId)) return null;
  return run ?? null;
}

/**
 * 上游 `readGenerationRunWithMedia` 的 `RunLogDetails`（源:store.ts:632-641），
 * 由同一份事件日志重算（上游是一条 SQL）：
 * 最后一次不带 `continuing` 的 `step_failed`、每个媒体元素最后一次 failed/disabled 的 seq。
 */
async function readRunLogDetails(vault, runId) {
  const events = (await vault?.runs?.events?.(runId, { after: 0, limit: 1000 })) ?? [];
  let failureSeq = null;
  const mediaFailureSeqs = {};
  let materialKinds = null;
  let materialTruncated = null;
  for (const event of events) {
    const seq = Number(event.seq);
    if (event.type === 'step_failed' && !(event.data && 'continuing' in event.data)) failureSeq = seq;
    if (event.type === 'media') {
      const status = event.data?.status;
      const elementId = event.data?.elementId;
      if ((status === 'failed' || status === 'disabled') && typeof elementId === 'string') {
        mediaFailureSeqs[elementId] = seq;
      }
    }
    if (event.type === 'material_kinds') materialKinds = event.data?.kinds ?? null;
    if (event.type === 'material_truncated') materialTruncated = event.data ?? null;
  }
  return { failureSeq, mediaFailureSeqs, materialKinds, materialTruncated };
}

/** 媒体检查点：端口把 `media:` 前缀的 step 当普通 step 存，这里还原成 Map。 */
async function readRunMedia(vault, runId) {
  const steps = (await vault?.runs?.steps?.(runId)) ?? [];
  const media = new Map();
  for (const step of steps) {
    const id = String(step?.id ?? '');
    if (!id.startsWith(MEDIA_STEP_PREFIX)) continue;
    media.set(id.slice(MEDIA_STEP_PREFIX.length), step.output);
  }
  return media;
}

async function appendEvent(vault, runId, event) {
  const row = await vault?.runs?.appendEvent?.(runId, event);
  return Number(row?.seq ?? 0);
}

/**
 * 源:store.ts:540-558（`enforceActiveRunLimitIn`）。上游在事务里加 advisory lock；
 * 端口没有事务，这里只做计数判定 —— 并发下可能多放一个 run，记入差异。
 */
async function enforceActiveRunLimit(vault, ownerId, limit) {
  const rows = (await vault?.runs?.list?.({ state: [...LIMITED_RUN_STATES] })) ?? [];
  const active = rows.filter((row) => ownedBy(row, ownerId));
  if (active.length >= limit) throw new ActiveRunLimit(limit);
}

/**
 * 源:store.ts:1335-1395（`runCommand`）：一个 `commandId` 只应用一次，
 * 已记录的重复命令原样返回第一次的结果；被拒绝的命令不记录。
 *
 * 上游整个在事务里（先锁行再查幂等表）；端口的 `putCommand` 自己保证「只有第一个写进」，
 * 所以顺序换成「查幂等 → 应用 → 记录」。
 */
async function runCommand(vault, runId, ownerId, commandId, type, apply) {
  const previous = await vault?.runs?.command?.(runId, commandId);
  if (previous) {
    if (previous.type !== type) {
      throw new RunConflict(
        'command-reused',
        `The command id was already used for a ${previous.type} command`,
      );
    }
    return previous.result;
  }
  const run = await readRun(vault, runId, ownerId);
  if (!run) return null;
  const result = await apply(run);
  // `putCommand` 可能不存在（极简端口）：记不了就不记，命令本身照常生效。
  if (typeof vault?.runs?.putCommand === 'function') {
    await vault.runs.putCommand(runId, commandId, type, result);
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// 事件流的并发槽位（源:generation/run/sse.ts:44-87）
// ─────────────────────────────────────────────────────────────────────────────

const openStreams = new Map();

/** 源:sse.ts:47-50。 */
export function maxRunStreamsPerOwner() {
  const raw = Number(process.env.OPENMAIC_GENERATION_RUN_STREAMS_PER_OWNER ?? '');
  return Number.isInteger(raw) && raw > 0 ? raw : 16;
}

/** 源:sse.ts:53-66。 */
function acquireRunStreamSlot(ownerId) {
  const open = openStreams.get(ownerId) ?? 0;
  if (open >= maxRunStreamsPerOwner()) return null;
  openStreams.set(ownerId, open + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const remaining = (openStreams.get(ownerId) ?? 1) - 1;
    if (remaining > 0) openStreams.set(ownerId, remaining);
    else openStreams.delete(ownerId);
  };
}

/** 源:sse.ts:69-71（测试用）。 */
export function openRunStreamsOf(ownerId) {
  return openStreams.get(ownerId) ?? 0;
}

/** 源:events.ts「取消不是错误」：signal 中止即结束。 */
function sleep(ms, signal) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener?.('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 舞台（stage）侧的适配
// ─────────────────────────────────────────────────────────────────────────────

const LONE_SURROGATE = /[\uD800-\uDFFF]/u;

/** 源:lib/server/stage-access.ts:75-78：绑定不了的 id 当「没有这门课」，不是 500。 */
function isQueryableStageId(stageId) {
  return typeof stageId === 'string' && !stageId.includes('\u0000') && !LONE_SURROGATE.test(stageId);
}

/** 源:stages/[id]/scenes/route.ts:116-119。 */
function isQueryableSceneId(sceneId) {
  return !sceneId.includes('\u0000') && !LONE_SURROGATE.test(sceneId);
}

/** 有没有「持久层」—— 上游这一族的第一行永远是 `if (!isServerPersistenceConfigured()) 404`。 */
function hasPersistence(deps) {
  const vault = port(deps, 'vault');
  return Boolean(vault?.classroom?.load) || Boolean(port(deps, 'stage'));
}

/**
 * `resolveStageAccess`（源:lib/server/stage-access.ts:110-142）的端口版。
 *
 * 优先 `ports.stage.access`；没注入时从 `vault.classroom.load` 的 `stage` + `stageMeta`
 * 两行推导（vault 的 `load` 正好同一次读里给这两行）。两行缺任一行 = 不存在。
 * `deletedAt` 非空 = 墓碑，与不存在同答案（不能让人确认「这个 id 曾经存在」）。
 */
async function resolveStageAccess(deps, stageId) {
  if (!isQueryableStageId(stageId)) return null;
  const stagePort = port(deps, 'stage');
  if (typeof stagePort?.access === 'function') return stagePort.access(stageId);

  const vault = port(deps, 'vault');
  if (!vault?.classroom?.load) return null;
  let doc;
  try {
    doc = await vault.classroom.load(stageId, { scenes: false });
  } catch (error) {
    if (isVaultNotFound(error)) return null;
    throw error;
  }
  if (!doc) return null;
  const meta = doc.stageMeta ?? null;
  const stage = doc.stage ?? doc.meta ?? null;
  if (!meta || meta.ownerId === undefined || meta.ownerId === null) return null;
  if (!stage || stage.name === undefined || stage.name === null) return null;
  if (meta.deletedAt) return null;
  return {
    stageId,
    ownerId: String(meta.ownerId),
    name: String(stage.name),
    isPublic: meta.isPublic === true,
    publishedAt: meta.publishedAt === undefined ? null : meta.publishedAt,
    generationComplete: meta.generationComplete === true,
    source: 'document',
    deletedAt: meta.deletedAt ?? null,
  };
}

/**
 * 文档 → 上游 `{ stage, scenes, outline }`（源:stages/[id]/route.ts:215-226 的
 * `store.loadDocument(id)`）。端口多给了 assets / assetRefs / stageMeta，这里不往外带：
 * 上游文档里没有这些键，带出去就是 body 漂移。
 */
function documentOf(doc) {
  return {
    stage: doc.stage ?? doc.meta ?? null,
    scenes: Array.isArray(doc.scenes) ? doc.scenes : [],
    outline: doc.outline ?? null,
  };
}

/**
 * 新鲜度 manifest（源:`getOwnerScopedDocumentStore().readFreshnessManifest`）。
 *
 * 上游的 `rev` 与每场景的 `rev` 由 DB 触发器维护（单调、与写入方式无关）；
 * 端口只有 `updatedAt`（毫秒），所以这里退化成 `updatedAt` —— 已记入差异。
 */
function manifestOf(doc) {
  const stage = doc.stage ?? doc.meta ?? null;
  const meta = doc.stageMeta ?? null;
  const rev = Number(stage?.rev ?? meta?.rev ?? stage?.updatedAt ?? 0) || 0;
  return {
    rev,
    scenes: (Array.isArray(doc.scenes) ? doc.scenes : []).map((scene) => ({
      id: scene.id,
      order: scene.order,
      rev: Number(scene.rev ?? scene.updatedAt ?? 0) || 0,
    })),
  };
}

/** 源:stages/[id]/manifest/route.ts:28-37 + `readFreshnessManifest`。 */
async function readManifest(vault, stageId) {
  if (!vault?.classroom?.load) return null;
  try {
    const doc = await vault.classroom.load(stageId, { scenes: true });
    if (!doc) return null;
    return manifestOf(doc);
  } catch (error) {
    if (isVaultNotFound(error)) return null;
    throw error;
  }
}

/** 源:store.ts:1170-1188：一门课正在被某个 run 生成时，别的写者只读。 */
async function findProducingRun(vault, stageId) {
  if (!vault?.runs?.list) return null;
  const rows = (await vault.runs.list({})) ?? [];
  return rows.find((run) => String(run.stageId ?? '') === String(stageId)
    && run.state !== 'completed' && run.state !== 'ended') ?? null;
}

/** 源:stages/route.ts:39-42。 */
function createStageId() {
  return `stage-${randomBytes(9).toString('base64url')}`;
}

/** 源:stages/[id]/route.ts:184-213（`mapSaveError`）的端口版。 */
function mapSaveError(error) {
  const code = vaultErrorCode(error);
  if (code === 'E_NOT_FOUND') return ownerNotFound();
  if (code === 'E_CONFLICT') {
    return ownerApiError(
      'INVALID_REQUEST',
      400,
      'document was written by a newer client; reload before saving',
      error?.message,
    );
  }
  if (code === 'E_INVALID_INPUT') {
    return ownerApiError('INVALID_REQUEST', 400, 'invalid stage document', error?.message);
  }
  if (code === 'E_FORBIDDEN') return ownerApiError('INVALID_REQUEST', 400, 'forbidden');
  throw error;
}

// ─────────────────────────────────────────────────────────────────────────────
// 挂载
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 把批 1 的 20 条 route 挂到 `service.generate` / `service.runs` / `service.stages`。
 *
 * `service.generate` 是**可调用的函数**（规范 §4 的 `generate(brief, opts)`），
 * 本批只往上挂 `capabilities` / `job` / `start` 三个方法，不整体替换 —— 见
 * `route-batches.md` 第 0 节。`service.generate` 本体仍是 `service.js` 里的空壳
 * （它抛 `E_NOT_IMPLEMENTED`），真正做事的是 `generate.start`。
 *
 * @param {object} service `createClassroomService` 的返回值
 * @param {object} deps `{ ports, log, dataDir, providerConfig }`
 */
export function mountGeneration(service, deps) {
  const log = deps?.log ?? {};
  const providerConfig = deps?.providerConfig ?? {};

  // ── generate ────────────────────────────────────────────────────────────

  /**
   * 源:generate-classroom/route.ts:30-83（POST）。
   *
   * Materials are owner-scoped, so the run is the request owner's: the same
   * owner that uploaded them. The owner is resolved before anything else so
   * every response, including a 400, carries its cookies (see
   * `withRequestOwner`).
   *
   * 返回上游的 202 body **加上** `{ runId, events }`：`events` 是
   * `ports.generate.stream(runId)` 原样透出的 `AsyncIterable`（表 1 的约定）。
   */
  async function start(brief, opts = {}) {
    const generate = port(deps, 'generate');
    if (typeof generate?.start !== 'function') {
      throw notImplemented(
        'zhiyunClassroomStudio.generate.start',
        'app/api/generate-classroom/route.ts:30-83',
      );
    }

    return withOwner(ownerDeps(deps), opts.request, async ({ ownerId }) => {
      const body = readBody(brief, MAX_START_BODY_BYTES);
      if (!body.ok) {
        return ownerApiError('INVALID_REQUEST', body.status, body.message);
      }
      const parsed = parseClassroomJobBody(body.value);
      if (!parsed.ok) return ownerApiError(parsed.code, 400, parsed.message);
      const input = parsed.input;

      try {
        const refused = await requiredModelRefusal(ownerId, opts.resolveStage ?? deps?.resolveStage);
        if (refused) return ownerApiError(refused.code, 400, refused.message);

        const started = await generate.start(input, opts.start ?? {});
        const run = await readRunForJob(generate, started);
        const response = ok(classroomJobView(run, {}, opts.origin ?? ''), 202);
        return {
          ...response,
          runId: started.runId,
          events: startEventStream(generate, started.runId),
        };
      } catch (error) {
        return startFailure(error, 'Failed to create classroom generation job');
      }
    });
  }

  /**
   * 源:generate-classroom/capabilities/route.ts:32-58（GET）。
   *
   * Read-only and owner-free. Every fact is derived, never restated：
   * `capabilities` is what the generation pipeline itself reads；`formats` 是
   * `WORKBENCH_MATERIAL_FORMATS` 里这台服务器**有 extractor 能读**的那些。
   */
  async function capabilities(opts = {}) {
    // The formats this caller's document and speech services can read.
    let extractable;
    let resolved;
    try {
      extractable = await resolveExtractable(deps, opts);
      resolved = await resolveGenerationCapabilities(providerConfig, opts);
    } catch (error) {
      // 上游 `mediaResolutionResponse(error, 'Capability discovery')` 认的是
      // `WorkspaceEndpointError`（模型配置层）；本包没有那个类型，只能原样抛（上游也是 throw）。
      throw error;
    }
    const limits = materialUploadLimits();
    return ok({
      capabilities: resolved,
      materials: {
        formats: WORKBENCH_MATERIAL_FORMATS.filter((format) => extractable.has(format.mime)),
        maxCount: MAX_CLASSROOM_MATERIALS,
        maxTotalBytes: MAX_CLASSROOM_MATERIAL_TOTAL_BYTES,
        maxDocumentBytes: limits.document,
        maxMediaBytes: limits.media,
      },
    });
  }

  /**
   * 源:generate-classroom/[jobId]/route.ts:24-56（GET）。
   *
   * The job, read from its generation run (the job id is the run id)；
   * 别的 owner 的 job 与不存在的 id 同答案（404 `INVALID_REQUEST`）。
   */
  async function job(jobId, opts = {}) {
    if (!/^[a-zA-Z0-9_-]+$/.test(String(jobId ?? ''))) {
      return ownerApiError('INVALID_REQUEST', 400, 'Invalid classroom generation job id');
    }

    return withOwner(ownerDeps(deps), opts.request, async () => {
      const generate = port(deps, 'generate');
      try {
        // The run and its media in one read, so the two agree.
        const read = isRunId(jobId) && generate?.get ? await generate.get(jobId) : null;
        if (!read) {
          return ownerApiError(
            'INVALID_REQUEST',
            404,
            'Classroom generation job not found',
          );
        }
        const run = runViewFromPort(read);
        const media = read?.media ?? {};
        return ok(classroomJobView(run, media, opts.origin ?? ''));
      } catch (error) {
        log.error?.(`Classroom job retrieval failed [jobId=${jobId}]:`, error?.message ?? error);
        return ownerApiError('INTERNAL_ERROR', 500, 'Failed to retrieve classroom generation job');
      }
    });
  }

  // ── runs ───────────────────────────────────────────────────────────────

  /**
   * 源:generation-runs/route.ts:83-106（GET `?active=1`）。
   *
   * The owner's active runs (every state but completed and ended), for course
   * cards, and the owner's `limits`，让客户端在传素材之前就知道会不会被拒。
   */
  async function list(opts = {}) {
    return withOwner(ownerDeps(deps), opts.request, async ({ ownerId }) => {
      const active = opts.active !== undefined ? opts.active : searchParam(opts, 'active');
      if (String(active ?? '') !== '1') {
        return ownerApiError('INVALID_REQUEST', 400, 'Only the active runs are listed: pass active=1');
      }
      const vault = port(deps, 'vault');
      if (!vault?.runs?.list) return ownerNotFound();
      const runs = (await vault.runs.list({ state: [...ACTIVE_RUN_STATES] }))
        .filter((run) => ownedBy(run, ownerId));
      const config = generationRunConfig();
      return ok({
        runs: runs.map(runSnapshot),
        limits: {
          maxActive: config.maxActiveRunsPerOwner,
          maxWaiting: config.maxWaitingRunsPerOwner,
        },
      });
    });
  }

  /**
   * 源:generation-runs/route.ts:43-81（POST）。
   *
   * No keys and no models: the owner's capability slots decide.
   * 返回 202 `{ run }` 加上 `{ runId, events }`（同 `generate.start`）。
   */
  async function startRun(body, opts = {}) {
    const generate = port(deps, 'generate');
    if (typeof generate?.start !== 'function') {
      throw notImplemented(
        'zhiyunClassroomStudio.runs.start',
        'app/api/generation-runs/route.ts:43-81',
      );
    }

    return withOwner(ownerDeps(deps), opts.request, async () => {
      const read = readBody(body, MAX_START_BODY_BYTES);
      if (!read.ok) return ownerApiError('INVALID_REQUEST', read.status, read.message);
      const parsed = parseRunInput(read.value);
      if (!parsed.ok) return ownerApiError('INVALID_REQUEST', 400, parsed.message);

      try {
        const started = await generate.start(parsed.value, opts.start ?? {});
        const run = await readRunForJob(generate, started);
        const response = ok({ run: runSnapshot(run) }, 202);
        return {
          ...response,
          runId: started.runId,
          events: startEventStream(generate, started.runId),
        };
      } catch (error) {
        return startFailure(error, 'Failed to start the generation run');
      }
    });
  }

  /**
   * 源:generation-runs/[id]/route.ts:42-76（GET）。
   *
   * The run's snapshot, with the `seq` of its last event; `media` holds the
   * state of every image and video the run has reached, by element id.
   */
  async function get(id, opts = {}) {
    return withOwner(ownerDeps(deps), opts.request, async ({ ownerId }) => {
      const vault = port(deps, 'vault');
      // The run and its media in one read, so the two agree.
      const read = isRunId(id) ? await readRunWithMedia(vault, id, ownerId) : null;
      if (!read) return ownerNotFound();
      const { details } = read;
      const snapshot = runSnapshot(read.run);
      const media = Object.fromEntries(
        Object.entries(runMediaStates(read.media)).map(([elementId, state]) => {
          const failureSeq = details.mediaFailureSeqs[elementId];
          return [
            elementId,
            (state.status === 'failed' || state.status === 'disabled') && failureSeq !== undefined
              ? { ...state, failureSeq }
              : state,
          ];
        }),
      );
      return ok({
        run: {
          ...snapshot,
          ...(snapshot.error && details.failureSeq !== null
            ? { error: { ...snapshot.error, failureSeq: details.failureSeq } }
            : {}),
          media,
          ...(details.materialKinds ? { materialKinds: details.materialKinds } : {}),
          ...(details.materialTruncated ? { materialTruncated: details.materialTruncated } : {}),
        },
      });
    });
  }

  /**
   * 源:generation-runs/[id]/route.ts:78-93（DELETE = discard）。
   *
   * Discard a run that has no course yet（它的课程卡就是那门待生成的课）：
   * 有课的 run 答 409 `RUN_STATE_CONFLICT`，删课才会结束它；重复 discard 同答案。
   */
  async function cancel(id, opts = {}) {
    return withOwner(ownerDeps(deps), opts.request, async ({ ownerId }) => {
      if (!isRunId(id)) return ownerNotFound();
      const vault = port(deps, 'vault');
      if (!vault?.runs?.get) return ownerNotFound();
      try {
        const result = await discardRun(vault, id, ownerId);
        if (!result) return ownerNotFound();
        // 端口能真取消就取消（上游这里只是 `discardGenerationRun`，worker 靠 lease 丢掉）。
        try {
          port(deps, 'generate')?.cancel?.(id);
        } catch (error) {
          log.warn?.(`取消 run ${id} 时生成端口报错（已忽略）`, error?.message ?? error);
        }
        return ok({ ...result });
      } catch (error) {
        if (error instanceof RunConflict) {
          return ownerApiError('RUN_STATE_CONFLICT', 409, error.message);
        }
        throw error;
      }
    });
  }

  /**
   * 源:generation-runs/[id]/confirm-outline/route.ts:37-66（POST）。
   */
  async function confirmOutline(id, body, opts = {}) {
    return withOwner(ownerDeps(deps), opts.request, async ({ ownerId }) => {
      if (!isRunId(id)) return ownerNotFound();
      const read = readBody(body, MAX_COMMAND_BODY_BYTES);
      if (!read.ok) return ownerApiError('INVALID_REQUEST', read.status, read.message);
      const parsed = makeParseConfirmOutline(deps)(read.value);
      if (!parsed.ok) return ownerApiError('INVALID_REQUEST', 400, parsed.message);
      const vault = port(deps, 'vault');
      if (!vault?.runs?.get) return ownerNotFound();
      try {
        const result = await confirmRunOutline(vault, id, ownerId, parsed.value, {
          maxActiveRunsPerOwner: generationRunConfig().maxActiveRunsPerOwner,
        });
        if (!result) return ownerNotFound();
        wakeGenerationRunner(deps, id, log);
        return ok({ ...result });
      } catch (error) {
        if (error instanceof ActiveRunLimit) {
          return ownerApiError('ACTIVE_RUN_LIMIT', 429, error.message);
        }
        if (error instanceof RunConflict) {
          return ownerApiError('RUN_STATE_CONFLICT', 409, error.message);
        }
        throw error;
      }
    });
  }

  /**
   * 源:generation-runs/[id]/events/route.ts:42-107（GET）。
   *
   * 成功返回 `AsyncIterable`；404 / 429 返回响应对象（见文件头）。
   */
  async function events(id, opts = {}) {
    const resolved = await ownerDeps(deps).owner.resolve(opts.request ?? {});
    if (resolved?.ok === false) {
      return {
        httpStatus: resolved.httpStatus ?? 401,
        body: resolved.body ?? NOT_FOUND,
        headers: resolved.headers ?? new Headers(),
      };
    }
    const ownerId = resolved.ownerId;
    const vault = port(deps, 'vault');
    if (!vault?.runs?.get) return ownerNotFound();
    const run = isRunId(id) ? await readRun(vault, id, ownerId) : null;
    if (!run) return plainResponse(404, NOT_FOUND, resolved.headers ?? new Headers());
    const release = acquireRunStreamSlot(ownerId);
    if (!release) {
      const headers = new Headers(resolved.headers ?? undefined);
      headers.set('Retry-After', '5');
      return plainResponse(429, 'Too many open generation run streams', headers);
    }

    const cursor = parseCursor(
      headerOf(opts.headers, 'last-event-id')
        // 上游读 `?after=`（字符串）；宿主层也接受已解析成数字的 `opts.after`。
        ?? (opts.after === undefined ? searchParam(opts, 'after') : String(opts.after)),
    );
    const inner = runEventStream({
      runId: id,
      readEvents: (runId, params) => vault.runs.events(runId, params),
      readRun: (runId) => readRun(vault, runId, ownerId),
      signal: opts.signal,
      after: cursor,
      pollIntervalMs: opts.pollIntervalMs ?? RUN_EVENTS_POLL_INTERVAL_MS,
      pageSize: opts.pageSize ?? PAGE,
      // 测试用终止开关（上游没有；`events.js` 的同名参数）。
      ...(opts.maxIdlePolls === undefined ? {} : { maxIdlePolls: opts.maxIdlePolls }),
    });
    return {
      async *[Symbol.asyncIterator]() {
        try {
          for await (const event of inner) yield event;
        } finally {
          release();
        }
      },
    };
  }

  /**
   * 源:generation-runs/events/route.ts:35-82（GET，跨 run 的事件流）。
   *
   * one `runs` frame with every active run at attach, then a `run` frame with a
   * run's snapshot each time it changes。上游靠 `NOTIFY` 唤醒 + 30s 兜底轮询；
   * 端口没有通知通道，这里只有轮询（`events.js` 已记这条）。
   */
  async function allEvents(opts = {}) {
    const resolved = await ownerDeps(deps).owner.resolve(opts.request ?? {});
    if (resolved?.ok === false) {
      return {
        httpStatus: resolved.httpStatus ?? 401,
        body: resolved.body ?? NOT_FOUND,
        headers: resolved.headers ?? new Headers(),
      };
    }
    const ownerId = resolved.ownerId;
    const release = acquireRunStreamSlot(ownerId);
    if (!release) {
      const headers = new Headers(resolved.headers ?? undefined);
      headers.set('Retry-After', '5');
      return plainResponse(429, 'Too many open generation run streams', headers);
    }

    const vault = port(deps, 'vault');
    const signal = opts.signal;
    const pollIntervalMs = opts.pollIntervalMs ?? OWNER_RUN_EVENTS_POLL_INTERVAL_MS;
    const maxPolls = opts.maxPolls ?? Number.POSITIVE_INFINITY;

    return {
      async *[Symbol.asyncIterator]() {
        try {
          // 没有持久层 = 没有 run 可报：给一条空快照就结束，不编数据。
          if (!vault?.runs?.list) {
            yield { type: 'runs', ts: Date.now(), data: { type: 'runs', runs: [] } };
            return;
          }
          // The last seq sent per run: a run is sent again only when it moved on.
          const sent = new Map();
          let newest = Date.now();
          let snapshotSent = false;
          let polls = 0;

          for (;;) {
            if (signal?.aborted) return;
            if (!snapshotSent) {
              const active = (await vault.runs.list({ state: [...ACTIVE_RUN_STATES] }))
                .filter((run) => ownedBy(run, ownerId));
              yield { type: 'runs', ts: Date.now(), data: { type: 'runs', runs: active.map(runSnapshot) } };
              for (const run of active) sent.set(run.id, Number(run.seq ?? 0));
              snapshotSent = true;
            } else {
              const changed = await listRunsUpdatedSince(vault, ownerId, newest - COMMIT_SKEW_MS);
              // In commit order; the cursor moves only past a frame actually yielded.
              for (const run of changed) {
                if ((sent.get(run.id) ?? -1) < Number(run.seq ?? 0)) {
                  yield { type: 'run', ts: Date.now(), data: { type: 'run', run: runSnapshot(run) } };
                  sent.set(run.id, Number(run.seq ?? 0));
                }
                const stamp = Date.parse(run.updatedAt);
                if (Number.isFinite(stamp)) newest = Math.max(newest, stamp);
              }
            }

            polls += 1;
            if (polls >= maxPolls) return;
            if (!(pollIntervalMs > 0)) return;
            await sleep(pollIntervalMs, signal);
          }
        } finally {
          release();
        }
      },
    };
  }

  /**
   * 源:generation-runs/[id]/hold-outline/route.ts:33-54（POST）。
   */
  async function holdOutline(id, body, opts = {}) {
    return withOwner(ownerDeps(deps), opts.request, async ({ ownerId }) => {
      if (!isRunId(id)) return ownerNotFound();
      const read = readBody(body, MAX_COMMAND_BODY_BYTES);
      if (!read.ok) return ownerApiError('INVALID_REQUEST', read.status, read.message);
      const parsed = parseHoldOutline(read.value);
      if (!parsed.ok) return ownerApiError('INVALID_REQUEST', 400, parsed.message);
      const vault = port(deps, 'vault');
      if (!vault?.runs?.get) return ownerNotFound();
      try {
        const result = await holdRunOutline(vault, id, ownerId, parsed.value);
        if (!result) return ownerNotFound();
        return ok({ ...result });
      } catch (error) {
        if (error instanceof RunConflict) {
          return ownerApiError('RUN_STATE_CONFLICT', 409, error.message);
        }
        throw error;
      }
    });
  }

  /**
   * 源:generation-runs/[id]/retry/route.ts:41-73（POST）。
   *
   * 端口 `generate.resume` 优先（表 10 的备注）：能从 checkpoint 续跑的 run
   * 交回生成端口，别的仍走 run 行上的状态机。
   */
  async function retry(id, body, opts = {}) {
    return withOwner(ownerDeps(deps), opts.request, async ({ ownerId }) => {
      if (!isRunId(id)) return ownerNotFound();
      const read = readBody(body, MAX_COMMAND_BODY_BYTES);
      if (!read.ok) return ownerApiError('INVALID_REQUEST', read.status, read.message);
      const command = parseRetry(read.value);
      if (!command.ok) return ownerApiError('INVALID_REQUEST', 400, command.message);

      const vault = port(deps, 'vault');
      if (!vault?.runs?.get) return ownerNotFound();

      try {
        const result = await retryRun(vault, id, ownerId, command.value, {
          maxActiveRunsPerOwner: generationRunConfig().maxActiveRunsPerOwner,
        });
        if (!result) return ownerNotFound();
        wakeGenerationRunner(deps, id, log);
        return ok({ ...result });
      } catch (error) {
        if (error instanceof RunConflict) {
          return ownerApiError('RUN_STATE_CONFLICT', 409, error.message);
        }
        if (error instanceof ActiveRunLimit) {
          return ownerApiError('ACTIVE_RUN_LIMIT', 429, error.message);
        }
        throw error;
      }
    });
  }

  // ── stages ──────────────────────────────────────────────────────────────

  /**
   * 源:stages/route.ts:47-64（GET）：调用方的课程库。
   *
   * 默认是 owner 的全部 stage 文档；宿主库 provider 可以换一套可读集合
   * （`ports.stage.library`，源:lib/persistence/library.ts 的访问规则）。
   */
  async function listStages(opts = {}) {
    if (!hasPersistence(deps)) return plainResponse(404, NOT_FOUND);
    return withOwner(ownerDeps(deps), opts.request, async ({ ownerId }) => {
      const vault = port(deps, 'vault');
      if (!vault?.classroom?.list) return ownerNotFound();
      const page = await vault.classroom.list({});
      const ownedStages = Array.isArray(page) ? page : (page?.items ?? []);
      const library = port(deps, 'stage')?.library;
      if (typeof library !== 'function') return ok({ stages: ownedStages });
      const stages = await library({
        ownerId,
        ownedStageIds: async () => ownedStages.map((stage) => stage.id),
      });
      return ok({ stages });
    });
  }

  /**
   * 源:stages/route.ts:71-148（POST）：建一个 stage 文档壳 `{ name, description? }`。
   *
   * Validation happens before owner resolution：畸形 body 不该为一个不会成功的请求
   * 铸出一个匿名 cookie 分区。
   */
  async function createStage(body, opts = {}) {
    if (!hasPersistence(deps)) return plainResponse(404, NOT_FOUND);

    const raw = record(body);
    if (!raw) {
      return readBodyFailed(body)
        ? ownerApiError('INVALID_REQUEST', 400, 'invalid JSON body')
        : ownerApiError('INVALID_REQUEST', 400, 'request body must be a JSON object');
    }
    const { name, description } = raw;
    if (typeof name !== 'string' || name.trim().length === 0) {
      return ownerApiError('MISSING_REQUIRED_FIELD', 400, 'name is required');
    }
    const trimmedName = name.trim();
    if (trimmedName.length > STAGE_NAME_MAX_LENGTH) {
      return ownerApiError(
        'INVALID_REQUEST',
        400,
        `name exceeds the ${STAGE_NAME_MAX_LENGTH} character limit`,
      );
    }
    if (description !== undefined && typeof description !== 'string') {
      return ownerApiError('INVALID_REQUEST', 400, 'description must be a string when present');
    }
    const trimmedDescription = description?.trim();

    return withOwner(ownerDeps(deps), opts.request, async () => {
      const id = createStageId();
      const now = Date.now();
      const outline = {
        outlines: [],
        requirement: trimmedName,
        generationComplete: false,
        createdAt: now,
        updatedAt: now,
      };
      const vault = port(deps, 'vault');
      try {
        await vault.classroom.create({
          stage: {
            id,
            name: trimmedName,
            ...(trimmedDescription ? { description: trimmedDescription } : {}),
            createdAt: now,
            updatedAt: now,
          },
          scenes: [],
          outline,
        });
      } catch (error) {
        // A retired identity (claimed into an account), or a host's
        // authorizeCreate refusal; nothing was written either way.
        if (vaultErrorCode(error) === 'E_FORBIDDEN') {
          return ownerApiError('CREATE_REFUSED', 403, error?.message ?? 'create refused');
        }
        throw error;
      }
      return ownerJson(
        {
          stage: {
            id,
            name: trimmedName,
            ...(trimmedDescription ? { description: trimmedDescription } : {}),
            createdAt: now,
            updatedAt: now,
            sceneCount: 0,
          },
        },
        201,
      );
    });
  }

  /**
   * 源:stages/[id]/route.ts:68-78（GET）：整份文档（stage + scenes + outline）。
   *
   * Ownership is enforced by the store itself, not by a pre-check：别人的和不存在的 id
   * 答同一个 404（no-existence-oracle）。
   */
  async function getStage(id, opts = {}) {
    if (!hasPersistence(deps)) return plainResponse(404, NOT_FOUND);
    return withOwner(ownerDeps(deps), opts.request, async () => {
      const vault = port(deps, 'vault');
      let document;
      if (!vault?.classroom?.load) return ownerNotFound();
      try {
        document = await vault.classroom.load(id, { scenes: true });
      } catch (error) {
        if (isVaultNotFound(error)) return ownerNotFound();
        throw error;
      }
      if (!document) return ownerNotFound();
      // 别人的课：vault 用 `errors[].code === 'E_FORBIDDEN'` 表达，对外仍是 404。
      if ((document.errors ?? []).some((entry) => entry?.code === 'E_FORBIDDEN')) return ownerNotFound();
      return ownerJson(documentOf(document), 200);
    });
  }

  /**
   * 源:stages/[id]/route.ts:81-118（PATCH）：改名（表里没给方法名，见 `ROUTES.md` §5）。
   */
  async function patchStage(id, body, opts = {}) {
    if (!hasPersistence(deps)) return plainResponse(404, NOT_FOUND);

    if (body === undefined || body === null) {
      return ownerApiError('INVALID_REQUEST', 400, 'invalid JSON body');
    }
    const rawName = record(body)?.name;
    if (typeof rawName !== 'string' || rawName.trim().length === 0) {
      return ownerApiError('INVALID_REQUEST', 400, 'name must be a non-empty string');
    }
    const name = rawName.trim();
    if (name.length > STAGE_NAME_MAX_LENGTH) {
      return ownerApiError(
        'INVALID_REQUEST',
        400,
        `name exceeds the ${STAGE_NAME_MAX_LENGTH} character limit`,
      );
    }

    return withOwner(ownerDeps(deps), opts.request, async () => {
      const vault = port(deps, 'vault');
      let document;
      if (!vault?.classroom?.load) return ownerNotFound();
      try {
        document = await vault.classroom.load(id, { scenes: true });
      } catch (error) {
        if (isVaultNotFound(error)) return ownerNotFound();
        throw error;
      }
      if (!document) return ownerNotFound();
      try {
        await vault.classroom.save(id, {
          ...documentOf(document),
          stage: { ...(document.stage ?? document.meta), name, updatedAt: Date.now() },
        });
      } catch (error) {
        return mapSaveError(error);
      }
      return ownerJson({ success: true, name }, 200);
    });
  }

  /**
   * 源:stages/[id]/route.ts:121-180（PUT）：整份保存 `{ stage, scenes, outline? }`。
   *
   * Save is existence-gated：PUT 更新一门**已存在**的课；不能复活被删的课，
   * 也不能用客户端给的 id 铸一门新课。
   */
  async function putStage(id, doc, opts = {}) {
    if (!hasPersistence(deps)) return plainResponse(404, NOT_FOUND);

    const candidate = record(doc);
    if (
      !candidate
      || !record(candidate.stage)
      || typeof candidate.stage.id !== 'string'
      || !Array.isArray(candidate.scenes)
    ) {
      return ownerApiError(
        'INVALID_REQUEST',
        400,
        'request body must be a stage document with `stage` and `scenes`',
      );
    }

    return withOwner(ownerDeps(deps), opts.request, async () => {
      if (candidate.stage.id !== id) {
        return ownerApiError(
          'INVALID_REQUEST',
          400,
          'document stage id does not match the requested stage',
        );
      }
      const vault = port(deps, 'vault');
      if (!vault?.classroom?.load) return ownerNotFound();
      const existing = await vault.classroom.load(id, { scenes: false }).catch((error) => {
        if (isVaultNotFound(error)) return null;
        throw error;
      });
      if (!existing) return ownerNotFound();
      try {
        // The server is authoritative for "last modified"：bumping updatedAt
        // keeps the manifest/freshness signal accurate for this route's writes.
        await vault.classroom.save(id, {
          ...candidate,
          stage: { ...candidate.stage, updatedAt: Date.now() },
        });
      } catch (error) {
        return mapSaveError(error);
      }
      return ownerJson({ success: true }, 200);
    });
  }

  /**
   * 源:stages/[id]/route.ts:183-198（DELETE）：删课（级联子行由存储负责）。
   */
  async function removeStage(id, opts = {}) {
    if (!hasPersistence(deps)) return plainResponse(404, NOT_FOUND);
    return withOwner(ownerDeps(deps), opts.request, async () => {
      const vault = port(deps, 'vault');
      if (!vault?.classroom?.remove) return ownerNotFound();
      try {
        await vault.classroom.remove(id);
      } catch (error) {
        if (isVaultNotFound(error)) return ownerNotFound();
        throw error;
      }
      return ownerJson({ ok: true }, 200);
    });
  }

  /**
   * 源:stages/[id]/freshness/route.ts:44-154（GET）。
   *
   * SSE 的 `retry:` 与 25s 心跳是**传输层**的（`events.js` 定的形状里没有它们），
   * 由 HTTP 桥补；这里只产出 `stage_freshness` 事件。`maxPolls` 是测试用的
   * 终止开关（同 `events.js` 的 `maxIdlePolls`）：默认不结束。
   */
  async function freshness(id, opts = {}) {
    if (!hasPersistence(deps)) return plainResponse(404, NOT_FOUND);
    return withOwner(ownerDeps(deps), opts.request, async () => {
      const vault = port(deps, 'vault');
      // Existence-gated, exactly like the manifest route.
      const initial = await readManifest(vault, id);
      if (!initial) return ownerNotFound();

      const signal = opts.signal;
      const pollIntervalMs = opts.pollIntervalMs ?? STAGE_FRESHNESS_POLL_INTERVAL_MS;
      const maxPolls = opts.maxPolls ?? Number.POSITIVE_INFINITY;
      const stageId = id;

      return {
        headers: new Headers(),
        async *[Symbol.asyncIterator]() {
          let lastRev = 0;
          let polls = 0;
          for (;;) {
            if (signal?.aborted) return;
            // A read failure sends rev 0（never a terminal state：课总能再写一次）。
            let rev = 0;
            try {
              const manifest = await readManifest(vault, stageId);
              rev = manifest ? manifest.rev : 0;
            } catch {
              // Fall through to the rev-0 frame.
            }
            if (rev !== lastRev) {
              lastRev = rev;
              yield {
                type: 'stage_freshness',
                ts: Date.now(),
                data: { type: 'stage_freshness', stageId, rev },
              };
            }
            polls += 1;
            if (polls >= maxPolls) return;
            if (!(pollIntervalMs > 0)) return;
            await sleep(pollIntervalMs, signal);
          }
        },
      };
    });
  }

  /**
   * 源:stages/[id]/generation-complete/route.ts:25-75（POST）。
   *
   * 单调地把 outline 标成 generation-complete。上游是一条窄 UPDATE，好让
   * 过期的 load-time 修复盖不掉更新的课堂内容；端口只有整份 `classroom.save`，
   * 所以这里「读 → 只改这一个标志 → 写」—— 已记入差异（可能与并发的整份保存互相覆盖）。
   */
  async function markComplete(id, body, opts = {}) {
    if (!hasPersistence(deps)) return plainResponse(404, NOT_FOUND);
    void body;

    return withOwner(ownerDeps(deps), opts.request, async ({ ownerId }) => {
      try {
        const access = await resolveStageAccess(deps, id);
        // Absent and tombstoned are the same 404.
        if (!access) return ownerJson({ error: 'not_found' }, 404);
        // Owner only.
        if (String(access.ownerId) !== String(ownerId)) return ownerJson({ error: 'forbidden' }, 403);

        const vault = port(deps, 'vault');
        // 上游在课的所有权行上做，run 的每次提交也take 同一把锁。
        const producing = await findProducingRun(vault, id);
        if (producing) {
          return ownerJson({ error: { code: 'COURSE_GENERATING', message: COURSE_GENERATING_MESSAGE } }, 409);
        }

        const stagePort = port(deps, 'stage');
        let touched;
        if (typeof stagePort?.markComplete === 'function') {
          touched = await stagePort.markComplete(id);
        } else if (vault?.classroom?.load && vault?.classroom?.save) {
          const document = await vault.classroom.load(id, { scenes: true });
          if (!document) touched = false;
          else {
            // `markStageGenerationComplete` 只改 `stage_meta.generation_complete` 这一列；
            // 端口没有窄更新，所以「读 → 改这个标志（连同 outline 上的镜像）→ 整份写回」。
            await vault.classroom.save(id, {
              ...documentOf(document),
              ...(document.stageMeta
                ? { stageMeta: { ...document.stageMeta, generationComplete: true } }
                : {}),
              outline: { ...(document.outline ?? {}), generationComplete: true, updatedAt: Date.now() },
            });
            touched = true;
          }
        } else {
          touched = false;
        }

        if (!touched) return ownerJson({ error: 'not_found' }, 404);
        log.info?.('Stage generation marked complete', { stageId: id, ownerId });
        return ownerJson({ ok: true }, 200);
      } catch (error) {
        log.error?.('Failed to mark stage generation complete', {
          stageId: id,
          error: error?.message ?? String(error),
        });
        return ownerJson({ error: 'internal_error' }, 500);
      }
    });
  }

  /**
   * 源:stages/[id]/manifest/route.ts:28-37（GET）：`{ rev, scenes: [{id, order, rev}] }`。
   */
  async function manifest(id, opts = {}) {
    if (!hasPersistence(deps)) return plainResponse(404, NOT_FOUND);
    return withOwner(ownerDeps(deps), opts.request, async () => {
      const value = await readManifest(port(deps, 'vault'), id);
      if (!value) return ownerNotFound();
      return ownerJson(value, 200);
    });
  }

  /**
   * 源:stages/[id]/publish/route.ts:24-76（POST）：把文档化的课变成公开课。
   *
   * Owner-only, and only for a principal holding the `course:publish` role：
   * 匿名 owner 答 `login_required`（公开课是持久的公开产物，需要真账号），
   * 其它没有该角色的 principal 答 `forbidden`。
   */
  async function publish(id, body, opts = {}) {
    if (!hasPersistence(deps)) return plainResponse(404, NOT_FOUND);
    void body;
    const stagePort = port(deps, 'stage');
    if (typeof stagePort?.setPublished !== 'function') {
      throw notImplemented(
        'zhiyunClassroomStudio.stages.publish',
        'lib/persistence/stage-meta.ts（端口 ports.stage.setPublished 未注入）',
      );
    }

    return withPrincipal(deps, opts.request, async (principal) => {
      const { ownerId } = principal;
      try {
        const refused = refusePublish(principal);
        if (refused) return refused;

        const access = await resolveStageAccess(deps, id);
        if (!access) return ownerJson({ error: 'not_found' }, 404);
        if (String(access.ownerId) !== String(ownerId)) return ownerJson({ error: 'forbidden' }, 403);

        if (access.isPublic) {
          return ownerJson({ success: true, publishedAt: access.publishedAt, name: access.name }, 200);
        }

        const publishedAt = Date.now();
        await stagePort.setPublished(id, true, publishedAt);
        log.info?.('Stage published', { stageId: id, ownerId });
        return ownerJson({ success: true, publishedAt, name: access.name }, 200);
      } catch (error) {
        log.error?.('Failed to publish stage', { stageId: id, error: error?.message ?? String(error) });
        return ownerJson({ error: 'internal_error' }, 500);
      }
    });
  }

  /**
   * 源:stages/[id]/unpublish/route.ts:21-62（POST）：把课变回私有。
   */
  async function unpublish(id, body, opts = {}) {
    if (!hasPersistence(deps)) return plainResponse(404, NOT_FOUND);
    void body;
    const stagePort = port(deps, 'stage');
    if (typeof stagePort?.setPublished !== 'function') {
      throw notImplemented(
        'zhiyunClassroomStudio.stages.unpublish',
        'lib/persistence/stage-meta.ts（端口 ports.stage.setPublished 未注入）',
      );
    }

    return withPrincipal(deps, opts.request, async (principal) => {
      const { ownerId } = principal;
      try {
        const refused = refusePublish(principal);
        if (refused) return refused;

        const access = await resolveStageAccess(deps, id);
        if (!access) return ownerJson({ error: 'not_found' }, 404);
        if (String(access.ownerId) !== String(ownerId)) return ownerJson({ error: 'forbidden' }, 403);

        await stagePort.setPublished(id, false, null);
        log.info?.('Stage unpublished', { stageId: id, ownerId });
        return ownerJson({ success: true }, 200);
      } catch (error) {
        log.error?.('Failed to unpublish stage', { stageId: id, error: error?.message ?? String(error) });
        return ownerJson({ error: 'internal_error' }, 500);
      }
    });
  }

  /**
   * 源:stages/[id]/scenes/route.ts:48-80（GET `?ids=a,b,c`）：只回被点名的场景，
   * 按文档（`scene_order`）顺序 —— workbench manifest 同步的「窄重取」那一半。
   */
  async function scenes(id, opts = {}) {
    if (!hasPersistence(deps)) return plainResponse(404, NOT_FOUND);

    const rawIds = opts.ids !== undefined ? opts.ids : searchParam(opts, 'ids');
    const requested = (rawIds ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
      // Dedupe: a repeated id is the same scene; counting it twice would also
      // inflate the bound check.
      .filter((value, index, all) => all.indexOf(value) === index)
      .filter(isQueryableSceneId);
    if (requested.length === 0) {
      return ownerApiError('INVALID_REQUEST', 400, 'empty_scene_ids');
    }
    if (requested.length > MAX_BATCH_SCENE_IDS) {
      return ownerApiError(
        'INVALID_REQUEST',
        400,
        'too_many_scene_ids',
        `limit ${MAX_BATCH_SCENE_IDS}, requested ${requested.length}`,
      );
    }

    return withOwner(ownerDeps(deps), opts.request, async () => {
      const vault = port(deps, 'vault');
      let document;
      if (!vault?.classroom?.load) return ownerNotFound();
      try {
        document = await vault.classroom.load(id, { scenes: true });
      } catch (error) {
        if (isVaultNotFound(error)) return ownerNotFound();
        throw error;
      }
      if (!document) return ownerNotFound();
      const wanted = new Set(requested);
      const list = (document.scenes ?? []).filter((scene) => wanted.has(scene.id));
      return ownerJson({ scenes: list }, 200);
    });
  }

  /**
   * 表 17 的 POST 半边。**上游 `stages/[id]/scenes/route.ts` 只有 GET**（81 行，
   * 见 `ROUTES.md` §5）；没有 handler body 可搬，所以这里不编一个写入语义，
   * 直接抛 `E_NOT_IMPLEMENTED` 并把来源指到那个文件。
   */
  async function putScenes(id, body, opts = {}) {
    void id;
    void body;
    void opts;
    throw notImplemented(
      'zhiyunClassroomStudio.stages.putScenes',
      'app/api/stages/[id]/scenes/route.ts（上游只有 GET，没有 POST）',
    );
  }

  /**
   * 源:stages/[id]/status/route.ts:21-44（GET）。
   *
   * 公开状态元数据，**不需要 auth**：任何拿到 id 的人都能读它的公开标志。
   * 墓碑与从未存在不可区分（否则这个匿名端点就成了「这个 id 曾经存在」的探针）。
   * 约定：snake_case 错误码（`not_found` / `internal_error`）。
   */
  async function status(id, opts = {}) {
    if (!hasPersistence(deps)) return plainResponse(404, NOT_FOUND);
    void opts;
    try {
      const access = await resolveStageAccess(deps, id);
      if (!access) return ownerJson({ error: 'not_found' }, 404);
      // Field names are the wire contract：`isPublic` / `publishedAt`，与哪一层答的无关。
      return ownerJson({ isPublic: access.isPublic, publishedAt: access.publishedAt }, 200);
    } catch (error) {
      log.error?.('Failed to fetch stage status', {
        stageId: id,
        error: error?.message ?? String(error),
      });
      return ownerJson({ error: 'internal_error' }, 500);
    }
  }

  /**
   * 源:stage-meta/[stageId]/route.ts:39-88（GET）。
   *
   * 文档不带、但每个**看的人**都需要的事实（`isOwner` 决定只读还是可编辑）。
   * 响应里**永不出现 ownerId**：`isOwner` 是服务端算出来的布尔，
   * 回 owner 的标识符等于给每个访客一个跨课程稳定的作者 ID。
   */
  async function stageMeta(stageId, opts = {}) {
    if (!hasPersistence(deps)) return plainResponse(404, NOT_FOUND);
    return withOwner(ownerDeps(deps), opts.request, async ({ ownerId }) => {
      try {
        const access = await resolveStageAccess(deps, stageId);
        // Absent or tombstoned — indistinguishable, deliberately.
        if (!access) return ownerJson({ error: 'not_found' }, 404);
        // Identity comparison, and nothing else.
        const isOwner = String(access.ownerId) === String(ownerId);
        return ownerJson(
          {
            isOwner,
            isPublic: access.isPublic,
            publishedAt: access.publishedAt,
            generationComplete: access.generationComplete,
            // Which layer answered. Diagnostic only — the client must not branch on it.
            source: access.source,
          },
          200,
        );
      } catch (error) {
        log.error?.('Failed to resolve stage meta', {
          stageId,
          error: error?.message ?? String(error),
        });
        return ownerJson({ error: 'internal_error' }, 500);
      }
    });
  }

  // ── 挂载（不整体替换已有实现）────────────────────────────────────────────

  // `service.generate` 必须保持**可调用**（规范 §4 的 `generate(brief, opts)`），
  // 所以主体换成 `start` 的委托，方法挂在函数上。返回值同时带 route 信封
  // （`httpStatus` / `body`）与契约字段（`runId` / `events`），两种消费方都能用。
  const generateEntry = (brief, opts) => start(brief, opts);
  service.generate = Object.assign(generateEntry, { capabilities, job, start });
  service.runs = Object.assign(service.runs ?? {}, {
    list,
    start: startRun,
    get,
    cancel,
    confirmOutline,
    events,
    allEvents,
    holdOutline,
    retry,
  });
  service.stages = Object.assign(service.stages ?? {}, {
    list: listStages,
    create: createStage,
    get: getStage,
    put: putStage,
    patch: patchStage,
    remove: removeStage,
    freshness,
    markComplete,
    manifest,
    publish,
    scenes,
    putScenes,
    status,
    unpublish,
    meta: stageMeta,
  });

  return service;
}

// ─────────────────────────────────────────────────────────────────────────────
// 挂载里用到的、不依赖 service 的部分
// ─────────────────────────────────────────────────────────────────────────────

/** 请求体读失败还是「不是对象」—— 两者在 stages POST 里是两条不同的 400 文案。 */
function readBodyFailed(body) {
  return body === undefined || body === null;
}

/**
 * `startRefusal`（源:store.ts:52-75）的端口版。
 *
 * 上游认的是 `ModelAuthorizationError` / `ClassroomMaterialsRejectedError` /
 * `ActiveRunLimitError` / `GenerationStartRefusedError` 这些**领域错误类**；
 * 生成端口抛的是自己的 `ClassroomGenerateError`（`code` 是封闭枚举），
 * 所以这里按它在 `errors.js` 里定的 `code` 分支：
 *
 * | 端口的 code | 上游对应的拒绝 |
 * |---|---|
 * | `E_INVALID_INPUT` | 400 `INVALID_REQUEST`（素材被拒 / agent 不认识） |
 * | `E_MISSING_SERVICE` / `E_NO_LLM_PROVIDER` / `E_NO_LLM_TRANSPORT` | 400 `MISSING_MODEL`（上游「这个 run 需要的模型没配」） |
 * | `E_NOT_FOUND` | 404 `INVALID_REQUEST`（run 不存在，与上游 job 轮询同答案） |
 * | 其它 | 500 `INTERNAL_ERROR` + 上游那句固定文案（错误文本不上线） |
 */
function startFailure(error, fallbackMessage) {
  const code = String(error?.code ?? error?.kind ?? '');
  if (code === 'E_INVALID_INPUT') {
    return ownerApiError('INVALID_REQUEST', 400, error?.message ?? 'Invalid request');
  }
  if (code === 'E_MISSING_SERVICE' || code === 'E_NO_LLM_PROVIDER' || code === 'E_NO_LLM_TRANSPORT') {
    return ownerApiError('MISSING_MODEL', 400, error?.message ?? 'No model is configured');
  }
  if (code === 'E_NOT_FOUND') {
    return ownerApiError('INVALID_REQUEST', 404, error?.message ?? 'Not found');
  }
  return ownerApiError('INTERNAL_ERROR', 500, fallbackMessage);
}

/** `classroomJobView` 要一条 run；端口给了完整 run 就用，否则用它的快照。 */
async function readRunForJob(generate, started) {
  if (started?.run) return started.run;
  if (typeof generate?.get === 'function' && started?.runId) {
    try {
      const snapshot = await generate.get(started.runId);
      if (snapshot) return runViewFromPort(snapshot);
    } catch {
      // 读不到快照不是失败：start 已经返回了 id 与状态，用它建视图。
    }
  }
  return runViewFromPort(started);
}

/** `ports.generate.stream(runId)`；端口没给流就返回一个空流（不抛 —— start 已经成功了）。 */
function startEventStream(generate, runId) {
  try {
    if (typeof generate?.stream === 'function') return generate.stream(runId);
  } catch {
    // 落到空流
  }
  return emptyEventStream();
}

/** `resolveExtractableMimeTypes({ ownerId, forward: false })`（源:material-extraction/availability.ts）。 */
async function resolveExtractable(deps, opts) {
  const media = port(deps, 'media');
  if (typeof media?.extractableMimeTypes !== 'function') return new Set();
  const list = await media.extractableMimeTypes({ ownerId: opts.ownerId ?? null, forward: false });
  return new Set(list ?? []);
}

/**
 * `resolveServerGenerationCapabilities(workspaceId)`（源:lib/server/generation-capabilities.ts:36-46）。
 * 槽位解析要读 workspace 的模型配置：注入 `providerConfig.getCapabilities` 就是真数据，
 * 没注入时是 `degradedGenerationCapabilities()`（上游「一个槽位都解析不出来」的同答案）。
 */
async function resolveGenerationCapabilities(providerConfig, opts) {
  if (typeof providerConfig?.getCapabilities === 'function') {
    return providerConfig.getCapabilities(opts.workspaceId ?? opts.ownerId ?? null);
  }
  return degradedGenerationCapabilities();
}

/** `acquireRunStreamSlot` 的释放钩子 + `wakeGenerationRunner()`（源:run/runner.ts）。 */
function wakeGenerationRunner(deps, runId, log) {
  try {
    // 生成端口把这个 run 放在自己内存里时，`resume` 就是从确认点接着跑的那一下；
    // 上游这里是 `wakeGenerationRunner()`（叫醒扫描器），语义同一件事。
    port(deps, 'generate')?.resume?.(runId)?.catch?.((error) => {
      log?.warn?.(`唤醒 run ${runId} 失败（已忽略）`, error?.message ?? error);
    });
  } catch (error) {
    log?.warn?.(`唤醒 run ${runId} 失败（已忽略）`, error?.message ?? error);
  }
}

/** 源:generation-runs/[id]/events/route.ts:131-133。 */
function parseCursor(value) {
  return value && /^\d{1,15}$/.test(value) ? Number(value) : 0;
}

/** `listGenerationRunsUpdatedSince`（源:store.ts:751-763）：端口没有时间过滤，在这里筛。 */
async function listRunsUpdatedSince(vault, ownerId, since) {
  if (!vault?.runs?.list) return [];
  const rows = (await vault.runs.list({})) ?? [];
  return rows
    .filter((run) => ownedBy(run, ownerId))
    .filter((run) => {
      const stamp = Date.parse(run.updatedAt);
      return !Number.isFinite(stamp) || stamp > since;
    })
    .sort((a, b) => (Date.parse(a.updatedAt) || 0) - (Date.parse(b.updatedAt) || 0));
}

/** 源:store.ts:643-708（`readGenerationRunWithMedia`）：run + 媒体 + 日志细节，一次读里对齐。 */
async function readRunWithMedia(vault, runId, ownerId) {
  if (!vault?.runs?.get) return null;
  const run = await readRun(vault, runId, ownerId);
  if (!run) return null;
  const media = await readRunMedia(vault, runId);
  const details = await readRunLogDetails(vault, runId);
  return { run, media, details };
}

/** 源:store.ts:1677-1711（`discardGenerationRun`）：不是按 commandId 幂等的命令，只有状态机。 */
async function discardRun(vault, runId, ownerId) {
  const run = await readRun(vault, runId, ownerId);
  if (!run) return null;
  if (run.stageId) {
    throw new RunConflict('course-exists', 'The run already has its course; delete the course to end the run');
  }
  if (run.state === 'ended') return { state: 'ended', seq: Number(run.seq ?? 0) };
  if (run.state === 'completed') {
    throw new RunConflict('state', 'The run is completed');
  }
  const updated = await vault.runs.patch(runId, { state: 'ended' });
  const seq = await appendEvent(vault, runId, {
    type: 'state',
    data: { state: 'ended', step: updated?.step ?? null },
  });
  return { state: 'ended', seq };
}

/** 源:store.ts:1400-1465（`confirmGenerationRunOutline`）。 */
async function confirmRunOutline(vault, runId, ownerId, command, options) {
  return runCommand(vault, runId, ownerId, command.commandId, 'confirm-outline', async (run) => {
    if (run.state !== 'awaiting_outline_confirmation' || !run.outline) {
      throw new RunConflict(
        'state',
        `The run is ${String(run.state).replaceAll('_', ' ')}, not waiting for its outline to be confirmed`,
      );
    }
    if (command.outlineRevision !== run.outlineRevision) {
      throw new RunConflict(
        'outline-revision',
        `The outline is at revision ${run.outlineRevision}, not ${command.outlineRevision}`,
      );
    }
    // The run is confirmable: whether the owner may run one more decides.
    await enforceActiveRunLimit(vault, ownerId, options.maxActiveRunsPerOwner);
    const edited = command.outlines !== undefined;
    const outline = edited ? { ...run.outline, outlines: command.outlines } : run.outline;
    const revision = edited ? (Number(run.outlineRevision) || 0) + 1 : run.outlineRevision;
    await vault.runs.patch(runId, {
      state: 'generating',
      step: null,
      outline,
      outlineRevision: revision,
      progress: {
        scenesTotal: (outline?.outlines ?? []).length,
        scenesCompleted: Number(run.progress?.scenesCompleted ?? 0),
      },
    });
    await appendEvent(vault, runId, { type: 'outline_confirmed', data: { revision, edited } });
    const seq = await appendEvent(vault, runId, {
      type: 'state',
      data: { state: 'generating', step: null },
    });
    return { state: 'generating', seq, outlineRevision: revision };
  });
}

/** 源:store.ts:1466-1506（`holdGenerationRunOutline`）。 */
async function holdRunOutline(vault, runId, ownerId, command) {
  return runCommand(vault, runId, ownerId, command.commandId, 'hold-outline', async (run) => {
    const before = run.state === 'awaiting_outline_confirmation'
      || (!run.outline && ['preparing', 'outlining', 'paused'].includes(run.state));
    if (!before) {
      throw new RunConflict(
        'state',
        `The run is ${String(run.state).replaceAll('_', ' ')}, not waiting for its outline to be confirmed`,
      );
    }
    if (run.input?.outlineReview === 'auto') {
      throw new RunConflict('state', 'The run confirms its own outline');
    }
    if (run.input?.outlineReview === 'wait') {
      return { state: run.state, seq: Number(run.seq ?? 0) };
    }
    const updated = await vault.runs.patch(runId, {
      input: { ...(run.input ?? {}), outlineReview: 'wait' },
      outlineAutoConfirmAt: null,
    });
    const seq = await appendEvent(vault, runId, {
      type: 'outline_review',
      data: { outlineReview: 'wait', autoConfirmAt: null },
    });
    return { state: updated?.state ?? run.state, seq };
  });
}

/** 源:store.ts:1641-1661（`retryMediaIn`）。 */
async function retryMediaIn(vault, run, elementId) {
  if (run.state !== 'generating' && run.state !== 'paused' && run.state !== 'completed') {
    throw new RunConflict(
      'state',
      `The run is ${String(run.state).replaceAll('_', ' ')}; its media can no longer be generated`,
    );
  }
  const steps = (await vault.runs.steps?.(run.id)) ?? [];
  const found = steps.find((step) => String(step?.id) === `${MEDIA_STEP_PREFIX}${elementId}`);
  const media = found?.output;
  if (!media) {
    throw new RunConflict('media', `The run has no media element ${elementId}`);
  }
  const retryable = media.status === 'skipped' || (media.status === 'failed' && isRetryableRunMedia(media));
  if (!retryable) {
    throw new RunConflict(
      'media',
      media.status === 'failed'
        ? `The media element ${elementId} failed for a reason Retry cannot change`
        : `The media element ${elementId} has not failed`,
    );
  }
  // Generated anew, as the browser's Retry does (a video submits a new task).
  await vault.runs.putStep(run.id, `${MEDIA_STEP_PREFIX}${elementId}`, {
    mediaType: media.mediaType,
    status: 'queued',
  });
  const seq = await appendEvent(vault, run.id, {
    type: 'media',
    data: { elementId, mediaType: media.mediaType, status: 'pending' },
  });
  return { state: run.state, seq };
}

/** 源:store.ts:1546-1610（`retryGenerationRun`）。 */
async function retryRun(vault, runId, ownerId, command, options) {
  return runCommand(vault, runId, ownerId, command.commandId, 'retry', async (run) => {
    if (command.media) return retryMediaIn(vault, run, command.media.elementId);
    if (run.state !== 'paused') {
      throw new RunConflict(
        'state',
        `The run is ${String(run.state).replaceAll('_', ' ')}, not paused`,
      );
    }
    // The run is retryable: whether the owner may run one more decides.
    await enforceActiveRunLimit(vault, ownerId, options.maxActiveRunsPerOwner);
    // A run paused before it chose a step resumes where it was executing.
    const state = run.step
      ? stateForRetry(run.step)
      : (run.error?.resumeState ?? (run.outline ? 'generating' : 'preparing'));
    const updated = await vault.runs.patch(runId, { state, error: null });
    const seq = await appendEvent(vault, runId, { type: 'state', data: { state, step: run.step } });
    return { state: updated?.state ?? state, seq };
  });
}

/**
 * `principalHasRole(principal, OWNER_ROLES.coursePublish)`（源:lib/server/identity/types.ts）。
 * 本包默认的 `localOwner` 没有 `roles` 字段 → 与上游「匿名 owner」同一条：
 * `login_required`（真实身份服务注入后按它的 `roles` / `kind` 判）。
 */
function refusePublish(principal) {
  const roles = Array.isArray(principal?.roles) ? principal.roles : null;
  if (roles !== null) {
    return roles.includes('course:publish') ? null : ownerJson({ error: 'forbidden' }, 403);
  }
  // 没有身份服务（`localOwner`）：上游匿名 owner 的答案。
  if (principal?.kind === 'anonymous' || principal?.kind === undefined) {
    return ownerJson({ error: 'login_required' }, 401);
  }
  return ownerJson({ error: 'forbidden' }, 403);
}
