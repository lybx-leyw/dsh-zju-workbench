// 「文档」页的守卫测试。
//
// 这一页有**两个**真源：`docs-manifest.js`（目录清单）与 `docs-content.js`（把
// markdown 变成模块的 import 表）。两者不对齐时不会构建失败 —— 页面只是显示
// "这一篇暂时读不到"。这类缺口只能靠测试盯住。
//
// 另外两件事也在这里守：
//   - `outline.js` 的扫描规则必须**跳过围栏代码块**。页内目录是按"第几个标题"
//     跳转的，扫描器多认一个标题，之后每一条跳转都会偏移一格。
//   - 内置文档里**不许出现**个人凭证或本地绝对路径。这个仓库是公开的，而文档页
//     恰好是最容易顺手贴一句"我的路径是 C:\Users\..."的地方。
//
// 全部用裸 Node 跑：不构建、不启动宿主、不连网。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { SECTIONS, DEFAULT_PAGE } from '../packages/dsh-zhiyun-page-docs/src/docs-manifest.js';
import {
  OUTLINE_DEPTHS, filterPages, flattenPages, neighbors, plainHeading, scanHeadings, stripHeading1,
} from '../packages/dsh-zhiyun-page-docs/src/outline.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const pkg = join(root, 'packages', 'dsh-zhiyun-page-docs');

const FLAT = flattenPages(SECTIONS);

/** 读 `docs-content.js` 的源码 —— 它是 import 表，不能直接 import 进来（会带上 .md）。 */
async function contentSource() {
  return readFile(join(pkg, 'src', 'docs-content.js'), 'utf8');
}

/** 读一篇内置文档的原文。 */
async function readDoc(file) {
  return readFile(join(pkg, 'src', 'docs', file), 'utf8');
}

// ---------------------------------------------------------------- 清单与模块

test('清单里的每一篇都有对应的 markdown 文件，且被 docs-content 引入', async () => {
  const source = await contentSource();
  for (const page of FLAT) {
    const markdown = await readDoc(page.file);
    assert.ok(markdown.trim().length > 0, `${page.file} 是空的`);
    // `docs-content.js` 里必须出现这个 id 作为键（`PAGE_CONTENT` 的短写法 `overview,`）。
    const keyed = new RegExp(`[{,\\s]${page.id}\\s*[,}]`).test(source.replace(/^import .*$/gm, ''));
    assert.ok(keyed, `docs-content.js 的 PAGE_CONTENT 里没有 ${page.id}`);
    // 也要真的 import 了这个文件。
    assert.ok(source.includes(`./docs/${page.file}`), `docs-content.js 没有 import ./docs/${page.file}`);
  }
});

test('清单 id 唯一，且都不含「规划」（Ctrl+K 的守卫别名）', () => {
  const ids = FLAT.map(page => page.id);
  assert.equal(new Set(ids).size, ids.length, '清单里有重复的 id');
  for (const page of FLAT) {
    // tests/profile.test.mjs 断言 matchingPages('规划') 只命中问一问与规划。
    assert.ok(!`${page.title} ${page.summary}`.includes('规划'),
      `「${page.title}」的标题或摘要含「规划」，会污染 matchingPages 守卫`);
    // id 要能被 'zhiyun.<id>.content' 的正则匹配到（只认小写字母）。
    assert.match(page.id, /^[a-z]+$/);
  }
});

test('默认页在清单里', () => {
  assert.ok(FLAT.some(page => page.id === DEFAULT_PAGE), `DEFAULT_PAGE=${DEFAULT_PAGE} 不在清单里`);
});

test('页脚出处是字符串；默认那句会把读者引到仓库文档', async () => {
  // 页脚按 `current.source ?? DEFAULT_SOURCE` 取。写了 source 却又不是字符串，
  // 页面上会渲染出 `[object Object]`；而口述整理的那篇若沿用默认文案，
  // 读者会去 `docs/contributing/` 里翻一份根本不存在的原文。
  for (const page of FLAT) {
    if (page.source === undefined) continue;
    assert.equal(typeof page.source, 'string', `${page.id} 的 source 不是字符串`);
    assert.ok(page.source.trim() !== '', `${page.id} 的 source 是空串`);
    assert.ok(!page.source.includes('摘写自'), `${page.id} 覆盖了 source 却又沿用了默认文案`);
  }
  // 至少有一篇用默认文案 —— 否则 DEFAULT_SOURCE 就是死代码。
  assert.ok(FLAT.some(page => page.source === undefined));
  // 口述整理的那篇必须有自定义出处。
  const vibe = FLAT.find(page => page.id === 'vibe');
  assert.ok(vibe, '清单里没有 vibe 这篇');
  assert.equal(typeof vibe.source, 'string', 'vibe 是口述整理的一篇，必须自带 source');
});

