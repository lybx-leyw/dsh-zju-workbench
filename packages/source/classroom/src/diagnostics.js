/**
 * 本地组件诊断（对应上游 `zhiyun check`）。
 *
 * # `check` 与 `setup` 是两件事，本包只做前者
 *
 * 上游 `core/zju/lib/zhiyun/local-cli.ts:16-20`：
 *
 * ```text
 * setup --component all|media|asr   准备本地依赖；已有的复用，缺的才装
 * check --component asr|media       检查本地组件
 * ```
 *
 * 读了 `setup.ts` 之后可以确定 `setup` 是**写操作**：
 *
 *   - `media` 分支 `npm install ffmpeg-static@5.3.0` 到 `<data>/tools/zhiyun-media`；
 *   - `asr` 分支从 HuggingFace / hf-mirror **下载约 240 MB 模型**并落盘。
 *
 * 两者都改**本机状态**，而且都属于「安装」而不是「读取」。本包的能力声明是
 * 只读数据源（`dsh.capability.writes: false` 指的是不改上游，但「装依赖」连
 * 本机状态都改了），而且本任务不跑 `npm install`。所以：
 *
 *   - `check` 是**只读诊断** —— 已补进来（就是本文件）；
 *   - `setup`（装 FFmpeg / 下 ASR 模型）**尚未实现** —— 它是本机安装动作，
 *     不是读，且要下载几十到几百 MB。这条**不是裁决**，是当前没做，
 *     已记进 `coverage-gaps.md` 的待补清单。
 *
 * # 诊断要能回答「缺什么、怎么办」
 *
 * 只说 `available: false` 没有用 —— 上游的 SKILL.md 里到处是
 * 「先 `check`，再按结果 `setup`」。所以每个组件都带 `action` 字段，
 * 明说该做什么。**不静默**：探不到就报探不到，不把 `catch` 吞成「正常」。
 */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { createRequire } from 'node:module';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ClassroomError } from './errors.js';

/** `check` 接受的组件名。`all` 只在 `setup` 里用，诊断两个都要看就直接传数组。 */
export const COMPONENTS = Object.freeze(['asr', 'media']);

/**
 * 语音模型的三件资产 —— **逐字抄自宿主语音包自带的清单**。
 *
 * 宿主那份 `runtime/assets.json`（`@deepseek-ai/dsh-experimental-speech-to-text-sensevoice`）
 * 是唯一权威：URL 指向 HuggingFace 上固定 commit 的三个文件，`sha256` 是上游算好的。
 * 本包抄这一份而不是自己编，理由是**诊断必须能和安装方对上账** —— 上面写
 * `240 MB`、下面却下另一个文件，用户按提示装完回来仍然是红的。
 *
 * `layout` 记录上游 `asr.ts` 的落盘位置（见 `ASR_LAYOUTS`）：诊断要按同一形状去找，
 * 否则文件明明在、`check` 却说缺。
 */
export const ASR_ASSETS = Object.freeze({
  model: Object.freeze({
    kind: 'model',
    name: 'model.int8.onnx',
    bytes: 239233841,
    sha256: 'c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51',
    url: 'https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/2365baeacb507f821a0c8120fcee3d484dba7a07/model.int8.onnx',
  }),
  tokens: Object.freeze({
    kind: 'tokens',
    name: 'tokens.txt',
    bytes: 315894,
    sha256: 'f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc',
    url: 'https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/2365baeacb507f821a0c8120fcee3d484dba7a07/tokens.txt',
  }),
  vad: Object.freeze({
    kind: 'vad',
    name: 'silero_vad.onnx',
    bytes: 1807522,
    sha256: 'a35ebf52fd3ce5f1469b2a36158dba761bc47b973ea3382b3186ca15b1f5af28',
    url: 'https://huggingface.co/csukuangfj/vad/resolve/fba88cd2e921609e7675c3aaf51e0b9b295da4bc/silero_vad.onnx',
  }),
});

/** 三件合起来约 241 MB —— 这是 `setup` 必须让用户先看见的代价。 */
export const ASR_TOTAL_BYTES = Object.values(ASR_ASSETS).reduce((sum, asset) => sum + asset.bytes, 0);

