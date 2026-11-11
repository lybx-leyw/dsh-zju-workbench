/**
 * 研究生教育管理信息系统（`yjsy.zju.edu.cn`）：本人研究生课表。
 *
 * # 为什么单独一个包
 *
 * 本科教务网（`zdbk`）**查不到研究生课**。研究生、以及选了研究生课的本科生，
 * 他们的课在这个系统里；两边要排进同一张日程表。上游对应的是一份 15.6 KB 的
 * 单方法模块（`core/zju/lib/yjsy/index.ts`）。
 *
 * # 分层（D17）
 *
 * 本包**只读**：数据源只提供事实，不注册 AI 工具、不含写操作。
 * 与上游同类的系统里，`yjsy` 本来也只有 1 条只读能力（`module.json` 的 `writes: false`）。
 *
 * # 接口事实（照上游 2026-11-02 的实测记录）
 *
 * - 单页应用，接口都在 `https://yjsy.zju.edu.cn/dataapi` 下，GET 带查询串；
 * - 请求头 `X-Access-Token` 带登录换来的 token；响应 `{success, code, message, result}`；
 * - 登录：统一身份认证给 `service` 签 ticket，`GET sys/cas/client/validateLogin?ticket=&service=`
 *   换 token（`result.token`、`result.userInfo`）；
 * - 研究生的 service 是 `https://yjsy.zju.edu.cn/`；选了研究生课的本科生走
 *   `https://yjsy.zju.edu.cn/bks`。**本科账号在研究生入口换 token 会返回 500
 *   「无效的用户信息」**，所以按学号首位选入口，换不到再试另一个；
 * - 学年学期：`xn` 是学年的头一年（2026 即 2026-2027）；`xq` 是大学期（11 春夏、12 秋冬）；
 *   `pkxq` 是小学期（11 春、12 夏、13 秋、14 冬）。
 *
 * # 登录依赖注入而不是自己走 CAS
 *
 * 上游的 `openContext()` 顺手把 CAS 组件装进 Context。本仓没有那个装配层：
 * CAS 登录在 `@lybx-leyw/dsh-zju-source-campus` 的 `cas/login.js`，而本包不该
 * 反向依赖一个业务包。所以这里收一个 **`acquireToken(entry)` 回调**，
 * 由调用方（将来的登录集成层）提供 —— 与 `source/webvpn` 的 `doctor` 收凭据
 * 是同一个口径：**tier 1 的数据源不知道凭据从哪来。**
 */

/** 站点主机。 */
export const HOST = 'yjsy.zju.edu.cn';
/** 接口前缀。 */
export const API = `https://${HOST}/dataapi`;

/** 两个入口：研究生与本科生（服务路径不同，CAS 的 service 也不同）。 */
export const ENTRIES = Object.freeze({
  graduate: `https://${HOST}/`,
  undergraduate: `https://${HOST}/bks`,
});

/**
 * 学号首位是培养层次：1 博士、2 硕士、3 本科。
 *
 * 用它决定**先试哪个入口** —— 先试对的那个能省一次失败请求，而失败请求在
 * 研究生教务网要等一次 500。
 *
 * @param id - 学号。
 * @returns 是否研究生（博士或硕士）。
 */
export function isGraduateId(id) {
  return /^[12]\d{7,11}$/.test(String(id ?? '').trim());
}

/** 大学期与它的两个小学期。`xq` 是接口认的大学期码，`halves` 是小学期码。 */
const SEMESTERS = Object.freeze({
  秋冬: { xq: '12', halves: { 秋: '13', 冬: '14' } },
  春夏: { xq: '11', halves: { 春: '11', 夏: '12' } },
});
/** 小学期码 → 中文名。 */
const HALF_NAMES = Object.freeze({ 11: '春', 12: '夏', 13: '秋', 14: '冬' });

/** 取字符串字段并去空白；非字符串一律当空串。 */
const text = (value) => (typeof value === 'string' ? value.trim() : '');

/** 日期的毫秒换算与加减（全部按 UTC 算，避免本地时区把日期挪一天）。 */
const DAY_MS = 86_400_000;
const addDays = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
/** 某一天所在那一周的周一（ISO 周：周日算第 7 天）。 */
const mondayOf = (date) => addDays(date, 1 - (new Date(`${date}T00:00:00Z`).getUTCDay() || 7));
/** `800` → `08:00`。上游的节次时间是四位数字。 */
const clock = (value) => {
  const digits = String(value ?? '').padStart(4, '0');
  return /^\d{4}$/.test(digits) ? `${digits.slice(0, 2)}:${digits.slice(2)}` : '';
};

