/**
 * 生成运行（generation run）的入参读取与校验
 * （源文件:lib/server/generation/run/input.ts:1-218）。
 *
 * # 改了什么
 *
 * 上游 `readJsonBody(req, maxBytes)` 读 `req.body` 流。宿主层没有 `Request`，
 * 所以签名改成 `readJsonBody(raw, maxBytes)`：`raw` 是调用方已经读好的
 * `Buffer` / `string`（HTTP 桥负责把请求体交上来），**其余判据一字不改**：
 * 先看声明长度（这里看实际字节数，语义相同：超过上限就是 413），解析失败 400。
 *
 * 其余（`parseRunInput` 的全部字段校验、错误文案、去重顺序、`outlineReview`
 * 默认值、`voice.speed` 的 (0,4] 区间）逐行照搬。
 */

/** 上游 `MAX_START_BODY_BYTES`。 */
export const MAX_START_BODY_BYTES = 64 * 1024;
/** 上游 `MAX_COMMAND_BODY_BYTES`（本批只用到 start 路径，保留常量给下一批）。 */
export const MAX_COMMAND_BODY_BYTES = 1024 * 1024;

const MAX_REQUIREMENT_CHARS = 20_000;
const MAX_PROFILE_FIELD_CHARS = 2_000;
const MAX_PRESET_AGENTS = 20;
const AGENT_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;
const PROVIDER_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;
const MAX_VOICE_ID_CHARS = 256;
/** 上游 `MAX_CLASSROOM_MATERIALS` = `MAX_DOCUMENT_BUNDLE_FILES` = 5。 */
export const MAX_CLASSROOM_MATERIALS = 5;
const MATERIAL_ID_PATTERN = /^mat_[0-9abcdefghjkmnpqrstvwxyz]{26}$/;

/** 上游 `isMaterialId`（源:lib/server/materials/material-id.ts）。 */
export function isMaterialId(value) {
  return typeof value === 'string' && MATERIAL_ID_PATTERN.test(value);
}

function toBytes(raw) {
  if (raw instanceof Uint8Array) return raw;
  if (typeof raw === 'string') return Buffer.from(raw, 'utf8');
  return null;
}

/**
 * 上游 `readJsonBody`（源:33-58），入参从 Request 换成已读好的字节。
 *
 * @param {Buffer|Uint8Array|string|null|undefined} raw
 * @param {number} maxBytes
 * @returns {{ok:true,value:unknown}|{ok:false,status:400|413,message:string}}
 */
export function readJsonBody(raw, maxBytes = MAX_START_BODY_BYTES) {
  const tooLarge = { ok: false, status: 413, message: `The body may be at most ${maxBytes} bytes` };
  const bytes = toBytes(raw);
  if (bytes === null) return { ok: false, status: 400, message: 'Invalid JSON body' };
  if (bytes.byteLength > maxBytes) return tooLarge;
  try {
    return { ok: true, value: JSON.parse(Buffer.from(bytes).toString('utf8')) };
  } catch {
    return { ok: false, status: 400, message: 'Invalid JSON body' };
  }
}

function record(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : null;
}

function optionalBoolean(value, name) {
  if (value === undefined) return { ok: true, value: false };
  if (typeof value !== 'boolean') return { ok: false, message: `${name} must be a boolean` };
  return { ok: true, value };
}

function optionalText(value, name, max) {
  if (value === undefined) return { ok: true, value: undefined };
  if (typeof value !== 'string' || value.length > max) {
    return { ok: false, message: `${name} must be a string of at most ${max} characters` };
  }
  return { ok: true, value: value.trim() || undefined };
}

function agentIdList(value, name, minimum) {
  if (
    !Array.isArray(value)
    || value.length < minimum
    || value.length > MAX_PRESET_AGENTS
    || value.some((id) => typeof id !== 'string' || !AGENT_ID_PATTERN.test(id))
  ) {
    return {
      ok: false,
      message: `${name} must name ${minimum} to ${MAX_PRESET_AGENTS} agents by id (letters, digits and ._:-, at most 128 characters)`,
    };
  }
  return { ok: true, value: [...new Set(value)] };
}

