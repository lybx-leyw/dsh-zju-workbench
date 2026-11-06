/**
 * **演示页**：读一份日志，逐帧重建整条链路。
 *
 * # 交互契约（这就是"调适"要的东西）
 *
 *   · **不自动播放** —— 进来停在第一步，用户点「下一步」才走；
 *   · 每一步都显示：这一条事件是什么、当前状态、当前阶段；
 *   · 随时跳任一阶段（点导轨），或直接拖到某一条事件；
 *   · 点树上的节点 → 弹出该节点的**产物**（探针）；
 *   · 右侧常驻"本阶段产物"，随推进实时刷新。
 *
 * # 状态从哪来
 *
 * 全部来自 `player.state`（= `fold(records, seq)`）。渲染只读，不改状态。
 */

import { Player, labelOf } from './player.mjs';
import { renderOverview, renderTree, renderPoints } from './render.mjs';
import { renderAudit } from './audit-view.mjs';
import { PHASES } from '/shared/log-core.mjs';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

let player = null;
/**
 * 这次运行的**真实配置**（斩杀线、并发、模型名）。
 *
 * ⚠️ 早先界面上到处写死 `1200`。于是用户把斩杀线设成 600 时，900 token 的叶
 * 不会告警；设成 2400 时，1800 token 反而告警。**同一个对象在不同视图里
 * 用了不同的好坏标准** —— 那比没有标注更糟，因为它会制造假异常。
 *
 * 现在统一从日志的 `meta.start.config` 读；读不到就显示"未知"并且**不判好坏**，
 * 而不是退回一个可能错的默认值。
 */
let runConfig = null;
/** 斩杀线；`null` = 未知（此时不做超线判定，而不是假装 1200）。 */
const splitLine = () => (Number.isFinite(runConfig?.splitLine) ? runConfig.splitLine : null);
/** 判断一个 token 量是否超线；未知时返回 null（= 不表态）。 */
function overLine(tok) {
  const line = splitLine();
  if (line === null) return null;
  return Number(tok) > line;
}
/** 超线状态的展示（未知就说未知）。 */
function lineCell(tok, text) {
  const over = overLine(tok);
  if (over === null) return `<td>${text ?? tok}</td>`;
  return `<td class="${over ? 'warn' : ''}">${text ?? tok}${over ? ` ⚠ 超线 ${splitLine()}` : ''}</td>`;
}

let records = [];
let currentView = 'overview';
/** 当前筛选/搜索命中的事件下标集合；null = 不筛选。 */
let hitSet = null;

/* ── 取参数 ──────────────────────────────────────────────────── */
const params = new URLSearchParams(location.search);
const logId = params.get('id');
const token = params.get('t') ?? window.__BENCH_TOKEN__ ?? '';

/* ── 启动 ────────────────────────────────────────────────────── */
async function boot() {
  if (!logId) {
    $('stage').innerHTML = '<div class="empty">没有指定日志 id。回到基准台跑一次，或从列表里选。</div>';
    return;
  }
  $('logId').textContent = logId;

  let data;
  try {
    const res = await fetch(`/api/log?id=${encodeURIComponent(logId)}`);
    data = await res.json();
    if (!data.ok) throw new Error(data.error ?? '读不到');
  } catch (error) {
    $('stage').innerHTML = `<div class="empty">读日志失败：${esc(error.message)}</div>`;
    return;
  }

  records = data.records ?? [];
  $('total').textContent = String(records.filter((r) => r.kind === 'event').length);

  /* 读这次运行的**真实配置**（斩杀线、并发、模型）。界面所有好坏判断都基于它，
   * 不再写死 1200。读不到就让 `splitLine()` 返回 null —— 宁可说"未知"，
   * 也不要拿一个可能错的默认值去判超线。 */
  const meta = records.find((r) => r.kind === 'meta' && r.what === 'start');
  runConfig = meta?.config ?? null;
  paintRunConfig(meta);

  /* ★ 日志不完整必须**当场说出来**（审查第 30 条）。
   * 否则用户会把"读到的部分"当成"完整证据"。 */
  paintIntegrity(data.integrity);

  player = new Player(records);
  player.onChange = () => paint();
  buildRail();
  paint();
}

