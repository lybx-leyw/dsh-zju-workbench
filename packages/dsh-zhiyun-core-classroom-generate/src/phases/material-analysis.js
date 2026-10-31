// 源：ref/OpenMAIC/lib/server/generation/run/plan.ts:44-55（有 materialIds 才插这一段）
// 源：ref/OpenMAIC/lib/server/generation/run/engine.ts:599-635（等抽取 → 取文本 → 落成课程资产）
// 源：ref/OpenMAIC/lib/server/generation/run/engine.ts:774（`pdfText` 交给 outline 段）
// 源：ref/OpenMAIC/lib/server/classroom-materials.ts（材料不可用时的拒绝口径）

import { ClassroomGenerateError, describeError } from '../errors.js';

/** 段名。不进 `PHASES`：上游这一段是**可选**的（没有 materialIds 就没有这一步）。 */
export const MATERIAL_PHASE = 'material-analysis';

/**
 * 一次生成喂给模型的讲义总字数上限（上游 `MAX_CLASSROOM_MATERIAL_TEXT`）。
 *
 * 超了就截断并在事件里报 `truncated`，而不是静默丢后文：页面要能告诉用户
 * 「讲义太长，后 30% 没进模型」。字数而不是字节 —— 模型按 token 计费，
 * 中文一字约 1 token，字节数对中文是 3 倍噪音。
 */
export const MATERIAL_TEXT_LIMIT = 240_000;

/** 上游 `MAX_CLASSROOM_MATERIALS`：一次最多挂几份。 */
export const MAX_MATERIALS = 8;

/**
 * 第 0 段（可选）：上传的讲义 → 一段可以塞进 prompt 的文本。
 *
 * # 与上游的差异（唯一一处）
 *
 * 上游是**上传即抽取**（`POST /api/materials` 后台跑 worker，`extraction.status`
 * 走 `idle → extracting → ready|failed`，run 只等结果）。本仓没有常驻 worker，
 * 所以改成**生成时抽取**：字节本来就在 `vault.assets` 里，读出来解析一次即可，
 * 结果不落盘（同一份讲义重新生成会再解析一次）。
 *
 * 这个差异对用户可见的行为只有一条：第一次生成会多花几秒，而不是上传时预支。
 * 换来的是「不需要后台进程也能用」—— 桌面端没有常驻 worker 的位置。
 *
 * # 为什么素材字节从 `vault.assets` 读，而不是 `vault.materials`
 *
 * `materials` 表按 `sessionId` 分区（上游是 `agent_session_materials`，一张链接表），
 * 而 run 只有 `materialId`、没有会话 id。素材字节的落盘键是 `material-<id>`
 * （见 host 的 `assetStage`），读它不需要会话上下文。
 *
 * # 全失败为什么抛错
 *
 * 部分讲义读不出来 → 用能读的那几份继续（并逐份报失败）。
 * 一份都读不出来 → 抛 `E_MATERIAL_UNAVAILABLE`。这与上游 `ClassroomMaterialsUnavailableError`
 * 同口径：用户传了讲义却让模型凭空讲，比直接告诉他"讲义没读进来"更糟。
 *
 * @param {object} input
 * @param {object} input.brief 归一化后的 brief（只读 `materialIds`）
 * @param {object} input.vault `ctx.zhiyunClassroomVault`
 * @param {object} input.media `ctx.zhiyunClassroomMedia`（`parsePdf`）
 * @param {(phase: string, kind: string, payload: object) => void} input.emit
 * @param {string} [input.phase]
 * @param {AbortSignal} [input.signal]
 * @returns {Promise<{materials: object[], failures: object[], text: string, chars: number, truncated: boolean}>}
 */
