/**
 * 学习通的**纯解析**层：HTML → 结构，JSON → 结构。
 *
 * # 为什么单列一个文件
 *
 * 这里的正则都是从真机页面上"抄"下来的，不是想当然写出来的。它们脆弱、形态古怪、
 * 而且每一条都对应页面上某个具体位置 —— 和网络、Cookie、路由混在一个文件里，
 * 改一处就得在一屏里翻来翻去。分出来以后：
 *
 *   - `reads.js` 只负责"发哪个请求、拿哪段 HTML"；
 *   - 本文件只负责"这段 HTML 里有什么"，**全是纯函数**，可以拿固定夹具断言。
 *
 * # 解析口径来自哪
 *
 * 上游 ZJU-Omni 移植的是 [zju-chaoxing](https://github.com/wsdjeg/zju-chaoxing)（MIT）
 * 对超星页面的整理。**行为必须与上游一致**：字段名、过滤规则、时间解释都不能"顺手改好"，
 * 否则页面拿到的形状会变。所以这里逐条保留原正则，只在注释里补上"为什么是这样"。
 */

import { parse } from 'parse5';

import { ClassroomError } from '@lybx-leyw/dsh-zju-source-http';

/* ────────────────────────────────────────────── HTML 基础 */

/** HTML 实体表。只收学习通页面上真会出现的几个。 */
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/**
 * 反转义 HTML 实体。
 *
 * 超星的课程名/作业名里经常带 `&amp;`、`&quot;`，不还原就会原样显示给用户。
 * 数字实体（`&#39;` 与 `&#x27;`）也要处理：站点混用两种写法。
 *
 * @param {string} s - 原始片段。
 * @returns {string}
 */
export const unescapeHtml = (s) => String(s ?? '')
  .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => String.fromCodePoint(parseInt(hex, 16)))
  .replace(/&#(\d+);/g, (_m, dec) => String.fromCodePoint(Number(dec)))
  .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);

/**
 * 去标签取纯文本。
 *
 * 先把 `<script>` / `<style>` 整段**替换成空格**（不是删掉）—— 它们的正文不是内容，
 * 但直接删掉会让相邻两段文字粘成一个词（`作业` + `详情` → `作业详情` 侥幸没错，
 * `<span>1</span><span>/2</span>` → `1/2` 就错了）。然后所有空白压成一个空格。
 *
 * @param {string} s - 原始 HTML。
 * @returns {string}
 */
export const stripTags = (s) => unescapeHtml(
  String(s ?? '')
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' '),
).split(/\s+/).join(' ').trim();

/**
 * 取一个 `<input id="…" value="…">` 的值。
 *
 * 作业列表要求带签名（`enc` / `openc` / `stuenc`），签名是**中间页 HTML 里的隐藏域**。
 * 属性顺序不固定，所以两种写法都试一遍。
 *
 * @param {string} html - 页面 HTML。
 * @param {string} id - 隐藏域的 id。
 * @returns {string} 取不到返回空串（调用方据此判"这门课没有作业功能"）。
 */
export function hiddenValue(html, id) {
  const text = String(html ?? '');
  const escaped = String(id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = text.match(new RegExp(`id="${escaped}"[^>]*value="([^"]*)"`))
    ?? text.match(new RegExp(`value="([^"]*)"[^>]*id="${escaped}"`));
  return m ? m[1] : '';
}

/* ────────────────────────────────────────────── 课程列表 */

/**
 * 解析课程列表 HTML。
 *
 * # 为什么不能"按 li 切块"
 *
 * 课程卡片的 DOM 结构随模板版本变（`div.course-info` 里套多少层没保证），
 * 但**链接**是稳定的：每门课都有一个指向
 * `stucoursemiddle?courseid=…&clazzid=…&cpi=…` 的入口。所以以链接为锚点，
 * 再取它**后面 1600 字符**作为这门课的片段去抓名字与教师。
 *
 * 1600 是实测的经验值：够覆盖一张卡片（名字、教师、进度条、按钮），
 * 又不足以吃进下一张卡片，避免把隔壁课的老师认成这门课的。
 *
 * @param {string} html - 课程列表页 HTML。
 * @returns {Array<{name: string, teacher: string, courseid: string, clazzid: string, cpi: string}>}
 */
export function parseCourses(html) {
  const text = String(html ?? '');
  const out = [];
  const seen = new Set();
  // `&amp;` 与 `&` 两种写法都出现在真机页面里（不同模板的转义不一致）
  const link = /stucoursemiddle\?courseid=(\d+)&(?:amp;)?clazzid=(\d+)&(?:amp;)?cpi=(\d+)/g;
  for (const m of text.matchAll(link)) {
    const key = `${m[1]}/${m[2]}/${m[3]}`;
    // 同一门课在页面上会出现多次（卡片本身 + "继续学习"按钮），只留第一条
    if (seen.has(key)) continue;
    seen.add(key);
    const seg = text.slice(m.index + m[0].length, m.index + m[0].length + 1600);
    const name = seg.match(/course-name[^>]*title="([^"]+)"/)?.[1];
    let teacher = '';
    // `class` 在真机页面上的取值不固定：有的是 `overHidden2`，有的是
    // `overHidden2 fl`。上游只认前者，于是在带 `fl` 的模板上永远取不到教师名
    // （不是报错，是静默返回空串）。这里放宽到「以 overHidden2 开头」——
    // 对上游那种页面是同一个匹配结果，只是不再漏掉另一种模板。
    for (const p of seg.matchAll(/<p class="overHidden2(?:\s[^"]*)?"[^>]*>([^<]{2,15})<\/p>/g)) {
      const candidate = p[1].trim();
      // 卡片里 `overHidden2` 既可能是教师名，也可能是课程名或学期名；
      // 与课程名相同的那个显然不是老师。
      if (candidate && candidate !== name) { teacher = candidate; break; }
    }
    out.push({
      name: name ? unescapeHtml(name) : '?',
      teacher: unescapeHtml(teacher),
      courseid: m[1],
      clazzid: m[2],
      cpi: m[3],
    });
  }
  return out;
}

