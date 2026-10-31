// 源：ref/OpenMAIC/lib/server/generation/run/engine.ts:1-60（runner 的推进顺序与「每 step 一个 checkpoint」）
// 源：ref/OpenMAIC/lib/server/generation/run/runner.ts:1-236（执行循环、检测点、失败暂停）
// 源：ref/OpenMAIC/lib/server/generation/run/plan.ts:96-140（advanceRun：已完成段跳过）
// 源：ref/OpenMAIC/lib/server/generation/run/retry.ts:1-108（从 checkpoint 续跑）

import { cancelled, ClassroomGenerateError, describeError } from './errors.js';
import { PHASES, makeEvent } from './events.js';
import { produceMaterialAnalysis, MATERIAL_PHASE } from './phases/material-analysis.js';
import { produceOutline } from './phases/outline.js';
import { produceScenes } from './phases/scenes.js';
import { produceMedia } from './phases/media.js';
import { produceFinalize } from './phases/finalize.js';

/**
 * 四段管线的推进器。
 *
 * # 与上游 runner 的对应
 *
 * 上游 `advanceRun` 每次取「第一个没有 checkpoint 的 step」；本包同理，只不过
 * step 的粒度是**段**（四段），checkpoint 落在 `vault.runs.putStep(runId, phase, output)`。
 * 因此：
 *   - 每段产出只经 `checkpoint()` 写一次，写完才发 `phase-done`（页面的进度条与
 *     落盘状态永远一致：看到 `phase-done` 就说明这段的产物已经在那儿了）；
 *   - `resume()` 传入已有 `outputs`，已完成的段直接 `continue`，不再调模型；
 *   - 取消时**不写当前段的 checkpoint** —— 这就是「落盘不脏」的那条线。
 *
 * # 取消为什么用 race
 *
 * 窄 llm 的 `call` 可能不理会 `signal`（宿主的实现不保证）。只靠「每次循环前查
 * aborted」会让 `stream()` 卡在一次已废弃的请求上，取消就成了摆设。`raceAbort`
 * 让管线在 abort 的瞬间抛 `E_CANCELLED`，被丢弃的那次调用结果不会进 snapshot
 * （checkpoint 在 race 之后）。孤儿请求的副作用只剩「模型侧多跑一次」。
 */

/** 每段一个 producer，签名统一为 `(job) => Promise<output>`。 */
const PRODUCERS = {
  outline: async (job) => produceOutline({
    brief: job.brief,
    llm: job.llm,
    agent: job.ports.agent,
    // 第 0 段产出的讲义正文；没有讲义时就是空串（prompt 里那一节整段不出现）。
    materialText: job.outputs.get(MATERIAL_PHASE)?.text ?? '',
    emit: job.emit,
    signal: job.signal,
  }),

  scenes: async (job) => produceScenes({
    outlines: job.outputs.get('outline')?.outlines ?? [],
    brief: job.brief,
    llm: job.llm,
    pbl: job.ports.pbl,
    stageId: job.stageId,
    emit: job.emit,
    signal: job.signal,
    now: job.ports.now,
  }),

  media: async (job) => produceMedia({
    outlines: job.outputs.get('outline')?.outlines ?? [],
    scenes: job.outputs.get('scenes')?.scenes ?? [],
    media: job.ports.media,
    vault: job.ports.vault,
    stageId: job.stageId,
    emit: job.emit,
    signal: job.signal,
  }),

  finalize: async (job) => produceFinalize({
    outlines: job.outputs.get('outline')?.outlines ?? [],
    scenes: job.outputs.get('scenes')?.scenes ?? [],
    mediaResults: job.outputs.get('media')?.results ?? [],
    brief: job.brief,
    stageId: job.stageId,
    runId: job.runId,
    vault: job.ports.vault,
    emit: job.emit,
    now: job.ports.now,
  }),
};

/**
 * 跑（或续跑）一次生成。
 *
 * @param {object} job
 * @param {object} job.record run 记录（`{ runId, brief, stageId, controller, outputs, log }`）
 * @param {object} job.llm `resolveLlm` 的结果
 * @param {object} job.ports `{ agent, pbl, vault, media, now }`
 * @param {(phase: string, output: object) => Promise<void>} job.checkpoint
 */
