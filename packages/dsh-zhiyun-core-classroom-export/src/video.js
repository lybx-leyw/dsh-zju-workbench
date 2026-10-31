/**
 * 视频导出的可移植子集：时间轴 IR（旁白节拍 + 字幕轨）+ 渲染委派。
 *
 * 源：ref/OpenMAIC/lib/video-export/subtitles.ts:1-60（SRT / WebVTT 序列化）
 *     ref/OpenMAIC/lib/video-export/ir.ts:1-429（VideoTimeline 的字段语义）
 *     ref/OpenMAIC/lib/video-export/passes/timeline.ts:96-140（节拍累加与字幕推导）
 *     ref/OpenMAIC/lib/choreography/timing.ts:113-130（无音频时的朗读估算）
 *     ref/OpenMAIC/lib/export/narration.ts:266-282（旁白口径）
 *
 * # 为什么不是完整移植
 *
 * 上游这条链路是「纯编译（8k 行 passes）→ Hyperframes 合成 → Chrome 逐帧渲染 →
 * ffmpeg 编码」。前两段是纯函数，可以在 Node 里跑；**后两段必须有浏览器与 ffmpeg**，
 * 而且依赖 `lib/video-export-app/`（React hook + 前端时间轴），属于页面包的产物。
 * 本包先交付"系统契约"这一层：与上游同构的节拍（同样的朗读估算、同样的字幕推导）、
 * 同样的 SRT/VTT 序列化，以及一个 `render` 委派口 —— 宿主注入渲染器就能产出 mp4，
 * 不注入时返回可直接喂给渲染器的计划，而不是假装成功。
 *
 * # 节拍规则（与源一致）
 *
 * 每段 speech 独占它的时长（有音频用音频时长，否则用朗读估算）；spotlight / laser
 * 这类"即发即忘"的动作不推进游标、不计时长；场景时长 = 其动作时长之和，空场景给
 * 一个停顿时长。字幕是"每个非空 speech 一条"，时间轴是全局 wall-clock。
 */

/**
 * 朗读时长估算：**从舞台包复用，不在这里重写一份**。
 *
 * 三处（stage/timeline、export/video、agent/timing）原本各抄一份实现与
 * 常量表，数值恰好一致只是巧合 —— 任何一处被单独调整，导出视频的音轨
 * 就会与播放器静默漂开。舞台的时间轴是唯一真源，从它导入。
 */
export { estimateSpeechDurationMs } from 'dsh-zhiyun-core-classroom-timing';

/** 源：timeline.ts（EFFECT_AUTO_CLEAR_MS 一类的即发即忘动作，不推进游标）。 */
const FIRE_AND_FORGET = new Set([
  'spotlight',
  'laser',
  'widget_highlight',
  'widget_setState',
  'widget_annotation',
  'widget_reveal',
]);

/** 源：timeline.ts — 空场景的停留节拍。 */
export const EMPTY_SCENE_DWELL_MS = 1500;