/* ── 运行身份：常驻显示"这次跑的到底是什么"──────────────────────
 *
 * 审查第 31 条：早先只显示日志 ID，不显示数据范围、模型、斩杀线、缓存状态。
 * 你必须凭记忆判断"现在看的是哪一次、用什么参数跑的" —— 很容易拿错结果比较。
 */
function paintRunConfig(meta) {
  const box = $('runMeta');
  if (!box) return;
  if (!meta) { box.innerHTML = '<span class="bad">日志里没有 start 元信息</span>'; return; }
  const c = meta.config ?? {};
  const sc = meta.scope ?? null;
  const fmtSec = (x) => (Number.isFinite(x)
    ? `${Math.floor(x / 60)}:${String(Math.round(x % 60)).padStart(2, '0')}`
    : '—');
  const scopeText = sc
    ? `P${sc.fromPage}–P${sc.toPage} / 共 ${sc.totalPagesInSection ?? '?'} 页`
    : '—';

  const items = [
    ['节次', meta.section ?? '—'],
    /* ★ 真实数据范围：页码 + 时间区间 + 是否整节。
     * 审查第 28 条：只说"整节 / N 页"会让人误判实际跑了什么 ——
     * 真实窗口常常是"从有声音的那页开始"，不是第 1 页。 */
    ['范围', scopeText],
    ['时间', sc ? `${fmtSec(sc.fromSec)} – ${fmtSec(sc.toSec)}` : '—'],
    ['整节', sc ? (sc.wholeSection ? '是' : '否（从中段开始）') : '—'],
    ['模型', c.model || '（默认）'],
    ['视觉', c.visionModel && c.visionModel !== c.model ? c.visionModel : '（同对话）'],
    ['斩杀线', Number.isFinite(c.splitLine) ? c.splitLine : '<span class="bad">未知</span>'],
    ['并发', c.concurrency ?? '—'],
    ['页数上限', c.maxPages ? c.maxPages : '整节'],
    ['页', meta.pages ?? '—'],
    ['字幕', meta.subtitles ?? '—'],
  ];
  box.innerHTML = items.map(([k, v]) => `<span class="mi"><b>${k}</b>${v}</span>`).join('');
}

/**
 * 日志完整性提示。
 *
 * 三种情况要说：
 *   · 有坏行（写盘中断/被改过）；
 *   · 有写盘失败；
 *   · 没有 end（没跑完，或异常退出）。
 */
function paintIntegrity(info) {
  const box = $('integrity');
  if (!box) return;
  if (!info) { box.hidden = true; return; }

  const problems = [];
  if (info.broken) problems.push(`${info.broken} 行读不懂（日志可能被写坏）`);
  if (info.writeFailures) problems.push(`写入失败 ${info.writeFailures} 次${info.writeError ? `：${info.writeError}` : ''}`);
  if (!info.hasEnd) problems.push('没有结束记录 —— 这次运行没跑完或异常退出');
  if (info.endedWithError) problems.push(`以失败结束：${info.errorMessage ?? '（没有原因）'}`);

  if (!problems.length) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = `<b>日志不完整</b><ul>${problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>`;
}

/* ── 导轨（八段）──────────────────────────────────────────────── */
function buildRail() {
  const rail = $('rail');
  rail.replaceChildren();
  for (const phase of PHASES) {
    const b = document.createElement('button');
    b.className = 'stg';
    b.dataset.phase = phase.key;
    b.innerHTML = `<span class="sn">${phase.no}</span><span class="st">${phase.name}</span><span class="sb"><i></i></span>`;
    b.addEventListener('click', () => {
      /* 点导轨 = 跳到这一段的**最后一条**（看成品），再点一次回本段第一条。
       * 这是"我想看这一段做完了是什么样"的最常见动作。 */
      const end = player.seekPhaseEnd(phase.key);
      if (!end) return;
      paint();
    });
    rail.appendChild(b);
  }
}

