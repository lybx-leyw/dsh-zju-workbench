/**
 * dsh-radar-dom-parse —— 候选骨架，**未评审、未接入 profile、不可直接使用**。
 *
 * 本文件是**占位**，只标注适配点与 TODO，不写业务逻辑。
 * 待人工评审通过后，再把 TODO 逐条落实；评审驳回则整个包删除。
 *
 * ── 这个包想做什么 ───────────────────────────────────────────────
 *
 * 把「智云课堂」两处**手写正则抠 HTML** 的地方，换成 `cheerio@1.2.0`（`./slim` 入口）的
 * **HTML 级解析 + CSS 选择器**：
 *
 *   (a) `packages/dsh-zhiyun-classroom/src/auth.js` 的 `executionToken(html)` ——
 *       从 CAS 登录页里取 `<input name="execution">` 的 value；
 *   (b) 同一文件 `nextLocation()` 里的 `<meta http-equiv="refresh">` 解析（次要，见 TODO-3）。
 *
 * 课表/课件页目前**没有** HTML 解析（数据是 JSON），所以本包的适用面就是登录链路 ——
 * 窄，但**每次登录都会走**，且失败方式是「登录页缺少 execution」→ 直接无法登录。
 *
 * ── 为什么是「强化式集成」而不是简单集成（三条同时成立）─────────────
 *
 *   1. **仍是同一个面板** —— 不新增页面、不新增导航项；改的是登录链路的内部实现，
 *      用户看到的是同一个登录框、同一个结果。
 *   2. **功能仍相似正交** —— 都回答「这一页里那个 hidden 字段的值是什么」；
 *      旧实现答「用正则扫一眼标签文本」，新层答「按属性选择器取 DOM 属性」。
 *   3. **底层多调了更优质实现** —— 见下面「现场证据」，两个反例都可复现。
 *
 * 缺任何一条都只能算重复集成，应当拒绝。
 *
 * ── 现场证据（2026-10-20 实测，`cheerio@1.2.0` + `linkedom@0.18.13` 对照）────────
 *
 * 把本仓 `auth.js` 的 `executionToken()` 原样复制进夹具（不改一行），对同一批 HTML 跑：
 *
 *   | 夹具（合法 HTML）                                   | 本仓正则        | cheerio/slim |
 *   | ---                                                 | ---             | ---          |
 *   | `<input name="execution" value="e1s1"/>`            | `"e1s1"`        | `"e1s1"`     |
 *   | `<input value="a>b" name="execution">`（value 含 `>`） | **`undefined`** | `"a>b"`      |
 *   | `<input name="execution" value="abc&amp;def">`       | `"abc&amp;def"` | `"abc&def"`  |
 *   | `<input value="e2s1" type="hidden" name="execution">` | `"e2s1"`        | `"e2s1"`     |
 *
 * 第 2 行是**真断点**：`executionToken()` 返回 `undefined` → `submitCasForm()` 抛
 * `AUTH_SHAPE: 登录页缺少 execution` → **登录直接失败**，而日志里看起来像「官网改版了」。
 * 根因是正则 `/<input\b[^>]*>/` 用 `[^>]*` 界定标签边界，value 里一个合法的 `>` 就提前截断。
 *
 * 第 3 行是**静默错值**：`value` 带着 `&amp;` 原样进 `URLSearchParams`，
 * 上游收到的是双重转义。CAS 的 execution 通常是 `e1s1` 形态，所以现在没炸 —— 属于
 * 「今天不炸、改版就炸」的那一类。
 *
 * 对照 `linkedom@0.18.13`：能力等价、体积更大（275 KB vs 200 KB），**且大小写属性名行为不同**
 * （`NAME="execution"` 时 `querySelector('input[name=execution]')` 匹配不到，
 * cheerio 能匹配）。这条差异是本轮选 cheerio 的实证依据，不是偏好。
 *
 * ── 集成方式（B 类：能力提取 + 封装）──────────────────────────────
 *
 *   ❌ 不改上游源码（`cheerio` 只作为依赖引入，且只走 `./slim`）。
 *   ❌ **不改 `auth.js` 的对外契约** —— `executionToken()` / `nextLocation()` 的签名、
 *      返回类型、抛错码（`AUTH_SHAPE` / `AUTH_REDIRECT`）全部不变。本包只提供**实现**，
 *      调用点是否替换由评审决定。
 *   ✅ 本包只做一件事：**把一段 HTML 字符串变成一个可查询的 DOM**，并暴露两个纯函数。
 *      **不发请求、不读文件、不碰 cookie** —— 那是 transport 的职责。
 *
 * ── TODO（评审通过后再动）────────────────────────────────────────
 *
 *   [ ] TODO-0（**先确认这个再谈接入**）：`auth.js` 属于 `packages/dsh-zhiyun-classroom`，
 *       是**已上线**的包。替换其内部实现前必须确认：
 *       (i) 本包以**依赖**形式被 classroom 引入（而不是 classroom 反过来依赖本骨架）；
 *       (ii) `tests/classroom.test.mjs` 里 `executionToken` 的既有断言仍通过
 *       （`<input value='secret-token' name='execution'>` → `'secret-token'`）；
 *       (iii) 不改变 `executionToken()` 在「找不到」时返回 `null`（不是 `undefined`）的现状 ——
 *       现有 `submitCasForm()` 用 `if (!execution)` 判空，`undefined` 也能过，但**返回类型变了**
 *       属于契约变更，须写进 PR 说明。
 *   [ ] TODO-1：`parse(html)` 封装 —— `load(html, { xmlMode: false })`；**不得**传
 *       `scriptingEnabled`（默认即可）、**不得**开 `decodeEntities: false`（实体必须解码）。
 *   [ ] TODO-2：`executionToken(html)` 的替换实现 —— `$('input[name="execution"]').attr('value') ?? null`。
 *       属性名大小写由 HTML 解析器统一为小写（HTML 规范行为），因此 `NAME=` / `Name=` 都能命中；
 *       `null` 兜底与原实现一致。
 *   [ ] TODO-3（**可延后**）：`nextLocation()` 的 meta refresh 解析。现状是
 *       `/<meta\b[^>]*>/gi` + `content?.match(/url\s*=\s*(.+)$/i)`，对
 *       `content="5; url=/x"` 这种带前导数字的写法**没有处理**（会拿去 `new URL('5; url=/x')` 然后抛）。
 *       cheerio 版应按 `http-equiv=refresh` 选择 → 取 `content` → 再按 `/\burl\s*=\s*(.+)$/i` 取。
 *       ⚠ **这是行为变更**（原来抛错、现在可能成功跳转），必须单独评审，不能和 TODO-2 混一个 PR。
 *   [ ] TODO-4：`scripts/` 里若另有 HTML 处理（本轮 grep 未发现第二处），按同一封装改；
 *       本轮实测本仓 `.js` 里只有 `auth.js:28` 一处正则抠标签。
 *   [ ] TODO-5：体积 —— 实测 esbuild（minify / ESM / browser）**`cheerio/slim` = 199,966 B**，
 *       `cheerio`（包根）= 384,451 B，`linkedom` = 275,245 B。这是**未 gzip** 的 bundle 值；
 *       gzip 后需复测（TODO-5 的验收线：gzip < 70 KB 才可进客户端；
 *       若只用于服务端则可放宽，因为不进首屏）。
 *   [ ] TODO-6：补 `tests/radar-dom-parse.test.mjs`，断言「声明版本 === 安装版本」，
 *       并**必须**包含上表 4 行夹具（前两行是本包的**存在理由**，不得删）。
 *   [ ] TODO-7：确认 `engines` —— `cheerio@1.2.0` 要求 `node >= 20.18.1`，
 *       本仓根 `package.json` 要求 `^22.19.0 || >=24.0.0` → 兼容 ✅（但要在 README 写明来源）。
 *
 * @module dsh-radar-dom-parse
 */

