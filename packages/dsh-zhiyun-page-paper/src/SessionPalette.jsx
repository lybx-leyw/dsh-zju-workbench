import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from 'dsh-zhiyun-ui-primitives';
import { archiveSessionById, listSessions, loadSessionLabels } from './library.js';
import { buildRows, indexAfterRemove, initialIndex, moveIndex, rowText, sessionCode } from './resume.js';

/**
 * `/resume` 会话面板。
 *
 * # 为什么是「命令 + 面板」而不是常驻的会话列表
 *
 * 抽屉最窄 300px，左侧还有阅读器的拖拽条 —— 再钉一列会话树就只剩一百多像素看正文。
 * 用户的判断是对的：会话管理是**低频动作**，需要的不是常驻空间，而是一个能起手、
 * 能看清标签、能一键离开的浮层。所以做成斜杠命令唤起：输入框里打 `/resume`，
 * 面板盖在抽屉上；Esc 或点空白处就回到提问。
 *
 * # 键位
 *
 * ↑↓ 移动（到边界绕回另一端）、Enter 切到选中会话、Delete 归档选中会话、Esc 关闭。
 * 这些键**只在面板里生效**（面板自己抢焦点），不会误伤输入框里的普通打字。
 *
 * # 「删除」到底是什么
 *
 * 宿主没有「真删会话」的公开能力，官方能做的就是归档：从所有列表里消失、日志保留、
 * 可在宿主的会话列表里恢复。所以按钮文案与提示都写「删除（归档）」，不假装物理删除。
 */
export function SessionPalette({ topic, name, currentN, onPick, onClose }) {
  const [rows, setRows] = useState(null);
  const [index, setIndex] = useState(-1);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const boxRef = useRef(null);
  const listRef = useRef(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const listed = await listSessions(topic, name);
      const sessions = listed?.sessions ?? [];
      // 标签（标题 + 首句）是另一个端点：它要逐个读会话日志，慢一些。**先出编号列表**
      // （立刻可用），标签到了再补上 —— 否则打开面板要等好几秒才有反应。
      const base = buildRows(sessions, [], currentN);
      setRows(base);
      setIndex(initialIndex(base));
      if (base.length === 0) return;
      try {
        const labeled = await loadSessionLabels(base.map((row) => row.sessionId));
        setRows(buildRows(sessions, labeled?.cards ?? [], currentN));
      } catch (labelError) {
        setNotice(`标签读取失败，只显示编号：${labelError instanceof Error ? labelError.message : String(labelError)}`);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
      setRows([]);
      setIndex(-1);
    }
  }, [topic, name, currentN]);

  useEffect(() => { void load(); }, [load]);

  // 面板一出现就抢焦点：↑↓/Enter/Delete 要在它身上生效，而不是在输入框里。
  useEffect(() => { boxRef.current?.focus(); }, []);

  // 选中项滚动进视野（列表可能比面板高）。
  useEffect(() => {
    const list = listRef.current;
    if (!list || index < 0) return;
    const row = list.children[index];
    row?.scrollIntoView({ block: 'nearest' });
  }, [index, rows]);

  const pick = useCallback((row) => {
    if (!row) return;
    onPick?.(row);
  }, [onPick]);

  const remove = useCallback(async (row) => {
    if (!row || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      await archiveSessionById(row.sessionId);
      const nextRows = rows.filter((item) => item.sessionId !== row.sessionId);
      const nextIndex = indexAfterRemove(index, rows.length);
      setRows(nextRows);
      setIndex(nextIndex);
      setNotice(`已删除 #${sessionCode(row.sessionId)}（归档，可在宿主的会话列表里恢复）`);
      // 删掉的正好是当前连着的会话：顺手切到列表里挨着的那条（没了就开新的），
      // 否则抽屉会继续连着一个刚从列表里消失的会话。
      if (row.current) {
        const fallback = nextRows[nextIndex] ?? nextRows[nextRows.length - 1] ?? null;
        onPick?.(fallback);
      }
    } catch (archiveError) {
      setNotice(`删除失败：${archiveError instanceof Error ? archiveError.message : String(archiveError)}`);
    } finally {
      setBusy(false);
    }
  }, [rows, index, busy, name, onPick]);

  const onKeyDown = useCallback((event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setIndex((at) => moveIndex(at, 1, rows?.length ?? 0));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setIndex((at) => moveIndex(at, -1, rows?.length ?? 0));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      pick(rows?.[index]);
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace' && event.metaKey) {
      event.preventDefault();
      void remove(rows?.[index]);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose?.();
    }
  }, [rows, index, pick, remove, onClose]);

  const hint = useMemo(() => {
    if (error) return error;
    if (rows === null) return '正在读取会话…';
    if (rows.length === 0) return '这篇文献还没有历史会话。';
    return `${rows.length} 个会话（旧 → 新）`;
  }, [error, rows]);

  return <div className="zp-resume" role="dialog" aria-label="切换会话" tabIndex={-1} ref={boxRef} onKeyDown={onKeyDown}>
    <div className="zp-resume-head">
      <Icon name="history" size={15}/>
      <strong>切换会话</strong>
      <span className="zp-resume-count">{hint}</span>
      <button type="button" className="zp-resume-close" title="关闭" aria-label="关闭" onClick={onClose}><Icon name="close" size={14}/></button>
    </div>
    <div className="zp-resume-list" role="listbox" aria-label="会话列表" ref={listRef}>
      {(rows ?? []).map((row, at) => <div
        key={row.sessionId}
        role="option"
        aria-selected={at === index}
        className={`zp-resume-row${at === index ? ' is-active' : ''}${row.current ? ' is-current' : ''}`}
        title={`${rowText(row, name)}\n${row.sessionId}`}
        onMouseEnter={() => setIndex(at)}
        onClick={() => pick(row)}
      >
        <span className="zp-resume-code">#{sessionCode(row.sessionId)}</span>
        <div className="zp-resume-text">
          <span className="zp-resume-first">{row.firstQuestion || row.title || (row.blank ? '（还没有提问）' : '（没有可读的内容）')}</span>
          <span className="zp-resume-meta">
            {name}{row.current ? ' · 当前' : ''}{row.running ? ' · 生成中' : ''}
          </span>
        </div>
      </div>)}
    </div>
    <div className="zp-resume-foot">
      <span className="zp-resume-keys">↑↓ 选择 · Enter 切换 · Delete 删除（归档）· Esc 关闭</span>
      <span className="zp-resume-notice">{notice}</span>
    </div>
  </div>;
}
