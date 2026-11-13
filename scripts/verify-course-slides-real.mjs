// Opt-in real verification; all private inputs and outputs stay in ignored artifacts.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import { fitSlideOutput } from '../packages/core/classroom-generate/src/html-slide-fit.js';

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: node scripts/verify-course-slides-real.mjs --live|--resume [--graph graph.json]\nReads .env BaseURL/APIkey/ModelName through native DSH host transport.\nDefault source: discover benchmark graph by chapter titles. Writes artifacts/html-slides-real.\n--live starts fresh; --resume reuses exact-request real response cache. SUCCESS prohibits further calls. No whole-run retries.');
} else await main();

async function main() {
  let ctx, service, browser, output, report, previousKey, installed = false;
  const keyName = 'ZW_COURSE_SLIDES_PRIVATE_KEY';
  let secrets = [];
  const redact = value => secrets.reduce((text, secret) => text.replaceAll(secret, '[redacted]'), String(value));
  const safeError = value => redact(value?.message ?? value).replace(/https?:\/\/[^\s"'<>]+/gi, '[endpoint]').replace(/[A-Za-z]:[\\/][^\s"'<>]+/g, '[local-path]').replace(/(?:\/(?:Users|home|tmp|private|var|mnt)\/)[^\s"'<>]+/g, '[local-path]').slice(0, 1000);
  let saveJson;
  try {
    const mode = args[0];
    if (!['--live', '--resume'].includes(mode) || !(args.length === 1 || args.length === 3 && args[1] === '--graph' && args[2])) throw new Error('Use --live or --resume, optionally --graph graph.json');
    const { root, locateHost } = await import('./profile.mjs');
    output = path.join(root, 'artifacts', 'html-slides-real');
    if (await exists(path.join(output, 'SUCCESS'))) throw new Error('SUCCESS exists: further calls are prohibited');
    const cacheDir = path.join(output, 'responses');
    if (mode === '--live' && await exists(path.join(output, 'source.json'))) throw new Error('Existing attempt found: use --resume to retain actual responses');
    const chapters = await loadChapters(root, args[2]);
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
    report = { ok: false, startedAt: new Date().toISOString(), outputFormat: 'html', chapterConcurrency: 2, chapterCount: 2, mediaCalls: 0, calls: [], audits: {}, checkpoints: [], progress: [] };
    await saveJson('source.json', { chapters, sourceSha256: sha(JSON.stringify(chapters)) });
    const host = await locateHost();
    const require = createRequire(path.join(host.app, 'package.json'));
    const load = name => import(pathToFileURL(require.resolve('@deepseek-ai/' + name)).href);
    const [{ Context }, { default: Llm }, PiAi, { createGenerateService }, { createHostLlmTransport }, { auditSlideHtml }, { chromium }] = await Promise.all([
      load('cordis'), load('dsh-llm'), load('dsh-llm-pi-ai'),
      import('../packages/core/classroom-generate/src/index.js'),
      import('../packages/core/classroom-generate/src/host-llm.js'),
      import('../packages/core/classroom-generate/src/html-slide-audit.js'),
      import('playwright'),
    ]);
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    ctx = new Context();
    previousKey = process.env[keyName]; process.env[keyName] = key; installed = true;
    const provider = 'course-slides-real';
    const endpoint = base.replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
    await ctx.plugin(Llm);
    await ctx.plugin(PiAi, { providers: { [provider]: {
      api: 'openai-completions', baseURL: /\/v\d+$/.test(endpoint) ? endpoint : endpoint + '/v1', apiKeyEnv: keyName,
      models: [{ id: model, input: ['text'], contextWindow: 1048576, maxTokens: 32768,
        compat: { supportsStore: false, supportsDeveloperRole: false, maxTokensField: 'max_tokens', thinkingFormat: 'deepseek', supportsReasoningEffort: false } }],
    } } });
    const transport = createHostLlmTransport(ctx.llm);
    const noMedia = () => { report.mediaCalls++; throw new Error('Media forbidden in slide verification'); };
    const quiet = () => {};
    service = createGenerateService({ studio: null, log: { debug: quiet, info: quiet, warn: quiet, error: quiet },
      ports: { now: Date.now, media: { image: noMedia, speech: noMedia, tts: noMedia },
        validateHtml: async result => {
          try {
            await fitSlideOutput(result, { browser });
            const audit = await auditSlideHtml(result.html, { browser, screenshotDirectory: output, prefix: result.chapterId });
            report.audits[result.chapterId] = audit;
            return audit;
          } catch (error) { throw new Error(safeError(error)); }
        },
        vault: { runs: { put: async () => {}, putStep: async (_runId, phase, result) => {
          if (!/^html-chapter-[12]$/.test(phase)) return;
          const index = chapters.findIndex(c => c.id === result.chapterId);
          if (index < 0 || !report.audits[result.chapterId] || !result.html || !result.analysis || !result.storyboard || !Array.isArray(result.slides) || result.deckVersion !== 2) throw new Error('Checkpoint requires complete audited slide chapter');
          const name = `chapter-${index + 1}`;
          await fs.writeFile(path.join(output, `${name}.html`), redact(result.html));
          await saveJson(`${name}-checkpoint.json`, { chapterId: result.chapterId, deckVersion: result.deckVersion, analysis: result.analysis, storyboard: result.storyboard, slides: result.slides, audit: report.audits[result.chapterId] });
          report.checkpoints.push(result.chapterId);
          await saveJson('report.json', report);
        } } },
      },
      llm: { async call(request) {
        if (!chapters.some(c => c.id === request.chapterId) || !['html-understanding', 'html-storyboard', 'html'].includes(request.stage)) throw new Error('Unexpected generation request');
        const requestSha256 = sha(JSON.stringify({ stage: request.stage, chapterId: request.chapterId, messages: request.messages }));
        const cache = path.join(cacheDir, `${requestSha256}.json`);
        const call = { chapterId: request.chapterId, stage: request.stage, requestSha256, start: Date.now(), cache: false };
        report.calls.push(call);
        try {
          if (mode === '--resume' && await exists(cache)) {
            const saved = JSON.parse(await fs.readFile(cache, 'utf8'));
            if (saved.real !== true || saved.requestSha256 !== requestSha256 || typeof saved.response !== 'string' || saved.responseSha256 !== sha(saved.response)) throw new Error('Real response cache integrity failure');
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
    const { runId } = service.start({ topic: '概率的加法公式与古典概型', requirement: '忠实覆盖两章完整原文、推导、例题和适用条件；固定16:9幻灯片，每页单独图示，讲解备注置于画框外；禁止媒体生成。', outputFormat: 'html', chapterConcurrency: 2, chapters }, { provider, model });
    for await (const event of service.stream(runId)) {
      const progress = { event: ['phase-progress', 'run-done', 'run-error'].includes(event.kind) ? event.kind : 'progress' };
      if (['html-understanding', 'html-storyboard', 'html', 'html-chapter-complete'].includes(event.payload?.stage)) progress.stage = event.payload.stage;
      if ([0, 1].includes(event.payload?.chapterIndex)) progress.chapter = event.payload.chapterIndex + 1;
      report.progress.push(progress);
    }
    const result = service.get(runId);
    if (result?.status !== 'done') throw new Error(safeError(result?.error?.message ?? 'Generation failed'));
    if (result.htmlChapters?.length !== 2 || new Set(report.checkpoints).size !== 2 || Object.keys(report.audits).length !== 2 || report.mediaCalls !== 0 || result.htmlChapters.some(c => c.deckVersion !== 2 || !c.slides?.length)) throw new Error('Incomplete audited two-chapter result');
    service.dispose(); service = null;
    await ctx.fiber.dispose(); ctx = null;
    await browser.close(); browser = null;
    report.ok = true; report.completedAt = new Date().toISOString();
    report.files = ['chapter-1.html', 'chapter-2.html', 'report.json', 'source.json'];
    await saveJson('report.json', report);
    await fs.writeFile(path.join(output, 'SUCCESS'), 'SUCCESS\n', { flag: 'wx' });
    console.log('SUCCESS: two browser-audited slide chapters saved; further calls prohibited.');
  } catch (error) {
    const message = safeError(error);
    if (report && saveJson) { report.ok = false; report.error = message; try { await saveJson('report.json', report); } catch {} }
    console.error(`Slide verification failed: ${message}`); process.exitCode = 1;
  } finally {
    try { service?.dispose(); } catch { process.exitCode = 1; }
    try { await ctx?.fiber.dispose(); } catch { process.exitCode = 1; }
    try { await browser?.close(); } catch { process.exitCode = 1; }
    if (installed) { if (previousKey === undefined) delete process.env[keyName]; else process.env[keyName] = previousKey; }
  }
}

function sha(text) { return createHash('sha256').update(text).digest('hex'); }
async function exists(file) { try { await fs.access(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
async function loadChapters(root, graphArg) {
  const titles = ['概率的加法公式', '古典概型与超几何模型'];
  const base = path.join(root, 'scripts', 'quiz_bench', 'experimental-r4', 'bench-data');
  const candidates = graphArg ? [path.resolve(root, graphArg)] : (await fs.readdir(base, { withFileTypes: true })).filter(e => e.isDirectory() && /[\u3400-\u9fff]/u.test(e.name)).map(e => path.join(base, e.name, 'graph.json'));
  const matches = [];
  for (const file of candidates) {
    if (!await exists(file)) continue;
    const graph = JSON.parse(await fs.readFile(file, 'utf8'));
    const selected = titles.map(title => graph.root?.children?.find(c => c.title === title));
    if (selected.every(Boolean)) matches.push(selected);
  }
  if (matches.length !== 1) throw new Error('Need exactly one source graph containing both requested chapter titles; use --graph');
  return matches[0].map((chapter, index) => {
    // Only ordered child.text is source. point.text repeats it and metadata is private.
    const parts = [];
    const visit = node => {
      if (typeof node.text === 'string' && node.text.trim()) parts.push(`### ${node.title || '知识点'}\n${node.text}`);
      for (const child of node.children ?? []) visit(child);
    };
    for (const child of chapter.children ?? []) visit(child);
    if (!parts.length) throw new Error('Chapter has no full source text');
    return { id: `course-chapter-${index + 1}`, title: titles[index], sourceText: parts.join('\n\n') };
  });
}
