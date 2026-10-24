// 「规划」页：把四份东西并成一张表。
//
// # 四类数据源
//
//   学在浙大待办  ← 与智云共用 CAS 账号（配置在别处，本页只读）
//   拼题A 待办    ← Cookie，本页设置里单独粘贴（短信验证，无法自动登录）
//   中转站条目    ← 用户自己的创空间
//   本地留存      ← 中转站之上的一层缓存，中转站丢数据时页面不会变空
//
// 前三类是"来源"，第四类不是独立来源：它让中转站那份**即使对方挂掉也还在**。
//
// # 为什么待办和日记混在一张表
//
// 这一页回答的问题是"我接下来要做什么、我之前写了什么"。拆成两个 tab 会让人
// 来回切；而时间轴上一个"明天截止的作业"和"今天写的规划"本来就有先后关系。
// 所以统一成一条列表，用**左侧来源标**区分，排序按各自的紧迫度。
//
// # 版式依据
//
// 人体工效学 skill 的条款在 `style.css` 里逐条标注。
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Empty, Icon, Notice, mountStyle } from 'dsh-zhiyun-shell-ui';
import css from './style.css';
// 时间口径与错误文案是纯函数，放在 `time.js` / `error.js` 里：JSX 文件测试导不进来，
// 而这两个地方恰恰是最需要守卫的（时区错配、错误对象被字符串化成 [object Object]）。
import { FOCUS_LABEL, FOCUS_ORDER, focusOf, focusSummary, isNewArrival, quickTimes, dayKey, dayLabel, buildMonthCalendar } from './time.js';
import { REPEAT_LABEL } from './local.js';
import { createPetStream } from './pet-stream.js';
import { errorText } from './error.js';

export const name = 'zhiyun-page-planning-client';

/** 只要插槽：这一页不依赖智云账号，领域包停用时也要能打开。 */
export const inject = ['slots'];

/** 宿主注册的设置路由，与宿主 `src/index.js` 的 `ROUTE_PATH` 一致。 */
const ROUTE = '/_dsh/zhiyun-planning';

/** 写操作的自定义头，名字必须与宿主 `WRITE_HEADER` 一致。 */
const WRITE_HEADER = 'x-zhiyun-planning';

/** 与宿主 `MASK` 一致：回传这个值表示"不改密钥"。 */
const MASK = '********';

/**
 * 一次设置路由往返。
 *
 * 失败一律抛宿主给的原话 —— 域名格式、密钥长度这些规则的真源在宿主，
 * 页面自己再判一遍只会让"页面说能存"和"宿主拒绝"两句话对不上。
 * 拆 `error` 对象的活交给 `errorText`（见 `error.js` 上的说明）。
 *
 * @param action - `''`（读取）/ `'save'` / `'refresh'` / `'pta'` / `'plan'`。
 * @param body - POST 的请求体。
 * @returns 解析后的 JSON。
 */
async function settings(action = '', body) {
  const method = body ? 'POST' : 'GET';
  const response = await fetch(`${ROUTE}${action ? `?${action}` : ''}`, {
    method,
    headers: body ? { 'content-type': 'application/json', [WRITE_HEADER]: '1' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(errorText(payload.error, response.status));
  return payload;
}

/**
 * 条目的类别 → 标签、图标、边框样式。
 *
 * 边框样式（实线/虚线/点线/双线）是**形状通道**：颜色在灰度打印与色觉缺陷下会失效，
 * 而这一页同时出现五六种来源，只靠色相区分等于没区分（skill ch03 规则 3）。
 */
const KIND = {
  plan: { label: '规划', icon: 'calendar', cls: 'zpg-kind-plan' },
  diary: { label: '日记', icon: 'notebook', cls: 'zpg-kind-diary' },
  note: { label: '笔记', icon: 'fileText', cls: 'zpg-kind-note' },
  event: { label: '事件', icon: 'clock', cls: 'zpg-kind-event' },
  todo: { label: '学在浙大', icon: 'check', cls: 'zpg-kind-todo' },
  problemSet: { label: '拼题A', icon: 'bulb', cls: 'zpg-kind-pta' },
  // AI 拆出的卡片：它是"从你的笔记里提出来的具体动作"，来源标签要写明这点
  planCard: { label: 'AI 规划', icon: 'check', cls: 'zpg-kind-plan-card' },
};
const KIND_FALLBACK = { label: '记录', icon: 'fileText', cls: '' };

/** 时间戳（秒）→ 可读时刻。中转站存的是**秒**，不是毫秒。 */
function when(seconds) {
  if (!Number.isFinite(seconds)) return '';
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(date);
}

/** 截止时间（ISO 串）→ 可读时刻。 */
function whenIso(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(date);
}

/** 还剩多久：给人读的相对时间。比绝对时刻更能回答"急不急"。 */
function countdown(iso, now = Date.now()) {
  if (!iso) return '';
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return '';
  const ms = at - now;
  const abs = Math.abs(ms);
  const hours = Math.round(abs / 3600000);
  const days = Math.round(abs / 86400000);
  const body = hours < 24 ? `${hours} 小时` : `${days} 天`;
  return ms < 0 ? `已过期 ${body}` : `还剩 ${body}`;
}

/** 同一分类内的分组键：条目按天，待办按紧迫度（见 `time.js`）。 */

export function apply(ctx) {
  mountStyle(ctx, { attribute: 'zhiyunPlanningStyle', css, label: 'zhiyun: planning styles' });
  ctx.slots.inject('zhiyun.planning.content', () => ctx.slots.register(
    { name: 'zhiyun.planning.content' },
    // 把 ctx 传进去只为**惰性取** `zhiyunStudyController`（课表上下文）。
    // 不在 `apply` 时取：那个控制器由领域包的客户端半边提供，而本页在它停用时
    // 也要能打开（这是当初决定不与「今天」合并的核心理由）。
    () => <Planning ctx={ctx} />,
  ));
  // 设置集中在「个人 → 设置」：壳里的 PersonalSettingsBridge 会把所有
  // settings.section 按 order 摊成折叠分组，所以这里零改壳。
  //
  // ⚠️ **拆成两块**，不再合成一个「规划数据源」。理由：中转站与拼题A 是**互不相干**
  //    的两件事（一个是你自己的数据中转站，一个是第三方判题平台），
  //    它们共用同一个折叠分组只会让人以为"配完上面才轮到下面"。
  //    而且这两块将来都可能被别的页面用到，不该绑在"规划页"这个名字上。
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'zhiyun-pta',
    // 拼题A 排在个人中转站之前：它更常需要重配（Cookie 会过期）
    order: 65,
    label: () => '拼题A',
  }, PtaSection));
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'zhiyun-relay',
    order: 70,
    label: () => '个人中转站',
  }, RelaySection));
}

/**
 * 错误码 → 标题与下一步建议。
 *
 * ⚠️ 这里的「下一步」必须跟着**设置分区改名**一起更新。
 *    早先写着"去「个人 → 设置 → 规划数据源」"，而那个名字已经拆成
 *    「拼题A」与「个人中转站」两块 —— 文案不改，用户会去找一个不存在的入口。
 */
const ERROR = {
  NOT_CONFIGURED: { title: '还没有配置中转站', next: '去「设置 → 个人中转站」填域名和读密钥。' },
  // 学在浙大缺的是**账号**，不是 Cookie。而账号现在在「浙大一卡通」那一块配。
  NEED_LOGIN: {
    title: '还没配置浙大一卡通',
    next: '去「设置 → 浙大一卡通」填一次账号密码 —— 智云课堂与学在浙大共用这一份。',
  },
  KEY_REJECTED: {
    title: '读密钥被拒绝',
    next: '到「设置 → 个人中转站」核对读密钥；换过域名的话也要一起改。',
  },
  UNREACHABLE: { title: '连不上中转站', next: '确认那台创空间还在运行。本地已存的内容不受影响。' },
  UPSTREAM: { title: '中转站自己报错了', next: '打开域名看它的 /health 是否正常。' },
  BAD_PAYLOAD: { title: '返回的不是中转站格式', next: '确认这个域名指向的是中转站，而不是别的服务。' },
  IPC: { title: '设置接口不可用', next: '宿主侧没起来，重启一次工作台再试。' },
};

/** 空状态。列表形状集中一处，免得 `useState` 与 `apply` 两处漂移。 */
const EMPTY_SNAPSHOT = {
  entries: [], todos: null, remote: null, pta: null, plans: {}, local: [], ticks: {},
};

/**
 * 上一次**成功**读到的快照（模块级，跨挂载存活）。
 *
 * # 为什么必须有它（切页卡顿的真正原因）
 *
 * 壳每次切页都会**卸载**当前页组件、再挂载目标页（`renderSlot` 只渲染当前页）。
 * 于是每次回到「规划」都要走一遍：`loading = true` → 渲染占位 →
 * `await fetch()` → 再渲染真实内容。
 *
 * 也就是说——**哪怕服务端只用 50ms 返回，用户也会先看到一屏"正在读取"**，
 * 而如果那次请求恰好要重登 CAS，就是好几秒的白屏。用户感知到的"每次切都要
 * 加载"就是这个空窗，与有没有缓存无关：旧代码没有任何跨挂载的记忆。
 *
 * 放在模块作用域而不是 `useState`：页面组件被卸载后，模块本身仍在（ESM 只求值
 * 一次），所以这份值能跨挂载留下来。**它只影响首屏渲染，不改变任何数据语义**
 * —— 挂载后照常发一次请求，拿到新数据就覆盖。
 */
let lastSnapshot = null;

