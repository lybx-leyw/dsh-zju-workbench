/**
 * 用真实 .env 凭证、走**同一条生成管线**，把一篇论文变成横版 slides。
 *
 * 与 `verify-course-slides-real.mjs` 的区别只有输入：那边的来源是智云讲义的
 * `graph.json`，这边是 `parsePdf` 抽出来的论文正文。管线的每一环都相同 ——
 * 章节并发、章内串行、逐页落盘、浏览器版式校验、断点续做。
 *
 * 用法：
 *   node scripts/verify-paper-slides-real.mjs --live [--pdf <path>]
 *   node scripts/verify-paper-slides-real.mjs --resume
 *
 * 隐私与费用：正文来自用户提供的 PDF，产物与请求缓存都落在被 `.gitignore` 忽略的
 * `artifacts/paper-slides/` 下；凭证只进临时环境变量，不落盘、不打印。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import { fitSlideOutput } from '../packages/dsh-zhiyun-core-classroom-generate/src/html-slide-fit.js';

const DEFAULT_PDF = 'artifacts/paper-slides/input.pdf';

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: node scripts/verify-paper-slides-real.mjs --live|--resume [--pdf <path>]\nReads .env BaseURL/APIkey/ModelName via the native DSH host transport.\nWrites artifacts/paper-slides. --live starts fresh; --resume reuses exact-request real responses.\nSUCCESS prohibits further calls. No whole-run retries.');
} else await main();

async function main() {
  let ctx, service, browser, output, report, previousKey, installed = false;
  const keyName = 'ZHIYUN_PAPER_SLIDES_PRIVATE_KEY';
  let secrets = [];
  const redact = value => secrets.reduce((text, secret) => text.replaceAll(secret, '[redacted]'), String(value));
  const safeError = value => redact(value?.message ?? value)
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[endpoint]')
    .replace(/[A-Za-z]:[\\/][^\s"'<>]+/g, '[local-path]')
    .replace(/(?:\/(?:Users|home|tmp|private|var|mnt)\/)[^\s"'<>]+/g, '[local-path]')
    .slice(0, 1000);
  let saveJson;

  try {
    const mode = args[0];
    const pdfArg = args.includes('--pdf') ? args[args.indexOf('--pdf') + 1] : null;
    if (!['--live', '--resume'].includes(mode)) throw new Error('Use --live or --resume (optionally --pdf <path>)');

    const { root, locateHost } = await import('./profile.mjs');
    output = path.join(root, 'artifacts', 'paper-slides');
    if (await exists(path.join(output, 'SUCCESS'))) throw new Error('SUCCESS exists: further calls are prohibited');
    const cacheDir = path.join(output, 'responses');

    // ── 1. 论文 → 章节正文 ───────────────────────────────────────────
    // 每章一调，正文按论文的真实小节切；**附录不进正文**（用户明确要求）。
    const chapters = await loadPaperChapters(pdfArg ?? DEFAULT_PDF, output);

    // ── 2. 凭证：只在内存里读，只进临时环境变量 ──────────────────────
    const env = parseEnv(await fs.readFile(path.join(root, '.env'), 'utf8'));
    secrets = Object.values(env).filter(v => typeof v === 'string' && v.length).sort((a, b) => b.length - a.length);
    const { BaseURL: base, APIkey: key, ModelName: model } = env;
    if (!base || !key || !model) throw new Error('Missing BaseURL/APIkey/ModelName configuration');
    const url = new URL(base);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid endpoint configuration');

    await fs.mkdir(cacheDir, { recursive: true });
    let writes = Promise.resolve();
    saveJson = (name, value) => {
      const text = redact(JSON.stringify(value, null, 2)) + '\n';
      const write = writes.then(() => fs.writeFile(path.join(output, name), text));
      writes = write.catch(() => {});
      return write;
    };

    report = { ok: false, startedAt: new Date().toISOString(), outputFormat: 'html',
      chapterConcurrency: 2, chapterCount: chapters.length, mediaCalls: 0,
      calls: [], audits: {}, checkpoints: [], progress: [] };
    await saveJson('source.json', {
      paper: { chapters: chapters.map(c => ({ id: c.id, title: c.title, chars: c.sourceText.length })) },
      sourceSha256: sha(JSON.stringify(chapters)),
    });

    // ── 3. 宿主 llm 通道（与本仓生产路径同一套） ────────────────────
    const host = await locateHost();
    const require = createRequire(path.join(host.app, 'package.json'));
    const load = name => import(pathToFileURL(require.resolve('@deepseek-ai/' + name)).href);
    const [{ Context }, { default: Llm }, PiAi, { createGenerateService }, { createHostLlmTransport }, { auditSlideHtml }, { chromium }] = await Promise.all([
      load('cordis'), load('dsh-llm'), load('dsh-llm-pi-ai'),
      import('../packages/dsh-zhiyun-core-classroom-generate/src/index.js'),
      import('../packages/dsh-zhiyun-core-classroom-generate/src/host-llm.js'),
      import('../packages/dsh-zhiyun-core-classroom-generate/src/html-slide-audit.js'),
      import('playwright'),
    ]);
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    ctx = new Context();
    previousKey = process.env[keyName];
    process.env[keyName] = key;
    installed = true;
    const provider = 'paper-slides-real';
    const endpoint = base.replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
    await ctx.plugin(Llm);
    await ctx.plugin(PiAi, { providers: { [provider]: {
      api: 'openai-completions',
      baseURL: /\/v\d+$/.test(endpoint) ? endpoint : endpoint + '/v1',
      apiKeyEnv: keyName,
      models: [{ id: model, input: ['text'], contextWindow: 1048576, maxTokens: 32768,
        compat: { supportsStore: false, supportsDeveloperRole: false, maxTokensField: 'max_tokens', thinkingFormat: 'deepseek', supportsReasoningEffort: false } }],
    } } });
    const transport = createHostLlmTransport(ctx.llm);
    const noMedia = () => { report.mediaCalls++; throw new Error('Media forbidden in paper verification'); };
    const quiet = () => {};

    service = createGenerateService({ studio: null, log: { debug: quiet, info: quiet, warn: quiet, error: quiet },
      ports: {
        now: Date.now,
        media: { image: noMedia, speech: noMedia, tts: noMedia },
        validateHtml: async result => {
          try {
            await fitSlideOutput(result, { browser });
            const audit = await auditSlideHtml(result.html, { browser, screenshotDirectory: output, prefix: result.chapterId });
            report.audits[result.chapterId] = audit;
            return audit;
          } catch (error) { throw new Error(safeError(error)); }
        },
        vault: { runs: {
          put: async () => {},
          putStep: async (_runId, phase, result) => {
            if (!/^html-chapter-\d+$/.test(phase)) return;
            const index = chapters.findIndex(c => c.id === result.chapterId);
            if (index < 0 || !report.audits[result.chapterId] || !result.html || !result.analysis
              || !result.storyboard || !Array.isArray(result.slides) || result.deckVersion !== 2) {
              throw new Error('Checkpoint requires complete audited slide chapter');
            }
            const name = `chapter-${index + 1}`;
            await fs.writeFile(path.join(output, `${name}.html`), redact(result.html));
            await saveJson(`${name}-checkpoint.json`, { chapterId: result.chapterId, deckVersion: result.deckVersion,
              analysis: result.analysis, storyboard: result.storyboard, slides: result.slides,
              audit: report.audits[result.chapterId] });
            report.checkpoints.push(result.chapterId);
            await saveJson('report.json', report);
          },
        } },
      },
      llm: { async call(request) {
        if (!chapters.some(c => c.id === request.chapterId)
          || !['html-understanding', 'html-storyboard', 'html'].includes(request.stage)) {
          throw new Error('Unexpected generation request');
        }
        const requestSha256 = sha(JSON.stringify({ stage: request.stage, chapterId: request.chapterId, sceneIndex: request.sceneIndex ?? null, messages: request.messages }));
        const cache = path.join(cacheDir, `${requestSha256}.json`);
        const call = { chapterId: request.chapterId, stage: request.stage, sceneIndex: request.sceneIndex ?? null, requestSha256, start: Date.now(), cache: false };
        report.calls.push(call);
        try {
          if (mode === '--resume' && await exists(cache)) {
            const saved = JSON.parse(await fs.readFile(cache, 'utf8'));
            if (saved.real !== true || saved.requestSha256 !== requestSha256
              || typeof saved.response !== 'string' || saved.responseSha256 !== sha(saved.response)) {
              throw new Error('Real response cache integrity failure');
            }
            call.cache = true;
            return saved.response;
          }
          const response = await transport.call(request);
          if (typeof response !== 'string' || redact(response) !== response) throw new Error('Response contains private configuration; refusing persistence');
          await fs.writeFile(cache, JSON.stringify({ real: true, requestSha256, responseSha256: sha(response), response }) + '\n');
          return response;
        } catch (error) { call.error = safeError(error); throw new Error(call.error); }
        finally { call.end = Date.now(); call.elapsedMs = call.end - call.start; await saveJson('report.json', report); }
      } },
    });

    const { runId } = service.start({
      topic: 'Debiased PFNs for Amortized Bayesian Semi-Parametric Inference',
      requirement: '把这篇论文讲清楚：它要解决什么问题、慢在哪、提出的两种去偏策略各自修正了什么、理论结论是什么、实验如何验证。忠实覆盖原文的假设与结论，不夸大、不省略适用条件。固定 16:9 幻灯片，每页一张图，长讲解放画框外。禁止媒体生成。',
      outputFormat: 'html',
      chapterConcurrency: 2,
      chapters,
    }, { provider, model });

    for await (const event of service.stream(runId)) {
      const progress = { event: ['phase-progress', 'run-done', 'run-error'].includes(event.kind) ? event.kind : 'progress' };
      if (['html-understanding', 'html-storyboard', 'html', 'html-chapter-complete'].includes(event.payload?.stage)) progress.stage = event.payload.stage;
      if (Number.isInteger(event.payload?.chapterIndex)) progress.chapter = event.payload.chapterIndex + 1;
      report.progress.push(progress);
    }

    const result = service.get(runId);
    if (result?.status !== 'done') throw new Error(safeError(result?.error?.message ?? 'Generation failed'));
    if (result.htmlChapters?.length !== chapters.length
      || new Set(report.checkpoints).size !== chapters.length
      || Object.keys(report.audits).length !== chapters.length
      || report.mediaCalls !== 0
      || result.htmlChapters.some(c => c.deckVersion !== 2 || !c.slides?.length)) {
      throw new Error('Incomplete audited result');
    }

    service.dispose(); service = null;
    await ctx.fiber.dispose(); ctx = null;
    await browser.close(); browser = null;
    report.ok = true;
    report.completedAt = new Date().toISOString();
    report.slideCount = result.htmlChapters.reduce((sum, c) => sum + c.slides.length, 0);
    report.files = [...chapters.map((_, i) => `chapter-${i + 1}.html`), 'report.json', 'source.json'];
    await saveJson('report.json', report);
    await fs.writeFile(path.join(output, 'SUCCESS'), 'SUCCESS\n', { flag: 'wx' });
    console.log(`SUCCESS: ${chapters.length} browser-audited chapters, ${report.slideCount} slides saved. Further calls prohibited.`);
  } catch (error) {
    const message = safeError(error);
    if (report && saveJson) {
      report.ok = false;
      report.error = message;
      try { await saveJson('report.json', report); } catch { /* keep the failure readable */ }
    }
    console.error(`Paper slide verification failed: ${message}`);
    process.exitCode = 1;
  } finally {
    try { service?.dispose(); } catch { process.exitCode = 1; }
    try { await ctx?.fiber.dispose(); } catch { process.exitCode = 1; }
    try { await browser?.close(); } catch { process.exitCode = 1; }
    if (installed) {
      if (previousKey === undefined) delete process.env[keyName];
      else process.env[keyName] = previousKey;
    }
  }
}

