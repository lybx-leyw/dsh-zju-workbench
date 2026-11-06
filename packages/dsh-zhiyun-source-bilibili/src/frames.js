/**
 * **抽帧执行**：调 ffmpeg 把一条视频变成「帧 + 签名」。
 *
 * # 设计约束（沿用 `host-deeptutor/src/runtime.js` 那三条）
 *
 * 1. **全文件只有一处 `spawn`**（`spawnProcess`）。所有起进程都走它 ——
 *    散落的 `spawn(` 会让「注入假 spawn 做测试」变绿而生产路径没被测到，
 *    那是最坏的一种绿。
 * 2. **不写死二进制路径**。ffmpeg 由调用方配置或从环境探测；找不到时
 *    **报一个可读的错并说明怎么装**，而不是静默返回空帧。
 * 3. **临时目录由调用方给**。本包不认 `$DSH_HOME`、不读环境变量 ——
 *    那是集成层的决定。
 *
 * # 两条实测出来的硬约束（见 README「抽帧路线」）
 *
 * | 约束 | 依据 |
 * | --- | --- |
 * | **必须显式 `-user_agent`** | B 站 CDN 屏蔽 `Lavf/*`（ffmpeg 默认 UA 回 **403**） |
 * | **先下载再本地抽，不要远端 seek** | 实测远端 `-ss` 8 s / **897 s** / 4.6 s；本地 `-ss` 稳定 ~280 ms |
 *
 * # 为什么分两次调 ffmpeg
 *
 * ```text
 * ① ffmpeg -i <url> -c copy <tmp.mp4>          下载（一次，~20 s/20 分钟）
 * ② ffmpeg -i <tmp.mp4> -vf fps=1/N -q:v 5 ...  全片等间隔帧（一次顺序解码，~2.5 s）
 * ```
 *
 * 不用「对每个采样点 `-ss`」：那是 N 次进程启动，每次都要重新打开文件、定位索引。
 * 一次顺序解码出全部帧，成本与采样点数**无关** —— 实测 239 帧 2.5 秒。
 */

import { spawn as nodeSpawn } from 'node:child_process';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';

import { BilibiliError, ERROR_CODE } from './errors.js';

/** 浏览器 UA。**必须用它** —— 见文件头「B 站 CDN 屏蔽 Lavf/」。 */
export const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
  + 'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** 下载超时（毫秒）。20 分钟 55 MB 的课实测 ~66 s，留足余量。 */
export const DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000;

/** 抽帧超时（毫秒）。一次顺序解码很快，但长视频（3 小时）另算。 */
export const EXTRACT_TIMEOUT_MS = 30 * 60 * 1000;

/** 抽帧时的工作宽度。签名用 96×54，但抽帧本身留一点余量便于人工核对。 */
export const FRAME_WIDTH = 320;

/**
 * 全文件**唯一**的 spawn 落点。
 *
 * @param spawnImpl - 可注入的 `child_process.spawn`（测试用）。
 */
function spawnProcess(spawnImpl, command, args, options) {
  return spawnImpl(command, args, options);
}

/**
 * 跑一个子进程，收集 stdout/stderr，带超时与取消。
 *
 * @returns `{ code, stdout, stderr }`。
 * @throws BilibiliError（`PROCESS_FAILED` / `CANCELLED` / `PROCESS_TIMEOUT`）
 */
function runProcess(spawnImpl, command, args, { timeoutMs, signal } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnProcess(spawnImpl, command, args, {
        // stdin 关掉：ffmpeg 默认会读 stdin，某些环境下会让它停在「等待输入」。
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      reject(new BilibiliError(ERROR_CODE.PROCESS_FAILED,
        `无法启动 ${path.basename(command)}：${error?.message ?? error}`, { command: path.basename(command) }));
      return;
    }

    const stdout = [];
    const stderr = [];
    child.stdout?.on('data', (chunk) => stdout.push(chunk));
    child.stderr?.on('data', (chunk) => stderr.push(chunk));

    let settled = false;
    const finish = (run) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      run();
    };
    const onAbort = () => {
      try { child.kill('SIGKILL'); } catch { /* 已经退出 */ }
      finish(() => reject(new BilibiliError(ERROR_CODE.CANCELLED, '抽帧已取消', {})));
    };
    const timer = Number.isFinite(timeoutMs) && timeoutMs > 0
      ? setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* 已经退出 */ }
        finish(() => reject(new BilibiliError(ERROR_CODE.PROCESS_TIMEOUT,
          `${path.basename(command)} 超过 ${Math.round(timeoutMs / 1000)} 秒未完成`, { command: path.basename(command) })));
      }, timeoutMs)
      : null;
    if (signal) {
      if (signal.aborted) { onAbort(); return; }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    child.on('error', (error) => {
      finish(() => reject(new BilibiliError(ERROR_CODE.PROCESS_FAILED,
        `执行 ${path.basename(command)} 失败：${error?.message ?? error}`, { command: path.basename(command) })));
    });
    child.on('close', (code) => {
      finish(() => resolve({
        code: code ?? -1,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      }));
    });
  });
}

