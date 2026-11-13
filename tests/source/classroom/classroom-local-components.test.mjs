/**
 * 本地组件能力（`zhiyun check` / `zhiyun setup` 的计划面 / `zhiyun trans audio` 的装配方）。
 *
 * # 这三条为什么放在同一个文件
 *
 * 它们是**同一条链路的三段**：`check` 说缺什么 → `setupPlan` 说明要放到哪 →
 * `createHostTranscriber` 真的把音频变成文字。任何一段单独测都测不出「三段说的是
 * 同一件事」，而这正是最容易漂的地方（诊断按一种目录找、计划按另一种装）。
 *
 * # 全离线
 *
 * FFmpeg 与宿主的 `speechToText` 都是**假身**：真跑 FFmpeg 会让测试依赖本机装没装，
 * 真跑语音内核要 240 MB 权重。这里钉的是**编排**（切片、偏移、失败分类、时间戳
 * 拼接），不是内核的识别质量。
 *
 * ⚠️ 语音内核与模型均**未经真机验证**：本机没有启用宿主语音包，也没有权重。
 * 见交付报告里的「未验证」清单。
 */

import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ASR_ASSETS, ASR_TOTAL_BYTES, checkAsr, setupPlan, sha256File,
} from '../../../packages/source/classroom/src/diagnostics.js';
import {
  createHostTranscriber, extractAudio, findDataChunk,
} from '../../../packages/source/classroom/src/asr.js';
import { ClassroomSource } from '../../../packages/source/classroom/src/source.js';

/* ────────────────────────────────── 夹具 */

/**
 * 造一段真的 WAV：16 kHz / 单声道 / 16-bit PCM。
 *
 * `list: true` 时在 `fmt ` 与 `data` 之间插一个 `LIST` 块 —— FFmpeg 实际就是这么
 * 写的（编码器元数据），所以「音频起点不在第 44 字节」是**常态**而不是边界情况。
 */
function wav(seconds, { list = false } = {}) {
  const samples = Math.round(seconds * 16000);
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i += 1) data.writeInt16LE(Math.round(Math.sin(i / 8) * 8000), i * 2);
  const fmt = Buffer.alloc(24);
  fmt.write('fmt ', 0, 'latin1');
  fmt.writeUInt32LE(16, 4);
  fmt.writeUInt16LE(1, 8);
  fmt.writeUInt16LE(1, 10);
  fmt.writeUInt32LE(16000, 12);
  fmt.writeUInt32LE(32000, 16);
  fmt.writeUInt16LE(2, 20);
  fmt.writeUInt16LE(16, 22);
  const chunks = [fmt];
  if (list) {
    const body = Buffer.from('INFOISFT\x07\x00\x00\x00ffmpeg\x00\x00', 'latin1');
    const header = Buffer.alloc(8);
    header.write('LIST', 0, 'latin1');
    header.writeUInt32LE(body.length, 4);
    chunks.push(header, body);
  }
  const dataHeader = Buffer.alloc(8);
  dataHeader.write('data', 0, 'latin1');
  dataHeader.writeUInt32LE(data.length, 4);
  chunks.push(dataHeader, data);
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(12);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(body.length + 4, 4);
  // `WAVE` 在偏移 8，不是 0：写成 0 会得到一个 RIFF 头里没有 WAVE 标识的假文件，
  // 而那种文件会让 `findDataChunk` 正确地返回 null —— 夹具坏了却看起来像实现坏了。
  head.write('WAVE', 8, 'latin1');
  return Buffer.concat([head, body]);
}

/** 假的 FFmpeg 子进程：下一个 tick 才发事件，让调用方先把监听器挂上。 */
function fakeChild({ code = 0, error = null } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {};
  setImmediate(() => {
    if (error) { child.emit('error', error); return; }
    child.emit('close', code);
  });
  return child;
}

/** 假 FFmpeg：不跑真程序，只把预置的 WAV 写到 `-y <output>` 指定的位置。 */
function fakeFfmpeg(payload) {
  return (_executable, args) => {
    const output = args[args.length - 1];
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    setImmediate(() => {
      if (payload === null) { child.emit('close', 1); return; }
      void writeFile(output, payload).then(() => child.emit('close', 0), () => child.emit('close', 2));
    });
    return child;
  };
}

/* ══════════════════════════════════ check（asr 的目录布局与校验） ══════════════════════════════════ */

