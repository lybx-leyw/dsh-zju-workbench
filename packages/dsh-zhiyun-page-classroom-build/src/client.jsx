/**
 * 「课堂生成」页：brief → 可编辑大纲 → 流式生成，三步一条线。
 *
 *   ① 说清楚要生成什么（主题 / 受众 / 深度，可选带一份 PDF）
 *   ② 大纲先给人看、给人改（增删场景、改类型、拖序）
 *   ③ 按下生成后，场景一个个出现；随时能取消，失败能重试
 *
 * # 为什么大纲必须可编辑
 *
 * 生成一次课堂要跑几十秒到几分钟。原版把大纲藏进提示词里，用户只能等结果出来再
 * 返工；这里把「要生成哪几节、每节是什么类型」先摊开 —— 改一行比重新生成便宜得多。
 *
 * # 状态在哪
 *
 * 第三步的事件流状态（`{ phase, scenes, done, error }`）与第二步的大纲编辑全部走
 * `src/progress.js` 的纯函数。本文件只做三件事：收集输入、调 `studio.generate`、
 * 把事件喂给 `reduce`。这样事件流的乱序/取消/失败可以在裸 Node 里测，不用起浏览器。
 *
 * # 服务从哪来
 *
 * 不写进 `inject`：课堂宿主包（`dsh-zhiyun-host-classroom`）没搬完时，写进 inject
 * 会让整页一直 pending。这里在渲染时惰性取 `ctx.zhiyunClassroomStudio`，取不到就
 * 显示「课堂服务未就绪」，页面本身仍然站得住。
 */
import React, { useEffect, useRef, useState } from 'react';
import { mountStyle } from 'dsh-zhiyun-shell-ui';
import { registerSlot } from './index.js';
import {
  ATTACHMENT_STATUS,
  DEFAULT_BRIEF,
  DEPTH_OPTIONS,
  PHASE,
  SCENE_STATUS,
  SCENE_TYPES,
  SCENE_TYPE_LABELS,
  addOutlineScene,
  briefReady,
  createOutline,
  initialState,
  moveOutlineScene,
  normalizeBrief,
  normalizeOutline,
  outlineReady,
  reduce,
  removeOutlineScene,
  summarize,
  toGeneratePayload,
  updateOutlineScene,
} from './progress.js';
import css from './style.css';

export const name = 'zhiyun-page-classroom-build-client';

/** 页面只画界面；课堂服务惰性取，不把整页拖成 pending。 */
export const inject = ['slots'];

export function apply(ctx) {
  mountStyle(ctx, {
    attribute: 'zhiyunClassroomBuildStyle',
    css,
    label: 'zhiyun: classroom build styles',
  });
  registerSlot(ctx, () => <ClassroomBuild ctx={ctx} />);
}

const STEPS = Object.freeze([
  { id: 'brief', label: '描述课堂', hint: '主题、受众与深度' },
  { id: 'outline', label: '编辑大纲', hint: '先定场景，再生成' },
  { id: 'generate', label: '生成', hint: '逐场景产出' },
]);

const STATUS_LABELS = Object.freeze({
  pending: '排队中',
  running: '生成中',
  done: '已完成',
  failed: '失败',
  cancelled: '已取消',
});

const PHASE_LABELS = Object.freeze({
  idle: '尚未开始',
  running: '正在生成',
  done: '生成完成',
  failed: '生成失败',
  cancelled: '已取消',
});

/** 取课堂服务。没有注入时 `ctx.get` 可能抛，一律降级成 null。 */
function serviceOf(ctx) {
  try {
    return ctx?.get?.('zhiyunClassroomStudio') ?? null;
  } catch {
    return null;
  }
}

/**
 * 取导航服务（外壳 `zhiyun-page-classroom-build` 无自己的路由，切页归外壳）。
 *
 * 拿不到就返回 null：这一页在没有外壳的静态渲染下也要能画出来，
 * 只是「去播放」按钮不出现 —— 比点了没反应诚实。
 */
function navigationOf(ctx) {
  try {
    return ctx?.get?.('zhiyunNavigation') ?? null;
  } catch {
    return null;
  }
}

function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 附件状态的短标签（卡在「上传中」时用户知道该等，不必猜是不是没生效）。 */
const ATTACHMENT_LABEL = {
  [ATTACHMENT_STATUS.uploading]: '上传中…',
  [ATTACHMENT_STATUS.ready]: '已就绪',
  [ATTACHMENT_STATUS.failed]: '上传失败',
};

