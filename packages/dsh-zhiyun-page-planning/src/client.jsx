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
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Empty, Icon, Notice, SectionTitle, mountStyle } from 'dsh-zhiyun-ui-primitives';
import css from './style.css';

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
 *
 * @param action - `''`（读取）/ `'save'` / `'refresh'` / `'pta'`。
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
  if (!response.ok) throw new Error(payload.error ?? `设置接口返回 ${response.status}`);
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

/** 同一分类内的分组键：条目按天，待办按紧迫度（见宿主 `urgencyOf`）。 */
function urgencyOf(iso, now = Date.now()) {
  if (!iso) return 'none';
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return 'none';
  if (at < now) return 'overdue';
  if (at - now <= 86400000) return 'today';
  if (at - now <= 604800000) return 'week';
  return 'later';
}

const URGENCY_LABEL = {
  overdue: '已过期',
  today: '今天截止',
  week: '一周内',
  later: '更晚',
  none: '没有截止时间',
};

/** 分组标题：待办用紧迫度，条目用日期。 */
function dayLabel(seconds) {
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return '时间未知';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', month: 'long', day: 'numeric', weekday: 'long',
  }).format(date);
}

export function apply(ctx) {
  mountStyle(ctx, { attribute: 'zhiyunPlanningStyle', css, label: 'zhiyun: planning styles' });
  ctx.slots.inject('zhiyun.planning.content', () => ctx.slots.register(
    { name: 'zhiyun.planning.content' },
    Planning,
  ));
  // 设置集中在「个人 → 设置」：壳里的 PersonalSettingsBridge 会把所有
  // settings.section 按 order 摊成折叠分组，所以这里零改壳。
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'zhiyun-planning',
    order: 65,
    label: () => '规划数据源',
  }, SettingsSection));
}

/** 错误码 → 标题与下一步建议。 */
const ERROR = {
  NOT_CONFIGURED: { title: '还没有配置数据源', next: '去「个人 → 设置 → 规划数据源」填域名和读密钥。' },
  // 学在浙大「还没登录」—— 与"读取失败"是两件事，处置也不同
  NEED_LOGIN: {
    title: '还没登录浙大账号',
    next: '在「个人」页点「连接课堂」登录一次，学在浙大待办就会出现在这里。',
  },
  KEY_REJECTED: {
    title: '读密钥被拒绝',
    next: '到「个人 → 设置 → 规划数据源」核对读密钥；换过域名的话也要一起改。',
  },
  UNREACHABLE: { title: '连不上中转站', next: '确认那台创空间还在运行。本地已存的内容不受影响。' },
  UPSTREAM: { title: '中转站自己报错了', next: '打开域名看它的 /health 是否正常。' },
  BAD_PAYLOAD: { title: '返回的不是中转站格式', next: '确认这个域名指向的是中转站，而不是别的服务。' },
  IPC: { title: '设置接口不可用', next: '宿主侧没起来，重启一次工作台再试。' },
};