test('checkAsr 按上游的嵌套布局找模型, 三种都齐时才算可用', async () => {
  const home = await mkdtemp(path.join(tmpdirSafe(), 'zw-asr-layout-'));
  const base = path.join(home, 'speech-to-text', 'sensevoice', 'models');
  try {
    // 平铺目录里什么都没有 → 默认报缺。
    const empty = await checkAsr({ home, files: ['model.int8.onnx'] });
    assert.equal(empty.available, false);
    assert.equal(empty.models[0].present, false);

    // 按上游 asr.ts:55-59 的位置放：权重在 sensevoice-onnx/、VAD 在 silero/。
    await mkdir(path.join(base, 'sensevoice-onnx'), { recursive: true });
    await writeFile(path.join(base, 'sensevoice-onnx', 'model.int8.onnx'), 'w');
    await writeFile(path.join(base, 'sensevoice-onnx', 'tokens.txt'), 't');
    const nested = await checkAsr({ home, files: ['model.int8.onnx', 'tokens.txt'] });
    assert.equal(nested.layout, 'nested', '应当认出上游那种嵌套布局');
    assert.deepEqual(nested.models.map((m) => m.present), [true, true]);
    assert.match(nested.models[0].file, /sensevoice-onnx[\\/]model\.int8\.onnx$/);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('checkAsr 认得出手工平铺的布局, 不因为「不在上游位置」就报缺', async () => {
  // 这是本包早先注释与实际摆放的形状。只认嵌套会让这半用户「文件明明在却说缺」。
  const home = await mkdtemp(path.join(tmpdirSafe(), 'zw-asr-flat-'));
  const base = path.join(home, 'speech-to-text', 'sensevoice', 'models');
  try {
    await mkdir(base, { recursive: true });
    await writeFile(path.join(base, 'model.int8.onnx'), 'w');
    await writeFile(path.join(base, 'tokens.txt'), 't');
    const flat = await checkAsr({ home, files: ['model.int8.onnx', 'tokens.txt'] });
    assert.equal(flat.layout, 'flat');
    assert.deepEqual(flat.models.map((m) => m.present), [true, true]);
    assert.deepEqual(flat.problems.filter((p) => /模型文件缺失/.test(p)), []);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('checkAsr 把截断的权重报成问题, 而不是「文件在就算准备好」', async () => {
  // 下载中断留下的是一个**大小不对**的文件：它在目录里，但 sherpa 加载会失败。
  // 只判 present 的话，用户看到 check 绿的、转写却崩 —— 最难查的一种。
  const home = await mkdtemp(path.join(tmpdirSafe(), 'zw-asr-short-'));
  const base = path.join(home, 'speech-to-text', 'sensevoice', 'models');
  try {
    await mkdir(path.join(base, 'sensevoice-onnx'), { recursive: true });
    await writeFile(path.join(base, 'sensevoice-onnx', 'model.int8.onnx'), 'short');
    await writeFile(path.join(base, 'sensevoice-onnx', 'tokens.txt'), 't');
    const result = await checkAsr({ home, files: ['model.int8.onnx', 'tokens.txt'] });
    assert.equal(result.available, false, '大小不符不能算可用');
    const problem = result.problems.find((p) => /大小不符/.test(p));
    assert.ok(problem, `应当有一条「大小不符」：${JSON.stringify(result.problems)}`);
    assert.match(problem, /model\.int8\.onnx 应为 \d+ 字节，实际 5/);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('checkAsr({verify:true}) 真算 SHA-256, 不符时报错而不是冒充通过', async () => {
  const home = await mkdtemp(path.join(tmpdirSafe(), 'zw-asr-hash-'));
  const base = path.join(home, 'speech-to-text', 'sensevoice', 'models');
  const asset = ASR_ASSETS.tokens;
  try {
    await mkdir(path.join(base, 'sensevoice-onnx'), { recursive: true });
    // 内容与长度都对不上：verify 必须抓到。
    await writeFile(path.join(base, 'sensevoice-onnx', asset.name), 'x');
    const bad = await checkAsr({ home, files: [asset.name], verify: true });
    assert.equal(bad.verified, false, '不一致时不能报 verified');
    assert.match(bad.problems.join(' '), /SHA-256/);

    // 真哈希对得上时才算 verified —— 用资产清单里那份长度/摘要不现实（240 MB），
    // 所以这里只钉「校验会真的读文件并给出摘要」这一半。
    assert.equal(await sha256File(path.join(base, 'sensevoice-onnx', asset.name)), '2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881');
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('checkAsr({verify:true}) 摘要全对时 verified 为 true —— 正例也真跑一次', async () => {
  // 只写反例的话，「verified 恒为 false」也能让那些测试全绿 —— 那等于把「校验通过」
  // 这个状态永久锁死了。清单里 240 MB 的摘要没法在测试里复现，所以用 `assets`
  // 覆盖一份「内容与摘要真的对得上」的清单，走一次真正的正例分支。
  const home = await mkdtemp(path.join(tmpdirSafe(), 'zw-asr-hash-ok-'));
  const base = path.join(home, 'speech-to-text', 'sensevoice', 'models');
  try {
    await mkdir(path.join(base, 'sensevoice-onnx'), { recursive: true });
    const content = Buffer.from('verified-content');
    await writeFile(path.join(base, 'sensevoice-onnx', 'tokens.txt'), content);
    const digest = createHash('sha256').update(content).digest('hex');

    const result = await checkAsr({
      home,
      assets: { tokens: { kind: 'tokens', name: 'tokens.txt', bytes: content.length, sha256: digest } },
      verify: true,
    });
    assert.equal(result.verified, true, '摘要真的对得上时必须报 verified');
    assert.equal(result.problems.filter((p) => /SHA-256/.test(p)).length, 0);
    // 大小也对得上：这条正例不该顺带触发「大小不符」。
    assert.equal(result.problems.filter((p) => /大小不符/.test(p)).length, 0);

    // 换一个字节就翻成 false —— 证明上面那个 true 不是常数。
    await writeFile(path.join(base, 'sensevoice-onnx', 'tokens.txt'), Buffer.from('verified-contenT'));
    const flipped = await checkAsr({
      home,
      assets: { tokens: { kind: 'tokens', name: 'tokens.txt', bytes: content.length, sha256: digest } },
      verify: true,
    });
    assert.equal(flipped.verified, false);
    assert.equal(flipped.models[0].sha256Matched, false);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('sha256File 流式计算, 提前中止时抛 AbortError', async () => {
  const dir = await mkdtemp(path.join(tmpdirSafe(), 'zw-sha-'));
  const file = path.join(dir, 'a.bin');
  try {
    await writeFile(file, Buffer.alloc(64 * 1024, 7));
    const digest = await sha256File(file);
    assert.match(digest, /^[a-f0-9]{64}$/);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(sha256File(file, { signal: controller.signal }), (error) => error.name === 'AbortError');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

/* ══════════════════════════════════ setupPlan（只做计划，绝不执行） ══════════════════════════════════ */

test('setupPlan 给出可复算的步骤, 但明确 executed:false 且一步都不做', async () => {
  const home = await mkdtemp(path.join(tmpdirSafe(), 'zw-plan-'));
  try {
    const plan = await setupPlan('all', { home, dataDirectory: path.join(home, 'data') });
    assert.equal(plan.executed, false, '这是契约：本函数从不执行任何一步');
    assert.match(plan.reason, /N-3/);

    const media = plan.steps.filter((step) => step.component === 'media');
    assert.equal(media.length, 1);
    assert.equal(media[0].package, 'ffmpeg-static@5.3.0', '与上游 setup.ts:31 同一个包与版本');
    assert.match(media[0].target, /tools[\\/]zw-media[\\/]node_modules[\\/]ffmpeg-static[\\/]ffmpeg/);

    const downloads = plan.steps.filter((step) => step.kind === 'download');
    assert.deepEqual(downloads.map((step) => step.name).sort(), Object.values(ASR_ASSETS).map((a) => a.name).sort());
    for (const step of downloads) {
      assert.match(step.url, /^https:\/\/huggingface\.co\//);
      // 国内镜像：上游 ORIGINS 里就是这两个。
      assert.match(step.mirrorUrl, /^https:\/\/hf-mirror\.com\//);
      assert.match(step.sha256, /^[a-f0-9]{64}$/, '每个下载都要带校验值，否则下完也不知道对不对');
      assert.equal(step.satisfied, false, '空目录里什么都不满足');
      assert.match(step.destination, /speech-to-text[\\/]sensevoice[\\/]models/);
    }
    assert.equal(plan.totalBytes, ASR_TOTAL_BYTES);
    assert.ok(plan.totalBytes > 200 * 1000 * 1000, '总字节数要如实反映约 241 MB 的代价');
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('setupPlan 把已就位的步骤标成 satisfied, 免得用户重下 240 MB', async () => {
  const home = await mkdtemp(path.join(tmpdirSafe(), 'zw-plan-done-'));
  const base = path.join(home, 'speech-to-text', 'sensevoice', 'models');
  try {
    await mkdir(path.join(base, 'sensevoice-onnx'), { recursive: true });
    // 写一个大小正确的假 tokens（315894 字节）—— 「已有」的判据是大小。
    await writeFile(path.join(base, 'sensevoice-onnx', 'tokens.txt'), Buffer.alloc(ASR_ASSETS.tokens.bytes, 1));
    const plan = await setupPlan('asr', { home });
    const tokens = plan.steps.find((step) => step.name === 'tokens.txt');
    assert.equal(tokens.satisfied, true);
    const model = plan.steps.find((step) => step.name === 'model.int8.onnx');
    assert.equal(model.satisfied, false);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('setupPlan 也拒未知组件, 与 check 同一套词表', async () => {
  await assert.rejects(setupPlan('gpu'), (error) => {
    assert.equal(error.code, 'INVALID_INPUT');
    assert.deepEqual(error.details.unknown, ['gpu']);
    return true;
  });
});

/* ══════════════════════════════════ findDataChunk / extractAudio ══════════════════════════════════ */

test('findDataChunk 跳过 LIST 块找到真正的音频起点', () => {
  const plain = wav(0.01);
  assert.equal(findDataChunk(plain.subarray(0, 8192)), 44, '没有 LIST 时正好在 44');

  const withList = wav(0.01, { list: true });
  const offset = findDataChunk(withList.subarray(0, 8192));
  // 44 字节的 fmt 块 + LIST 块（8 + 22 字节，含填充）。
  assert.ok(offset > 44, `带 LIST 时音频起点必须后移（实际 ${offset}）`);
  assert.equal(withList.toString('latin1', offset - 8, offset - 4), 'data');

  assert.equal(findDataChunk(Buffer.from('not a wave')), null);
  assert.equal(findDataChunk(Buffer.alloc(0)), null);
});

test('extractAudio 传对 SenseVoice 要求的参数, 并把「没有音轨」与「跑失败」分开报', async () => {
  const dir = await mkdtemp(path.join(tmpdirSafe(), 'zw-ffmpeg-'));
  const input = path.join(dir, 'in.m4a');
  const output = path.join(dir, 'out.wav');
  try {
    await writeFile(input, 'x');
    let argv = null;
    await extractAudio('ffmpeg', input, output, {
      spawn: (executable, args) => {
        argv = [executable, ...args];
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.kill = () => {};
        setImmediate(() => void writeFile(output, wav(0.5)).then(() => child.emit('close', 0)));
        return child;
      },
    });
    // 这三个参数是 SenseVoice 唯一接受的格式，缺一个内核就读不了。
    assert.ok(argv.includes('-ar') && argv[argv.indexOf('-ar') + 1] === '16000');
    assert.ok(argv.includes('-ac') && argv[argv.indexOf('-ac') + 1] === '1');
    assert.ok(argv.includes('pcm_s16le'));
    assert.ok(argv.includes('-vn'), '必须丢视频轨');
    assert.ok(argv.includes('-nostdin'), '宿主是长驻进程，不能抢 stdin');

    // 只抽出 44 字节的头 → 输入里没有音轨（不是 FFmpeg 坏了）。
    await assert.rejects(
      extractAudio('ffmpeg', input, output, { spawn: fakeFfmpeg(wav(0)) }),
      (error) => { assert.equal(error.code, 'NO_AUDIO'); return true; },
    );
    // 非零退出 → 媒体处理失败，带 stderr 尾巴。
    await assert.rejects(
      extractAudio('ffmpeg', input, output, { spawn: fakeFfmpeg(null) }),
      (error) => { assert.equal(error.code, 'MEDIA_FAILED'); assert.match(error.message, /退出码 1/); return true; },
    );
    // ENOENT → 缺依赖，且提示去哪装（不是「音频坏了」）。
    await assert.rejects(
      extractAudio('ffmpeg', input, output, {
        spawn: () => fakeChild({ error: Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }) }),
      }),
      (error) => {
        assert.equal(error.code, 'DEPENDENCY_MISSING');
        assert.match(error.message, /找不到可执行文件/);
        assert.match(error.details.hint, /FFMPEG_PATH/);
        return true;
      },
    );
  } finally { await rm(dir, { recursive: true, force: true }); }
});

/* ══════════════════════════════════ createHostTranscriber（漏-4 的装配方） ══════════════════════════════════ */

test('createHostTranscriber 拒绝形状不对的宿主服务, 而不是等到转写时才炸', () => {
  for (const bad of [null, {}, { transcribe: async () => ({}) }, { resolve: () => ({}) }]) {
    assert.throws(() => createHostTranscriber({ speechToText: bad, executable: 'ffmpeg' }), (error) => error.code === 'DEPENDENCY_MISSING');
  }
  assert.throws(
    () => createHostTranscriber({ speechToText: { resolve: () => ({}), transcribe: async () => ({}) } }),
    (error) => error.code === 'INVALID_INPUT',
  );
});

test('createHostTranscriber 抽一次音频、按块识别、把时间戳拼回整节课的坐标', async () => {
  const dir = await mkdtemp(path.join(tmpdirSafe(), 'zw-host-asr-'));
  const source = path.join(dir, 'lecture.mp4');
  const output = path.join(dir, 'out');
  try {
    await writeFile(source, 'video-bytes');
    await mkdir(output, { recursive: true });

    const chunks = [];
    const speechToText = {
      resolve: (request) => ({ ...request }),
      transcribe: async (spec) => {
        chunks.push(spec.audio.length);
        return { text: ` 第${chunks.length}段话 `, audioSeconds: 2 };
      },
    };
    const transcriber = createHostTranscriber({
      speechToText,
      executable: 'ffmpeg',
      chunkSeconds: 2,
      // 真的 6 秒 WAV：三块，每块 2 秒。
      extract: (_exe, _input, target) => writeFile(target, wav(6, { list: true })).then(() => stat(target)).then((s) => s.size),
    });

    const result = await transcriber({ file: source, directory: output, signal: new AbortController().signal });
    assert.equal(result.segments.length, 3, '6 秒按 2 秒切，应当三块');
    assert.deepEqual(result.segments.map((s) => s.start), [0, 2, 4]);
    assert.deepEqual(result.segments.map((s) => s.end), [2, 4, 6]);
    assert.equal(result.segments[0].text, '第1段话', '首尾空白要去掉');
    assert.match(result.engine, /chunked$/, 'engine 必须写明这是块级时间，不是逐句时间');
    // 每一块都要带完整的 WAV 头（provider 会用它校验输入）。
    for (const size of chunks) assert.ok(size > 44);
    // 中间 WAV 必须清掉：一节课近 200 MB。
    const leftover = await stat(path.join(output, 'audio.wav')).catch(() => null);
    assert.equal(leftover, null, '中间产物不该留在输出目录');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('createHostTranscriber 把 provider 的单次字节上限考虑进去, 不切出超限的块', async () => {
  // 上限压到 1.5 秒的量：请求的 chunkSeconds 是 10，实际必须被压下来。
  const maxAudioBytes = 44 + 16000 * 2 * 1.5;
  const dir = await mkdtemp(path.join(tmpdirSafe(), 'zw-host-limit-'));
  try {
    const seen = [];
    const transcriber = createHostTranscriber({
      speechToText: {
        resolve: (request) => ({ ...request }),
        transcribe: async (spec) => { seen.push(spec.audio.length); return { text: 'x' }; },
      },
      executable: 'ffmpeg',
      chunkSeconds: 10,
      maxAudioBytes,
      extract: (_exe, _input, target) => writeFile(target, wav(4)).then(() => stat(target)).then((s) => s.size),
    });
    const result = await transcriber({ file: 'a.wav', directory: dir });
    assert.ok(seen.length >= 2, '4 秒按 1.5 秒上限切, 至少要两块');
    for (const size of seen) assert.ok(size <= maxAudioBytes, `块大小 ${size} 超过了 ${maxAudioBytes}`);
    assert.ok(result.chunkSeconds <= 1.5);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('createHostTranscriber 遇到没有音轨或坏 WAV 时按各自的原因报错', async () => {
  const dir = await mkdtemp(path.join(tmpdirSafe(), 'zw-host-bad-'));
  try {
    const speaker = { resolve: (r) => r, transcribe: async () => ({ text: 'x' }) };
    // 只有 44 字节的头：没有音轨。
    const empty = createHostTranscriber({
      speechToText: speaker, executable: 'ffmpeg',
      extract: (_e, _i, target) => writeFile(target, wav(0)).then(() => 44),
    });
    await assert.rejects(empty({ file: 'a.wav', directory: dir }), (error) => error.code === 'NO_AUDIO');

    // 根本不是 WAV：报 MEDIA_FAILED 并指向输入文件，而不是伪装成「识别为空」。
    const broken = createHostTranscriber({
      speechToText: speaker, executable: 'ffmpeg',
      extract: async (_e, _i, target) => { await writeFile(target, Buffer.from('garbage-garbage')); return 15; },
    });
    await assert.rejects(broken({ file: 'a.wav', directory: dir }), (error) => {
      assert.equal(error.code, 'MEDIA_FAILED');
      assert.match(error.message, /data 块/);
      return true;
    });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('装配好的转写器一路走 ClassroomSource.transcribeAudio, 落盘四个文件', async () => {
  // 这条是端到端的「接线」验证：漏-4 的原症状是 `assertTranscriber(null)` 抛
  // DEPENDENCY_MISSING，所以必须证明「注入之后真的跑通并落盘」。
  const dir = await mkdtemp(path.join(tmpdirSafe(), 'zw-host-e2e-'));
  const file = path.join(dir, 'lecture.m4a');
  await writeFile(file, 'audio-bytes');
  const classroom = new ClassroomSource({ fetch: async () => new Response('{}') });
  try {
    classroom.setTranscriber(createHostTranscriber({
      speechToText: { resolve: (r) => r, transcribe: async () => ({ text: '今天讲第三章' }) },
      executable: 'ffmpeg',
      chunkSeconds: 60,
      extract: (_e, _i, target) => writeFile(target, wav(2)).then(() => stat(target)).then((s) => s.size),
    }));
    const out = await classroom.transcribeAudio({ file, directory: path.join(dir, 'transcript') });
    assert.equal(out.reused, false);
    assert.equal(out.text, '今天讲第三章');
    assert.equal(out.durationMs, 2000, '块级时间也要如实落到 durationMs');
    assert.match(out.engine, /^host-speech-to-text:/);
    for (const name of ['segments.json', 'transcript.txt', 'transcript.md', 'transcribe.json']) {
      await stat(path.join(dir, 'transcript', name));
    }
    const markdown = await readFile(path.join(dir, 'transcript', 'transcript.md'), 'utf8');
    assert.match(markdown, /未做总结/, '粗稿必须写明没有总结');
  } finally { await classroom.dispose(); await rm(dir, { recursive: true, force: true }); }
});

test('装配层把 setupPlan 挂到服务对象上 —— 工具层与路由都靠这个方法', async () => {
  // 这条钉的是「**有没有接上**」，不是 plan 的内容（那在上面测过了）。
  // 漏-4 的原始症状就是「方法在、但没人注入」；同一种漏法在这里也成立：
  // `diagnostics.setupPlan` 写好而没挂到服务对象上，工具层调不到，用户看到的是
  // 「这个数据源版本还没有 setupPlan」—— 看起来像版本旧，实际是没接线。
  const { apply } = await import('../../../packages/source/classroom/src/index.js');
  const provided = {};
  const ctx = {
    profileContext: { dir: path.join(os.tmpdir(), `zw-apply-${Date.now()}`) },
    provide: (name, value) => { provided[name] = value; },
    get: () => undefined,
    effect: (fn) => { fn(); return () => {}; },
    logger: { info: () => {}, debug: () => {} },
    // 没有 webServer → 装配层走「跳过路由」那条分支；服务本身照旧必须可用。
  };
  const dispose = await apply(ctx, { asrHome: path.join(os.tmpdir(), 'zw-home-fixed') });
  try {
    const service = provided.zwClassroom;
    assert.ok(service, '装配必须 provide zwClassroom');
    assert.equal(typeof service.setupPlan, 'function', 'setupPlan 必须挂在服务对象上');
    assert.equal(typeof service.check, 'function');
    assert.equal(typeof service.live?.remaining, 'function', 'liveCandidates 依赖它');

    const plan = await service.setupPlan('asr');
    assert.equal(plan.executed, false);
    assert.equal(plan.steps.filter((step) => step.kind === 'download').length, 3);
    // 目标路径必须用注入的 asrHome 推，而不是进程环境变量 ——
    // 否则多 profile 的机器上会指到别人的目录。
    assert.match(plan.steps.find((step) => step.name === 'tokens.txt').destination, /zw-home-fixed/);
  } finally { await dispose(); }
});

/** `os.tmpdir()` 的薄包装（只是让上面每处调用短一点）。 */
function tmpdirSafe() { return os.tmpdir(); }
