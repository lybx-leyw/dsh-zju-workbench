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

import { createRequire } from 'node:module';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ClassroomError } from './errors.js';

/** `check` 接受的组件名。`all` 只在 `setup` 里用，诊断两个都要看就直接传数组。 */
export const COMPONENTS = Object.freeze(['asr', 'media']);

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
 * `asr` 组件诊断：运行库能解析吗、模型文件在不在。
 *
 * 三件事分开报，因为**三种缺法的处置完全不同**：
 *
 *   - `runtime.missing` —— 运行库不在（本仓就是这种）：装运行库，不是下模型；
 *   - `models.missing`  —— 模型没下（约 240 MB）：下模型；
 *   - `models.partial`  —— 少其中几个文件：重下缺的那几个。
 *
 * 上游靠 `assets.json` 里的 `sha256` 校验；本包**不做哈希校验** —— 那要读
 * 240 MB，而这里只是诊断。所以报 `verified: false`，不冒充「校验通过」。
 *
 * @param {object} [options]
 * @param {string} [options.home] - DSH home（模型根目录是 `<home>/speech-to-text/sensevoice/models`）。
 * @param {string} [options.dataDirectory] - 本包数据目录（作为 `createRequire` 的解析基准）。
 * @param {string[]} [options.files] - 期望存在的文件名，默认取上游那三件。
 */
export async function checkAsr({ home, dataDirectory, files } = {}) {
  const root = home ?? (String(process.env?.DSH_HOME ?? '').trim() || null);
  const expected = files ?? ['model.int8.onnx', 'tokens.txt', 'silero_vad.onnx'];
  const base = root ? path.join(root, 'speech-to-text', 'sensevoice', 'models') : null;

  const resolved = resolvePackage(ASR_RUNTIME_PACKAGE, dataDirectory ? path.join(dataDirectory, 'index.js') : import.meta.url);
  const runtime = {
    package: ASR_RUNTIME_PACKAGE,
    engine: ASR_ENGINE,
    available: resolved !== null,
    entry: resolved,
  };

  const models = [];
  if (base) {
    for (const name of expected) {
      const file = path.join(base, name);
      let bytes = null;
      try { bytes = (await stat(file)).size; } catch { bytes = null; }
      models.push({ name, file, present: bytes !== null, bytes });
    }
  }
  const missing = models.filter((item) => !item.present).map((item) => item.name);
  const available = runtime.available && Boolean(base) && models.length > 0 && missing.length === 0;

  const problems = [];
  if (!runtime.available) problems.push(`找不到运行库 ${ASR_RUNTIME_PACKAGE}（本仓不含它，需由宿主安装层提供）`);
  if (!base) problems.push('没有 DSH_HOME，无法定位语音模型目录');
  if (base && models.length && missing.length) problems.push(`模型文件缺失：${missing.join('、')}`);

  return {
    component: 'asr',
    available,
    runtime,
    directory: base,
    models,
    // 只查了「在不在 + 多大」，没有算 SHA-256；别把它读成「校验通过」。
    verified: false,
    problems,
    action: available
      ? null
      : runtime.available
        ? `下载 SenseVoice 模型到 ${base ?? '<DSH_HOME>/speech-to-text/sensevoice/models'}（约 240 MB）；`
          + '文件齐全后本诊断会转为可用。本包不执行下载。'
        : `先在宿主安装层装上 ${ASR_RUNTIME_PACKAGE}（它自带 sherpa-onnx 运行库与模型清单），再回来复查。本包不执行 npm install。`,
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
