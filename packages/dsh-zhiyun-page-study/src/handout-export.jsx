import React from 'react';

/**
 * 「导出到笔记库」按钮。
 *
 * # 与「导出 PDF」是两件事，别合并
 *
 * `lecture-export.jsx` 那个按钮走 `window.print()`，把整节讲义排版成 PDF 存到本地。
 * 这个按钮走**宿主 RPC**（`handout-export`），把讲义编码成 Markdown 写进用户的
 * 笔记库 —— 落到磁盘、能被 Obsidian 打开、能接着往下写。两者的产物、去向、
 * 失败方式都不同，所以是两个按钮，不是一个按钮的两种模式。
 *
 * # 为什么不在生成完成后自动导出
 *
 * 一次生成就往用户笔记库里塞一份文件，而他可能根本不想导，那是噪音。
 * 导出只在用户按一下时发生（理由同 `dsh-zhiyun-core-handout` 的 README）。
 *
 * # 重名不覆盖
 *
 * 已经有同名笔记时，宿主侧会加「（2）（3）」后缀。这里**不**做二次确认：
 * 既然不会覆盖，就没有「会毁掉东西」需要拦。结果里 `deduped` 为真时把实际
 * 落到的名字显示出来，用户自己去笔记库里认。
 */
export function HandoutExportButton({ controller, state }) {
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState('');
  const [error, setError] = React.useState('');
  const live = React.useRef(true);
  React.useEffect(() => {
    live.current = true;
    return () => { live.current = false; };
  }, []);

  const hasLecture = Boolean(state?.lecture?.chapters?.length);
  const lesson = state?.lesson;
  const course = state?.course;

  const start = async () => {
    // ⚠️ 判据是 `subId`（节次对象上没有可用的 `id`）。写成 `lesson.id` 会让这个
    //    前置检查永远为真，按钮变成「点了只会说没选中一节课」，连 RPC 都发不出去。
    if (!lesson?.subId || !course?.id) { setError('还没选中一节课'); return; }
    setBusy(true); setMessage('正在写入笔记库…'); setError('');
    try {
      const result = await controller.request('handout-export', {
        courseId: String(course.id),
        // ⚠️ 只用 `subId`。节次对象上没有可用的 `id`，而宿主侧的 `identifier()`
        // 只收纯数字字符串 —— 传错字段会被它挡成「输入信息无效」，把真实原因盖掉。
        subId: String(lesson.subId),
        // 标题与学期由**界面当下**这一份传下去：记录里存的可能是生成时的编号，
        // 而界面上正显示着真实标题，没有理由放着它不用。
        courseTitle: course.title,
        lessonTitle: lesson.title,
        termName: course.termName,
      });
      if (!live.current) return;
      // 落到哪个名字就报哪个名字：用户下一步要去笔记库找它。
      setMessage(result?.deduped
        ? `已导出：${result.path}（同名笔记已存在，自动加了后缀）`
        : `已导出：${result?.path ?? '笔记库'}`);
    } catch (failure) {
      if (!live.current) return;
      setError(failure?.message ?? '导出失败');
      setMessage('');
    } finally {
      if (live.current) setBusy(false);
    }
  };

  return <div className="zs-handout-note-export">
    <button type="button" className="zs-button" disabled={busy || !hasLecture} onClick={start}
      title="把这一节的讲义写成笔记库里的一份 Markdown 笔记；同名笔记不会被覆盖">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M4 4h11l5 5v11H4z"/><path d="M15 4v5h5"/><path d="M8 13h8M8 16h5"/></svg>
      {busy ? '正在导出…' : '导出到笔记库'}
    </button>
    {message && <small role="status">{message}</small>}
    {error && <small role="alert">{error}</small>}
  </div>;
}
