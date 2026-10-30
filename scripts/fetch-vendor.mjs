#!/usr/bin/env node
/**
 * 拉取 `vendor/` 下的上游源码快照。
 *
 * 仓库不跟踪任何 `vendor/` 目录（见 .gitignore 里的说明）：上游快照体积大、有自己的
 * 许可与发行节奏，跟着我们的提交走会让 clone 和 review 都不堪重负。这里按**锁文件**
 * 把它拉回来，落盘前核对哈希 —— 「我们到底在跑哪一版上游」仍然是一个可审计的事实。
 *
 *   node scripts/fetch-vendor.mjs                缺什么补什么，已存在则跳过
 *   node scripts/fetch-vendor.mjs --force        忽略本地副本，重新拉取
 *   node scripts/fetch-vendor.mjs --check        只校验本地副本，不联网
 *   node scripts/fetch-vendor.mjs --only <id>    只处理一个来源（deeptutor / benchmarker）
 *
 * 大陆网络相关（GitHub 直连常被阻断，Node 的 fetch 又默认不读代理变量）：
 *
 *   --mirror <列表>              镜像前缀或模板，逗号分隔；`none` 表示只直连
 *   VENDOR_GITHUB_MIRROR=<列表>  同上，命令行优先级更高
 *   --timeout <毫秒>             单次下载超时，默认归档 15 分钟、单文件 3 分钟
 *   --retries <次数>             每个候选地址的重试次数，默认 2
 *   NODE_USE_ENV_PROXY=1         让 fetch 走 HTTPS_PROXY / HTTP_PROXY（Node ≥ 24）
 *
 * 镜像只是「从哪下」，不影响「下到的是不是那一份」：每个候选地址拿到内容后都先过
 * 锁文件的 SHA-256，镜像返回坏包会被跳过并回落到直连，而不是写进 vendor。
 *
 * 拉取一律先写到 `<dest>.fetch-tmp`，校验通过后再换到正式位置；中途失败不会留下
 * 半份快照，也不会动到原有的那份。
 */
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync, chmodSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

/** 仓库里被 vendor 的上游快照：锁文件是唯一事实来源，这里只声明「锁在哪、落到哪」。 */
const SOURCES = [
  {
    id: 'deeptutor',
    kind: 'archive',
    lock: 'packages/dsh-zhiyun-host-deeptutor/upstream.lock.json',
    dest: 'packages/dsh-zhiyun-host-deeptutor/vendor/deeptutor',
    /** 归档 31 MB，实测慢网络下 150 s，留足余量。 */
    timeoutMs: 900_000,
  },
  {
    id: 'benchmarker',
    kind: 'files',
    lock: 'scripts/quiz_bench/evaluators/vendor.lock.json',
    dest: 'scripts/quiz_bench/evaluators/vendor/benchmarker',
    timeoutMs: 180_000,
  },
  {
    /**
     * OpenMAIC（THU-MAIC）：整个 Next.js 应用原样 vendor，由 dsh-zhiyun-host-openmaic
     * 作为独立进程托管，页面以同源 iframe 呈现 —— 功能无损的前提就是不裁剪它的源码。
     *
     * 归档 91 MB，实测大陆网络 200 s 上下，留足余量。
     */
    id: 'openmaic',
    kind: 'archive',
    lock: 'packages/dsh-zhiyun-host-openmaic/upstream.lock.json',
    dest: 'packages/dsh-zhiyun-host-openmaic/vendor/openmaic',
    timeoutMs: 900_000,
    /** 版本号的唯一真源：解包后与锁文件比对。 */
    versionFile: 'package.json',
    versionField: 'version',
  },
];

/**
 * 运行期产物：跑过一次 Python 就会出现，且带着**本地绝对路径**。
 * 它们不参与树摘要，否则 `--check` 会永远报「和锁文件对不上」（历史 bug）。
 */
const RUNTIME_EXCLUDES = [
  /(^|\/)__pycache__(\/|$)/,
  /\.py[cod]$/,
  /(^|\/)\.DS_Store$/,
];
const TREE_ALGORITHM = 'sha256-lines-v1';