/**
 * 模型的两种目录布局。
 *
 * 上游 `asr.ts:55-59` 把权重放在 `models/sensevoice-onnx/`、VAD 放在 `models/silero/`；
 * 而本包早先的诊断按**平铺**的 `models/*.onnx` 找。两种都真实存在过 ——
 * 宿主语音包用的是嵌套那种，手工放文件的人常常是平铺那种。
 *
 * 所以按顺序探测：嵌套优先（那是上游与宿主的形状），平铺兜底（那是本包旧行为，
 * 也确实是用户手工摆放的常见样子）。**不合并成一个模糊判断** —— 结果里要能
 * 看出「按哪种布局找到的」，否则「找得到但加载不了」时无从下手。
 */
const ASR_LAYOUTS = Object.freeze([
  Object.freeze({ name: 'nested', dir: (root, asset) => (asset.kind === 'vad' ? path.join(root, 'silero') : path.join(root, 'sensevoice-onnx')) }),
  Object.freeze({ name: 'flat', dir: () => '' }),
]);

/**
 * 上游借用的宿主语音包与运行库。
 *
 * 写在这里是为了**说清依赖**：本包没有它们，也装不了它们。
 */
export const ASR_RUNTIME_PACKAGE = '@deepseek-ai/dsh-experimental-speech-to-text-sensevoice';
export const ASR_ENGINE = 'sensevoice-onnx';

/** `ffmpeg -version` 的探针超时。这只是问版本，5 秒足够；超时按「不可用」报。 */
const VERSION_TIMEOUT_MS = 5000;

/**
 * 解析 ffmpeg 可执行文件，顺序与上游 `ffmpeg.ts:8-13` 一致：
 * 环境变量覆盖 → 本包数据目录下装好的 → PATH 里的 `ffmpeg`。
 *
 * @param {object} options
 * @param {string} [options.dataDirectory] - 本 profile 的数据目录（`<profile>/data/zhiyun-classroom`）。
 * @param {string} [options.env] - 环境变量来源（测试可注入）。
 * @returns {{executable: string, source: 'env'|'managed'|'path'}}
 */
export function resolveFfmpeg({ dataDirectory, env = process.env } = {}) {
  const configured = String(env?.FFMPEG_PATH ?? '').trim();
  if (configured) return { executable: configured, source: 'env' };
  if (dataDirectory) {
    const managed = path.join(
      dataDirectory, 'tools', 'zhiyun-media', 'node_modules', 'ffmpeg-static',
      process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg',
    );
    return { executable: managed, source: 'managed' };
  }
  return { executable: 'ffmpeg', source: 'path' };
}

/**
 * 跑一次 `-version` 判断可执行文件真的能用。
 *
 * **不用 `which`/`where`**：PATH 里有一个同名文件不等于它能跑（缺 DLL、
 * 架构不符、被 0 字节占位）。上游同样是真的执行一次。
 *
 * @param {string} executable
 * @param {object} [options]
 * @param {(file: string, args: string[], options: object) => import('node:events').EventEmitter} [options.spawn]
 * @returns {Promise<{available: boolean, version: string|null, executable: string, error: string|null}>}
 */
export function probeFfmpeg(executable, { spawn: spawner = spawn, timeoutMs = VERSION_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (value) => { if (settled) return; settled = true; clearTimeout(timer); resolve(value); };
    let child;
    try {
      child = spawner(executable, ['-version'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      resolve({ available: false, version: null, executable, error: error?.message ?? String(error) });
      return;
    }
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* 已经退出 */ }
      finish({ available: false, version: null, executable, error: `ffmpeg 版本探针超过 ${timeoutMs}ms 未返回` });
    }, timeoutMs);
    timer.unref?.();
    child.stdout?.on('data', (chunk) => { stdout += chunk; });
    child.stderr?.on('data', (chunk) => { stderr += chunk; });
    // ENOENT 是「根本没这个程序」，必须与「跑了但失败」分开报。
    child.once('error', (error) => finish({
      available: false, version: null, executable,
      error: error?.code === 'ENOENT' ? `找不到可执行文件：${path.basename(executable)}` : (error?.message ?? String(error)),
    }));
    child.once('close', (code) => {
      // ffmpeg -version 的第一行形如 `ffmpeg version 6.1.1 ...`。
      const version = /^ffmpeg version (\S+)/m.exec(stdout)?.[1] ?? null;
      if (code === 0 && version) return finish({ available: true, version, executable, error: null });
      if (code === 0) return finish({ available: true, version: null, executable, error: null });
      finish({ available: false, version: null, executable, error: `ffmpeg 退出码 ${code}${stderr ? `：${stderr.slice(-200).trim()}` : ''}` });
    });
  });
}

