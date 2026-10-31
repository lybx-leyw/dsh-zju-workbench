/**
 * 批 3：智能体 / 会话 / 技能 / 对话（16 条）——`service.agents` / `sessions` / `runtime` /
 * `skills` / `chat`。
 *
 * 上游：`ref/OpenMAIC/app/api/{agents,agent,skills,chat}/**\/route.ts`
 *
 * # 挂载
 *
 * ```js
 * import { mountAgentRuntime } from './services/agent-runtime.js';
 * createClassroomService({ …, mounts: [mountAgentRuntime] });
 * ```
 *
 * 只往 `service.{agents,sessions,runtime,skills,chat}` 上 `Object.assign`，
 * 不整体替换任何命名空间（挂载协议 §0）。
 *
 * # 为什么 `agents/[id]` 与 `agents/import` 在这个文件里，而不是 `agents.js`
 *
 * `src/services/agents.js` 已经把 `GET/POST /api/agents` 搬完了，并且是**并行开发**
 * 的产物：它自己的端口面（`deps.agents`）、降级规则（vault kv 存自定义 agent）、
 * 甚至注释都归它。批 3 的另外两条 route 与它同域、同数据、同端口，
 * 但文件已经交付、不该被第二个批次改动（改它等于让两个批次的作者在同一段代码上
 * 抢同一行，正是 §0 要避免的冲突）。
 *
 * 所以这里用 `service.agents = Object.assign(service.agents ?? {}, …)` **只补四个方法**
 * （`get` / `put` / `remove` / `import`），不碰 `agents.js` 的 `list` / `create`：
 * `Object.assign` 是"覆盖同名键"，只要本文件不写 `list`/`create`，它们就原样保留。
 * 若编排层按 `mounts: [mountAgents, mountAgentRuntime]` 装配，最终 `service.agents`
 * 是两者的并集；顺序反过来也一样（前提是 `agents.js` 自己不覆盖本文件的键，
 * 它没有这四个方法）。**这是本批唯一跨文件共享的命名空间**，单独记在这里。
 *
 * # 端口面
 *
 * | 端口 | 方法 | 用在哪 |
 * |---|---|---|
 * | `ports.agent` | `plan/run/cancel` | `chat.send`（一次对话 = 一个 run）、`runtime.start` |
 * | `ports.agent.sessions` | 上游 `AgentSessionStore` 的子集：`getSession` / `listSessionsByOwner` / `createSession` / `setManualSessionTitle` / `requestCancel` / `postUserMessage` / `readEventsAfterForReplay` / `listMessages` / `readMaxId` / `readAfter` / `readRetirement` / `deleteSession` | `sessions.*`、`runtime.ownerEvents` |
 * | `ports.agent.registry.getAgent(id, ownerId)` | 内置 + 自定义 agent | `chat.send` 的 `config.agentIds` 解析（上游 `useAgentRegistry`） |
 * | `ports.agent.resolveElementReference(body)` | 课件引用解析（上游 `lib/chat/pi/element-reference.ts`，1640 行） | `chat.send` 的 `elementReference` / `interactiveState` |
 * | `deps.agents` | 与 `agents.js` 同一个注册表端口（见该文件头），本文件额外用 `update/remove/import/get` | `agents.*` |
 * | `ports.vault.kv` | `get/set/remove/keys` | `deps.agents` 未注入时的自定义 agent 存储（与 `agents.js` 同一形状） |
 *
 * # 端口缺失时的行为（硬性，不许编数据）
 *
 * 规则只有一条：**查询类**回上游"没有持久层 / 没有 runtime"那条分支，
 * **变更类**抛 `E_NOT_IMPLEMENTED`（`detail.source` 指到上游 handler 的行号）。
 * 为什么变更类不跟着回 404：404 会让调用方以为"这条记录不存在"，而事实是
 * "整个端口没接"，两者该做的下一步完全不同（重试 vs 装插件）。
 *
 * | 方法 | 缺什么 | 行为 |
 * |---|---|---|
 * | `agents.get` | 没有持久层（`deps.agents` 与 `vault.kv` 都没有） | 纯文本 `404 Not found`（上游 `isServerPersistenceConfigured()` 的第一道闸，`agents/[id]/route.ts:32,49`） |
 * | `agents.put/remove/import` | 同上，或注入端口没有对应写方法 | **抛** `E_NOT_IMPLEMENTED` |
 * | `sessions.list/get/status` | 没有 `ports.agent.sessions` | 纯文本 `404 Not found`（上游 `isAgentRuntimeConfigured()` 的第一道闸） |
 * | `sessions.events` / `runtime.ownerEvents` | 同上 | 返回 `{ httpStatus: 404, body: 'Not found' }`（不是空流 —— 空流会被当成"这个会话没有事件"） |
 * | `sessions.messages(id)` | 同上（上游**没有 GET**，见差异 3） | 纯文本 `404 Not found` |
 * | `sessions.create/update/cancel/send` / `sessions.remove` | 同上 | **抛** `E_NOT_IMPLEMENTED` |
 * | `runtime.get` | 同上 | 上游"没有 runtime"的 body：`{ enabled:false, runtimeEnabled:false, persistence:false }`（200） |
 * | `runtime.start` | 没有 `ports.agent.startRuntime` | **抛** `E_NOT_IMPLEMENTED`（上游这个 handler 根本不存在，见差异 1） |
 * | `skills.list` | `dataDir === null` | 上游"目录不存在 → 空清单"`[]`（200） |
 * | `skills.get/view` | `dataDir === null` | 纯文本 `404 Not found` |
 * | `skills.install/remove` | `dataDir === null` | **抛** `E_NOT_IMPLEMENTED`（变更类不静默） |
 * | `skills.view` | 有文件但没有 zip 构建器（`ports.export.skillZip`） | **抛** `E_NOT_IMPLEMENTED`（上游用 JSZip，本包不引依赖） |
 * | `chat.send` | 没有 `ports.agent.run` | **抛** `E_NOT_IMPLEMENTED` |
 *
 * 上游的 `isAgentRuntimeConfigured()` / `isServerPersistenceConfigured()` 两个
 * feature flag，在这里分别对应「`ports.agent.sessions` 在不在」与「有 `deps.agents`
 * 或 `vault.kv`」。理由：上游判的是"库表和 `DATABASE_URL` 建好没有"，本包判的是
 * "端口在不在"——同一个问题的两种问法。
 *
 * # 删掉的 Next 专有声明
 *
 * 15 个 handler 里的 `export const runtime = 'nodejs'`、`revalidate`、
 * `req.formData()`（`agent/skills` POST 改成入参收 `{ buffer, filename, mimeType }`）、
 * `req.json()`（改成入参收已解析的对象；传字符串时按上游 `catch` 分支判 400）、
 * `ReadableStream` + `TextEncoder` + 定时器（改成 `AsyncIterable`，见下）全部删除。
 *
 * # SSE：两处 `ReadableStream` → 两个 `AsyncIterable`
 *
 * `agent/sessions/[id]/events` 与 `agent/owner-events` 上游都是
 * `new Response(stream)`，帧里带 `id:` / `event:` / `data:` 三行。本包按
 * `src/events.js` 的契约返回 `AsyncIterable<event>`，每帧的 `data` 就是上游
 * `JSON.stringify` 的那个对象（**逐字段一致**，含 `phase: 'backlog' | 'live'`），
 * `seq` 就是 `id:`，`type` 就是 `event:`。
 *
 * 保留的上游语义：
 *
 * - **先回放历史、再实时**：backlog 阶段 `phase:'backlog'`，补完发一条 `caught_up`，
 *   之后的新事件 `phase:'live'`；`caught_up` 的 `data` 里带 `replayed` / `fromEventId`；
 * - **两种续读**：`Last-Event-ID` 头（大小写不敏感）优先，其次 `?lastEventId=`（上游），
 *   再其次 `?after=` 与 `opts.after`（本包为统一 generation 那几个流而加的别名）；
 * - **degraded caught_up**：连续 3 次读失败后发 `caught_up{degraded:true}`，
 *   恢复后再发一条不带 `degraded` 的；恢复期间到的事件仍标 `backlog`；
 * - **owner-events 的 resync**：游标超前（`cursor_ahead`）或落后超过
 *   `OWNER_EVENT_REPLAY_LIMIT`（`too_far_behind`）时先发 `resync_required`，跳过 backlog；
 * - **owner_moved**：心跳里发现这个 owner 已被并号就发一帧 `owner_moved{action:'reconnect'}` 并结束。
 *
 * 差三条（**已记进 ROUTES.md**）：
 *
 * 1. 上游靠 `LISTEN/NOTIFY` 唤醒（`subscribeAgentEventWakeup`），本仓的存储端口没有
 *    通知通道 → 只有轮询（5s / terminal 10s / owner 30s，与上游同值）；
 * 2. SSE 注释帧 `: ping` / `: replaying from event N` 是传输层的心跳，
 *    `AsyncIterable` 契约里没有"注释帧"，交 HTTP 桥（`events.js` 头注已写明）；
 * 3. `owner_moved` 的 `Set-Cookie`（丢弃已退役凭证）在 `AsyncIterable` 里没有落点，
 *    HTTP 桥得从 `opts` 侧补。
 */

import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ClassroomError } from '../errors.js';
import {
  headerOf,
  jsonResponse,
  localOwner,
  NOT_FOUND,
  plainResponse,
  searchParam,
  withOwner,
} from './support.js';

// ── 上游常量（逐字照抄）────────────────────────────────────────────────────

