/**
 * 基准的**执行器**：拿真实原稿跑一次完整解析 + 习坎，把每一步的中间产物吐给上层。
 *
 * # 为什么是"吐中间产物"而不是"只吐结果"
 *
 * 界面上要按 `docs/show/zhiyun-pipeline.html` 那条链路逐步展示：
 * 识别 → 标记 → 建树 → 重构 → 习坎 → 终稿。若这里只回最终讲义，前端就只能
 * "转圈等到结束，然后啪一下出现结果" —— 那看不出任何一步在做什么。
 *
 * 所以每次阶段性进展都往 stdout 打一行 `@@EV@@{json}`，前端流式读取并渲染。
 *
 * # 模型从哪来
 *
 * 用户填的 `baseUrl` + `apiKey`。**只在内存里**：本脚本不写任何文件、
 * 不进日志、不回显到事件里（错误信息里也把 key 擦掉）。
 *
 * # 用法（由 `bench.mjs` 以子进程方式调用）
 *
 *     node scripts/knowledge_tree_bench/run.mjs
 *
 * 从 stdin 读一行 JSON：
 * `{ baseUrl, apiKey, model, visionModel, sectionKey, maxPages, splitLine, concurrency, skipLecture }`
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { setRoot, mount, serviceOf } from './_base.mjs';
import { V4_PROFILE, V4_ACCEL } from '../../packages/dsh-zhiyun-core-parser/src/generation-profile.js';
import { openAiHost } from './openai.mjs';
import { resolveConfig } from './defaults.mjs';
import { createWriter } from './log.mjs';
import { makeEvent, eventsFromResult, eventsFromLecture } from './events.mjs';
import { pureApi as lecturePure } from './lecture.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const ROOT = path.resolve(HERE, '..', '..');
const DATA = path.join(HERE, 'data');
setRoot(ROOT + path.sep);

const emit = (value) => { process.stdout.write(`@@EV@@${JSON.stringify(value)}\n`); };

/** 把 apiKey 从任何字符串里擦掉（错误信息可能把请求体回显出来）。 */
const scrub = (text, apiKey) => {
  let s = String(text ?? '');
  if (apiKey && apiKey.length >= 6) s = s.split(apiKey).join('[REDACTED]');
  return s.slice(0, 1200);
};

/* ── 一个 OpenAI 兼容的宿主 llm ────────────────────────────────────
 *
 * 形状必须与产品 `HarnessLlm` 期望的宿主 llm 一致：`{ resolveModelInfo, prepareCall }`，
 * 其中 `prepareCall` 回一个带 `stream()` 的对象 —— 因为解析器内部会用产品自己的
 * 分块 / 纠错 / 升档逻辑，基准不能绕过它（绕过了测的就不是产品）。
 *
 * `attachment` 是产品的内容块形状：`{ data: Buffer, mediaType }`。
 * 这里把它转成 OpenAI 的 `image_url` + base64。
 *
 * ⚠️ **`attachment.data` 必须真的有数据**。基准的 `attachments` 桩如果只回
 *    `{ attachmentId }`（不带宽高与字节），这里就会把图片段整个跳过 →
 *    请求退化成"纯文本" → vision 拿不到图 → 拼图解析失败 → 回退单图 → 还是没图。
 *    表现是"模型调用成功但页面文字是空的"，非常容易被误判成模型不听话。
 *    所以 `run.mjs` 给的是一个**保留字节**的 attachments 桩（见 makeAttachments）。
 */
/** 读一节的原稿（图片 + 字幕 + 页序）。 */
async function loadSection(sectionKey) {
  const dir = path.join(DATA, sectionKey);
  const [pagesDoc, subtitles] = await Promise.all([
    fs.readFile(path.join(dir, 'pages.json'), 'utf8').then(JSON.parse),
    fs.readFile(path.join(dir, 'subtitles.json'), 'utf8').then(JSON.parse),
  ]);
  const slides = [];
  for (const page of pagesDoc.pages ?? []) {
    if (!page.file) continue;
    const bytes = await fs.readFile(path.join(dir, page.file));
    slides.push({ page: page.page, createdSec: page.createdSec ?? null, imageBytes: bytes, mediaType: 'image/jpeg' });
  }
  return { dir, pagesDoc, subtitles, slides };
}

async function readArgs() {
  const buf = await new Promise((resolve) => {
    let acc = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { acc += c; });
    process.stdin.on('end', () => resolve(acc));
  });
  return JSON.parse(buf || '{}');
}