/**
 * `media` 组件诊断：FFmpeg 在不在、能不能跑。
 *
 * 为什么课堂需要它：回放只有 m3u8 时必须用它压制/抽音频；没有 FFmpeg
 * 就只能下现成的直链资源。
 */
export async function checkMedia({ dataDirectory, env, spawn: spawner, timeoutMs } = {}) {
  const { executable, source } = resolveFfmpeg({ dataDirectory, env });
  const probe = await probeFfmpeg(executable, { ...(spawner ? { spawn: spawner } : {}), ...(timeoutMs ? { timeoutMs } : {}) });
  return {
    component: 'media',
    available: probe.available,
    executable: probe.executable,
    source,
    version: probe.version,
    error: probe.error,
    action: probe.available
      ? null
      : '安装 FFmpeg：设置环境变量 FFMPEG_PATH 指向已有的 ffmpeg 可执行文件（推荐），'
        + '或由宿主安装层把 ffmpeg-static 装到本包的 data/tools/zhiyun-media 下。'
        + '本包不执行 npm install。',
  };
}

/**
 * 找一个包的真实入口（只做解析，不加载）。
 *
 * `createRequire` 失败时返回 null 而不是抛 —— 「没装这个包」是最常见的一种
 * 正常结果，不是异常。
 */
function resolvePackage(name, from) {
  try { return createRequire(from)?.resolve?.(`${name}/package.json`) ?? null; }
  catch { return null; }
}

/**
 * 算一个文件的 SHA-256（流式，不把 240 MB 读进内存）。
 *
 * 只在调用方明确要求校验时才算：一次诊断读 240 MB 的代价是几秒磁盘 IO，
 * 而绝大多数「缺什么」的判断只看文件在不在、多大。
 *
 * @param {string} file
 * @param {{signal?: AbortSignal}} [options]
 * @returns {Promise<string>} 小写十六进制摘要。
 */
export async function sha256File(file, { signal } = {}) {
  const hash = createHash('sha256');
  const stream = createReadStream(file);
  try {
    for await (const chunk of stream) {
      signal?.throwIfAborted();
      hash.update(chunk);
    }
  } finally {
    // 提前中止时要主动销毁句柄，否则 Windows 上文件会一直被占着。
    stream.destroy();
  }
  return hash.digest('hex');
}

/** 按名字查资产清单；调用方自带的文件名（测试夹具）可能不在清单里。 */
function assetOf(name) {
  return Object.values(ASR_ASSETS).find((asset) => asset.name === name) ?? null;
}

/** 文件在不在（只 stat，不读内容）。 */
async function exists(file) {
  try { await stat(file); return true; } catch { return false; }
}