/* ── 主绘制 ──────────────────────────────────────────────────── */
function paint() {
  if (!player) return;
  const state = player.state;
  const phase = player.phase;
  const current = player.current;

  /* 读数 */
  $('step').textContent = player.index < 0 ? '0' : String(player.index + 1);
  $('phaseNow').textContent = phase ? `${phase.no} ${phase.name}` : '—';
  $('actNow').textContent = current ? labelOf(current) : '（还没开始）';
  $('cVision').textContent = String(state.counters.vision);
  $('cMix').textContent = String(state.counters.mix);
  $('cBlocks').textContent = String(state.blocks.size);
  $('cPoints').textContent = String(state.points.length);
  $('cElapsed').textContent = `${(state.lastT / 1000).toFixed(2)}s`;
  /* ★ 实时 vs 补发：必须让人看见比例。
   *
   * 只有 vision/mix 是真正实时发出的（那是唯一的并发证据）；
   * 标记/建树/讲义都是跑完补发的。把两者混在一起看，会误以为
   * "补发顺序 = 执行顺序"（审查第 10 条）。 */
  const liveEl = $('cLive');
  if (liveEl) liveEl.textContent = `${state.live} / ${state.deferred}`;

  /* 导轨状态必须**分四种**，不能"有事件就 100%"。
   *
   * 审查第 27 条：早先只要计数 > 0 就把进度条画满，且不分
   * "无需执行 / 未执行 / 执行失败"。于是你无法用导轨判断某段是否真的跑完。
   *
   * 现在：
   *   · `na`   —— 本段在设计里对本次运行不适用（如没有润色就谈不上转格式）
   *   · `none` —— 还没走到
   *   · `fail` —— 有失败事件
   *   · `done` —— 有事件且无失败
   * 进度条按**事件数相对本段应有量**，没有预期量时只表示"有/无"。
   */
  const phaseOrder = PHASES.map((p) => p.key);
  for (const el of document.querySelectorAll('#rail .stg')) {
    const key = el.dataset.phase;
    const idx = phaseOrder.indexOf(key);
    const curIdx = phase?.key ? phaseOrder.indexOf(phase.key) : -1;

    const saw = countPhase(state, key);
    const fails = countPhaseFails(state, key);
    const isCurrent = key === phase?.key;

    el.classList.toggle('on', isCurrent);
    el.classList.toggle('done', idx < curIdx && saw > 0);
    el.classList.toggle('fail', fails > 0);
    el.classList.toggle('none', saw === 0);

    const bar = el.querySelector('.sb i');
    if (fails > 0) {
      bar.style.width = '100%';
      bar.style.background = 'var(--accent)';
    } else if (saw > 0) {
      bar.style.width = '100%';
      bar.style.background = idx < curIdx ? 'var(--ink)' : 'var(--accent)';
    } else {
      bar.style.width = '0';
      bar.style.background = 'var(--rule)';
    }
    /* 悬停说明这一段的真实状态 —— 不是"绿了就代表对"。 */
    el.title = saw === 0
      ? `${key}：尚未执行`
      : fails > 0
        ? `${key}：${saw} 条事件，其中 ${fails} 条失败`
        : `${key}：${saw} 条事件`;
  }

  /* 进度条 */
  const total = player.length;
  const ratio = total ? (player.index + 1) / total : 0;
  $('bar').style.width = `${Math.round(ratio * 100)}%`;
  $('barLabel').textContent = `${player.index + 1} / ${total}`;

  /* 画布 */
  const svg = $('canvas');
  const box = svg.parentElement.getBoundingClientRect();
  const size = { width: Math.max(320, box.width - 2), height: Math.max(200, box.height - 2) };

  /* 切视图前先清掉上一次可能留下的说明块。 */
  svg.parentElement.querySelector('.auditCanvas')?.remove();

  /* 只有树视图可能比屏幕高，需要滚动。其它视图要填满、不许撑高。 */
  svg.parentElement.classList.toggle('tall', currentView === 'tree');

  if (currentView === 'audit') {
    /* 验收不是画布视图 —— 它要显示**列表**，不是图。
     * 所以这里不清空画布，而是把一个说明放进画布区，
     * 真正的验收明细在右侧「架构验收」卡片里常驻。 */
    svg.replaceChildren();
    const box = document.createElement('div');
    box.className = 'auditCanvas';
    box.innerHTML = '<b>架构验收</b><span>见右侧「架构验收」面板 —— '
      + '那里逐条列出不变量是否成立，每条都带证据或明确说"无法判定"。</span>';
    svg.parentElement.appendChild(box);
  } else if (currentView === 'tree') {
    renderTree(svg, state, { ...size, onPick: showProbe });
  } else if (currentView === 'points') {
    renderPoints(svg, state, { ...size, onPick: showProbe });
  } else {
    renderOverview(svg, state, { ...size, phase: phase?.key, splitLine: splitLine() });
  }

  /* 事件列表：当前那条高亮，附近几条可见 */
  paintEvents();

  /* 本阶段产物（随推进刷新） */
  paintArtifact(phase?.key);

  /* 架构验收：**每一帧都重算**（它是纯函数，便宜），
   * 于是你能看到"走到哪一步时哪条不变量被破坏了" —— 这正是调适要的。 */
  renderAudit($('audit'), state);
}

