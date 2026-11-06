/**
 * **验收面板**：把 `audit()` 的结果画出来。
 *
 * 审查第 18 条：现有读数全是"工作量"（多少页、多少块），不是"正确性"。
 * 这个面板只显示**不变量是否成立**，每一条都带证据或明确说"无法判定"。
 */
import { audit, designCoverage } from '../../shared/audit.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

/**
 * @param {HTMLElement} box
 * @param {object} state `fold()` 的结果
 */
export function renderAudit(box, state) {
  if (!box) return;
  const result = audit(state);

  const badge = {
    pass: '<span class="ab pass">通过</span>',
    fail: '<span class="ab fail">违反</span>',
    unknown: '<span class="ab unknown">无法判定</span>',
  };

  const rows = result.items.map((item) => `
    <div class="arow ${item.status}">
      <div class="ah">${badge[item.status]}<b>${esc(item.name)}</b></div>
      <div class="ad">${esc(item.detail)}${item.evidence ? `<span class="aev">${esc(item.evidence)}</span>` : ''}</div>
    </div>`).join('');

  /* 设计覆盖：图里每一步，本次跑到了没有。 */
  const cover = designCoverage(state).map((d) => {
    const mark = d.done === true ? '<span class="ab pass">有</span>'
      : d.done === false ? '<span class="ab fail">无</span>'
        : '<span class="ab unknown">推断</span>';
    return `<div class="drow">${mark}<span class="dn">${esc(d.name)}</span>${
      d.note ? `<span class="dnote">${esc(d.note)}</span>` : ''}</div>`;
  }).join('');

  const head = result.verdict === 'pass'
    ? '<span class="ab pass">架构约束全部通过</span>'
    : result.verdict === 'fail'
      ? `<span class="ab fail">${result.failed} 条不满足</span>`
      : '<span class="ab unknown">数据不足，无法判定</span>';

  box.innerHTML = `
    <div class="auditHead">${head}<span class="dim">通过 ${result.passed} · 违反 ${result.failed} · 无法判定 ${result.unknown}</span></div>
    <div class="auditList">${rows}</div>
    <div class="designTitle">设计图覆盖</div>
    <div class="designList">${cover}</div>`;
}