/**
 * `asr` 组件诊断：运行库能解析吗、模型文件在不在。
 *
 * 三件事分开报，因为**三种缺法的处置完全不同**：
 *
 *   - `runtime.missing` —— 运行库不在（本仓就是这种）：装运行库，不是下模型；
 *   - `models.missing`  —— 模型没下（约 240 MB）：下模型；
 *   - `models.partial`  —— 少其中几个文件：重下缺的那几个。
 *
 * # 目录布局要按上游形状找
 *
 * 上游 `asr.ts:55-59` 把权重放在 `models/sensevoice-onnx/`、VAD 放在
 * `models/silero/`；手工放文件的人常平铺在 `models/` 下。两种都真实存在，
 * 所以两种都探，并**在结果里写明按哪种布局找到的** —— 只报「缺文件」而不说
 * 在哪找过，用户补完文件回来仍然是红的。
 *
 * # 默认不校验哈希
 *
 * 上游靠 `assets.json` 的 `sha256` 兜底（下载不完整是最常见的坏法）。但诊断
 * 一次读 240 MB 只为确认没坏，代价不小。所以默认只比**大小**（能抓住截断与
 * 0 字节占位），`verify: true` 时才真算 SHA-256；`verified` 字段只在真算过
 * 且全部匹配时才为 true —— **不冒充「校验通过」**。
 *
 * @param {object} [options]
 * @param {string} [options.home] - DSH home（模型根目录是 `<home>/speech-to-text/sensevoice/models`）。
 * @param {string} [options.dataDirectory] - 本包数据目录（作为 `createRequire` 的解析基准）。
 * @param {string[]} [options.files] - 期望存在的文件名，默认取上游那三件。
 * @param {object} [options.assets] - 资产清单覆盖（`{name, bytes, sha256}` 的映射）。
 *   默认用 `ASR_ASSETS`。留这个口是为了让「校验通过」这一支能被**真跑一次**
 *   （清单里的 240 MB 摘要没法在测试里复现），以及将来换引擎时不改代码。
 * @param {boolean} [options.verify] - 计算 SHA-256（约 240 MB 读盘）。
 * @param {AbortSignal} [options.signal]
 */
export async function checkAsr({ home, dataDirectory, files, assets = ASR_ASSETS, verify = false, signal } = {}) {
  const root = home ?? (String(process.env?.DSH_HOME ?? '').trim() || null);
  const expected = files ?? Object.values(assets).map((asset) => asset.name);
  const assetNamed = (name) => Object.values(assets).find((asset) => asset.name === name) ?? null;
  const base = root ? path.join(root, 'speech-to-text', 'sensevoice', 'models') : null;

  const resolved = resolvePackage(ASR_RUNTIME_PACKAGE, dataDirectory ? path.join(dataDirectory, 'index.js') : import.meta.url);
  const runtime = {
    package: ASR_RUNTIME_PACKAGE,
    engine: ASR_ENGINE,
    available: resolved !== null,
    entry: resolved,
  };

  /**
   * 两种布局都探一遍，取命中多的那个。
   *
   * 为什么不能只看一种：宿主的语音包与上游都用嵌套布局，而本包早先的注释与
   * 一些用户的实际摆法是平铺。只认一种的另一半用户会得到「文件明明在却说缺」。
   */
  let layout = null;
  let models = [];
  if (base) {
    let best = null;
    for (const candidate of ASR_LAYOUTS) {
      const rows = [];
      for (const name of expected) {
        const asset = assetNamed(name);
        const directory = candidate.dir(base, asset ?? { kind: 'model' });
        const file = directory ? path.join(directory, name) : path.join(base, name);
        let bytes = null;
        try { bytes = (await stat(file)).size; } catch { bytes = null; }
        rows.push({ name, file, present: bytes !== null, bytes, expectedBytes: asset?.bytes ?? null, asset });
      }
      signal?.throwIfAborted();
      const hits = rows.filter((row) => row.present).length;
      if (!best || hits > best.hits) best = { layout: candidate.name, rows, hits };
    }
    layout = best.layout;
    models = best.rows;
  }

  const missing = models.filter((item) => !item.present).map((item) => item.name);
  // 大小不符也算「没准备好」：截断的文件能让 sherpa 加载失败，但它在目录里。
  const truncated = models.filter((item) => item.present && item.expectedBytes !== null && item.bytes !== item.expectedBytes);

  let verified = false;
  if (verify && base && !missing.length) {
    const mismatched = [];
    let computed = 0;
    for (const item of models) {
      if (!item.asset) continue;
      signal?.throwIfAborted();
      const digest = await sha256File(item.file, { signal });
      computed += 1;
      if (digest !== item.asset.sha256) mismatched.push(item.name);
    }
    // 只有**真的算过至少一个**摘要才算 verified。清单外的文件名（自定义夹具、
    // 别的引擎的权重）一个都验不了，那时报 true 等于凭空给一个「已校验」。
    verified = computed > 0 && mismatched.length === 0;
    if (mismatched.length) {
      // 只有真算过才可以说「校验不过」；也不能把它降级成「缺文件」。
      models = models.map((item) => ({ ...item, sha256Matched: !mismatched.includes(item.name) }));
    }
  }

  const available = runtime.available && Boolean(base) && models.length > 0 && missing.length === 0 && truncated.length === 0;

  const problems = [];
  if (!runtime.available) problems.push(`找不到运行库 ${ASR_RUNTIME_PACKAGE}（本仓不含它，需由宿主安装层提供）`);
  if (!base) problems.push('没有 DSH_HOME，无法定位语音模型目录');
  if (base && models.length && missing.length) problems.push(`模型文件缺失：${missing.join('、')}`);
  if (truncated.length) problems.push(`模型文件大小不符（下载不完整）：${truncated.map((item) => `${item.name} 应为 ${item.expectedBytes} 字节，实际 ${item.bytes}`).join('；')}`);
  if (verify && base && !missing.length && !verified) problems.push('模型文件 SHA-256 校验不通过，建议重新下载');

  return {
    component: 'asr',
    available,
    runtime,
    directory: base,
    // 按哪种布局找到的。嵌套是上游与宿主语音包的形状，平铺是手工摆放的常见形状。
    layout,
    models: models.map(({ asset, ...row }) => row),
    // 只有真算过且全部匹配时才为 true；默认只比大小，别把它读成「校验通过」。
    verified,
    problems,
    action: available
      ? null
      : runtime.available
        ? `下载 SenseVoice 模型到 ${base ?? '<DSH_HOME>/speech-to-text/sensevoice/models'}（${Math.round(ASR_TOTAL_BYTES / 1e6)} MB，三件：`
          + `${Object.values(ASR_ASSETS).map((asset) => asset.name).join(' / ')}）；缺口与目标路径见 setupPlan。`
          + '文件齐全后本诊断会转为可用；本包不执行下载。'
        : `先在宿主安装层装上 ${ASR_RUNTIME_PACKAGE}（它自带 sherpa-onnx 运行库），再回来复查。`
          + `本包不执行 npm install。媒体侧见 setupPlan('media')。`,
  };
}