/** `lib/server/agent-runtime/limits.ts:8`：一个会话的 prompt / message 上限。 */
const MAX_SESSION_TEXT_LENGTH = 100_000;
/** `lib/orchestration/registry/schema.ts:15,23,26`。 */
const MAX_CUSTOM_AGENTS = 100;
const MAX_AGENT_JSON_BYTES = 256 * 1024;
const MAX_IMPORT_BATCH_AGENTS = MAX_CUSTOM_AGENTS * 2;
const MAX_IMPORT_BODY_BYTES = MAX_AGENT_JSON_BYTES + 1024;
/** `lib/orchestration/registry/built-in.ts:180-182` 的前缀。 */
const BUILT_IN_AGENT_ID_PREFIX = 'default-';
/** `lib/server/agent-runtime/skills.ts` 的目录约定（`agentRuntimeConfig.skillsDir`）。 */
const SKILLS_DIR_NAME = 'skills';
const SKILL_FILE_NAME = 'SKILL.md';
/** `agent/skills/route.ts:64`：上传体积上限（压缩前的输入）。 */
const MAX_SKILL_UPLOAD_BYTES = 1_048_576;
/** `packages/@openmaic/storage/src/skill/types.ts:17,18`。 */
const USER_SKILL_CONTENT_MAX_BYTES = 65_536;
const USER_SKILL_NAME_PATTERN = /^my-[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** `lib/server/agent-runtime/skills.ts`：`/handle` 的领读形式。 */
const LEADING_SKILL_HANDLE = /^\s*\/([^\s/]+)(?=\s|$)/;
/** `lib/server/skill-export.ts:13-15`。 */
const SAFE_SKILL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
/** `agent/sessions/[id]/events/route.ts:50-58`。 */
const POLL_INTERVAL_MS = 5_000;
const TERMINAL_POLL_INTERVAL_MS = 10_000;
const BACKLOG_PAGE = 500;
/** `agent/owner-events/route.ts:25-28`。 */
const OWNER_EVENT_POLL_INTERVAL_MS = 30_000;
const OWNER_EVENT_REPLAY_LIMIT = 1_000;
/** `lib/workbench/course-refs.ts:34-36`。 */
const MAX_COURSE_REFS = 5;
const COURSE_REF_ID_MAX = 64;
const COURSE_REF_TITLE_MAX = 120;
const COURSE_REF_FIELDS = new Set(['kind', 'stageId', 'title']);
/** `lib/workbench/element-refs.ts:55-61`。 */
const MAX_ELEMENT_REFS = 10;
const ELEMENT_SNAPSHOT_MAX = 200;
const ELEMENT_REF_ID_MAX = 64;
const ELEMENT_REF_LABEL_MAX = 120;
const ELEMENT_REF_SELECTOR_MAX = 512;
const INTERACTIVE_OUTERHTML_MAX = 2048;
const SLIDE_ELEMENT_REF_FIELDS = new Set([
  'kind', 'stageId', 'sceneId', 'elementId', 'elementType', 'label', 'snapshotText',
]);
const INTERACTIVE_ELEMENT_REF_FIELDS = new Set([
  'kind', 'stageId', 'sceneId', 'selector', 'outerHTML', 'text', 'label',
]);
/** `lib/workbench/session-title.ts:18`。 */
const SESSION_TITLE_MAX_LENGTH = 120;
/** `lib/i18n/locales.ts`（12 个支持的语言）。 */
const SUPPORTED_LOCALES = Object.freeze([
  'zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'ru-RU', 'ar-SA', 'pt-BR', 'ko-KR', 'es-MX', 'fr-FR',
  'vi-VN', 'de-DE',
]);
/** `lib/persistence/owner-merges.ts:266-278`。 */
const OWNER_RETIRED = 'OWNER_RETIRED';

// ── 小工具 ────────────────────────────────────────────────────────────────

function port(deps, key) {
  try {
    const value = deps?.ports?.[key];
    return value ?? null;
  } catch {
    // 端口是惰性 getter；取不到就是 null（"端口缺失"是正常状态，不是错误）。
    return null;
  }
}

/** 上游所有响应都带 owner 头；默认单机单用户（同 `support.js`）。 */
function ownerDeps(deps) {
  const owner = deps?.owner;
  return typeof owner?.resolve === 'function' ? deps : { ...(deps ?? {}), owner: localOwner };
}

/** 上游 `apiError(code, status, message, details?, reason?)`（`lib/server/api-response.ts:59-76`）。 */
function apiError(code, httpStatus, error, details, reason) {
  return {
    httpStatus,
    body: {
      success: false,
      errorCode: code,
      error,
      ...(details ? { details } : {}),
      ...(reason ? { reason } : {}),
    },
    headers: new Headers(),
  };
}

/** 上游 `new Response('Not found', { status: 404 })`。 */
function notFoundText(headers) {
  return plainResponse(404, NOT_FOUND, headers ?? new Headers());
}

/** 上游 `agentsJsonError(status, code, message, headers)`（`lib/server/agents/http.ts:22-29`）。 */
function agentsJsonError(httpStatus, code, message, headers) {
  return jsonResponse({ error: { code, message } }, httpStatus, headers ?? new Headers());
}

/** 上游 `builtInReadOnlyResponse`（`http.ts:31-38`）。 */
function builtInReadOnlyResponse(headers) {
  return agentsJsonError(403, 'BUILT_IN_AGENT_READ_ONLY', 'built-in agents cannot be changed or deleted', headers);
}

/** 上游 `ownerRetiredResponse`（`owner-merges.ts:266-278`）；`Set-Cookie` 交 HTTP 桥。 */
function ownerRetiredResponse(headers) {
  return jsonResponse(
    {
      error: {
        code: OWNER_RETIRED,
        message: 'This identity was merged into an account; sign in to continue.',
      },
    },
    403,
    headers ?? new Headers(),
  );
}

function notImplementedAt(method, source, hint) {
  return new ClassroomError('E_NOT_IMPLEMENTED', `${method} 尚未迁移`, {
    method,
    source,
    ...(hint ? { hint } : {}),
  });
}

/**
 * 上游 `req.json()` 的等价物：本包的方法直接收已解析的对象，
 * 传字符串时按上游 `catch` 分支处理（`{ ok:false }` → 400 'invalid JSON body'）。
 */
function readJsonBody(body) {
  if (typeof body === 'string') {
    try {
      return { ok: true, value: JSON.parse(body) };
    } catch {
      return { ok: false };
    }
  }
  if (body === undefined) return { ok: true, value: {} };
  return { ok: true, value: body };
}

function objectOf(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function isBuiltInId(id) {
  return typeof id === 'string' && id.startsWith(BUILT_IN_AGENT_ID_PREFIX);
}

/** 上游 `isValidClassroomId`（`lib/server/classroom-storage.ts:27-29`）。 */
function isValidClassroomId(id) {
  return /^[a-zA-Z0-9_-]+$/.test(id);
}

/** 上游 `supportedLocaleOf`（`lib/i18n/types.ts:8-12`）。 */
function supportedLocaleOf(value) {
  return typeof value === 'string' && SUPPORTED_LOCALES.includes(value) ? value : undefined;
}

/** 上游 `sanitizeSessionTitleText`（`lib/workbench/session-title.ts:20-27`）。 */
function sanitizeSessionTitleText(value) {
  return Array.from(value, (character) => {
    const codeUnit = character.charCodeAt(0);
    const unstorable =
      codeUnit === 0 || (character.length === 1 && codeUnit >= 0xd800 && codeUnit <= 0xdfff);
    return unstorable ? '\ufffd' : character;
  }).join('');
}

/** 上游 `normalizeSessionTitleOverride`（`session-title.ts:37-44`）。 */
function normalizeSessionTitleOverride(value) {
  if (value === null) return null;
  const wellFormed = sanitizeSessionTitleText(value.trim());
  const truncated = wellFormed.slice(0, SESSION_TITLE_MAX_LENGTH);
  if (!truncated) return null;
  const last = truncated.charCodeAt(truncated.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? truncated.slice(0, -1) || null : truncated;
}

/** 上游 `decodeCourseRefs`（`lib/workbench/course-refs.ts:87-158`），逐行照抄。 */
function decodeCourseRefs(value, invalid = 'reject') {
  if (!Array.isArray(value)) {
    return invalid === 'drop'
      ? { ok: true, refs: [] }
      : { ok: false, error: 'courseRefs must be an array' };
  }
  const refs = [];
  const seen = new Set();
  for (const [index, entry] of value.entries()) {
    const reject = (error) => (invalid === 'reject' ? { ok: false, error } : null);
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      const failure = reject(`courseRefs[${index}] must be an object`);
      if (failure) return failure;
      continue;
    }
    const unknownField = Object.keys(entry).find((field) => !COURSE_REF_FIELDS.has(field));
    if (unknownField) {
      const failure = reject(`courseRefs[${index}] contains unknown field "${unknownField}"`);
      if (failure) return failure;
      continue;
    }
    if (entry.kind !== 'course') {
      const failure = reject(`courseRefs[${index}].kind must be "course"`);
      if (failure) return failure;
      continue;
    }
    if (typeof entry.stageId !== 'string' || !entry.stageId.trim()) {
      const failure = reject(`courseRefs[${index}].stageId must be a non-empty string`);
      if (failure) return failure;
      continue;
    }
    if (entry.stageId.length > COURSE_REF_ID_MAX) {
      const failure = reject(
        `courseRefs[${index}].stageId cannot exceed ${COURSE_REF_ID_MAX} characters`,
      );
      if (failure) return failure;
      continue;
    }
    if (typeof entry.title !== 'string' || !entry.title.trim()) {
      const failure = reject(`courseRefs[${index}].title must be a non-empty string`);
      if (failure) return failure;
      continue;
    }
    if (entry.title.length > COURSE_REF_TITLE_MAX) {
      const failure = reject(
        `courseRefs[${index}].title cannot exceed ${COURSE_REF_TITLE_MAX} characters`,
      );
      if (failure) return failure;
      continue;
    }
    const ref = { kind: 'course', stageId: entry.stageId, title: entry.title };
    if (seen.has(ref.stageId)) continue;
    seen.add(ref.stageId);
    if (refs.length >= MAX_COURSE_REFS) {
      if (invalid === 'reject') {
        return { ok: false, error: `courseRefs cannot contain more than ${MAX_COURSE_REFS} items` };
      }
      continue;
    }
    refs.push(ref);
  }
  return { ok: true, refs };
}

/** 上游 `elementRefIdentity`（`lib/workbench/element-refs.ts:226-229`）。 */
function elementRefIdentity(ref) {
  const localId = ref.kind === 'slide-element' ? ref.elementId : ref.selector;
  return `${ref.kind}\u0000${ref.stageId}\u0000${ref.sceneId}\u0000${localId}`;
}

/**
 * 上游 `decodeElementRefs`（`lib/workbench/element-refs.ts:323-473`），逐行照抄。
 *
 * 只搬了**校验**：`resolveElementReference` 会把 ref 变成提示词片段（1640 行），
 * 那属于 run 侧，走 `ports.agent.resolveElementReference`。
 */
function decodeElementRefs(value, invalid = 'reject') {
  if (!Array.isArray(value)) {
    return invalid === 'drop'
      ? { ok: true, refs: [] }
      : { ok: false, error: 'elementRefs must be an array' };
  }
  const refs = [];
  const seen = new Set();
  for (const [index, entry] of value.entries()) {
    const reject = (error) => (invalid === 'reject' ? { ok: false, error } : null);
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      const failure = reject(`elementRefs[${index}] must be an object`);
      if (failure) return failure;
      continue;
    }
    const allowedFields =
      entry.kind === 'slide-element'
        ? SLIDE_ELEMENT_REF_FIELDS
        : entry.kind === 'interactive-element'
          ? INTERACTIVE_ELEMENT_REF_FIELDS
          : null;
    if (!allowedFields) {
      const failure = reject(
        `elementRefs[${index}].kind must be "slide-element" or "interactive-element"`,
      );
      if (failure) return failure;
      continue;
    }
    const unknownField = Object.keys(entry).find((field) => !allowedFields.has(field));
    if (unknownField) {
      const failure = reject(`elementRefs[${index}] contains unknown field "${unknownField}"`);
      if (failure) return failure;
      continue;
    }
    let invalidRequired = null;
    const idFields = entry.kind === 'slide-element'
      ? ['stageId', 'sceneId', 'elementId', 'elementType']
      : ['stageId', 'sceneId'];
    for (const field of idFields) {
      const fieldValue = entry[field];
      if (typeof fieldValue !== 'string' || !fieldValue.trim()) {
        invalidRequired = `elementRefs[${index}].${field} must be a non-empty string`;
        break;
      }
      if (fieldValue.length > ELEMENT_REF_ID_MAX) {
        invalidRequired = `elementRefs[${index}].${field} cannot exceed ${ELEMENT_REF_ID_MAX} characters`;
        break;
      }
    }
    if (invalidRequired) {
      const failure = reject(invalidRequired);
      if (failure) return failure;
      continue;
    }
    if (entry.kind === 'interactive-element') {
      const boundedFields = [
        ['selector', ELEMENT_REF_SELECTOR_MAX, false],
        ['outerHTML', INTERACTIVE_OUTERHTML_MAX, false],
        ['text', ELEMENT_SNAPSHOT_MAX, true],
      ];
      let invalidInteractive = null;
      for (const [field, max, allowEmpty] of boundedFields) {
        const fieldValue = entry[field];
        if (typeof fieldValue !== 'string' || (!allowEmpty && !fieldValue.trim())) {
          invalidInteractive = `elementRefs[${index}].${field} must be ${allowEmpty ? 'a string' : 'a non-empty string'}`;
          break;
        }
        if (fieldValue.length > max) {
          invalidInteractive = `elementRefs[${index}].${field} cannot exceed ${max} characters`;
          break;
        }
      }
      if (invalidInteractive) {
        const failure = reject(invalidInteractive);
        if (failure) return failure;
        continue;
      }
    }
    if (typeof entry.label !== 'string' || !entry.label.trim()) {
      const failure = reject(`elementRefs[${index}].label must be a non-empty string`);
      if (failure) return failure;
      continue;
    }
    if (entry.label.length > ELEMENT_REF_LABEL_MAX) {
      const failure = reject(
        `elementRefs[${index}].label cannot exceed ${ELEMENT_REF_LABEL_MAX} characters`,
      );
      if (failure) return failure;
      continue;
    }
    if (
      entry.kind === 'slide-element'
      && entry.snapshotText !== undefined
      && (typeof entry.snapshotText !== 'string' || !entry.snapshotText.trim())
    ) {
      const failure = reject(
        `elementRefs[${index}].snapshotText must be a non-empty string when provided`,
      );
      if (failure) return failure;
      continue;
    }
    if (
      entry.kind === 'slide-element'
      && typeof entry.snapshotText === 'string'
      && entry.snapshotText.length > ELEMENT_SNAPSHOT_MAX
    ) {
      const failure = reject(
        `elementRefs[${index}].snapshotText cannot exceed ${ELEMENT_SNAPSHOT_MAX} characters`,
      );
      if (failure) return failure;
      continue;
    }
    const ref = entry.kind === 'slide-element'
      ? {
          kind: 'slide-element',
          stageId: entry.stageId,
          sceneId: entry.sceneId,
          elementId: entry.elementId,
          elementType: entry.elementType,
          label: entry.label,
          ...(typeof entry.snapshotText === 'string' ? { snapshotText: entry.snapshotText } : {}),
        }
      : {
          kind: 'interactive-element',
          stageId: entry.stageId,
          sceneId: entry.sceneId,
          selector: entry.selector,
          outerHTML: entry.outerHTML,
          text: entry.text,
          label: entry.label,
        };
    const identity = elementRefIdentity(ref);
    if (seen.has(identity)) continue;
    seen.add(identity);
    if (refs.length >= MAX_ELEMENT_REFS) {
      if (invalid === 'reject') {
        return { ok: false, error: `elementRefs cannot contain more than ${MAX_ELEMENT_REFS} items` };
      }
      continue;
    }
    refs.push(ref);
  }
  return { ok: true, refs };
}

// ── 自定义 agent 的 schema（替代 zod，见文件头"不加依赖"）──────────────────

const AGENT_FIELDS = new Set([
  'name', 'role', 'persona', 'avatar', 'color', 'allowedActions', 'priority',
  'voiceConfig', 'voiceDesign',
]);

/**
 * 上游 `customAgentFieldsSchema`（`lib/orchestration/registry/schema.ts:52-64`）
 * 的等价校验，`.strict()` 保留（未知字段 400）。
 *
 * 用 30 行手写替代 zod：本仓不许加依赖，而这一层的判据只有"必填 + 长度 + 枚举"。
 * 报错文案与 zod 的 `describeAgentIssue` 同形（`字段: 一句话`），测试只断言
 * `status` 与 `code`，不断言整句。
 */
function parseAgentFields(raw) {
  const unknownField = Object.keys(raw).find((key) => !AGENT_FIELDS.has(key));
  if (unknownField) return { ok: false, field: unknownField, message: `${unknownField}: unrecognised field` };
  const checks = [
    ['name', (v) => typeof v === 'string' && v.length >= 1 && v.length <= 200, 'must be 1-200 characters'],
    ['role', (v) => typeof v === 'string' && v.length >= 1 && v.length <= 64, 'must be 1-64 characters'],
    ['persona', (v) => typeof v === 'string' && v.length <= 32_000, 'must be at most 32000 characters'],
    ['avatar', (v) => typeof v === 'string' && v.length <= 2_048, 'must be at most 2048 characters'],
    ['color', (v) => typeof v === 'string' && v.length <= 64, 'must be at most 64 characters'],
    [
      'allowedActions',
      (v) => Array.isArray(v)
        && v.length <= 64
        && v.every((item) => typeof item === 'string' && item.length >= 1 && item.length <= 64),
      'must be an array of at most 64 action names',
    ],
    ['priority', (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100, 'must be a number in [0, 100]'],
  ];
  for (const [field, ok, message] of checks) {
    if (raw[field] === undefined || raw[field] === null) {
      return { ok: false, field, message: `${field}: required` };
    }
    if (!ok(raw[field])) return { ok: false, field, message: `${field}: ${message}` };
  }
  const agent = {
    name: raw.name,
    role: raw.role,
    persona: raw.persona,
    avatar: raw.avatar,
    color: raw.color,
    allowedActions: [...raw.allowedActions],
    priority: raw.priority,
  };
  if (raw.voiceConfig !== undefined) agent.voiceConfig = raw.voiceConfig;
  if (raw.voiceDesign !== undefined) agent.voiceDesign = raw.voiceDesign;
  return { ok: true, agent };
}

/** 上游 `customAgentIdSchema`（`schema.ts:66-70`）。 */
function isValidAgentId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id) && !isBuiltInId(id);
}

