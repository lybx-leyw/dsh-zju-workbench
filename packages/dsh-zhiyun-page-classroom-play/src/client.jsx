// 「课堂播放」页：顶部场景进度条 + 舞台 + 底部控制条（上一场 / 下一场 / 朗读 / 全屏）。
//
// 边界（docs/architecture/classroom-port.md §2 通道 4）：**只换壳，不重写渲染树**。
// slide 整块交给 `dsh-zhiyun-core-classroom-stage` 的 <ClassroomStage>（它内部再调
// renderer 的 <ClassroomSlide>）；quiz / interactive / pbl 在上游是独立组件，这里只给
// 可用的最小呈现 —— 出题与对错、`srcdoc` 互动页、briefing 与交付物清单。
//
// 静态渲染安全：本文件没有任何模块级浏览器 API。全屏与朗读只在事件/副作用里碰
// `document` / `speechSynthesis`，所以 `renderToStaticMarkup` 下与 Node 测试里都能渲染。
import React, { useEffect, useRef, useState } from 'react';
import { mountStyle } from 'dsh-zhiyun-shell-ui';
import { ClassroomStage } from 'dsh-zhiyun-core-classroom-stage';
import { ClassroomSlide } from 'dsh-zhiyun-classroom-renderer';
import { SLOT_NAME, SLOT_PRIORITY } from './index.js';
import css from './style.css';

// 插件面：与 page-today 同形状 —— 声明 slots，惰性取课堂服务。
export const name = 'zhiyun-page-classroom-play-client';
export const inject = ['slots'];
export function apply(ctx) {
  mountStyle(ctx, {
    attribute: 'zhiyunClassroomPlayStyle',
    css,
    label: 'zhiyun: classroom play page styles',
  });
  // 惰性取课堂服务：领域包停用时这一页不注册，外壳显示占位，不会把整个前端拖成 pending。
  ctx.inject(['zhiyunClassroomStudio'], (scope) => {
    scope.slots.inject(SLOT_NAME, () => scope.slots.register(
      { name: SLOT_NAME, priority: SLOT_PRIORITY },
      (props = {}) => <ClassroomPlay studio={scope.zhiyunClassroomStudio} {...props} />,
    ));
  });
}

/** 四类场景（规范 §1 判据）。 */
export const PLAY_SCENE_TYPES = Object.freeze(['slide', 'quiz', 'interactive', 'pbl']);

const TYPE_LABEL = { slide: '讲解', quiz: '随堂测', interactive: '互动', pbl: '项目' };
const LAYOUT_WIDTH = 880;

/** 只认字符串，避免把 `null`/对象画成 "[object Object]"。 */
function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * 场景类型。上游有两种写法：`scene.type`（大纲）与 `scene.content.type`（清单），
 * 两者都在时以场景自己的为准。
 *
 * @param {object|null} scene
 * @returns {'slide'|'quiz'|'interactive'|'pbl'|'unknown'}
 */
export function sceneTypeOf(scene) {
  const content = scene?.content ?? null;
  const raw = scene?.type ?? content?.type;
  if (PLAY_SCENE_TYPES.includes(raw)) return raw;
  // 没有显式 type、但有画布的场景按 slide 处理（上游导出里 canvas 就是 slide）。
  if (content?.canvas) return 'slide';
  return 'unknown';
}

/** `quiz` 场景的题目集合：`{type:'quiz', questions:[…]}`，也吃"把一道题写在 content 上"。 */
export function questionsOf(content) {
  if (Array.isArray(content?.questions)) return content.questions.filter(Boolean);
  if (content && (content.stem || content.prompt || content.question || content.options)) return [content];
  return [];
}

/**
 * 选项正规化。上游既可能是字符串数组，也可能是 `{id, text, correct}`。
 *
 * @param {object} question
 * @returns {{id: string, text: string, correct: boolean}[]}
 */
export function optionsOf(question) {
  const raw = question?.options ?? question?.choices ?? [];
  return (Array.isArray(raw) ? raw : []).map((option, index) => {
    if (typeof option === 'string') return { id: `opt-${index}`, text: option, correct: false };
    return {
      id: String(option?.id ?? `opt-${index}`),
      text: textOf(option?.text) || textOf(option?.label) || textOf(option?.content),
      correct: option?.correct === true,
    };
  });
}