/**
 * **只读的安装计划**（对应上游 `zhiyun setup` 的「算什么」，不含「去做」）。
 *
 * # 为什么只给计划，不执行
 *
 * 上游 `setup.ts` 干两件写操作：`npm install ffmpeg-static@5.3.0`（进本包数据目录）
 * 与下载约 241 MB 模型权重。两件都改**本机安装状态**，都超出「数据源只读」的
 * 能力声明；而 `npm install` 在本仓是硬禁止。所以这里把它们**摊开成可复算的
 * 步骤**：确切的目标路径、URL、字节数、SHA-256。用户（或宿主安装层）照着做
 * 一次即可，做完 `check` 立刻转绿。
 *
 * **这不是裁决 N-3 的替代品**：N-3 拒绝的是「把 sherpa-onnx 内核与权重内置进
 * 数据源包」。本函数不安装任何东西、不联网、不写文件 —— 它只是把
 * 「`check` 说缺什么」翻译成「具体要放到哪、从哪取」。
 *
 * @param {string|string[]} [component] - `'media'` / `'asr'` / `'all'`（默认）。
 * @param {object} [options]
 * @param {string} [options.dataDirectory] - 本包数据目录（决定 FFmpeg 的托管路径）。
 * @param {string} [options.home] - DSH home（决定模型目标目录）。
 * @returns {Promise<{component: string, executed: false, steps: object[], totalBytes: number, reason: string}>}
 */