function sha(text) { return createHash('sha256').update(text).digest('hex'); }
async function exists(file) { try { await fs.access(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }

/**
 * 论文 → 章节：PDF → 抽取 → **入口规整** → 按小节切。
 *
 * # 为什么要有「入口规整」这一步
 *
 * `unpdf` 抽出来的是**视觉行**（每行都是版心硬折行，全文没有空行）。
 * 直接把这种文本喂给生成与校验，会让下游被迫认识一堆排版规则：
 * 句中换行、行尾断词 `specifica-\ntion`、上标留下的 `L2- concentration`、
 * `Π(P )` 的对齐空格……每一条都要在校验里单独容忍，实测八轮都没收敛。
 *
 * 规整在**入口**把视觉行拼回段落，下游就不需要任何排版知识。
 * 规整只碰排版（拼行、还原断词、压空白），不改用词、不重排语序。
 *
 * 切分依据是**标题字符串**而不是行号：行号会随 PDF 排版/抽取结果漂移，
 * 而 `4.2 DEBIASING STRATEGIES` 这种标题是稳定的。
 */
async function loadPaperChapters(pdfPath, outDir) {
  const { parsePDF } = await import('../packages/dsh-zhiyun-core-classroom-media/src/pdf/parse.js');
  const { normalizePdfText } = await import('../packages/dsh-zhiyun-core-classroom-media/src/pdf/normalize-text.js');
  const buffer = await fs.readFile(pdfPath);
  const parsed = await parsePDF(null, { providerId: 'unpdf', textOnly: true }, buffer, {});
  const raw = String(parsed?.text ?? '');
  if (!raw.trim()) throw new Error('PDF 抽取为空');
  await fs.writeFile(path.join(outDir, 'raw.txt'), raw);

  // 入口规整：视觉行 → 段落。统计量写进产物，方便核对「有没有吞内容」。
  const normalized = normalizePdfText(raw);
  const text = normalized.text;
  await fs.writeFile(path.join(outDir, 'clean.txt'), text);
  await fs.writeFile(path.join(outDir, 'normalize-report.json'),
    JSON.stringify({ rawChars: raw.length, cleanChars: text.length,
      paragraphs: normalized.paragraphs, joined: normalized.joined,
      dehyphenated: normalized.dehyphenated }, null, 2) + '\n');

  // 正文止于 REFERENCES；之后的附录、致谢、伦理声明都不进 slides。
  const bodyEnd = text.indexOf('\nREFERENCES');
  const body = bodyEnd > 0 ? text.slice(0, bodyEnd) : text;

  const marks = [
    ['1 INTRODUCTION', '引言：摊销贝叶斯推断与 PFN'],
    ['2 RELATED WORK', '相关工作：半参数效率与 PFN'],
    ['3 PRELIMINARIES', '预备：半参数模型、影响函数与 PFN'],
    ['4.1 BAYES-OPTIMALITY', '为什么理想 PFN 也会慢'],
    ['4.2 DEBIASING STRATEGIES', '两种去偏策略'],
    ['4.3 ASYMPTOTIC PROPERTIES', '去偏后的渐近性质'],
    ['5 EXPERIMENTS', '实验：去偏是否真的更快'],
  ];
  const positions = marks.map(([mark]) => {
    const at = body.indexOf(mark);
    if (at < 0) throw new Error(`找不到小节标题：${mark}`);
    return at;
  });
  for (let i = 1; i < positions.length; i++) {
    if (positions[i] <= positions[i - 1]) throw new Error('小节顺序异常，PDF 抽取可能错乱');
  }

  return marks.map(([, title], index) => {
    const start = positions[index];
    const end = index + 1 < positions.length ? positions[index + 1] : body.length;
    const slice = body.slice(start, end).trim();
    if (slice.length < 500) throw new Error(`「${title}」正文过短（${slice.length} 字符），疑似抽取失败`);
    return { id: `paper-chapter-${index + 1}`, title, sourceText: slice };
  });
}