/**
 * `[1,2,3,5,7]` → `第1-3,5,7周`。
 *
 * 连续的数字并成区间，读者一眼能看出「这课到底哪几周上」。
 *
 * @param weeks - 周次数组（已排序）。
 * @returns 可读文本；空数组给空串。
 */
export function weeksText(weeks) {
  const parts = [];
  for (let i = 0; i < weeks.length;) {
    let j = i;
    while (j + 1 < weeks.length && weeks[j + 1] === weeks[j] + 1) j += 1;
    parts.push(j > i ? `${weeks[i]}-${weeks[j]}` : `${weeks[i]}`);
    i = j + 1;
  }
  return parts.length ? `第${parts.join(',')}周` : '';
}

/**
 * 研究生教务网的客户端。
 *
 * 只做「拿 token 之后的读取」：登录由调用方通过 `acquireToken` 提供，
 * 客户端不碰凭据、不碰 CAS。
 */
export class Yjsy {
  /**
   * @param options.request - 发一次请求的函数，签名 `(url, init) => { status, text }`。
   *   由调用方注入（通常是 `Transport` 的 `request`），这样本类不依赖具体传输实现。
   * @param options.entry - 走哪个入口。
   * @param options.token - 登录换来的 `X-Access-Token`。
   */
  constructor({ request, entry, token }) {
    this.request = request;
    this.entry = entry;
    this.token = token;
    /** 最近一次会话失效的标记；调用方可据此决定是否重新登录。 */
    this.expired = false;
  }

  /**
   * GET 一个接口。
   *
   * @param path - 相对 `dataapi` 的路径，如 `py/pyKcbj/queryXskbByLoginUser`。
   * @param query - 查询参数。
   * @returns `result` 字段。
   * @throws {YjsyError} 会话失效、响应形状不对、或站点拒绝。
   */
  async get(path, query = {}) {
    const response = await this.request(`${API}/${path}?${new URLSearchParams(query)}`, {
      headers: { 'X-Access-Token': this.token, Accept: 'application/json' },
    });
    let reply;
    try {
      reply = JSON.parse(response.text);
    } catch {
      throw new YjsyError('SHAPE', `研究生教务网没有返回 JSON（HTTP ${response.status}）`, { path });
    }
    if (!reply || typeof reply.success !== 'boolean') {
      throw new YjsyError('SHAPE', `研究生教务网的响应不是 {success, code, message, result} 形状（HTTP ${response.status}）`, { path });
    }
    // 401 / 510 是会话类失效：调用方据此重新换 token，而不是当成业务错误。
    if (reply.code === 401 || reply.code === 510) {
      this.expired = true;
      throw new YjsyError('AUTH_EXPIRED', '研究生教务网的登录失效了', { path });
    }
    if (!reply.success) throw new YjsyError('REJECTED', `研究生教务网：${reply.message || '请求失败'}`, { path, code: reply.code });
    return reply.result;
  }
}

/** 本包的统一错误形状：`code` 给程序判断，`message` 给人看。 */
export class YjsyError extends Error {
  /**
   * @param code - 稳定的错误码（`SHAPE` / `AUTH_EXPIRED` / `REJECTED` / `CONFIG`）。
   * @param message - 给人看的一句话。
   * @param details - 附加信息（路径、上游 code 等）。
   */
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'YjsyError';
    this.code = code;
    this.details = details;
  }
}

/**
 * 解析学年学期。
 *
 * 不给参数时问系统「现在是哪个学年学期」（`system/sysApp/queryByDm?dm=py_xsxk`
 * 的 `dqxn` / `dqxq`）。
 *
 * @param client - 已登录的客户端。
 * @param options.year - `2026-2027` 形式；不给则用系统的当前学年。
 * @param options.term - 秋 / 冬 / 春 / 夏 / 秋冬 / 春夏；不给则用系统的当前大学期。
 * @returns `{ year, semester, xn, xq, halves }`。
 * @throws {YjsyError} 参数不合法，或系统没说清现在是哪学期。
 */