/* ────────────────────────────────────────────── 作业 */

/**
 * 已完成的标记。
 *
 * 只认这些词：`未完成` 里含 `完成`，所以**不能**用 `includes('完成')` 判已完成
 * （会把未完成全判成完成，待办直接清零）。
 */
const DONE_MARKS = Object.freeze(['已完成', '已提交', '待批阅', '已批阅', '已批改']);

/**
 * 判一条作业是不是**还没做**。
 *
 * @param {string} status - 页面上的状态文案。
 * @returns {boolean}
 */
export const isPending = (status) => !DONE_MARKS.some((mark) => String(status ?? '').includes(mark));

/**
 * 解析作业列表 HTML。
 *
 * # 三段结构
 *
 * ```html
 * <span>3/12</span></div></div>                       ← 进度（已完成/总数）
 * <li onclick="goTask(this);" data="<编码后的详情地址>">
 *   <p class="overHidden2 fl">作业名</p>
 *   <p class="status fl">未提交</p>
 * ```
 *
 * `data` 属性是 **URI 编码过**的地址，还要再 `unescapeHtml` 一次：
 * 页面把 `&` 写成了 `&amp;`，先还原再 `decodeURIComponent` 才能得到可用的 URL。
 *
 * @param {string} html - 作业列表页 HTML。
 * @returns {{progress: {done: number, total: number} | null, items: Array<{index: number, title: string, status: string, url: string}>}}
 */
export function parseHomeworkList(html) {
  const text = String(html ?? '');
  const progressMatch = text.match(/<span>(\d+)\/(\d+)<\/span>\s*<\/div>\s*<\/div>/);
  const items = [...text.matchAll(
    /<li onclick="goTask\(this\);" data="([^"]+)"[\s\S]*?<p class="overHidden2 fl">([^<]+)<\/p>[\s\S]*?<p class="status fl">([^<]*)<\/p>/g,
  )].map((m, i) => ({
    index: i + 1,
    title: unescapeHtml(m[2].trim()),
    status: m[3].trim() || '未知',
    url: decodeURIComponent(unescapeHtml(m[1])),
  }));
  return {
    progress: progressMatch
      ? { done: Number(progressMatch[1]), total: Number(progressMatch[2]) }
      : null,
    items,
  };
}

/**
 * 解析作业详情页的纯文本，取出标题、题量、满分、作答区间与得分。
 *
 * # 为什么标题这么取
 *
 * 详情页正文长这样：`作业详情 第三章习题 题量：10 满分：100 作答时间：…`。
 * 标题夹在页头 `作业详情` 与第一个 `题量：` 之间 —— 先把 HTML 拍平成文本，
 * 再按这两个锚点切，比在 DOM 里找 class 稳（class 每版都换）。
 *
 * @param {string} html - 详情页 HTML。
 * @returns {{title: string|null, question_count: number|null, full_score: number|null, start_time: string|null, deadline: string|null, score: string|null}}
 */