/** 页面正文。 */
export function Planning() {
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState({ entries: [], todos: null, remote: null, pta: null, plans: {}, planned: [] });
  // 规划是花钱且耗时的操作，单独状态：它不该让整页进"loading"把已有内容藏起来
  const [planning, setPlanning] = useState(false);
  const [planMsg, setPlanMsg] = useState(null);
  const [error, setError] = useState(null);

  const apply = useCallback((payload) => {
    setState({
      entries: Array.isArray(payload.entries) ? payload.entries : [],
      todos: payload.todos ?? null,
      remote: payload.remote ?? null,
      pta: payload.pta ?? null,
      plans: payload.plans ?? {},
      planned: Array.isArray(payload.planned) ? payload.planned : [],
    });
    // 只有中转站这条链路会给出"整页级"错误；待办各自的错误在各自区块里说
    setError(payload.remote?.error ?? null);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
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
    setLoading(true);
    try {
      apply(await settings('refresh', {}));
    } catch (failure) {
      setError({ code: 'IPC', message: failure.message });
    } finally {
      setLoading(false);
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
      const created = payload.created ?? 0;
      const planned = payload.planned ?? 0;
      setPlanMsg({
        kind: 'ok',
        text: planned > 0
          ? `已把 ${planned} 条原文拆成 ${created} 张卡片${payload.dropped ? `（丢弃 ${payload.dropped} 张不合规）` : ''}`
          : '没有新的条目需要规划',
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
    return {
      rows: [...(xzzd.rows ?? []), ...(pta.rows ?? [])],
      xzzdError: xzzd.error,
      ptaError: pta.error,
    };
  }, [state.todos]);

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
        });
      });
    }
    return rows;
  }, [state.plans]);

  const groups = useMemo(() => {
    const now = Date.now();
    const order = ['overdue', 'today', 'week', 'later', 'none'];
    const buckets = new Map();
    // 待办与拆出的卡片**同池**：它们都是"要去做的事"，只是来源不同
    for (const row of [...todos.rows, ...planCards]) {
      const key = `todo:${urgencyOf(row.due, now)}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(row);
    }
    const todoGroups = order
      .filter((key) => buckets.has(`todo:${key}`))
      .map((key) => ({
        key,
        label: URGENCY_LABEL[key],
        rows: buckets.get(`todo:${key}`).sort((a, b) => {
          const at = a.due ? Date.parse(a.due) : Infinity;
          const bt = b.due ? Date.parse(b.due) : Infinity;
          return at - bt;
        }),
      }));

    const byDay = [];
    for (const entry of state.entries) {
      const date = new Date((entry.at ?? 0) * 1000);
      const key = Number.isNaN(date.getTime()) ? 'unknown' : date.toISOString().slice(0, 10);
      const last = byDay[byDay.length - 1];
      if (last && last.key === key) last.rows.push(entry);
      else byDay.push({ key, label: dayLabel(entry.at), rows: [entry] });
    }
    // 条目是"写下的"，最近的在上
    byDay.reverse();
    for (const group of byDay) group.rows.reverse();

    return { todoGroups, entryGroups: byDay };
  }, [todos.rows, state.entries, planCards]);

  const configured = state.remote !== null && state.remote.synced !== undefined
    ? true
    : false;
  const remoteOk = state.remote?.synced === true;
  // 卡片已经并进 todos.rows 之外的 planCards，二者都是"要做的"
  const hasAnything = todos.rows.length > 0 || planCards.length > 0 || state.entries.length > 0;

  return (
    <div className="zpg-page">
      <div className="zy-intro zpg-head">
        <div>
          <span className="zy-eyebrow">接下来与写过的</span>
          <h1>规划</h1>
          <p>待办来自学在浙大与拼题A，其余是你自己中转站里的内容。</p>
        </div>
        <div className="zpg-tools">
          {!loading && <span className="zpg-count">{summarize(todos.rows.length + planCards.length, state.entries.length)}</span>}
          <button
            type="button"
            className="zy-secondary zpg-plan"
            onClick={runPlan}
            disabled={loading || planning || !hasAnything}
            title="把中转站里混杂的条目按事项拆成卡片"
          >
            <Icon name="bulb" size={16} />
            {planning ? '正在规划…' : 'AI 自动规划'}
          </button>
          <button
            type="button"
            className="zy-secondary zpg-refresh"
            onClick={refresh}
            disabled={loading || planning}
          >
            <Icon name="history" size={16} />
            {loading ? '正在读取' : '刷新'}
          </button>
        </div>
      </div>

      {loading && (
        <div className="zpg-slot" role="status" aria-live="polite">
          <p className="zpg-status"><span className="zpg-dot" aria-hidden="true" />正在读取待办与中转站…</p>
        </div>
      )}

      {!loading && (
        <div className="zpg-slot">
          {/* 数据源状态：每个来源一句话，失败原因分别说 —— 它们该去的地方不一样 */}
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
          />

          {error && <ErrorBlock error={error} />}

          {!hasAnything && !error && (
            <Empty icon="calendar" title="还没有内容">
              配好数据源之后，这里会出现你的待办、以及从中转站同步过来的记录。
            </Empty>
          )}

          {groups.todoGroups.length > 0 && (
            <div className="zpg-days">
              {groups.todoGroups.map((group) => (
                <section key={group.key} className="zpg-day" aria-labelledby={`zpg-${group.key}`}>
                  <SectionTitle aside={group.rows.length > 1 ? `${group.rows.length} 条` : null}>
                    <span id={`zpg-${group.key}`}>{group.label}</span>
                  </SectionTitle>
                  <ul className="zpg-list">
                    {group.rows.map((row) => <TodoRow key={`${row.source}:${row.id}`} row={row} />)}
                  </ul>
                </section>
              ))}
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

          {hasAnything && (
            <p className="zpg-foot">
              中转站的内容已在本机留了一份，那台创空间丢了数据也不会影响这里。
            </p>
          )}
        </div>
      )}
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
 * ⚠️ 学在浙大缺账号**不是故障**，是还没做一次配置。所以它的文案写"未配置"并给出
 *    可直接照做的命令，而不是把 `LOGIN_REQUIRED` 原文摊在页面上 —— 看见一段英文
 *    代码的用户会以为页面坏了，而其实只要在终端跑一条命令。
 */
function SourceBar({ todos, pta, remote, entryCount }) {
  const xzzd = todos.xzzdError;
  const ptaError = todos.ptaError;
  const remoteError = remote?.error;
  // 学在浙大读不到 = 还没登录过浙大账号。**不引导去终端跑命令**：凭据已经集中在
  // 宿主（课堂登录时写入，omni 读取），所以只需在「个人」页登录一次。
  // 「还没登录」不是故障，是待完成的动作。三个码都归于这一类：
  //   NEED_LOGIN      —— 宿主侧翻译后的统一码（当前口径）
  //   LOGIN_REQUIRED  —— 数据包原始码（宿主翻译漏掉时兜底）
  //   NO_SESSION      —— 旧桥接方案留下的码，保留以免旧缓存读到就显示"读取失败"
  const needLogin = ['NEED_LOGIN', 'LOGIN_REQUIRED', 'NO_SESSION'].includes(xzzd?.code);
  const needCookie = ptaError?.code === 'COOKIE_IMPORT_REQUIRED';

  return (
    <div className="zpg-sources">
      <SourceItem
        label="学在浙大"
        ok={!xzzd}
        text={needLogin
          ? '未登录 · 去「个人」页点「连接课堂」'
          : xzzd ? '读取失败' : `${todos.rows.filter((r) => r.source === 'xzzd').length} 条`}
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
 * 一条待办。
 *
 * 待办是**可点去处理的**（学在浙大/拼题A 都有原始页面），所以它用 `<a>`；
 * 这与中转站条目不同 —— 那种是只读文本，做成可点是假承诺。
 */
function TodoRow({ row }) {
  const kind = KIND[row.kind] ?? KIND_FALLBACK;
  return (
    <li>
      <div className="zpg-item zpg-item-todo">
        <div className="zpg-summary zpg-summary-static">
          <span className={`zpg-kind ${kind.cls}`}>
            <Icon name={kind.icon} size={13} />
            {row.sourceLabel}
          </span>
          <span className="zpg-title">{row.title}</span>
          <span className="zpg-meta">
            {row.detail && <span className="zpg-detail">{row.detail}</span>}
            <span className="zpg-due">
              {whenIso(row.due)}
              {row.due && <em className="zpg-left">{countdown(row.due)}</em>}
            </span>
          </span>
          {row.url && (
            <a className="zpg-open" href={row.url} target="_blank" rel="noreferrer" aria-label={`打开 ${row.title}`}>
              <Icon name="arrow" size={15} />
            </a>
          )}
        </div>
        {/* AI 拆出的卡片带「具体动作」：那才是可执行的那一句。
            放在标题下面而不是等宽并排 —— 它通常比标题长。 */}
        {row.action && <p className="zpg-todo-action">{row.action}</p>}
      </div>
    </li>
  );
}

/** 一天的分组标题。全部收起时，类别构成是唯一的可判断信息。 */
function DayHeading({ id, label, rows }) {
  const scope = describeScope(rows);
  return (
    <div className="zpg-day-head">
      <SectionTitle aside={rows.length > 1 ? `${rows.length} 条` : null}>
        <span id={id}>{label}</span>
      </SectionTitle>
      <p className="zpg-day-scope">{scope}</p>
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
 * 设置分区。
 *
 * 两个彼此独立的配置：
 *   1. 中转站（域名 + 读密钥）；
 *   2. 拼题A Cookie（短信验证，只能手动导入；与智云账号无关）。
 * 学在浙大不在这里 —— 它复用智云的 CAS 账号，避免两处填同一份密码。
 */
export function SettingsSection() {
  const [endpoint, setEndpoint] = useState('');
  const [readKey, setReadKey] = useState('');
  const [cookie, setCookie] = useState('');
  const [state, setState] = useState({ loading: true, saving: false, message: null, error: null });
  const [summary, setSummary] = useState('读取中…');
  const [pta, setPta] = useState(null);

  useEffect(() => {
    let live = true;
    settings('').then(
      (payload) => {
        if (!live) return;
        setEndpoint(payload.config?.endpoint ?? '');
        setReadKey(payload.config?.readKey ?? '');
        setPta(payload.pta ?? null);
        setSummary(describeSummary(payload));
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
      setPta(payload.pta ?? null);
      setSummary(describeSummary(payload));
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

  // ⚠️ 这里**不画** `<details>` / `<summary>` / `.zy-settings-group`。
  //    壳的 `PersonalSettingsBridge` 已经为每个 `settings.section` 注册渲染了外层折叠分组
  //    （图标 + 标题 + 副标题 + chevron + body），然后才把本组件渲染进 body 里。
  //    自己再包一层，结果就是截图里那种"壳套壳"：两层折叠框、两个"规划数据源"标题。
  //    参考 `dsh-zhiyun-page-paper/src/SettingsSection.jsx` —— 它直接返回 `<form>`。
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
          <small>「规划」页要同步的那台中转站，只支持 http / https。同步过的内容会在本机留一份。</small>
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

      <form className="zpg-form zpg-form-pta" onSubmit={saveCookie}>
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
            它与智云/学在浙大用的是**不同**凭证，所以单独一项。
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

/** 折叠状态下的一行摘要：让收起来也知道连了什么。 */
function describeSummary(payload) {
  const parts = [];
  if (payload.config?.configured) parts.push(`中转站 ${payload.entries?.length ?? 0} 条`);
  else parts.push('中转站未配置');
  parts.push(payload.pta?.configured ? '拼题A 已配置' : '拼题A 未配置');
  return parts.join(' · ');
}