export async function produceMaterialAnalysis({
  brief,
  vault,
  media,
  emit,
  phase = MATERIAL_PHASE,
  signal,
}) {
  const ids = Array.isArray(brief?.materialIds) ? brief.materialIds : [];
  // 没有讲义：不 emit、不读盘，与「四段管线」时代的行为逐字节一致。
  if (ids.length === 0) return { materials: [], failures: [], text: '', chars: 0, truncated: false };

  const picked = ids.slice(0, MAX_MATERIALS);
  if (ids.length > MAX_MATERIALS) {
    emit(phase, 'phase-progress', {
      step: 'material',
      status: 'skipped',
      reason: 'too_many',
      total: ids.length,
      limit: MAX_MATERIALS,
    });
  }

  if (!vault?.assets?.bytes || !vault?.assets?.get) {
    throw new ClassroomGenerateError(
      'E_MATERIAL_UNAVAILABLE',
      '传了讲义但课堂持久层没有装载（缺 zhiyunClassroomVault.assets）',
      { materialIds: picked },
    );
  }
  if (typeof media?.parsePdf !== 'function') {
    throw new ClassroomGenerateError(
      'E_MATERIAL_UNAVAILABLE',
      '传了讲义但 PDF 解析层没有装载（缺 zhiyunClassroomMedia.parsePdf）',
      { materialIds: picked },
    );
  }

  const materials = [];
  const failures = [];
  const sections = [];
  let budget = MATERIAL_TEXT_LIMIT;
  let truncated = false;

  for (const [index, materialId] of picked.entries()) {
    if (signal?.aborted) break;

    emit(phase, 'phase-progress', {
      step: 'material',
      status: 'reading',
      index,
      total: picked.length,
      materialId,
    });

    try {
      const assetId = `material-${materialId}`;
      const entry = await vault.assets.get(assetId, assetId);
      if (!entry) {
        throw new ClassroomGenerateError('E_MATERIAL_UNAVAILABLE', `找不到讲义字节：${materialId}`, {
          materialId,
        });
      }
      const bytes = await vault.assets.bytes(assetId, assetId);
      const name = entry.meta?.name || entry.meta?.originalName || `${materialId}.pdf`;

      const parsed = await media.parsePdf(bytes, {
        fileName: name,
        mimeType: entry.mime,
        textOnly: true,
        signal,
      });
      if (!parsed?.ok) {
        throw new ClassroomGenerateError(
          'E_MATERIAL_UNAVAILABLE',
          `讲义解析失败：${name}（${parsed?.code ?? 'E_UPSTREAM_ERROR'}）`,
          { materialId, code: parsed?.code, message: parsed?.message },
        );
      }

      const full = String(parsed.text ?? '').trim();
      if (!full) {
        throw new ClassroomGenerateError('E_MATERIAL_UNAVAILABLE', `讲义里没有可提取的文字：${name}`, {
          materialId,
        });
      }

      // 预算按字分配：先到先得，后一份可能被截成 0 —— 那就是真的没进 prompt，
      // 所以在 `materials[].chars` 里如实写 0，而不是把它记成成功。
      const take = Math.max(0, Math.min(full.length, budget));
      budget -= take;
      const slice = full.slice(0, take);
      const dropped = take < full.length;
      if (dropped) truncated = true;

      if (take > 0) sections.push(`### 讲义 ${sections.length + 1}：${name}\n${slice}`);

      materials.push({
        materialId,
        name,
        mime: entry.mime ?? null,
        chars: take,
        totalChars: full.length,
        truncated: dropped,
        provider: parsed.provider ?? null,
      });

      emit(phase, 'phase-progress', {
        step: 'material',
        status: 'ok',
        materialId,
        name,
        chars: take,
        totalChars: full.length,
        truncated: dropped,
      });
    } catch (error) {
      const info = describeError(error, 'E_MATERIAL_UNAVAILABLE');
      failures.push({ materialId, ...info });
      emit(phase, 'phase-progress', {
        step: 'material',
        status: 'failed',
        materialId,
        ...info,
      });
    }
  }

  // 用户取消：把「没读的部分」如实说清楚，别伪装成全部读完。
  if (signal?.aborted) {
    return {
      materials,
      failures,
      text: sections.join('\n\n'),
      chars: MATERIAL_TEXT_LIMIT - budget,
      truncated,
      cancelled: true,
    };
  }

  if (materials.length === 0) {
    throw new ClassroomGenerateError(
      'E_MATERIAL_UNAVAILABLE',
      `上传的 ${picked.length} 份讲义全部无法读取，无法据此备课`,
      { failures },
    );
  }

  return {
    materials,
    failures,
    text: sections.join('\n\n'),
    chars: MATERIAL_TEXT_LIMIT - budget,
    truncated,
  };
}