export function parseHomeworkDetail(html) {
  const text = stripTags(html);
  const out = {
    title: null,
    question_count: null,
    full_score: null,
    start_time: null,
    deadline: null,
    score: null,
  };
  const quantity = text.match(/题量[:：]/);
  if (quantity) {
    const head = text.slice(0, quantity.index);
    const anchor = head.lastIndexOf('作业详情');
    if (anchor >= 0) out.title = head.slice(anchor + 4).trim() || null;
  }
  // `Number(NaN) || null` → null：缺字段就用 null 表示"不知道"，不要 0
  out.question_count = Number(text.match(/题量[:：]\s*(\d+)/)?.[1] ?? NaN) || null;
  out.full_score = Number(text.match(/满分[:：]\s*(\d+)/)?.[1] ?? NaN) || null;
  const range = text.match(
    /作答时间[:：]\s*(\d{1,2}-\d{1,2}\s+\d{1,2}:\d{2})\s*至\s*(\d{1,2}-\d{1,2}\s+\d{1,2}:\d{2})/,
  );
  if (range) [out.start_time, out.deadline] = [range[1], range[2]];
  out.score = (text.match(/智能分析\s*(\d+(?:\.\d+)?)\s*分/)
    ?? text.match(/(?:得分|总评|成绩|批阅)[:：]?\s*(\d+(?:\.\d+)?)\s*分/))?.[1] ?? null;
  return out;
}

/**
 * `MM-DD HH:MM` → 最接近今天的那个年份的 ISO 串（带 `+08:00`）。
 *
 * # 为什么要这么绕
 *
 * 作业详情页的作答时间**不带年份**（`03-15 23:59`）。直接补当前年会在跨年时错：
 * 12 月的作业在 1 月看会变成"11 个月后才截止"。所以对 `去年/今年/明年` 各算一次，
 * 取离今天最近的那个。
 *
 * # 两处必须做对
 *
 * 1. **按北京时间算"今天"**。机器时区可能是 UTC 或别的，用本地时间去比，跨零点
 *    会差一天。
 * 2. **拒绝不存在的日期**（`02-30`）。`Date.parse` 会乖乖滚到 3 月 2 日，
 *    不校验就会凭空造出一个假截止时间 —— 比没有截止时间更糟。
 *
 * @param {string} monthDay - `MM-DD HH:MM`。
 * @param {Date} now - 当前时间（注入，便于测试）。
 * @returns {string|null} ISO 串；解析失败为 null。
 */