export function ClassroomBuild({ ctx = null, studio = null }) {
  const [step, setStep] = useState('brief');
  const [brief, setBrief] = useState(DEFAULT_BRIEF);
  const [outline, setOutline] = useState([]);
  const service = studio ?? serviceOf(ctx);
  const nav = navigationOf(ctx);

  const stepIndex = STEPS.findIndex((item) => item.id === step);

  /** 生成完直接去播放页：播放页不给 id 时取最新一条课堂，就是刚生成的这条。 */
  const goPlay = () => {
    try {
      nav?.navigate('classroom');
    } catch {
      // 外壳不在或页面表里没有 classroom：按钮本来就不会渲染，这里兜一层。
    }
  };

  return (
    <div className="zyc-build">
      <header className="zyc-build-head">
        <div>
          <h1 className="zyc-build-title">生成课堂</h1>
          <p className="zyc-build-subtitle">
            先把要讲的东西说清楚，看一眼大纲，再让场景一节一节长出来。
          </p>
        </div>
        <ol className="zyc-build-steps" aria-label="生成步骤">
          {STEPS.map((item, index) => {
            const status = index < stepIndex ? 'done' : index === stepIndex ? 'current' : 'todo';
            return (
              <li
                key={item.id}
                className={`zyc-build-step zyc-build-step-${status}`}
                aria-current={status === 'current' ? 'step' : undefined}
              >
                <span className="zyc-build-step-index" aria-hidden="true">{index + 1}</span>
                <span className="zyc-build-step-text">
                  <strong>{item.label}</strong>
                  <small>{item.hint}</small>
                </span>
              </li>
            );
          })}
        </ol>
      </header>

      {step === 'brief' && (
        <BriefStep
          value={brief}
          studio={service}
          onChange={setBrief}
          onNext={(next) => {
            setBrief(next);
            setOutline(createOutline(next));
            setStep('outline');
          }}
        />
      )}

      {step === 'outline' && (
        <OutlineStep
          scenes={outline}
          onChange={setOutline}
          onBack={() => setStep('brief')}
          onNext={() => setStep('generate')}
        />
      )}

      {step === 'generate' && (
        <GenerateStep
          studio={service}
          brief={brief}
          outline={outline}
          onPlay={nav ? goPlay : null}
          onBack={() => setStep('outline')}
        />
      )}
    </div>
  );
}

/**
 * 第一步：brief。
 *
 * 也允许独立渲染（`onChange` 缺省时自带一份草稿），这样静态渲染测试能只测这一步。
 */