/** 某阶段里有多少条**失败**事件（用来把导轨标红）。 */
function countPhaseFails(state, phaseKey) {
  const phase = PHASES.find((p) => p.key === phaseKey);
  if (!phase) return 0;
  let n = 0;
  /* vision：识别失败；mix：混合失败或跳过；polish：润色失败。 */
  if (phaseKey === 'vision') {
    for (const p of state.pages.values()) {
      if (p.vision?.failure) n += 1;
      if (p.mix?.failure) n += 1;
    }
  }
  if (phaseKey === 'polish' && state.polish?.failed) n += 1;
  return n;
}

/** 某阶段是否已经出现过事件。 */
function countPhase(state, phaseKey) {
  const phase = PHASES.find((p) => p.key === phaseKey);
  if (!phase) return 0;
  return phase.acts.reduce((a, act) => a + (state.counters[act] ?? 0), 0);
}

/** 筛选命中数显示在事件计数处（demo 没有顶栏 status）。 */
function showHitCount(n) {
  const el = document.getElementById('evCount');
  if (el) el.textContent = String(n);
}

/* ── 事件列表 ────────────────────────────────────────────────── */
function paintEvents() {
  const box = $('events');
  const all = player.events;

  /* ★ 有筛选结果时，**只渲染命中的那几条** —— 这就是"按问题导航"：
   * 点「失败」立刻看到所有失败事件，不用逐条翻。
   * 没有筛选时回到"当前位置附近"的窗口（几百条全渲染会卡）。 */
  let indices;
  if (hitSet) {
    indices = hitSet.slice(0, 200);
  } else {
    const from = Math.max(0, player.index - 12);
    const to = Math.min(all.length, player.index + 40);
    indices = Array.from({ length: Math.max(0, to - from) }, (_, k) => from + k);
  }

  const html = [];
  for (const i of indices) {
    const ev = all[i];
    if (!ev) continue;
    const active = i === player.index;
    html.push(`<button class="ev${active ? ' on' : ''}" data-i="${i}">
      <span class="ei">${i + 1}</span>
      <span class="et">${(ev.t / 1000).toFixed(2)}s</span>
      <span class="el">${esc(labelOf(ev))}</span>
      ${ev.data?.deferred ? '<span class="ed" title="这条是 parse() 之后一次性补发的：内容真实，但时间戳不是操作发生的时刻">事后</span>' : ''}
    </button>`);
  }
  box.innerHTML = html.length ? html.join('') : '<div class="hint" style="padding:8px">没有命中。点「全部」清除筛选。</div>';
  for (const btn of box.querySelectorAll('.ev')) {
    btn.addEventListener('click', () => { player.pause(); player.seek(Number(btn.dataset.i)); });
  }
  const active = box.querySelector('.ev.on');
  if (active) active.scrollIntoView({ block: 'nearest' });
}