/**
 * 上游 `parseAgentBody`（`lib/server/agents/http.ts:78-125`）的等价物。
 *
 * 字节上限（`MAX_AGENT_BODY_BYTES`）在本包里没有意义（没有流），
 * 改成"传进来的对象大小"不判 —— 这条差异记在 ROUTES.md。
 */
function parseAgentBody(body, pathId) {
  const read = readJsonBody(body);
  const value = read.ok ? read.value : undefined;
  const envelope = objectOf(value);
  const raw = envelope ? envelope.agent : undefined;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, response: agentsJsonError(400, 'INVALID_REQUEST', 'expected { agent }') };
  }
  const { id: bodyId, ...fields } = raw;
  const id = pathId ?? bodyId;
  if (typeof id === 'string' && isBuiltInId(id)) {
    return { ok: false, response: builtInReadOnlyResponse() };
  }
  if (pathId !== undefined && bodyId !== undefined && bodyId !== pathId) {
    return { ok: false, response: agentsJsonError(400, 'INVALID_AGENT', 'id: does not match the path') };
  }
  if (pathId === undefined) {
    if (!isValidAgentId(bodyId)) {
      return {
        ok: false,
        response: agentsJsonError(400, 'INVALID_AGENT', 'id: an agent id is 1-128 letters, digits, "_" or "-"'),
      };
    }
    const parsed = parseAgentFields(fields);
    if (!parsed.ok) return { ok: false, response: agentsJsonError(400, 'INVALID_AGENT', parsed.message) };
    return { ok: true, agent: { ...parsed.agent, id: bodyId } };
  }
  const parsed = parseAgentFields(fields);
  if (!parsed.ok) return { ok: false, response: agentsJsonError(400, 'INVALID_AGENT', parsed.message) };
  if (!isValidAgentId(pathId)) {
    return { ok: false, response: agentsJsonError(404, 'AGENT_NOT_FOUND', 'no such agent') };
  }
  return { ok: true, agent: { ...parsed.agent, id: pathId } };
}

/**
 * agent 存储端口。
 *
 * 优先用 `deps.agents`（与 `agents.js` 同一个注册表端口）；没注入时退回 vault kv，
 * 键形状与 `agents.js` 的降级实现**逐字相同**（`agents/<id>`），所以两个文件
 * 看到的是同一份自定义 agent 清单 —— 这是"分两个文件但不分两份数据"的关键。
 */
function agentStore(deps) {
  const injected = deps?.agents;
  if (injected && typeof injected === 'object') return { kind: 'injected', port: injected };
  const kv = port(deps, 'vault')?.kv;
  if (kv && typeof kv.get === 'function' && typeof kv.set === 'function') {
    return { kind: 'vault', kv };
  }
  return null;
}

// ── 技能：文件系统（`dataDir/skills/`）─────────────────────────────────────

function skillsDirOf(deps) {
  return deps?.dataDir ? join(String(deps.dataDir), SKILLS_DIR_NAME) : null;
}

/**
 * YAML frontmatter 的一个**子集**：只取 `name` / `title` / `description` 与
 * `metadata.title` 四个顶层标量。
 *
 * 上游用 js-yaml（`skills.ts:27`、`skill-export.ts:88`），本包不加依赖 —— 这四个
 * 字段都是单行标量，`key: value` 足够；带引号的值去掉引号，其余（列表、多行）
 * 原样当一个字符串。写在这里而不是散在调用点，是因为 install 与 list 都要它。
 */
function readFrontmatter(text) {
  const normalized = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!normalized.startsWith('---')) return null;
  const end = normalized.indexOf('\n---', 3);
  if (end === -1) return null;
  const head = normalized.slice(4, end);
  const body = normalized.slice(end + 4).replace(/^\n/, '');
  const values = {};
  let inMetadata = false;
  for (const line of head.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const indented = /^\s+\S/.test(line);
    const match = /^\s*([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    const value = unquote(rawValue.trim());
    if (!indented && key === 'metadata') {
      inMetadata = true;
      continue;
    }
    if (indented && inMetadata) {
      if (key === 'title' && value) values.title = value;
      continue;
    }
    inMetadata = false;
    if (value !== '') values[key] = value;
  }
  return { values, body };
}

function unquote(value) {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      const inner = value.slice(1, -1);
      return first === '"' ? inner.replace(/\\"/g, '"').replace(/\\n/g, '\n') : inner;
    }
  }
  return value;
}

/**
 * 读 `dataDir/skills/<dir>/SKILL.md`，返回上游 `LoadedSkill` 的形状。
 *
 * 上游 `listBuiltinSkills`（`skills.ts:229-270`）用 pi 的 `loadSkills` 解析 frontmatter
 * 并读同目录的 `outline-constraints.json`；这里做同一件事的两半：frontmatter 的
 * 四个标量 + `outline-constraints.json` 的存在性（`hasConstraints` 只判有无）。
 *
 * `id` 是**目录名**、`name` 是 frontmatter 的 `name` —— 与上游一致：内置技能的
 * 两个值相同（pi 的 `Skill.name` 就是目录名），用户技能则是 `id: usk_…` /
 * `name: my-…` 两个不同的值，`findSkill` 两个都能命中。
 */
async function readSkillDir(dirName, dir) {
  const filePath = join(dir, SKILL_FILE_NAME);
  const text = await readFile(filePath, 'utf8');
  const front = readFrontmatter(text);
  let hasConstraints = false;
  try {
    const constraintsPath = join(dir, 'outline-constraints.json');
    await stat(constraintsPath);
    JSON.parse(await readFile(constraintsPath, 'utf8'));
    hasConstraints = true;
  } catch {
    hasConstraints = false;
  }
  return {
    id: dirName,
    name: front?.values.name || dirName,
    ...(front?.values.title ? { title: front.values.title } : {}),
    description: front?.values.description ?? '',
    content: front?.body ?? text,
    filePath,
    hasConstraints,
    source: dirName.startsWith('usk_') ? 'user' : 'builtin',
  };
}

async function listFileSkills(deps) {
  const dir = skillsDirOf(deps);
  // 上游 `skills.ts:232`：目录不存在 → 空清单（不是错误）。
  if (!dir) return [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const skills = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      skills.push(await readSkillDir(entry.name, join(dir, entry.name)));
    } catch {
      // 目录里没有 SKILL.md 的条目，上游的 `loadSkills` 也不产出 skill。
    }
  }
  return skills;
}

/** 上游 `findSkill`：id 或 name 命中（`skills.ts:349-357`）。 */
function matchesSkillRef(skill, ref) {
  return skill.id === ref || skill.name === ref;
}

/** 字符数按码点算（上游 `codePointLength`，对齐 pg 的 `length()`）。 */
function codePointLength(value) {
  let count = 0;
  for (const _ of value) count += 1;
  return count;
}