export function BriefStep({ value, onChange, onNext, studio = null }) {
  const [draft, setDraft] = useState(() => value ?? DEFAULT_BRIEF);
  const brief = value ?? draft;
  const ready = briefReady(brief);

  // 不在这里 trim：受控输入每敲一个空格就被改写会把光标顶回去。
  // 正规化留到「下一步」与真正调 generate 的时候。
  const update = (patch) => {
    const next = { ...brief, ...patch };
    if (value === undefined) setDraft(next);
    onChange?.(next);
  };

  /**
   * 选好文件就立刻上传，拿到 `materialId` 才算「参考资料」这一项完成。
   *
   * 为什么不在按「生成」时再传：上传是唯一会因大小/格式/配额失败的一步，
   * 放在这里失败能马上说清楚，而不是等大纲都改完了才在最后一步报错。
   */
  async function attach(file) {
    const base = {
      name: file.name,
      size: file.size,
      type: file.type || 'application/pdf',
      materialId: null,
      status: ATTACHMENT_STATUS.uploading,
      error: null,
    };
    update({ attachment: base });

    try {
      if (!studio || typeof studio.materials?.create !== 'function') {
        throw new Error('课堂服务未就绪：没有 materials.create');
      }
      const buffer = new Uint8Array(await file.arrayBuffer());
      const response = await studio.materials.create({
        buffer,
        filename: file.name,
        mimeType: file.type || 'application/pdf',
        extract: true,
      });
      const body = response?.body ?? response;
      const materialId = body?.materialId;
      if (!materialId) {
        const message = body?.error?.message || body?.message
          || `上传被拒绝（HTTP ${response?.httpStatus ?? '?'}）`;
        throw new Error(message);
      }
      update({
        attachment: { ...base, materialId, status: ATTACHMENT_STATUS.ready },
      });
    } catch (error) {
      update({
        attachment: {
          ...base,
          status: ATTACHMENT_STATUS.failed,
          error: error?.message ?? String(error),
        },
      });
    }
  }

  return (
    <section className="zyc-build-panel zyc-build-brief" aria-labelledby="zyc-build-brief-title">
      <h2 className="zyc-build-panel-title" id="zyc-build-brief-title">这节课讲什么</h2>

      <label className="zyc-build-field" htmlFor="zyc-build-topic">
        <span className="zyc-build-label">主题 <em>必填</em></span>
        <input
          id="zyc-build-topic"
          className="zyc-build-input"
          type="text"
          value={brief.topic}
          placeholder="例：傅里叶变换的直观理解"
          autoComplete="off"
          onChange={(event) => update({ topic: event.target.value })}
        />
      </label>

      <label className="zyc-build-field" htmlFor="zyc-build-audience">
        <span className="zyc-build-label">受众</span>
        <input
          id="zyc-build-audience"
          className="zyc-build-input"
          type="text"
          value={brief.audience}
          placeholder="例：大二本科生，学过微积分"
          autoComplete="off"
          onChange={(event) => update({ audience: event.target.value })}
        />
      </label>

      <label className="zyc-build-field" htmlFor="zyc-build-depth">
        <span className="zyc-build-label">深度</span>
        <select
          id="zyc-build-depth"
          className="zyc-build-select"
          value={brief.depth}
          onChange={(event) => update({ depth: event.target.value })}
        >
          {DEPTH_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
      <p className="zyc-build-hint">
        {DEPTH_OPTIONS.find((option) => option.value === brief.depth)?.hint}
      </p>

      <div className="zyc-build-field">
        <span className="zyc-build-label">参考资料 <em>可选</em></span>
        {brief.attachment === null ? (
          <label className="zyc-build-upload">
            <input
              className="zyc-build-file"
              type="file"
              accept="application/pdf,.pdf"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) attach(file);
              }}
            />
            <span>选择一份 PDF</span>
          </label>
        ) : (
          <div className="zyc-build-attachment">
            <span className="zyc-build-attachment-name">{brief.attachment.name}</span>
            <span className="zyc-build-attachment-size">{formatSize(brief.attachment.size)}</span>
            <span className={`zyc-build-attachment-status zyc-build-attachment-${brief.attachment.status ?? 'ready'}`}>
              {ATTACHMENT_LABEL[brief.attachment.status ?? ATTACHMENT_STATUS.ready]}
            </span>
            <button
              type="button"
              className="zyc-build-link"
              onClick={() => update({ attachment: null })}
            >
              移除
            </button>
          </div>
        )}
        {brief.attachment?.status === ATTACHMENT_STATUS.failed && brief.attachment.error && (
          <p className="zyc-build-hint zyc-build-hint-warn">{brief.attachment.error}</p>
        )}
        {brief.attachment?.status === ATTACHMENT_STATUS.ready && (
          <p className="zyc-build-hint">这份讲义会作为备课依据：章节顺序与术语以它为准。</p>
        )}
      </div>

      <footer className="zyc-build-actions">
        <span className="zyc-build-hint">主题填好后就能往下走，大纲还可以再改。</span>
        <button
          type="button"
          className="zyc-build-primary"
          disabled={!ready}
          onClick={() => onNext?.(normalizeBrief(brief))}
        >
          下一步：看大纲
        </button>
      </footer>
    </section>
  );
}

/**
 * 第二步：大纲。
 *
 * 增删场景、改类型、拖序；拖不动的人用上下移按钮（键盘/读屏都可用）。
 * 与第一步一样可以独立渲染。
 */