export async function resolveTerm(client, { year, term } = {}) {
  let xn;
  let semester;
  if (year !== undefined) {
    const matched = /^(\d{4})-(\d{4})$/.exec(String(year));
    if (!matched || Number(matched[2]) !== Number(matched[1]) + 1) {
      throw new YjsyError('CONFIG', '学年要写成 2026-2027 这样');
    }
    xn = matched[1];
  }
  const rawTerm = term === undefined ? undefined : String(term).trim();
  if (rawTerm !== undefined && !['秋', '冬', '春', '夏', '秋冬', '春夏'].includes(rawTerm)) {
    throw new YjsyError('CONFIG', '学期只能是秋、冬、春、夏、秋冬、春夏');
  }
  if (rawTerm) semester = rawTerm in SEMESTERS ? rawTerm : (['秋', '冬'].includes(rawTerm) ? '秋冬' : '春夏');

  if (year === undefined || !semester) {
    const now = await client.get('system/sysApp/queryByDm', { dm: 'py_xsxk' });
    if (!/^\d{4}$/.test(String(now?.dqxn)) || !['11', '12'].includes(String(now?.dqxq))) {
      throw new YjsyError('SHAPE', '研究生教务网没有说现在是哪个学年学期');
    }
    xn ??= String(now.dqxn);
    semester ??= now.dqxq === '12' ? '秋冬' : '春夏';
  }

  const info = SEMESTERS[semester];
  const halves = rawTerm && rawTerm.length === 1 ? [info.halves[rawTerm]] : Object.values(info.halves);
  return { year: `${xn}-${Number(xn) + 1}`, semester, xn: String(xn), xq: info.xq, halves };
}

/**
 * 本人一个学期的课表。
 *
 * 每门课给出教师、星期、节次、起止时间、地点、周次，以及**每次课的日期**
 * （按教学日历的第 1 周算好，调用方不用自己推）。
 *
 * 冬、夏学期的周次接着秋、春学期数（与本科教务网一致），这里换算成**这个小学期里的
 * 第几周** —— 否则用户看到「第 14 周」会与自己数的不一致。
 *
 * @param client - 已登录的客户端。
 * @param options.year - 学年。
 * @param options.term - 学期。
 * @returns 课表对象。
 * @throws {YjsyError} 教学日历缺失、节次时间缺失、或课表形状不对。
 */
export async function timetable(client, options = {}) {
  const term = await resolveTerm(client, options);
  const calendar = await client.get('system/sysJxrlXqsj/getJxrlByXnxq', {
    xn: term.xn, xq: term.xq, sfqr: '1',
  });
  const start = text(calendar?.kssj).slice(0, 10);
  const secondHalf = Number(calendar?.xdxjKszc);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) {
    throw new YjsyError('SHAPE', `研究生教务网还没有 ${term.year} ${term.semester}学期的教学日历`);
  }

  // 官方页面对第 14 节的下课时间不照接口给的写，一律显示 22:05。
  const periodTimes = (calendar.sysJxrlSjdList ?? [])
    .map((row) => ({
      period: Number(row.jc),
      startTime: clock(row.kssj),
      endTime: Number(row.jc) === 14 ? '22:05' : clock(row.jssj),
    }))
    .filter((row) => Number.isInteger(row.period) && row.startTime && row.endTime)
    .sort((a, b) => a.period - b.period);
  if (!periodTimes.length) throw new YjsyError('SHAPE', '研究生教务网的教学日历里没有节次时间');

  const firstMonday = mondayOf(start);
  const courses = new Map();
  const unscheduled = [];

  for (const half of term.halves) {
    const result = await client.get('py/pyKcbj/queryXskbByLoginUser', { xn: term.xn, pkxq: half });
    if (!result || typeof result !== 'object') throw new YjsyError('SHAPE', '研究生教务网的课表不是对象');

    for (const [day, cells] of Object.entries(result.kcbMap ?? {})) {
      const weekday = Number(day);
      if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) {
        throw new YjsyError('SHAPE', '研究生教务网课表的星期不对', { day });
      }
      for (const [jc, cell] of Object.entries(cells ?? {})) {
        const period = Number(jc);
        if (!Number.isInteger(period) || period < 1) {
          throw new YjsyError('SHAPE', '研究生教务网课表的节次不对', { jc });
        }
        for (const item of cell?.pyKcbjSjddVOList ?? []) {
          const zc = text(item.zc).split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0);
          const location = `${text(item.xqmc)}${text(item.jxl)}${text(item.cdmc)}`;
          const key = text(item.kcbjId) || `${text(item.kcmc)}|${text(item.bjbh)}`;
          const course = courses.get(key) ?? {
            name: text(item.kcmc),
            class: text(item.bjbh),
            teacher: text(item.xm),
            term: HALF_NAMES[text(item.pkxq)] ?? HALF_NAMES[half],
            undergraduate: text(item.bkbj) === '1',
            pending: text(item.xkzt) === '12',
            slots: new Map(),
          };
          // 同一门课、同一天、同一地点、同样周次的几格并成一次课。
          const slotKey = JSON.stringify([weekday, location, zc]);
          const slot = course.slots.get(slotKey) ?? { weekday, location, zc, periods: [] };
          if (!slot.periods.includes(period)) slot.periods.push(period);
          course.slots.set(slotKey, slot);
          courses.set(key, course);
        }
      }
    }

    for (const row of result.sjddList ?? []) {
      unscheduled.push({
        name: text(row.kcmc),
        class: text(row.bjbh),
        term: HALF_NAMES[text(row.pkxq)] ?? HALF_NAMES[half],
        college: text(row.kkxyMc),
        campus: text(row.skxq),
        teacher: text(row.zjjsXm),
        note: text(row.bz),
        pending: text(row.xkzt) === '12',
      });
    }
  }

  const timeOf = (period) => periodTimes.find((row) => row.period === period);
  const out = [...courses.values()].map(({ slots, ...course }) => {
    const meetings = [];
    for (const slot of slots.values()) {
      const periods = [...slot.periods].sort((a, b) => a - b);
      // 连着的节次是一次课；中间断开的分成几次。
      for (let i = 0; i < periods.length;) {
        let j = i;
        while (j + 1 < periods.length && periods[j + 1] === periods[j] + 1) j += 1;
        const run = periods.slice(i, j + 1);
        const first = timeOf(run[0]);
        const last = timeOf(run.at(-1));
        if (!first || !last) {
          throw new YjsyError('SHAPE', '研究生教务网课表的节次在教学日历里没有时间', { periods: run });
        }
        // 冬、夏学期的周次接着秋、春学期数：换成这个小学期里的第几周。
        const offset = ['冬', '夏'].includes(course.term) && Number.isInteger(secondHalf) && secondHalf > 1
          ? secondHalf - 1
          : 0;
        meetings.push({
          weekday: slot.weekday,
          periods: run,
          startTime: first.startTime,
          endTime: last.endTime,
          location: slot.location,
          weeks: weeksText(slot.zc.map((w) => w - offset).filter((w) => w > 0)),
          dates: slot.zc.map((w) => addDays(firstMonday, (w - 1) * 7 + slot.weekday - 1)).sort(),
        });
        i = j + 1;
      }
    }
    meetings.sort((a, b) => a.weekday - b.weekday || a.periods[0] - b.periods[0]);
    return { ...course, meetings };
  }).sort((a, b) => a.name.localeCompare(b.name, 'zh'));

  return {
    term: {
      year: term.year,
      term: term.halves.length > 1 ? term.semester : HALF_NAMES[term.halves[0]],
      start,
      end: text(calendar.jssj).slice(0, 10),
      weeks: Number(calendar.pkzcs) || null,
      ...(Number.isInteger(secondHalf) && secondHalf > 1 ? { secondHalfFrom: addDays(firstMonday, (secondHalf - 1) * 7) } : {}),
    },
    entry: client.entry === 'graduate' ? '研究生入口' : '本科生入口',
    timezone: 'Asia/Shanghai',
    periodTimes,
    count: out.length,
    courses: out,
    ...(unscheduled.length ? { unscheduled } : {}),
  };
}