const args = new Set(process.argv.slice(2));
const flagValue = (name) => {
  const at = process.argv.indexOf(name);
  return at === -1 ? null : process.argv[at + 1] ?? null;
};
const FORCE = args.has('--force');
const CHECK = args.has('--check');
const ONLY = flagValue('--only');
const RETRIES = Math.max(1, Number(flagValue('--retries')) || 2);
const TIMEOUT_OVERRIDE = Number(flagValue('--timeout')) || null;
const MIRROR_SPEC = flagValue('--mirror') ?? process.env.VENDOR_GITHUB_MIRROR ?? '';

/** Windows 上上游快照的路径会超过 MAX_PATH，落盘一律走扩展路径。 */
function abs(relPath) {
  const full = resolve(ROOT, relPath);
  return process.platform === 'win32' ? `\\\\?\\${full.replaceAll('/', '\\')}` : full;
}

const readJson = (relPath) => JSON.parse(readFileSync(abs(relPath), 'utf8'));
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function log(source, message) {
  console.log(`[${source}] ${message}`);
}

// ---------------------------------------------------------------- 镜像与代理

/**
 * 把一个镜像写法规范成 `{url} -> 真实地址` 的函数。
 * 支持两种常见形态：
 *   - 前缀：`https://ghfast.top`       → `https://ghfast.top/https://codeload.github.com/...`
 *   - 模板：`https://m.example/{url}`  → 地址填进 `{url}`
 */
export function normalizeMirror(spec) {
  const raw = String(spec ?? '').trim();
  if (!raw) return null;
  const trimmed = raw.replace(/\/+$/, '');
  if (/^(none|direct|off|false|0)$/i.test(trimmed)) return { disabled: true };
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error(`镜像地址必须以 http(s):// 开头：${raw}`);
  }
  if (trimmed.includes('{url}')) {
    return { template: trimmed, apply: (url) => trimmed.replaceAll('{url}', url) };
  }
  return { prefix: trimmed, apply: (url) => `${trimmed}/${url}` };
}

/** 逗号/空白分隔的镜像列表 → `{url} -> 真实地址` 函数数组；`none` 让整条链路只剩直连。 */
export function buildMirrors(spec) {
  const parts = String(spec ?? '')
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const mirrors = [];
  for (const part of parts) {
    const mirror = normalizeMirror(part);
    if (!mirror) continue;
    if (mirror.disabled) return [];
    mirrors.push(mirror);
  }
  return mirrors;
}

/**
 * 候选地址顺序：**镜像优先，直连兜底**。
 * 镜像配了但不可用时自动回落直连，而不是把用户锁死在坏镜像上。
 */
export function mirrorCandidates(url, mirrors) {
  const fromMirrors = (mirrors ?? []).map((mirror) => mirror.apply(url));
  const unique = [...new Set(fromMirrors)];
  return unique.includes(url) ? unique : [...unique, url];
}

/** Node 的 fetch 默认不读代理变量；配了代理却没开开关时明确指出来，别让人对着 `fetch failed` 猜。 */
function proxyHint() {
  const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy ?? process.env.HTTP_PROXY ?? process.env.http_proxy;
  if (!proxy) return null;
  if (process.env.NODE_USE_ENV_PROXY === '1' || process.env.NODE_USE_ENV_PROXY === 'true') return null;
  const major = Number(process.versions.node.split('.')[0]);
  return major >= 24
    ? `检测到代理变量（${proxy}），但 Node 的 fetch 默认不读取它 —— 加 NODE_USE_ENV_PROXY=1 再跑一次。`
    : `检测到代理变量（${proxy}），但当前 Node ${process.versions.node} 的 fetch 不支持 NODE_USE_ENV_PROXY；请升级到 Node ≥ 24 或改用 --mirror。`;
}

function explainNetworkFailure(source, error) {
  const hint = proxyHint();
  const mirrorHint = (mirrors ?? []).length === 0
    ? '大陆网络下可加镜像，例如：\n'
      + '    npm run vendor:fetch -- --mirror https://ghfast.top\n'
      + '  或长期生效：\n'
      + '    VENDOR_GITHUB_MIRROR=https://ghfast.top npm run vendor:fetch\n'
      + '  （镜像只影响下载来源，落盘前仍按锁文件校验 SHA-256）'
    : `已尝试镜像：${mirrors.map((m) => m.prefix ?? m.template).join('、')}；`
      + '可换一个镜像，或加 NODE_USE_ENV_PROXY=1 走系统代理。';
  console.error(`[${source}] ${error?.message ?? error}`);
  if (hint) console.error(`[${source}] 提示：${hint}`);
  console.error(`[${source}] 提示：${mirrorHint}`);
}