async function main() {
  const args = await readArgs().catch(() => null);  if (!args) { emit({ kind: 'error', code: 'BAD_ARGS', message: '参数不是 JSON' }); return; }

  /* 只有 `apiKey` 是必填的 —— 接口地址与模型名都有默认值（见 `defaults.mjs`）。
   *
   * ⚠️ 但"接口不是 DeepSeek"时**模型名不填就不能猜**：给别家塞 `deepseek-flash`
   *    会造成"模型不存在"，而用户看到的是自己填的接口 —— 排查方向会被带偏。
   *    所以那种情况明确报"请填模型名"。 */
  const config = resolveConfig(args);
  const { baseUrl, apiKey, model, visionModel, sectionKey } = config;
  if (!apiKey) { emit({ kind: 'error', code: 'NO_CREDENTIAL', message: '缺 apiKey' }); return; }
  if (!model) {
    emit({ kind: 'error', code: 'NO_MODEL', stage: 'config',
      message: `接口 ${baseUrl} 不是 DeepSeek，无法替你决定模型名 —— 请填「对话模型」` });
    return;
  }
  if (config.defaulted.baseUrl || config.defaulted.model) {
    emit({ kind: 'config', defaulted: config.defaulted, baseUrl, model, visionModel });
  }

  const splitLine = Number(args.splitLine) > 0 ? Number(args.splitLine) : V4_PROFILE.splitLine;
  const concurrency = Math.min(8, Math.max(1, Number(args.concurrency) || V4_PROFILE.concurrency));
  const maxPages = Number(args.maxPages) > 0 ? Number(args.maxPages) : 0;
  const skipLecture = Boolean(args.skipLecture);

  /* ── 日志基础设施：**必须在 try 之前** ───────────────────────
   *
   * 早先 `logFile` / `writer` / `t0` / `record` 都声明在 try 块**内部**，
   * 而 catch 里又 `await writer?.meta({ what: 'error', ... })` ——
   * 一进 catch 就抛 `ReferenceError: writer is not defined`。
   *
   * 后果不是"少写一条日志"，而是：
   *   · **原始故障被这个二次异常遮住**（屏幕上是 `writer is not defined`，
   *     不是真正的原因）；
   *   · 日志永远等不到 `end` / `error`，只剩半截 ——
   *     读日志的人分不清"还在跑"和"崩了"。
   *
   * 所以全部提前到 try 外面。`record()` 用闭包引用它们，
   * 成功或失败都能写。
   */
  const t0 = Date.now();
  const logFile = args.logFile ? String(args.logFile) : null;
  const writer = logFile ? createWriter(logFile) : null;
  const record = (act, subject, data = {}) => {
    const event = makeEvent(act, subject, data, Date.now() - t0);
    writer?.event(event);
    emit({ kind: 'event', event });
    return event;
  };

  /* ── 原图旁存 ──────────────────────────────────────────────────
   *
   * 审查第 15 条：产物里只有字数与转录文本，**没有原图** ——
   * 那回答不了"公式识别对没对、图上的字有没有读错"。
   *
   * 图片是 base64（一页几百 KB），塞进日志会撑爆。所以：
   *   · 另存到 `<log 目录>/.media/<logId>/p<页号>.jpg`；
   *   · 日志里只记文件名与字节数；
   *   · 界面按需加载（点开才读），并另设 `/api/media` 接口。
   */
  const mediaDir = logFile
    ? path.join(path.dirname(logFile), '.media', path.basename(logFile, '.jsonl'))
    : null;
  if (mediaDir) await fs.mkdir(mediaDir, { recursive: true }).catch(() => null);

  /** 把一页原图存盘。失败返回 null（不假装成功）。 */
  async function savePageImage(slide) {
    if (!mediaDir) return null;
    try {
      /* `loadSection()` 已把字节读进 `imageBytes`，直接复用，不再读盘。 */
      const bytes = slide?.imageBytes;
      if (!bytes?.length) return null;
      const name = `p${slide.page}.jpg`;
      await fs.writeFile(path.join(mediaDir, name), bytes);
      return { name, bytes: bytes.length };
    } catch {
      return null;
    }
  }

  try {
    const section = await loadSection(sectionKey);

    /* ── 选页段 ────────────────────────────────────────────────────
     *
     * ⚠️ 不能"从第 1 页开始截 N 页"：真实课的开头往往是**静音段**
     *（这份数据里字幕从第 235 秒才开始，而前两页的锚点只到 5 秒），
     * 于是"前 2 页"里一条字幕都没有，跑出来是空的 —— 用户会以为基准坏了。
     *
     * 所以：从**第一条字幕所在的时间**开始选页，往前留一页做上下文。
     */
    /* ── 选页段：挑**有声音的那一段**，而不是"从第 1 页开始截 N 页" ──────
     *
     * 真实课开头常是静音段（这份数据里第 1 页锚点 1 秒、字幕从 235 秒才开始），
     * 所以"从第 1 页开始截"会切出一段**几乎没字幕**的窗口，跑出来是空的。
     * 更麻烦的是锚点分布不均：8 页里有 6 页挤在开头、最后 2 页才落到有声段。
     *
     * 做法：按**字幕密度**给每页算分（这一页窗口里有多少句），然后取
     * 密度最高的那一页作为起点、往前留一页做上下文（标题页对建树有用）。
     * 这样无论用户填 4 页还是整数页，拿到的都是**内容最厚的那一段**。
     */
    const slidesAll = section.slides;
    const anchorOf = (s) => (s.createdSec > 0 ? s.createdSec * 1000 : null);
    // 每页的"声音窗口"= 本页锚点 → 下一页锚点
    const density = slidesAll.map((slide, i) => {
      const from = anchorOf(slide);
      if (from == null) return 0;
      const nextAnchor = slidesAll.slice(i + 1).map(anchorOf).find((a) => a !== null) ?? Infinity;
      return section.subtitles.filter((s) => s.startMs >= from && s.startMs < nextAnchor).length;
    });
    let startIndex = 0;
    if (density.some((d) => d > 0)) {
      startIndex = density.indexOf(Math.max(...density));
      // 往前留一页（标题页）；已经在第 1 页就不动
      startIndex = Math.max(0, startIndex - 1);
    }
    /* ⚠️ 起点往前留一页之后，窗口会包含"上一页的尾巴"——那一页常常没声音。
     *    所以再往后挪一页，让**第一页就是有声的那一页**（只挪一次，避免
     *    在连续多页都无声时跑飞）。 */
    if (startIndex + 1 < slidesAll.length && density[startIndex] === 0 && density[startIndex + 1] > 0) {
      startIndex += 1;
    }

    // 不限页即整节，不能沿用局部基准的密度选段而丢掉前文。
    if (!maxPages) startIndex = 0;
    const pool = slidesAll.slice(startIndex);
    const slides = maxPages > 0 ? pool.slice(0, maxPages) : pool;
    const fromSec = slides[0]?.createdSec ?? 0;
    /* 窗口的时间终点：最后一页的锚点 + 一页的裕量。
     * 用 `?? null` 而不是 0 —— 拿不到就如实是 null，不假装知道。 */
    const toSec = slides.length
      ? (slides.at(-1)?.createdSec ?? 0) + 600
      : null;

    /* ★ 字幕**不再由基准自己截断**，交给产品的 `anchor()` 决定归属。
     *
     * 早先这里写的是「只取到末页锚点 + 60 秒」，等于在基准里又实现了一遍
     * 分页逻辑 —— 而产品后来给"没有下一个锚点的最后一页"加了窗口上限
     *（超过 10 分钟的字幕不进页窗口，改走 `unassigned`）。
     * 基准自己截一刀，就把产品刚做对的判断又绕过去了：这一节 8 页 PPT 之后
     * 还有 2.5 小时纯讲授，被截得只剩 57 句（1.7%），剩下的 98% 根本没进链路。
     *
     * 所以这里只按"起点页"筛一次（保持 maxPages 的语义），**终点敞开**：
     * 从这一段的起点开始，把后面的字幕全交给产品。产品会把有图的部分按页
     * 分配、把没图的部分放进 `unassignedSentences`（原样保留、不纠错）。
     */
    const subtitles = maxPages
      ? section.subtitles.filter((s) => s.startMs >= fromSec * 1000)
      : section.subtitles;

    emit({ kind: 'start', sectionKey, title: section.pagesDoc.title ?? null,
      pages: slides.length, subtitles: subtitles.length, splitLine, concurrency,
      window: { fromPage: slides[0]?.page ?? null, toPage: slides.at(-1)?.page ?? null,
        fromSec, pickedBy: maxPages ? '最厚字幕段' : '整节' },
      model: model || '(default)', visionModel: visionModel || '(default)' });

    /* ── ① 解析（vision ‖ mix → 标记 → 建树 → 重构）──────────────── */
    /* 缓存目录：
     *   · 默认 `data/.run` —— 跨多次运行复用，这正是**断点接续**的实现
     *     （改好 Key 重跑时，已成功的页不再重打，省钱）。
     *   · 调用方可以用 `cacheNs` 换一个命名空间（自检时要干净缓存，
     *     否则第二次跑会直接命中上一次的结果，看起来像"没发请求"）。
     */
    const cacheNs = typeof args.cacheNs === 'string' && /^[\w.-]{1,40}$/.test(args.cacheNs)
      ? args.cacheNs : 'run';
    const workDir = args.workDir ? path.resolve(ROOT, String(args.workDir)) : DATA;
    await fs.mkdir(workDir, { recursive: true });
    const host = openAiHost({ baseUrl, apiKey, model, visionModel });
    const mounted = await mount('dsh-zhiyun-core-parser', {
      dataDir: path.join(workDir, `.${cacheNs}`) + path.sep,
      services: {
        llm: host,
        zhiyunClassroom: {
          async getLessonContent() { throw Object.assign(new Error('离线基准不接课堂'), { code: 'NO_CLASSROOM' }); },
          transport: { request() { throw new Error('离线基准不出网'); } },
        },
      },
      config: { concurrency, splitLine, visionBatchSize: V4_PROFILE.visionBatchSize,
        accel: V4_ACCEL,
      },
    });
    const parser = serviceOf(mounted, 'zhiyunParser');

    await writer?.meta({
      what: 'start', at: new Date().toISOString(),
      section: sectionKey, title: section.pagesDoc.title ?? null,
      config: { baseUrl, model, visionModel, splitLine, concurrency, maxPages },
      pages: slides.length, subtitles: subtitles.length,
      /* ★ **真实数据范围**（审查第 28 条）。
       *
       * 早先界面只显示"整节 / N 页"，但实际窗口可能：
       *   · 从某个有声音的页开始（不是第 1 页）；
       *   · 字幕按时间截断（页数有限但字幕到结尾）。
       * 那会让人以为"验收了整节"或"只跑了几页"，实际都不是。
       * 这里把窗口的**所有维度**写进日志，界面如实显示。
       */
      scope: {
        fromPage: slides[0]?.page ?? null,
        toPage: slides.at(-1)?.page ?? null,
        pageCount: slides.length,
        totalPagesInSection: section.pagesDoc.pages?.length ?? null,
        fromSec, toSec,
        subtitleCount: subtitles.length,
        windowBy: '字幕最厚的一段',
        wholeSection: !maxPages && (slides[0]?.page ?? 1) === 1,
      },
    });

    const result = await parser.parse({
      slides, subtitles, sourceId: `bench:${sectionKey}`,
      context: section.pagesDoc.title ?? sectionKey,
      /* ★ **实时转发**：`onProgress` 是产品在**真实并发时序**里回调的
       *   —— vision 的生产 worker 与 mix 的消费 worker 同时跑，谁先完成谁先回调。
       *
       * 早先我在 `await parse()` 返回之后，按 `result.pages` / `result.blocks`
       * 的**数组顺序**重发一遍 stage 事件。那等于把并发压成了串行：
       * 视觉上永远是"所有 vision 先做完，然后所有 mix 才开始"，
       * 完全看不出两道工序是并行的 —— 那不是我写错了动画，是我把真实时序
       * 抹掉了再喂给动画。
       *
       * 现在：`onProgress` 一被调就 emit，前端拿到的就是真实交错的事件流。
       */
      onProgress: (p) => {
        /* ⚠️ `detail` 必须一起带出去 —— 时间戳（`ms`）也在。
         * 有了 `ms` 才能在外面判断"事件是不是真的交错"：
         * 只看顺序会被排序后的数组骗到，看时间戳才靠谱。 */
        emit({
          kind: 'progress', phase: p.phase, done: p.done, total: p.total,
          ms: Date.now() - t0, detail: p.detail ?? null,
        });
        /* 把带 `detail` 的进度记成事件 —— **保持到达顺序**，不做任何重排。
         * 这两条是本基准里**唯一**有并发时延的事件，其余阶段都是一次算完。 */
        if (p.detail && p.phase === 'faithful') {
          /* 原图旁存（异步，不阻塞流水线）。
           * 存完再补一条 media 事件 —— 这样"有原图可看"是可查的事实，
           * 而不是界面上一个猜出来的按钮。 */
          const slideOfPage = slides.find((sl) => sl.page === p.detail.page);
          if (slideOfPage && mediaDir) {
            savePageImage(slideOfPage).then((saved) => {
              if (saved) record('media', p.detail.page, { ...saved, deferred: false });
            }).catch(() => null);
          }
          record('vision', p.detail.page, {
            chars: p.detail.chars, hasText: p.detail.hasText,
            failure: p.detail.failure ?? null,
            queueDepth: p.detail.queueDepth ?? null,
            /* ★ 转录正文：验收"识别读对没有"的唯一证据。
             * 字数回答不了"公式识别对没对、图上的字有没有读错"。 */
            text: p.detail.text ?? '',
            textTotal: p.detail.textTotal ?? p.detail.chars ?? 0,
          });
        } else if (p.detail && p.phase === 'mix') {
          record('mix', p.detail.page ?? p.detail.unitId, {
            unitId:p.detail.unitId ?? null, evidenceKind:p.detail.evidenceKind ?? 'slide-transcript',
            blocks: p.detail.blocks, lines: p.detail.lines,
            chars: p.detail.chars, skipped: p.detail.skipped ?? null,
            failure: p.detail.failure ?? null,
            queueDepth: p.detail.queueDepth ?? null,
            /* 原字幕 vs 清洗稿：验收"清洗做对没有"的唯一证据。 */
            rawText: p.detail.rawText ?? '',
            mixedText: p.detail.mixedText ?? '',
            tags: p.detail.tags ?? [],
          });
        } else if (p.detail && p.phase === 'merge') {
          record('organize', p.detail.leaf, { ...p.detail, deferred: false });
        }
      },
    });
    const parseMs = Date.now() - t0;
    if (args.workDir) await fs.writeFile(path.join(workDir, 'parsed.json'), JSON.stringify(result));

    /* 主线块 = **标了「主线」的块**，与产品 `workbench.js` 完全同一判据。
     *
     * # 为什么不再把"无锚点块"并进来
     *
     * 早先这里是 `role === '主线' || (page == null && fromUnanchored)` ——
     * 把无锚点块也算成主线。那与产品**不一致**：产品只取 `role === '主线'`，
     * 而无锚点块不参与标注、`role` 是 null，所以它们**进不了产品讲义**。
     *
     * 基准多塞进去，结果就是"基准里内容更全、产品里会丢" —— 那种差异
     * 恰恰是最该暴露的，不该被基准自己糊过去。
     *
     * 无锚点块仍然**如实记录并显示**（`tailBlocks` / 架构验收面板里的
     * 「未进讲义的块」），让"产品会丢掉这部分"成为一个**可见的事实**，
     * 而不是被基准偷偷补上。
     */
    const metaFacets = new Set(['教学安排', '作业', '元信息', '通知']);
    const mainBlocks = result.blocks.filter((b) => b.lectureEligible ?? (b.tag?.role === '主线' && b.cleanStatus !== 'incomplete'
      && !(b.tag?.facets ?? []).some(f => metaFacets.has(f))));

    /* ── 全失败 ≠ 部分完成 ────────────────────────────────────────
     *
     * 产品把"有失败但也有产出"记成 `partial`，那是对的。但"一条块都没出来"
     * 不是 partial —— 那说明模型根本没跑通（地址错、key 错、模型不支持图片…）。
     * 若不在这里拦住，界面会一路走到"完成"，用户看到空结果却不知道哪错了。
     */
    if (!result.blocks.length) {
      const firstFailure = (result.failures ?? [])[0];
      throw Object.assign(
        new Error(result.pages.every((p) => p.failure)
          ? `所有 ${result.pages.length} 页都没读成功（${firstFailure?.code ?? 'UNKNOWN'}）—— `
            + '检查接口地址 / API Key / 视觉模型是否支持图片'
          : '解析没有产出任何块 —— 检查模型的输出格式是否符合要求'),
        { code: 'NO_BLOCKS', stage: firstFailure?.stage ?? 'faithful' },
      );
    }
    /* 只有未标注块（`role` 全空）也走不下去：建树只收主线块，标注阶段若整体
     * 失败，后面的树与讲义一定是空的。这时候停下来比跑出一个空结果诚实。 */
    if (!mainBlocks.length) {
      const tagFailure = (result.tagFailures ?? [])[0];
      throw Object.assign(
        new Error(`标注阶段没有产出任何主线块（${result.blocks.length} 块全部未标注`
          + `${tagFailure ? `，code=${tagFailure.code}` : ''}）—— 检查对话模型是否能按 JSON 答题卡返回`),
        { code: 'NO_MAIN_BLOCKS', stage: 'tags' },
      );
    }

    /* ── 重建阶段的真实快照 ──────────────────────────────────────
     *
     * ⚠️ **识别与混合（vision / mix）已经在上面实时发过了**（见 `onProgress`
     *    里的转发）。这里**不要**再按 `result.pages` / `result.blocks` 的顺序
     *    重发一遍 —— 那正是把并发抹成串行的原因：
     *
     *      · `result.pages` 是**按页号排序**的结果数组，不是到达顺序；
     *      · 重发一遍会让画面变成"所有 vision → 所有 mix"（假串行），
     *        而真实链路是两道工序同时跑、事件交错到达。
     *
     * 这里只补**建树/重构**那一半 —— 它本来就是 `buildTreeFromBlocks` 一次性
     * 算完的，没有并发，按阶段顺序发才是真实的。
     */
    /* ── 标记 / 建树 / 重构：一次算完，按阶段顺序记 ───────────────
     *
     * 识别（vision/mix）已经在上面按**真实到达顺序**记过了 —— 那是唯一
     * 有并发时延的一段。这里剩下的都是 `buildTreeFromBlocks` 与标注
     * 一次性算完的，顺序无争议。
     *
     * 注意**标记在筛支线之前**：先给每块定 role，才能筛出支线。
     */
    for (const block of result.blocks) {
      record('bind', block.index, {
        /* 标记也是 parse() 之后统一补发的 —— 同样是事后推断。 */
        deferred: true,
        origin: 'mix', mixLocalIndex: block.mixLocalIndex ?? null,
        page: block.page ?? null,
        role: block.tag?.role ?? null,
        facets: block.tag?.facets ?? [],
        summary: block.tag?.summary ?? '',
        chars: (block.sentences ?? []).reduce((a, s) => a + String(s.text ?? '').length, 0),
        fromUnanchored: Boolean(block.fromUnanchored),
      });
    }

    /* ── 事后补发的事件 ────────────────────────────────────────
     *
     * 这些阶段（标记 / 筛支线 / 挂账 / 合并 / 重构）在 `parse()` 返回后
     * 一次性遍历结果补发，所以：
     *   · 事件**内容**是真实的（来自真实产物）；
     *   · 事件**时间戳**是补发时刻，**不是操作发生时刻**。
     *
     * 因此每条都标 `deferred: true`，界面据此告诉用户
     * "这条不能用来看真实执行顺序或阶段耗时"（审查第 10 条）。
     * 只有 vision/mix 是真实实时发出的（那是唯一的真并发证据）。
     */
    for (const event of eventsFromResult(result)) {
      if (event.act === 'merge' && event.data.overLine === null) {
        event.data.overLine = Number.isFinite(event.data.tookTok)
          ? event.data.tookTok > splitLine
          : null;
      }
      record(event.act, event.subject, { ...event.data, deferred: true });
    }

    emit({
      kind: 'parsed', status: result.status, ms: parseMs,
      counts: {
        pages: result.pages.length, sentences: result.sentences.length, blocks: result.blocks.length,
        main: mainBlocks.length, side: result.blocks.filter((b) => b.tag?.role === '支线').length,
        unlabeled: result.blocks.filter((b) => !b.tag?.role).length,
        knowledgePoints: result.knowledgePoints?.length ?? 0,
      },
      treeStats: result.treeStats ?? null, pipeline: result.pipeline ?? null,
      board: (result.board ?? []).map((b) => ({ page: b.page, index: b.index, why: b.why, summary: b.tag?.summary ?? null })),
      failures: result.failures ?? [], mergeFailures: result.mergeFailures ?? [], warnings: (result.warnings ?? []).slice(0, 20),
      spine: result.spine ?? '', outline: result.outline ?? [],
      calls: host.calls.length,
    });

    // 知识点（重构结果）—— 前端画树
    emit({ kind: 'tree', knowledgePoints: (result.knowledgePoints ?? []).map((p, i) => ({
      id: p.id, tok: p.tok ?? 0, merged: p.merged ?? 1, fromAttach: !!p.fromAttach,
      attachFacet: p.attachFacet ?? null,
      /* 标题：知识点叶本身没有名字（它是内容段），所以取它**第一块的概述**当标签。
       * 没有概述就用"知识点 N"——不编造标题，但界面上总要有个可点的名字。 */
      title: String((p.blocks ?? []).map((b) => b.tag?.summary ?? '').find((s) => s.trim()) ?? `知识点 ${i + 1}`).trim(),
      pages: [...new Set((p.blocks ?? []).map((b) => b.page))].sort((a, b) => a - b),
      chars: (p.blocks ?? []).reduce((a, b) => a + String(b.text ?? '').length, 0),
    })) });

    // 块清单（前端"标记"阶段用）
    emit({ kind: 'blocks', blocks: result.blocks.map((b) => ({
      index: b.index, page: b.page, role: b.tag?.role ?? null,
      facets: b.tag?.facets ?? [], summary: b.tag?.summary ?? '',
      chars: (b.sentences ?? []).reduce((a, s) => a + String(s.text ?? '').length, 0),
    })) });

    /* ── ② 习坎：建树 → 按树填充 → 全文润色 ────────────────────── */
    if (!skipLecture) {
      const api = await lecturePure();

      // Structure is the parser's v4 tree; no secondary tree or legacy path.
      const tree = api.normalizeLectureTree(result.tree);

      emit({ kind: 'treeBuilt', ms: Date.now() - t0, chapters: tree.chapters.length,
        topics: tree.chapters.reduce((a, c) => a + c.topics.length, 0),
        warnings: (tree.warnings ?? []).slice(0, 8),
        shape: tree.chapters.map((c) => ({ title: c.title, topics: c.topics.map((t) => t.title) })) });

      // 讲义服务要**窄接口**（`{ call }`）：从产品自己的窄 llm 形状给。
      const narrow = {
        async call(request) {
          const prepared = await host.prepareCall({ model: model || visionModel, ...request.route,
          }, request.signal);
          const chunks = prepared.stream({ ...prepared.config, messages: [
            { role: 'user', content: [{ type: 'text', text: request.constant }, { type: 'text', text: request.variable }] },
          ], signal: request.signal });
          let text = '';
          for await (const chunk of chunks) {
            if (chunk.type === 'text-delta') text += chunk.text;
            if (chunk.type === 'finish' && chunk.reason?.kind === 'max-tokens') {
              throw Object.assign(new Error('讲义输出达到模型长度上限，未作为完整产物采纳'), { code: 'LLM_TRUNCATED' });
            }
          }
          return { text, usage: null };
        },
      };
      const lectureMounted = await mount('dsh-zhiyun-core-lecture', {
        dataDir: path.join(workDir, `.${cacheNs}-lecture`) + path.sep,
        services: { zhiyunParser: { llm: narrow, cache: parser.cache } },
        config: { concurrency: Math.min(4, concurrency) },
      });
      const lecture = serviceOf(lectureMounted, 'zhiyunLecture');

      const generated = await lecture.generate({
        record: result, title: section.pagesDoc.title ?? sectionKey,
        onProgress: p => emit({ kind: 'progress', ...p, ms: Date.now() - t0 }),
        onAssembled: async assembled => {
          emit({ kind: 'lecture', ms: Date.now() - t0, chapters: assembled.chapters.length,
            topics: assembled.chapters.reduce((a, c) => a + c.topics.length, 0),
            failures: assembled.failures ?? [], warnings: (assembled.warnings ?? []).slice(0, 10), text: assembled.chapters });
          if (args.workDir) await fs.writeFile(path.join(workDir, 'lecture.json'), JSON.stringify(assembled));
        },
      });
      const assembled = generated.assembled;

      /* ── 习坎与终稿的**真实阶段事件** ───────────────────────────
       *
       * 与前面的 `vision`/`mark`/`regroup` 同一套机制：每一条都对应真实产物里的
       * 一步，前端逐帧消化 → 动画的节奏就是真实链路的节奏。
       *
       * 三种 act：
       *   · `chapter`  —— 一章（真实的章标题 + 它下面几个知识点）
       *   · `lecture`  —— 一个知识点写成了正文（真实的标题与字数）
       *   · `polish`   —— 润色结果（真实的改动数 / 是否一字未改）
       */
      /* 习坎：章 → 知识点两级，**正文在 passages 里**（不是 blocks）。
       *
       * 这块的字段映射单独在 `events.mjs` 里做了 —— 它要处理
       * passages / blocks / draft 三种来源（模型可能只给其中一种），
       * 混在 run.mjs 里会让这个文件更难读。 */
      for (const chapter of assembled.chapters ?? []) {
        const topics = (chapter.topics ?? []).map((topic, ti) => {
          const passageChars = (topic.passages ?? []).reduce((a, p) => a + String(p.text ?? '').length, 0);
          const blockChars = (topic.blocks ?? []).reduce((a, b) => {
            if (b.kind?.wire === 'example') return a + String(b.stem ?? '').length + String(b.solution ?? '').length;
            return a + String(b.text ?? '').length;
          }, 0);
          return {
            ...topic,
            chars: passageChars || blockChars || String(topic.draft ?? '').length,
            /* 标题优先用知识点自己的，没有就用章名 + 序号 —— 不编造，但界面上要有能认的东西。 */
            title: (topic.title ?? '').trim()
              || `${chapter.title || '本章'} · 第 ${ti + 1} 节`,
          };
        });
        for (const event of eventsFromLecture({ chapters: [{ ...chapter, topics }] })) {
          /* 讲义事件同样是"整份装配完成后补发"—— 时间戳不是写作时刻。 */
          record(event.act, event.subject, { ...event.data, deferred: true });
        }
      }

      // 全文润色：只在讲义真的长出来时做（没章节就没得润）
      if (assembled.chapters.length) {
        const polished = generated.polished;
        if (polished?.__error) {
          emit({ kind: 'polish', ok: false, code: polished.__error.code ?? 'FAILED',
            message: scrub(polished.__error.message, apiKey) });
          record('polish', null, {
            failed: true, code: polished.__error.code ?? 'FAILED',
            message: scrub(polished.__error.message, apiKey),
          });
        } else {
          if (args.workDir && polished.lecture) await fs.writeFile(path.join(workDir, 'lecture-final.json'), JSON.stringify({ ...polished.lecture, reviewWarnings: polished.warnings ?? [], reviewComplete: polished.complete !== false, reviewFailures: polished.failures ?? [] }));
          // `polish` 回的是 { text, unchanged, changes, coverage } —— 合回后的讲义全文
          // text 与已合回的 lecture 同时提供；回放仍保存文本协议。
          emit({ kind: 'polish', ok: polished.complete !== false, partial: polished.complete === false, failures: polished.failures ?? [], ms: Date.now() - t0,
            unchanged: polished.unchanged, changes: (polished.changes ?? []).slice(0, 40),
            coverage: polished.coverage ?? null,
            warnings: polished.warnings ?? [], cached: Boolean(polished.cached), complete: polished.complete !== false, failures: polished.failures ?? [],
            text: polished.text ?? null });
          // 阶段事件：让终稿这一步也有真实的一帧
          record('polish', null, {
            unchanged: Boolean(polished.unchanged),
            changes: (polished.changes ?? []).length,
            chars: String(polished.text ?? '').length,
            warnings: polished.warnings ?? [], cached: Boolean(polished.cached),
            /* ★ **润色后的全文**。
             *
             * 审查第 16 条：早先只存字数与改动数 —— 你花时间跑出最终内容，
             * 屏幕却不给你读；刷新以后回放也恢复不了正文。
             * 这里存全文（连同改动清单），让"有没有改坏"可以被真正检查。
             */
            text: String(polished.text ?? ''),
            changeList: (polished.changes ?? []).slice(0, 200).map((c) => ({
              kind: c.kind ?? '', before: String(c.before ?? '').slice(0, 300),
              after: String(c.after ?? '').slice(0, 300),
            })),
          });
        }
      }
      lectureMounted.dispose?.();
    }

    await writer?.meta({
      what: 'end', ms: Date.now() - t0, status: result.status,
      events: writer?.count ?? 0,
      /* 日志本身是否完整 —— 写盘失败要如实记下。 */
      writeFailures: writer?.failures?.count ?? 0,
      writeError: writer?.failures?.lastError ?? null,
      counts: {
        pages: result.pages.length, blocks: result.blocks.length,
        knowledgePoints: result.knowledgePoints?.length ?? 0,
      },
    });
    await writer?.flush();

    emit({ kind: 'done', ms: Date.now() - t0, logFile });
    mounted.dispose?.();
  } catch (error) {
    await writer?.meta({
      what: 'error', code: error?.code ?? 'FAILED', stage: error?.stage ?? null,
      message: scrub(error?.message ?? error, apiKey),
    });
    await writer?.flush();
    emit({ kind: 'error', code: error?.code ?? 'FAILED', stage: error?.stage ?? null,
      message: scrub(error?.message ?? error, apiKey) });
  }
}

main().catch((error) => {
  emit({ kind: 'error', code: error?.code ?? 'FATAL', message: String(error?.message ?? error).slice(0, 800) });
});