/**
 * 正确项下标。先看选项上的 `correct`，再看题目上的 `answerIndex` / `answer`
 * （数字下标，或选项 id / 选项原文）。都没有时返回 -1 —— 不猜，也不把第一项当答案。
 *
 * @param {object} question
 * @param {{id: string, text: string, correct: boolean}[]} [options]
 * @returns {number}
 */
export function correctIndexOf(question, options = optionsOf(question)) {
  const marked = options.findIndex((option) => option.correct);
  if (marked >= 0) return marked;
  const raw = question?.answerIndex ?? question?.correctIndex ?? question?.answer ?? question?.correct;
  if (Number.isInteger(raw)) return raw >= 0 && raw < options.length ? raw : -1;
  const answer = textOf(raw);
  if (!answer) return -1;
  const byId = options.findIndex((option) => option.id === answer);
  if (byId >= 0) return byId;
  return options.findIndex((option) => option.text === answer);
}

/** 题面。 */
function stemOf(question) {
  return textOf(question?.stem) || textOf(question?.prompt) || textOf(question?.question) || '（这一题没有题面）';
}

/** 交给舞台的账本：`scene.ledger(.records)` 或上游的 `scene.actions`。 */
function ledgerOf(scene) {
  if (Array.isArray(scene?.ledger)) return scene.ledger;
  if (Array.isArray(scene?.ledger?.records)) return scene.ledger.records;
  if (Array.isArray(scene?.actions)) return scene.actions;
  return [];
}

/** 朗读读什么：优先旁白（`speech` 动作），没有旁白就读标题与描述。 */
function speechTextOf(scene) {
  const spoken = ledgerOf(scene)
    .map((record) => (record?.type === 'speech' ? textOf(record.text) : ''))
    .filter(Boolean);
  if (spoken.length > 0) return spoken.join('。');
  return [textOf(scene?.title), textOf(scene?.description)].filter(Boolean).join('。');
}

/** PBL 交付物：`content.deliverables` / `briefing.deliverables`，字符串或 `{title}` 都吃。 */
function deliverablesOf(content) {
  const briefing = content?.briefing;
  const raw = Array.isArray(content?.deliverables)
    ? content.deliverables
    : Array.isArray(briefing?.deliverables)
      ? briefing.deliverables
      : [];
  return raw.filter(Boolean).map((item, index) => {
    if (typeof item === 'string') return { id: `deliverable-${index}`, title: item, done: false };
    return {
      id: String(item?.id ?? `deliverable-${index}`),
      title: textOf(item?.title) || textOf(item?.name) || `交付物 ${index + 1}`,
      done: item?.done === true || item?.completed === true,
    };
  });
}

/** 一道题：题面 + 选项 + 对错反馈。状态在本组件里，换场景时随 key 重建。 */
function QuizCard({ question, position }) {
  const [picked, setPicked] = useState(null);
  const options = optionsOf(question);
  const correct = correctIndexOf(question, options);
  const answered = picked !== null;
  const right = answered && picked === correct;
  const explanation = textOf(question?.explanation) || textOf(question?.explain);

  return <article className="zyc-play-quiz-card">
    <p className="zyc-play-quiz-stem">
      {position ? <span className="zyc-play-quiz-index">{position}</span> : null}
      {stemOf(question)}
    </p>
    {options.length > 0 ? <ul className="zyc-play-options">
      {options.map((option, index) => {
        const state = !answered
          ? 'idle'
          : index === correct
            ? 'correct'
            : index === picked
              ? 'wrong'
              : 'idle';
        return <li key={option.id}>
          <button
            type="button"
            className="zyc-play-option"
            data-state={state}
            onClick={() => setPicked(index)}
            disabled={answered}
          >
            <span className="zyc-play-option-mark">{String.fromCharCode(65 + index)}</span>
            <span className="zyc-play-option-text">{option.text}</span>
          </button>
        </li>;
      })}
    </ul> : <p className="zyc-play-note">这一题还没有选项。</p>}
    <div
      className="zyc-play-feedback"
      data-answered={answered ? 'true' : 'false'}
      data-correct={answered ? String(right) : 'unknown'}
      role="status"
    >
      {!answered ? '选一个答案，再看对错。' : right ? '答对了。' : '再看一眼题面。'}
      {answered && explanation ? <span className="zyc-play-explain">{explanation}</span> : null}
    </div>
  </article>;
}