/**
 * 按学号猜先走哪个入口，换来 token 后建客户端。
 *
 * 换不到就试另一个入口，两边都失败时说清**两边各自的原因** —— 否则用户只会看到
 * 「登录失败」，而真实原因可能是「本科账号不该走研究生入口」。
 *
 * @param options.acquireToken - `(entry, service) => Promise<string>`；由调用方实现
 *   （通常是走一遍 CAS 拿 ticket 再换 token）。
 * @param options.username - 学号，用来决定先试哪个入口。
 * @param options.request - 发请求的函数，签名见 {@link Yjsy}。
 * @returns 已登录的客户端。
 * @throws {YjsyError} 两个入口都换不到 token。
 */
export async function openYjsy({ acquireToken, username, request } = {}) {
  if (typeof acquireToken !== 'function') {
    throw new YjsyError('CONFIG', '研究生教务网需要一个取 token 的回调（acquireToken）—— 登录不归数据源管。');
  }
  const order = isGraduateId(username) ? ['graduate', 'undergraduate'] : ['undergraduate', 'graduate'];
  const reasons = [];
  for (const entry of order) {
    try {
      const token = await acquireToken(entry, ENTRIES[entry]);
      if (token) return new Yjsy({ request, entry, token });
      reasons.push(`${entry === 'graduate' ? '研究生入口' : '本科生入口'}：没有换到 token`);
    } catch (error) {
      // 单个入口失败不算致命：本科生走研究生入口本来就会拿到 500「无效的用户信息」。
      reasons.push(`${entry === 'graduate' ? '研究生入口' : '本科生入口'}：${error?.message ?? error}`);
    }
  }
  throw new YjsyError('REJECTED', `研究生教务网不让这个账号登录（${reasons.join('；')}）`);
}