export function nearestDate(monthDay, now) {
  const m = String(monthDay ?? '').trim().match(/^(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const today = Date.parse(
    `${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(now)}T00:00:00+08:00`,
  );
  const year = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric' }).format(now));
  const pad = (s) => String(s).padStart(2, '0');
  let best = null;
  for (const y of [year - 1, year, year + 1]) {
    const iso = `${y}-${pad(m[1])}-${pad(m[2])}T${pad(m[3])}:${m[4]}:00+08:00`;
    const at = Date.parse(iso);
    // 拿 UTC+8 的月/日回读：能对上才说明这一天真实存在
    const local = new Date(at + 8 * 3600000);
    if (!Number.isFinite(at)) continue;
    if (local.getUTCMonth() + 1 !== Number(m[1]) || local.getUTCDate() !== Number(m[2])) continue;
    const diff = Math.abs(at - today);
    if (!best || diff < best.diff) best = { iso, diff };
  }
  return best?.iso ?? null;
}

/* ────────────────────────────────────────────── 考试 */

/**
 * 解析考试列表 HTML 表格。
 *
 * 只取 `class="dataTr"` 的行（表头与"暂无考试"提示行都是别的 class），
 * 并且要求**至少 9 列** —— 少列的行是提示行，不是考试。
 *
 * 列序（页面固定）：`0 序号 | 1 名称 | 2 时间 | 3 时长 | 4 考试状态 |
 * 5 我的状态 | 6 成绩 | 7 方式 | 8 操作`。
 *
 * @param {string} html - 考试列表页 HTML。
 * @returns {{exams: Array<{name: string, time: string, minutes: string, exam_status: string, my_status: string, score: string|null, mode: string|null}>}}
 */
export function parseExams(html) {
  const text = String(html ?? '');
  const rows = [...text.matchAll(/<tr[^>]*class="dataTr"[^>]*>([\s\S]*?)<\/tr>/g)]
    .map((m) => [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)]
      .map((td) => unescapeHtml(td[1].replace(/<[^>]+>/g, '')).trim()))
    .filter((cells) => cells.length >= 9);
  return {
    exams: rows.map((cells) => ({
      name: cells[1],
      time: cells[2],
      minutes: cells[3],
      exam_status: cells[4],
      my_status: cells[5],
      score: cells[6] || null,
      mode: cells[7] || null,
    })),
  };
}

/* ────────────────────────────────────────────── 通知 */

/**
 * 通知要不要留（未读过滤 + 关键词过滤）。
 *
 * @param {object} item - 通知原始条目。
 * @param {{unread_only?: boolean, keyword?: string}} filter - 过滤条件。
 * @returns {boolean}
 */
export function matchesNotice(item, { unread_only: unreadOnly = false, keyword = '' } = {}) {
  const kw = String(keyword ?? '').trim();
  if (unreadOnly && item?.isread) return false;
  if (!kw) return true;
  return `${item?.title ?? ''}${item?.content ?? ''}`.includes(kw);
}

/**
 * 把一条通知归一成页面能直接显示的形状。
 *
 * 正文是 HTML，要拍平；同时**截到 800 字** —— 通知正文可能长到几万字，
 * 整个塞进响应会让页面卡在渲染上。
 *
 * @param {object} item - 通知原始条目。
 * @returns {{title: string|null, sender: string|null, time: string|null, read: boolean, content: string|null}}
 */
export function normalizeNotice(item) {
  const content = item?.content ? stripTags(String(item.content)).slice(0, 800) : null;
  return {
    // 发送者字段在不同接口版本里叫 `createrName` 或 `senderName`，两个都认
    title: item?.title ?? null,
    sender: item?.createrName ?? item?.senderName ?? null,
    time: item?.completeTime ?? item?.insertTime ?? null,
    read: Boolean(item?.isread),
    content,
  };
}

/* ────────────────────────────────────────────── 课表 */

/**
 * 把课表接口的 JSON 归一成「按星期 × 节次」的一维列表。
 *
 * # 节次 → 时间
 *
 * 接口给的是 `beginNumber`（第几节开始）与 `length`（连上几节），另有一份
 * `lessonTimeConfigArray`（每节的 `"08:00-08:45"`）。所以要靠两者合成上课时间：
 * 第一节的开始时间 + 最后一节的结束时间。
 *
 * 下标为什么是 `begin - 1` / `begin + len - 2`：`beginNumber` 是**从 1 开始**的节号，
 * 而数组从 0 开始；连上 `len` 节时，最后一节的下标是 `begin + len - 2`。
 *
 * @param {object} data - 接口的 `data` 字段。
 * @param {number} [week] - 用户指定的周；不传就用平台当前周。
 * @returns {{school_year: string|null, semester: string|null, week: number|null, lessons: object[], note: string}}
 */
export function parseSchedule(data, week) {
  const curriculum = data?.curriculum ?? {};
  const lessons = Array.isArray(data?.lessonArray) ? data.lessonArray : [];
  const times = Array.isArray(curriculum.lessonTimeConfigArray) ? curriculum.lessonTimeConfigArray : [];
  return {
    school_year: curriculum.schoolYear ?? null,
    semester: curriculum.semester ?? null,
    week: week ?? curriculum.realCurrentWeek ?? curriculum.currentWeek ?? null,
    lessons: lessons.map((lesson) => {
      const begin = Number(lesson.beginNumber) || 0;
      const length = Number(lesson.length) || 1;
      const span = times[begin - 1] && times[begin + length - 2]
        ? `${String(times[begin - 1]).split('-')[0]}-${String(times[begin + length - 2]).split('-')[1]}`
        : null;
      return {
        weekday: Number(lesson.dayOfWeek) || null,
        periods: `${begin}-${begin + length - 1}`,
        time: span,
        course: lesson.name ?? null,
        teacher: lesson.teacherName ?? null,
        place: lesson.location ?? null,
        weeks: lesson.weeks ?? null,
      };
    }).sort((a, b) => (a.weekday ?? 9) - (b.weekday ?? 9)
      || a.periods.localeCompare(b.periods, undefined, { numeric: true })),
    note: '不传 week 时为平台当前周。weekday 1=周一。',
  };
}

/* ────────────────────────────────────────────── 章节目录（parse5） */

/**
 * 章节目录解析。
 *
 * # 为什么这个文件里只有它用 parse5
 *
 * 上面那些解析器都是正则 —— 学习通的作业列表、考试表格、通知 JSON 结构足够平，
 * 正则能可靠地切出来，而**章节树是嵌套的**：`div.chapter_unit` 是大章，
 * 里面 `id="cur<编号>"` 的块是可以点开的节，节还能再套一层 `li`。
 * 用正则数层级会在「同一层有两个并列节」和「一个节点套三层」之间摇摆，
 * 而错误的层级会让「第几章第几节」显示错 —— 那是用户直接看见的东西。
 *
 * 所以这一段照上游（`chaoxing/parse.ts`）逐行搬，用 parse5 建 DOM 再遍历。
 * 分母是「与上游行为一致」，不是「少一个依赖」。
 */

/**
 * 取一个元素上的属性值。
 *
 * @param {object} element - parse5 的元素节点。
 * @param {string} name - 属性名。
 * @returns {string} 属性值，没有时是空串。
 */
const attrOf = (element, name) => element.attrs?.find((a) => a.name === name)?.value ?? '';

/**
 * 元素是否带某个 class。
 *
 * @param {object} element - 元素节点。
 * @param {string} name - class 名。
 * @returns {boolean}
 */
const hasClass = (element, name) => attrOf(element, 'class').split(/\s+/).includes(name);

/** 是不是元素节点（parse5 的文本节点没有 `tagName`）。 */
const isElement = (node) => Boolean(node) && 'tagName' in node;

/** 取子节点数组，文本节点没有 `childNodes`。 */
const childrenOf = (node) => (node?.childNodes ?? []);

/**
 * 深度优先遍历所有后代元素。
 *
 * @param {object} root - 根节点。
 * @yields {object} 每个元素节点。
 */
function* elementsOf(root) {
  for (const child of childrenOf(root)) {
    if (!isElement(child)) continue;
    yield child;
    yield* elementsOf(child);
  }
}

/**
 * 节点的纯文本（递归拼所有文本后代）。
 *
 * @param {object} node - 任意节点。
 * @returns {string}
 */
const textOf = (node) => (node?.nodeName === '#text'
  ? node.value
  : childrenOf(node).map(textOf).join(''));

/** 压空白。 */
const squash = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

/**
 * 在 root 的后代里找第一个满足条件的元素。
 *
 * @param {object} root - 根节点。
 * @param {(element: object) => boolean} test - 判据。
 * @returns {object|undefined}
 */
function firstIn(root, test) {
  for (const element of elementsOf(root)) if (test(element)) return element;
  return undefined;
}

/**
 * `element` 在 `root` 里被几层 `tag` 包着。
 *
 * 章节树靠它区分「大章」与「嵌套的节」。
 *
 * @param {object} element - 目标元素。
 * @param {object} root - 遍历范围。
 * @param {string} tag - 标签名，如 `'li'`。
 * @returns {number}
 */
function nestingOf(element, root, tag) {
  let count = 0;
  let parent = element.parentNode;
  while (parent && parent !== root) {
    if (isElement(parent) && parent.tagName === tag) count += 1;
    parent = isElement(parent) ? parent.parentNode : null;
  }
  return count;
}

/**
 * 章节目录。
 *
 * 每个 `div.chapter_unit` 是一个大章，里面 `id="cur<编号>"` 的块是可以点开的节，
 * 节还可以再嵌套（外面多一层 `li`）。
 *
 * @param {string} html - 课程页 HTML。
 * @returns {Array<{id: string, title: string, path: string[], locked: boolean}>}
 */
export function parseChapters(html) {
  const document = parse(String(html ?? ''));
  const out = [];
  const seen = new Set();

  const scan = (root) => {
    const head = firstIn(root, (e) => hasClass(e, 'catalog_name') && nestingOf(e, root, 'li') === 0);
    const unit = head ? squash(textOf(head)) : '';
    const trail = [];
    for (const element of elementsOf(root)) {
      const id = (attrOf(element, 'id').match(/^cur(\d+)$/) ?? [])[1];
      if (!id || seen.has(id)) continue;
      seen.add(id);

      const number = firstIn(element, (x) => hasClass(x, 'catalog_sbar'));
      const label = number ? squash(textOf(number)) : '';
      const link = firstIn(element, (x) => x.tagName === 'a' && hasClass(x, 'clicktitle'));
      const name = squash(link ? attrOf(link, 'title') || textOf(link) : attrOf(element, 'title')) || `章节 ${id}`;
      const title = label && !name.startsWith(label) ? `${label} ${name}` : name;

      const depth = nestingOf(element, root, 'li');
      // `trail` 维护「当前这一支上的祖先标题」。切到别的分支时截断到当前深度。
      trail.length = Math.max(0, depth - 1);
      const path = depth === 0
        ? [title]
        : [...(unit && unit !== title ? [unit] : []), ...trail, title];
      if (depth > 0) trail[depth - 1] = title;

      const tips = firstIn(element, (x) => hasClass(x, 'bntHoverTips'));
      out.push({ id, title, path, locked: /解锁|未开放/.test(tips ? textOf(tips) : '') });
    }
  };

  const units = [...elementsOf(document)].filter((e) => hasClass(e, 'chapter_unit'));
  if (units.length) for (const unit of units) scan(unit);
  else scan(document);
  return out;
}

/* ────────────────────────────────────────────── 章节卡片附件 */

/**
 * 从 `start` 处的 `{` 起取出配对完整的对象文本（跳过字符串里的括号）。
 *
 * 页面上是 `mArg = {attachments:[…]}` 这样的 JS 对象字面量，不是合法 JSON 片段，
 * 所以要先按括号配对切出整段，再交给 `JSON.parse`。
 *
 * @param {string} text - 整段页面文本。
 * @param {number} start - `{` 所在下标。
 * @returns {string|undefined} 配对的整段（含两端括号），找不到时 undefined。
 */
function objectAt(text, start) {
  let depth = 0;
  let quote = '';
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '{') depth += 1;
    else if (ch === '}' && (depth -= 1) === 0) return text.slice(start, i + 1);
  }
  return undefined;
}