/** 上游 `collapseToSingleLine`（`packages/@openmaic/storage/src/skill/types.ts:89-97`）。 */
function collapseToSingleLine(value) {
  return String(value)
    .replace(
      /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 上游 `validateUserSkillInput`（`storage/src/skill/types.ts:176-191` +
 * `validateUserSkillFields:143-174`）的四条判据：名字 `my-*`、title ≤80、
 * description ≤500、正文 ≤64 KiB（**字节**，中文本就是三字节）。
 */
function parseUserSkillMarkdown(markdown) {
  const normalized = String(markdown).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!normalized.startsWith('---\n')) {
    throw new Error('SKILL.md must begin with YAML frontmatter.');
  }
  const end = normalized.indexOf('\n---\n', 4);
  if (end === -1) throw new Error('SKILL.md frontmatter is not closed.');
  const front = readFrontmatter(normalized);
  const values = front?.values ?? {};
  if (
    typeof values.name !== 'string'
    || typeof values.title !== 'string'
    || typeof values.description !== 'string'
  ) {
    throw new Error('SKILL.md frontmatter requires string name, title, and description fields.');
  }
  const name = values.name.trim().toLowerCase();
  if (!USER_SKILL_NAME_PATTERN.test(name) || name.length > 64) {
    throw new Error(
      'Skill name must start with "my-", contain only lowercase letters, digits and single '
      + 'hyphens, and be at most 64 characters long.',
    );
  }
  const title = collapseToSingleLine(values.title);
  const description = collapseToSingleLine(values.description);
  const content = normalized.slice(end + 5).trim();
  if (!title || codePointLength(title) > 80) {
    throw new Error('Skill title must be non-empty and at most 80 characters.');
  }
  if (!description || codePointLength(description) > 500) {
    throw new Error('Skill description must be non-empty and at most 500 characters.');
  }
  if (!content || Buffer.byteLength(content, 'utf8') > USER_SKILL_CONTENT_MAX_BYTES) {
    throw new Error('Skill instructions must be non-empty and at most 64 KiB.');
  }
  return { name, title, description, content };
}

// ── SSE：会话事件 / owner 事件 ─────────────────────────────────────────────

function sleep(ms, signal) {
  if (!(ms > 0)) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener?.('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

/**
 * `Last-Event-ID` 头 → `?lastEventId=`（上游）→ `?after=` / `opts.after`（本包别名）。
 * 上游 `events/route.ts:85-87` 只认前两个；`after` 是与 generation 那几个流对齐的补充。
 */
function resolveCursor(opts) {
  const source = opts ?? {};
  const header = headerOf(source.headers, 'last-event-id');
  const raw = header ?? searchParam(source, 'lastEventId') ?? searchParam(source, 'after');
  const fromQuery = raw ?? source.after ?? 0;
  const value = Number(fromQuery);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * `GET /api/agent/sessions/:id/events` 的 `AsyncIterable` 版
 * （源文件:app/api/agent/sessions/[id]/events/route.ts:107-292）。
 *
 * 与上游一致的六点：先 backlog 后实时、`caught_up`、degraded caught_up、
 * 失败重试三次、terminal 会话放慢轮询、游标只前进。差一条：没有 `NOTIFY`。
 */
async function* sessionEventStream({
  store,
  sessionId,
  after,
  signal,
  pollIntervalMs = POLL_INTERVAL_MS,
  terminalPollIntervalMs = TERMINAL_POLL_INTERVAL_MS,
  maxPolls = Number.POSITIVE_INFINITY,
}) {
  let cursor = after;
  let backlogDone = false;
  let degradedCaughtUp = false;
  let sentSinceAttach = 0;
  let terminal = false;
  let failures = 0;
  let polls = 0;

  const caughtUp = (degraded = false) => ({
    type: 'caught_up',
    ts: Date.now(),
    data: {
      type: 'caught_up',
      replayed: sentSinceAttach,
      fromEventId: String(after),
      ...(degraded ? { degraded: true } : {}),
    },
    phase: 'backlog',
    sessionId,
  });

  for (;;) {
    if (signal?.aborted) return;

    let page;
    try {
      page = (await store.readEventsAfterForReplay(sessionId, cursor, BACKLOG_PAGE)) ?? {
        events: [],
        scanned: 0,
      };
      failures = 0;
    } catch {
      failures += 1;
      if (!backlogDone && failures >= 3) {
        yield caughtUp(true);
        backlogDone = true;
        degradedCaughtUp = true;
      }
      if (polls >= maxPolls) return;
      polls += 1;
      await sleep(terminal ? terminalPollIntervalMs : pollIntervalMs, signal);
      continue;
    }

    const events = Array.isArray(page.events) ? page.events : [];
    for (const event of events) {
      const data = event.data ?? null;
      const status = objectOf(data)?.status;
      const isTerminalEnd =
        event.type === 'session_end'
        && (status === 'succeeded' || status === 'failed' || status === 'cancelled');
      // A terminal session_end is normally the last frame; any later durable frame
      // proves activity resumed, so polling switches both ways (upstream 176-182).
      if (isTerminalEnd) terminal = true;
      else if (terminal) terminal = false;
      const seq = Number(event.id);
      yield {
        seq,
        type: String(event.type ?? 'event'),
        ts: Number(event.ts ?? Date.now()),
        data,
        // 恢复期间到的事件仍是历史（上游 161-165）。
        phase: backlogDone && !degradedCaughtUp ? 'live' : 'backlog',
        sessionId,
      };
      if (Number.isFinite(seq)) cursor = seq;
      sentSinceAttach += 1;
    }

    const scanned = Number(page.scanned ?? events.length);
    if (!backlogDone && scanned < BACKLOG_PAGE) {
      yield caughtUp();
      backlogDone = true;
      degradedCaughtUp = false;
    } else if (degradedCaughtUp && scanned < BACKLOG_PAGE) {
      // 同一条耗尽判据（上游 222-229）：degraded 窗口正是 backlog 堆积时。
      yield caughtUp();
      degradedCaughtUp = false;
    }

    if (scanned >= BACKLOG_PAGE) continue; // 还有历史，立刻再读

    if (polls >= maxPolls) return;
    polls += 1;
    await sleep(terminal ? terminalPollIntervalMs : pollIntervalMs, signal);
  }
}

/**
 * `GET /api/agent/owner-events` 的 `AsyncIterable` 版
 * （源文件:app/api/agent/owner-events/route.ts:88-338）。
 *
 * `resync_required` / `owner_moved` 与上游同名同形；`readMaxId` 缺失时跳过
 * 游标检查（端口没有这个能力，就不假装有）。
 */
async function* ownerEventStream({
  store,
  ownerId,
  after,
  signal,
  pollIntervalMs = OWNER_EVENT_POLL_INTERVAL_MS,
  replayLimit = OWNER_EVENT_REPLAY_LIMIT,
  maxPolls = Number.POSITIVE_INFINITY,
  checkRetirement = true,
}) {
  let cursor = after;
  let backlogDone = false;
  let degradedCaughtUp = false;
  let sentSinceAttach = 0;
  let failures = 0;
  let polls = 0;
  let attachChecked = false;
  let skippedForResync = false;

  const caughtUp = (degraded = false) => ({
    type: 'caught_up',
    ts: Date.now(),
    data: {
      type: 'caught_up',
      replayed: sentSinceAttach,
      fromEventId: String(after),
      ...(degraded ? { degraded: true } : {}),
    },
    phase: 'backlog',
    ownerId,
  });

  const checkAttachCursor = async () => {
    if (attachChecked) return true;
    if (typeof store.readMaxId !== 'function') {
      attachChecked = true;
      return true;
    }
    let currentEventId;
    try {
      currentEventId = Number(await store.readMaxId(ownerId));
    } catch {
      failures += 1;
      // 连续三次读不到 → 放弃这次游标检查，用 degraded caught_up 放行（上游 151-155）。
      if (failures >= 3) {
        attachChecked = true;
        return { degraded: true };
      }
      return false;
    }
    failures = 0;
    attachChecked = true;
    if (!Number.isFinite(currentEventId)) return true;
    const reason = after > currentEventId
      ? 'cursor_ahead'
      : currentEventId - after > replayLimit
        ? 'too_far_behind'
        : null;
    if (!reason) return true;
    cursor = currentEventId;
    backlogDone = true;
    degradedCaughtUp = false;
    skippedForResync = true;
    return { resync: { reason, currentEventId } };
  };

  for (;;) {
    if (signal?.aborted) return;

    if (!attachChecked) {
      const checked = await checkAttachCursor();
      if (checked && typeof checked === 'object' && checked.resync) {
        yield {
          type: 'resync_required',
          ts: Date.now(),
          data: {
            type: 'resync_required',
            reason: checked.resync.reason,
            fromEventId: String(after),
            currentEventId: String(checked.resync.currentEventId),
          },
          phase: 'backlog',
          ownerId,
        };
      }
      if (checked && typeof checked === 'object' && checked.degraded) {
        yield caughtUp(true);
        backlogDone = true;
        degradedCaughtUp = true;
      }
      if (skippedForResync) {
        // 已让客户端重读快照，之后只做实时尾随。
      } else if (checked === false) {
        if (polls >= maxPolls) return;
        polls += 1;
        await sleep(pollIntervalMs, signal);
        continue;
      }
    }

    let page;
    try {
      page = (await store.readAfter(ownerId, cursor, BACKLOG_PAGE)) ?? [];
      failures = 0;
    } catch {
      failures += 1;
      if (!backlogDone && failures >= 3) {
        yield caughtUp(true);
        backlogDone = true;
        degradedCaughtUp = true;
      }
      if (polls >= maxPolls) return;
      polls += 1;
      await sleep(pollIntervalMs, signal);
      continue;
    }

    for (const event of Array.isArray(page) ? page : []) {
      const seq = Number(event.id);
      yield {
        seq,
        type: String(event.type ?? 'event'),
        ts: Number(event.ts ?? Date.now()),
        data: event.data ?? null,
        phase: backlogDone && !degradedCaughtUp ? 'live' : 'backlog',
        ownerId,
      };
      if (Number.isFinite(seq)) cursor = seq;
      sentSinceAttach += 1;
    }

    const length = Array.isArray(page) ? page.length : 0;
    if (!backlogDone && length < BACKLOG_PAGE) {
      yield caughtUp();
      backlogDone = true;
      degradedCaughtUp = false;
    } else if (degradedCaughtUp && length < BACKLOG_PAGE) {
      yield caughtUp();
      degradedCaughtUp = false;
    }

    if (length >= BACKLOG_PAGE) continue;

    // 退休检查挂在"心跳"上（上游 288-321）：这里退化成每轮一次，端口没有
    // `readRetirement` 时整段跳过（不编一个"没退役"的结论，只是不查）。
    if (checkRetirement && typeof store.readRetirement === 'function') {
      try {
        const moved = await store.readRetirement(ownerId);
        if (moved) {
          yield {
            type: 'owner_moved',
            ts: Date.now(),
            data: { type: 'owner_moved', action: 'reconnect' },
            phase: 'live',
            ownerId,
          };
          return;
        }
      } catch {
        // 一次失败下一轮再试（上游同）。
      }
    }

    if (polls >= maxPolls) return;
    polls += 1;
    await sleep(pollIntervalMs, signal);
  }
}

// ── 白板可见性：待决登记的存储键与默认值 ───────────────────────────────────

/**
 * 上游 `lib/chat/pi/whiteboard-visibility.ts:19-23` 的**全局登记键**：
 * `Symbol.for('openmaic.pi.whiteboard-visibility.pending')`。
 *
 * 用 `Symbol.for` + `globalThis` 而不是模块级 `Map`，是因为 Next 的 route 与
 * 工具代码可能被打进不同的 chunk；同一进程里两张不同的 Map 会让
 * "查询挂起、settle 找不到"变成偶发。本包照抄这个键，语义才与上游等价。
 *
 * **默认值**：超时 / 派发失败 / 中止一律按 `'unknown'` 结案（上游 `:79,90`），
 * 只有显式的 `open` / `closed` 才算用户回答。
 */
const PENDING_VISIBILITY_KEY = Symbol.for('openmaic.pi.whiteboard-visibility.pending');
const pendingVisibilityQueries =
  (globalThis[PENDING_VISIBILITY_KEY] ??= new Map());

/** 上游 `queryWhiteboardVisibility`（`:57-95`），逐条照抄；`nanoid` → `randomUUID`。 */
function queryWhiteboardVisibility({ stageId, learnerKey, signal, timeoutMs = 15_000, dispatch }) {
  const queryId = randomUUID();
  return new Promise((resolve, reject) => {
    const entry = {
      queryId,
      stageId,
      learnerKey,
      resolve,
      reject,
      settled: false,
      timer: null,
      signal,
      onAbort: null,
    };
    const settleWith = (outcome) => {
      if (entry.settled) return;
      entry.settled = true;
      clearTimeout(entry.timer);
      if (entry.signal && entry.onAbort) entry.signal.removeEventListener('abort', entry.onAbort);
      if (pendingVisibilityQueries.get(entry.queryId) === entry) {
        pendingVisibilityQueries.delete(entry.queryId);
      }
      if ('error' in outcome) entry.reject(outcome.error);
      else entry.resolve(outcome.visibility);
    };
    entry.settle = settleWith;
    // `unknown` 不是"用户关了"，是"没人回答"（上游 79）。
    entry.timer = setTimeout(() => settleWith({ visibility: 'unknown' }), timeoutMs);
    if (signal) {
      entry.onAbort = () => settleWith({ error: signal.reason ?? new Error('Operation aborted') });
      signal.addEventListener('abort', entry.onAbort, { once: true });
    }
    pendingVisibilityQueries.set(queryId, entry);
    void Promise.resolve()
      .then(() => dispatch(queryId))
      .catch(() => {
        if (signal?.aborted) settleWith({ error: signal.reason ?? new Error('Operation aborted') });
        else settleWith({ visibility: 'unknown' });
      });
  });
}

/** 上游 `settleWhiteboardVisibility`（`:97-114`）：queryId + stageId + learnerKey 三者都要对上。 */
function settleWhiteboardVisibility({ queryId, stageId, learnerKey, visibility }) {
  const entry = pendingVisibilityQueries.get(queryId);
  if (!entry || entry.stageId !== stageId || entry.learnerKey !== learnerKey || entry.settled) {
    return false;
  }
  entry.settle({ visibility });
  return true;
}

// ── 挂载 ──────────────────────────────────────────────────────────────────

/**
 * @param {object} service `createClassroomService` 的返回值
 * @param {object} deps `{ ports, log, dataDir, providerConfig }`（可带 `owner`）
 */
export function mountAgentRuntime(service, deps) {
  const log = deps?.log ?? {};

  /** 会话存储端口（上游 `getAgentSessionStore()`）。缺了就按"没有 runtime"走。 */
  const sessionStore = () => {
    const agent = port(deps, 'agent');
    const sessions = agent && typeof agent === 'object' ? agent.sessions : null;
    return sessions && typeof sessions === 'object' ? sessions : null;
  };

  const hasAgentPort = () => {
    const agent = port(deps, 'agent');
    return Boolean(agent && typeof agent === 'object');
  };

  // ── agents ──────────────────────────────────────────────────────────────
  //
  // 四条（`get` / `put` / `remove` / `import`）挂在 `service.agents` 上，
  // 与 `agents.js` 的 `list` / `create` 并存（见文件头）。

  /**
   * 源文件:app/api/agents/[id]/route.ts:31-46（PUT）。
   *
   * 上游 `{ agent }` 是 `customAgentSchema` 去掉 id（id 在路径上）。
   * 本包没有 `AgentConfig` 的 `createdAt`/`updatedAt`，写路径只透传表单字段 + id；
   * 时间戳由端口补（上游由 store 的 `UPDATE` 补）。
   */
  async function putAgent(id, body, request) {
    const store = agentStore(deps);
    if (!store) {
      throw notImplementedAt('zhiyunClassroomStudio.agents.put', 'app/api/agents/[id]/route.ts:31-46');
    }
    return withOwner(ownerDeps(deps), request, async ({ ownerId, headers }) => {
      const parsed = parseAgentBody(body, id);
      if (!parsed.ok) return withHeaders(parsed.response, headers);
      try {
        const stored = await writeAgent(store, 'update', ownerId, parsed.agent);
        return jsonResponse({ agent: viewAgent(store, stored) }, 200, headers);
      } catch (error) {
        const refused = agentWriteError(store, error, headers);
        if (refused) return refused;
        throw error;
      }
    });
  }

  /**
   * 源文件:app/api/agents/[id]/route.ts:48-63（DELETE）。
   *
   * 内置 id 恒 403（先判路径，不查库 —— 上游也是这个顺序）。
   */
  async function removeAgent(id, request) {
    const store = agentStore(deps);
    if (!store) {
      throw notImplementedAt('zhiyunClassroomStudio.agents.remove', 'app/api/agents/[id]/route.ts:48-63');
    }
    return withOwner(ownerDeps(deps), request, async ({ ownerId, headers }) => {
      if (isBuiltInAgent(store, id)) return builtInReadOnlyResponse(headers);
      try {
        const removed = await writeAgent(store, 'remove', ownerId, id);
        if (!removed) return agentsJsonError(404, 'AGENT_NOT_FOUND', 'no such agent', headers);
        return { httpStatus: 204, body: null, headers };
      } catch (error) {
        const refused = agentWriteError(store, error, headers);
        if (refused) return refused;
        throw error;
      }
    });
  }

  /**
   * 源文件:app/api/agents/import/route.ts:39-83（POST）。
   *
   * 逐条校验（内置 / schema / 重复）后**一次事务**导入；被跳过的带原因回来。
   * 上游 `readCappedJson` 的字节上限在这里退化成入参数组长度
   * （`MAX_IMPORT_BATCH_AGENTS` 照抄）。
   */
  async function importAgents(body, request) {
    const store = agentStore(deps);
    if (!store) {
      throw notImplementedAt('zhiyunClassroomStudio.agents.import', 'app/api/agents/import/route.ts:39-83');
    }
    return withOwner(ownerDeps(deps), request, async ({ ownerId, headers }) => {
      const read = readJsonBody(body);
      const value = read.ok ? read.value : undefined;
      const envelope = objectOf(value);
      const agents = envelope ? envelope.agents : undefined;
      if (!Array.isArray(agents) || agents.length > MAX_IMPORT_BATCH_AGENTS) {
        return agentsJsonError(
          400,
          'INVALID_REQUEST',
          `expected { agents } with at most ${MAX_IMPORT_BATCH_AGENTS} agents`,
          headers,
        );
      }

      const valid = [];
      const skipped = [];
      for (const candidate of agents) {
        const rawId = objectOf(candidate)?.id;
        const id = typeof rawId === 'string' ? rawId : '';
        if (isBuiltInAgent(store, id)) {
          skipped.push({ id, reason: 'built-in' });
          continue;
        }
        const parsed = parseImportCandidate(candidate);
        if (parsed.ok) valid.push(parsed.agent);
        else skipped.push({ id, reason: `invalid: ${parsed.message}` });
      }

      try {
        const result = valid.length
          ? await writeAgent(store, 'import', ownerId, valid)
          : { imported: [], skipped: [] };
        return jsonResponse(
          {
            imported: result?.imported ?? [],
            skipped: [...skipped, ...(result?.skipped ?? [])],
          },
          200,
          headers,
        );
      } catch (error) {
        const refused = agentWriteError(store, error, headers);
        if (refused) return refused;
        throw error;
      }
    });
  }

  /**
   * `GET /api/agents/[id]` —— **上游没有这个 handler**（该 route 只有 PUT/DELETE，
   * 见 `agents/[id]/route.ts` 全长 64 行）。批表第 1 行写了 GET，本方法按批表补，
   * 读的是与 PUT 同一行（`kv` 的 `agents/<id>` / 端口的 `get`）。
   */
  async function getAgent(id, request) {
    const store = agentStore(deps);
    if (!store) return notFoundText();
    return withOwner(ownerDeps(deps), request, async ({ ownerId, headers }) => {
      const stored = await readAgent(store, ownerId, id);
      if (!stored) return agentsJsonError(404, 'AGENT_NOT_FOUND', 'no such agent', headers);
      return jsonResponse({ agent: viewAgent(store, stored) }, 200, headers);
    });
  }

  service.agents = Object.assign(service.agents ?? {}, {
    get: getAgent,
    put: putAgent,
    remove: removeAgent,
    import: importAgents,
  });

  // ── sessions ────────────────────────────────────────────────────────────

  /**
   * 源文件:app/api/agent/sessions/route.ts:43-224（POST）。
   *
   * 上游入参校验的顺序一行没动：existingCourse/stageId → prompt → materialIds →
   * courseRefs → locale，然后才是 owner。`assertWorkspaceModelsAuthorized` 与
   * `scheduleConversationTitle` 是旁路（授权闸门 / 异步标题任务），端口没有
   * `assertWorkspaceModelsAuthorized` 时不判 —— 这条差异记在 ROUTES.md。
   */
  async function createSession(body, opts = {}) {
    const store = sessionStore();
    if (!store) {
      // 变更类：没有会话存储就抛（协议 §0），不回 404 —— 404 会让调用方以为
      // "这个会话不存在"，而事实上是"整个 runtime 没接"。
      throw notImplementedAt('zhiyunClassroomStudio.sessions.create', 'app/api/agent/sessions/route.ts:43-224');
    }

    const read = readJsonBody(body);
    if (!read.ok) return apiError('INVALID_REQUEST', 400, 'invalid JSON body');
    const parsedBody = objectOf(read.value) ?? {};

    const existingCourse = parsedBody.existingCourse === true;
    const stageId = parsedBody.stageId?.toString().trim() || undefined;
    if (existingCourse && !stageId) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'existingCourse requires stageId');
    }
    if (existingCourse && stageId && !isValidClassroomId(stageId)) {
      return apiError('INVALID_REQUEST', 400, 'existingCourse stageId has an invalid format');
    }

    const explicitPrompt = (parsedBody.prompt ?? '').toString().trim();
    const prompt = explicitPrompt || (existingCourse ? (stageId ?? 'existing-course') : '');
    if (!prompt) return apiError('MISSING_REQUIRED_FIELD', 400, 'prompt is required');
    if (prompt.length > MAX_SESSION_TEXT_LENGTH) {
      return apiError(
        'INVALID_REQUEST',
        400,
        `prompt exceeds the ${MAX_SESSION_TEXT_LENGTH} character limit`,
      );
    }
    if (
      parsedBody.materialIds !== undefined
      && (!Array.isArray(parsedBody.materialIds)
        || parsedBody.materialIds.some((id) => typeof id !== 'string'))
    ) {
      return apiError('INVALID_REQUEST', 400, 'materialIds must be an array of strings');
    }
    const materialIds = [...new Set((parsedBody.materialIds ?? []).map((id) => id.trim()))];
    if (materialIds.length > 20 || materialIds.some((id) => !id)) {
      return apiError('INVALID_REQUEST', 400, 'materialIds are invalid');
    }
    if (existingCourse && materialIds.length > 0) {
      return apiError(
        'INVALID_REQUEST',
        400,
        'existingCourse does not accept attachments; send them on the first message instead',
      );
    }
    const decodedCourseRefs = decodeCourseRefs(parsedBody.courseRefs ?? []);
    const locale = supportedLocaleOf(parsedBody.locale);
    if (!decodedCourseRefs.ok) return apiError('INVALID_REQUEST', 400, decodedCourseRefs.error);

    return withOwner(ownerDeps(deps), opts.request, async ({ ownerId, headers }) => {
      await assertModelsAuthorized(ownerId);

      // 显式 skill（`?skill=` 启动链接）在这里就拒，理由见上游 110-115。
      let explicitSkillId = (parsedBody.skill ?? '').toString().trim() || undefined;
      if (explicitSkillId) {
        const found = await findSkill(deps, explicitSkillId);
        if (!found) {
          const known = await listFileSkills(deps);
          return jsonResponse(
            {
              success: false,
              errorCode: 'INVALID_REQUEST',
              error: `unknown skill "${explicitSkillId}"; installed: ${
                known.map((skill) => skill.id).join(', ') || '(none)'
              }`,
            },
            400,
            headers,
          );
        }
        explicitSkillId = found.id;
      }
      const skillId = explicitSkillId ?? (await inferSkillIdFromPrompt(deps, prompt));

      if (typeof store.readRetirement === 'function') {
        const retired = await store.readRetirement(ownerId);
        if (retired !== null && retired !== undefined) return ownerRetiredResponse(headers);
      }

      const hasOpeningContext = materialIds.length > 0 || decodedCourseRefs.refs.length > 0;
      let meta;
      try {
        meta = await store.createSession({
          ownerId,
          prompt,
          ...(stageId ? { stageId } : {}),
          ...(skillId ? { skillId } : {}),
          existingCourse,
          titleState: 'pending',
          ...(opts.origin ? { origin: opts.origin } : {}),
          ...(locale ? { locale } : {}),
          ...(existingCourse || hasOpeningContext ? { status: 'succeeded' } : {}),
        });
      } catch (error) {
        const claimed = ownerWriteError(error, headers);
        if (claimed) return claimed;
        throw error;
      }

      if (!hasOpeningContext) {
        scheduleTitle(store, meta.id, ownerId, existingCourse);
        return jsonResponse(meta, 202, headers);
      }

      try {
        const openingText = existingCourse ? explicitPrompt : prompt;
        const materials = materialIds.length
          ? await bindMaterials(store, meta.id, ownerId, materialIds)
          : [];
        await store.postUserMessage(
          meta.id,
          {
            text: openingText,
            ...(materials.length ? { materials } : {}),
            ...(decodedCourseRefs.refs.length ? { courseRefs: decodedCourseRefs.refs } : {}),
            ...(locale ? { locale } : {}),
          },
          { expectedOwnerId: ownerId },
        );
        if (openingText) scheduleTitle(store, meta.id, ownerId, false);
        return jsonResponse(
          {
            ...meta,
            status: 'queued',
            ...(decodedCourseRefs.refs.length ? { courseRefs: decodedCourseRefs.refs } : {}),
          },
          202,
          headers,
        );
      } catch (error) {
        await store.softDeleteSession?.(meta.id, ownerId).catch(() => false);
        if (error instanceof SessionMaterialBindingError) {
          return plainResponse(404, NOT_FOUND, headers);
        }
        const claimed = ownerWriteError(error, headers);
        if (claimed) return claimed;
        throw error;
      }
    });
  }

  /** 源文件:app/api/agent/sessions/route.ts:226-236（GET）。 */
  async function listSessions(query, opts = {}) {
    const store = sessionStore();
    if (!store) return notFoundText();
    return withOwner(ownerDeps(deps), opts.request ?? query, async ({ ownerId, headers }) => {
      const sessions = await store.listSessionsByOwner(ownerId);
      return jsonResponse(sessions, 200, headers);
    });
  }

  /** 源文件:app/api/agent/sessions/[id]/route.ts:13-27（GET）。 */
  async function getSession(id, request) {
    const store = sessionStore();
    if (!store) return notFoundText();
    return withOwner(ownerDeps(deps), request, async ({ ownerId, headers }) => {
      const meta = await store.getSession(id);
      if (!meta || meta.ownerId !== ownerId) return notFoundText(headers);
      return jsonResponse(meta, 200, headers);
    });
  }

  /**
   * 源文件:app/api/agent/sessions/[id]/route.ts:29-63（PATCH）。
   *
   * `title` 必须出现（可为 null）；`normalizeSessionTitleOverride` 逐行照抄
   * （NUL / 孤立代理 → U+FFFD，120 字符上限，不切断代理对）。
   */
  async function updateSession(id, body, request) {
    const store = sessionStore();
    if (!store) {
      throw notImplementedAt('zhiyunClassroomStudio.sessions.update', 'app/api/agent/sessions/[id]/route.ts:29-63');
    }
    return withOwner(ownerDeps(deps), request, async ({ ownerId, headers }) => {
      const read = readJsonBody(body);
      if (!read.ok) return withHeaders(apiError('INVALID_REQUEST', 400, 'invalid JSON body'), headers);
      const value = objectOf(read.value);
      if (!value || !Object.hasOwn(value, 'title')) {
        return withHeaders(apiError('MISSING_REQUIRED_FIELD', 400, 'title is required'), headers);
      }
      if (value.title !== null && typeof value.title !== 'string') {
        return withHeaders(apiError('INVALID_REQUEST', 400, 'title must be a string or null'), headers);
      }
      const title = normalizeSessionTitleOverride(value.title);
      const meta = await store.setManualSessionTitle(id, ownerId, title);
      if (!meta) return notFoundText(headers);
      return jsonResponse({ title: meta.title ?? null }, 200, headers);
    });
  }

  /**
   * `sessions.remove(id)` —— **上游 `agent/sessions/[id]` 没有 DELETE**
   * （该 route 只有 GET/PATCH，全长 63 行）。批表第 4 行写了 DELETE，
   * 本方法保留形状但恒抛：上游没有可搬的 body，端口也不该被猜出一个
   * "删会话"语义（会话是长对话，删它要不要连带事件日志是产品决定）。
   */
  async function removeSession(id) {
    void id;
    throw notImplementedAt(
      'zhiyunClassroomStudio.sessions.remove',
      'app/api/agent/sessions/[id]/route.ts:13-63',
      '上游该 route 只有 GET/PATCH，没有 DELETE；批表第 4 行的 DELETE 不存在',
    );
  }

  /** 源文件:app/api/agent/sessions/[id]/cancel/route.ts:16-45（POST）。 */
  async function cancelSession(id, request) {
    const store = sessionStore();
    if (!store) {
      throw notImplementedAt('zhiyunClassroomStudio.sessions.cancel', 'app/api/agent/sessions/[id]/cancel/route.ts:16-45');
    }
    return withOwner(ownerDeps(deps), request, async ({ ownerId, headers }) => {
      const meta = await store.getSession(id);
      if (!meta || meta.ownerId !== ownerId) return notFoundText(headers);
      if (meta.status === 'succeeded' || meta.status === 'failed' || meta.status === 'cancelled') {
        return jsonResponse(
          {
            code: 'SESSION_ALREADY_TERMINAL',
            status: meta.status,
            error: `session is already ${meta.status}`,
          },
          409,
          headers,
        );
      }
      await store.requestCancel(id);
      return jsonResponse({ id, cancelRequested: true }, 202, headers);
    });
  }

  /**
   * 源文件:app/api/agent/sessions/[id]/events/route.ts:60-298（GET）。
   *
   * 返回 `AsyncIterable<event>`（`src/events.js` 的形状）；"没有 runtime"与
   * "不是这个 owner 的会话"都回上游那条纯文本 404（不可探测性照抄：
   * 两种 404 逐字节相同）。
   */
  async function sessionEvents(id, opts = {}) {
    const store = sessionStore();
    if (!store) return notFoundText();
    const resolved = await ownerDeps(deps).owner.resolve(opts.request ?? opts);
    if (resolved?.ok === false) {
      return {
        httpStatus: resolved.httpStatus ?? 401,
        body: resolved.body ?? NOT_FOUND,
        headers: resolved.headers ?? new Headers(),
      };
    }
    const ownerId = resolved.ownerId;
    const meta = await store.getSession(id);
    if (!meta || meta.ownerId !== ownerId) return notFoundText(resolved.headers);

    return sessionEventStream({
      store,
      sessionId: id,
      after: resolveCursor(opts),
      signal: opts.signal,
      ...(opts.pollIntervalMs === undefined ? {} : { pollIntervalMs: opts.pollIntervalMs }),
      ...(opts.terminalPollIntervalMs === undefined
        ? {}
        : { terminalPollIntervalMs: opts.terminalPollIntervalMs }),
      ...(opts.maxPolls === undefined ? {} : { maxPolls: opts.maxPolls }),
    });
  }

  /**
   * `sessions.messages(id)` —— **上游 `agent/sessions/[id]/messages` 只有 POST**，
   * 没有 GET（全长 149 行，只有一个 `export async function POST`）。批表第 7 行
   * 的 GET 不存在；本方法走端口的 `listMessages`（上游 store 里没有这个方法，
   * 它是本包补的读法），端口没有就回 404。
   */
  async function listMessages(id, query, opts = {}) {
    const store = sessionStore();
    if (!store) return notFoundText();
    return withOwner(ownerDeps(deps), opts.request ?? query, async ({ ownerId, headers }) => {
      const meta = await store.getSession(id);
      if (!meta || meta.ownerId !== ownerId) return notFoundText(headers);
      if (typeof store.listMessages !== 'function') return notFoundText(headers);
      const messages = await store.listMessages(id, { expectedOwnerId: ownerId });
      return jsonResponse(messages, 200, headers);
    });
  }

  /**
   * 源文件:app/api/agent/sessions/[id]/messages/route.ts:27-149（POST）。
   *
   * 校验顺序照抄：会话归属 → JSON → materialIds → elementRefs → courseRefs →
   * locale → `text` 非空（materialIds 可替代）→ 长度上限，然后才是授权与写入。
   * `AgentSessionAccessError` 的 403 / 退役 403 用同一个 `ownerWriteError` 接缝。
   */
  async function sendMessage(id, body, request) {
    const store = sessionStore();
    if (!store) {
      throw notImplementedAt('zhiyunClassroomStudio.sessions.send', 'app/api/agent/sessions/[id]/messages/route.ts:27-149');
    }
    return withOwner(ownerDeps(deps), request, async ({ ownerId, headers }) => {
      const meta = await store.getSession(id);
      if (!meta || meta.ownerId !== ownerId) return notFoundText(headers);

      const read = readJsonBody(body);
      if (!read.ok) return withHeaders(apiError('INVALID_REQUEST', 400, 'invalid JSON body'), headers);
      const parsedBody = objectOf(read.value) ?? {};

      const text = (parsedBody.text ?? '').toString().trim();
      if (
        parsedBody.materialIds !== undefined
        && (!Array.isArray(parsedBody.materialIds)
          || parsedBody.materialIds.some((materialId) => typeof materialId !== 'string'))
      ) {
        return withHeaders(
          apiError('INVALID_REQUEST', 400, 'materialIds must be an array of strings'),
          headers,
        );
      }
      const materialIds = [...new Set((parsedBody.materialIds ?? []).map((value) => value.trim()))];
      if (materialIds.length > 20 || materialIds.some((value) => !value)) {
        return withHeaders(apiError('INVALID_REQUEST', 400, 'materialIds are invalid'), headers);
      }
      const decodedElementRefs = decodeElementRefs(parsedBody.elementRefs ?? []);
      if (!decodedElementRefs.ok) {
        return withHeaders(apiError('INVALID_REQUEST', 400, decodedElementRefs.error), headers);
      }
      const decodedCourseRefs = decodeCourseRefs(parsedBody.courseRefs ?? []);
      const locale = supportedLocaleOf(parsedBody.locale);
      if (!decodedCourseRefs.ok) {
        return withHeaders(apiError('INVALID_REQUEST', 400, decodedCourseRefs.error), headers);
      }
      if (!text && materialIds.length === 0) {
        return withHeaders(apiError('MISSING_REQUIRED_FIELD', 400, 'text is required'), headers);
      }
      if (text.length > MAX_SESSION_TEXT_LENGTH) {
        return withHeaders(
          apiError('INVALID_REQUEST', 400, `text exceeds the ${MAX_SESSION_TEXT_LENGTH} character limit`),
          headers,
        );
      }

      await assertModelsAuthorized(ownerId);
      try {
        const materials = materialIds.length
          ? await bindMaterials(store, id, ownerId, materialIds)
          : [];
        const posted = await store.postUserMessage(
          id,
          {
            text,
            ...(materials.length ? { materials } : {}),
            ...(decodedElementRefs.refs.length ? { elementRefs: decodedElementRefs.refs } : {}),
            ...(decodedCourseRefs.refs.length ? { courseRefs: decodedCourseRefs.refs } : {}),
            ...(locale ? { locale } : {}),
          },
          { expectedOwnerId: ownerId },
        );
        if (text) scheduleTitle(store, id, ownerId, false);
        return jsonResponse(
          {
            id,
            message: { seq: posted?.seq, text, delivery: posted?.delivery },
            elementRefsAccepted: decodedElementRefs.refs.length > 0,
            courseRefsAccepted: decodedCourseRefs.refs.length > 0,
          },
          202,
          headers,
        );
      } catch (error) {
        if (error instanceof SessionMaterialBindingError) return notFoundText(headers);
        if (error?.name === 'AgentSessionAccessError' || error?.code === 'AGENT_SESSION_ACCESS') {
          const retired = await retiredIfRetired(store, ownerId);
          if (retired) return ownerRetiredResponse(headers);
          return plainResponse(403, 'Forbidden', headers);
        }
        const claimed = ownerWriteError(error, headers);
        if (claimed) return claimed;
        throw error;
      }
    });
  }

  /** 源文件:app/api/agent/sessions/status/route.ts:11-20（GET）。 */
  async function sessionStatus(query, opts = {}) {
    const store = sessionStore();
    if (!store) return notFoundText();
    return withOwner(ownerDeps(deps), opts.request ?? query, async ({ ownerId, headers }) => {
      const sessions = await store.listSessionsByOwner(ownerId);
      const statuses = Object.fromEntries(sessions.map((session) => [session.id, session.status]));
      return jsonResponse(statuses, 200, headers);
    });
  }

  service.sessions = Object.assign(service.sessions ?? {}, {
    list: listSessions,
    create: createSession,
    get: getSession,
    update: updateSession,
    remove: removeSession,
    cancel: cancelSession,
    events: sessionEvents,
    messages: listMessages,
    send: sendMessage,
    status: sessionStatus,
  });

  // ── runtime ─────────────────────────────────────────────────────────────

  /**
   * 源文件:app/api/agent/runtime/route.ts:27-35（GET）。
   *
   * 上游是**纯状态探针**（三个布尔），不是长连接、也没有 `POST`：
   * `enabled` = flag AND `DATABASE_URL`；`runtimeEnabled` = 原始 flag；
   * `persistence` = 非空 `DATABASE_URL`。本包对应的是"端口在不在"：
   * `enabled`/`runtimeEnabled` = 有 `ports.agent.sessions`，`persistence` = 有会话存储。
   */
  async function runtimeStatus() {
    const configured = Boolean(sessionStore());
    return jsonResponse(
      {
        enabled: configured,
        runtimeEnabled: configured,
        persistence: configured,
      },
      200,
    );
  }

  /**
   * `runtime.start(body)` —— 批表第 9 行写了 POST，**上游没有这个 handler**
   * （`agent/runtime/route.ts` 全长 35 行，只有一个 GET）。
   *
   * 端口有 `startRuntime` 就转发（编排层想给一个"起 runtime"的能力时用它），
   * 否则抛 —— 不凭一句注释发明一个"按 owner 起一个 runtime 实例"的接口。
   */
  async function startRuntime(body, opts = {}) {
    const agent = port(deps, 'agent');
    if (typeof agent?.startRuntime === 'function') {
      return agent.startRuntime(body, opts);
    }
    throw notImplementedAt(
      'zhiyunClassroomStudio.runtime.start',
      'app/api/agent/runtime/route.ts:27-35',
      '上游只有 GET 状态探针，没有 POST；要起 run 请用 ports.agent.plan/run',
    );
  }

  /**
   * 源文件:app/api/agent/owner-events/route.ts:39-344（GET）。
   *
   * 返回 `AsyncIterable<event>`；没有 runtime → 404（不是空流）。
   * 已退役的 owner 先拿一帧 `owner_moved` 就结束（上游 56-66）。
   */
  async function ownerEvents(opts = {}) {
    const store = sessionStore();
    if (!store) return notFoundText();
    const resolved = await ownerDeps(deps).owner.resolve(opts.request ?? opts);
    if (resolved?.ok === false) {
      return {
        httpStatus: resolved.httpStatus ?? 401,
        body: resolved.body ?? NOT_FOUND,
        headers: resolved.headers ?? new Headers(),
      };
    }
    const ownerId = resolved.ownerId;

    if (typeof store.readRetirement === 'function') {
      try {
        const retired = await store.readRetirement(ownerId);
        if (retired !== null && retired !== undefined) {
          // 退役：一条 owner_moved 后结束（上游 retired-owner 分支）。
          return {
            async *[Symbol.asyncIterator]() {
              yield {
                type: 'owner_moved',
                ts: Date.now(),
                data: { type: 'owner_moved', action: 'reconnect' },
                phase: 'live',
                ownerId,
              };
            },
          };
        }
      } catch {
        // 查不到就照常开流（上游 56 行也是一次查询，失败会抛给 Next → 500）。
      }
    }

    return ownerEventStream({
      store,
      ownerId,
      after: resolveCursor(opts),
      signal: opts.signal,
      ...(opts.pollIntervalMs === undefined ? {} : { pollIntervalMs: opts.pollIntervalMs }),
      ...(opts.replayLimit === undefined ? {} : { replayLimit: opts.replayLimit }),
      ...(opts.maxPolls === undefined ? {} : { maxPolls: opts.maxPolls }),
      checkRetirement: opts.checkRetirement !== false,
    });
  }

  service.runtime = Object.assign(service.runtime ?? {}, {
    get: runtimeStatus,
    start: startRuntime,
    ownerEvents,
  });

  // ── skills ──────────────────────────────────────────────────────────────

  /**
   * 源文件:app/api/agent/skills/route.ts:27-45（GET）。
   *
   * 上游把 `LoadedSkill` 压成 6 个字段（`title` 只在有值时出现）；
   * `hasConstraints` 只判有无（`!!s.constraints`），所以这里也只判文件在不在。
   */
  async function listSkills(_query, opts = {}) {
    return withOwner(ownerDeps(deps), opts.request ?? _query, async ({ headers }) => {
      const skills = await listFileSkills(deps);
      return jsonResponse(
        skills.map((skill) => ({
          id: skill.id,
          name: skill.name,
          ...(skill.title ? { title: skill.title } : {}),
          description: skill.description,
          hasConstraints: Boolean(skill.hasConstraints),
          source: skill.source,
        })),
        200,
        headers,
      );
    });
  }

  /**
   * 源文件:app/api/agent/skills/route.ts:48-104（POST）。
   *
   * `req.formData()` → 入参 `{ buffer, filename, mimeType }`（协议 §0）。
   * 三条闸门照抄：没有文件 400、>1 MiB 413、解析失败 400 `invalid-upload`。
   * `.zip` 需要 JSZip（本包不引依赖）→ 抛 `E_NOT_IMPLEMENTED`。
   *
   * 落地位置是 `dataDir/skills/<id>/SKILL.md`（上游是 pg 的 `owner_skill` 表）：
   * 一个用户技能在这边就是一个目录，`skills.list` 立刻能看见它。
   */
  async function installSkill(upload, request) {
    const dir = skillsDirOf(deps);
    if (!dir) {
      throw notImplementedAt(
        'zhiyunClassroomStudio.skills.install',
        'app/api/agent/skills/route.ts:48-104',
        'dataDir 为 null：没有可写的技能目录（上游 createUserSkill 写 pg）',
      );
    }
    return withOwner(ownerDeps(deps), request, async ({ ownerId, headers }) => {
      void ownerId;
      const file = objectOf(upload);
      const buffer = file?.buffer;
      const hasBuffer = buffer && (Buffer.isBuffer(buffer) || ArrayBuffer.isView(buffer));
      if (!hasBuffer) {
        return plainResponse(400, 'A skill file is required.', headers);
      }
      const bytes = Buffer.from(buffer);
      if (bytes.byteLength > MAX_SKILL_UPLOAD_BYTES) {
        return plainResponse(413, 'The skill upload is too large.', headers);
      }
      const filename = String(file.filename ?? 'SKILL.md');
      if (filename.toLowerCase().endsWith('.zip')) {
        throw notImplementedAt(
          'zhiyunClassroomStudio.skills.install',
          'app/api/agent/skills/route.ts:70-71',
          'zip 解包要 JSZip（本包不加依赖），请上传裸 SKILL.md',
        );
      }
      let input;
      try {
        input = parseUserSkillMarkdown(bytes.toString('utf8'));
      } catch (error) {
        return jsonResponse(
          { error: 'invalid-upload', message: error?.message ?? String(error) },
          400,
          headers,
        );
      }
      const id = `usk_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
      const target = join(dir, id);
      await mkdir(target, { recursive: true });
      await writeFile(
        join(target, SKILL_FILE_NAME),
        `---\nname: ${JSON.stringify(input.name)}\ntitle: ${JSON.stringify(input.title)}\ndescription: ${JSON.stringify(input.description)}\n---\n\n${input.content}\n`,
        'utf8',
      );
      return jsonResponse(
        {
          id,
          name: input.name,
          title: input.title,
          description: input.description,
          hasConstraints: false,
          source: 'user',
        },
        201,
        headers,
      );
    });
  }

  /**
   * 源文件:app/api/agent/skills/[id]/route.ts:18-29（GET）。
   *
   * 上游 `findUserSkill` 只找**用户技能**（`usk_` 前缀 / pg 行），内置技能 404；
   * 这里同样只认 `dataDir/skills/<id>/SKILL.md`，不在清单里就 404。
   */
  async function getSkill(id, request) {
    const dir = skillsDirOf(deps);
    if (!dir || !SAFE_SKILL_ID.test(String(id))) return notFoundText();
    return withOwner(ownerDeps(deps), request, async ({ headers }) => {
      let text;
      try {
        text = await readFile(join(dir, String(id), SKILL_FILE_NAME), 'utf8');
      } catch {
        return notFoundText(headers);
      }
      const front = readFrontmatter(text);
      return jsonResponse({ id, content: front?.body ?? text }, 200, headers);
    });
  }

  /**
   * `skills.put(id, body)` —— **上游 `agent/skills/[id]` 没有 PUT**
   * （只有 GET 与 DELETE，全长 54 行）。批表第 12 行写了 PUT；技能编辑在上游
   * 走的是 agent 工具（`patchUserSkill`，JSON-pointer 补丁），不是这个 route。
   * 形状保留但恒抛，避免把"整份覆盖"当成编辑语义。
   */
  async function putSkill(id, body) {
    void id;
    void body;
    throw notImplementedAt(
      'zhiyunClassroomStudio.skills.put',
      'app/api/agent/skills/[id]/route.ts:18-54',
      '上游只有 GET/DELETE；编辑走 patchUserSkill（JSON-pointer），不是整份覆盖',
    );
  }

  /**
   * 源文件:app/api/agent/skills/[id]/route.ts:31-54（DELETE）。
   *
   * 非 `usk_` 前缀恒 405（"内置技能不能删"），随后删目录；不存在 404。
   */
  async function removeSkill(id, request) {
    const dir = skillsDirOf(deps);
    if (!dir) {
      throw notImplementedAt('zhiyunClassroomStudio.skills.remove', 'app/api/agent/skills/[id]/route.ts:31-54');
    }
    return withOwner(ownerDeps(deps), request, async ({ headers }) => {
      if (!String(id).startsWith('usk_')) {
        return plainResponse(405, 'Built-in skills cannot be deleted.', headers);
      }
      if (!SAFE_SKILL_ID.test(String(id))) return notFoundText(headers);
      try {
        await stat(join(dir, String(id)));
      } catch {
        return notFoundText(headers);
      }
      await rm(join(dir, String(id)), { recursive: true, force: true });
      return { httpStatus: 204, body: null, headers };
    });
  }

  /**
   * 源文件:app/api/skills/[id]/route.ts:23-48（GET）。
   *
   * 上游是**二进制 zip**（`Content-Type: application/zip`），不是 JSON ——
   * 批表第 13 行写的"复用 `skills.get`"不成立（见 ROUTES.md 差异 4）。
   * 本包没有 JSZip：技能存在就抛 `E_NOT_IMPLEMENTED`（并给出 `source`），
   * 不存在回上游的 404。端口 `ports.export.skillZip(id, skill)` 注入后走二进制响应。
   */
  async function viewSkill(id, request) {
    const dir = skillsDirOf(deps);
    if (!dir) return notFoundText();
    if (!SAFE_SKILL_ID.test(String(id))) return plainResponse(400, 'Invalid skill id');
    if (id === 'openmaic') {
      // 上游 `buildOpenClawSkillZip()` 打包仓库自带的 skill；本包没有那棵树。
      throw notImplementedAt(
        'zhiyunClassroomStudio.skills.view',
        'app/api/skills/[id]/route.ts:28-31',
        'buildOpenClawSkillZip 打的是 ref/OpenMAIC/skills 目录，本包没有',
      );
    }
    return withOwner(ownerDeps(deps), request, async ({ headers }) => {
      let text;
      try {
        text = await readFile(join(dir, String(id), SKILL_FILE_NAME), 'utf8');
      } catch {
        return notFoundText(headers);
      }
      const exporter = port(deps, 'export');
      if (typeof exporter?.skillZip !== 'function') {
        throw notImplementedAt(
          'zhiyunClassroomStudio.skills.view',
          'app/api/skills/[id]/route.ts:38-46',
          'zip 由 JSZip 生成；注入 ports.export.skillZip 后本方法返回 { buffer, mimeType }',
        );
      }
      const front = readFrontmatter(text);
      const zip = await exporter.skillZip(String(id), {
        name: front?.values.name ?? String(id),
        title: front?.values.title ?? '',
        description: front?.values.description ?? '',
        content: front?.body ?? text,
      });
      const buffer = Buffer.from(zip);
      return { httpStatus: 200, buffer, mimeType: 'application/zip', headers };
    });
  }

  service.skills = Object.assign(service.skills ?? {}, {
    list: listSkills,
    install: installSkill,
    get: getSkill,
    put: putSkill,
    remove: removeSkill,
    view: viewSkill,
  });

  // ── chat ────────────────────────────────────────────────────────────────

  /**
   * 源文件:app/api/chat/pi/route.ts:48-63（POST）+ 65-387（`chat()`）。
   *
   * 上游这条 route 跑的是 CopilotKit 的 `pi` 导演循环：`resolveModel` →
   * `runPiDirectorLoop` → 一帧一帧 `data: {…}\n\n`。本包**不引入 CopilotKit**，
   * 传输层换成 `ports.agent`：`plan(chatBrief)` 拿到一次 run 的计划，
   * `run(plan, opts)` 返回 `AsyncIterable`，逐帧转成 `events.js` 的形状。
   *
   * handler 里的业务判断逐条保留（顺序也保留）：
   *
   * 1. `messages` 必填 → 400 `MISSING_REQUIRED_FIELD`；
   * 2. `storeState` 必填 → 400；
   * 3. `config.agentIds` 必填（`== null` 才算缺） → 400；
   * 4. 带课件引用但 `COURSEWARE_REFERENCE_ENABLED` 关 → 400 `Courseware references are disabled`；
   * 5. `storeState.scenes` 的成员必须是对象 → 400；
   * 6. 元素引用解析（端口）/ 交互态证据（端口）；
   * 7. `agentIds` 必须是非空、去重、trim 过的字符串数组 → 400；
   * 8. agent 配置解析不到 → 400 Unknown / No valid；
   * 9. 传输：`ports.agent`。
   *
   * 上游 `resolveModel` 的模型槽 / `MISSING_API_KEY` / `MODEL_CONFIG_INVALID`
   * 属于模型层（`lib/server/model-config/**`），本包没有；那三条例外分支的判据
   * 若端口抛出带 `code`/`httpStatus` 的错误，这里按 `apiError` 原样回。
   */
  async function chatSend(body, opts = {}) {
    const resolved = await ownerDeps(deps).owner.resolve(opts.request ?? opts);
    if (resolved?.ok === false) {
      return {
        httpStatus: resolved.httpStatus ?? 401,
        body: resolved.body ?? NOT_FOUND,
        headers: resolved.headers ?? new Headers(),
      };
    }
    const ownerId = resolved.ownerId;

    const read = readJsonBody(body);
    if (!read.ok) {
      // 上游 `await req.json()` 在 `chat()` 的 try 里，解析失败落到最外层 catch
      // → 500 `INTERNAL_ERROR`（不是 400）。
      return apiError('INTERNAL_ERROR', 500, 'Failed to process request');
    }
    const parsedBody = objectOf(read.value);
    if (!parsedBody) return apiError('INVALID_REQUEST', 400, 'invalid JSON body');

    if (!parsedBody.messages || !Array.isArray(parsedBody.messages)) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Missing required field: messages');
    }
    if (!parsedBody.storeState) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Missing required field: storeState');
    }
    if (!parsedBody.config || parsedBody.config.agentIds == null) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Missing required field: config.agentIds');
    }
    if (
      (parsedBody.elementReference !== undefined || parsedBody.interactiveState !== undefined)
      && !coursewareReferenceEnabled()
    ) {
      return apiError('INVALID_REQUEST', 400, 'Courseware references are disabled');
    }
    const storeState = objectOf(parsedBody.storeState) ?? {};
    if (
      Array.isArray(storeState.scenes)
      && storeState.scenes.some(
        (scene) => typeof scene !== 'object' || scene === null || Array.isArray(scene),
      )
    ) {
      return apiError('INVALID_REQUEST', 400, 'storeState.scenes members must be objects');
    }

    let elementReference;
    let interactiveStateNote;
    if (parsedBody.elementReference !== undefined || parsedBody.interactiveState !== undefined) {
      const agent = port(deps, 'agent');
      if (typeof agent?.resolveElementReference !== 'function') {
        throw notImplementedAt(
          'zhiyunClassroomStudio.chat.send',
          'lib/chat/pi/element-reference.ts:115-1640',
          '课件引用的解析（1640 行）未搬；注入 ports.agent.resolveElementReference 即可',
        );
      }
      try {
        ({ elementReference, stateNote: interactiveStateNote } = await agent.resolveElementReference(parsedBody));
      } catch (error) {
        if (error?.name === 'ElementReferenceValidationError') {
          return apiError(
            'INVALID_REQUEST',
            400,
            error.message,
            undefined,
            parsedBody.elementReference?.kind === 'whiteboard_element'
              ? 'whiteboard_reference_changed'
              : undefined,
          );
        }
        throw error;
      }
    }

    const agentIds = parsedBody.config.agentIds;
    if (
      !Array.isArray(agentIds)
      || agentIds.length === 0
      || agentIds.some((id) => typeof id !== 'string' || id.trim().length === 0 || id !== id.trim())
      || new Set(agentIds).size !== agentIds.length
    ) {
      return apiError(
        'INVALID_REQUEST',
        400,
        'config.agentIds must be a non-empty array of unique, non-empty strings',
      );
    }

    const agentConfigs = await resolveAgentConfigs(deps, parsedBody, ownerId);
    const resolvedIds = new Set(agentConfigs.map((agent) => agent.id));
    const unresolved = agentIds.filter((id) => !resolvedIds.has(id));
    if (unresolved.length > 0) {
      return apiError(
        'INVALID_REQUEST',
        400,
        `Unknown classroom agents in config.agentIds: ${unresolved.join(', ')}`,
      );
    }
    if (agentConfigs.length === 0) {
      return apiError(
        'INVALID_REQUEST',
        400,
        `No valid classroom agents found for config.agentIds: ${agentIds.join(', ')}`,
      );
    }

    const agent = port(deps, 'agent');
    if (typeof agent?.run !== 'function') {
      throw notImplementedAt(
        'zhiyunClassroomStudio.chat.send',
        'app/api/chat/pi/route.ts:271-345',
        '传输层是 ports.agent.run(plan, opts)（上游是 CopilotKit 的 pi 导演循环）',
      );
    }

    const signal = opts.signal;
    const plan = typeof agent.plan === 'function'
      ? await agent.plan({
          kind: 'chat',
          body: parsedBody,
          agentConfigs,
          elementReference,
          interactiveStateNote,
          ownerId,
          enableWhiteboardTools: parsedBody.config.piEnableWhiteboardTools === true,
          requestStartManualVisibilityRevision:
            Number.isSafeInteger(storeState.whiteboardManualVisibilityRevision)
            && (storeState.whiteboardManualVisibilityRevision ?? -1) >= 0
              ? storeState.whiteboardManualVisibilityRevision
              : 0,
          queryWhiteboardVisibility,
        })
      : { kind: 'chat', body: parsedBody, agentConfigs, ownerId };

    const raw = agent.run(plan, {
      signal,
      ownerId,
      // 上游 `elementReference ? { [ELEMENT_REFERENCE_ACCEPTED_HEADER]: '1' } : {}`：
      // `AsyncIterable` 没有响应头，HTTP 桥从 `opts.acknowledged` 补这一条。
      elementReferenceAccepted: Boolean(elementReference),
      queryWhiteboardVisibility,
    });

    return wrapAgentStream(raw, { log, signal });
  }

  /**
   * 源文件:app/api/chat/pi/whiteboard-visibility/route.ts:35-45（POST）+ 47-67（`settle()`）。
   *
   * 上游把"白板是否可见"当成一次**待决查询**：`chat/pi` 派发（带 queryId）→ 前端
   * 用户点开/关 → 这条 route 结案。存储键（`Symbol.for(...)`）与默认值
   * （超时/派发失败 → `unknown`）逐字照抄，见文件下半的 `queryWhiteboardVisibility`。
   *
   * 判据顺序照抄：body 必须是**恰好** `{queryId, stageId, visibility}` 三个键、
   * 三个都非空、visibility ∈ {open, closed}；否则 400。找不到待决查询 → 404。
   */
  async function whiteboardVisibility(body, opts = {}) {
    const resolved = await ownerDeps(deps).owner.resolve(opts.request ?? opts);
    if (resolved?.ok === false) {
      return {
        httpStatus: resolved.httpStatus ?? 401,
        body: resolved.body ?? NOT_FOUND,
        headers: resolved.headers ?? new Headers(),
      };
    }
    const learnerKey = resolved.ownerId;

    const read = readJsonBody(body);
    if (!read.ok) {
      return apiError('INVALID_REQUEST', 400, 'Invalid whiteboard visibility response');
    }
    if (!isValidVisibilityBody(read.value)) {
      return apiError('INVALID_REQUEST', 400, 'Invalid whiteboard visibility response');
    }
    const settled = settleWhiteboardVisibility({ ...read.value, learnerKey });
    if (!settled) {
      return apiError('INVALID_REQUEST', 404, 'Whiteboard visibility query is not pending here');
    }
    return { httpStatus: 204, body: null, headers: new Headers() };
  }

  service.chat = Object.assign(service.chat ?? {}, {
    send: chatSend,
    whiteboardVisibility,
  });

  return service;

  // ── 局部辅助（闭包在 deps 上）──────────────────────────────────────────

  /** 上游 `assertWorkspaceModelsAuthorized(ownerId, [...])`；端口没有就不判（记 ROUTES.md）。 */
  async function assertModelsAuthorized(ownerId) {
    const agent = port(deps, 'agent');
    if (typeof agent?.assertWorkspaceModelsAuthorized !== 'function') return;
    await agent.assertWorkspaceModelsAuthorized(ownerId, [
      'agent', 'agent.title', 'image', 'video', 'tts', 'asr', 'webSearch',
    ]);
  }

  /** 上游 `scheduleConversationTitle(id, ownerId)`：异步标题任务，端口没声明就跳过。 */
  function scheduleTitle(store, id, ownerId, existingCourse) {
    if (existingCourse) return;
    try {
      store.scheduleConversationTitle?.(id, ownerId);
    } catch (error) {
      log.warn?.('会话标题任务派发失败（已忽略）', error?.message ?? error);
    }
  }

  /** 上游 `bindOwnerMaterialsToSession`：端口没有 `bindMaterials` 时材料 id 原样进消息。 */
  async function bindMaterials(store, sessionId, ownerId, materialIds) {
    if (typeof store.bindMaterials === 'function') {
      return store.bindMaterials(sessionId, ownerId, materialIds);
    }
    return [];
  }

  async function retiredIfRetired(store, ownerId) {
    if (typeof store.readRetirement !== 'function') return false;
    try {
      const moved = await store.readRetirement(ownerId);
      return moved !== null && moved !== undefined;
    } catch {
      return false;
    }
  }
}

// ── 模块级辅助（不依赖 deps）───────────────────────────────────────────────

/** 把 `apiError` 这类"一次性响应"的 owner 头补上（上游 `responseHeaders.forEach`）。 */
function withHeaders(response, headers) {
  if (response && response.headers instanceof Headers && headers instanceof Headers) {
    for (const [key, value] of headers) response.headers.append(key, value);
  }
  return response;
}

/** `SessionMaterialBindingError`：上游对它的唯一动作是 404（`materials/route.ts` 同）。 */
class SessionMaterialBindingError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SessionMaterialBindingError';
  }
}