/* ── 页状态文案：必须区分四种情况 ────────────────────────────────
 *
 * 早先用 `${p.failure ? ... : p.skipped ? '跳过' : '已混'}` —— 只看一个
 * 合并后的 `failure`，于是"识别成功、混合失败"的页被画成「已混」。
 *
 * 现在按四个互斥状态显示：
 *   · 识别失败  → 红（下游根本没跑）
 *   · 混合失败  → 红（读了图但没切出块）
 *   · 混合跳过  → 黄（识别失败的连带结果）
 *   · 已混合    → 绿
 */
function pageStateText(p) {
  if (p.visionFailure) return `识别失败 ${p.visionFailure}`;
  if (p.mixFailure) return `混合失败 ${p.mixFailure}`;
  if (p.mixSkipped) return '未混合（上游失败）';
  if (!p.blocks && !p.lines) return '无内容';
  return `已混 ${p.blocks} 块`;
}

/* ── 阶段产物面板 ────────────────────────────────────────────── */
function paintArtifact(phaseKey) {
  const box = $('artifact');
  if (!phaseKey) { box.innerHTML = '<div class="hint">（还没开始）</div>'; return; }
  const a = player.artifact(phaseKey);
  box.innerHTML = artifactHtml(phaseKey, a);
}

/** 把一个阶段的产物渲染成可读的东西（不是裸 JSON）。 */
function artifactHtml(phaseKey, a) {
  if (!a) return '<div class="hint">（无）</div>';
  switch (phaseKey) {
    case 'vision':
      /* 每页给"看原图"入口 —— 验收"识别读对没有"必须能对照原图。 */
      return `<table class="tbl"><thead><tr><th>页</th><th>字</th><th>块</th><th>状态</th><th></th></tr></thead><tbody>
        ${a.pages.map((p) => `<tr><td>P${p.page}</td><td>${p.chars}</td><td>${p.blocks}</td>
          <td class="${p.visionFailure ? 'bad' : p.mixFailure ? 'bad' : p.mixSkipped ? 'warn' : 'ok'}">${pageStateText(p)}</td>
          <td>${mediaButton(p)}</td></tr>`).join('')}
      </tbody></table>`;
    case 'mark':
      return `<div class="hint">${a.counts.total} 块 · ${a.counts.main} 主线 · ${a.counts.side} 支线 · ${a.counts.unlabeled} 未标 · ${a.counts.unanchored} 无课件</div>
        <table class="tbl"><thead><tr><th>块</th><th>页</th><th>role</th><th>facet</th><th>概述</th></tr></thead><tbody>
        ${a.blocks.map((b) => `<tr><td>${b.index}</td><td>${b.page ?? '—'}</td>
          <td class="${b.role === '支线' ? 'bad' : b.role ? 'ok' : 'warn'}">${b.role ?? '未标'}</td>
          <td>${(b.facets ?? []).join('/')}</td><td>${esc(b.summary)}</td></tr>`).join('')}
      </tbody></table>`;
    case 'sieve':
      return a.board.length
        ? `<table class="tbl"><thead><tr><th>块</th><th>页</th><th>原因</th><th>概述</th></tr></thead><tbody>
           ${a.board.map((b) => `<tr><td>${b.index}</td><td>${b.page ?? '—'}</td><td>${esc(b.why)}</td><td>${esc(b.summary)}</td></tr>`).join('')}
           </tbody></table>`
        : '<div class="hint">（没有支线块）</div>';
    case 'stash':
      return `<table class="tbl"><thead><tr><th>页</th><th>块</th><th>token</th></tr></thead><tbody>
        ${a.leaves.map((l) => `<tr><td>${l.page != null ? `P${l.page}` : '无课件'}</td><td>${l.blocks}</td>
          ${lineCell(l.pendingTok)}</tr>`).join('')}
      </tbody></table>`;
    case 'merge':
      return `<div class="hint">正式语言组织 ${a.organizations?.length ?? 0} 批；可对照clean原稿与正式正文。</div>
      <table class="tbl"><tbody>${(a.organizations ?? []).map(m => `<tr><td>${esc(m.leaf)}</td><td>${m.blockIndexes?.length ?? 0} 块</td><td><button class="expand diff" data-before="${encodeURIComponent(m.before ?? '')}" data-after="${encodeURIComponent(m.after ?? '')}">正式组织对照</button></td></tr>`).join('')}</tbody></table>
      <table class="tbl"><thead><tr><th>叶</th><th>切分</th><th>支数</th><th>深层</th></tr></thead><tbody>
        ${a.merges.map((m, i) => `<tr><td>叶${i}</td><td class="${m.split ? 'warn' : m.overLine === false ? '' : 'bad'}">${mergeStateText(m)}</td>
          <td>${m.parts}</td><td>${m.deep}</td>
          <td>${(m.before || m.after)
            ? `<button class="expand diff" data-before="${encodeURIComponent(String(m.before ?? ''))}" data-after="${encodeURIComponent(String(m.after ?? ''))}">对照</button>`
            : ''}</td></tr>`).join('')}
      </tbody></table>`;
    case 'regroup':
      return `<table class="tbl"><thead><tr><th>id</th><th>token</th><th>并段</th><th>页</th></tr></thead><tbody>
        ${a.points.map((p) => `<tr><td>${esc(p.id)}</td>${lineCell(p.tok)}
          <td>${p.merged}</td><td>${(p.pages ?? []).join(',')}</td></tr>`).join('')}
      </tbody></table>`;
    case 'lecture':
      /* 讲义列表全部给出（可滚动），不再截断 —— 计数显示 100
       * 不等于你能检查这 100 个（审查第 24 条）。 */
      return a.chapters.length
        ? a.chapters.map((c) => `<div class="chap"><b>${esc(c.title || '（无名章）')}</b>
            <ul>${c.topics.map((t, i) => `<li>
              <button class="expand" data-body="${encodeURIComponent(String(t.text ?? ''))}"
                data-title="${esc(t.title || '（无名）')}">${t.covered ? '▸' : '·'}</button>
              ${esc(t.title || '（无名）')}
              <span class="dim">${t.chars} 字 / ${t.blocks} 块${t.covered ? '' : ' · 无正文'}</span>
            </li>`).join('')}</ul></div>`).join('')
        : '<div class="hint">（还没有讲义）</div>';
    case 'polish':
      if (!a.polish) return '<div class="hint">（还没到这一步）</div>';
      return a.polish.failed
        ? `<div class="bad">失败：${esc(a.polish.message ?? a.polish.code)}</div>`
        : `<div class="${a.polish.unchanged ? 'ok' : 'warn'}">${a.polish.unchanged ? '一字未改（跑过但没改，是事实不是失败）' : `${a.polish.changes} 处改动`}</div>
           <div class="hint">${a.polish.chars} 字</div>
           ${a.polish.text ? `<button class="expand" data-body="${encodeURIComponent(a.polish.text)}" data-title="终稿全文">阅读终稿全文</button>` : ''}`;
    default:
      return `<pre>${esc(JSON.stringify(a, null, 1)).slice(0, 4000)}</pre>`;
  }
}

