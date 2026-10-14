// 「反馈」页：一个嵌在工作台里的迷你社区（形态照 GitHub issue 来）。
//
//   发一条需求 → 谁都能在下面评论 → 状态推进 → 有动静的浮到最前
//
// 与 GitHub 唯一的差别是**没有账号**：署名是本机生成的随机笔名（`board.js` 的
// `localName`），可一键重置。这一页只跟一个地方说话 —— 收件服务（`FEEDBACK_ENDPOINT`），
// 地址公开、无需登录、不发任何身份字段。
//
// 刻意只 `inject: ['slots']`，不依赖任何领域服务：反馈入口是用户唯一能说「哪里坏了」
// 的地方，不能因为别的包停用、或某个服务没就绪而一起消失。收件服务连不上时页面显示成
// 空社区并**明确说明是连不上**，而不是装作"还没有人提过"。
import React, { useEffect, useState } from 'react';
import { Empty, Icon, Notice, SectionTitle, mountStyle } from 'dsh-zhiyun-ui-primitives';
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives';
import {
  ago, checkComment, checkIssue, LIMITS, loadIssues, localName, orderIssues,
  resetName, submitComment, submitIssue, summarize,
} from './board.js';
import css from './style.css';

export const name = 'zhiyun-page-feedback-client';

export const inject = ['slots'];

export function apply(ctx) {
  mountStyle(ctx, { attribute: 'zhiyunFeedbackStyle', css, label: 'zhiyun: feedback page styles' });
  ctx.slots.inject('zhiyun.feedback.content', () => ctx.slots.register(
    { name: 'zhiyun.feedback.content' },
    Feedback,
  ));
}

/** 状态标签。 */
function StateTag({ status }) {
  const label = status === 'done' ? '已实现' : status === 'open' ? '推进中' : '本期不采纳';
  return <span className={`zfb-tag zfb-tag-${status}`}>{label}</span>;
}

/**
 * 宿主 Markdown 渲染器的文案。
 *
 * 必须是**模块级常量**：`MarkdownText` 按 `labels` 的**身份**缓存组件表，每次渲染
 * 新建一个字面量会让它反复重建。`dsh-zhiyun-page-paper/src/AssistantDrawer.jsx`
 * 与 `dsh-zhiyun-page-study/src/lecture-reader.jsx` 也是这么写的。
 */
const MARKDOWN_LABELS = { code: { copyLabel: '复制', copiedLabel: '已复制' }, footnotes: '注释' };

/**
 * 一条评论。
 *
 * 只有**机器人**的答复走宿主的 `MarkdownText`：那些答复本来就是 Markdown 写的
 * （标题、加粗、列表、代码块），按纯文本渲染会把 `**` 这类记号原样显示给人看。
 * 路人的评论保持纯文本 —— 一是它们不是 Markdown，二是没必要把匿名用户的输入
 * 交给一个会解析记号的渲染器。
 */
function Comment({ item }) {
  return <li className={`zfb-comment${item.robot ? ' zfb-comment-robot' : ''}`}>
    <div className="zfb-comment-head">
      <strong className="zfb-who">{item.name}</strong>
      {item.robot && <span className="zfb-badge">官方答复</span>}
      <time className="zfb-meta">{ago(item.at)}</time>
    </div>
    {/* `MarkdownText` 产出的是一组块元素（p / ul / pre / blockquote / table），
        所以容器用 `<div>` 而不是 `<p>` —— 块元素嵌进 `<p>` 里是无效 HTML。 */}
    {item.robot
      ? <div className="zfb-comment-body zfb-md"><MarkdownText text={item.body} labels={MARKDOWN_LABELS}/></div>
      : <p className="zfb-comment-body">{item.body}</p>}
  </li>;
}