function QuizScene({ scene }) {
  const questions = questionsOf(scene?.content);
  if (questions.length === 0) {
    return <div className="zyc-play-quiz"><p className="zyc-play-note">这一场还没有题目。</p></div>;
  }
  return <div className="zyc-play-quiz">
    {questions.map((question, index) => (
      <QuizCard
        key={question?.id ?? `q-${index}`}
        question={question}
        position={questions.length > 1 ? index + 1 : 0}
      />
    ))}
  </div>;
}

function InteractiveScene({ scene }) {
  const content = scene?.content ?? {};
  const html = textOf(content.html) || textOf(content.srcdoc);
  const label = textOf(scene?.title) || '互动页面';
  if (!html) return <div className="zyc-play-interactive"><p className="zyc-play-note">这一场没有互动页面。</p></div>;
  return <div className="zyc-play-interactive">
    {/* srcdoc 走沙箱：互动页是生成内容，不给同源权限（allow-same-origin 与 allow-scripts 同开等于没有沙箱）。 */}
    <iframe
      className="zyc-play-frame"
      title={label}
      srcDoc={html}
      sandbox="allow-scripts allow-forms allow-popups"
      referrerPolicy="no-referrer"
      loading="lazy"
    />
  </div>;
}

function PblScene({ scene }) {
  const content = scene?.content ?? {};
  const briefing = content.briefing ?? content.brief ?? null;
  const title = textOf(briefing?.title) || textOf(scene?.title) || '项目';
  const text = typeof briefing === 'string'
    ? textOf(briefing)
    : textOf(briefing?.text) || textOf(briefing?.description) || textOf(content.briefingText) || textOf(content.description);
  const deliverables = deliverablesOf(content);

  return <div className="zyc-play-pbl">
    <section className="zyc-play-briefing">
      <span className="zyc-play-label">任务简报</span>
      <h3>{title}</h3>
      {text ? <p>{text}</p> : <p className="zyc-play-note">这一场还没有简报。</p>}
    </section>
    <section className="zyc-play-deliverables">
      <span className="zyc-play-label">交付物</span>
      {deliverables.length > 0 ? <ul className="zyc-play-deliverable-list">
        {deliverables.map((item) => <li className="zyc-play-deliverable" key={item.id}>
          <label>
            <input type="checkbox" defaultChecked={item.done} />
            <span>{item.title}</span>
          </label>
        </li>)}
      </ul> : <p className="zyc-play-note">还没有列出交付物。</p>}
    </section>
  </div>;
}

/** 当前场景的呈现：四类各一条路径，未知类型只说明、不猜。 */
function SceneBody({ scene, width }) {
  const type = sceneTypeOf(scene);
  if (type === 'slide') {
    return <div className="zyc-play-scene zyc-play-scene--slide" data-scene={scene?.id ?? ''}>
      <div className="zyc-play-canvas">
        {/* 画 slide 的是渲染层：这里把 `<ClassroomSlide>` 显式交给舞台，
            而不是让舞台去猜用哪个渲染器。 */}
        <ClassroomStage
          scenes={[scene]}
          ledger={ledgerOf(scene)}
          renderer={ClassroomSlide}
          autoplay={false}
          width={width}
        />
      </div>
    </div>;
  }
  if (type === 'quiz') {
    return <div className="zyc-play-scene zyc-play-scene--quiz" data-scene={scene?.id ?? ''}><QuizScene scene={scene} /></div>;
  }
  if (type === 'interactive') {
    return <div className="zyc-play-scene zyc-play-scene--interactive" data-scene={scene?.id ?? ''}><InteractiveScene scene={scene} /></div>;
  }
  if (type === 'pbl') {
    return <div className="zyc-play-scene zyc-play-scene--pbl" data-scene={scene?.id ?? ''}><PblScene scene={scene} /></div>;
  }
  return <div className="zyc-play-scene zyc-play-scene--unknown">
    <div className="zyc-play-placeholder"><strong>这一场的类型还不认识</strong><p>{textOf(scene?.type) || '（没有写 type）'}</p></div>
  </div>;
}

function Placeholder({ title, text, extraClass = '' }) {
  return <div className={`zyc-play-placeholder ${extraClass}`.trim()}>
    <strong>{title}</strong>
    {text ? <p>{text}</p> : null}
  </div>;
}

/**
 * 播放页本体。
 *
 * @param {object} props
 * @param {object} [props.studio] `ctx.zhiyunClassroomStudio`
 * @param {object} [props.doc] 直接给一份 `{ scenes, meta, assets }`（编辑器预览/测试）
 * @param {string} [props.classroomId] 没给 `doc` 时按 id 去 `studio.classroom.load` 取
 * @param {number} [props.width] 舞台宽（px）
 * @param {number} [props.initialScene] 起始场景下标（回放定位）
 * @returns {React.ReactElement}
 */
