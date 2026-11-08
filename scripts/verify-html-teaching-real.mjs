// Opt-in, single-run verification through the production HTML teaching pipeline.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: node scripts/verify-html-teaching-real.mjs --live | --resume-saved\n--resume-saved reuses only saved real first responses after exact source matching and repairs failed stages.\nReads .env in memory (BaseURL, APIkey, ModelName). Optional model override: ZHIYUN_REAL_CHAPTER_MODEL.\nWrites artifacts/html-teaching-real; refuses when SUCCESS exists. Real requests incur cost. No whole-run retries.');
} else {
  await main();
}

async function main() {
  let ctx, service, previousKey;
  let keyInstalled = false;
  let output;
  let report;
  let redact = text => String(text);
  const keyName = 'ZHIYUN_HTML_TEACHING_VERIFY_KEY';
  try {
    if (args.length !== 1 || !['--live', '--resume-saved'].includes(args[0])) throw new Error('opt-in required');
    const reuseSaved = args[0] === '--resume-saved';
    const { root, locateHost } = await import('./profile.mjs');
    output = path.join(root, 'artifacts', 'html-teaching-real');
    try {
      await fs.access(path.join(output, 'SUCCESS'));
      console.error('Refusing: SUCCESS already exists. Stop rule prohibits another run.');
      process.exitCode = 1;
      return;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const env = parseEnv(await fs.readFile(path.join(root, '.env'), 'utf8'));
    // ModelName is intentional: do not silently pick a vision or unrelated model.
    const model = process.env.ZHIYUN_REAL_CHAPTER_MODEL || env.ModelName;
    const base = env.BaseURL;
    const key = env.APIkey;
    if (!base || !key || !model) throw new Error('configuration missing');
    const url = new URL(base);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('invalid endpoint');
    const privateValues = [...Object.values(env), model].filter(value => typeof value === 'string' && value.length > 0).sort((a, b) => b.length - a.length);
    redact = text => privateValues.reduce((value, secret) => value.replaceAll(secret, '[redacted]'), String(text));
    await fs.mkdir(output, { recursive: true });
    report = { ok: false, startedAt: new Date().toISOString(), outputFormat: 'html', chapterConcurrency: 2, chapterCount: 2, mediaCalls: 0, progress: [] };
    const saveJson = (name, value) => fs.writeFile(path.join(output, name), redact(JSON.stringify(value, null, 2)) + '\n');
    const chapters = authoredChapters();
    if (reuseSaved) {
      const saved = JSON.parse(await fs.readFile(path.join(output, 'source.json'), 'utf8'));
      if (JSON.stringify(saved.chapters) !== JSON.stringify(chapters)) throw new Error('saved source mismatch');
      await fs.copyFile(path.join(output, 'report.json'), path.join(output, 'previous-attempt-report.json'));
    }
    await saveJson('source.json', { synthetic: true, authorship: 'Original synthetic teaching material; no private course data.', chapters });
    const host = await locateHost();
    const require = createRequire(path.join(host.app, 'package.json'));
    const load = name => import(pathToFileURL(require.resolve('@deepseek-ai/' + name)).href);
    const [{ Context }, { default: Llm }, PiAi] = await Promise.all(['cordis', 'dsh-llm', 'dsh-llm-pi-ai'].map(load));
    ctx = new Context();
    previousKey = process.env[keyName];
    process.env[keyName] = key;
    keyInstalled = true;
    const provider = 'html-teaching-real';
    const endpoint = base.replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
    await ctx.plugin(Llm);
    await ctx.plugin(PiAi, { providers: { [provider]: {
      api: 'openai-completions', baseURL: /\/v\d+$/.test(endpoint) ? endpoint : endpoint + '/v1', apiKeyEnv: keyName,
      models: [{ id: model, input: ['text'], contextWindow: 1048576, maxTokens: 32768,
        compat: { supportsStore: false, supportsDeveloperRole: false, maxTokensField: 'max_tokens', thinkingFormat: 'deepseek', supportsReasoningEffort: false } }],
    } } });
    const [{ createGenerateService }, { createHostLlmTransport }] = await Promise.all([
      import('../packages/core/classroom-generate/src/index.js'),
      import('../packages/core/classroom-generate/src/host-llm.js'),
    ]);
    const noMedia = () => { report.mediaCalls++; throw new Error('Media is forbidden in HTML verification'); };
    const quiet = () => {};
    const transport = createHostLlmTransport(ctx.llm);
    const attempts = new Map();
    report.calls = [];
    service = createGenerateService({ studio: null,
      ports: { now: Date.now, media: { image: noMedia, speech: noMedia, tts: noMedia } },
      llm: { async call(request) {
        const stage = ['html-understanding', 'html-storyboard', 'html'].includes(request.stage) ? request.stage : 'unknown';
        const chapter = ['chapter-1', 'chapter-2'].includes(request.chapterId) ? request.chapterId : 'unknown';
        const slot = `${chapter}-${stage}`;
        const attempt = (attempts.get(slot) ?? 0) + 1;
        attempts.set(slot, attempt);
        const call = { chapter, stage, attempt, start: Date.now() };
        report.calls.push(call);
        try {
          // Explicit continuation of an interrupted REAL run, never fabricated responses.
          // Source equality above binds the saved first responses to this same material.
          if (reuseSaved) {
            try {
              const saved = await fs.readFile(path.join(output, `${slot}-${attempt}.txt`), 'utf8');
              call.reusedRealResponse = true;
              return saved;
            } catch (error) { if (error.code !== 'ENOENT') throw error; }
          }
          const text = await transport.call(request);
          await fs.writeFile(path.join(output, `${slot}-${attempt}.txt`), redact(text));
          return text;
        } finally { call.end = Date.now(); }
      } }, log: { debug: quiet, info: quiet, warn: quiet, error: quiet },
    });
    const { runId } = service.start({ topic: '导数：从变化直觉到应用',
      requirement: '忠实讲解两个章节，保留全部公式、例题、定义域与假设；用逐步显现的图形帮助理解，不生成任何媒体。',
      outputFormat: 'html', chapterConcurrency: 2, chapters,
    }, { provider, model });
    // Project only known enum-like progress fields; never log payloads, errors or model configuration.
    const stages = new Set(['html-understanding', 'html-storyboard', 'html', 'html-chapter-complete']);
    for await (const event of service.stream(runId)) {
      const progress = { event: ['phase-progress', 'run-done', 'run-error'].includes(event.kind) ? event.kind : 'progress' };
      if (stages.has(event.payload?.stage)) progress.stage = event.payload.stage;
      if ([0, 1].includes(event.payload?.chapterIndex)) progress.chapter = event.payload.chapterIndex + 1;
      report.progress.push(progress);
      console.log(JSON.stringify(progress));
    }
    const result = service.get(runId);
    if (result?.status !== 'done' || result.htmlChapters?.length !== 2 || report.mediaCalls !== 0) {
      // Report only redacted error text; never store raw transport/config objects.
      report.failure = { code: String(result?.error?.code ?? 'FAILED'), message: redact(result?.error?.message ?? 'verification failed').replace(/https?:\/\/\S+/g, '[endpoint]').replace(/[A-Z]:\\[^\n]+/gi, '[local-path]').slice(0, 500) };
      throw new Error('verification failed');
    }
    for (const [index, chapter] of result.htmlChapters.entries()) {
      if (!chapter.html || !chapter.analysis || !chapter.storyboard) throw new Error('incomplete chapter');
      await fs.writeFile(path.join(output, `chapter-${index + 1}.html`), redact(chapter.html));
      await saveJson(`chapter-${index + 1}-analysis.json`, chapter.analysis);
      await saveJson(`chapter-${index + 1}-storyboard.json`, chapter.storyboard);
    }
    // Dispose before declaring the entire run successful; never resume or restart it.
    service.dispose(); service = null;
    await ctx.fiber.dispose(); ctx = null;
    report.ok = true;
    report.completedAt = new Date().toISOString();
    report.files = ['chapter-1.html', 'chapter-2.html', 'source.json', 'chapter-1-analysis.json', 'chapter-2-analysis.json', 'chapter-1-storyboard.json', 'chapter-2-storyboard.json'];
    report.qualityNote = 'Generation completed; mathematical and visual quality still requires human review.';
    await saveJson('report.json', report);
    await fs.writeFile(path.join(output, 'SUCCESS'), 'SUCCESS\n', { flag: 'wx' });
    console.log('SUCCESS: HTML teaching artifacts saved. No further runs permitted.');
  } catch {
    // No raw exceptions: host errors may include URLs, authorization or configuration.
    if (report && output) {
      report.ok = false;
      report.error = 'HTML teaching verification failed; no automatic rerun was attempted.';
      try { await fs.writeFile(path.join(output, 'report.json'), redact(JSON.stringify(report, null, 2)) + '\n'); } catch { /* keep failure sanitized */ }
    }
    console.error('HTML teaching verification failed. Check local prerequisites; no automatic rerun was attempted.');
    process.exitCode = 1;
  } finally {
    try { service?.dispose(); } catch { process.exitCode = 1; }
    try { await ctx?.fiber.dispose(); } catch { process.exitCode = 1; }
    if (keyInstalled) {
      if (previousKey === undefined) delete process.env[keyName];
      else process.env[keyName] = previousKey;
    }
  }
}

function authoredChapters() {
  return [
    { id: 'chapter-1', title: '导数的直觉：割线怎样成为切线', sourceText: `观察小车的位置随时间变化，先要分清位置与速度。设位置函数为 s(t)，时间以秒计、位置以米计，则区间 [t,t+h] 上的平均速度是 [s(t+h)−s(t)]/h，单位是米每秒，其中 h≠0，且两个时刻都须位于定义域内。这是两点间割线的斜率，并不是某个瞬间的速度。缩短时间间隔，让第二个点靠近第一个点，才引出瞬时变化率。
一般地，设实函数 f 在 a 的某个开邻域内有定义。若有限的双侧极限 f′(a)=lim(h→0)[f(a+h)−f(a)]/h 存在，就称 f 在 a 可导。h 从正、负两侧趋于零时必须得到同一数值。图像上，导数表示过点 (a,f(a)) 的切线斜率；切线方程为 y=f(a)+f′(a)(x−a)。切线不必只与曲线相交一次，也不能理解为永远不穿过曲线的直线。
例一：取 f(x)=x²，在任意实数 a 处，差商等于 [(a+h)²−a²]/h=2a+h，所以 f′(a)=2a。在 a=1 时，h=1、0.1、−0.1 对应斜率 3、2.1、1.9；左右都趋向 2，切线为 y=1+2(x−1)=2x−1。请画出抛物线、固定点及移动点，对比割线与切线，不能把 h=0 直接代入原差商。
局部线性化把上述极限写成 f(a+h)=f(a)+f′(a)h+r(h)，其中 r(h)/h→0。例如 1.02²=1+2×0.02+0.0004，线性估计为 1.04，误差为 0.0004；近似只在靠近展开点时有保证。
反例 f(x)=|x| 在零点连续，但右差商为 1、左差商为 −1，故不可导。可导必连续，连续却未必可导。端点只能另谈单侧导数；本章的导数默认内点双侧导数。学习者应能从图像说出左右变化的一致性，并用差商验证，而不只背诵求导结果。` },
    { id: 'chapter-2', title: '导数的应用：单调、极值与最优化', sourceText: `导数把局部斜率与整体变化联系起来，但结论离不开适用条件。若 f 在闭区间 [a,b] 连续、在开区间 (a,b) 可导，则拉格朗日中值定理保证存在 c∈(a,b)，使 f(b)−f(a)=f′(c)(b−a)。因此，在一个区间内处处 f′>0 可推出严格递增，处处 f′<0 可推出严格递减；若只有 f′≥0，则可推出非递减。判断单调性必须逐段检查定义域，不能跨越函数无定义的位置。
例一：设 f(x)=x³−3x，定义域为全体实数。由幂函数求导法则得 f′(x)=3x²−3=3(x−1)(x+1)。当 x<−1 时导数为正，在 −1<x<1 时为负，在 x>1 时又为正。因此 f 先增、再减、再增；f(−1)=2 是局部极大值，f(1)=−2 是局部极小值。请在数轴上标记临界点、导数符号和函数升降，用曲线解释“正变负”与“负变正”。
内点若可导且取得局部极值，必须有 f′=0，但这只是必要条件。反例 g(x)=x³ 在零点有 g′(0)=0，却在两侧都递增，所以零点不是极值点。不可导点也可能产生极值，例如 |x| 在零点取得最小值。闭区间上求最值时，要比较内部驻点、内部不可导点以及两个端点的函数值，不能只解导数为零。
例二：用周长二十米的围栏围成矩形，设一边长 x 米，另一边为 10−x 米，实际矩形要求 0<x<10。面积 A(x)=x(10−x)=10x−x²，单位为平方米。A′(x)=10−2x，在 x<5 时为正，在 x>5 时为负，故 x=5 为全局最大点，最大面积为 25 平方米，即正方形。也可由 A(x)=25−(x−5)²≤25 交叉验证。若为了比较端点而延拓到 [0,10]，须说明端点对应退化矩形，并非原问题的可行矩形。
最后区分局部极值与全局最值，先建模、写清定义域与单位，再求导、列符号表、比较候选点并还原实际含义。导数等于零不是最优化结论，符号变化或其他全局论证才完成推理。` },
  ];
}