const mirrors = buildMirrors(MIRROR_SPEC);

// ---------------------------------------------------------------- 下载

async function download(url, { timeoutMs = 180_000 } = {}) {
  const at = Date.now();
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
  const body = Buffer.from(await response.arrayBuffer());
  console.log(`  ↳ HTTP ${response.status}，${mb(body.length)}，${Date.now() - at} ms`);
  return body;
}

class VerifyError extends Error {}

/**
 * 按候选顺序逐个试，**内容校验不过就换下一个**。
 * 这是镜像能安全存在的前提：坏镜像/被劫持的镜像拿不到「哈希对得上的包」，
 * 只会在日志里留下一条失败记录。
 */
export async function firstVerified(urls, verify, {
  label = '下载',
  timeoutMs = 180_000,
  retries = 1,
  fetchOne = download,
  logger = console.log,
} = {}) {
  const problems = [];
  for (const [index, url] of urls.entries()) {
    for (let attempt = 1; attempt <= retries; attempt += 1) {
      try {
        const body = await fetchOne(url, { timeoutMs });
        const verdict = verify(body, url) ?? { ok: true };
        if (verdict.ok === false) throw new VerifyError(verdict.reason ?? '内容校验失败');
        if (index > 0 || attempt > 1) logger(`  ✓ 已从备用地址取得内容：${url}`);
        return { body, url };
      } catch (error) {
        const message = error?.message ?? String(error);
        problems.push(`${url}: ${message}`);
        if (error instanceof VerifyError) break; // 同一个地址再试也是同一份坏内容
        if (attempt < retries) await sleep(500 * attempt);
      }
    }
  }
  throw new Error(`${label}失败（${problems.length} 次尝试）：\n  ${problems.slice(0, 6).join('\n  ')}`);
}

