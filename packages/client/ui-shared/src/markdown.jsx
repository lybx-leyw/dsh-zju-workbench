/**
 * 轻量 Markdown 渲染（无第三方依赖，输出 React 元素而非 HTML 字符串）。
 *
 * # 为什么不用 marked / markdown-it
 *
 * 那类库输出的是 **HTML 字符串**，要用就得 `dangerouslySetInnerHTML` ——
 * 而输入来自模型（可能被论文内容影响），一旦漏掉某类标签就是 XSS。
 *
 * 这里只把最常见的几种语法转成 React 元素：标题、列表、代码块、行内代码、
 * 粗体/斜体、链接、引用。**不支持内联 HTML**（原样当文本显示）——
 * 少一类语法，比多一个注入面划算。
 *
 * # 支持什么
 *
 *   ```lang … ```   围栏代码块（保留语言标记，等宽显示，可横向滚动）
 *   # / ## / ###    标题（行首）
 *   - / * / 1.      无序 / 有序列表
 *   >               引用
 *   `code`          行内代码
 *   **粗体**        粗体
 *   *斜体* / _斜体_ 斜体
 *   [文字](url)     链接（只允许 http/https/相对路径）
 *   ---             分隔线
 *
 * # 为什么不渲染内联 HTML
 *
 * 模型很容易被诱导输出 `<img onerror=...>`。这里把 `<` 原样当文本 ——
 * 用户看到的是字面的尖括号，不是被浏览器执行。
 */
import React from 'react';

