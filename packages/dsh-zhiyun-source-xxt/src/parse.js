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