test('每篇文档的 h1 与清单标题一致', async () => {
  for (const page of FLAT) {
    const markdown = await readDoc(page.file);
    const firstLine = markdown.replace(/^\uFEFF/, '').split(/\r?\n/).find(line => line.trim() !== '');
    assert.ok(firstLine !== undefined, `${page.file} 没有内容`);
    assert.equal(firstLine.trim(), `# ${page.title}`,
      `${page.file} 的第一个非空行应是 "# ${page.title}"（页面会把这一行摘掉，标题由页头画）`);
  }
});

test('每篇文档都有 h2，否则右目录整栏不出现', async () => {
  for (const page of FLAT) {
    const markdown = await readDoc(page.file);
    const headings = scanHeadings(markdown);
    assert.ok(headings.length >= 2,
      `${page.file} 只有 ${headings.length} 个 h2/h3；少于 2 个时右目录整栏不显示，版式会空一块`);
  }
});

// ---------------------------------------------------------------- 扫描器

test('围栏代码块里的 ## 不算标题', () => {
  const markdown = ['# 甲', '```bash', '## 这是注释不是标题', '```', '## 真标题'].join('\n');
  assert.deepEqual(scanHeadings(markdown), [{ depth: 2, text: '真标题' }]);
});

test('波浪线围栏、四反引号围栏、列表内缩进围栏都跳过', () => {
  const markdown = [
    '~~~md', '## 甲', '~~~',
    '````js', '```', '## 乙', '````',
    '   ```', '   ## 丙', '   ```',
    '## 丁',
  ].join('\n');
  assert.deepEqual(scanHeadings(markdown), [{ depth: 2, text: '丁' }]);
});

test('未闭合的围栏一直吃到文件尾（与渲染器一致）', () => {
  const markdown = ['## 甲', '```', '## 乙'].join('\n');
  assert.deepEqual(scanHeadings(markdown), [{ depth: 2, text: '甲' }]);
});

test('只收 OUTLINE_DEPTHS 里的级别', () => {
  const markdown = ['# 一', '## 二', '### 三', '#### 四'].join('\n');
  assert.deepEqual(scanHeadings(markdown).map(item => item.depth), [2, 3]);
  assert.deepEqual(OUTLINE_DEPTHS, [2, 3]);
  // 传自定义级别时只收指定的。
  assert.deepEqual(scanHeadings(markdown, [4]).map(item => item.depth), [4]);
});

test('去掉行内记号，留下可读文字', () => {
  assert.equal(plainHeading('**加粗**与 `代码` 与 [链接](http://x)'), '加粗与 代码 与 链接');
  assert.equal(plainHeading('~~删除~~ _斜体_'), '删除 斜体');
  // 结尾的一串 # 是装饰。
  assert.deepEqual(scanHeadings('## 标题 ##'), [{ depth: 2, text: '标题' }]);
});

test('空标题不进目录', () => {
  assert.deepEqual(scanHeadings('##\n## 真'), [{ depth: 2, text: '真' }]);
});

test('CRLF 与 BOM 不影响扫描', () => {
  const markdown = '\uFEFF## 甲\r\n\r\n## 乙\r\n';
  assert.deepEqual(scanHeadings(markdown).map(item => item.text), ['甲', '乙']);
});

test('非字符串输入返回空数组，不抛', () => {
  assert.deepEqual(scanHeadings(null), []);
  assert.deepEqual(scanHeadings(undefined), []);
});

// ---------------------------------------------------------------- 摘掉 h1

test('stripHeading1 只摘开头那个 h1', () => {
  assert.equal(stripHeading1('# 标题\n\n正文'), '正文');
  // 正文中间的 h1 保留（那是作者的分节意图）。
  assert.equal(stripHeading1('# 标题\n\n## 节\n\n# 中间\n'), '## 节\n\n# 中间');
  // 没有 h1 时原样返回。
  assert.equal(stripHeading1('正文\n\n## 节'), '正文\n\n## 节');
  // 开头的空行先跳过。
  assert.equal(stripHeading1('\n\n# 标题\n\n正文'), '正文');
  // 以 ## 开头不算 h1。
  assert.equal(stripHeading1('## 节\n\n正文'), '## 节\n\n正文');
});