/** 允许的链接协议：不给 `javascript:` 任何机会。 */
const SAFE_HREF = /^(https?:\/\/|\/|#|mailto:)/i;

/**
 * 把一行里的行内语法转成 React 元素序列。
 *
 * 顺序有讲究：先切行内代码（`code` 里的 `*` 不该被当成斜体），
 * 再处理粗体 / 斜体 / 链接。
 *
 * @param text - 一行文本。
 * @param keyPrefix - 稳定的 key 前缀（行号）。
 * @returns React 节点数组。
 */
function inline(text, keyPrefix) {
  const out = [];
  let rest = text;
  let n = 0;

  // 反复找「最短的可识别片段」，把前面当纯文本推出去。
  while (rest.length > 0) {
    const code = /`([^`]+)`/.exec(rest);
    const bold = /\*\*([^*]+)\*\*/.exec(rest);
    const italic = /\*([^*]+)\*|_([^_]+)_/.exec(rest);
    const link = /\[([^\]]+)\]\(([^)]+)\)/.exec(rest);

    // 取最靠前的一个匹配
    const candidates = [
      code === null ? null : { at: code.index, len: code[0].length, kind: 'code', m: code },
      bold === null ? null : { at: bold.index, len: bold[0].length, kind: 'bold', m: bold },
      italic === null ? null : { at: italic.index, len: italic[0].length, kind: 'italic', m: italic },
      link === null ? null : { at: link.index, len: link[0].length, kind: 'link', m: link },
    ].filter((c) => c !== null);

    if (candidates.length === 0) {
      out.push(rest);
      break;
    }
    const first = candidates.reduce((best, cur) => (cur.at < best.at ? cur : best));
    if (first.at > 0) out.push(rest.slice(0, first.at));

    const key = `${keyPrefix}-i${n}`;
    n += 1;
    if (first.kind === 'code') {
      out.push(React.createElement('code', {
        key,
        style: {
          padding: '1px 5px', borderRadius: '4px', fontSize: '12px',
          background: 'var(--zy-layer, #f0f1f3)', fontFamily: 'ui-monospace, monospace',
        },
      }, first.m[1]));
    } else if (first.kind === 'bold') {
      out.push(React.createElement('strong', { key }, first.m[1]));
    } else if (first.kind === 'italic') {
      out.push(React.createElement('em', { key }, first.m[1] ?? first.m[2]));
    } else {
      const url = first.m[2];
      // 不在白名单里的协议，退化成纯文本 —— 不生成可点的链接。
      if (!SAFE_HREF.test(url)) {
        out.push(first.m[0]);
      } else {
        out.push(React.createElement('a', {
          key, href: url,
          target: url.startsWith('http') ? '_blank' : undefined,
          rel: 'noreferrer',
          style: { color: 'var(--zy-accent, #0969da)' },
        }, first.m[1]));
      }
    }
    rest = rest.slice(first.at + first.len);
  }

  return out;
}

/**
 * 渲染一段 Markdown。
 *
 * @param props.text - Markdown 源文本。
 * @param props.muted - 是否用次要色（思考内容用它）。
 * @returns React 元素。
 */
export function Markdown({ text = '', muted = false }) {
  const lines = String(text).split('\n');
  const blocks = [];
  let i = 0;
  let key = 0;

  const baseColor = muted ? 'var(--zy-muted, #656d76)' : 'var(--zy-text, #24292f)';

  while (i < lines.length) {
    const line = lines[i];

    // 围栏代码块
    const fence = /^```(\w*)\s*$/.exec(line);
    if (fence !== null) {
      const codeLines = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i])) {
        codeLines.push(lines[i]);
        i += 1;
      }
      i += 1; // 跳过结束围栏（可能没有）
      blocks.push(React.createElement('pre', {
        key: key++,
        'data-md-block': 'code',
        style: {
          margin: '6px 0', padding: '8px 10px', borderRadius: '8px',
          background: 'var(--zy-layer, #f6f7f9)', overflowX: 'auto',
          fontSize: '12px', lineHeight: 1.6,
          fontFamily: 'ui-monospace, SFMono-Regular, monospace',
          color: baseColor,
        },
      }, React.createElement('code', null, codeLines.join('\n'))));
      continue;
    }

    // 分隔线
    if (/^(---|\*\*\*)\s*$/.test(line)) {
      blocks.push(React.createElement('hr', {
        key: key++, style: { border: 'none', borderTop: '0.5px solid var(--zy-line, #e8eaed)', margin: '10px 0' },
      }));
      i += 1;
      continue;
    }

    // 标题
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading !== null) {
      const level = heading[1].length;
      const sizes = { 1: '16px', 2: '14px', 3: '13px' };
      blocks.push(React.createElement(`h${level + 2}`, {
        key: key++,
        style: { margin: '10px 0 6px', fontSize: sizes[level], fontWeight: 600, color: baseColor },
      }, inline(heading[2], `h${key}`)));
      i += 1;
      continue;
    }

    // 引用
    if (/^>\s?/.test(line)) {
      const quote = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^>\s?/, ''));
        i += 1;
      }
      blocks.push(React.createElement('blockquote', {
        key: key++,
        style: {
          margin: '6px 0', padding: '2px 0 2px 10px',
          borderLeft: '2px solid var(--zy-line, #e8eaed)',
          color: 'var(--zy-muted, #656d76)', fontSize: '12px', lineHeight: 1.7,
        },
      }, inline(quote.join(' '), `q${key}`)));
      continue;
    }

    // 列表（连续同类项合并成一个 ul/ol）
    const bullet = /^\s*([-*]|\d+\.)\s+(.*)$/.exec(line);
    if (bullet !== null) {
      const ordered = /\d/.test(bullet[1]);
      const items = [];
      while (i < lines.length) {
        const m = /^\s*([-*]|\d+\.)\s+(.*)$/.exec(lines[i]);
        if (m === null || /\d/.test(m[1]) !== ordered) break;
        items.push(React.createElement('li', { key: `li${i}` }, inline(m[2], `li${i}`)));
        i += 1;
      }
      blocks.push(React.createElement(ordered ? 'ol' : 'ul', {
        key: key++,
        style: { margin: '4px 0', paddingLeft: '20px', color: baseColor, lineHeight: 1.7 },
      }, items));
      continue;
    }

    // 空行
    if (line.trim() === '') { i += 1; continue; }

    // 普通段落（连续非空行合成一段）
    const para = [];
    while (i < lines.length && lines[i].trim() !== ''
      && !/^```/.test(lines[i]) && !/^(#{1,3})\s/.test(lines[i])
      && !/^>\s?/.test(lines[i]) && !/^\s*([-*]|\d+\.)\s/.test(lines[i])) {
      para.push(lines[i]);
      i += 1;
    }
    blocks.push(React.createElement('p', {
      key: key++, style: { margin: '4px 0', lineHeight: 1.7, color: baseColor },
    }, inline(para.join(' '), `p${key}`)));
  }

  return React.createElement('div', { 'data-md-root': '' }, ...blocks);
}

export default Markdown;
