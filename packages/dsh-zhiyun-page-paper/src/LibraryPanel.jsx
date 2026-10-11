import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from 'dsh-zhiyun-ui-primitives';
import { createTopic, loadLibrary, uploadPaper } from './library.js';

/**
 * 文献库选择器：左侧栏太小、右侧栏要留给 AI，所以做成页头的一个下拉面板。
 *
 * 它是「打开本地 PDF」的入口：上传走 `POST /paper-reader/api/library/upload`
 * （原始字节 + `x-dpr-topic` / `x-dpr-name` 头，中文用 `encodeURIComponent` 传，
 * 因为 HTTP 头不允许非 Latin-1），落盘位置由上游决定（默认 `$DSH_HOME/.dsh-paper-reader/data`，
 * 本仓把它指向 profile 目录下的 `data/zhiyun-paper`）。
 *
 * 不做删除：删文献会连带删掉转录、译文与会话，误点代价太大；
 * 需要清理就去 profile 的 data 目录里删（页头会显示该目录路径）。
 */

export function LibraryPanel({ current, onPick, onReload }) {
  const [open, setOpen] = useState(false);
  const [library, setLibrary] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [topicDraft, setTopicDraft] = useState('');
  const [uploadTopic, setUploadTopic] = useState('');
  const [notice, setNotice] = useState(null);
  const fileRef = useRef(null);
  const rootRef = useRef(null);

  const refresh = useCallback(() => {
    setError(null);
    loadLibrary().then(setLibrary, (reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, []);

  useEffect(() => { refresh(); }, [refresh, onReload]);

  // 点外面 / Esc 关闭。
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event) => { if (!rootRef.current?.contains(event.target)) setOpen(false); };
    const onKey = (event) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const papers = library?.papers ?? [];
  const topics = library?.topics ?? [];
  const grouped = useMemo(() => {
    const map = new Map();
    for (const paper of papers) {
      if (!map.has(paper.topic)) map.set(paper.topic, []);
      map.get(paper.topic).push(paper);
    }
    return [...map.entries()];
  }, [papers]);

  useEffect(() => {
    if (open && !uploadTopic) setUploadTopic(current?.topic ?? topics[0] ?? '');
  }, [open, uploadTopic, current, topics]);

  const addTopic = useCallback(async () => {
    const name = topicDraft.trim();
    if (!name) return;
    setBusy(true);
    try {
      await createTopic(name);
      setTopicDraft('');
      setUploadTopic(name);
      setNotice(`已新建专题「${name}」，接着上传 PDF 吧`);
      refresh();
    } catch (reason) {
      setNotice(`新建专题失败：${reason instanceof Error ? reason.message : String(reason)}`);
    } finally {
      setBusy(false);
    }
  }, [topicDraft, refresh]);

  const pickFiles = useCallback(async (files) => {
    const list = [...(files ?? [])].filter((file) => file.name.toLowerCase().endsWith('.pdf'));
    if (list.length === 0) { setNotice('只支持 PDF 文件'); return; }
    setBusy(true);
    let last = null;
    try {
      for (const file of list) {
        // topic 为空时上游会 mkdir 一个空名目录，所以先兜一个「未分类」。
        const topic = (uploadTopic || topics[0] || '未分类').trim();
        const bytes = new Uint8Array(await file.arrayBuffer());
        last = await uploadPaper({ topic, name: file.name, bytes });
      }
      setNotice(`已上传 ${list.length} 个文件${last ? `（${last.topic}/${last.name}）` : ''}`);
      refresh();
      if (last) onPick?.({ topic: last.topic, name: last.name });
    } catch (reason) {
      setNotice(`上传失败：${reason instanceof Error ? reason.message : String(reason)}`);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }, [uploadTopic, topics, refresh, onPick]);

  const label = current ? `${current.topic} / ${current.name}` : '选择文献';

  return <div className="zp-library" ref={rootRef}>
    <button type="button" className="zp-library-trigger" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
      <Icon name="book" size={16}/>
      <span title={label}>{label}</span>
      <Icon name="chevron" size={15}/>
    </button>

    {open && <div className="zp-library-pop" role="dialog" aria-label="文献库">
      <div className="zp-library-head">
        <strong>文献库</strong>
        <button type="button" title="刷新" aria-label="刷新" onClick={refresh}><Icon name="history" size={15}/></button>
      </div>

      {error && <div className="zp-library-error">{error}</div>}

      <div className="zp-library-list">
        {papers.length === 0 && !error && <p className="zp-library-empty">
          还没有文献。新建一个专题，然后上传 PDF。
        </p>}
        {grouped.map(([topic, items]) => <div className="zp-library-topic" key={topic}>
          <div className="zp-library-topic-name">{topic}<span>{items.length}</span></div>
          {items.map((paper) => <button
            type="button"
            key={`${paper.topic}/${paper.name}`}
            className={current && paper.topic === current.topic && paper.name === current.name ? 'is-current' : undefined}
            onClick={() => { onPick?.(paper); setOpen(false); }}
          >
            <Icon name="paper" size={15}/>
            <span title={paper.name}>{paper.name}</span>
          </button>)}
        </div>)}
      </div>

      <div className="zp-library-foot">
        <div className="zp-library-row">
          <input
            type="text"
            placeholder="新建专题，例如：多模态"
            value={topicDraft}
            onChange={(event) => setTopicDraft(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void addTopic(); } }}
          />
          <button type="button" onClick={addTopic} disabled={busy || !topicDraft.trim()}><Icon name="plus" size={15}/>新建</button>
        </div>
        <div className="zp-library-row">
          <select value={uploadTopic} onChange={(event) => setUploadTopic(event.target.value)} aria-label="上传到专题">
            {topics.length === 0 && <option value="">未分类</option>}
            {topics.map((topic) => <option key={topic} value={topic}>{topic}</option>)}
          </select>
          <button type="button" className="is-primary" onClick={() => fileRef.current?.click()} disabled={busy}>
            <Icon name="plus" size={15}/>{busy ? '处理中…' : '上传 PDF'}
          </button>
        </div>
        <input ref={fileRef} type="file" accept="application/pdf,.pdf" multiple hidden onChange={(event) => void pickFiles(event.target.files)}/>
        {notice && <div className="zp-library-notice">{notice}</div>}
        {library?.dataDir && <div className="zp-library-dir" title={library.dataDir}>存放于 {library.dataDir}</div>}
      </div>
    </div>}
  </div>;
}