/** 上游 `parseRunInput`（源:95-218）。 */
export function parseRunInput(raw) {
  const body = record(raw);
  if (!body) return { ok: false, message: 'The body must be a JSON object' };

  const requirement = body.requirement;
  if (typeof requirement !== 'string' || !requirement.trim()) {
    return { ok: false, message: 'Missing required field: requirement' };
  }
  if (requirement.length > MAX_REQUIREMENT_CHARS) {
    return { ok: false, message: `requirement must be at most ${MAX_REQUIREMENT_CHARS} characters` };
  }

  let materialIds = [];
  if (body.materialIds !== undefined) {
    const invalid = `materialIds must be an array of at most ${MAX_CLASSROOM_MATERIALS} material ids`;
    if (
      !Array.isArray(body.materialIds)
      || body.materialIds.length > MAX_CLASSROOM_MATERIALS * 2
      || body.materialIds.some((id) => typeof id !== 'string' || !isMaterialId(id.trim()))
    ) {
      return { ok: false, message: invalid };
    }
    materialIds = [...new Set(body.materialIds.map((id) => id.trim()))];
    if (materialIds.length > MAX_CLASSROOM_MATERIALS) return { ok: false, message: invalid };
  }

  const interactive = optionalBoolean(body.interactive, 'interactive');
  if (!interactive.ok) return interactive;
  const taskEngine = optionalBoolean(body.taskEngine, 'taskEngine');
  if (!taskEngine.ok) return taskEngine;

  let agents = { mode: 'auto' };
  if (body.agents !== undefined) {
    const value = record(body.agents);
    if (value?.mode === 'auto') {
      if (value.presetAgentIds !== undefined) {
        const ids = agentIdList(value.presetAgentIds, 'agents.presetAgentIds', 0);
        if (!ids.ok) return ids;
        agents = { mode: 'auto', presetAgentIds: ids.value };
      }
    } else if (value?.mode === 'preset') {
      const ids = agentIdList(value.agentIds, 'agents.agentIds', 0);
      if (!ids.ok) return ids;
      agents = { mode: 'preset', agentIds: ids.value };
    } else {
      return {
        ok: false,
        message:
          'agents must be { "mode": "auto", "presetAgentIds"?: [...] } or { "mode": "preset", "agentIds": [...] }',
      };
    }
  }

  let learnerProfile;
  if (body.learnerProfile !== undefined) {
    const value = record(body.learnerProfile);
    if (!value) return { ok: false, message: 'learnerProfile must be an object' };
    const nickname = optionalText(value.nickname, 'learnerProfile.nickname', MAX_PROFILE_FIELD_CHARS);
    if (!nickname.ok) return nickname;
    const bio = optionalText(value.bio, 'learnerProfile.bio', MAX_PROFILE_FIELD_CHARS);
    if (!bio.ok) return bio;
    if (nickname.value || bio.value) {
      learnerProfile = {
        ...(nickname.value ? { nickname: nickname.value } : {}),
        ...(bio.value ? { bio: bio.value } : {}),
      };
    }
  }

  const releaseMaterials = optionalBoolean(body.releaseMaterials, 'releaseMaterials');
  if (!releaseMaterials.ok) return releaseMaterials;

  const outlineReview = body.outlineReview ?? 'wait';
  if (outlineReview !== 'wait' && outlineReview !== 'countdown' && outlineReview !== 'auto') {
    return { ok: false, message: 'outlineReview must be "wait", "countdown" or "auto"' };
  }

  let voice;
  if (body.voice !== undefined) {
    const value = record(body.voice);
    const speed = value?.speed;
    if (
      !value
      || typeof value.providerId !== 'string'
      || !PROVIDER_ID_PATTERN.test(value.providerId)
      || typeof value.voiceId !== 'string'
      || !value.voiceId.trim()
      || value.voiceId.length > MAX_VOICE_ID_CHARS
      || (speed !== undefined && (typeof speed !== 'number' || !(speed > 0) || speed > 4))
    ) {
      return {
        ok: false,
        message: `voice must be { providerId, voiceId (at most ${MAX_VOICE_ID_CHARS} characters), speed? } with a speed above 0 and at most 4`,
      };
    }
    voice = {
      providerId: value.providerId,
      voiceId: value.voiceId.trim(),
      ...(speed !== undefined ? { speed } : {}),
    };
  }

  return {
    ok: true,
    value: {
      requirement,
      materialIds,
      interactive: interactive.value,
      taskEngine: taskEngine.value,
      agents,
      ...(learnerProfile ? { learnerProfile } : {}),
      outlineReview,
      ...(voice ? { voice } : {}),
      ...(releaseMaterials.value && materialIds.length > 0 ? { releaseMaterials: true } : {}),
    },
  };
}