/** `https://github.com/owner/repo` → `owner/repo`。 */
function repoPath(repository) {
  const match = /github\.com[/:]([^/]+)\/([^/#?]+)/.exec(repository ?? '');
  if (!match) throw new Error(`锁文件里的 repository 不是 GitHub 地址：${repository}`);
  return `${match[1]}/${match[2].replace(/\.git$/, '')}`;
}

function countFiles(relPath) {
  let total = 0;
  const walk = (current) => {
    for (const entry of readdirSync(abs(current), { withFileTypes: true })) {
      if (entry.isDirectory()) walk(`${current}/${entry.name}`);
      else total += 1;
    }
  };
  walk(relPath);
  return total;
}

function hasFiles(relPath) {
  return existsSync(abs(relPath)) && countFiles(relPath) > 0;
}

/** 半份快照比没有快照更糟，所以换入前先落临时目录。 */
/**
 * 换入暂存树；**目录重命名不行时退回逐文件复制**。
 *
 * 为什么要这条退路：Windows 上 `rename()` 一个已经解好几千个文件、路径还接近
 * MAX_PATH 的目录，实测会抛 `EPERM`（杀毒/索引器此刻正持有其中某个句柄）。
 * 而这份暂存树**刚刚通过归档哈希与树摘要两道校验**，只因一次重命名失败就整份丢弃、
 * 让用户再下 90 MB，是不划算的。复制慢、但同样能完成换入。
 */
function swapIn(source, stageRel, destRel) {
  const retired = `${destRel}.fetch-old`;
  rmSync(abs(retired), { recursive: true, force: true });
  if (existsSync(abs(destRel))) renameSync(abs(destRel), abs(retired));
  try {
    try {
      renameSync(abs(stageRel), abs(destRel));
    } catch (error) {
      if (!['EPERM', 'EXDEV', 'EBUSY', 'EACCES'].includes(error?.code)) throw error;
      log(source, `目录重命名被拒（${error.code}），改为逐文件复制换入`);
      mkdirSync(abs(destRel), { recursive: true });
      cpSync(abs(stageRel), abs(destRel), { recursive: true, force: true, verbatimSymlinks: true });
      rmSync(abs(stageRel), { recursive: true, force: true });
    }
  } catch (error) {
    if (existsSync(abs(retired))) renameSync(abs(retired), abs(destRel));
    throw error;
  }
  rmSync(abs(retired), { recursive: true, force: true });
  log(source, `已写入 ${destRel}`);
}

// ---------------------------------------------------------------- 树摘要

/**
 * 目录内容摘要（`sha256-lines-v1`）：
 * 把每个文件写成一行 `file\0<相对路径>\0<内容 sha256>`，符号链接写成
 * `link\0<路径>\0<目标>`，排除运行期产物，按默认字典序排序后以 `\n` 连接（末尾带换行），
 * 再取 SHA-256。
 *
 * 为什么不用归档哈希代替：离线 `--check` 手里只有本地目录，没有归档；
 * 而归档哈希只能在 `--force` 真正下载时核对。两者合起来才覆盖「下对了」与「留对了」。
 */
export function digestOfEntries(entries) {
  const lines = entries
    .map((entry) => (entry.kind === 'link'
      ? `link\0${entry.path}\0${entry.target}`
      : `file\0${entry.path}\0${entry.sha}`))
    .sort();
  return {
    digest: createHash('sha256').update(`${lines.join('\n')}\n`, 'utf8').digest('hex'),
    files: entries.length,
    digestible: lines.length,
  };
}

/**
 * 读一个目录，产出参与摘要的条目。
 * 顺手记下被跳过的数量：调用方要能说「另有 N 个运行期产物已忽略」，
 * 而不是让人对着文件数对不上时猜。
 */
export function readTreeEntries(rootRel) {
  const entries = [];
  let total = 0;
  const walk = (current, rel) => {
    for (const dirent of readdirSync(abs(current), { withFileTypes: true })) {
      const childRel = `${rel}${dirent.name}`;
      const childAbs = `${current}/${dirent.name}`;
      if (dirent.isDirectory()) {
        walk(childAbs, `${childRel}/`);
        continue;
      }
      total += 1;
      if (RUNTIME_EXCLUDES.some((re) => re.test(childRel))) continue;
      if (dirent.isSymbolicLink()) {
        entries.push({ kind: 'link', path: childRel, target: readFileSync(abs(childAbs), 'utf8') });
      } else {
        entries.push({ kind: 'file', path: childRel, sha: sha256(readFileSync(abs(childAbs))) });
      }
    }
  };
  walk(rootRel, '');
  return { entries, total };
}

/** 本地目录 → `{digest, files, total, excluded}`；`excluded` 是被跳过的运行期产物数量。 */
export function computeTreeDigest(rootRel) {
  const { entries, total } = readTreeEntries(rootRel);
  return { ...digestOfEntries(entries), total, excluded: total - entries.length };
}

// ---------------------------------------------------------------- tar

const cstr = (buf, start, length) => {
  const slice = buf.subarray(start, start + length);
  const end = slice.indexOf(0);
  return slice.subarray(0, end === -1 ? slice.length : end).toString('utf8');
};

const isZeroBlock = (block) => block.every((byte) => byte === 0);

/** PAX 扩展头：一串 `<长度> <键>=<值>\n`，路径超 100 字节时上游（GitHub 归档）会用它。 */
function readPax(body) {
  const entries = {};
  let at = 0;
  while (at < body.length) {
    const space = body.indexOf(0x20, at);
    if (space === -1) break;
    const length = Number.parseInt(body.subarray(at, space).toString('utf8'), 10);
    if (!Number.isFinite(length) || length <= 0) break;
    const record = body.subarray(space + 1, at + length).toString('utf8');
    const eq = record.indexOf('=');
    if (eq !== -1) entries[record.slice(0, eq)] = record.slice(eq + 1).replace(/\n$/, '');
    at += length;
  }
  return entries;
}

/**
 * 解开 codeload 的 tar.gz。只实现 GitHub 归档实际会出现的条目类型：
 * 普通文件、目录、符号链接，以及路径过长时的 PAX / GNU 扩展头。
 */
function extractTar(buffer, { destRel, strip }) {
  let pos = 0;
  let files = 0;
  let bytes = 0;
  let pendingPath = null;
  let pendingLink = null;
  let gnuName = null;
  let gnuLink = null;

  while (pos + 512 <= buffer.length) {
    const header = buffer.subarray(pos, pos + 512);
    if (isZeroBlock(header)) break;
    const name = cstr(header, 0, 100);
    const mode = Number.parseInt(cstr(header, 100, 8).trim() || '0', 8);
    const size = Number.parseInt(cstr(header, 124, 12).trim() || '0', 8);
    const type = String.fromCharCode(header[156]) || '0';
    const linkname = cstr(header, 157, 100);
    const prefix = cstr(header, 345, 155);
    const dataStart = pos + 512;
    const body = buffer.subarray(dataStart, dataStart + size);
    pos = dataStart + Math.ceil(size / 512) * 512;

    if (type === 'x') {
      const pax = readPax(body);
      pendingPath = pax.path ?? pendingPath;
      pendingLink = pax.linkpath ?? pendingLink;
      continue;
    }
    if (type === 'g') continue;
    if (type === 'L') { gnuName = cstr(body, 0, body.length); continue; }
    if (type === 'K') { gnuLink = cstr(body, 0, body.length); continue; }
    if (type === 'V') continue;

    const raw = pendingPath ?? gnuName ?? (prefix ? `${prefix}/${name}` : name);
    const target = linkname || gnuLink || pendingLink || '';
    pendingPath = null;
    pendingLink = null;
    gnuName = null;
    gnuLink = null;

    // 归档顶层是 `<仓库名>-<提交>/`，剥掉它才是快照根目录。
    const parts = raw.split('/').filter((part) => part.length > 0).slice(strip);
    if (parts.length === 0) continue;
    if (parts.includes('..')) throw new Error(`归档里有越界路径：${raw}`);
    const relative = parts.join('/');

    if (type === '5' || raw.endsWith('/')) {
      mkdirSync(abs(join(destRel, relative)), { recursive: true });
      continue;
    }

    if (type === '0' || type === '\0') {
      mkdirSync(dirname(abs(join(destRel, relative))), { recursive: true });
      writeFileSync(abs(join(destRel, relative)), body);
      // 上游偶尔带可执行脚本；Windows 上没有可执行位，跳过。
      if (process.platform !== 'win32' && mode & 0o111) {
        chmodSync(abs(join(destRel, relative)), mode & 0o777);
      }
      files += 1;
      bytes += size;
      continue;
    }

    if (type === '2') {
      mkdirSync(dirname(abs(join(destRel, relative))), { recursive: true });
      try {
        symlinkSync(target, abs(join(destRel, relative)));
      } catch {
        // Windows 上建符号链接要额外权限；写成一份指路文件，不静默丢条目。
        writeFileSync(abs(join(destRel, relative)), target);
        console.warn(`[tar] 符号链接退化为普通文件：${relative} → ${target}`);
      }
      files += 1;
      continue;
    }

    if (type === '1') {
      console.warn(`[tar] 跳过硬链接条目：${relative} → ${target}`);
      continue;
    }

    console.warn(`[tar] 跳过未知条目类型 ${type}：${relative}`);
  }

  return { files, bytes };
}

// ---------------------------------------------------------------- 各来源

/**
 * 上游用 `package.json` 声明版本时，核对「锁文件写的那一版」与「解出来的那一版」。
 *
 * DeepTutor 用 `__version__.py`，OpenMAIC 用 `package.json` —— 两种都要能核，
 * 否则换一个上游就得复制一遍 `fetchDeeptutor`。没声明版本的上游直接跳过。
 */
function verifyDeclaredVersion(source, rootRel, expectedVersion) {
  if (!source.versionFile || !expectedVersion) return;
  const file = abs(`${rootRel}/${source.versionFile}`);
  if (!existsSync(file)) return;
  let declared;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    declared = source.versionField ? parsed?.[source.versionField] : parsed?.version;
  } catch {
    return;
  }
  if (declared && declared !== expectedVersion) {
    throw new Error(`版本不符：锁文件写 ${expectedVersion}，快照里是 ${declared}`);
  }
}

async function fetchDeeptutor(source) {
  const lock = readJson(source.lock);
  const upstream = lock.upstream ?? {};
  const url = `https://codeload.github.com/${repoPath(upstream.repository)}/tar.gz/${upstream.commit}`;
  const expected = upstream.archive?.sha256;

  log(source.id, `下载 ${url}`);
  const { body: archive, url: usedUrl } = await firstVerified(
    mirrorCandidates(url, mirrors),
    (body) => (expected && sha256(body) !== expected
      ? { ok: false, reason: `归档 SHA-256 不符：期望 ${expected}，实际 ${sha256(body)}` }
      : { ok: true }),
    { label: '归档下载', timeoutMs: TIMEOUT_OVERRIDE ?? source.timeoutMs, retries: RETRIES },
  );
  const actual = sha256(archive);
  if (expected && actual !== expected) throw new Error(`归档 SHA-256 不符：期望 ${expected}，实际 ${actual}`);
  log(source.id, `归档校验通过（sha256 ${actual.slice(0, 12)}…，${mb(archive.length)}）`);
  if (usedUrl !== url) log(source.id, `本次经镜像下载：${usedUrl}`);

  const stageRel = `${source.dest}.fetch-tmp`;
  rmSync(abs(stageRel), { recursive: true, force: true });
  const { files, bytes } = extractTar(gunzipSync(archive), { destRel: stageRel, strip: 1 });
  if (files === 0) throw new Error('归档解开后是空的，拒绝换入');

  const versionFile = `${stageRel}/deeptutor/__version__.py`;
  if (upstream.version && existsSync(abs(versionFile))) {
    const declared = /__version__\s*=\s*["']([^"']+)["']/.exec(readFileSync(abs(versionFile), 'utf8'))?.[1];
    if (declared && declared !== upstream.version) {
      throw new Error(`版本不符：锁文件写 ${upstream.version}，快照里是 ${declared}`);
    }
  }

  verifyDeclaredVersion(source, stageRel, upstream.version);

  // 归档哈希只证明「tarball 是那一份」；解包器自己也要自证没写错内容。
  const expectedTree = upstream.archive?.tree;
  if (expectedTree?.digest) {
    const staged = computeTreeDigest(stageRel);
    if (staged.digest !== expectedTree.digest) {
      throw new Error(`解包结果与锁文件的树摘要不符：期望 ${expectedTree.digest}，实际 ${staged.digest}`
        + `（${staged.files} 个文件；解包器可能有问题）`);
    }
    log(source.id, `树摘要校验通过（${staged.files} 个文件）`);
  }

  swapIn(source.id, stageRel, source.dest);
  log(source.id, `${files} 个文件，${mb(bytes)}，commit ${upstream.commit?.slice(0, 12)}`);
}

async function fetchBenchmarker(source) {
  const lock = readJson(source.lock);
  const base = `https://raw.githubusercontent.com/${repoPath(lock.repository)}/${lock.commit}`;
  const stageRel = `${source.dest}.fetch-tmp`;
  rmSync(abs(stageRel), { recursive: true, force: true });

  let count = 0;
  for (const [name, expected] of Object.entries(lock.files ?? {})) {
    const { body } = await firstVerified(
      mirrorCandidates(`${base}/${name}`, mirrors),
      (candidate) => (expected.sha256 && sha256(candidate) !== expected.sha256
        ? { ok: false, reason: `${name} 的 SHA-256 不符：期望 ${expected.sha256}，实际 ${sha256(candidate)}` }
        : { ok: true }),
      { label: `${name} 下载`, timeoutMs: TIMEOUT_OVERRIDE ?? source.timeoutMs, retries: RETRIES },
    );
    const target = abs(join(stageRel, name));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, body);
    count += 1;
  }
  if (count === 0) throw new Error('锁文件里没有文件条目，拒绝写出空快照');

  swapIn(source.id, stageRel, source.dest);
  log(source.id, `${count} 个文件，commit ${lock.commit?.slice(0, 12)}`);
}