import { UPSTREAM_PACKAGE, UPSTREAM_VERSION, UPSTREAM_ENTRY } from './upstream.js';

export const name = 'radar-dom-parse';

/** 本包只 `provide` 一个服务，不 `inject` 任何宿主服务（与 classroom 解耦，评审后可整体摘除）。 */
export const inject = [];

export function apply(ctx) {
  ctx.provide('radarDomParse', {
    /** 上游标识（诊断用；不参与业务）。 */
    upstream: { package: UPSTREAM_PACKAGE, entry: UPSTREAM_ENTRY, version: UPSTREAM_VERSION },
    /**
     * 把一段 HTML 解析成可查询的 DOM。
     *
     * @param {string} _html 由 transport 取回的页面文本（**不得**是本地文件或 URL）
     * @returns {any} `cheerio` 的 `Cheerio` 实例（`$(selector)`）
     * @throws {Error} 未实现 —— 评审通过后按 TODO-1 落实
     */
    parse(_html) {
      throw Object.assign(new Error('radar-dom-parse: 候选骨架，未实现（见 src/index.js TODO-1）'), {
        code: 'NOT_IMPLEMENTED',
      });
    },
    /**
     * 从 CAS 登录页取 `execution` 值；找不到返回 `null`（与原实现同契约）。
     *
     * @param {string} _html
     * @returns {string|null}
     * @throws {Error} 未实现 —— 评审通过后按 TODO-2 落实
     */
    executionToken(_html) {
      throw Object.assign(new Error('radar-dom-parse: 候选骨架，未实现（见 src/index.js TODO-2）'), {
        code: 'NOT_IMPLEMENTED',
      });
    },
  });
}