/**
 * 章节卡片里的附件。
 *
 * 页面脚本里 `mArg = {attachments:[…]}`，每个附件的 `property` 带
 * `objectid`、`name`、`type`（扩展名）。
 *
 * `found: false` 表示这一页没有卡片（`num` 已经越过最后一张）—— 调用方据此停止翻页。
 *
 * @param {string} html - 卡片页 HTML。
 * @returns {{found: boolean, notOpen: boolean, files: Array<{objectId: string, name: string, size: number|null}>}}
 */
export function parseCards(html) {
  const text = String(html ?? '');
  const notOpen = /章节未开放/.test(text);
  for (const match of text.matchAll(/mArg\s*=\s*\{/g)) {
    const raw = objectAt(text, match.index + match[0].length - 1);
    let data;
    try {
      data = raw ? JSON.parse(raw) : undefined;
    } catch {
      continue; // 这一段不是合法 JSON，换下一处 mArg
    }
    if (!data || !Array.isArray(data.attachments)) continue;
    const files = [];
    for (const item of data.attachments) {
      const property = item?.property && typeof item.property === 'object' ? item.property : {};
      const objectId = String(property.objectid ?? item?.objectId ?? '');
      // 只认 32 位 hex —— 别的形状不是可下载对象
      if (!/^[0-9a-f]{32}$/i.test(objectId)) continue;
      let name = squash(String(property.name ?? property.title ?? ''));
      const extension = String(property.type ?? '').trim().toLowerCase();
      if (/^\.\w{1,8}$/.test(extension) && !name.toLowerCase().endsWith(extension)) name += extension;
      if (!name) continue;
      const size = Number(property.size);
      files.push({ objectId, name, size: Number.isFinite(size) && size > 0 ? size : null });
    }
    return { found: true, notOpen, files };
  }
  return { found: false, notOpen, files: [] };
}

/* ────────────────────────────────────────────── 资料栏（每个文件夹一层） */

/**
 * 把页面上的约数大小（`14KB` / `1.2 MB` / `500B`）换成字节数。
 *
 * 资料栏只给约数，给不了准确字节数；返回 `null` 表示没写，而不是 0 ——
 * 「不知道」与「空文件」在界面上是两件事。
 *
 * @param {string} text - 页面上的大小文本。
 * @returns {number|null}
 */
export function roughBytes(text) {
  const match = String(text ?? '').trim().match(/^([\d.]+)\s*([KMG]?)B?$/i);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 1024 ** ['', 'K', 'M', 'G'].indexOf(match[2].toUpperCase()));
}