/** 上游 `settle()` 的 `validBody`（`whiteboard-visibility/route.ts:13-33`），逐条照抄。 */
function isValidVisibilityBody(value) {
  const BODY_KEYS = new Set(['queryId', 'stageId', 'visibility']);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return (
    Reflect.ownKeys(value).every((key) => typeof key === 'string' && BODY_KEYS.has(key))
    && Object.hasOwn(value, 'queryId')
    && Object.hasOwn(value, 'stageId')
    && Object.hasOwn(value, 'visibility')
    && typeof value.queryId === 'string'
    && value.queryId.length > 0
    && typeof value.stageId === 'string'
    && value.stageId.length > 0
    && (value.visibility === 'open' || value.visibility === 'closed')
  );
}

/** 上游 `isCoursewareReferenceEnabled()`（`feature-flags.ts:92-94`）。 */
function coursewareReferenceEnabled() {
  const raw = process.env.NEXT_PUBLIC_COURSEWARE_REFERENCE_ENABLED;
  return raw === 'true' || raw === '1';
}

/** 上游 `ownerWriteErrorResponse`（`owner-merges.ts:286-301`）的三条可识别分支。 */
function ownerWriteError(error, headers) {
  if (error?.code === OWNER_RETIRED || error?.kind === OWNER_RETIRED) {
    return ownerRetiredResponse(headers);
  }
  if (error?.code === 'OWNER_BUSY') {
    return jsonResponse(
      { error: { code: 'OWNER_BUSY', message: error?.message ?? 'owner is busy' } },
      503,
      headers,
    );
  }
  if (error?.code === 'COURSE_GENERATING') {
    return jsonResponse(
      { error: { code: error.code, message: error?.message ?? 'course is still generating' } },
      409,
      headers,
    );
  }
  return null;
}