export function OutlineStep({ scenes, onChange, onBack, onNext }) {
  const [draft, setDraft] = useState(() => (Array.isArray(scenes) ? scenes : []));
  const [dragIndex, setDragIndex] = useState(null);
  const list = Array.isArray(scenes) ? scenes : draft;
  const ready = outlineReady(list);

  const emit = (next) => {
    if (scenes === undefined) setDraft(next);
    onChange?.(next);
  };

  return (
    <section className="zyc-build-panel zyc-build-outline" aria-labelledby="zyc-build-outline-title">
      <div className="zyc-build-panel-head">
        <h2 className="zyc-build-panel-title" id="zyc-build-outline-title">场景大纲</h2>
        <span className="zyc-build-count">{list.length} 个场景</span>
      </div>
      <p className="zyc-build-hint">
        默认按「先讲、再练」排；拖动左侧把手调整顺序，点「+ 添加场景」补一节。
      </p>

      <ol className="zyc-build-outline-list">
        {list.map((scene, index) => (
          <li
            key={scene.id}
            className={`zyc-build-outline-row${dragIndex === index ? ' zyc-build-outline-row-dragging' : ''}`}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              if (dragIndex !== null) emit(moveOutlineScene(list, dragIndex, index));
              setDragIndex(null);
            }}
          >
            <span
              className="zyc-build-drag"
              aria-hidden="true"
              title="拖动排序"
              draggable
              onDragStart={() => setDragIndex(index)}
              onDragEnd={() => setDragIndex(null)}
            >
              ⋮⋮
            </span>
            <span className="zyc-build-outline-order" aria-hidden="true">{index + 1}</span>

            <input
              className="zyc-build-input zyc-build-outline-title"
              type="text"
              aria-label={`第 ${index + 1} 个场景的标题`}
              value={scene.title}
              onChange={(event) => emit(updateOutlineScene(list, scene.id, { title: event.target.value }))}
            />

            <select
              className="zyc-build-select zyc-build-outline-type"
              aria-label={`第 ${index + 1} 个场景的类型`}
              value={scene.type}
              onChange={(event) => emit(updateOutlineScene(list, scene.id, { type: event.target.value }))}
            >
              {SCENE_TYPES.map((type) => (
                <option key={type} value={type}>{SCENE_TYPE_LABELS[type]}</option>
              ))}
            </select>

            <span className="zyc-build-order">
              <button
                type="button"
                className="zyc-build-icon"
                aria-label={`上移第 ${index + 1} 个场景`}
                disabled={index === 0}
                onClick={() => emit(moveOutlineScene(list, index, index - 1))}
              >
                ↑
              </button>
              <button
                type="button"
                className="zyc-build-icon"
                aria-label={`下移第 ${index + 1} 个场景`}
                disabled={index === list.length - 1}
                onClick={() => emit(moveOutlineScene(list, index, index + 1))}
              >
                ↓
              </button>
              <button
                type="button"
                className="zyc-build-icon zyc-build-remove"
                aria-label={`删除第 ${index + 1} 个场景`}
                onClick={() => emit(removeOutlineScene(list, scene.id))}
              >
                ✕
              </button>
            </span>
          </li>
        ))}
      </ol>

      {list.length === 0 && (
        <p className="zyc-build-empty">还没有场景。加一节，或者返回上一步重新生成大纲。</p>
      )}

      <div className="zyc-build-outline-add">
        <button
          type="button"
          className="zyc-build-ghost"
          onClick={() => emit(addOutlineScene(list, 'slide'))}
        >
          + 添加场景
        </button>
        <button
          type="button"
          className="zyc-build-ghost"
          onClick={() => emit(addOutlineScene(list, 'quiz'))}
        >
          + 添加测验
        </button>
      </div>

      <footer className="zyc-build-actions">
        <button type="button" className="zyc-build-ghost" onClick={onBack}>返回修改 brief</button>
        <button
          type="button"
          className="zyc-build-primary"
          disabled={!ready}
          onClick={onNext}
        >
          开始生成
        </button>
      </footer>
    </section>
  );
}

/**
 * 第三步：进度。
 *
 * 挂载即开跑（没有服务时立刻落到失败态并说明原因）。取消同时做三件事：
 * 中止本地迭代、调 `runs.cancel`、把状态推到 cancelled —— 前两件都可能失败，
 * 第三件保证界面一定停住。
 */