/** 源：subtitles.ts:15-23 */
function formatTimestamp(ms, separator) {
  const clamped = Math.max(0, Math.round(ms));
  const hours = Math.floor(clamped / 3_600_000);
  const minutes = Math.floor((clamped % 3_600_000) / 60_000);
  const seconds = Math.floor((clamped % 60_000) / 1000);
  const millis = clamped % 1000;
  const pad = (value, width = 2) => String(value).padStart(width, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}${separator}${pad(millis, 3)}`;
}

/** 源：subtitles.ts:29-31 */
function normalizeText(text) {
  return String(text ?? '').replace(/\r\n?/g, '\n').replace(/\s+$/g, '');
}

/** 源：subtitles.ts:38-40 */
export function usableCues(cues) {
  return cues.filter((cue) => cue.endMs > cue.startMs && normalizeText(cue.text).length > 0);
}

/** 源：subtitles.ts:43-50 */
export function toSrt(cues) {
  return usableCues(cues)
    .map((cue, index) => {
      const start = formatTimestamp(cue.startMs, ',');
      const end = formatTimestamp(cue.endMs, ',');
      return `${index + 1}\n${start} --> ${end}\n${normalizeText(cue.text)}\n`;
    })
    .join('\n');
}

/** 源：subtitles.ts:53-60 */
export function toVtt(cues) {
  const blocks = usableCues(cues).map((cue) => {
    const start = formatTimestamp(cue.startMs, '.');
    const end = formatTimestamp(cue.endMs, '.');
    return `${start} --> ${end}\n${normalizeText(cue.text)}\n`;
  });
  return `WEBVTT\n\n${blocks.join('\n')}`;
}

/**
 * 源：passes/timeline.ts:96-140 —— 场景顺序 + 节拍累加 + 字幕推导。
 *
 * @param {object[]} scenes
 * @param {{playbackSpeed?: number, getAudioDurationMs?: (action:object)=>number|undefined}} [options]
 * @returns {{scenes: object[], subtitles: object[], totalDurationMs: number, diagnostics: object[]}}
 */
export function buildVideoTimeline(scenes, options = {}) {
  const speed = options.playbackSpeed ?? 1;
  const subtitles = [];
  const diagnostics = [];
  const timeline = [];
  let cursor = 0;

  scenes.forEach((scene, sceneIndex) => {
    const startMs = cursor;
    let hasBeat = false;
    for (const action of scene.actions ?? []) {
      if (!action) continue;
      if (FIRE_AND_FORGET.has(action.type)) continue;
      if (action.type === 'play_video') {
        const duration = 3000;
        cursor += duration;
        hasBeat = true;
        continue;
      }
      if (action.type === 'discussion') {
        // 源：讨论卡片 = 触发延迟 + 自动跳过倒计时（人工介入不在确定性模型内）。
        cursor += 6000;
        hasBeat = true;
        continue;
      }
      if (action.type !== 'speech') continue;
      const audio = options.getAudioDurationMs?.(action);
      const duration = audio != null ? audio / speed : estimateSpeechDurationMs(action.text, { speed });
      if (audio == null) {
        diagnostics.push({
          code: 'estimated-duration',
          sceneIndex,
          actionId: action.id,
          message: 'narration has no stored audio duration; estimated from text',
        });
      }
      const text = typeof action.text === 'string' ? action.text : '';
      if (text.trim()) {
        subtitles.push({ startMs: cursor, endMs: cursor + duration, text });
      }
      cursor += duration;
      hasBeat = true;
    }
    if (!hasBeat) cursor += EMPTY_SCENE_DWELL_MS;
    timeline.push({
      index: sceneIndex,
      id: scene.id,
      type: scene.content?.type ?? scene.type,
      title: scene.title ?? '',
      startMs,
      endMs: cursor,
    });
  });

  return { scenes: timeline, subtitles, totalDurationMs: cursor, diagnostics };
}

/**
 * 视频导出入口。
 *
 * @param {{stage:object, scenes:object[]}} classroom
 * @param {object} [options]
 * @param {'srt'|'vtt'} [options.subtitleFormat]
 * @param {number} [options.playbackSpeed]
 * @param {(action:object)=>number|undefined} [options.getAudioDurationMs]
 * @param {(plan:object)=>Promise<any>} [options.render] 宿主渲染器（ffmpeg / Chrome）
 * @returns {Promise<object>}
 */
export async function exportVideo(classroom, options = {}) {
  const timeline = buildVideoTimeline(classroom.scenes ?? [], options);
  const format = options.subtitleFormat ?? 'vtt';
  const plan = {
    schema: 'openmaic.videoTimeline',
    version: 4,
    stage: { id: classroom.stage?.id, name: classroom.stage?.name },
    durationMs: timeline.totalDurationMs,
    scenes: timeline.scenes,
    subtitles: timeline.subtitles,
    subtitleText: format === 'srt' ? toSrt(timeline.subtitles) : toVtt(timeline.subtitles),
    diagnostics: timeline.diagnostics,
    // 渲染器需要什么，写清楚；不注入 render 时调用方据此决定用哪个执行器。
    requires: ['ffmpeg', 'headless-chromium'],
    rendered: false,
  };

  if (typeof options.render !== 'function') return plan;

  const result = await options.render(plan);
  return {
    ...plan,
    rendered: true,
    output: result,
  };
}