export async function setupPlan(component = 'all', { dataDirectory, home } = {}) {
  const requested = component === 'all' ? [...COMPONENTS] : (Array.isArray(component) ? component : [component]);
  const unique = [...new Set(requested.map((item) => String(item).trim()))];
  const unknown = unique.filter((item) => !COMPONENTS.includes(item));
  if (unknown.length) {
    throw new ClassroomError('INVALID_INPUT', `component 只能是 ${COMPONENTS.join(' / ')} 或 all`, { unknown });
  }

  const steps = [];
  let totalBytes = 0;

  if (unique.includes('media')) {
    const { executable, source } = resolveFfmpeg({ dataDirectory: dataDirectory ?? null, env: {} });
    steps.push({
      component: 'media',
      kind: 'npm-install',
      // 上游 setup.ts:31 的原命令：装到本包数据目录，不污染全局。
      command: `npm install --prefix "${path.dirname(path.dirname(path.dirname(executable)))}" --no-audit --no-fund --save-exact ffmpeg-static@5.3.0`,
      package: 'ffmpeg-static@5.3.0',
      target: executable,
      // 已经有可执行文件时不必再装 —— 计划里标出来，省得用户白下一次。
      satisfied: source === 'env' || await exists(executable),
      alternative: '或设置环境变量 FFMPEG_PATH 指向已有的 ffmpeg 可执行文件；本包不执行 npm install。',
    });
  }

  if (unique.includes('asr')) {
    const root = home ?? (String(process.env?.DSH_HOME ?? '').trim() || null);
    // 与 `checkAsr` 同一根：模型目录由 DSH home 推出，不是本包自己编的路径。
    const base = root ? path.join(root, 'speech-to-text', 'sensevoice', 'models') : null;
    for (const asset of Object.values(ASR_ASSETS)) {
      const directory = base ? ASR_LAYOUTS[0].dir(base, asset) : null;
      const destination = directory ? path.join(directory, asset.name) : null;
      totalBytes += asset.bytes;
      let satisfied = false;
      if (destination) {
        try { satisfied = (await stat(destination)).size === asset.bytes; } catch { satisfied = false; }
      }
      steps.push({
        component: 'asr',
        kind: 'download',
        name: asset.name,
        url: asset.url,
        mirrorUrl: asset.url.replace('https://huggingface.co', 'https://hf-mirror.com'),
        bytes: asset.bytes,
        sha256: asset.sha256,
        destination,
        // 大小一致才算「已有」；哈希要 `check({verify:true})` 才验。
        satisfied,
        note: '下到目标路径旁的临时文件，校验 sha256 通过后再改名 —— 半份权重会被 sherpa 加载失败。',
      });
    }
  }

  return {
    component: unique.length === 1 ? unique[0] : 'all',
    // 这个字段是契约的一部分：本函数**从不**执行任何一步。
    executed: false,
    steps,
    totalBytes,
    reason: '安装动作属于本机安装层（N-3）：本包只读，不执行 npm install，也不下载模型权重。'
      + '把 steps 交给宿主安装层或用户执行；做完后用 check 复查。',
  };
}

/**
 * `check` 的唯一入口。
 *
 * @param {string|string[]} [component] - `'asr'` / `'media'` / `'all'` / 数组。默认 `'all'`。
 * @param {object} [options] - 透传给各组件（`home` / `dataDirectory` / `env` / `spawn` / `files`）。
 * @returns {Promise<{component: string, available: boolean, results: object[]}>}
 */
export async function checkComponents(component = 'all', options = {}) {
  const requested = component === 'all' ? [...COMPONENTS] : (Array.isArray(component) ? component : [component]);
  const unique = [...new Set(requested.map((item) => String(item).trim()))];
  const unknown = unique.filter((item) => !COMPONENTS.includes(item));
  if (unknown.length) {
    throw new ClassroomError('INVALID_INPUT', `component 只能是 ${COMPONENTS.join(' / ')} 或 all`, { unknown });
  }
  const results = [];
  for (const name of unique) {
    results.push(name === 'media' ? await checkMedia(options) : await checkAsr(options));
  }
  return { component: unique.length === 1 ? unique[0] : 'all', available: results.every((item) => item.available), results };
}