/* ── 合并状态文案：必须区分「没超线」与「超线但切不开」──────────────
 *
 * 早先写 `split ? "切了" : "未超线"` —— 把"切不开"当成"没超线"。
 * 但上一轮审查已证实：真实块的正文结构不匹配时，超长叶**根本切不动**。
 * 那种情况画成正常，正好遮住要验收的「斩杀线是否有效」。
 */
function mergeStateText(m) {
  if (m.split) return `切了 ${m.parts} 支`;
  if (m.overLine === true) return '⚠ 超线但切不开';
  if (m.overLine === false) return '未超线';
  return '未切分（斩杀线未知）';
}

/** "看原图"按钮：只有真存了图才给（不假装有）。 */
function mediaButton(page) {
  if (!page?.media?.name) return '';
  const src = `/api/media?id=${encodeURIComponent(logId)}&page=${page.page}`;
  return `<button class="expand look" data-img="${src}" data-page="${page.page}">原图</button>`;
}

/* ── 探针（点节点）────────────────────────────────────────────── */
function showProbe(phaseKey, node) {
  const box = $('probe');
  const close = '<button class="x" id="probeClose">×</button>';
  let body = '';
  if (node?.kind === 'chapter') {
    body = `<h4>${esc(node.chapter.title || '（无名章）')}</h4>
      <div class="hint">${node.chapter.topics.length} 个知识点 · ${node.chapter.chars} 字</div>
      <ul class="probeList">${node.chapter.topics.map((t) => `<li>${esc(t.title || '（无名）')}
        <span class="dim">${t.chars} 字 / ${t.blocks} 块</span></li>`).join('')}</ul>`;
  } else if (node?.kind === 'topic') {
    const t = node.topic;
    /* ★ 探针必须能**读到字**。
     *
     * 审查第 15/16 条：早先探针只有标题、字数、块数 —— 那回答不了
     * "内容有没有编造、公式对不对、是不是只由树填充"。
     * 现在把正文完整给出来（可滚动），并标出正文来源与支撑块。
     */
    const text = String(t.text ?? '').trim();
    body = `<h4>${esc(t.title || '（无名知识点）')}</h4>
      <div class="kv"><b>字数</b><span>${t.chars}</span>
      <b>块数</b><span>${t.blocks}</span>
      <b>正文来源</b><span>${esc(t.bodySource ?? '—')}</span>
      <b>已讲</b><span class="${t.covered ? 'ok' : 'bad'}">${t.covered ? '有正文' : '无正文'}</span></div>
      <div class="hint">所属章：${esc(node.chapter.title || '（无名章）')}</div>
      ${(t.blockIndexes ?? []).length ? `<div class="hint">支撑块：${(t.blockIndexes ?? []).join(', ')}</div>` : ''}
      ${text
        ? `<div class="bodyTitle">正文</div><pre class="bodyText">${esc(text)}</pre>`
        : '<div class="bad" style="margin-top:6px">这一节没有正文 —— 填充失败或返回为空</div>'}`;
  } else if (node?.kind === 'point') {
    const p = node.point;
    body = `<h4>${esc(p.id || '知识点叶')}</h4>
      <div class="kv"><b>token</b><span class="${overLine(p.tok) ? 'warn' : ''}">${p.tok}${overLine(p.tok) ? ` ⚠ 超线 ${splitLine()}` : ''}</span>
      <b>合并段数</b><span>${p.merged}</span>
      <b>来源页</b><span>${(p.pages ?? []).join(', ') || '无课件'}</span>
      <b>字数</b><span>${p.chars}</span></div>
      ${p.title ? `<div class="hint">概述：${esc(p.title)}</div>` : ''}`;
  }
  box.innerHTML = `${close}<div class="ph">${esc(phaseKey)}</div>${body}`;
  box.hidden = false;
  $('probeClose').addEventListener('click', () => { box.hidden = true; });
}