/** 上游 `agentWriteErrorResponse`（`lib/server/agents/http.ts:128-139`）。 */
function agentWriteError(store, error, headers) {
  if (error?.code === 'AGENT_EXISTS' || error?.kind === 'duplicate') {
    return agentsJsonError(409, 'AGENT_EXISTS', error?.message ?? 'agent exists', headers);
  }
  if (error?.code === 'AGENT_NOT_FOUND' || error?.kind === 'not-found') {
    return agentsJsonError(404, 'AGENT_NOT_FOUND', 'no such agent', headers);
  }
  if (error?.code === 'AGENT_LIMIT_REACHED') {
    return agentsJsonError(409, 'AGENT_LIMIT_REACHED', error?.message ?? 'agent limit reached', headers);
  }
  return ownerWriteError(error, headers);
}

/** 端口的 `view`（agents.js 的形状）或恒等。 */
function viewAgent(store, agent) {
  if (store.kind === 'injected' && typeof store.port.view === 'function') {
    return store.port.view(agent);
  }
  return agent;
}

/** 内置 id 判定：端口有 `isBuiltIn` 就用它的（与 `agents.js` 同一答案）。 */
function isBuiltInAgent(store, id) {
  if (store.kind === 'injected' && typeof store.port.isBuiltIn === 'function') {
    return Boolean(store.port.isBuiltIn(id));
  }
  return isBuiltInId(id);
}