export async function runPipeline(job) {
  const { record, ports } = job;
  const { runId, brief, stageId } = record;
  const signal = record.controller.signal;

  let currentPhase = firstPendingPhase(record.outputs);
  // 把「当前阶段」也写进 record：`run-error` 要用它定位失败在哪一段，
  // 而轮询进度时要显示「正在规划讲课顺序 / 正在生成每页内容」。
  // 只做局部变量的话，外部只能看到「哪些阶段完成了」，看不到「正在做哪一段」。
  record.currentPhase = currentPhase;

  const emit = (phase, kind, payload, sceneId) => {
    // 场景级进度：每产出一页就 +1。
    //
    // `scenes` 阶段是**整批返回**的（produceScenes 跑完才有 outputs），
    // 所以只靠 `record.outputs` 的话，整段期间外部看到的「已备好」永远是 0 ——
    // 用户盯着一个不动的数字，跟卡死没区别。事件流里有 `scene-ready`，
    // 在这里累计，轮询就能显示真实进度。
    if (kind === 'scene-ready') record.readyScenes = (record.readyScenes ?? 0) + 1;
    return record.log.push(makeEvent({
    runId,
    phase,
    kind,
    sceneId,
    payload,
    ts: ports.now(),
  }));
  };

  try {
    // ── 第 0 段（可选）：上传的讲义 → 一段可以进 prompt 的文本 ────────────
    //
    // 上游 `plan.ts:44-55`：只有 `input.materialIds` 非空才插这一步。没有讲义时
    // 下面这块一行都不执行，事件序列与「四段管线」逐事件一致（既有用例不受影响）。
    if (needsMaterialPhase(record) && !record.outputs.has(MATERIAL_PHASE)) {
      currentPhase = MATERIAL_PHASE;
      record.currentPhase = currentPhase;
      emit(MATERIAL_PHASE, 'phase-start', {
        phase: MATERIAL_PHASE,
        index: -1,          // 前置段：不在 PHASES 里，页面按「准备」而不是「第 5 步」显示
        total: PHASES.length,
        optional: true,
      });

      const output = await raceAbort(
        produceMaterialAnalysis({
          brief,
          vault: ports.vault,
          media: ports.media,
          emit,
          signal,
        }),
        signal,
        MATERIAL_PHASE,
        runId,
      );
      if (signal.aborted) throw cancelled(MATERIAL_PHASE, runId);

      await job.checkpoint(MATERIAL_PHASE, output);
      record.outputs.set(MATERIAL_PHASE, output);
      emit(MATERIAL_PHASE, 'phase-done', {
        materials: output.materials.length,
        failures: output.failures.length,
        chars: output.chars,
        truncated: output.truncated,
      });
    }

    for (const phase of PHASES) {
      if (record.outputs.has(phase)) continue; // 续跑：已完成段不重跑
      if (signal.aborted) throw cancelled(phase, runId);

      currentPhase = phase;
      record.currentPhase = currentPhase;
      emit(phase, 'phase-start', { phase, index: PHASES.indexOf(phase), total: PHASES.length });

      const output = await raceAbort(
        PRODUCERS[phase]({
          runId,
          brief,
          stageId,
          llm: job.llm,
          ports,
          outputs: record.outputs,
          emit,
          signal,
        }),
        signal,
        phase,
        runId,
      );

      if (signal.aborted) throw cancelled(phase, runId);
      await job.checkpoint(phase, output);
      record.outputs.set(phase, output);

      emit(phase, 'phase-done', summarize(phase, output));
    }

    record.status = 'done';
    const material = record.outputs.get(MATERIAL_PHASE);
    emit('finalize', 'run-done', {
      runId,
      stageId,
      sceneCount: record.outputs.get('scenes')?.scenes?.length ?? 0,
      phases: [...PHASES],
      generated: record.outputs.get('media')?.generated ?? 0,
      skipped: record.outputs.get('scenes')?.skipped?.length ?? 0,
      // 只有真的读了讲义才出现这两个字段：没有讲义时事件形状与从前完全一致。
      ...(material ? { materials: material.materials.length, materialChars: material.chars } : {}),
    });
  } catch (error) {
    const isCancelled = error instanceof ClassroomGenerateError && error.code === 'E_CANCELLED';
    record.status = isCancelled ? 'cancelled' : 'failed';
    record.error = describeError(error);
    emit(currentPhase ?? 'finalize', 'run-error', {
      ...record.error,
      phase: currentPhase ?? null,
      ...(isCancelled ? { cancelled: true } : {}),
    }, undefined);
  } finally {
    record.endedAt = ports.now();
    record.log.close();
  }
}

/** 第一个还没 checkpoint 的段；全有就是 `finalize`（本次只会补 run-done）。 */
export function firstPendingPhase(outputs) {
  for (const phase of PHASES) {
    if (!outputs.has(phase)) return phase;
  }
  return 'finalize';
}

/**
 * 这次 run 要不要先读讲义。
 *
 * 只看 `brief.materialIds`：续跑时调用点还带 `!outputs.has(MATERIAL_PHASE)`，
 * 所以「已经解析过的不再解析」是判断出来的，不靠额外状态位。
 */
function needsMaterialPhase(record) {
  const ids = record.brief?.materialIds;
  return Array.isArray(ids) && ids.length > 0;
}

function summarize(phase, output) {
  if (phase === 'outline') {
    return {
      outlines: output.outlines.length,
      source: output.source,
      courseTitle: output.courseTitle ?? null,
    };
  }
  if (phase === 'scenes') {
    return {
      scenes: output.scenes.length,
      skipped: output.skipped.length,
    };
  }
  if (phase === 'media') {
    return {
      items: output.items.length,
      generated: output.generated,
      skipped: output.skipped,
      failed: output.failures.length,
    };
  }
  return { stageId: output.stageId, scenes: output.sceneCount };
}

/** 把「可能不理会 signal 的 promise」和「abort」赛跑；abort 先到就抛 E_CANCELLED。 */
function raceAbort(promise, signal, phase, runId) {
  if (signal.aborted) return Promise.reject(cancelled(phase, runId));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(cancelled(phase, runId));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}