/* ── 绑定 ────────────────────────────────────────────────────── */
function bind() {
  $('next').addEventListener('click', () => { player.pause(); player.next(); });
  $('prev').addEventListener('click', () => { player.pause(); player.prev(); });
  $('play').addEventListener('click', () => {
    if (player.playing) { player.pause(); $('play').textContent = '播放'; return; }
    if (player.atEnd) player.toStart();
    $('play').textContent = '暂停';
    player.play(() => { $('play').textContent = '播放'; });
  });
  $('start').addEventListener('click', () => { player.pause(); player.toStart(); paint(); });
  $('end').addEventListener('click', () => { player.pause(); player.toEnd(); paint(); });

  for (const btn of document.querySelectorAll('[data-view]')) {
    btn.addEventListener('click', () => {
      currentView = btn.dataset.view;
      for (const b of document.querySelectorAll('[data-view]')) b.classList.toggle('on', b === btn);
      paint();
    });
  }

  /* 正文展开 / 原图 / 合并前后对照。
   * 事件委托，因为列表是重绘的。 */
  document.getElementById('artifact')?.addEventListener('click', (e) => {
    /* ① 看原图 */
    const look = e.target.closest?.('.look');
    if (look) {
      const src = look.dataset.img;
      const pg = look.dataset.page;
      const box = $('probe');
      box.hidden = false;
      box.innerHTML = '<button class="x" id="probeClose">×</button>'
        + `<div class="ph">原图</div><h4>P${esc(pg)}</h4>`
        + `<img class="pageImg" src="${src}" alt="P${esc(pg)} 原图">`;
      $('probeClose')?.addEventListener('click', () => { box.hidden = true; });
      return;
    }

    /* ② 合并前后对照 */
    const diff = e.target.closest?.('.diff');
    if (diff) {
      const before = decodeURIComponent(diff.dataset.before ?? '');
      const after = decodeURIComponent(diff.dataset.after ?? '');
      const box = $('probe');
      box.hidden = false;
      box.innerHTML = '<button class="x" id="probeClose">×</button>'
        + '<div class="ph">合并前后</div>'
        + `<div class="bodyTitle">合并前</div><pre class="bodyText small">${esc(before || '（空）')}</pre>`
        + `<div class="bodyTitle">合并后</div><pre class="bodyText small">${esc(after || '（空）')}</pre>`;
      $('probeClose')?.addEventListener('click', () => { box.hidden = true; });
      return;
    }

    const btn = e.target.closest?.('.expand');
    if (!btn) return;
    const text = decodeURIComponent(btn.dataset.body ?? '');
    const title = btn.dataset.title ?? '';
    const box = $('probe');
    box.hidden = false;
    box.innerHTML = '<button class="x" id="probeClose">×</button>'
      + `<div class="ph">讲义正文</div><h4>${esc(title)}</h4>`
      + (text ? `<pre class="bodyText">${esc(text)}</pre>` : '<div class="bad">这一节没有正文</div>');
    $('probeClose')?.addEventListener('click', () => { box.hidden = true; });
  });

  /* 筛选按钮 */
  for (const btn of document.querySelectorAll('.fbtn')) {
    btn.addEventListener('click', () => {
      const kind = btn.dataset.filter;
      for (const b of document.querySelectorAll('.fbtn')) b.classList.toggle('on', b === btn);
      if (!kind) {
        hitSet = null;
      } else {
        const hits = player.filter(kind);
        hitSet = hits.length ? hits : [-1];   // 空结果给一个不存在的下标，显示"0 条"
        showHitCount(hits.length);
      }
      paint();
    });
  }

  /* 搜索：输入即筛（防抖 200ms） */
  let searchTimer = null;
  $('search')?.addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    const q = e.target.value;
    searchTimer = setTimeout(() => {
      if (!q.trim()) { hitSet = null; paint(); return; }
      const hits = player.search(q);
      hitSet = hits.length ? hits : [-1];
      paint();
    }, 200);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { player.pause(); player.next(); e.preventDefault(); }
    if (e.key === 'ArrowLeft') { player.pause(); player.prev(); e.preventDefault(); }
    if (e.key === ' ') { $('play').click(); e.preventDefault(); }
  });
}

boot().then(() => bind()).catch((error) => {
  $('stage').innerHTML = `<div class="empty">启动失败：${esc(error.message)}</div>`;
});