async function readAgent(store, ownerId, id) {
  if (store.kind === 'injected') {
    if (typeof store.port.get === 'function') return store.port.get(ownerId, id);
    if (typeof store.port.list === 'function') {
      const all = await store.port.list(ownerId);
      return (all ?? []).find((agent) => agent?.id === id) ?? null;
    }
    return null;
  }
  return (await store.kv.get(`agents/${id}`)) ?? null;
}

/**
 * 三个写动作（`update` / `remove` / `import`）。
 *
 * 端口没声明就抛 `E_NOT_IMPLEMENTED` —— 变更类不静默（协议 §0）。
 * vault 版与 `agents.js` 的降级实现同键（`agents/<id>`），两个文件看到同一份数据。
 */
async function writeAgent(store, action, ownerId, payload) {
  if (store.kind === 'injected') {
    const method = action === 'update'
      ? (store.port.update ?? store.port.put)
      : action === 'remove'
        ? (store.port.remove ?? store.port.delete)
        : store.port.import;
    if (typeof method !== 'function') {
      throw notImplementedAt(
        `zhiyunClassroomStudio.agents.${action === 'update' ? 'put' : action === 'remove' ? 'remove' : 'import'}`,
        'app/api/agents/[id]/route.ts:31-63',
        `注入的 agents 端口没有 ${action} 方法`,
      );
    }
    return method.call(store.port, ownerId, payload);
  }
  const { kv } = store;
  if (action === 'update') {
    const key = `agents/${payload.id}`;
    if (!(await kv.get(key))) {
      const error = new Error('no such agent');
      error.kind = 'not-found';
      throw error;
    }
    await kv.set(key, payload);
    return payload;
  }
  if (action === 'remove') {
    const key = `agents/${payload}`;
    if (!(await kv.get(key))) return false;
    if (typeof kv.remove !== 'function') {
      throw notImplementedAt(
        'zhiyunClassroomStudio.agents.remove',
        'app/api/agents/[id]/route.ts:48-63',
        'vault.kv 没有 remove 方法',
      );
    }
    await kv.remove(key);
    return true;
  }
  // import：一条一条写，已存在的**保留**（上游：`skipped` 里带 reason 'exists'）。
  const imported = [];
  const skipped = [];
  for (const agent of payload) {
    const key = `agents/${agent.id}`;
    // eslint-disable-next-line no-await-in-loop
    if (await kv.get(key)) {
      skipped.push({ id: agent.id, reason: 'exists' });
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    await kv.set(key, agent);
    imported.push(agent);
  }
  return { imported, skipped };
}

/** 上游 `customAgentSchema.safeParse` 的等价物（用于 import 的逐条校验）。 */
function parseImportCandidate(candidate) {
  const value = objectOf(candidate);
  if (!value) return { ok: false, message: 'agent must be an object' };
  if (!isValidAgentId(value.id)) {
    return { ok: false, message: 'id: an agent id is 1-128 letters, digits, "_" or "-"' };
  }
  const { id, ...fields } = value;
  const parsed = parseAgentFields(fields);
  if (!parsed.ok) return { ok: false, message: parsed.message };
  return { ok: true, agent: { ...parsed.agent, id } };
}

/** 上游 `leadingSkillHandle` + `inferSkillIdFromPrompt`（`skills.ts:373-378,428-436`）。 */
async function inferSkillIdFromPrompt(deps, prompt) {
  const match = LEADING_SKILL_HANDLE.exec(prompt);
  if (!match) return undefined;
  const found = await findSkillVia(deps, match[1]);
  return found?.id;
}

async function findSkillVia(deps, ref) {
  const skills = await listFileSkills(deps);
  return skills.find((skill) => matchesSkillRef(skill, ref)) ?? null;
}

/** `sessions.create` 里对 skill 的显式校验（闭包外用同一个实现）。 */
async function findSkill(deps, ref) {
  return findSkillVia(deps, ref);
}

/**
 * 上游 `resolveAgentConfigs`（`lib/chat/pi/config.ts:5-20`）：
 * `config.agentConfigs` 覆盖优先，其次注册表（`ports.agent.registry.getAgent`）。
 */
async function resolveAgentConfigs(deps, body, ownerId) {
  const overrides = new Map();
  for (const cfg of body.config.agentConfigs ?? []) {
    if (!cfg || typeof cfg.id !== 'string') continue;
    overrides.set(cfg.id, { ...cfg, isDefault: false, createdAt: new Date(), updatedAt: new Date() });
  }
  const agent = port(deps, 'agent');
  const lookup = typeof agent?.registry?.getAgent === 'function'
    ? agent.registry.getAgent.bind(agent.registry)
    : null;
  const resolved = [];
  for (const id of body.config.agentIds ?? []) {
    const override = overrides.get(id);
    if (override) {
      resolved.push(override);
      continue;
    }
    if (!lookup) continue;
    // eslint-disable-next-line no-await-in-loop
    const found = await lookup(id, ownerId);
    if (found) resolved.push(found);
  }
  return resolved;
}

/**
 * 把端口的 run 事件流包成 `events.js` 的形状。
 *
 * 上游每帧是 `data: {type, data}\n\n`（`chat/pi/route.ts:201-203`），这里一一对应：
 * `type` 取事件自己的 `type`，`data` 取它自己的 `data`。流内部的异常按上游
 * 322-344 转成一帧 `error`，**不**从迭代器抛出（上游也是写一帧然后关流）。
 */
async function* wrapAgentStream(raw, { log, signal }) {
  try {
    for await (const item of raw) {
      if (signal?.aborted) return;
      if (!item) continue;
      yield {
        type: String(item.type ?? 'message'),
        ts: Number(item.ts ?? Date.now()),
        data: item.data !== undefined ? item.data : item,
        phase: 'live',
      };
    }
  } catch (error) {
    if (signal?.aborted) return;
    log?.error?.('Pi chat stream error:', error?.message ?? error);
    yield {
      type: 'error',
      ts: Date.now(),
      data: { message: error instanceof Error ? error.message : String(error) },
      phase: 'live',
    };
  }
}

export {
  MAX_SESSION_TEXT_LENGTH,
  MAX_IMPORT_BATCH_AGENTS,
  PENDING_VISIBILITY_KEY,
  decodeCourseRefs,
  decodeElementRefs,
  normalizeSessionTitleOverride,
  queryWhiteboardVisibility,
  settleWhiteboardVisibility,
};
