/**
 * 从智云课堂**重新拉取原始课件图片 + 字幕**，落成本地基准素材。
 *
 * # 为什么必须重拉，而不是从已有产物里抽
 *
 * 已有产物里只有 **vision 转述后的文本**（`pageText` / `pageVisual`），
 * 那不是"原稿"——它是**模型对原稿的解读**。拿它当基准输入，测的是
 * "复现上一次模型的解读"，而不是"这条链路在原始材料上的表现"。
 *
 * 更关键的是：产物里连图片引用都**没有留**（`pages[]` 里只有 `transcription`
 * 与 `failure`，没有 attachment id / URL）。所以想拿到原稿，只能回源头重下。
 *
 * # 做法
 *
 * 走产品自己的入口 —— `dsh-zhiyun-source-classroom` 的 `downloadSlides()`，
 * 它已封装好"登录 → 列出课件 → 按页下载 → 命名"的全套（含并发与大小限制）。
 * 基准只负责把结果落进 `data/`。
 *
 * # 凭据
 *
 * 默认读宿主 profile 里的课堂账号（与产品同一条读取路径）。
 * 也可以用环境变量显式给：
 *
 *     BENCH_ZJU_USER / BENCH_ZJU_PASS
 *
 * 用法：
 *
 *     node scripts/knowledge_tree_bench/fetch-raw.mjs --course 87882 --section 1973145
 *     node scripts/knowledge_tree_bench/fetch-raw.mjs            # 拉 .runtime 里记录过的全部节
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const ROOT = path.resolve(HERE, '..', '..');
const DATA = path.join(HERE, 'data');
const RUNTIME_STORE = path.join(ROOT, '.runtime', 'home', 'storages', 'zhiyun_knowledge.json');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const has = (name) => process.argv.includes(`--${name}`);

async function main() {
  const { mountCampus, mount, memoryCredentials, serviceOf } = await import('./_base.mjs');
  const { setRoot } = await import('./_base.mjs');
  setRoot(ROOT + path.sep);

  // ── 要拉哪几节 ────────────────────────────────────────────────
  const courseArg = arg('course');
  const sectionArg = arg('section');
  let targets = [];
  if (courseArg && sectionArg) {
    targets = [{ courseId: courseArg, subId: sectionArg }];
  } else {
    // 默认：`.runtime` 里已经有产物记录的那几节（说明用户真跑过、值得留档）
    const store = JSON.parse(await fs.readFile(RUNTIME_STORE, 'utf8')).tables.lectures;
    targets = Object.values(store).map((r) => ({ courseId: r.courseId, subId: r.subId, title: r.title, status: r.status }));
  }

  // ── 登录 ──────────────────────────────────────────────────────
  const creds = memoryCredentials();
  const account = process.env.BENCH_ZJU_USER && process.env.BENCH_ZJU_PASS
    ? { username: process.env.BENCH_ZJU_USER, password: process.env.BENCH_ZJU_PASS }
    : await readAccountFromProfile();
  if (!account) {
    console.error('没有课堂账号：请在 profile 里登录过，或设 BENCH_ZJU_USER / BENCH_ZJU_PASS。');
    process.exitCode = 1;
    return;
  }

  const workDir = path.join(DATA, '.session') + path.sep;
  await fs.mkdir(workDir, { recursive: true });
  await mountCampus({ dataDir: path.join(workDir, 'campus') + path.sep, credentials: creds.service });
  const mounted = await mount('dsh-zhiyun-source-classroom', { dataDir: workDir, credentials: creds.service });
  const classroom = serviceOf(mounted, 'zhiyunClassroom');

  console.log('登录智云课堂…');
  await classroom.login(account);
  console.log('已登录。');

  await fs.mkdir(DATA, { recursive: true });
  const index = [];

  for (const target of targets) {
    const key = `${target.courseId}-${target.subId}`;
    const dir = path.join(DATA, key);
    await fs.mkdir(dir, { recursive: true });
    console.log(`\n── ${key} ${target.title ?? ''}`);

    // 课件图片（**这就是最原始的原稿**）
    const slides = await classroom.downloadSlides(target.courseId, target.subId, {
      directory: dir,
      concurrency: 4,
      onProgress: ({ completed, total }) => {
        if (completed === total || completed % 20 === 0) process.stdout.write(`   下载 ${completed}/${total}\r`);
      },
    });
    process.stdout.write('\n');
    console.log(`   课件：成功 ${slides.succeeded} / 失败 ${slides.failed}`);

    // 字幕（原始时间轴与文本）
    const content = await classroom.getLessonContent(target.courseId, target.subId);
    const subtitles = content.subtitles.items.map((s) => ({ startMs: s.startMs, endMs: s.endMs, text: s.text }));
    await fs.writeFile(path.join(dir, 'subtitles.json'), JSON.stringify(subtitles, null, 1));

    // 页序清单：把下载到的文件与页码对应起来（图片是原稿，页号是唯一身份）
    const files = (await fs.readdir(dir)).filter((n) => /\.(jpg|jpeg|png)$/i.test(n)).sort();
    const pages = slides.results.filter((r) => r.ok).map((r, i) => ({
      page: r.page,
      file: files[i] ?? null,
      createdSec: content.slides.items.find((s) => s.page === r.page)?.createdSec ?? null,
    }));
    await fs.writeFile(path.join(dir, 'pages.json'), JSON.stringify({ sourceId: content.sourceId, pages }, null, 1));

    index.push({
      key,
      title: target.title ?? null,
      courseId: target.courseId,
      subId: target.subId,
      sourceId: content.sourceId,
      slides: { ok: slides.succeeded, failed: slides.failed },
      subtitles: subtitles.length,
      pages: pages.length,
    });
  }

  await fs.writeFile(path.join(DATA, 'manifest.json'), JSON.stringify({
    note: '智云课堂的**原始材料**：课件图片 + 字幕 + 页序。不是 vision 转述稿。',
    fetchedAt: new Date().toISOString(),
    sections: index,
  }, null, 1));

  await classroom.dispose?.().catch(() => {});
  console.log(`\n写入 ${path.relative(ROOT, DATA)}/`);
}

/**
 * 从宿主 profile 的凭据文件里读课堂账号。
 *
 * ⚠️ 这是**唯一**一处读 `.credentials.yaml` 的地方，且只读
 *    `zhiyun-classroom/account` 那一条 —— 值与产品登录用的是同一份。
 *    读不到就如实返回 null（由调用方报"请先登录"），不做任何猜测。
 */
async function readAccountFromProfile() {
  const file = path.join(ROOT, '.runtime', 'home', '.credentials.yaml');
  try {
    const text = await fs.readFile(file, 'utf8');
    // 这个文件是 YAML，但结构固定且只取两个标量；用行扫描避免为一个字段引入 yaml 依赖。
    const lines = text.split(/\r?\n/);
    let inClassroom = false, username = null, password = null;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('zhiyun-classroom/account:')) { inClassroom = true; continue; }
      // 同级的下一条 record 出现就说明离开了这一段
      if (inClassroom && /^ {2}[a-zA-Z][\w-]*\/[\w-]+:/.test(line)) { inClassroom = false; continue; }
      if (!inClassroom) continue;
      const match = trimmed.match(/^(username|password):\s*(.+)$/);
      if (!match) continue;
      const value = match[2].trim().replace(/^['"]|['"]$/g, '');
      if (!value) continue;
      if (match[1] === 'username') username = value;
      else password = value;
    }
    return username && password ? { username, password } : null;
  } catch { return null; }
}

main().catch((error) => {
  console.error(String(error?.stack ?? error).slice(0, 2000));
  process.exitCode = 1;
});
