/**
 * 无头课堂 API 的视图层（源文件:lib/server/generate-classroom-job.ts:1-297）。
 *
 * `POST /api/generate-classroom` 的 body 解析、以及把 run 映射成 job 的两张表
 * （状态表、步骤表）与四段文案，全部逐行照搬。这些文案是前端文案的一部分
 * （`message` 直接显示在卡片上），改一个字就是观感漂移。
 *
 * 唯一改动：`requiredModelRefusal(ownerId)` 依赖模型槽位解析（`resolveModel` +
 * 槽位错误类型），属 L2 的模型配置层，这里**改成工厂参数**（`deps.resolveStage`），
 * 未注入时返回 `null`（= 不因模型缺失拒绝），并在 ROUTES.md 记为差异。
 */

import { parseRunInput } from './run-input.js';

export const CLASSROOM_JOB_POLL_INTERVAL_MS = 5000;

const PDF_CONTENT_REMOVED_MESSAGE =
  'pdfContent is no longer accepted: upload the document with POST /api/materials and pass the returned materialId in materialIds';

/** 上游 `parseClassroomJobBody`（源:60-79）。 */
export function parseClassroomJobBody(raw) {
  const body = (typeof raw === 'object' && raw !== null ? raw : {});
  if (body.pdfContent !== undefined) {
    return { ok: false, code: 'INVALID_REQUEST', message: PDF_CONTENT_REMOVED_MESSAGE };
  }
  if (typeof body.requirement !== 'string' || !body.requirement.trim()) {
    return { ok: false, code: 'MISSING_REQUIRED_FIELD', message: 'Missing required field: requirement' };
  }
  const parsed = parseRunInput({
    requirement: body.requirement,
    ...(body.materialIds !== undefined ? { materialIds: body.materialIds } : {}),
    outlineReview: 'auto',
  });
  if (!parsed.ok) return { ok: false, code: 'INVALID_REQUEST', message: parsed.message };
  return { ok: true, input: parsed.value };
}

/**
 * 上游 `CONTENT_STAGES`（`LLM_STAGES` 里 `scene-content:` 前缀的那几条，
 * 源:lib/server/model-routes.ts:129-133）。
 */
export const CONTENT_STAGES = Object.freeze([
  'scene-content:slide',
  'scene-content:quiz',
  'scene-content:interactive',
  'scene-content:pbl',
]);

/**
 * 上游 `requiredModelRefusal`（源:124-139）。
 *
 * @param {string} ownerId
 * @param {(stage: string, workspaceId: string|null) => Promise<{code:string,message:string}|null>} resolveStage
 *   `stage` 解析成失败原因，或 `null` 表示可解析。未注入时整条检查跳过（返回 null）。
 */
export async function requiredModelRefusal(ownerId, resolveStage) {
  if (typeof resolveStage !== 'function') return null;
  const workspaceId = ownerId ?? null;
  const outline = await resolveStage('scene-outlines-stream', workspaceId);
  if (outline) return outline;
  let firstContentRefusal = null;
  for (const stage of CONTENT_STAGES) {
    const refusal = await resolveStage(stage, workspaceId);
    if (!refusal) {
      firstContentRefusal = null;
      break;
    }
    firstContentRefusal ??= refusal;
  }
  if (firstContentRefusal) return firstContentRefusal;
  return resolveStage('scene-actions', workspaceId);
}

/** 上游 `jobStatus`（源:153-164）。 */
function jobStatus(run) {
  const byState = {
    preparing: run.step === null ? 'queued' : 'running',
    outlining: 'running',
    awaiting_outline_confirmation: 'running',
    generating: 'running',
    completed: 'succeeded',
    paused: 'failed',
    ended: 'failed',
  };
  return byState[run.state];
}

/** 上游 `jobStep`（源:166-180）。 */
function jobStep(run, status) {
  if (status === 'queued' || status === 'failed') return status;
  if (run.state === 'completed') return 'completed';
  if (run.step === 'material-analysis') return 'initializing';
  if (run.step === 'research') return 'researching';
  if (run.state === 'outlining' || run.state === 'awaiting_outline_confirmation') {
    return 'generating_outlines';
  }
  if (run.state === 'preparing') return 'researching';
  const { scenesTotal, scenesCompleted } = run.progress;
  return scenesTotal > 0 && scenesCompleted >= scenesTotal ? 'generating_media' : 'generating_scenes';
}

