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
 * 拉取一律先写到 `<dest>.fetch-tmp`，校验通过后再换到正式位置；中途失败不会留下
 * 半份快照，也不会动到原有的那份。
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync, chmodSync } from 'node:fs';
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
  },
  {
    id: 'benchmarker',
    kind: 'files',
    lock: 'scripts/quiz_bench/evaluators/vendor.lock.json',
    dest: 'scripts/quiz_bench/evaluators/vendor/benchmarker',
  },
];

const args = new Set(process.argv.slice(2));
const flagValue = (name) => {
  const at = process.argv.indexOf(name);
  return at === -1 ? null : process.argv[at + 1] ?? null;
};
const FORCE = args.has('--force');
const CHECK = args.has('--check');
const ONLY = flagValue('--only');

/** Windows 上上游快照的路径会超过 MAX_PATH，落盘一律走扩展路径。 */
function abs(relPath) {
  const full = resolve(ROOT, relPath);
  return process.platform === 'win32' ? `\\\\?\\${full.replaceAll('/', '\\')}` : full;
}

const readJson = (relPath) => JSON.parse(readFileSync(abs(relPath), 'utf8'));
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

function log(source, message) {
  console.log(`[${source}] ${message}`);
}

async function download(url, { attempts = 3 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { redirect: 'follow' });
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((done) => setTimeout(done, 500 * attempt));
    }
  }
  throw new Error(`下载失败：${url}（${lastError?.message ?? lastError}）`);
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
function swapIn(source, stageRel, destRel) {
  const retired = `${destRel}.fetch-old`;
  rmSync(abs(retired), { recursive: true, force: true });
  if (existsSync(abs(destRel))) renameSync(abs(destRel), abs(retired));
  try {
    renameSync(abs(stageRel), abs(destRel));
  } catch (error) {
    if (existsSync(abs(retired))) renameSync(abs(retired), abs(destRel));
    throw error;
  }
  rmSync(abs(retired), { recursive: true, force: true });
  log(source, `已写入 ${destRel}`);
}

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

async function fetchDeeptutor(source) {
  const lock = readJson(source.lock);
  const upstream = lock.upstream ?? {};
  const url = `https://codeload.github.com/${repoPath(upstream.repository)}/tar.gz/${upstream.commit}`;
  log(source.id, `下载 ${url}`);
  const archive = await download(url);

  const expected = upstream.archive?.sha256;
  const actual = sha256(archive);
  if (expected && actual !== expected) {
    throw new Error(`归档 SHA-256 不符：期望 ${expected}，实际 ${actual}`);
  }
  log(source.id, `归档校验通过（sha256 ${actual.slice(0, 12)}…，${mb(archive.length)}）`);

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
    const body = await download(`${base}/${name}`);
    const actual = sha256(body);
    if (expected.sha256 && actual !== expected.sha256) {
      throw new Error(`${name} 的 SHA-256 不符：期望 ${expected.sha256}，实际 ${actual}`);
    }
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
  const files = countFiles(source.dest);
  const versionFile = `${source.dest}/deeptutor/__version__.py`;
  const declared = existsSync(abs(versionFile))
    ? /__version__\s*=\s*["']([^"']+)["']/.exec(readFileSync(abs(versionFile), 'utf8'))?.[1]
    : null;
  const ok = declared === upstream.version;
  log(source.id, ok
    ? `${files} 个文件，版本 ${declared} 与锁文件一致`
    : `${files} 个文件，但版本 ${declared ?? '读不到'} 与锁文件的 ${upstream.version} 不一致`);
  return ok;
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
      console.error(`[${source.id}] 失败：${error?.message ?? error}`);
      rmSync(abs(`${source.dest}.fetch-tmp`), { recursive: true, force: true });
    }
  }
  process.exit(failures === 0 ? 0 : 1);
}

// 直接执行时跑全流程；被 import 时只提供下面导出的解析/下载原语（离线校验用）。
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

export { download, extractTar, repoPath, readJson, sha256 };