/**
 * `onclick` 里 `fn('a','b',3,…)` 的参数，去掉引号。
 *
 * 资料栏的每一行都没有稳定的 data-* 属性，唯一可靠的位置是 `toOpen(...)` 的
 * 参数表：名字、类型、id、objectId、enc 都在里面。
 *
 * @param {string} source - `onclick` 属性原文。
 * @param {string} fn - 函数名。
 * @returns {string[]} 参数（已去引号）；找不到时空数组。
 */
function callArgs(source, fn) {
  const at = String(source ?? '').indexOf(`${fn}(`);
  if (at < 0) return [];
  const args = [];
  let current = '';
  let quote = '';
  for (let i = at + fn.length + 1; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (ch === '\\' && i + 1 < source.length) current += source[(i += 1)];
      else if (ch === quote) quote = '';
      else current += ch;
      continue;
    }
    if (ch === "'" || ch === '"') quote = ch;
    else if (ch === ',') { args.push(current.trim()); current = ''; }
    else if (ch === ')') { args.push(current.trim()); return args; }
    else current += ch;
  }
  return args;
}

/**
 * 资料栏一层。
 *
 * # 为什么要按 `ul.dataBody_td` 逐行取
 *
 * 资料栏是服务端渲染的列表，一页 30 行、总页数在 `input#totalPages` 里。
 * 每行的 `onclick="toOpen('名字','pdf','id',…)"` 才是权威位置 ——
 * 名字被截断时页面正文是省略号，而参数里是完整的。
 *
 * @param {string} html - 资料栏页面 HTML。
 * @returns {{rows: Array<{dataId: string, name: string, type: string, objectId: string, downloadable: boolean, size: string, enc: string}>, totalPages: number}}
 */