/** 上游 `jobProgress`（源:183-190）。 */
function jobProgress(run, status) {
  if (status === 'queued') return 0;
  if (status === 'succeeded') return 100;
  const { scenesTotal, scenesCompleted } = run.progress;
  if (scenesTotal > 0) return Math.min(90, 30 + Math.floor((scenesCompleted / scenesTotal) * 60));
  if (run.state === 'preparing') return run.step === 'research' ? 10 : 5;
  return 15;
}

/** 上游 `jobMessage`（源:192-212）。 */
function jobMessage(run, step) {
  const { scenesTotal, scenesCompleted } = run.progress;
  switch (step) {
    case 'queued':
      return 'Classroom generation job queued';
    case 'initializing':
      return `Extracting ${run.input.materialIds.length} uploaded material(s)`;
    case 'researching':
      return 'Researching topic';
    case 'generating_outlines':
      return 'Generating scene outlines';
    case 'generating_scenes':
      return `Generated ${scenesCompleted}/${scenesTotal} scenes`;
    case 'generating_media':
      return 'Generating media files';
    case 'completed':
      return 'Classroom generation completed';
    case 'failed':
      return 'Classroom generation failed';
    default:
      return 'Classroom generation failed';
  }
}

/** 上游 `jobError`（源:214-226）。 */
function jobError(run) {
  if (run.state === 'paused') {
    const message = run.error?.message ?? 'A generation step failed';
    const failed = run.error?.step ? `${run.error.step}: ${message}` : message;
    return `${failed} (the run is paused and keeps what it generated; POST /api/generation-runs/${run.id}/retry with { "commandId": "<a new id>" } resumes it at this step)`;
  }
  if (run.state === 'ended') {
    return run.stageId
      ? 'The classroom was deleted before its generation finished'
      : 'The generation run was discarded';
  }
  return undefined;
}

/** 上游 `completionWarning`（源:233-257）。 */
function completionWarning(run, media) {
  const states = Object.values(media ?? {});
  const counts =
    states.length > 0
      ? {
          total: states.length,
          failed: states.filter((state) => state.status === 'failed').length,
        }
      : (run.mediaSummary ?? { total: 0, failed: 0 });
  const parts = [];
  if (counts.failed > 0) {
    parts.push(
      `${counts.failed} of ${counts.total} images and videos could not be generated (see GET /api/generation-runs/${run.id}; the retryable ones can be retried there)`,
    );
  }
  if (run.narrationUnvoiced > 0) {
    parts.push(
      `${run.narrationUnvoiced} speech clip${run.narrationUnvoiced === 1 ? ' was' : 's were'} left without narration`,
    );
  }
  return parts.length > 0 ? parts.join('; ') : undefined;
}

/**
 * 上游 `classroomJobView`（源:260-297）。
 *
 * `origin` 在宿主层是**相对基址**：调用方传 `''` 时 `pollUrl` 就是上游路径本身
 * （`/api/generate-classroom/<id>`），HTTP 桥负责补 scheme+host。这条已记进
 * ROUTES.md（上游 `buildRequestOrigin(req)` 读 `req.nextUrl`，宿主没有该对象）。
 */
export function classroomJobView(run, media = {}, origin = '') {
  const status = jobStatus(run);
  const step = jobStep(run, status);
  const warning = status === 'succeeded' ? completionWarning(run, media) : undefined;
  const error = jobError(run);
  return {
    jobId: run.id,
    /** The run behind the job: `GET`/`POST /api/generation-runs/<runId>…` (Retry, events). */
    runId: run.id,
    runState: run.state,
    status,
    step,
    progress: jobProgress(run, status),
    message: warning ?? jobMessage(run, step),
    pollUrl: `${origin}/api/generate-classroom/${run.id}`,
    pollIntervalMs: CLASSROOM_JOB_POLL_INTERVAL_MS,
    scenesGenerated: run.progress.scenesCompleted,
    ...(run.progress.scenesTotal > 0 ? { totalScenes: run.progress.scenesTotal } : {}),
    ...(status === 'succeeded' && run.stageId
      ? {
          result: {
            classroomId: run.stageId,
            url: `${origin}/classroom/${run.stageId}`,
            scenesCount: run.progress.scenesCompleted,
            ...(warning ? { warning } : {}),
          },
        }
      : {}),
    ...(error ? { error } : {}),
    /** A failed job whose run is paused: a step Retry resumes it. */
    retryable: run.state === 'paused',
    done: status === 'succeeded' || status === 'failed',
  };
}