/** 页面正文。 */
export function Planning({ ctx }) {
  /**
   * 有缓存时**直接以缓存作为初始状态**，并把 `loading` 初始为 false。
   *
   * 这样切回来时第一帧就是上次的内容（用户看到的是"立刻出现"），随后后台
   * 请求回来再原地更新 —— 不再出现"先占位、再等待、再显示"的三段式抖动。
   */
  const [loading, setLoading] = useState(lastSnapshot === null);
  const [state, setState] = useState(() => lastSnapshot ?? EMPTY_SNAPSHOT);
  /**
   * 「刷新」按钮自己的忙态。
   *
   * 与 `loading` 分开：`loading` 的语义是"还没有内容可显示"（整页占位），
   * 而刷新时内容明明在屏幕上，把它打回占位等于点了刷新先丢内容。
   */
  const [refreshing, setRefreshing] = useState(false);
  // 规划是花钱且耗时的操作，单独状态：它不该让整页进"loading"把已有内容藏起来
  const [planning, setPlanning] = useState(false);
  const [planMsg, setPlanMsg] = useState(null);
  const [error, setError] = useState(null);
  // 写入口自己的状态：提交中 / 失败原因。**不**复用整页的 loading，
  // 否则写一条规划会让整页闪成"正在读取待办与中转站"。
  const [composer, setComposer] = useState({ busy: false, error: null });
  // 单条规划正在跑 AI 拆分时的 id（只灰掉那一条，不是整页）
  const [busyId, setBusyId] = useState(null);
  // 课表上下文：读不到就不显示，绝不因此让页面报错
  const [schedule, setSchedule] = useState(null);
  /**
   * 视图：列表 / 日历。
   *
   * 默认列表。日历是**同一批数据的另一种呈现**，不是另一个数据源 —— 所以切换
   * 不触发任何请求，也不改变谁被算作"待办"。
   */
  const [view, setView] = useState('list');
  /**
   * 日历当前看的是哪个月（相对本月偏移）。
   *
   * `0` = 本月。用 `<` `>` 改成 -1 / +1，切回本月用「回到本月」按钮。
   * 放在页面级而不是 CalendarView 内：切到列表再切回来时，用户希望
   * 还停在刚才那个月，而不是被打回本月。
   */
  const [monthOffset, setMonthOffset] = useState(0);

  const apply = useCallback((payload) => {
    const next = {
      entries: Array.isArray(payload.entries) ? payload.entries : [],
      todos: payload.todos ?? null,
      remote: payload.remote ?? null,
      pta: payload.pta ?? null,
      plans: payload.plans ?? {},
      local: Array.isArray(payload.local) ? payload.local : [],
      ticks: payload.ticks && typeof payload.ticks === 'object' ? payload.ticks : {},
    };
    setState(next);
    // 记下来供**下次挂载**直接用（见 `lastSnapshot` 的说明）。只存成功读到的。
    lastSnapshot = next;
    // 只有中转站这条链路会给出"整页级"错误；待办各自的错误在各自区块里说
    setError(payload.remote?.error ?? null);
  }, []);

  const load = useCallback(async () => {
    /**
     * ⚠️ **已经有内容时不要把整页打回 loading。**
     *
     * 旧代码一进来就 `setLoading(true)`，于是切回来先看到一屏"正在读取"，
     * 等请求回来才换成真实内容 —— 哪怕服务端只要 50ms，也会闪一下；要重登
     * CAS 就是好几秒白屏。这正是"每次切都要加载"的观感来源。
     *
     * 现在只有**真的没东西可显示**（无缓存）时才进 loading；有缓存就原地更新。
     */
    setLoading(lastSnapshot === null);
    try {
      apply(await settings(''));
    } catch (failure) {
      setError({ code: 'IPC', message: failure.message });
    } finally {
      setLoading(false);
    }
  }, [apply]);

  useEffect(() => { void load(); }, [load]);

  const refresh = async () => {
    // 手动刷新：**保留当前内容**，只让按钮自己置忙。
    // 不能复用 `loading` —— 那会把整页打回占位，用户点了刷新反而先丢内容。
    setRefreshing(true);
    try {
      apply(await settings('refresh', {}));
    } catch (failure) {
      setError({ code: 'IPC', message: failure.message });
    } finally {
      setRefreshing(false);
    }
  };

  /**
   * 跑一次 AI 自动规划。
   *
   * 失败**不弹 alert**：宿主没有可靠的 alert 面，弹出来还会打断阅读。
   * 结果写进 planMsg，在页头下方那一行就地显示（成功与失败都在同一处）。
   */
  const runPlan = async () => {
    setPlanning(true);
    setPlanMsg(null);
    try {
      const payload = await settings('plan', {});
      apply(payload);
      // ⚠️ `NO_PENDING` 回的是 **200 + ok:false**：它不是故障，是"没有活干"，
      // 所以不能当 HTTP 错误处理。但它也不是成功 —— 不认这一位，
      // 宿主那句说明就会被当成功结果无声吞掉（下一条分支才是它的落点）。
      if (payload.ok === false) {
        const reason = errorText(payload.error, 200);
        setPlanMsg({ kind: 'error', text: reason });
        return;
      }
      // ⚠️ `planned` 是**这次拆了几条原文**（数字），不是已拆过的键名单 ——
      // 那份名单叫 `plannedKeys`。两者同名过一次，数组盖掉数字，
      // 于是拆出 24 张卡片的成功结果被显示成"没有新的条目需要规划"。
      const created = payload.created ?? 0;
      const plannedCount = typeof payload.planned === 'number' ? payload.planned : 0;
      const dropped = payload.dropped ?? 0;
      const orphans = payload.orphans ?? 0;
      // 对不上原文的卡片会进 `orphans`（宿主只报个数）。真丢了就要说出来 ——
      // 与 `dropped` 同样的口径，不能一个报一个不报。
      const notes = [];
      if (dropped > 0) notes.push(`丢弃 ${dropped} 张不合规`);
      if (orphans > 0) notes.push(`${orphans} 张对不上原文`);
      setPlanMsg({
        kind: 'ok',
        text: `已把 ${plannedCount} 条原文拆成 ${created} 张卡片${notes.length ? `（${notes.join('，')}）` : ''}`,
      });
    } catch (failure) {
      setPlanMsg({ kind: 'error', text: failure.message });
    } finally {
      setPlanning(false);
    }
  };

  /** 忘掉某条原文的拆分结果，让它下次重新参与规划。 */
  const forgetPlan = async (prefix) => {
    setPlanMsg(null);
    try {
      apply(await settings('plan-forget', { prefix }));
    } catch (failure) {
      setPlanMsg({ kind: 'error', text: failure.message });
    }
  };

  const todos = useMemo(() => {
    const xzzd = state.todos?.xzzd ?? { rows: [], error: null };
    const pta = state.todos?.pta ?? { rows: [], error: null };
    const ticks = state.ticks ?? {};
    /**
     * 把本机勾选**并进**平台待办行。
     *
     * 不并的话，页面拿到的还是"平台说未完成"，用户勾过的条目会在每次刷新后
     * 弹回未勾 —— 那比不能勾更让人困惑。
     */
    const withTicks = (rows) => (rows ?? []).map((row) => {
      const tick = ticks[`${row.source}:${row.id}`];
      return { ...row, done: Boolean(tick), doneAt: tick?.doneAt ?? null };
    });
    return {
      rows: [...withTicks(xzzd.rows), ...withTicks(pta.rows)],
      xzzdError: xzzd.error,
      ptaError: pta.error,
    };
  }, [state.todos, state.ticks]);

  /* ── 「我的规划」：写、改、勾、删、拆 ──────────────────────────────── */

  /**
   * 把本地规划折成与待办同形状的行。
   *
   * 为什么折而不是单独一套渲染：它们在页面上就是"要去做的事"，和学在浙大待办
   * 同池排序才有意义（不然"周三交作业"和"我自己记的周三交报告"会分两处出现）。
   * `source: 'mine'` 是唯一的区别标记，页面据此换成可勾选的那一版行。
   */
  const localRows = useMemo(() => (state.local ?? []).map((item) => ({
    source: 'mine',
    sourceLabel: '我的规划',
    id: item.id,
    title: item.title,
    detail: item.detail ?? '',
    due: item.due ?? null,
    dueText: null,
    url: null,
    kind: 'mine',
    done: Boolean(item.done),
    doneAt: item.doneAt ?? null,
    repeat: item.repeat ?? null,
    splitInto: Array.isArray(item.splitInto) ? item.splitInto : [],
    splitFrom: item.splitFrom ?? null,
    createdAt: item.createdAt ?? 0,
  })), [state.local]);

  /**
   * ⚠️ 这里曾经有一个 `mutate()` 包装：统一"置忙 → 等往返 → `apply(整份快照)`"。
   *
   * 它已经被逐个替换掉了 —— 本页的写操作分两类，**都不该走那条路**：
   *
   *   · 纯本端（勾选 / 增删改 / 忘掉拆分）→ 乐观更新，本地改完即最终状态；
   *   · 调 AI（拆分）→ 只有模型给得出结果，但只回 `local`，不回整份快照。
   *
   * 留着它只会诱使后来者继续走"等一整份快照"的旧路，所以删掉。
   */

  /**
   * pet 里确认后新建的条目，接到列表上。
   *
   * pet 走的是同一条 `local-create`，但它拿到的 `item` 在**自己那一层**，
   * 需要回传给页面才能立刻出现在列表里 —— 否则用户刚在气泡里点了「好」，
   * 列表里却没有，要刷新才看得到。
   *
   * @param item - 服务端回的新条目。
   */
  const adoptCreated = useCallback((item) => {
    if (!item?.id) return;
    setState((current) => {
      const local = current.local ?? [];
      // 幂等：同一个 id 不重复插（重放/双触发时不该出现两条）
      if (local.some((row) => row.id === item.id)) return current;
      return { ...current, local: [...local, item] };
    });
  }, []);

  /**
   * 把一句话变成一条**自己写的**规划。
   *
   * 这是唯一不能完全乐观的操作：新条目的 `id` / `createdAt` 由服务端生成，
   * 本地编不出来。但也不必等整份快照 —— 服务端只回这一条 `item`，
   * 拿到就插进列表，界面从"提交中"到"出现"只有一次往返。
   *
   * @returns 新建的条目（供输入框清空用），失败则 null。
   */
  const createPlan = useCallback(async (input) => {
    setComposer({ busy: true, error: null });
    try {
      const payload = await settings('local-create', input);
      if (payload?.ok === false) throw new Error(errorText(payload.error, 200));
      const item = payload?.item ?? null;
      if (item) {
        setState((current) => ({ ...current, local: [...(current.local ?? []), item] }));
      }
      return item;
    } catch (failure) {
      setComposer({ busy: false, error: failure.message });
      return null;
    } finally {
      setComposer((current) => ({ ...current, busy: false }));
    }
  }, []);

  /**
   * 勾掉一条**自己写的**规划（纯本端，乐观更新）。
   */
  /**
   * 勾一条「我的规划」。
   *
   * # 重复任务会带回下一次
   *
   * 服务端在勾完成时**顺带生成下一次**（在同一次落盘里，见 `local.js` 的
   * `setDone`），并把它放在 `payload.next` 回来。这里要把 `next` 也插进列表 ——
   * 否则用户勾完只看见这一条被划掉，会以为「重复」没生效，而实际上它已经
   * 写进文件了，只是这次页面没刷新出来（下次打开才冒出来，那更困惑）。
   *
   * 乐观更新只动**当前这一条的勾选态**：下一次的 id 由服务端生成，
   * 本地编不出来，所以它一定是等回来的。
   */
  const togglePlan = useCallback(async (row) => {
    const nextDone = !row.done;
    const before = state.local ?? [];
    setState((current) => ({
      ...current,
      local: (current.local ?? []).map((item) => (
        item.id === row.id ? { ...item, done: nextDone, doneAt: nextDone ? Date.now() : null } : item
      )),
    }));
    try {
      const payload = await settings('local-done', { id: row.id, done: nextDone });
      if (payload?.ok === false) throw new Error(errorText(payload.error, 200));
      const created = payload?.next ?? null;
      if (created) {
        setState((current) => ({
          ...current,
          local: [...(current.local ?? []), created],
        }));
        const when = created.due ? whenIso(created.due) : null;
        setPlanMsg({ kind: 'ok', text: `这条会重复，下一次${when ? `排在 ${when}` : '已生成'}` });
      }
    } catch (failure) {
      setState((current) => ({ ...current, local: before }));
      setPlanMsg({ kind: 'error', text: `勾选没有保存：${failure.message}` });
    }
  }, [state.local]);

  /**
   * 勾掉一条**平台待办**（学在浙大 / 拼题A）。
   *
   * # 状态完全在本端，所以必须**乐观更新**
   *
   * 网关只传待办内容，不传状态；"勾没勾"只存在本机 `ticks.json` 里。
   * 也就是说这一个动作**不依赖任何远端结果** —— 本地改完就已经是最终状态。
   *
   * 所以这里先改 `state.ticks`（界面立刻变），再异步把这一次写下去。
   * 之前走统一的 `mutate()`：那会先置忙态、等一轮往返、再拿回**整份快照**
   * 才更新界面。数据没错，但用户点一下要等「网络 + 快照重算」才看到勾，
   * 对"本端状态"这种事来说是没必要的延迟。
   *
   * 失败处理：把乐观改动**回滚**，并把原因显示出来 —— 不能让用户以为勾上了
   * 而磁盘上其实没写进去（下次打开又会弹回未勾）。
   */
  const toggleTodo = useCallback(async (row) => {
    const key = `${row.source}:${row.id}`;
    const nextDone = !row.done;
    const before = state.ticks ?? {};

    // ① 本地立刻生效
    setState((current) => {
      const ticks = { ...(current.ticks ?? {}) };
      if (nextDone) ticks[key] = { doneAt: Math.floor(Date.now() / 1000) };
      else delete ticks[key];
      return { ...current, ticks };
    });

    // ② 再把它写下去（不阻塞界面）
    try {
      const payload = await settings('todo-done', { source: row.source, id: row.id, done: nextDone });
      if (payload?.ok === false) throw new Error(errorText(payload.error, 200));
      /**
       * ⚠️ 这里**不调用 `apply(payload)`**。
       *
       * 服务端回的是整份快照，展开它会用服务端的 `ticks` 覆盖本地刚做的乐观
       * 改动；两者理论上一致，但多此一举，且会让刚更新的界面再抖一次。
       * 只要 `ticks[key]` 与 `payload.ticks[key]` 一致就无事可做。
       */
    } catch (failure) {
      // 回滚：磁盘没写成功就不能让界面显示"已勾"
      setState((current) => ({ ...current, ticks: before }));
      setPlanMsg({ kind: 'error', text: `勾选没有保存：${failure.message}` });
    }
  }, [state.ticks]);

  /**
   * 勾选 AI 拆出的卡片（状态落在 `plans.json`，不碰中转站）。
   *
   * 同样是**纯本端状态**，所以乐观更新：先改 `state.plans`，再异步写盘。
   * 卡片没有自己的 id，定位是 `prefix + index`。
   */
  const toggleCard = useCallback(async (row) => {
    const nextDone = !row.done;
    const before = state.plans ?? {};

    const patchCards = (plans, prefix, index, done) => {
      const entry = plans?.[prefix];
      if (!entry || !Array.isArray(entry.cards)) return plans;
      return {
        ...plans,
        [prefix]: {
          ...entry,
          cards: entry.cards.map((card, i) => (i === index ? { ...card, done } : card)),
        },
      };
    };

    // ① 本地立刻生效
    setState((current) => ({
      ...current,
      plans: patchCards(current.plans ?? {}, row.prefix, row.index, nextDone),
    }));

    // ② 再写下去
    try {
      const payload = await settings('plan-card-done', {
        prefix: row.prefix, index: row.index, done: nextDone,
      });
      if (payload?.ok === false) throw new Error(errorText(payload.error, 200));
    } catch (failure) {
      setState((current) => ({ ...current, plans: before }));
      setPlanMsg({ kind: 'error', text: `卡片勾选没有保存：${failure.message}` });
    }
  }, [state.plans]);

  /**
   * 删掉一条**自己写的**规划。
   *
   * ⚠️ 只对 `source === 'mine'` 的条目开放 —— 网关来的条目（中转站 / 学在浙大 /
   * 拼题A）**不允许增删改**，那边是别人或平台的权威数据，本页只读。
   */
  const removePlan = useCallback(async (row) => {
    const before = state.local ?? [];
    // ① 本地立刻消失
    setState((current) => ({
      ...current, local: (current.local ?? []).filter((item) => item.id !== row.id),
    }));
    try {
      const payload = await settings('local-remove', { id: row.id });
      if (payload?.ok === false) throw new Error(errorText(payload.error, 200));
    } catch (failure) {
      setState((current) => ({ ...current, local: before }));
      setPlanMsg({ kind: 'error', text: `删除没有保存：${failure.message}` });
    }
  }, [state.local]);

  /**
   * 改一条**自己写的**规划（同样是纯本端）。
   *
   * `patch` 里只可能有 title / detail / due —— 完成状态归 `togglePlan`。
   */
  const editPlan = useCallback(async (row, patch) => {
    const before = state.local ?? [];
    // ① 本地立刻生效
    setState((current) => ({
      ...current,
      local: (current.local ?? []).map((item) => (item.id === row.id ? { ...item, ...patch } : item)),
    }));
    try {
      const payload = await settings('local-update', { id: row.id, ...patch });
      if (payload?.ok === false) throw new Error(errorText(payload.error, 200));
      // 服务端可能做了规范化（去空白、截断），以它回的为准 —— 仍不是整份快照
      if (payload?.item) {
        setState((current) => ({
          ...current,
          local: (current.local ?? []).map((item) => (item.id === row.id ? { ...item, ...payload.item } : item)),
        }));
      }
    } catch (failure) {
      setState((current) => ({ ...current, local: before }));
      setPlanMsg({ kind: 'error', text: `修改没有保存：${failure.message}` });
    }
  }, [state.local]);

  /**
   * 让 AI 拆一条**自己写的**规划。
   *
   * # 这个**不能**乐观更新 —— 它要调 LLM
   *
   * 与「忘掉拆分」不同：拆分的结果（拆出哪几条、每条叫什么）只有模型给得出来，
   * 本地编不出来。所以它必须等一次真实往返，而那次往返通常是**几秒**。
   *
   * 能优化的是**响应感**，不是延迟本身：
   *   1. 点下去立刻进入忙态（`busyId`），按钮变「正在拆分…」；
   *   2. 同时给一条「正在让 AI 拆分…」的提示 —— 几秒的等待里，
   *      界面必须立刻承认"我收到了"，否则用户会以为没点中而重复点。
   *
   * 不假装它零延迟：给一个假的即时结果，比让它等更糟。
   */
  const splitPlan = useCallback(async (row) => {
    const force = row.splitInto.length > 0;
    // 立刻进入忙态：这一步必须是同步的，且在 await 之前
    setBusyId(row.id);
    setPlanMsg({ kind: 'ok', text: `正在让 AI 拆分「${row.title}」…` });
    try {
      const payload = await settings(force ? 'local-split-force' : 'local-split', { id: row.id });
      if (payload?.ok === false) throw new Error(errorText(payload.error, 200));
      const split = payload.split ?? 0;
      const extra = [];
      if (payload.removed) extra.push(`清掉旧的 ${payload.removed} 条`);
      if (payload.dropped) extra.push(`丢弃 ${payload.dropped} 张不合规`);
      setPlanMsg({
        kind: 'ok',
        text: `已把「${row.title}」拆成 ${split} 条${extra.length ? `（${extra.join('，')}）` : ''}`,
      });
      /**
       * 拆分**改变了条目结构**（多了子项、源条目多了 splitInto），所以这里
       * 必须用服务端回的数据刷新，不能只改本地一处 —— 与纯本端的勾选不同。
       */
      if (Array.isArray(payload.local)) {
        setState((current) => ({ ...current, local: payload.local }));
      }
    } catch (failure) {
      setPlanMsg({ kind: 'error', text: `拆分没有完成：${failure.message}` });
    } finally {
      setBusyId(null);
    }
  }, []);

  /**
   * 忘掉一次拆分：删掉拆出的子项，让源条目回到"还没拆"。
   *
   * # 这是纯本端操作，必须乐观更新
   *
   * 它只改 `local.json`：把源条目的 `splitInto` 清空、删掉它拆出的子项。
   * 不碰中转站，也不产生任何远端数据 —— 所以本地改完就是最终状态。
   *
   * 之前走 `mutate()`：等一轮往返、拿回整份快照、再替换整个 state。
   * 对一个纯本端操作来说，那让用户白等一次几十 KB 的重算与序列化。
   */
  const unsplitPlan = useCallback(async (row) => {
    const before = state.local ?? [];
    /**
     * ① 本地立刻生效。
     *
     * 要同时做两件事：删掉 `splitFrom === row.id` 的子项，并把源条目的
     * `splitInto` 清空。只做前一件的话，源条目上还挂着"已拆 2 条"的标签，
     * 但下面一条子项都没有 —— 那比不生效更让人困惑。
     */
    setState((current) => ({
      ...current,
      local: (current.local ?? [])
        .filter((item) => item.splitFrom !== row.id)
        .map((item) => (item.id === row.id ? { ...item, splitInto: [] } : item)),
    }));
    try {
      const payload = await settings('local-unsplit', { id: row.id });
      if (payload?.ok === false) throw new Error(errorText(payload.error, 200));
    } catch (failure) {
      // 回滚：磁盘没清掉就不能让界面显示"已忘掉"
      setState((current) => ({ ...current, local: before }));
      setPlanMsg({ kind: 'error', text: `忘掉拆分没有保存：${failure.message}` });
    }
  }, [state.local]);

  /**
   * 读今天的课表，作为规划的**上下文**。
   *
   * 为什么是上下文而不是合并：`zhiyunStudyController` 属于领域包，可能没装、
   * 可能没登录 —— 拿不到就安静地不显示，绝不让这一页因此报错或空掉。
   * 这正是当初决定"两个页面不合并"的理由，这里必须守住。
   *
   * 数据只用于一件事：把"这天有没有课"标在截止时间旁边，让人在拆规划时看得见
   * 那天的实际压力。
   */
  useEffect(() => {
    const controller = ctx?.get?.('zhiyunStudyController');
    if (!controller || typeof controller.subscribe !== 'function') return undefined;
    let loadedUser = null;
    const read = () => {
      try {
        const snapshot = controller.getSnapshot?.();
        // 没登录就没有课表 —— 不是错误，只是没有这条上下文
        setSchedule(snapshot?.user ? (snapshot.schedule ?? null) : null);
        const user = snapshot?.user ?? null;
        if (user !== loadedUser) {
          loadedUser = user;
          if (user) Promise.resolve(controller.loadSchedule?.()).catch(() => {});
        }
      } catch {
        // 控制器内部状态异常也只是"没有课表"，绝不冒泡成页面错误
        setSchedule(null);
      }
    };
    read();
    return controller.subscribe(read);
  }, [ctx]);

  /**
   * 合成一条时间轴。
   *
   * 待办按**紧迫度**排在最前（它们是"要去做的事"），条目按**时间倒序**跟在后面。
   * 不混排成一条绝对时间线的理由：待办的时间是"截止"（未来），条目的时间是"写下"
   * （过去），两个方向的时间放在一个序列里会读起来矛盾。
   */
  /**
   * 把 AI 拆出的卡片**升格成待办**，按它们自己的截止时间进「一周内 / 更晚」。
   *
   * 这正是"拆分"这个动作的价值所在：源条目是"一段话"，卡片才是"要做的具体事"。
   * 如果卡片只藏在源条目的展开区里，用户还是得逐条翻开才知道本周要做什么 ——
   * 那就等于没拆。
   *
   * 卡片没有截止时间（`due: null`，原文确实没写）时归到 `none`，不硬塞进某档。
   */
  const planCards = useMemo(() => {
    const rows = [];
    for (const [prefix, plan] of Object.entries(state.plans ?? {})) {
      const cards = Array.isArray(plan?.cards) ? plan.cards : [];
      cards.forEach((card, index) => {
        rows.push({
          source: 'plan',
          sourceLabel: 'AI 规划',
          id: `${prefix}#${index}`,
          title: card.title,
          detail: card.sourceTitle ? `来自：${card.sourceTitle}` : '',
          due: card.due ?? null,
          dueText: null,
          url: null,
          kind: 'planCard',
          action: card.action,
          tags: Array.isArray(card.tags) ? card.tags : [],
          prefix,
          // 卡片也能勾完成：状态存在 plans.json 的 cards[i].done 上。
          // 中转站那边只读，所以"我做完了"是本机的事实，不写回去。
          index,
          done: Boolean(card.done),
          doneAt: card.doneAt ?? null,
        });
      });
    }
    return rows;
  }, [state.plans]);

  /**
   * 「还没做」的几份切片 —— **必须在 `groups` / `calendar` 之前声明**。
   *
   * ⚠️ 这几个 `const` 曾经写在 `groups` 之后，而 `groups` 的 `useMemo` 体里直接
   *    引用了它们。`const` 有暂时性死区，于是页面首次渲染就抛
   *    `Cannot access 'openTodos' before initialization` —— 表现为**整页白屏**。
   *    构建不会报这种错（它只管语法与类型无关），只有真正跑起来才炸。
   */
  const openMine = useMemo(() => localRows.filter((row) => !row.done), [localRows]);
  const doneMine = useMemo(() => localRows.filter((row) => row.done), [localRows]);
  /** 已完成里的 AI 卡片。 */
  const doneCards = useMemo(() => planCards.filter((row) => row.done), [planCards]);
  /**
   * 已完成的平台待办（本机勾掉的）。
   *
   * 它只在本页算完成（`ticks.json` 里的标记），平台那边没变 —— 所以它出现在
   * 「已完成」里时，那一行仍然带着「平台状态没变」的说明。
   */
  const doneTodos = useMemo(() => todos.rows.filter((row) => row.done), [todos.rows]);
  /**
   * **还没做**的平台待办。
   *
   * 分组与日历都只看这一份：勾掉的条目不该继续占着「已过期 / 今天截止」这些位置，
   * 否则勾了它还在最显眼处 —— 那勾选就没意义了。
   */
  const openTodos = useMemo(() => todos.rows.filter((row) => !row.done), [todos.rows]);

  /**
   * 新到的网关条目（48 小时内入库）。
   *
   * 用户「可能还不知道」的东西 —— 这一页的职责之一就是告诉他，而不是等他
   * 自己一条条翻。判据用 `cachedAt`（首次入库时刻），不需要额外的"已读"状态。
   */
  const newEntries = useMemo(() => {
    const now = Date.now();
    return (state.entries ?? []).filter((row) => isNewArrival(row.cachedAt, now));
  }, [state.entries]);

  const newArrivals = newEntries.length;

  /** 顶部摘要：过期 / 24h 内 / 今天之内 / 新到。只统计未完成项。 */
  const focus = useMemo(
    () => focusSummary({ openTodos: [...openTodos, ...openMine, ...planCards.filter((r) => !r.done)], newArrivals }),
    [openTodos, openMine, planCards, newArrivals],
  );

  const groups = useMemo(() => {
    const now = Date.now();
    const buckets = new Map();
    // 待办与拆出的卡片**同池**：它们都是"要去做的事"，只是来源不同。
    // ⚠️ 只放**还没做**的：勾掉的条目继续留在「已过期」里，等于勾了也没用。
    for (const row of [...openTodos, ...planCards.filter((row) => !row.done), ...openMine]) {
      const key = `todo:${focusOf(row.due, now)}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(row);
    }
    const todoGroups = FOCUS_ORDER
      .filter((key) => buckets.has(`todo:${key}`))
      .map((key) => ({
        key,
        label: FOCUS_LABEL[key],
        rows: buckets.get(`todo:${key}`).sort((a, b) => {
          const at = a.due ? Date.parse(a.due) : Infinity;
          const bt = b.due ? Date.parse(b.due) : Infinity;
          return at - bt;
        }),
      }));

    const byDay = [];
    /**
     * ⚠️ 新到的条目**不进日期组**：它们已经被提到页面最前面的「新到」那一块。
     * 两处各出现一次会让人以为同一条被推了两遍。
     */
    for (const entry of state.entries) {
      if (isNewArrival(entry.cachedAt, now)) continue;
      // 分组键与标签**必须同一时区**，否则跨 UTC 日界的条目会分成两个同名组。
      // 见 `dayKey` 上的注释。
      const key = dayKey(entry.at);
      const last = byDay[byDay.length - 1];
      if (last && last.key === key) last.rows.push(entry);
      else byDay.push({ key, label: dayLabel(entry.at), rows: [entry] });
    }
    // 条目是"写下的"，最近的在上
    byDay.reverse();
    for (const group of byDay) group.rows.reverse();

    return { todoGroups, entryGroups: byDay };
  }, [openTodos, state.entries, planCards, openMine]);

  /**
   * 日历视图的格子：只收**有确定截止时间**的事。
   *
   * 为什么只收有日期的：这一页的多数条目 `due` 是 null（写的时候不逼着填时间），
   * 而中转站条目是"写下"而不是"截止"。把它们塞进日历的某一天是编造时间。
   * 没有日期的那部分仍然留在列表里，一条不少。
   */
  const calendar = useMemo(() => buildMonthCalendar([
    ...openTodos,
    ...planCards.filter((row) => !row.done),
    ...openMine,
  ], { monthOffset }), [openTodos, planCards, openMine, monthOffset]);

  // 卡片已经并进 todos.rows 之外的 planCards，二者都是"要做的"
  const hasAnything = todos.rows.length > 0 || planCards.length > 0 || state.entries.length > 0 || localRows.length > 0;

  return (
    <div className="zpg-page">
      {/*
        ⚠️ **这里刻意没有大标题。**

        侧栏已经写着「规划」，页面里再写一遍「规划」+ 一句「写下要做的事…」
        是纯重复 —— 用户不需要被告知自己在哪一页。同类的工作型页面（笔记）
        也是这样直接进内容的；只有「今天」那种欢迎性质的首页才需要大标题。

        留下的只有一条**极轻的工具行**：左侧是规模数字，右侧是真正有用的
        四个动作（视图切换 / AI 规划 / 刷新）。它不占据视线，但随时够得到。
      */}
      <div className="zpg-head">
        <span className="zpg-count">
          {!loading ? summarize(todos.rows.length + planCards.length + localRows.length, state.entries.length) : ''}
        </span>
        <div className="zpg-tools">
          {/* 视图切换：列表 / 日历。日历只呈现有截止时间的事，切换不发请求。 */}
          <span className="zpg-view" role="group" aria-label="视图">
            <button
              type="button"
              className={view === 'list' ? 'zpg-view-on' : ''}
              aria-pressed={view === 'list'}
              onClick={() => setView('list')}
            >
              列表
            </button>
            <button
              type="button"
              className={view === 'calendar' ? 'zpg-view-on' : ''}
              aria-pressed={view === 'calendar'}
              onClick={() => setView('calendar')}
            >
              日历
            </button>
          </span>
          <button
            type="button"
            className="zy-secondary zpg-plan"
            onClick={runPlan}
            disabled={loading || planning || !hasAnything}
            title="把中转站里混杂的条目按事项拆成卡片"
          >
            <Icon name="bulb" size={16} />
            {planning ? '正在规划…' : 'AI 拆解'}
          </button>
          <button
            type="button"
            className="zy-secondary zpg-refresh"
            onClick={refresh}
            disabled={loading || refreshing || planning}
            title="重新拉一次平台待办与中转站"
          >
            <Icon name="history" size={16} />
            {refreshing ? '正在刷新' : '刷新'}
          </button>
          {/*
            添加入口放在工具行，与「刷新」「AI 拆解」并列。
            放在页面底部意味着**每次新建都要先滚到底** —— 长列表下这是
            每天十几次的多余动作。放到这里：想看的时候它不抢眼，想写的时候
            就在手边。输入面板从这一行**向下展开**，而不是右下角浮出来。
          */}
          <PlanComposer
            busy={composer.busy}
            error={composer.error}
            onCreate={createPlan}
            schedule={schedule}
          />
        </div>
      </div>

      {loading && (
        <div className="zpg-slot" role="status" aria-live="polite">
          <p className="zpg-status"><span className="zpg-dot" aria-hidden="true" />正在读取待办与中转站…</p>
        </div>
      )}

      {!loading && (
        <div className="zpg-slot">
          {planMsg && (
            <p className={`zpg-plan-msg ${planMsg.kind === 'error' ? 'zpg-plan-msg-error' : ''}`} role="status">
              {planMsg.text}
            </p>
          )}

          <SourceBar
            todos={todos}
            pta={state.pta}
            remote={state.remote}
            entryCount={state.entries.length}
            mineCount={localRows.length}
          />

          {error && <ErrorBlock error={error} />}

          {/*
            顶部摘要条：一眼回答"现在最该关心什么"。
            只显示**非零**的项 —— 一屏全是 0 的卡片既占地方又没信息。
            点一下滚到对应分组，是"结论 + 入口"而不仅是个数字。
          */}
          <FocusBar focus={focus} />

          {!hasAnything && !error && (
            <Empty icon="calendar" title="还没有内容">
              上面写一条规划就能开始；也可以在「个人 → 设置 → 规划数据源」配好数据源，
              让待办与中转站的内容也出现在这里。
            </Empty>
          )}

          {/*
            已完成：**折叠成一行**。

            用户勾掉一件事，就是不想再被它提醒。把它整块摊在列表里（哪怕是
            末尾）等于继续占着视觉重量。折成一行之后：平时只有「已完成 12 条」，
            想回看就点开 —— 是"随时能查"，而不是"一直在眼前"。

            用原生 `<details>`：键盘可用、无需 JS 状态、默认收起。
          */}
          {(doneMine.length > 0 || doneCards.length > 0 || doneTodos.length > 0) && (
            <details className="zpg-done-fold">
              <summary>
                <Icon name="check" size={15} />
                <span>已完成 {doneMine.length + doneCards.length + doneTodos.length} 条</span>
                <small>点开查看</small>
              </summary>
              <ul className="zpg-list zpg-done-list">
                {doneMine.map((row) => (
                  <MineRow
                    key={row.id}
                    row={row}
                    onToggle={togglePlan}
                    onRemove={removePlan}
                    onEdit={editPlan}
                    onSplit={splitPlan}
                    onUnsplit={unsplitPlan}
                    busy={busyId === row.id}
                    schedule={schedule}
                  />
                ))}
                {doneCards.map((row) => (
                  <CardRow key={row.id} row={row} onToggle={toggleCard} busy={busyId === row.id} />
                ))}
                {/* 本机勾掉的平台待办：每一行仍带着「平台状态没变」的说明 */}
                {doneTodos.map((row) => (
                  <TodoRow
                    key={`${row.source}:${row.id}`}
                    row={row}
                    onToggle={toggleTodo}
                    busy={busyId === `todo:${row.source}:${row.id}`}
                  />
                ))}
              </ul>
            </details>
          )}

          {view === 'calendar' ? (
            <CalendarView
              calendar={calendar}
              onToggle={toggleCard}
              onTogglePlan={togglePlan}
              onToggleTodo={toggleTodo}
              busyId={busyId}
              monthOffset={monthOffset}
              onShiftMonth={(delta) => setMonthOffset((current) => (delta === 0 ? 0 : current + delta))}
            />
          ) : (
            <>
              {/* 待办分组：平台待办、自己写的、AI 拆出的**同池**按紧迫度排，
                  但各自用不同形态 —— 它们能被做的动作不一样。 */}
              {groups.todoGroups.length > 0 && (
                <div className="zpg-days">
                  {groups.todoGroups.map((group) => (
                    <section key={group.key} className={`zpg-day ${group.key === 'overdue' ? 'zpg-day-overdue' : ''}`} aria-labelledby={`zpg-${group.key}`}>
                      {/*
                        用**轻量分组标签**而不是外壳的 `SectionTitle`（它渲染 `<h2>`）。
                        一页有六档分组，六个 `<h2>` 会让"分组"看起来比"条目"还重 ——
                        而这些标签只是路标，不是章节标题。
                      */}
                      <GroupLabel id={`zpg-${group.key}`} count={group.rows.length} tone={group.key}>
                        {group.label}
                      </GroupLabel>
                      <ul className="zpg-list">
                        {group.rows.map((row) => {
                          if (row.source === 'mine') {
                            return (
                              <MineRow
                                key={row.id}
                                row={row}
                                onToggle={togglePlan}
                                onRemove={removePlan}
                                onEdit={editPlan}
                                onSplit={splitPlan}
                                onUnsplit={unsplitPlan}
                                busy={busyId === row.id}
                                schedule={schedule}
                              />
                            );
                          }
                          if (row.source === 'plan') {
                            return <CardRow key={row.id} row={row} onToggle={toggleCard} busy={busyId === row.id} />;
                          }
                          // 学在浙大 / 拼题A：平台数据，只读 + 外链
                          return (
                            <TodoRow
                              key={`${row.source}:${row.id}`}
                              row={row}
                              onToggle={toggleTodo}
                              busy={busyId === `todo:${row.source}:${row.id}`}
                            />
                          );
                        })}
                      </ul>
                    </section>
                  ))}
                </div>
              )}

              {/*
                新到的网关条目：**单独提到最前**。

                这些是别人往中转站里加的、用户可能还不知道的内容 —— 摘要条里
                那个「新到 N」就跳到这里。列在按日期分的条目组之前，因为
                "我不知道有新东西"比"某天写了什么"更值得先说。

                ⚠️ 只把这批条目**移到前面**，不在日期组里删掉它们 ——
                否则同一批内容会在两个地方各出现一次，让人以为重复了。
              */}
              {newEntries.length > 0 && (
                <div className="zpg-days">
                  <section className="zpg-day zpg-day-new" aria-labelledby="zpg-arrivals">
                    <GroupLabel id="zpg-arrivals" count={newEntries.length} tone="new">
                      新到
                    </GroupLabel>
                    <ul className="zpg-list">
                      {newEntries.map((item) => (
                        <EntryRow
                          key={item.seq ?? item.prefix}
                          item={item}
                          plan={state.plans[item.prefix]}
                          onForget={forgetPlan}
                        />
                      ))}
                    </ul>
                  </section>
                </div>
              )}

              {groups.entryGroups.length > 0 && (
                <div className="zpg-days">
                  {groups.entryGroups.map((group) => (
                    <section key={group.key} className="zpg-day" aria-labelledby={`zpg-day-${group.key}`}>
                      <DayHeading id={`zpg-day-${group.key}`} label={group.label} rows={group.rows} />
                      <ul className="zpg-list">
                        {group.rows.map((item) => (
                          <EntryRow
                            key={item.seq ?? item.prefix}
                            item={item}
                            plan={state.plans[item.prefix]}
                            onForget={forgetPlan}
                          />
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>
              )}
            </>
          )}

          {hasAnything && (
            <p className="zpg-foot">
              中转站的内容已在本机留了一份，那台创空间丢了数据也不会影响这里。
              你自己写的规划只存在本机。
            </p>
          )}
        </div>
      )}

      {/*
        助手固定在右下角。放在 `.zpg-page` 内部（而不是 portal 到 body）：
        它是这一页的一部分，离开这一页就该消失 —— 全局悬浮要改 shell 包，
        而且一个在「设置」页插嘴的助手是打扰。
      */}
      <PlanningPet onCreated={adoptCreated} />
    </div>
  );
}

/** 页头右侧的一句话摘要。 */
function summarize(todoCount, entryCount) {
  const parts = [];
  if (todoCount > 0) parts.push(`${todoCount} 条待办`);
  if (entryCount > 0) parts.push(`${entryCount} 条记录`);
  return parts.length > 0 ? `共 ${parts.join(' · ')}` : '';
}

/**
 * 数据源状态条。
 *
 * 三个来源各占一小段：能读的显示条数，读不了的显示**该去哪儿配**。
 * 这一块的价值在于：用户看到空列表时立刻知道是"没配"还是"配了但读不到"。
 *
 * ⚠️ 学在浙大缺账号**不是故障**，是还没做一次配置。所以它的文案写"未配置"并指出
 *    可照做的下一步，而不是把 `LOGIN_REQUIRED` 原文摊在页面上 —— 看见一段英文
 *    代码的用户会以为页面坏了。
 *
 * ⚠️ 「下一步」指向**设置里的浙大一卡通那一块**。它曾经指向「个人」页的
 *    「连接课堂」按钮，但那个入口已经改成占位：写入口统一到了设置。文案不改，
 *    用户会去找一个不存在的按钮。
 */
/**
 * 顶部摘要条：一眼回答「现在最该关心什么」。
 *
 * # 为什么需要它
 *
 * 学生的真实问题是"我漏了什么、接下来几小时要干什么"。旧页面把这些和
 * 「一周内」「更晚」「没有截止时间」平铺在同一个滚动列里 —— 得扫一遍才知道
 * 有几条过期。摘要条把结论前置：**数字 + 一句短标签**，点一下滚到那一组。
 *
 * # 几条设计约束
 *
 * 1. **只显示非零项**。一屏 0 的卡片既占地方又没信息 —— 没有过期就是好消息，
 *    不该用「已过期 0」去占一行。
 * 2. **全部为 0 时整条不出现**，页面直接从快捷添加开始；不要留一条空壳。
 * 3. `newArrivals` 用不同色调：它是"你还没看过的东西"，性质与截止压力不同。
 * 4. 每个都是 `role="button"` 的锚点，键盘也能跳到对应分组。
 *
 * @param focus - `focusSummary()` 的结果。
 */
function FocusBar({ focus }) {
  const items = [
    { key: 'overdue', label: '已过期', tone: 'overdue' },
    { key: 'soon', label: '24 小时内', tone: 'soon' },
    { key: 'today', label: '今天之内', tone: 'today' },
  ].filter((item) => (focus?.[item.key] ?? 0) > 0);

  const arrivals = focus?.newArrivals ?? 0;
  if (items.length === 0 && arrivals === 0) return null;

  /** 滚到分组标题。分组 id 由渲染处写成 `zpg-<key>`。 */
  const jump = (key) => {
    const target = document.getElementById(`zpg-${key}`);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="zpg-focus" role="group" aria-label="现在的重点">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          className={`zpg-focus-item zpg-focus-${item.tone}`}
          onClick={() => jump(item.key)}
          title={`跳到「${item.label}」`}
        >
          <b>{focus[item.key]}</b>
          <span>{item.label}</span>
        </button>
      ))}
      {arrivals > 0 && (
        <button
          type="button"
          className="zpg-focus-item zpg-focus-new"
          onClick={() => jump('arrivals')}
          title="跳到新到的条目"
        >
          <b>{arrivals}</b>
          <span>新到</span>
        </button>
      )}
    </div>
  );
}

function SourceBar({ todos, pta, remote, entryCount, mineCount }) {
  const xzzd = todos.xzzdError;
  const ptaError = todos.ptaError;
  const remoteError = remote?.error;
  // 学在浙大读不到 = 还没配过「浙大一卡通」。**不引导去终端跑命令**，也**不再**
  // 指向「个人」页那个「连接课堂」按钮 —— 凭据现在统一在「设置 → 浙大一卡通」写入，
  // 那一份由智云课堂与学在浙大共用。
  // 「没配」不是故障，是待完成的动作。三个码都归于这一类：
  //   NEED_LOGIN      —— 宿主侧翻译后的统一码（当前口径）
  //   LOGIN_REQUIRED  —— 数据包原始码（宿主翻译漏掉时兜底）
  //   NO_SESSION      —— 旧桥接方案留下的码，保留以免旧缓存读到就显示"读取失败"
  const needLogin = ['NEED_LOGIN', 'LOGIN_REQUIRED', 'NO_SESSION'].includes(xzzd?.code);
  const needCookie = ptaError?.code === 'COOKIE_IMPORT_REQUIRED';

  /**
   * 有没有**需要用户动手**的事。
   *
   * 数据源状态是有用的，但它不该在一切正常时也占四行 —— 用户来看的是"要做什么"，
   * 不是"四个数据源各自怎么样"。所以：
   *
   *   全部正常 → 收成一行小字（`我的 3 · 学在浙大 12 · 拼题A 2 · 中转站 40`）
   *   有异常   → 展开成清单，只有出问题的那几条带警示
   *
   * 判据是"有没有异常"，而不是"配了几个"：没配中转站只是没启用，不是错误。
   */
  const hasTrouble = Boolean(xzzd) || Boolean(ptaError) || Boolean(remoteError);

  /** 一行摘要：只报数量，异常项单独展开说。 */
  const compact = [
    mineCount > 0 ? `我的 ${mineCount}` : '我的 0',
    `学在浙大 ${xzzd ? '读取失败' : todos.rows.filter((r) => r.source === 'xzzd').length}`,
    `拼题A ${ptaError ? '未就绪' : todos.rows.filter((r) => r.source === 'pta').length}`,
    `中转站 ${entryCount}`,
  ].join(' · ');

  if (!hasTrouble) {
    return (
      <p className="zpg-sources-compact" title="数据源状态：都在正常工作">
        {compact}
      </p>
    );
  }

  return (
    <div className="zpg-sources">
      {/* 自己写的排第一：它不需要任何配置，也是这一页的主动作 */}
      <SourceItem label="我的规划" ok text={mineCount > 0 ? `${mineCount} 条` : '还没有 · 在上面写一条'} />
      <SourceItem
        label="学在浙大"
        ok={!xzzd}
        text={needLogin
          ? '浙大一卡通未登录 · 去「设置」里配一次'
          : xzzd ? (xzzd.message || '暂时无法读取，请稍后再试') : `${todos.rows.filter((r) => r.source === 'xzzd').length} 条`}
        title={xzzd?.message}
      />
      <SourceItem
        label="拼题A"
        ok={!ptaError}
        text={needCookie
          ? '未配置 Cookie · 在下方设置里粘贴'
          : ptaError ? 'Cookie 已失效，请重新粘贴' : `${todos.rows.filter((r) => r.source === 'pta').length} 条`}
        title={ptaError?.message}
      />
      <SourceItem
        label="中转站"
        ok={Boolean(remote?.synced) || entryCount > 0}
        text={remoteError
          ? '同步失败，本地内容仍在'
          : remote?.synced
            ? `已同步${remote.added > 0 ? `，新增 ${remote.added} 条` : ''}`
            : entryCount > 0 ? '仅本地' : '未配置'}
        title={remoteError?.message}
      />
    </div>
  );
}

function SourceItem({ label, ok, text, title }) {
  return (
    <span className={`zpg-source ${ok ? 'zpg-source-ok' : 'zpg-source-warn'}`} title={title ?? undefined}>
      <span className="zpg-source-dot" aria-hidden="true" />
      <strong>{label}</strong>
      <span>{text}</span>
    </span>
  );
}

/**
 * 写入口。
 *
 * 这一页的主动作是"写下要做什么"，所以它排在最前面，而不是藏在某个按钮后面。
 *
 * 三个设计取舍：
 *   1. **只有标题必填**。逼着填截止时间会让"随便记一条"变成一件麻烦事，
 *      而没有时间的规划本来就是这个页面上最常见的东西（`due: null` 是正常值）。
 *   2. 截止时间用 `datetime-local`：原生控件自带日期选择器，键盘也能直接输入，
 *      比自造的日历控件可靠得多，也不必为它写一份无障碍支持。
 *   3. 提交后**不清空失败内容** —— 写了一大段却因为网络失败被清掉是最糟的体验。
 */
function PlanComposer({ busy, error, onCreate, schedule }) {
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [due, setDue] = useState('');
  const [open, setOpen] = useState(false);
  // 重复：空串表示不重复。锚点默认按截止日 —— 对「每周交作业」最符合直觉。
  const [repeatUnit, setRepeatUnit] = useState('');
  const [repeatAnchor, setRepeatAnchor] = useState('due');
  /**
   * 输入面板是否展开。
   *
   * 它在**顶部工具行**里（与「刷新」「AI 拆解」并列），点了「+」就从那一行
   * 向下展开。不写死成右下角浮动：那意味着长列表里每次新建都要先滚到底，
   * 而"添一条"本该是随时够得到的动作。
   */
  const [panel, setPanel] = useState(false);
  const titleRef = useRef(null);
  const rootRef = useRef(null);

  /** 展开面板时把焦点给输入框 —— 点「+」之后可以直接打字。 */
  useEffect(() => {
    if (panel) titleRef.current?.focus();
  }, [panel]);

  /**
   * 关闭面板的两条通路：`Escape`、以及点到面板外面。
   *
   * 只挂在这两个时机上（而不是一直监听）：面板关着的时候不该占任何全局监听。
   * 有草稿时**不清空** —— 误关一下就把写了一半的东西丢了，比不关更烦人。
   */
  useEffect(() => {
    if (!panel) return undefined;
    const onKey = (event) => { if (event.key === 'Escape') setPanel(false); };
    const onClick = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setPanel(false);
    };
    document.addEventListener('keydown', onKey);
    // `mousedown` 而不是 `click`：click 要等到抬起，拖选文本时会误关
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [panel]);
  /**
   * 快捷时间片的候选。
   *
   * ⚠️ 必须在**渲染时**算一次而不是模块级常量：它们基于"现在"，
   * 页面开着一小时后，"今天 18:00" 应该从候选里消失。
   * 用 `useMemo` 按秒粒度缓存太频繁，这里按一次挂载算一份就够 ——
   * 用户在这个输入框上停留的时间不会长到让候选失效。
   */
  const quick = useMemo(() => quickTimes(), []);

  const submit = async (event) => {
    event.preventDefault();
    const name = title.trim();
    if (!name) return;
    const created = await onCreate({
      title: name,
      detail: detail.trim(),
      // 空串要转成 null：宿主把 '' 当"没说时间"，但显式传更清楚
      due: due ? new Date(due).toISOString() : null,
      // 没选周期就不带 repeat（服务端把 undefined 当"不重复"）。
      // 选了周期但没填时间是不可能的：选择器只在有 due 时才显示。
      repeat: due && repeatUnit
        ? { every: 1, unit: repeatUnit, anchor: repeatAnchor }
        : null,
    });
    if (created) {
      // 只在**成功**时清空并收起：失败时保留草稿，让用户能改着重试
      setTitle('');
      setDetail('');
      setDue('');
      setRepeatUnit('');
      setRepeatAnchor('due');
      setOpen(false);
      setPanel(false);
    }
  };

  /** 把一个快捷时间片填进 `due`（`datetime-local` 要本地格式的串）。 */
  const applyQuick = (stamp) => {
    const d = new Date(stamp);
    const pad = (n) => String(n).padStart(2, '0');
    // `datetime-local` 的值按**本地时区**解释，所以这里也用本地分量拼
    setDue(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`);
    setOpen(true);
  };

  return (
    <div className="zpg-fab-wrap" ref={rootRef}>
      {/*
        收起态：工具行里一个与其它按钮同高的「+」。
        它排在最后，因为"写"比"看"用得少 —— 但**始终在手边**，不必滚动。
      */}
      <button
        type="button"
        className="zy-secondary zpg-fab"
        onClick={() => setPanel((v) => !v)}
        aria-expanded={panel}
        aria-controls="zpg-composer-panel"
        title={panel ? '收起（Esc）' : '添加一条规划'}
      >
        <Icon name={panel ? 'close' : 'plus'} size={16} />
        {panel ? '收起' : '添加'}
      </button>

      {panel && (
        <form
          id="zpg-composer-panel"
          className="zpg-composer zpg-composer-panel"
          onSubmit={submit}
          role="dialog"
          aria-label="添加一条规划"
        >
          <div className="zpg-composer-row">
            <label className="zpg-composer-title">
              <span className="zpg-visually-hidden">要做什么</span>
              <input
                ref={titleRef}
                type="text"
                value={title}
                maxLength={80}
                placeholder="要做什么？例如「周三前交第三章作业」"
                onChange={(event) => setTitle(event.target.value)}
                disabled={busy}
                aria-label="要做什么"
              />
            </label>
            <button type="submit" className="zy-primary zpg-composer-add" disabled={busy || !title.trim()}>
              {busy ? '保存中…' : '添加'}
            </button>
          </div>

          {/*
            快捷时间片：像调闹钟一样，点一下就定好什么时候。
            只在**没填时间时**显示 —— 已经有时间了还给一堆候选，等于让人再选一次。
          */}
          {!due && quick.length > 0 && (
            <div className="zpg-quick" role="group" aria-label="快捷截止时间">
              <span className="zpg-quick-hint">什么时候？</span>
              {quick.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className="zpg-quick-item"
                  onClick={() => applyQuick(item.due)}
                  disabled={busy}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}

          {/* 备注与截止时间默认收起：绝大多数情况只需要写一句话 */}
          {open ? (
            <div className="zpg-composer-more">
              <label className="zpg-field">
                <span>备注（可选）</span>
                <textarea
                  rows={3}
                  value={detail}
                  maxLength={500}
                  placeholder="一段话里塞了好几件事也没关系 —— 写完可以让 AI 帮你拆开"
                  onChange={(event) => setDetail(event.target.value)}
                  disabled={busy}
                />
              </label>
              <label className="zpg-field zpg-field-inline">
                <span>截止时间（可选）</span>
                <input
                  type="datetime-local"
                  value={due}
                  onChange={(event) => setDue(event.target.value)}
                  disabled={busy}
                />
                {/* 课表上下文：只在真读到了课表时才说，读不到就一个字都不提 */}
                {due && scheduleHint(schedule, due) && (
                  <small className="zpg-schedule-hint">{scheduleHint(schedule, due)}</small>
                )}
              </label>
              {/*
                重复：只在**填了截止时间**时才给。
                没有起点就没有"下一次"，让人选一个算不出结果的规则只会更困惑。
              */}
              {due && (
                <div className="zpg-field zpg-field-inline zpg-repeat">
                  <span>重复</span>
                  <div className="zpg-repeat-row">
                    <select
                      value={repeatUnit}
                      onChange={(event) => setRepeatUnit(event.target.value)}
                      disabled={busy}
                      aria-label="重复周期"
                    >
                      <option value="">不重复</option>
                      <option value="day">每天</option>
                      <option value="week">每周</option>
                      <option value="month">每月</option>
                    </select>
                    {repeatUnit && (
                      <select
                        value={repeatAnchor}
                        onChange={(event) => setRepeatAnchor(event.target.value)}
                        disabled={busy}
                        aria-label="下一次从哪天算"
                        title="从哪天起算"
                      >
                        <option value="due">按截止日</option>
                        <option value="done">按完成日</option>
                      </select>
                    )}
                  </div>
                  {repeatUnit && (
                    <small className="zpg-schedule-hint">
                      {repeatAnchor === 'due'
                        ? '每次仍按原来的截止日往后推（拖到最后也还是压同一个点）'
                        : '下次从你实际做完那天起算（间隔按你的真实节奏）'}
                    </small>
                  )}
                </div>
              )}
            </div>
          ) : (
            <button type="button" className="zpg-link" onClick={() => setOpen(true)}>
              + 加备注或截止时间
            </button>
          )}

          {error && <p className="zpg-composer-error" role="alert">{error}</p>}
        </form>
      )}
    </div>
  );
}

/**
 * 「那天有没有课」的一句话提示。
 *
 * 只回答"有没有、几节"，不做任何建议 —— 我们不知道这件事要花多久，
 * 硬给"你来得及/来不及"是替用户做了一个他不该被代做的判断。
 *
 * @param schedule - 课表（`[{ day, courses }]`）或 null。
 * @param dueLocal - `datetime-local` 的值（`YYYY-MM-DDTHH:mm`，本地时区）。
 * @returns 提示文案，或空串表示无话可说。
 */
function scheduleHint(schedule, dueLocal) {
  if (!Array.isArray(schedule) || schedule.length === 0) return '';
  const at = new Date(dueLocal);
  if (Number.isNaN(at.getTime())) return '';
  // 用上海时区取"哪一天"，与页面别处同一口径
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(at);
  const row = schedule.find((item) => item?.day === day);
  const count = Array.isArray(row?.courses) ? row.courses.length : 0;
  if (count === 0) return '这天没有课。';
  return `这天有 ${count} 节课。`;
}

/**
 * 一条**自己写的**规划。
 *
 * 与 `TodoRow` 的差别是它**可操作**：能勾完成、能改、能删、能让 AI 拆。
 * 学在浙大/拼题A 的待办做不到这些 —— 那不是我们的数据，勾了也没有地方存
 * （中转站只接受追加，且那两份数据在平台侧才是权威）。
 */
function MineRow({ row, onToggle, onRemove, onEdit, onSplit, onUnsplit, busy, schedule }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ title: row.title, detail: row.detail, due: toLocalInput(row.due) });
  const [confirming, setConfirming] = useState(false);

  // 外部数据变了（比如 AI 拆完刷新）要把草稿跟上，否则编辑框会停在旧值上
  useEffect(() => {
    setDraft({ title: row.title, detail: row.detail, due: toLocalInput(row.due) });
  }, [row.title, row.detail, row.due]);

  const save = async (event) => {
    event.preventDefault();
    const name = draft.title.trim();
    if (!name) return;
    await onEdit(row, {
      title: name,
      detail: draft.detail.trim(),
      due: draft.due ? new Date(draft.due).toISOString() : null,
    });
    setEditing(false);
  };

  const splitCount = row.splitInto.length;

  return (
    <li>
      <div className={`zpg-item zpg-item-mine ${row.done ? 'zpg-item-done' : ''}`}>
        {editing ? (
          <form className="zpg-edit" onSubmit={save}>
            <label className="zpg-field">
              <span>要做什么</span>
              <input
                type="text"
                value={draft.title}
                maxLength={80}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                disabled={busy}
                autoFocus
              />
            </label>
            <label className="zpg-field">
              <span>备注</span>
              <textarea
                rows={2}
                value={draft.detail}
                maxLength={500}
                onChange={(event) => setDraft({ ...draft, detail: event.target.value })}
                disabled={busy}
              />
            </label>
            <label className="zpg-field zpg-field-inline">
              <span>截止时间</span>
              <input
                type="datetime-local"
                value={draft.due}
                onChange={(event) => setDraft({ ...draft, due: event.target.value })}
                disabled={busy}
              />
            </label>
            <div className="zpg-edit-foot">
              <button className="zy-primary" disabled={busy || !draft.title.trim()}>
                {busy ? '正在保存…' : '保存'}
              </button>
              <button type="button" className="zpg-link" onClick={() => setEditing(false)} disabled={busy}>
                取消
              </button>
            </div>
          </form>
        ) : (
          <>
            <div className="zpg-summary zpg-summary-static">
              {/* 勾选框是**原生控件**：键盘可操作、朗读器认、不依赖自绘 */}
              <input
                type="checkbox"
                className="zpg-check"
                checked={row.done}
                disabled={busy}
                onChange={() => onToggle(row)}
                aria-label={row.done ? `把「${row.title}」标为未完成` : `把「${row.title}」标为已完成`}
              />
              <span className={`zpg-kind ${row.splitFrom ? 'zpg-kind-split' : 'zpg-kind-mine'}`}>
                <Icon name={row.splitFrom ? 'layers' : 'check'} size={13} />
                {row.splitFrom ? 'AI 拆出' : '我的规划'}
              </span>
              <span className={`zpg-title ${row.done ? 'zpg-title-done' : ''}`}>{row.title}</span>
              <span className="zpg-meta">
                {splitCount > 0 && <span className="zpg-planned">已拆 {splitCount} 条</span>}
                {/* 重复标记：让人一眼看出这条勾掉之后还会再来一次 */}
                {row.repeat && (
                  <span className="zpg-repeat-tag" title={
                    row.repeat.anchor === 'done'
                      ? '勾完成后，下一次从你实际做完那天起算'
                      : '勾完成后，下一次仍按原来的截止日往后推'
                  }>
                    {/* 用 `history`（带循环箭头的图标）表示重复 —— 共享原语里没有 repeat，
                        为一个标签去改 shell-ui 不划算，而 history 的形状语义已足够接近。 */}
                    <Icon name="history" size={12} />
                    {REPEAT_LABEL[row.repeat.unit] ?? '重复'}
                    {row.repeat.anchor === 'done' ? '·按完成日' : ''}
                  </span>
                )}
                <span className="zpg-due">
                  {whenIso(row.due)}
                  {row.due && !row.done && <em className="zpg-left">{countdown(row.due)}</em>}
                </span>
              </span>
            </div>

            {row.detail && !row.done && (
              <DetailsBlock detail={row.detail} />
            )}

            {/* 课表上下文：只在有截止时间、且真读到课表时出现 */}
            {row.due && !row.done && scheduleHint(schedule, toLocalInput(row.due)) && (
              <p className="zpg-row-hint">{scheduleHint(schedule, toLocalInput(row.due))}</p>
            )}

            <div className="zpg-row-actions">
              {/* 让 AI 拆这一条 —— 这一页最有用的动作，所以放在第一个 */}
              <button type="button" className="zpg-link" onClick={() => onSplit(row)} disabled={busy}>
                <Icon name="bulb" size={13} />
                {busy ? '正在拆分…' : splitCount > 0 ? '重新拆分' : 'AI 拆分'}
              </button>
              {splitCount > 0 && (
                <button type="button" className="zpg-link" onClick={() => onUnsplit(row)} disabled={busy}>
                  忘掉这次拆分
                </button>
              )}
              <button type="button" className="zpg-link" onClick={() => setEditing(true)} disabled={busy}>
                编辑
              </button>
              {confirming ? (
                <>
                  {/* 删除不可撤销，所以要一次确认；但确认就地做，不弹窗 */}
                  <button type="button" className="zpg-link zpg-link-danger" onClick={() => onRemove(row)} disabled={busy}>
                    确认删除
                  </button>
                  <button type="button" className="zpg-link" onClick={() => setConfirming(false)} disabled={busy}>
                    取消
                  </button>
                </>
              ) : (
                <button type="button" className="zpg-link" onClick={() => setConfirming(true)} disabled={busy}>
                  删除
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </li>
  );
}

/**
 * ISO 时间串 → `datetime-local` 输入框要的本地时间格式。
 *
 * `datetime-local` 认的是**本地时间**且没有时区后缀（`YYYY-MM-DDTHH:mm`），
 * 直接塞 ISO（`...Z`）在多数浏览器里会被当成无效值而显示成空 —— 用户会以为
 * 自己填的截止时间丢了。
 *
 * @param iso - ISO 串或 null。
 * @returns `YYYY-MM-DDTHH:mm`，或空串。
 */
function toLocalInput(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  // 用上海时区的墙钟时间：这一页的其余显示也都是上海时区
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const pick = (type) => parts.find((part) => part.type === type)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')}T${pick('hour')}:${pick('minute')}`;
}

/**
 * 一条 **AI 从中转站拆出的卡片**。
 *
 * 与 `MineRow` 的区别很具体：它**不能改也不能删**（内容是模型从原文拆出来的，
 * 改它就等于改了原文的意思；删它则会与 `plans.json` 里的映射脱节 —— 要删该用
 * 「忘掉这次拆分」）。但它**能勾完成**：那件事做没做完只有用户知道，
 * 而这个状态存在我们自己的 `plans.json` 里，不需要碰中转站。
 */
/**
 * 条目详情：默认收起，点「查看详情」才展开。
 *
 * # 为什么需要它
 *
 * 列表的任务是"认出哪一条"，不是读完所有内容（skill ch13：识别优于回忆）。
 * 把 action / detail 直接铺出来，每条都占两三行，扫一眼分不出主次。
 *
 * 三种行（平台待办 / AI 拆出的卡片 / 我的规划）现在共用这一个：形态一致，
 * 用户不用记住"哪类条目要点哪里"。
 *
 * 用原生 `<details>`：键盘可操作、Ctrl+F 能自动展开、重渲染不丢展开态。
 * 不能用 CSS `max-height` 折叠 —— 隐藏内容仍会被朗读器读到，等于"看不见但存在"。
 */
function DetailsBlock({ action, detail }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="zpg-details" open={open}>
      <summary onClick={(event) => { event.preventDefault(); setOpen((v) => !v); }}>
        <Icon name="arrow" size={12} />
        查看详情
      </summary>
      <div className="zpg-details-body">
        {action && <p className="zpg-todo-action">{action}</p>}
        {detail && <p className="zpg-row-hint">{detail}</p>}
      </div>
    </details>
  );
}

export function CardRow({ row, onToggle, busy }) {
  return (
    <li>
      <div className={`zpg-item zpg-item-card ${row.done ? 'zpg-item-done' : ''}`}>
        <div className="zpg-summary zpg-summary-static">
          <input
            type="checkbox"
            className="zpg-check"
            checked={row.done}
            disabled={busy}
            onChange={() => onToggle(row)}
            aria-label={row.done ? `把「${row.title}」标为未完成` : `把「${row.title}」标为已完成`}
          />
          <span className="zpg-kind zpg-kind-split">
            <Icon name="layers" size={13} />
            AI 拆出
          </span>
          <span className={`zpg-title ${row.done ? 'zpg-title-done' : ''}`}>{row.title}</span>
          <span className="zpg-meta">
            <span className="zpg-due">
              {whenIso(row.due)}
              {row.due && !row.done && <em className="zpg-left">{countdown(row.due)}</em>}
            </span>
          </span>
        </div>
        {/*
          详情默认收起，点「查看详情」才展开。
          与平台待办（TodoRow）一致：列表的任务是"认出哪一条"，不是读完所有内容。
          以前卡片把 action / detail 直接铺出来，等于每条都占两行 —— 与
          同池的其它条目形态不一致。
        */}
        {(row.action || row.detail) && !row.done && (
          <DetailsBlock action={row.action} detail={row.detail} />
        )}
      </div>
    </li>
  );
}

/**
 * 日历视图：**只呈现有确定截止时间的事**。
 *
 * 三条设计约束：
 *
 *   1. **不编造日期**。没有 `due` 的条目不进格子，下面用一句话说明还有几件，
 *      而它们仍然完整地留在列表视图里。把无日期的条目塞进某一天，等于替用户
 *      编了一个他没写的截止时间 —— 那正是提示词里明令禁止的事。
 *   2. **回看 6 天、往后 4 周**。这个窗口覆盖"刚过去、正当时、未来一个月"，
 *      再远的事情用列表看更合适（也会让格子挤成马赛克）。
 *   3. 空格子**也画出来**：「这天没安排」本身是有用信息，与今天页「今天没有课」
 *      是同一类判断。空着不画反而让人怀疑自己漏了什么。
 */
/**
 * 日历视图：**月历**。
 *
 * 三条设计约束：
 *
 *   1. **不编造日期**。没有 `due` 的条目不进格子，下面用一句话说明还有几件，
 *      而它们仍然完整地留在列表视图里。
 *   2. **表头只写一次**：顶上一行「周日 … 周六」，格子里只标日期数字。
 *      每格都写星期是重复噪音 —— 纵向对齐已经说明了它是星期几。
 *   3. `<` `>` 翻月份。月历的默认视野是本月，不是"未来四周"。
 */
function CalendarView({ calendar, onToggle, onTogglePlan, onToggleTodo, busyId, monthOffset, onShiftMonth }) {
  const { weeks, monthLabel, weekdayLabels, undated } = calendar;

  return (
    <div className="zpg-cal">
      <header className="zpg-cal-bar">
        <button
          type="button"
          className="zpg-cal-nav"
          onClick={() => onShiftMonth(-1)}
          aria-label="上个月"
          title="上个月"
        >
          ‹
        </button>
        <span className="zpg-cal-month">{monthLabel}</span>
        <button
          type="button"
          className="zpg-cal-nav"
          onClick={() => onShiftMonth(1)}
          aria-label="下个月"
          title="下个月"
        >
          ›
        </button>
        {monthOffset !== 0 && (
          <button type="button" className="zpg-link zpg-cal-today-btn" onClick={() => onShiftMonth(0)}>
            回到本月
          </button>
        )}
      </header>

      <div className="zpg-cal-weekdays" aria-hidden="true">
        {weekdayLabels.map((label) => <span key={label}>{label}</span>)}
      </div>

      <div className="zpg-cal-grid" role="grid" aria-label={monthLabel}>
        {weeks.map((week) => week.days.map((day) => {
          const overdue = day.isPast && !day.isToday && day.rows.some((row) => !row.done);
          return (
            <section
              key={day.key}
              role="gridcell"
              className={[
                'zpg-cal-cell',
                day.outside ? 'zpg-cal-outside' : '',
                day.isToday ? 'zpg-cal-today' : '',
                overdue ? 'zpg-cal-past' : '',
              ].filter(Boolean).join(' ')}
            >
              <header className="zpg-cal-head">
                <span className="zpg-cal-day">{day.dayNumber}</span>
              </header>
              {day.rows.length > 0 ? (
                <ul className="zpg-cal-list">
                  {day.rows.map((row) => {
                    const toggle = row.source === 'mine'
                      ? () => onTogglePlan(row)
                      : row.source === 'plan'
                        ? () => onToggle(row)
                        : () => onToggleTodo(row);
                    const busyKey = row.source === 'xzzd' || row.source === 'pta'
                      ? `todo:${row.source}:${row.id}`
                      : row.id;
                    return (
                      <li key={`${row.source}:${row.id}`} className="zpg-cal-item">
                        <input
                          type="checkbox"
                          className="zpg-check zpg-check-sm"
                          checked={Boolean(row.done)}
                          disabled={busyId === busyKey}
                          onChange={toggle}
                          aria-label={`把「${row.title}」标为已完成`}
                        />
                        <span
                          className={`zpg-cal-title ${row.done ? 'zpg-title-done' : ''}`}
                          title={row.title}
                        >
                          {row.title}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </section>
          );
        }))}
      </div>

      {undated > 0 && (
        <p className="zpg-cal-note">
          另外 {undated} 件没有截止时间 —— 没有日期就不该被摆在某一天里，它们在列表视图里都在。
        </p>
      )}
    </div>
  );
}

/**
 * 一条**平台待办**（学在浙大 / 拼题A）。
 *
 * 它能勾，但勾的是**本机标记**，不是平台的完成状态 —— 勾一下不会让学在浙大认为
 * 作业交过了，也不会让拼题A 关闭题集。所以这里必须做两件事：
 *
 *   1. 勾选框旁边留一句「本机标记」，说明它的含义（不能让人以为勾了等于交了）；
 *   2. 勾掉之后这一条**仍然可点去原页面**（`<a>` 还在）—— 因为真正的动作在那边。
 *
 * 平台那边仍然是权威：它说未提交就是未提交。本机勾选只表示"这件事我不需要再被提醒"。
 */
function TodoRow({ row, onToggle, busy }) {
  const kind = KIND[row.kind] ?? KIND_FALLBACK;
  return (
    <li>
      <div className={`zpg-item zpg-item-todo ${row.done ? 'zpg-item-done' : ''}`}>
        <div className="zpg-summary zpg-summary-static">
          <input
            type="checkbox"
            className="zpg-check"
            checked={Boolean(row.done)}
            disabled={busy}
            onChange={() => onToggle(row)}
            aria-label={row.done
              ? `把「${row.title}」标为未完成（只影响本页，不影响平台）`
              : `把「${row.title}」标为已完成（只影响本页，不影响平台）`}
          />
          <span className={`zpg-kind ${kind.cls}`}>
            <Icon name={kind.icon} size={13} />
            {row.sourceLabel}
          </span>
          <span className={`zpg-title ${row.done ? 'zpg-title-done' : ''}`}>{row.title}</span>
          <span className="zpg-meta">
            <span className="zpg-due">
              {whenIso(row.due)}
              {row.due && !row.done && <em className="zpg-left">{countdown(row.due)}</em>}
            </span>
          </span>
          {row.url && (
            <a className="zpg-open" href={row.url} target="_blank" rel="noreferrer" aria-label={`打开 ${row.title}`}>
              <Icon name="arrow" size={15} />
            </a>
          )}
        </div>
        {/*
          详情默认收起，点「查看详情」才展开。
          与 AI 拆出的卡片、我的规划一致：列表的任务是"认出哪一条"。
          以前 TodoRow 把 detail 塞进 meta 一行，跟后两类条目的形态对不上。
        */}
        {row.detail && !row.done && (
          <DetailsBlock detail={row.detail} />
        )}
        {/* 勾掉之后才说这句话：没勾的人不需要读，勾了的人必须知道它的边界。 */}
        {row.done && (
          <p className="zpg-row-hint">
            已在本页标记完成，平台那边的状态没有改变。
            {row.url && '要真正提交，仍要点右边的箭头去原页面。'}
          </p>
        )}
      </div>
    </li>
  );
}

/** 一天的分组标题。全部收起时，类别构成是唯一的可判断信息。 */
function DayHeading({ id, label, rows }) {
  const scope = describeScope(rows);
  return (
    <div className="zpg-day-head">
      <GroupLabel id={id} count={rows.length}>
        {label}
      </GroupLabel>
      <p className="zpg-day-scope">{scope}</p>
    </div>
  );
}

/**
 * 轻量分组标签：一条路标，不是一个章节标题。
 *
 * # 为什么不用外壳的 `SectionTitle`
 *
 * 那个组件渲染 `<h2>`。规划页一屏里可能有六七个分组（已过期 / 24 小时内 /
 * 今天之内 / 一周内 / 更晚 / 没有时间 / 新到），六七个 `<h2>` 会让"分组"
 * 看起来比"条目"还重 —— 而它们只是告诉眼睛"下面这一类是什么"。
 *
 * 所以这里用一个小的、加粗的、带计数的小标签，`role="heading"` + `aria-level`
 * 保留语义（读屏仍能按标题跳），但视觉上明显轻于条目本身。
 *
 * @param options.id - 供 `aria-labelledby` 引用。
 * @param options.count - 条数；≤1 时不显示（"1 条"没有信息量）。
 * @param options.tone - `overdue` 时用强调色，其余用次要色。
 */
function GroupLabel({ id, count = 0, tone = '', children }) {
  return (
    <div className={`zpg-group-label ${tone ? `zpg-group-${tone}` : ''}`}>
      <span id={id} role="heading" aria-level={3}>{children}</span>
      {count > 1 && <span className="zpg-group-count">{count}</span>}
    </div>
  );
}

function describeScope(rows) {
  const tally = new Map();
  for (const row of rows) {
    const label = (KIND[row.kind] ?? KIND_FALLBACK).label;
    tally.set(label, (tally.get(label) ?? 0) + 1);
  }
  return [...tally].map(([label, n]) => `${n} 条${label}`).join(' · ');
}

/**
 * 一条中转站记录：**标题行可点，正文收起**。
 *
 * 实测一条正文 1734 字，全展开时一屏放不下一两条。列表的任务是"认出哪一条"，
 * 不是读完所有内容（skill ch13 识别优于回忆）。
 *
 * 用原生 `<details>`：键盘可操作、Ctrl+F 能自动展开、重渲染不丢展开态。
 * 不能用 CSS `max-height` 折叠 —— 隐藏内容仍会被朗读器读到，等于"看不见但存在"。
 */
function EntryRow({ item, plan, onForget }) {
  const kind = KIND[item.kind] ?? KIND_FALLBACK;
  const tags = Array.isArray(item.tags) ? item.tags : [];
  const at = Number.isFinite(item.at) ? item.at : 0;
  const text = typeof item.text === 'string' ? item.text : '';
  const cards = Array.isArray(plan?.cards) ? plan.cards : null;

  return (
    <li>
      <details className="zpg-item">
        <summary className="zpg-summary">
          <span className={`zpg-kind ${kind.cls}`}>
            <Icon name={kind.icon} size={13} />
            {kind.label}
          </span>
          <span className="zpg-title">{item.title}</span>
          <span className="zpg-meta">
            {/* 已拆过的条目标出来：用户一眼能看出这条不用再规划，也说明映射还在 */}
            {cards && <span className="zpg-planned">已拆 {cards.length} 张</span>}
            <span className="zpg-chars">{text.length} 字</span>
            <time className="zpg-time" dateTime={new Date(at * 1000).toISOString()}>
              {when(item.at)}
            </time>
          </span>
          <span className="zpg-caret" aria-hidden="true"><Icon name="chevron" size={15} /></span>
        </summary>
        <div className="zpg-body">
          {/* 卡片**不再**在这里重复渲染：它们已经升格成待办，按自己的截止时间
              进了上方的「一周内 / 更晚」。同一条内容在两处出现会让人以为是两件事。
              这里只留一句指路 + 撤销入口。 */}
          {cards && cards.length > 0 && (
            <div className="zpg-planned-note">
              <span>已拆成 {cards.length} 条，按截止时间列在上方的分组里。</span>
              <button type="button" className="zpg-link" onClick={() => onForget(item.prefix)}>
                忘掉这次拆分
              </button>
            </div>
          )}
          <p className="zpg-text">{text}</p>
          {tags.length > 0 && (
            <ul className="zpg-tags" aria-label="标签">
              {tags.map((tag) => <li key={tag} className="zpg-tag">{tag}</li>)}
            </ul>
          )}
        </div>
      </details>
    </li>
  );
}

/**
 * 失败块。
 *
 * 三个信息按**处置顺序**排：发生了什么（标题）→ 为什么（原始错误）→ 下一步（建议）。
 * 红色描边是**第二通道**，第一通道是标题文字本身（ch03 规则 3）。
 */
function ErrorBlock({ error }) {
  const info = ERROR[error.code] ?? { title: '读取失败', next: null };
  return (
    <div className="zpg-error" role="alert">
      <span className="zpg-error-icon" aria-hidden="true"><Icon name="close" size={16} /></span>
      <div className="zpg-error-body">
        <strong>{info.title}</strong>
        <p className="zpg-error-why">{error.message}</p>
        {info.next && <p className="zpg-error-next">{info.next}</p>}
      </div>
    </div>
  );
}

/**
 * 设置分区：**拼题A**。
 *
 * 只有一项：Cookie。它与中转站是**互不相干**的两件事，所以分成两个折叠分组
 * （见 `apply` 里那两处 `settings.section` 注册）。
 *
 * 学在浙大不在这里 —— 它用的是「浙大一卡通」账号（`dsh-zhiyun-source-card` 那块），
 * 与拼题A 的 Cookie 是两套完全不同的凭证。
 */
export function PtaSection() {
  const [cookie, setCookie] = useState('');
  const [state, setState] = useState({ loading: true, saving: false, message: null, error: null });
  const [pta, setPta] = useState(null);

  useEffect(() => {
    let live = true;
    settings('').then(
      (payload) => {
        if (!live) return;
        setPta(payload.pta ?? null);
        setState({ loading: false, saving: false, message: null, error: null });
      },
      (failure) => { if (live) setState({ loading: false, saving: false, message: null, error: failure.message }); },
    );
    return () => { live = false; };
  }, []);

  const saveCookie = async (event) => {
    event.preventDefault();
    setState({ loading: false, saving: true, message: null, error: null });
    try {
      const payload = await settings('pta', { cookie });
      setCookie('');
      setPta(payload.pta ?? null);
      setState({
        loading: false,
        saving: false,
        message: `拼题A Cookie 已保存（识别为「${payload.cookie?.source ?? '未知'}」，${payload.cookie?.cookie_names?.length ?? 0} 个键）`,
        error: null,
      });
    } catch (failure) {
      setState({ loading: false, saving: false, message: null, error: failure.message });
    }
  };

  // ⚠️ 这里**不画** `<details>` / `.zy-settings-group`。
  //    壳的 `PersonalSettingsBridge` 已经为每个 `settings.section` 注册渲染了外层折叠分组
  //    （图标 + 标题 + 副标题 + chevron + body），然后才把本组件渲染进 body 里。
  //    自己再包一层会变成"壳套壳"：两层折叠框、两个同名标题。
  return (
    <>
      <form className="zpg-form" onSubmit={saveCookie}>
        <label className="zpg-field">
          <span>
            拼题A Cookie
            {pta && (
              <span className={`zpg-pill ${pta.configured ? 'zpg-pill-ok' : ''}`}>
                {pta.configured ? '已配置' : '未配置'}
              </span>
            )}
          </span>
          <textarea
            name="ptaCookie"
            rows={3}
            autoComplete="off"
            spellCheck={false}
            placeholder="登录 pintia.cn 后，从任一 /api 请求复制 Cookie 或整条 cURL 粘贴到这里"
            value={cookie}
            onChange={(event) => setCookie(event.target.value)}
            disabled={state.loading || state.saving}
          />
          <small>
            拼题A 登录要短信验证，无法用账号密码自动登录，只能粘贴 Cookie。
            它与「浙大一卡通」是**不同**的凭证，所以单独一项。
          </small>
        </label>
        <div className="zpg-form-foot">
          <button className="zy-primary" disabled={state.loading || state.saving || !cookie.trim()}>
            {state.saving ? '正在保存…' : '保存 Cookie'}
          </button>
        </div>
      </form>

      {state.message && <Notice>{state.message}</Notice>}
      {state.error && <Notice>{state.error}</Notice>}
    </>
  );
}

/**
 * 设置分区：**个人中转站**。
 *
 * 只有两项：域名 + 读密钥。这是用户**自己部署**的中转站，与拼题A 毫无关系。
 *
 * 为什么不叫「规划数据源」：这一页只是它的**消费者之一**，将来别的页面
 * （或脚本）也会读这份内容。用一个页面名去命名一份基础设施，会让人以为
 * 删掉那页它就不存在了。
 */
export function RelaySection() {
  const [endpoint, setEndpoint] = useState('');
  const [readKey, setReadKey] = useState('');
  const [state, setState] = useState({ loading: true, saving: false, message: null, error: null });
  const [summary, setSummary] = useState('读取中…');

  useEffect(() => {
    let live = true;
    settings('').then(
      (payload) => {
        if (!live) return;
        setEndpoint(payload.config?.endpoint ?? '');
        setReadKey(payload.config?.readKey ?? '');
        setSummary(describeRelaySummary(payload));
        setState({ loading: false, saving: false, message: null, error: null });
      },
      (failure) => { if (live) setState({ loading: false, saving: false, message: null, error: failure.message }); },
    );
    return () => { live = false; };
  }, []);

  const saveEndpoint = async (event) => {
    event.preventDefault();
    setState({ loading: false, saving: true, message: null, error: null });
    try {
      const payload = await settings('save', { endpoint, readKey });
      setEndpoint(payload.config?.endpoint ?? endpoint);
      setReadKey(payload.config?.readKey ?? '');
      setSummary(describeRelaySummary(payload));
      setState({
        loading: false,
        saving: false,
        message: payload.remote?.error
          ? `已保存，但同步失败：${payload.remote.error.message}`
          : `已保存，本地共 ${payload.entries?.length ?? 0} 条记录`,
        error: null,
      });
    } catch (failure) {
      setState({ loading: false, saving: false, message: null, error: failure.message });
    }
  };

  return (
    <>
      <form className="zpg-form" onSubmit={saveEndpoint}>
        <label className="zpg-field">
          <span>中转站域名</span>
          <input
            name="endpoint"
            type="url"
            inputMode="url"
            autoComplete="url"
            placeholder="https://你的账号-空间名.ms.show"
            value={endpoint}
            onChange={(event) => setEndpoint(event.target.value)}
            disabled={state.loading || state.saving}
            required
          />
          <small>你自己部署的那台中转站，只支持 http / https。同步过的内容会在本机留一份。</small>
        </label>
        <label className="zpg-field">
          <span>读密钥</span>
          <input
            name="readKey"
            type="password"
            autoComplete="off"
            placeholder="填中转站里的读密钥"
            value={readKey}
            onChange={(event) => setReadKey(event.target.value)}
            disabled={state.loading || state.saving}
          />
          <small>
            打码值 <code>{MASK}</code> 表示不改。这一项只能读，写内容要用中转站的写密钥。
          </small>
        </label>
        <div className="zpg-form-foot">
          <button className="zy-primary" disabled={state.loading || state.saving}>
            {state.saving ? '正在保存并同步…' : '保存并同步'}
          </button>
          <span className="zpg-form-state">{summary}</span>
        </div>
      </form>

      {state.message && <Notice>{state.message}</Notice>}
      {state.error && <Notice>{state.error}</Notice>}
    </>
  );
}

/** 折叠状态下的一行摘要：让收起来也知道连了什么。 */
function describeRelaySummary(payload) {
  if (!payload.config?.configured) return '未配置';
  return `已配置 · 本地 ${payload.entries?.length ?? 0} 条记录`;
}

/* ══════════════════════════════════════════ pet：右下角的对话角色 */

/**
 * pet 的气泡。
 *
 * # 为什么是"角色"而不是输入框
 *
 * 输入框要求用户先把想法整理成字段；而人的真实状态是"想起什么说什么"。
 * pet 把入口变成一次对话：说一句、它回一句、你觉得对就点「好」。
 *
 * # 三个刻意的取舍
 *
 * 1. **只在规划页**。全局悬浮要改 shell 包，而且一个在「设置」页插嘴的
 *    助手是打扰。它在这里是因为这里是"写下要做的事"的地方。
 * 2. **确认留在气泡里**，不跳回表单。聊天结束还要回表单点一次「添加」，
 *    等于白聊 —— 用户已经用自然语言表达过了。
 * 3. **`create` 只出卡，不落库**。卡片上有一个「好」按钮，那一刻才真的写。
 *    这是 AI 相关功能共同的一条底线：AI 记错了必须有人拦。
 */
function PlanningPet({ onCreated }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  // 待确认的那条草案（同一时刻只留一条：连着说两件事要分开确认）
  const [pendingDraft, setPendingDraft] = useState(null);
  const listRef = useRef(null);
  const inputRef = useRef(null);

  // 有新消息时滚到底部 —— 聊天气泡里"看不到最新那条"是最基本的问题
  useEffect(() => {
    const node = listRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, pendingDraft, open]);

  // 打开时聚焦输入框，省掉一次点击
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Esc 收起
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  /**
   * 发一句话，**边收边显示**。
   *
   * # 流式的两种失败必须分开处理
   *
   *   · 服务端说 `NO_STREAM`（老模型通道不支持）→ **退回普通模式**再来一次。
   *     用户不该为"通道能力"这种东西看到报错，他要的只是一句回话。
   *   · 其它失败（网络断、模型报错）→ 如实显示。这时再自动重试只会
   *     花第二次钱，还可能在已经显示了一半的情况下把气泡弄乱。
   *
   * # 为什么先塞一个空 assistant 气泡
   *
   * 逐字追加需要一个**稳定的落点**。如果等第一段 delta 到了才建气泡，
   * 用户会先看到自己那句孤零零地待着，然后才冒出回应 —— 中间那一刻像卡住。
   * 先占位（内容是空串，显示为"…"），第一段 delta 一到就替换掉。
   */
  const send = async () => {
    const said = text.trim();
    if (!said || sending) return;
    setText('');
    setError(null);
    const history = messages.slice(-8);
    // 用户那句 + 一个待填充的助手气泡（用 index 定位，避免和已有气泡混淆）
    setMessages((current) => [...current, { role: 'user', text: said }, { role: 'assistant', text: '' }]);
    setSending(true);

    /** 把最新那段助手气泡改成给定内容。 */
    const patchAssistant = (next) => setMessages((current) => {
      const copy = [...current];
      for (let i = copy.length - 1; i >= 0; i -= 1) {
        if (copy[i].role === 'assistant') { copy[i] = { ...copy[i], text: next }; break; }
      }
      return copy;
    });

    let typed = '';
    const finish = (payload) => {
      // 收尾用服务端的 `say` 校正一次：流式期间可能有半截围栏没显示出来
      const finalSay = typeof payload?.say === 'string' && payload.say ? payload.say : typed;
      patchAssistant(finalSay);
      if (payload?.action === 'create' && payload?.draft) setPendingDraft(payload.draft);
      if (Array.isArray(payload?.notes) && payload.notes.length > 0) setError(payload.notes.join('；'));
    };

    try {
      const stream = createPetStream({
        url: `${ROUTE}?pet-stream`,
        body: { text: said, history },
        onDelta: (chunk) => { typed += chunk; patchAssistant(typed); },
        onFinal: finish,
        onError: (message, meta) => {
          // NO_STREAM 不在这里报 —— 交给下面的回退路径，用户不该看到它
          if (meta?.code !== 'NO_STREAM') setError(message);
        },
      });
      const outcome = await stream.start();

      /**
       * 流式没跑起来 → **悄悄退回普通模式**再试一次。
       *
       * 触发条件：服务端明确回 `NO_STREAM`（老通道不支持 `callStream`），
       * 或者一个 delta 都没收到、也没有 final —— 那说明这条路整个没通。
       * 用户不该为"通道能力"这种东西看到报错。
       */
      if (outcome.unsupported || (!outcome.final && outcome.deltas === 0)) {
        const payload = await settings('pet-chat', { text: said, history });
        if (payload?.ok === false) throw new Error(errorText(payload.error, 200));
        finish(payload);
      }
    } catch (failure) {
      setError(failure.message);
      // 失败时把话放回输入框，用户不用重打
      setText(said);
      // 清掉那个空占位气泡，别留一个空气泡在那儿
      setMessages((current) => {
        const copy = [...current];
        if (copy.length && copy[copy.length - 1].role === 'assistant' && !copy[copy.length - 1].text) copy.pop();
        return copy;
      });
    } finally {
      setSending(false);
    }
  };

  /** 用户点了「好」——这一步才真的落库。 */
  const confirm = async () => {
    if (!pendingDraft || sending) return;
    const draft = pendingDraft;
    setSending(true);
    setError(null);
    try {
      const payload = await settings('local-create', {
        title: draft.title,
        detail: draft.detail ?? '',
        due: draft.due ?? null,
        repeat: draft.repeat ?? null,
      });
      if (payload?.ok === false) throw new Error(errorText(payload.error, 200));
      const item = payload?.item ?? null;
      setPendingDraft(null);
      setMessages((current) => [...current, {
        role: 'assistant',
        text: whenIso(item?.due) ? `记好了：${draft.title}（${whenIso(item.due)}）` : `记好了：${draft.title}`,
      }]);
      // 把新条目推给页面，列表立刻出现 —— 不必等下一次快照
      if (item && typeof onCreated === 'function') onCreated(item);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setSending(false);
    }
  };

  if (!open) {
    return <button
      type="button"
      className="zpg-pet-fab"
      onClick={() => setOpen(true)}
      aria-label="打开规划助手"
      title="跟助手聊聊要做什么"
    >
      <span className="zpg-pet-face" aria-hidden="true">
        <span className="zpg-pet-eye" /><span className="zpg-pet-eye" />
      </span>
    </button>;
  }

  return <div className="zpg-pet" role="dialog" aria-label="规划助手">
    <header className="zpg-pet-head">
      <span className="zpg-pet-face zpg-pet-face-sm" aria-hidden="true">
        <span className="zpg-pet-eye" /><span className="zpg-pet-eye" />
      </span>
      <span className="zpg-pet-name">小助</span>
      <span className="zpg-pet-hint">说说你要做什么</span>
      <button
        type="button"
        className="zpg-pet-close"
        onClick={() => setOpen(false)}
        aria-label="收起助手"
        title="收起（Esc）"
      >
        <Icon name="close" size={14} />
      </button>
    </header>

    <div className="zpg-pet-body" ref={listRef}>
      {messages.length === 0 && (
        <p className="zpg-pet-hello">
          有什么要记的？直接说就行，比如「下周三交第三章作业」。
        </p>
      )}

      {/*
        助手气泡：流式期间它的 text 会**逐字变长**。
        空串是"还没收到第一个字"，此时显示「…」——否则会是一个看空白的空气泡，
        用户以为卡死了。这个占位与 `sending` 无关：字到了就显示字。
      */}
      {messages.map((item, index) => (
        <p
          key={index}
          className={`zpg-pet-msg zpg-pet-msg-${item.role}${item.role === 'assistant' && !item.text ? ' zpg-pet-thinking' : ''}`}
        >
          {item.text || (item.role === 'assistant' ? '…' : '')}
        </p>
      ))}

      {/* 确认卡：把模型的理解**摊开**给人看，而不是只报一句"记好了" */}
      {pendingDraft && (
        <div className="zpg-pet-draft">
          <p className="zpg-pet-draft-title">{pendingDraft.title}</p>
          <dl className="zpg-pet-draft-meta">
            <div>
              <dt>时间</dt>
              <dd>{pendingDraft.due ? whenIso(pendingDraft.due) : '没定'}</dd>
            </div>
            {pendingDraft.repeat && (
              <div>
                <dt>重复</dt>
                <dd>
                  {REPEAT_LABEL[pendingDraft.repeat.unit] ?? '重复'}
                  {pendingDraft.repeat.anchor === 'done' ? '（按完成日）' : ''}
                </dd>
              </div>
            )}
          </dl>
          <div className="zpg-pet-draft-actions">
            <button type="button" className="zy-primary" onClick={confirm} disabled={sending}>
              好，记下
            </button>
            <button
              type="button"
              className="zy-secondary"
              onClick={() => { setPendingDraft(null); }}
              disabled={sending}
            >
              不对
            </button>
          </div>
        </div>
      )}

      {error && <p className="zpg-pet-error" role="alert">{error}</p>}
    </div>

    <div className="zpg-pet-input">
      <input
        ref={inputRef}
        type="text"
        value={text}
        maxLength={1000}
        placeholder={pendingDraft ? '先确认上面这条…' : '说点什么…'}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            void send();
          }
        }}
        disabled={sending}
        aria-label="跟助手说话"
      />
      <button
        type="button"
        className="zy-primary"
        onClick={() => void send()}
        disabled={sending || !text.trim()}
      >
        说
      </button>
    </div>
  </div>;
}