export function parseDataList(html) {
  const document = parse(String(html ?? ''));
  const rows = [];
  for (const element of elementsOf(document)) {
    if (element.tagName !== 'ul' || !hasClass(element, 'dataBody_td')) continue;
    const call = [element, ...elementsOf(element)]
      .map((node) => attrOf(node, 'onclick'))
      .find((value) => value.includes('toOpen(')) ?? '';
    const args = callArgs(call, 'toOpen');
    const sizeNode = firstIn(element, (node) => hasClass(node, 'dataBody_size_stu'));
    rows.push({
      dataId: attrOf(element, 'id') || args[2] || '',
      name: squash(unescapeHtml(attrOf(element, 'dataname') || args[0] || '')),
      type: String(attrOf(element, 'type') || args[1] || '').toLowerCase(),
      objectId: attrOf(element, 'objectid') || args[4] || '',
      downloadable: attrOf(element, 'isdown') !== '0',
      size: sizeNode ? squash(textOf(sizeNode)) : '',
      enc: args[9] ?? '',
    });
  }
  const pages = firstIn(document, (node) => node.tagName === 'input' && attrOf(node, 'id') === 'totalPages');
  return { rows, totalPages: Math.max(1, Number(pages ? attrOf(pages, 'value') : 1) || 1) };
}

/* ────────────────────────────────────────────── 作业：三个来源 */

/**
 * 毫秒时间戳 → 北京时间的「YYYY-MM-DD HH:mm」。
 *
 * # 为什么不用本地时区
 *
 * 跑这个包的人可能在任意时区（CI 上是 UTC）。用本地时间格式化会让同一份作业
 * 在不同机器上显示成不同的截止时间 —— 而「什么时候到期」是这个功能存在的**全部理由**。
 *
 * @param {unknown} value - 毫秒数、可解析的时间串，或空。
 * @returns {string|null} 解析不出来时 `null`（不知道就别编）。
 */
export function beijingMinute(value) {
  const at = typeof value === 'number' ? value : (typeof value === 'string' && value ? Date.parse(value) : NaN);
  if (!Number.isFinite(at)) return null;
  return new Date(at + 8 * 3600_000).toISOString().slice(0, 16).replace('T', ' ');
}

/** 作业类型。平台上没有字段区分，只能看名字 —— 周测、小测在超星里也是作业。 */
const TEST_NAME = /周测|小测|测验|测试|考试/;

/**
 * 按名字判作业类型。
 *
 * @param {string} title - 作业标题。
 * @returns {'作业'|'测试'}
 */
export const homeworkKind = (title) => (TEST_NAME.test(String(title ?? '')) ? '测试' : '作业');

/** 页面上的富文本 → 纯文本（老师写的要求里常带 `<br>` 与 `&nbsp;`）。 */
const plain = (value) => stripTags(value ?? '');

/**
 * 学习任务明细里作业这一类别的 `planType`。
 *
 * 上游 `homework.ts:41` 的定义：字段 `standardPlanTypeMethod` 是 `HOMEWORK`。
 * 其他取值是视频、阅读、讨论之类的「别的项」，只数还剩几项没学完，
 * 不当成作业列出来 —— 把它们混进作业列表会让「还有几份作业要交」永远为假。
 */
const PLAN_HOMEWORK = 4;

/**
 * 学习任务明细（`getUserStandard` 的 `data`）→ 里面的作业。
 *
 * 只取 `planType === 4` 的项；其余项只累计「没学完的还有几项」，
 * 让用户知道「这节课还有别的东西要做」，但不会把它们误报成作业。
 *
 * @param {object|undefined} standard - 接口的 `data` 字段。
 * @returns {{plans: Array<{title: string, requirement: string, opens: number|null, ends: number|null, done: boolean}>, otherLeft: number}}
 * @throws {ClassroomError} `SCHEMA_CHANGED`：结构不是预期的形状。
 */
export function parseTaskPlans(standard) {
  const rows = standard?.userTaskQualifyDTO?.passStandardCalcResultDTOList;
  if (!Array.isArray(rows)) {
    throw new ClassroomError('SCHEMA_CHANGED', '学习任务的明细结构不是预期的形状。');
  }
  const result = { plans: [], otherLeft: 0 };
  for (const row of rows) {
    const plan = row?.planUserBO?.plan;
    const done = row?.planUserBO?.finish === 1;
    if (plan?.planType !== PLAN_HOMEWORK) {
      if (!done) result.otherLeft += 1;
      continue;
    }
    const at = (value) => {
      const parsed = typeof value === 'string' && value ? Date.parse(value) : NaN;
      return Number.isFinite(parsed) ? parsed : null;
    };
    result.plans.push({
      title: plain(plan.name),
      requirement: plain(plan.introduce),
      opens: at(plan.startDate),
      ends: at(plan.endDate),
      done,
    });
  }
  return result;
}

/**
 * 学习任务的跳转中间页里那个加密编号。
 *
 * 任务列表给的 `id` 不能直接查明细：明细要的是 `eTaskUserId`，它只出现在
 * 中间页的脚本里（`const eTaskUserId = "…"`）。少了它明细读不出来。
 *
 * @param {string} html - 中间页 HTML。
 * @returns {string} 取不到时空串（调用方据此报结构错误）。
 */