export function ClassroomPlay({
  studio,
  doc: initialDoc = null,
  classroomId,
  width = LAYOUT_WIDTH,
  initialScene = 0,
}) {
  const rootRef = useRef(null);
  const [doc, setDoc] = useState(initialDoc);
  const [status, setStatus] = useState(initialDoc ? 'ready' : classroomId ? 'loading' : 'idle');
  const [error, setError] = useState(null);
  const [index, setIndex] = useState(() => Math.max(0, Number(initialScene) || 0));
  const [speaking, setSpeaking] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const scenes = Array.isArray(doc?.scenes) ? doc.scenes.filter(Boolean) : [];
  // 换课堂时 `index` 可能还没被下面的 effect 夹住，渲染这一层再夹一次，
  // 免得首帧出现"有场景但舞台上什么都没有"。
  const safeIndex = scenes.length > 0 ? Math.min(Math.max(index, 0), scenes.length - 1) : 0;
  const current = scenes[safeIndex] ?? null;
  const type = current ? sceneTypeOf(current) : null;
  const heading = textOf(doc?.meta?.title) || textOf(doc?.meta?.name) || textOf(doc?.title);

  // 读这一节课。给了 doc 就不去宿主取（编辑器预览与测试走这条）。
  useEffect(() => {
    if (initialDoc) {
      setDoc(initialDoc);
      setStatus('ready');
      setError(null);
      return undefined;
    }
    if (!classroomId) {
      // 没有指名道姓时：取「最近生成的那节课」。
      //
      // 为什么不发明跨页参数：生成页与播放页是两个插件，靠 URL/全局变量传
      // `stageId` 会在刷新后失效、也会让「直接打开课堂页」变成一个空页。
      // 列表按 `vault.classroom.list()` 的顺序（新的在前）取第一条，刷新后同样能用。
      const list = studio?.stages?.list;
      const load = studio?.classroom?.load;
      if (typeof list !== 'function' || typeof load !== 'function') {
        setStatus('idle');
        return undefined;
      }
      let live = true;
      setStatus('loading');
      setError(null);
      Promise.resolve()
        .then(() => list.call(studio.stages))
        .then((response) => {
          const body = response && typeof response === 'object' && 'httpStatus' in response
            ? response.body
            : response;
          const rows = Array.isArray(body?.stages) ? body.stages
            : Array.isArray(body) ? body : [];
          const latest = rows[0];
          const id = latest?.id ?? latest?.stageId ?? latest?.stage;
          if (!id) return null;
          return load.call(studio.classroom, id);
        })
        .then((next) => {
          if (!live) return;
          if (!next) {
            setStatus('idle');
            return;
          }
          setDoc(next);
          setStatus('ready');
        })
        .catch((reason) => {
          if (!live) return;
          setError(reason?.message ?? String(reason));
          setStatus('error');
        });
      return () => { live = false; };
    }
    const load = studio?.classroom?.load;
    if (typeof load !== 'function') {
      setStatus('unavailable');
      return undefined;
    }
    let live = true;
    setStatus('loading');
    setError(null);
    Promise.resolve()
      .then(() => load.call(studio.classroom, classroomId))
      .then((next) => {
        if (!live) return;
        setDoc(next ?? null);
        setStatus('ready');
      })
      .catch((reason) => {
        if (!live) return;
        setError(reason?.message ?? String(reason));
        setStatus('error');
      });
    return () => { live = false; };
  }, [initialDoc, classroomId, studio]);

  // 场景变少（换了课堂）时游标不能越界。
  useEffect(() => {
    setIndex((value) => (value < scenes.length ? value : Math.max(0, scenes.length - 1)));
  }, [scenes.length]);

  // 朗读：只在开了开关时说话；浏览器没有语音合成就自己关掉，不留一个按不动的开。
  useEffect(() => {
    if (!speaking) return undefined;
    const synth = globalThis.speechSynthesis;
    const Utterance = globalThis.SpeechSynthesisUtterance;
    const text = current ? speechTextOf(current) : '';
    if (!synth || typeof Utterance !== 'function' || !text) {
      setSpeaking(false);
      return undefined;
    }
    const utterance = new Utterance(text);
    utterance.onend = () => setSpeaking(false);
    synth.cancel();
    synth.speak(utterance);
    return () => { synth.cancel(); };
  }, [speaking, current]);

  // 全屏状态以 document 为准（用户按 Esc 退出时按钮要跟着灭）。
  useEffect(() => {
    const target = globalThis.document;
    if (!target?.addEventListener) return undefined;
    const onChange = () => setFullscreen(Boolean(target.fullscreenElement));
    target.addEventListener('fullscreenchange', onChange);
    return () => target.removeEventListener('fullscreenchange', onChange);
  }, []);

  const go = (delta) => setIndex((value) => Math.min(Math.max(value + delta, 0), Math.max(0, scenes.length - 1)));

  const toggleFullscreen = () => {
    const node = rootRef.current;
    const target = globalThis.document;
    if (!node || !target) return;
    if (target.fullscreenElement) {
      void target.exitFullscreen?.();
      return;
    }
    if (typeof node.requestFullscreen !== 'function') return;
    Promise.resolve(node.requestFullscreen()).catch(() => { /* 用户手势之外被拒绝时不动声色 */ });
  };

  return <section
    className="zyc-play"
    ref={rootRef}
    data-scene-type={type ?? 'empty'}
    data-fullscreen={fullscreen ? 'true' : 'false'}
  >
    <header className="zyc-play-head">
      <div className="zyc-play-heading">
        <span className="zyc-play-eyebrow">{heading || '课堂播放'}</span>
        <h2 className="zyc-play-title">{textOf(current?.title) || heading || '课堂播放'}</h2>
        <p className="zyc-play-meta">
          {scenes.length > 0 ? `${safeIndex + 1} / ${scenes.length} · ${TYPE_LABEL[type] ?? '场景'}` : '没有可播放的场景'}
        </p>
      </div>
      <ol className="zyc-play-progress" aria-label="场景进度">
        {scenes.map((scene, position) => {
          const itemType = sceneTypeOf(scene);
          const active = position === safeIndex;
          return <li className="zyc-play-progress-item" key={scene.id ?? `scene-${position}`}>
            <button
              type="button"
              className="zyc-play-progress-seg"
              data-type={itemType}
              data-active={active ? 'true' : 'false'}
              aria-current={active ? 'step' : undefined}
              aria-label={`第 ${position + 1} 场：${textOf(scene.title) || TYPE_LABEL[itemType] || '场景'}`}
              title={`${position + 1}. ${textOf(scene.title) || TYPE_LABEL[itemType] || '场景'}`}
              onClick={() => setIndex(position)}
            >
              <span className="zyc-play-progress-fill" />
            </button>
          </li>;
        })}
      </ol>
    </header>

    <div className="zyc-play-body">
      {status === 'loading' ? <Placeholder title="正在读取这一节课" text="场景还没有拿到。" /> : null}
      {status === 'error' ? <Placeholder title="这一节课没有读出来" text={error ?? '宿主没有给出原因。'} /> : null}
      {status === 'unavailable' ? <Placeholder title="课堂服务没有启动" text="启用课堂领域包之后，这里会显示场景。" /> : null}
      {status === 'idle' ? <Placeholder title="还没有选中一节课" text="从课堂列表打开一节，或者传入 classroomId。" /> : null}
      {status === 'ready' && scenes.length === 0
        ? <Placeholder extraClass="zyc-play-empty" title="这一节课还没有场景" text="生成之后，slide / quiz / interactive / pbl 会按顺序出现在这里。" />
        : null}
      {status === 'ready' && current ? <SceneBody scene={current} width={width} /> : null}
    </div>

    <footer className="zyc-play-bar">
      <div className="zyc-play-bar-group">
        <button type="button" className="zyc-play-button" onClick={() => go(-1)} disabled={safeIndex <= 0}>上一场</button>
        <button type="button" className="zyc-play-button" onClick={() => go(1)} disabled={safeIndex >= scenes.length - 1}>下一场</button>
      </div>
      <div className="zyc-play-bar-group">
        <button
          type="button"
          className="zyc-play-button"
          aria-pressed={speaking}
          data-active={speaking ? 'true' : 'false'}
          onClick={() => setSpeaking((value) => !value)}
          disabled={!current}
        >
          {speaking ? '停止朗读' : '朗读'}
        </button>
        <button type="button" className="zyc-play-button" aria-pressed={fullscreen} onClick={toggleFullscreen}>全屏</button>
      </div>
    </footer>
  </section>;
}

export default ClassroomPlay;