function checkDeeptutor(source) {
  const lock = readJson(source.lock);
  const upstream = lock.upstream ?? {};
  if (!hasFiles(source.dest)) {
    log(source.id, '缺失 —— 运行 `npm run vendor:fetch`');
    return false;
  }

  const versionFile = `${source.dest}/deeptutor/__version__.py`;
  const declared = existsSync(abs(versionFile))
    ? /__version__\s*=\s*["']([^"']+)["']/.exec(readFileSync(abs(versionFile), 'utf8'))?.[1]
    : null;
  const versionOk = declared === upstream.version;

  const expected = upstream.archive?.tree;
  const tree = computeTreeDigest(source.dest);
  const runtimeNote = tree.excluded > 0 ? `，另有 ${tree.excluded} 个运行期产物（已忽略）` : '';

  if (!expected?.digest) {
    log(source.id, versionOk
      ? `${tree.files} 个文件，版本 ${declared} 与锁文件一致；**锁文件没有树摘要，未做内容校验**`
      : `${tree.files} 个文件，但版本 ${declared ?? '读不到'} 与锁文件的 ${upstream.version} 不一致`);
    return versionOk;
  }

  const algorithmOk = (expected.algorithm ?? TREE_ALGORITHM) === TREE_ALGORITHM;
  const treeOk = algorithmOk && tree.digest === expected.digest;

  if (!algorithmOk) {
    log(source.id, `锁文件的树摘要算法 ${expected.algorithm} 本脚本不认识（支持 ${TREE_ALGORITHM}）`);
  } else if (treeOk) {
    log(source.id, `${tree.files} 个文件，树摘要与锁文件一致，版本 ${declared}${runtimeNote}`);
  } else {
    log(source.id, `快照内容与锁文件不符：${tree.files} 个文件，树摘要 ${tree.digest.slice(0, 12)}…，`
      + `锁文件记的是 ${expected.digest.slice(0, 12)}…${runtimeNote}`);
    log(source.id, `若这是本地误改，用 \`npm run vendor:fetch -- --force --only ${source.id}\` 整目录重拉；`
      + `若确实换了上游，更新锁文件的 commit / version / archive.sha256 / archive.tree.digest`);
  }

  const countOk = !expected.files || tree.files === expected.files;
  if (!countOk) log(source.id, `文件数 ${tree.files} 与锁文件记的 ${expected.files} 不一致`);
  return versionOk && treeOk && countOk;
}

