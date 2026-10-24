/**
 * **评测页**的前端控制层。
 *
 * # 它只做一件事：发起评测、把进展显示出来
 *
 * **不放动画。** 评测时用户关心的是"跑完了没、哪里失败了"，不是看它演一遍。
 * 动画是**事后**的调试工具 —— 跑完点「逐步调适」进演示页，可以一步一步
 * 核对每条事件与它产出的东西。
 *
 * 把"跑"和"演"分开之后，两边各自简化了：
 *   · 这一页不需要维护任何动画状态，只显示进度与诊断；
 *   · 演示页不需要碰模型，只读日志。
 * 之前把它们揉在一起，结果是一份真相两个持有者，数字永远对不上。
 *
 * # 数据从哪来
 *
 * 全部来自 `POST /api/run` 的 SSE 事件流。服务端同时把事件落成 `.jsonl`
 * 日志（`log.mjs`），演示页读的就是那份 —— 所以"这里看到的"与"回放看到的"
 * 是同一批事件，不可能不一致。
 */

(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const TOKEN = window.__BENCH_TOKEN__;
  const DATASETS = window.__BENCH_DATASETS__ ?? [];
  const DEFAULTS = window.__BENCH_DEFAULTS__ ?? {};

  /* ── 只有 API Key 必填 ──────────────────────────────────────────
   *
   * 接口与模型**不预填明文**，而是留空 + 占位提示（"留空 = DeepSeek 官方"）。
   * 为什么不直接把默认值写进 value：
   *   · 写进 value 后用户就分不清"这是默认"还是"我填的"；
   *   · 他会去改它，而改坏之后（比如少个 /v1）不知道原来是什么。
   * 留空 + 明确提示，语义是"你不填我给你用这个"，而"默认值是什么"由服务端
   * 的 `resolveConfig` 唯一决定 —— 两边永远一致。
   */
  function applyDefaults() {
    const hint = (id, text, isDefault) => {
      const el = $(id);
      if (!el) return;
      el.placeholder = text;
      el.dataset.defaulted = isDefault ? '1' : '0';
    };
    hint('baseUrl', `留空 = ${DEFAULTS.baseUrl ?? 'DeepSeek 官方'}`, DEFAULTS.defaulted?.baseUrl);
    hint('model', `留空 = ${DEFAULTS.model ?? '（必填）'}`, DEFAULTS.defaulted?.model);
    /* 视觉模型的语义是"**跟随对话模型**"，不是"等于某个固定名字"。
     * 所以这里说"同模型"而不是显示当前值 —— 用户改了对话模型，
     * 视觉应当跟着变，写死一个名字会让人以为它是独立的。 */
    hint('visionModel', '留空 = 同对话模型', true);
    const key = $('apiKey');
    if (key) key.focus();
  }

  applyDefaults();

  /* ── 阶段 → 显示文案 ─────────────────────────────────────────── */
  const STAGE_LABEL = {
    vision: '识别', mix: '混合', mark: '标记', sieve: '筛支线',
    stash: '挂账', merge: '审查合并', regroup: '重构',
    chapter: '习坎分章', lecture: '习坎成稿', polish: '终稿润色',
  };

  /* ── 诊断日志 ────────────────────────────────────────────────── */
  function log(text, kind) {
    const box = $('log');
    if (!box) return;
    const row = document.createElement('div');
    const t = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    row.className = 'lrow' + (kind ? ` ${kind}` : '');
    row.innerHTML = `<span class="lt">${t}</span><span class="lb">${text}</span>`;
    box.prepend(row);
    while (box.children.length > 300) box.lastChild.remove();
    const cnt = $('diagCount');
    if (cnt) cnt.textContent = String(box.children.length);
  }

  function status(text, kind) {
    const el = $('status');
    if (!el) return;
    el.textContent = text;
    el.className = 'status' + (kind ? ` ${kind}` : '');
  }

  const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  /* ── 数据集下拉 ──────────────────────────────────────────────── */
  function fillDatasets(list) {
    const sel = $('dataset');
    if (!sel) return;
    sel.innerHTML = '';
    for (const d of list) {
      const opt = document.createElement('option');
      opt.value = d.key;
      opt.disabled = !d.ok;
      opt.textContent = `${d.title || d.key} · ${d.images} 图 / ${d.subtitles} 句${d.ok ? '' : '（缺材料）'}`;
      sel.appendChild(opt);
    }
    const first = list.find((d) => d.ok);
    if (first) sel.value = first.key;
  }

  /* ── 事件队列：逐帧消化 ──────────────────────────────────────── */
  const queue = [];
  let pumping = false;

  function pump() {
    if (pumping) return;
    pumping = true;
    const step = () => {
      const ev = queue.shift();
      if (ev === undefined) { pumping = false; return; }
      try {
        } catch (error) {
        log(`渲染失败：${esc(error.message)}`, 'err');
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /* ── 跑完之后进"演示" ──────────────────────────────────────────
   *
   * 评测本身**不放动画**：跑的时候用户要看的是"有没有跑完、哪里失败了"。
   * 动画是**事后**的调试工具 —— 点进去逐步走、点节点看产物。
   * 这两件事分开，各自才能做对。
   */
  let lastLogId = null;

  function showDemoLink() {
    if (!lastLogId) return;
    const box = $('demoLink');
    if (!box) return;
    box.hidden = false;
    box.innerHTML = `<a href="/demo?id=${encodeURIComponent(lastLogId)}" target="_blank" rel="noopener">
      逐步调适这次运行 →</a><span class="dim">${esc(lastLogId)}</span>`;
  }

  /* ── 一次评测 ────────────────────────────────────────────────── */
  let running = false;

  async function run() {
    if (running) return;
    const payload = {
      /* 空串原样发过去 —— 由服务端的 `resolveConfig` 补默认值。
       * 前端**不做**兜底：两边各写一份默认值就会不一致，那是最难查的错。 */
      baseUrl: $('baseUrl').value.trim(),
      apiKey: $('apiKey').value.trim(),
      model: $('model').value.trim(),
      visionModel: $('visionModel').value.trim(),
      sectionKey: $('dataset').value,
      maxPages: Number($('maxPages').value) || 0,
      splitLine: Number($('splitLine').value) || 1200,
      concurrency: Number($('concurrency').value) || 3,
    };
    /* 唯一必填项就是 Key。 */
    if (!payload.apiKey) {
      status('缺 API Key', 'err');
      log('填一个 API Key 就能开始 —— 接口与模型留空会用 DeepSeek 的默认值', 'err');
      $('apiKey')?.focus();
      return;
    }
    if (!payload.sectionKey) { status('缺数据集', 'err'); return; }

    running = true;
    $('run').disabled = true;
    /* 每次开跑都清零，否则上一轮的失败会串到这一轮的结论里。 */
    outcome.polishFailed = null; outcome.polishUnchanged = false;
    outcome.parseStatus = null; outcome.blockFailures = 0;
    outcome.lectureFailures = 0; outcome.warnings.length = 0; outcome.excluded = 0;
    hits = 0; setProgress(0, 1);
    $('log').innerHTML = '';
    queue.length = 0;
    status('运行中…');
    log(`开始：${esc(payload.sectionKey)}（${payload.maxPages || '整节'} 页上限）`);

    try {
      const res = await fetch('/api/run?t=' + encodeURIComponent(TOKEN), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok || !res.body) throw new Error(`服务返回 ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';
        for (const part of parts) {
          const line = part.split('\n').find((l) => l.startsWith('data:'));
          if (!line) continue;
          let ev;
          try { ev = JSON.parse(line.slice(5).trim()); } catch { continue; }
          handle(ev);
        }
      }
    } catch (error) {
      status('失败', 'err');
      log(`请求失败：${esc(error.message)}`, 'err');
    } finally {
      running = false;
      $('run').disabled = false;
    }
  }

  /* ── 运行状态累积：用来判断"到底算不算成功" ──────────────────
   *
   * ⚠️ 早先 `done` 一律画成绿色「完成」。但 `done` 只表示**跑完了**，
   * 不表示**质量合格**：润色可以失败、解析可以是 partial、讲义可以有失败项。
   * 把"跑完"画成"成功"，正好盖住最该看的问题。
   *
   * 所以这里累积所有能说明"不完美"的事实，`done` 时据此决定顶栏是
   * 绿（全好）/ 黄（跑完但有缺陷）/ 红（失败）。
   */
  /** 已收到的日志事件条数（给顶栏一个"还活着"的信号）。 */
  let hits = 0;

  /** 进度条：没有就创建，有就更新。 */
  function setProgress(done, total) {
    const bar = $('runBar');
    if (!bar) return;
    const pct = total ? Math.round((done / total) * 100) : 0;
    bar.style.width = `${pct}%`;
    const label = $('runPct');
    if (label) label.textContent = `${pct}%`;
  }

  const outcome = {
    polishFailed: null,     // { code, message }
    polishUnchanged: false,
    parseStatus: null,      // ready | partial
    blockFailures: 0,       // 解析里失败的页数
    lectureFailures: 0,     // 讲义里失败的卷数
    warnings: [],           // 解析/建树/讲义发出的告警
    excluded: 0,            // 未进讲义的块数
  };

  /** 把 outcome 折成一句**诚实**的结论。 */
  function verdict() {
    const bad = [];
    if (outcome.polishFailed) bad.push(`润色失败（${outcome.polishFailed.code}）`);
    if (outcome.parseStatus === 'partial') bad.push('解析部分完成');
    if (outcome.blockFailures) bad.push(`${outcome.blockFailures} 页识别失败`);
    if (outcome.lectureFailures) bad.push(`${outcome.lectureFailures} 卷讲义失败`);
    return bad;
  }

  function handle(ev) {
    if (!ev || !ev.kind) return;

    switch (ev.kind) {
      /* ★ 细粒度进度：后端一直在发，**早先前端完全没处理**。
       * 于是"正在工作 / 等模型 / 重试 / 卡住"在屏幕上长得一模一样，
       * 顶栏永远停在"识别中…"。这里把它显示出来。 */
      case 'progress': {
        const d = ev.detail ?? {};
        /* phase 是产品内部标识（faithful / mix / tags / lecture），
         * 顶栏要显示**人话**。没映射到就原样显示并加问号，不假装认识。 */
        const PHASE_ZH = {
          faithful: '识别', mix: '混合', tags: '标记', lecture: '习坎', polish: '润色',
        };
        const phase = PHASE_ZH[ev.phase] ?? `${ev.phase ?? '未知'}?`;
        if (ev.done != null && ev.total != null) {
          status(`${phase} ${ev.done}/${ev.total}`);
          setProgress(ev.done, ev.total);
        }
        /* 带 detail 的逐页事件写进日志（这是"每页读了多少字"的来源）。 */
        if (d.page != null) {
          if (ev.phase === 'faithful') {
            log(`识别 P${d.page} · ${d.hasText ? `${d.chars} 字` : `失败 ${d.failure ?? ''}`}`,
              d.hasText ? '' : 'err');
          } else if (ev.phase === 'mix') {
            log(`混合 P${d.page} · ${d.skipped ? '跳过（识别失败）' : `${d.blocks ?? 0} 块 / ${d.lines ?? 0} 句`}`,
              d.skipped ? 'warn' : '');
          }
        }
        break;
      }

      /* 日志事件流：每条真实事件一行（追查用）。 */
      case 'event': {
        const e = ev.event ?? {};
        hits += 1;
        const counter = $('evLive');
        if (counter) counter.textContent = String(hits);
        break;
      }

      case 'config':
        /* 服务端补了默认值 → 在日志里说清楚用的是哪个，别让用户猜 */
        log(`已用默认：接口 ${esc(ev.baseUrl)} · 模型 ${esc(ev.model)}`
          + (ev.visionModel && ev.visionModel !== ev.model ? ` · 视觉 ${esc(ev.visionModel)}` : ''));
        break;

      case 'start':
        status('识别中…');
        log(`页 ${ev.pages} / 字幕 ${ev.subtitles}`);
        /* 真实页段重建页带 —— 不然页带永远是骨架那一格 */
        break;
case 'parsed':
        status('解析完成');
        log(`解析：${ev.counts.blocks} 块（${ev.counts.main} 主线 / ${ev.counts.side} 支线）/ ${ev.counts.knowledgePoints} 知识点`, 'ok');
        if (ev.failures?.length) log(`失败页 ${ev.failures.length} 个：${esc(ev.failures.map((f) => `P${f.page} ${f.code}`).join('、'))}`, 'err');
        break;

      case 'tree':
        log(`树：${ev.knowledgePoints.length} 个知识点`);
        break;

      case 'tail':
        log(`无课件段 ${ev.sentences} 句 → ${ev.blocks} 块`, 'ok');
        break;

      case 'treeBuilt':
        outcome.warnings.push(...(ev.warnings ?? []));
        log(`树建成：${ev.chapters} 章 / ${ev.topics} 知识点`, 'ok');
        if (ev.warnings?.length) log(`建树告警 ${ev.warnings.length} 条：${ev.warnings.slice(0, 2).map(esc).join(' / ')}`, 'warn');
        break;

      case 'lecture':
        outcome.lectureFailures = ev.failures?.length ?? 0;
        outcome.warnings.push(...(ev.warnings ?? []));
        log(`讲义：${ev.chapters} 章 / ${ev.topics} 知识点`, outcome.lectureFailures ? 'warn' : 'ok');
        if (outcome.lectureFailures) {
          log(`讲义有 ${outcome.lectureFailures} 卷失败：${esc((ev.failures ?? []).slice(0, 2).map((f) => f.reason ?? f.title ?? f).join(' / '))}`, 'err');
        }
        break;

      case 'polish':
        if (ev.ok) {
          outcome.polishUnchanged = Boolean(ev.unchanged);
          for (const warning of ev.warnings ?? []) log(`终审待复核：${esc(warning)}`, 'warn');
          /* "一字未改"不是功劳，是**需要看一眼**的结果：润色本该规整文本。
           * 所以标成 warn 而不是 ok，避免绿色掩盖可疑。 */
          log(`润色：${ev.unchanged ? '一字未改（跑过但没改，需确认是否正常）' : `${(ev.changes ?? []).length} 处改动`}`,
            ev.unchanged ? 'warn' : 'ok');
        } else {
          outcome.polishFailed = { code: ev.code, message: ev.message };
          /* ★ 失败必须带**具体原因**。产品侧有 14 种拒绝理由（课节标识改变 /
           *   原稿 ref 缺失 / 有原稿来源块未覆盖…），只报一个 code 等于没说。 */
          log(`润色失败【${esc(ev.code)}】：${esc(ev.message || '（没有给出原因）')}`, 'err');
        }
        break;

      case 'log':
        /* 服务端已把这次运行的日志落盘 —— 记住 id，跑完给"查看演示"入口。 */
        lastLogId = ev.id;
        log(`日志：${esc(ev.id)}`, 'ok');
        break;

      case 'done': {
        /* `done` = **跑完了**，不等于**成功**。据此分三档上色。 */
        const bad = verdict();
        const seconds = (ev.ms / 1000).toFixed(1);
        if (!bad.length) {
          status(`完成 · ${seconds}s`, 'ok');
          log(`完成，总耗时 ${seconds}s`, 'ok');
        } else {
          status(`跑完但有缺陷 · ${seconds}s`, 'warn');
          log(`跑完，但：${bad.join('；')}`, 'err');
          if (outcome.warnings.length) {
            log(`另有 ${outcome.warnings.length} 条告警：${outcome.warnings.slice(0, 3).map(esc).join(' / ')}`, 'warn');
          }
        }
        showDemoLink();
        break;
      }

      case 'error':
        status('失败', 'err');
        log(`${esc(ev.code)}：${esc(ev.message)}`, 'err');
        /* ★ **失败也要能进回放**（审查第 29 条）。
         *
         * 早先回放入口只在 `done` 时出现 —— 而失败恰恰是最需要回看
         * "到底哪一步崩了"的时候。日志已经落盘（含 error 元信息），
         * 所以这里同样给出入口。
         */
        showDemoLink();
        break;

      default:
        break;
    }
  }

  /* ── 历史运行：对比参数与结论 ──────────────────────────────────
   *
   * 审查第 31 条：没有稳定的运行身份、没有前后比较 ——
   * 你得自己记住"这次到底改了什么、现在看的又是哪一次"。
   * 这里列出历史运行的关键参数，当前这次高亮，点一行可进回放。
   */
  async function showHistory() {
    const box = $('historyPanel');
    if (!box) return;
    if (!box.hidden) { box.hidden = true; return; }

    box.hidden = false;
    box.innerHTML = '<h4>历史运行</h4><div class="hint">加载中…</div>';
    try {
      const data = await (await fetch('/api/logs')).json();
      const runs = data.runs ?? [];
      if (!runs.length) { box.innerHTML = '<h4>历史运行</h4><div class="hint">还没有记录</div>'; return; }

      const rows = runs.slice(0, 30).map((r) => {
        const c = r.config ?? {};
        const cur = r.id === lastLogId ? ' class="cur"' : '';
        const when = (r.startedAt ?? '').replace('T', ' ').slice(5, 19);
        return `<tr${cur}>
          <td>${esc(when)}</td>
          <td>${esc(String(r.section ?? '').slice(0, 12))}</td>
          <td>${Number.isFinite(c.splitLine) ? c.splitLine : '—'}</td>
          <td>${esc(c.model ?? '—')}</td>
          <td>${r.events ?? 0}</td>
          <td>${r.ms != null ? (r.ms / 1000).toFixed(1) + 's' : '—'}</td>
          <td><a class="rlink" data-id="${esc(r.id)}" href="/demo?id=${encodeURIComponent(r.id)}" target="_blank" rel="noopener">回放</a></td>
        </tr>`;
      }).join('');

      box.innerHTML = `<h4>历史运行 <span class="dim">（当前这次高亮）</span></h4>
        <table><thead><tr>
          <th>时间</th><th>节次</th><th>斩杀线</th><th>模型</th><th>事件</th><th>耗时</th><th></th>
        </tr></thead><tbody>${rows}</tbody></table>
        <div class="hint" style="margin-top:6px">对比斩杀线与模型，就能看出"这次改了什么"。</div>`;
    } catch (error) {
      box.innerHTML = `<h4>历史运行</h4><div class="bad">读取失败：${esc(error.message)}</div>`;
    }
  }

  /* ── 绑定 ────────────────────────────────────────────────────── */
  $('run')?.addEventListener('click', run);
  $('historyBtn')?.addEventListener('click', showHistory);
  $('reset')?.addEventListener('click', () => {
        queue.length = 0;
    status('已重置');
    log('动画已重放（真实数据保留）');
  });
  $('apiKey')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });

  /* 数据集：先试注入值，没有就拉一次 */
  if (DATASETS.length) {
    fillDatasets(DATASETS);
  } else {
    fetch('/api/datasets')
      .then((r) => r.json())
      .then((data) => fillDatasets(data.sections ?? []))
      .catch(() => log('拉数据集失败', 'err'));
  }
})();