export function GenerateStep({ studio = null, brief, outline, onPlay = null, onBack }) {
  const [run, setRun] = useState(() => initialState());
  const [runId, setRunId] = useState(null);
  const abortRef = useRef(null);
  const runIdRef = useRef(null);
  const startedRef = useRef(false);
  const mountedRef = useRef(true);

  const counts = summarize(run);

  async function start() {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    runIdRef.current = null;
    setRunId(null);
    setRun(initialState());

    let current = initialState();
    const push = (event) => {
      current = reduce(current, event);
      if (mountedRef.current) setRun(current);
    };

    if (!studio || typeof studio.generate !== 'function') {
      push({
        type: 'error',
        data: { message: '课堂服务未就绪：zhiyunClassroomStudio 没有提供 generate', code: 'NO_STUDIO' },
      });
      return;
    }

    const scenes = normalizeOutline(outline);
    // `requirement` 是后端的必填项（上游口径），主题只是页面上的说法；
    // 讲义以 `materialIds` 传，不塞正文。
    const payload = toGeneratePayload(brief, scenes);

    try {
      const result = await studio.generate(payload, { signal: controller.signal, scenes });
      if (result?.runId) {
        runIdRef.current = result.runId;
        if (mountedRef.current) setRunId(result.runId);
      }

      const events = result?.events ?? result;
      const iterable = events
        && (typeof events[Symbol.asyncIterator] === 'function'
          || typeof events[Symbol.iterator] === 'function');
      if (!iterable) {
        throw new Error('generate 没有返回 AsyncIterable<event>');
      }

      for await (const event of events) {
        push(event);
        if (controller.signal.aborted) break;
      }
      if (!current.done) push({ type: controller.signal.aborted ? 'cancelled' : 'done' });
    } catch (error) {
      if (controller.signal.aborted) push({ type: 'cancelled' });
      else push({ type: 'error', data: { message: error?.message ?? String(error) } });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  useEffect(() => {
    mountedRef.current = true;
    if (!startedRef.current) {
      startedRef.current = true;
      start();
    }
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
    // 只在挂载时开跑；重试走按钮，不靠 props 变化。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function cancel() {
    abortRef.current?.abort();
    const id = runIdRef.current;
    if (id && studio?.runs?.cancel) {
      try {
        await studio.runs.cancel(id);
      } catch {
        // 宿主还没搬完 cancel 是正常的；本地状态已经停了。
      }
    }
    setRun((previous) => reduce(previous, { type: 'cancelled' }));
  }

  const running = run.phase === PHASE.running;
  const failed = run.phase === PHASE.failed || run.phase === PHASE.cancelled;

  return (
    <section className="zyc-build-panel zyc-build-generate" aria-labelledby="zyc-build-generate-title">
      <div className="zyc-build-panel-head">
        <h2 className="zyc-build-panel-title" id="zyc-build-generate-title">
          {PHASE_LABELS[run.phase] ?? '生成'}
        </h2>
        <span className="zyc-build-count">
          {counts.done} / {counts.total} 个场景完成
          {counts.failed > 0 ? ` · ${counts.failed} 失败` : ''}
        </span>
      </div>

      {run.error && (
        <p className="zyc-build-error" role="alert">
          <strong>{run.error.message}</strong>
          <small>{run.error.code}</small>
        </p>
      )}

      {run.scenes.length > 0 ? (
        <ol className="zyc-build-scenes" aria-live="polite">
          {run.scenes.map((scene, index) => (
            <li
              key={scene.id}
              className={`zyc-build-scene zyc-build-scene-${scene.status}`}
              data-scene={scene.id}
            >
              <span className="zyc-build-scene-order" aria-hidden="true">{index + 1}</span>
              <span className="zyc-build-scene-title">{scene.title}</span>
              <span className={`zyc-build-badge zyc-build-badge-${scene.type}`}>
                {SCENE_TYPE_LABELS[scene.type] ?? scene.type}
              </span>
              <span className="zyc-build-scene-status" role="status">
                {STATUS_LABELS[scene.status] ?? scene.status}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="zyc-build-empty" aria-live="polite">
          {running ? '等待第一个场景…' : '还没有场景。'}
        </p>
      )}

      <footer className="zyc-build-actions">
        <button type="button" className="zyc-build-ghost" onClick={onBack}>返回大纲</button>
        <span className="zyc-build-actions-right">
          {runId && <span className="zyc-build-runid">run {runId}</span>}
          {running && (
            <button type="button" className="zyc-build-danger" onClick={cancel}>取消生成</button>
          )}
          {failed && (
            <button type="button" className="zyc-build-primary" onClick={start}>重试</button>
          )}
          {run.phase === PHASE.idle && (
            <button type="button" className="zyc-build-primary" onClick={start}>开始生成</button>
          )}
        </span>
      </footer>

      {run.phase === PHASE.done && run.scenes.some((scene) => scene.status === SCENE_STATUS.done) && (
        <div className="zyc-build-done">
          <p className="zyc-build-hint">
            场景已生成完{run.stageId ? `（课堂 ${run.stageId}）` : ''}。去「课堂播放」页就能开讲；
            回大纲加一节，或重开一条 run 再调整。
          </p>
          {onPlay && (
            <button type="button" className="zyc-build-primary" onClick={onPlay}>
              去播放这一课
            </button>
          )}
        </div>
      )}
    </section>
  );
}