/** 评论输入框。放在讨论串底部，像 issue 里那样「接着往下说」。 */
function CommentBox({ value, busy, error, onChange, onSubmit }) {
  return <form className="zfb-reply" onSubmit={onSubmit}>
    <textarea
      value={value}
      rows={2}
      maxLength={LIMITS.comment}
      placeholder="接着说点什么…（所有人都能看到）"
      onChange={event => onChange(event.target.value)}
    />
    {error !== '' && <Notice>{error}</Notice>}
    <div className="zfb-reply-foot">
      <span className="zfb-counter">{value.length}/{LIMITS.comment}</span>
      <button type="submit" className="zfb-submit" disabled={busy || value.trim() === ''}>
        {busy ? '发送中…' : '评论'}
      </button>
    </div>
  </form>;
}

/** 展开的一整条讨论串。 */
function Thread({ issue, me, onComment, onBack }) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const send = async (event) => {
    event.preventDefault();
    const problem = checkComment(draft);
    if (problem !== '') { setError(problem); return; }
    setBusy(true);
    setError('');
    const answer = await onComment(issue.id, draft);
    setBusy(false);
    if (!answer.ok) { setError(answer.error); return; }
    setDraft('');
  };

  return <>
    <button type="button" className="zfb-back" onClick={onBack}><Icon name="arrow" size={14}/>回到全部需求</button>

    <article className="zfb-thread">
      <header className="zfb-thread-head">
        <div className="zfb-item-head">
          <code className="zfb-id">{issue.id}</code>
          <strong>{issue.title}</strong>
          <StateTag status={issue.status}/>
        </div>
        <p className="zfb-thread-meta">
          <span className="zfb-who">{issue.name}</span> 发起 · {ago(issue.at)}
          <span className={`zfb-kind zfb-kind-${issue.kind}`}>{issue.kind === 'track' ? '追踪' : '新需求'}</span>
        </p>
      </header>

      <p className="zfb-thread-body">{issue.detail}</p>

      {issue.comments.length === 0
        ? <p className="zfb-muted">还没有人评论。你是第一个。</p>
        : <ul className="zfb-comments">{issue.comments.map(item => <Comment key={item.cid ?? `${item.name}-${item.at}`} item={item}/>)}</ul>}

      <CommentBox value={draft} busy={busy} error={error} onChange={setDraft} onSubmit={send}/>
      <p className="zfb-muted zfb-as">你将以 <strong>{me}</strong> 的身份评论。</p>
    </article>
  </>;
}

/** 列表里的一条需求：只露摘要与计数，点进去看讨论串。 */
function IssueCard({ issue, onOpen }) {
  const count = issue.comments.length;
  const last = count > 0 ? issue.comments[count - 1] : null;
  return <li className="zfb-item">
    <button type="button" className="zfb-open" onClick={() => onOpen(issue.id)}>
      <div className="zfb-item-head">
        <code className="zfb-id">{issue.id}</code>
        <strong>{issue.title}</strong>
        <StateTag status={issue.status}/>
      </div>
      <p className="zfb-summary">{issue.detail}</p>
      <div className="zfb-item-foot">
        <span className="zfb-meta">
          <span className="zfb-who">{issue.name}</span> · {ago(issue.at)}
        </span>
        <span className="zfb-meta">
          {count === 0 ? '暂无评论' : `${count} 条评论`}
          {last?.robot && <span className="zfb-badge">官方已答复</span>}
          {last && <> · 最后动静 {ago(last.at)}</>}
        </span>
      </div>
    </button>
  </li>;
}

const EMPTY_FORM = Object.freeze({ kind: 'new', title: '', detail: '' });