test('stripHeading1 之后每一篇都不再以 h1 开头', async () => {
  for (const page of FLAT) {
    const body = stripHeading1(await readDoc(page.file));
    assert.ok(!/^# /.test(body), `${page.file} 摘掉 h1 后仍以 "# " 开头`);
    assert.ok(body.trim() !== '', `${page.file} 摘掉 h1 后是空的`);
  }
});

// ---------------------------------------------------------------- 翻页

test('翻页跨分区连着走，首末页各少一个方向', () => {
  const first = neighbors(FLAT, FLAT[0].id);
  assert.equal(first.prev, null);
  assert.equal(first.next.id, FLAT[1].id);

  const last = neighbors(FLAT, FLAT[FLAT.length - 1].id);
  assert.equal(last.next, null);
  assert.equal(last.prev.id, FLAT[FLAT.length - 2].id);

  // 分区边界不断链：「入门」最后一篇的下一篇是「协作」第一篇。
  const startLast = SECTIONS[0].pages.at(-1);
  assert.equal(neighbors(FLAT, startLast.id).next.id, SECTIONS[1].pages[0].id);
});

test('找不到的 id 返回 -1 与两个 null', () => {
  const result = neighbors(FLAT, 'does-not-exist');
  assert.deepEqual(result, { prev: null, next: null, index: -1 });
});

test('flattenPages 给每页标上所属分区与序号', () => {
  assert.equal(FLAT.length, SECTIONS.reduce((sum, item) => sum + item.pages.length, 0));
  assert.deepEqual(FLAT.map(page => page.index), FLAT.map((_, index) => index));
  for (const page of FLAT) {
    const section = SECTIONS.find(item => item.id === page.sectionId);
    assert.ok(section !== undefined, `${page.id} 的 sectionId 不在 SECTIONS 里`);
    assert.ok(section.pages.some(item => item.id === page.id));
  }
});

// ---------------------------------------------------------------- 筛选

test('空关键词返回全部；匹配标题与摘要', () => {
  assert.equal(filterPages('', FLAT).length, FLAT.length);
  assert.equal(filterPages('   ', FLAT).length, FLAT.length);
  // 标题命中
  assert.deepEqual(filterPages('Owner', FLAT).map(page => page.id), ['owners']);
  // 摘要命中但标题不含该词
  const bySummary = filterPages('许可证', FLAT);
  assert.deepEqual(bySummary.map(page => page.id), ['attribution']);
  // 无命中
  assert.deepEqual(filterPages('这个词一定不存在', FLAT), []);
});

test('筛选不区分大小写，容忍前后空格', () => {
  assert.deepEqual(filterPages('  owner  ', FLAT).map(page => page.id), ['owners']);
});

// ---------------------------------------------------------------- 规则措辞

test('推送与合并的措辞跟着仓库规则走：推送要请示，合并不用自己管', async () => {
  // 仓库原文的口径（docs/contributing/AGENTS.md「提交与推送」）：
  //   **提交与推送前必须先和用户确认，不得擅自提交。**
  // 这条容易被写成"推送不必请示"，是把推送和合并混成了一件事。所以钉死：
  //   1. 推送必须写"先确认"，且不许出现"不必先请示"这类反向说法；
  //   2. 仓库各篇**不谈合并**：合并的建议只写在 vibe 篇里；
  //   3. 写了合并的地方只能给"建议等项目维护者执行"，不能写成自己可以做。
  const privacy = await readDoc('privacy.md');
  const vibe = await readDoc('vibe.md');
  const owners = await readDoc('owners.md');

  // 1. 推送要请示。
  assert.match(privacy, /提交与推送前必须先和用户确认/, '隐私篇没写"提交与推送前必须先和用户确认"');
  assert.match(vibe, /提交与推送前必须先和用户确认/, 'vibe 篇没写"提交与推送前必须先和用户确认"');
  for (const [name, text] of [['隐私篇', privacy], ['vibe 篇', vibe], ['owners 篇', owners]]) {
    assert.ok(!/推送(本身)?(并)?不需要(事先)?请示/.test(text), `${name}出现了"推送不必请示"`);
    assert.ok(!/推送前不需要/.test(text), `${name}出现了"推送前不需要确认"`);
  }

  // 2. 合并只建议、不自己做。
  assert.match(vibe, /不必合并/, 'vibe 篇要说明开 PR 就够了、不必合并');
  assert.match(vibe, /项目维护者/, 'vibe 篇要把合并建议引导到项目维护者');
  assert.ok(!/合并留给仓库负责人/.test(privacy), '隐私篇不该再谈合并（合并的建议只在 vibe 篇）');
  assert.ok(!/合并不许自己做/.test(privacy), '隐私篇不该再谈合并（合并的建议只在 vibe 篇）');

  // 3. 「Owner 机制」讲目录归属，不掺合并权。
  assert.match(owners, /按目录划分|每个目录由一份/, 'owners 篇没说明 OWNERS 是按目录划分的');
  assert.ok(!/合并/.test(owners), 'owners 篇不该谈合并');
});

test('内置文档里没有本地绝对路径或个人凭证', async () => {
  // 这一页会把内容原样推到公开仓库，所以撤写时就按公开标准检查。
  const forbidden = [
    // 带用户名的本地绝对路径（文档里只允许 C:\Users\me\ 这类占位符）。
    //
    // 三条都要**用户名段真的存在**才判命中：`.runtime/home/` 这种相对路径里有 `/home/`，
    // 但它不是绝对路径、也不带用户名。早先写成「看到 /home/ 就报」，结果把
    // 「`.runtime/home/` 保存真实数据」这一句当成了泄露 —— 误报比漏报更麻烦，
    // 它会让这条守卫被加进豁免名单，然后就再也不起作用了。
    /[A-Za-z]:\\Users\\(?!me\\|<)[^\\/\s`]+/,
    /\/Users\/(?!me\/|<)[^/\s`]+/,
    /(?<![.\w])\/home\/(?!me\/|<)[^/\s`]+/,
    // 学号（浙大学号是 10 位数字，但任何 8 位以上的连续数字串都不该出现在文档里）。
    /\b\d{8,}\b/,
    // 常见凭据形状。
    /\bBearer\s+[A-Za-z0-9._-]{12,}/,
    /\bsk-[A-Za-z0-9]{16,}/,
  ];
  for (const page of FLAT) {
    const markdown = await readDoc(page.file);
    for (const pattern of forbidden) {
      const hit = pattern.exec(markdown);
      assert.equal(hit, null,
        `${page.file} 命中了隐私红线 ${pattern}：${hit?.[0]}`);
    }
  }
});

test('内置文档只提 GitHub 用户名，不提真实姓名', async () => {
  // 仓库约定：组员之间用 GitHub 账号指代。文档里出现的中文人名会在这里被抓到。
  const allowedHandles = ['lybx-leyw'];
  for (const page of FLAT) {
    const markdown = await readDoc(page.file);
    for (const handle of allowedHandles) {
      // 允许出现（这是公开的 GitHub 用户名），只是确认它是以账号形式出现的。
      if (markdown.includes(handle)) assert.match(markdown, /@?lybx-leyw/);
    }
  }
});

// ---------------------------------------------------------------- 包形态

test('包声明与接线清单四处对齐', async () => {
  const manifest = JSON.parse(await readFile(join(pkg, 'package.json'), 'utf8'));

  // 1. 有浏览器半边就必须有 exports["./client"]，否则宿主拒启整个工作台。
  assert.ok(manifest.dsh?.client, 'package.json 缺少 dsh.client 声明');
  assert.equal(manifest.exports['./client'], './lib/client.js');

  // 2. 宿主半边入口存在（空壳也算）。
  assert.equal(manifest.main, './src/index.js');
  assert.ok((await readFile(join(pkg, 'src', 'index.js'), 'utf8')).includes("'zhiyun-page-docs'"));

  // 3. cordis.patch.yml 指向正确的 id。
  const patch = await readFile(join(pkg, 'cordis.patch.yml'), 'utf8');
  assert.match(patch, /id: zhiyun-page-docs/);
  assert.match(patch, /name: dsh-zhiyun-page-docs/);

  // 4. 进构建清单与 profile 装载清单（这两条 plugins-page.test.mjs 也查，
  //    但那边是扫包目录，这里是本包自证，失败时的报错更近）。
  const build = await readFile(join(root, 'scripts', 'build.mjs'), 'utf8');
  assert.ok(build.includes("'dsh-zhiyun-page-docs'"), 'scripts/build.mjs 的 CLIENT_PACKAGES 里没有本包');
  assert.match(build, /'\.md':\s*'text'/,
    'scripts/build.mjs 的 loader 表里没有 .md —— 正文会被当成无法识别的文件类型');

  const profile = JSON.parse(await readFile(
    join(root, 'profiles', 'zhiyun-bench', 'package.json'), 'utf8'));
  assert.ok(profile.dsh.profile.bundles.includes('dsh-zhiyun-page-docs'),
    'profiles/zhiyun-bench/package.json 的 bundles 里没有本包');
});

test('client.jsx 用的插槽名与 NAV 里的 id 一致', async () => {
  const client = await readFile(join(pkg, 'src', 'client.jsx'), 'utf8');
  // plugins-page.test.mjs 用 /'zhiyun\.([a-z]+)\.content'/ 扫这个字面量，
  // 只认小写字母 —— 所以这里也按那个形状断言。
  assert.match(client, /'zhiyun\.([a-z]+)\.content'/);
  const id = /'zhiyun\.([a-z]+)\.content'/.exec(client)[1];
  assert.equal(id, 'docs');

  const model = await readFile(
    join(root, 'packages', 'dsh-zhiyun-shell-workbench', 'src', 'model.js'), 'utf8');
  assert.ok(model.includes(`id: '${id}'`), `model.js 的 NAV 里没有 id: '${id}'`);
  // 整幅铺开的页要进 FULL_BLEED_PAGES，否则会套上 980px 版心，三栏被挤成一条缝。
  assert.match(model, /FULL_BLEED_PAGES = Object\.freeze\(\[[^\]]*'docs'/);
});