/**
 * 把 ffmpeg 的 stderr 压成**一句可读的原因**。
 *
 * ffmpeg 失败时 stderr 有几十行，直接透传会把界面撑爆，而真正的原因通常
 * 只有一行（`Server returned 403 Forbidden` / `Invalid data found`）。
 *
 * @param stderr - ffmpeg 的完整 stderr。
 * @returns 一行原因（找不到时回最后一行非空内容）。
 */
export function summarizeFfmpegError(stderr) {
  const text = String(stderr ?? '');
  const patterns = [
    [/Server returned (\d{3})[^\n]*/i, (match) => `服务端返回 ${match[1]}（B 站 CDN 屏蔽 ffmpeg 默认 UA？需要 -user_agent）`],
    [/HTTP error (\d{3})[^\n]*/i, (match) => `HTTP ${match[1]}`],
    [/No such file or directory[^\n]*/i, () => '文件不存在'],
    [/Invalid data found when processing input/i, () => '输入不是可解码的媒体（链接失效或返回了错误页）'],
    [/moov atom not found/i, () => '文件不完整（moov 缺失，下载被截断）'],
    [/Output file .* already exists/i, () => '输出文件已存在'],
  ];
  for (const [pattern, describe] of patterns) {
    const found = text.match(pattern);
    if (found) return describe(found);
  }
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  return lines.at(-1) ?? '（ffmpeg 没有输出错误信息）';
}

/**
 * 下载视频到本地。
 *
 * @param options.url - 直链（B 站 playurl 给的 URL）。
 * @param options.destination - 本地路径（调用方给，本包不猜目录）。
 * @returns `{ path, bytes }`。
 */
export async function downloadVideo({ url, destination, spawnImpl = nodeSpawn, ffmpeg = 'ffmpeg', timeoutMs = DOWNLOAD_TIMEOUT_MS, signal } = {}) {
  if (typeof url !== 'string' || !/^https:\/\//i.test(url)) {
    throw new BilibiliError(ERROR_CODE.INPUT, '下载需要 https 直链', { field: 'url' });
  }
  if (typeof destination !== 'string' || destination === '') {
    throw new BilibiliError(ERROR_CODE.INPUT, '下载需要目标路径', { field: 'destination' });
  }
  await mkdir(path.dirname(destination), { recursive: true });
  const result = await runProcess(spawnImpl, ffmpeg, [
    '-hide_banner', '-loglevel', 'error',
    // ⚠️ 这两个是**功能性参数**，不是优化：B 站 CDN 屏蔽 Lavf/ UA。
    '-user_agent', BROWSER_UA,
    '-i', url,
    '-c', 'copy',
    '-y', destination,
  ], { timeoutMs, signal });

  if (result.code !== 0) {
    throw new BilibiliError(ERROR_CODE.PROCESS_FAILED,
      `视频下载失败：${summarizeFfmpegError(result.stderr)}`, { stage: 'download', code: result.code });
  }
  const info = await stat(destination).catch(() => null);
  if (!info || info.size === 0) {
    throw new BilibiliError(ERROR_CODE.PROCESS_FAILED, '视频下载后文件为空', { stage: 'download' });
  }
  return { path: destination, bytes: info.size };
}

/**
 * 把本地视频抽成等间隔帧。
 *
 * @param options.video - 本地 mp4 路径。
 * @param options.directory - 帧输出目录（调用方给）。
 * @param options.everySec - 采样间隔（秒）。
 * @returns `{ frames }` —— `[{ index, timeSec, path }]`，按时间升序。
 */