export function Feedback() {
  const [me, setMe] = useState(() => localName());
  const [issues, setIssues] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [composing, setComposing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const refresh = async () => {
    const answer = await loadIssues();
    setIssues(answer.ok ? answer.issues : { error: answer.error });
  };
  useEffect(() => { void refresh(); }, []);

  const patch = changes => setForm(current => ({ ...current, ...changes }));

  const publish = async (event) => {
    event.preventDefault();
    const problem = checkIssue(form);
    if (problem !== '') { setError(problem); return; }
    setBusy(true);
    setError('');
    const answer = await submitIssue({ ...form, name: me });
    setBusy(false);
    if (!answer.ok) { setError(answer.error); return; }
    setDone(`已发布为 ${answer.issue?.id ?? '新条目'}，欢迎大家在下面讨论。`);
    setForm(EMPTY_FORM);
    setComposing(false);
    await refresh();
    if (answer.issue?.id) setOpenId(answer.issue.id);
  };

  const comment = async (issue, body) => {
    const answer = await submitComment({ issue, body, name: me });
    if (answer.ok) await refresh();
    return answer;
  };

  const rename = () => {
    setMe(resetName());
    setDone('已换一个笔名，之前发的内容不受影响。');
  };

  const offline = issues !== null && !Array.isArray(issues);
  const list = orderIssues(Array.isArray(issues) ? issues : []);
  const stats = summarize(list);
  const opened = list.find(issue => issue.id === openId) ?? null;

  return <>
    <div className="zy-intro">
      <div>
        <span className="zy-eyebrow">你提的每一条，都在这里</span>
        <h1>反馈</h1>
        <p>提需求、在别人的需求下面讨论。不用登录，发布即达。</p>
      </div>
      <Icon name="chat" size={38}/>
    </div>

    <div className="zfb-me">
      <span>你的笔名 <code className="zfb-who">{me}</code></span>
      <button type="button" className="zfb-link" onClick={rename}>换一个</button>
      <span className="zfb-muted">只存在你这台机器上，不代表任何真实身份。</span>
    </div>

    {offline
      ? <Notice>连不上反馈服务（{issues.error}）。已发布的内容暂时看不到，稍后刷新即可；这不影响工作台的其他功能。</Notice>
      : issues === null
        ? <p className="zfb-muted">正在读取…</p>
        : <>
          <div className="zfb-toolbar">
            <button type="button" className="zfb-submit" onClick={() => { setComposing(!composing); setError(''); setDone(''); }}>
              {composing ? '收起' : '提一条新需求'}
            </button>
            <span className="zfb-muted">共 {stats.total} 条 · 推进中 {stats.open} · 已实现 {stats.done} · 评论 {stats.comments}</span>
          </div>

          {(composing || error !== '') && <form className="zfb-form" onSubmit={publish}>
            <div className="zfb-form-head">
              <div className="zfb-choice" role="tablist" aria-label="需求类型">
                <button type="button" role="tab" aria-selected={form.kind === 'new'} onClick={() => patch({ kind: 'new' })}>提新需求</button>
                <button type="button" role="tab" aria-selected={form.kind === 'track'} onClick={() => patch({ kind: 'track' })}>追踪已有</button>
              </div>
            </div>

            {form.kind === 'track' && <p className="zfb-muted">在标题里写上你要追踪的编号（例如 F-002），大家就能对上号。</p>}

            <label className="zfb-field">标题
              <input value={form.title} maxLength={LIMITS.title} onChange={event => patch({ title: event.target.value })} placeholder="一句话说清你想要什么"/>
            </label>

            <label className="zfb-field">具体想法
              <textarea value={form.detail} maxLength={LIMITS.detail} rows={4} onChange={event => patch({ detail: event.target.value })} placeholder="什么时候会用到它？现在的做法哪里别扭？"/>
            </label>

            {error !== '' && <Notice>{error}</Notice>}

            <div className="zfb-form-foot">
              <span className="zfb-counter">{form.detail.length}/{LIMITS.detail}</span>
              <button type="submit" className="zfb-submit" disabled={busy}>{busy ? '正在发布…' : '发布'}</button>
            </div>
          </form>}

          {done !== '' && <p className="zfb-ok" role="status">{done}</p>}

          {opened
            ? <Thread issue={opened} me={me} onComment={comment} onBack={() => setOpenId(null)}/>
            : list.length === 0
              ? <Empty icon="chat" title="还没有人提过">你可以是第一个。任何想法都值得记一笔。</Empty>
              : <ul className="zfb-list">{list.map(issue => <IssueCard key={issue.id} issue={issue} onOpen={setOpenId}/>)}</ul>}
        </>}

    <p className="zfb-muted zfb-foot">
      提交不含任何身份信息，署名只是你本机的随机笔名。数据存在维护者的实例上，重启可能丢失。
    </p>
  </>;
}

export { Feedback as Panel };