export function parseTaskKey(html) {
  return /const eTaskUserId = "([^"]+)"/.exec(String(html ?? ''))?.[1] ?? '';
}

/**
 * 学习任务列表（`getData` 的 JSON）→ 有 id 的那些任务。
 *
 * # `result !== 1` 不等于出错
 *
 * 大量课程从没用过「任务」栏（老师直接在作业栏发作业）。那种课这个接口回的是
 * `result: 0` 或空对象，`data` 根本不存在 —— 那是**「这门课没有学习任务」**，
 * 与「接口换了形状」是两件事。混成一个错误会让每门只用作业栏的课都在
 * `failed` 里留一行，用户看到的是「读了 3 门，3 门失败」。
 *
 * 所以 `available: false` 单独表达：调用方据此当作「这一路没有作业」，
 * 而 `available: true` 但 `data` 不是数组才是 `SCHEMA_CHANGED`。
 *
 * @param {object|undefined} payload - 接口响应。
 * @returns {{available: boolean, tasks: Array<{id: string, name: string, total: number, finished: number}>, malformed: boolean}}
 */
export function parseTaskList(payload) {
  if (payload?.result !== 1) return { available: false, tasks: [], malformed: false };
  if (payload.data != null && !Array.isArray(payload.data)) {
    return { available: true, tasks: [], malformed: true };
  }
  const rows = Array.isArray(payload.data) ? payload.data : [];
  return {
    available: true,
    malformed: false,
    tasks: rows
      .filter((task) => task?.id)
      .map((task) => ({
        id: String(task.id),
        name: plain(task.name),
        total: typeof task.planCount === 'number' ? task.planCount : 0,
        finished: typeof task.planFinishCount === 'number' ? task.planFinishCount : 0,
      })),
  };
}

/**
 * 手机端作业列表（`work/stu-work`）→ 一行一份作业。
 *
 * # 形状
 *
 * 所有课的作业混在一页里，每个 `li` 一份：标题在 `p`，后面的 `span` 依次是
 * 状态、《课程》和「剩余 N 天 N 小时 N 分钟」。**只列 `《…》` 的才是作业** ——
 * 页面上的其他 `li`（分组标题之类）没有课程名。
 *
 * @param {string} html - 页面 HTML。
 * @returns {Array<{title: string, status: string, course: string, leftMinutes: number|null}>}
 */
export function parseStuWork(html) {
  const rows = [];
  for (const element of elementsOf(parse(String(html ?? '')))) {
    if (element.tagName !== 'li') continue;
    const title = firstIn(element, (node) => node.tagName === 'p');
    if (!title) continue;
    const spans = [...elementsOf(element)]
      .filter((node) => node.tagName === 'span')
      .map((node) => squash(textOf(node)))
      .filter(Boolean);
    const course = spans.find((text) => /^《.*》$/.test(text));
    if (!course) continue;
    const left = spans.find((text) => text.startsWith('剩余'));
    const part = (pattern) => Number(left?.match(pattern)?.[1] ?? 0);
    rows.push({
      title: squash(textOf(title)),
      course: course.slice(1, -1),
      status: spans.find((text) => text !== course && text !== left) ?? '',
      // 页面只写「剩余 N 小时 M 分钟」（往下取整），所以这里是**近似值**；
      // 调用方要按分钟粒度还原成绝对时间（见 `reads.js` 的 `homeworkList`）。
      leftMinutes: left && /\d/.test(left)
        ? part(/(\d+)天/) * 1440 + part(/(\d+)小时/) * 60 + part(/(\d+)分钟/)
        : null,
    });
  }
  return rows;
}

/**
 * 手机端列表的一行 → 与另外两个来源同形的作业。
 *
 * 截止时间按整分钟**往上**补：页面写的是「剩余 3 小时 20 分钟」（向下取整），
 * 直接拿 `now + leftMinutes` 会早最多 59 秒，把它写成绝对时间时取整到分钟即可。
 *
 * @param {{title: string, status: string, course: string, leftMinutes: number|null}} row - 一行的原始形状。
 * @param {number} now - 当前毫秒时间戳（注入，便于测试）。
 * @returns {object}
 */
export function fromWorkRow(row, now) {
  const ends = row.leftMinutes === null ? null : Math.ceil((now + row.leftMinutes * 60_000) / 60_000) * 60_000;
  return {
    course: row.course,
    task: '',
    title: row.title,
    type: homeworkKind(row.title),
    opens: null,
    deadline: beijingMinute(ends),
    done: /已完成|待批阅|已批阅|已提交/.test(row.status),
    closed: /已过期|已截止/.test(row.status),
    requirement: '',
    otherLeft: 0,
  };
}