export async function extractFrames({ video, directory, everySec = 5, spawnImpl = nodeSpawn, ffmpeg = 'ffmpeg', timeoutMs = EXTRACT_TIMEOUT_MS, signal } = {}) {
  const interval = Number.isFinite(everySec) && everySec > 0 ? everySec : 5;
  if (typeof directory !== 'string' || directory === '') {
    throw new BilibiliError(ERROR_CODE.INPUT, '抽帧需要输出目录', { field: 'directory' });
  }
  await mkdir(directory, { recursive: true });
  const result = await runProcess(spawnImpl, ffmpeg, [
    '-hide_banner', '-loglevel', 'error',
    '-i', video,
    // `1/N` 是「每 N 秒一帧」，比 `fps=N` 慢 N 倍、也省 N 倍磁盘。
    '-vf', `fps=1/${interval},scale=${FRAME_WIDTH}:-1`,
    '-q:v', '5',
    path.join(directory, 'f%05d.jpg'),
  ], { timeoutMs, signal });

  if (result.code !== 0) {
    throw new BilibiliError(ERROR_CODE.PROCESS_FAILED,
      `抽帧失败：${summarizeFfmpegError(result.stderr)}`, { stage: 'frames', code: result.code });
  }

  const names = (await readdir(directory)).filter((name) => /^f\d+\.jpg$/i.test(name)).sort();
  return {
    frames: names.map((name, index) => ({
      index,
      // ffmpeg 的 `f%05d` 从 1 开始，第 n 张对应 (n-1)*interval 秒。
      timeSec: index * interval,
      path: path.join(directory, name),
    })),
  };
}

/**
 * 一条视频 → 本地帧（下载 + 抽帧，一次做完）。
 *
 * @param options.url - 视频直链。
 * @param options.workDir - 工作目录（调用方给；本包不猜）。
 * @param options.everySec - 采样间隔。
 * @param options.cleanup - 抽完是否删掉中间 mp4（默认 `true`）。
 * @returns `{ frames, videoBytes, videoPath, cleaned }`。
 */
export async function framesFromUrl({ url, workDir, everySec = 5, cleanup = true, spawnImpl = nodeSpawn, ffmpeg = 'ffmpeg', signal, onProgress } = {}) {
  if (typeof workDir !== 'string' || workDir === '') {
    throw new BilibiliError(ERROR_CODE.INPUT, '需要工作目录', { field: 'workDir' });
  }
  const videoPath = path.join(workDir, 'video.mp4');
  const framesDir = path.join(workDir, 'frames');

  onProgress?.({ phase: 'download' });
  const downloaded = await downloadVideo({ url, destination: videoPath, spawnImpl, ffmpeg, signal });

  onProgress?.({ phase: 'frames', bytes: downloaded.bytes });
  const { frames } = await extractFrames({ video: videoPath, directory: framesDir, everySec, spawnImpl, ffmpeg, signal });

  let cleaned = false;
  if (cleanup) {
    // 中间 mp4 动辄几十上百 MB，抽完就没用了。
    // 删不掉不算失败（Windows 上文件被占用是常见的），但要如实报出来。
    try { await rm(videoPath, { force: true }); cleaned = true; } catch { cleaned = false; }
  }
  onProgress?.({ phase: 'done', frames: frames.length });
  return { frames, videoBytes: downloaded.bytes, videoPath, cleaned };
}

/**
 * 探测 ffmpeg 是否可用。
 *
 * **不猜路径**：只用调用方给的命令（默认 `ffmpeg`，走 PATH）。
 * 找不到时回 `{ ok: false, reason }`，让集成层决定怎么提示用户。
 *
 * @returns `{ ok, version, reason }`。
 */
export async function probeFfmpeg({ spawnImpl = nodeSpawn, ffmpeg = 'ffmpeg', timeoutMs = 10_000 } = {}) {
  try {
    const result = await runProcess(spawnImpl, ffmpeg, ['-hide_banner', '-version'], { timeoutMs });
    if (result.code !== 0) return { ok: false, version: null, reason: summarizeFfmpegError(result.stderr) };
    const first = result.stdout.split('\n')[0] ?? '';
    return { ok: true, version: first.trim(), reason: '' };
  } catch (error) {
    return { ok: false, version: null, reason: error?.message ?? String(error) };
  }
}