function checkBenchmarker(source) {
  const lock = readJson(source.lock);
  const problems = [];
  for (const [name, expected] of Object.entries(lock.files ?? {})) {
    const file = abs(join(source.dest, name));
    if (!existsSync(file)) { problems.push(`缺失 ${name}`); continue; }
    const actual = sha256(readFileSync(file));
    if (expected.sha256 && actual !== expected.sha256) problems.push(`哈希不符 ${name}`);
  }
  const total = Object.keys(lock.files ?? {}).length;
  if (problems.length === 0) {
    log(source.id, `${total} 个文件全部匹配锁文件`);
    return true;
  }
  log(source.id, `${problems.length}/${total} 处问题：${problems.slice(0, 3).join('；')}${problems.length > 3 ? ' …' : ''}`);
  return false;
}

async function main() {
  const sources = ONLY ? SOURCES.filter((source) => source.id === ONLY) : SOURCES;
  if (sources.length === 0) {
    console.error(`没有这个来源：${ONLY}（可选：${SOURCES.map((s) => s.id).join(' / ')}）`);
    process.exit(1);
  }

  if (!CHECK) {
    if (mirrors.length > 0) {
      console.log(`镜像：${mirrors.map((m) => m.prefix ?? m.template).join('、')}（失败时回落直连）`);
    } else if (MIRROR_SPEC && /^(none|direct|off|false|0)$/i.test(MIRROR_SPEC.trim())) {
      console.log('镜像：已按参数关闭，只走 GitHub 直连');
    } else if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy) {
      const hint = proxyHint();
      if (hint) console.warn(`[vendor] 提示：${hint}`);
    }
  }

  let failures = 0;
  for (const source of sources) {
    try {
      const present = hasFiles(source.dest);
      if (CHECK) {
        if (!(source.kind === 'archive' ? checkDeeptutor(source) : checkBenchmarker(source))) failures += 1;
        continue;
      }
      if (present && !FORCE) {
        log(source.id, `已存在（${countFiles(source.dest)} 个文件），跳过；加 --force 重新拉取，加 --check 只校验`);
        continue;
      }
      if (source.kind === 'archive') await fetchDeeptutor(source);
      else await fetchBenchmarker(source);
    } catch (error) {
      failures += 1;
      explainNetworkFailure(source.id, error);
      // 只清「没被换进去」的暂存树。已经 `swapIn` 成功的话，那份树已经在正式路径下
      // 了，这里删的是不存在的 `.fetch-tmp`，无副作用。
      rmSync(abs(`${source.dest}.fetch-tmp`), { recursive: true, force: true });
    }
  }
  process.exit(failures === 0 ? 0 : 1);
}

// 直接执行时跑全流程；被 import 时只提供下面导出的解析/下载原语（离线校验用）。
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

export {
  download,
  extractTar,
  repoPath,
  readJson,
  sha256,
  countFiles,
  RUNTIME_EXCLUDES,
  TREE_ALGORITHM,
};
