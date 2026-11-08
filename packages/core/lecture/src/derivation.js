import { REGISTER } from './register.js';

/**
 * 只复核正文里已经写明、并且能逐项相加的线性关系。
 * 模型说「推导没问题」不算通过。解析不了的句子不判，避免把散文公式误伤成草稿。
 * 发现矛盾时不改正文，只返回可核对的说明。
 */

function mapOf(name, coef) {
  return new Map([[name, coef]]);
}
function scale(terms, factor) {
  const out = new Map();
  for (const [name, coef] of terms) out.set(name, coef * factor);
  return out;
}
function add(left, right) {
  const out = new Map(left);
  for (const [name, coef] of right) {
    const sum = (out.get(name) ?? 0) + coef;
    if (sum === 0) out.delete(name);
    else out.set(name, sum);
  }
  return out;
}
function same(left, right) {
  const names = new Set([...left.keys(), ...right.keys()]);
  for (const name of names) if ((left.get(name) ?? 0) !== (right.get(name) ?? 0)) return false;
  return true;
}
function show(terms) {
  const entries = [...terms.entries()].filter(([, coef]) => coef !== 0)
    .sort((a, b) => (a[1] < 0) - (b[1] < 0) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  if (!entries.length) return '0';
  const factor = entries.every(([, coef]) => Math.abs(coef) === Math.abs(entries[0][1])) ? Math.abs(entries[0][1]) : 1;
  const body = entries.map(([name, coef]) => {
    const mag = Math.abs(coef) / factor;
    const atom = name === '#' ? String(mag) : (mag === 1 ? name : `${mag}${name}`);
    return `${coef < 0 ? '-' : '+'}${atom}`;
  }).join('').replace(/^\+/, '');
  return factor === 1 ? body : `${factor}(${body})`;
}

function parseExpr(input) {
  let i = 0;
  const readSum = () => {
    let sign = 1;
    if (input[i] === '+') i += 1;
    else if (input[i] === '-') { sign = -1; i += 1; }
    let acc = readTerm();
    if (!acc) return null;
    acc = scale(acc, sign);
    while (input[i] === '+' || input[i] === '-') {
      const op = input[i]; i += 1;
      const term = readTerm();
      if (!term) return null;
      acc = add(acc, scale(term, op === '+' ? 1 : -1));
    }
    return acc;
  };
  const readTerm = () => {
    let coef = 1;
    if (/[0-9]/.test(input[i] ?? '')) {
      let digits = '';
      while (/[0-9]/.test(input[i] ?? '')) digits += input[i++];
      coef = Number(digits);
      if (!coef) return null;
    }
    if (input[i] === '(') {
      i += 1;
      const inner = readSum();
      if (!inner || input[i] !== ')') return null;
      i += 1;
      return scale(inner, coef);
    }
    if (/[A-Za-z]/.test(input[i] ?? '')) {
      let name = '';
      while (/[A-Za-z0-9]/.test(input[i] ?? '')) name += input[i++];
      return mapOf(name, coef);
    }
    return coef !== 1 ? mapOf('#', coef) : null;
  };
  const value = readSum();
  return value && i === input.length ? value : null;
}

function canon(text) {
  return String(text)
    .replace(/\\(?:leq|le|geqslant|geq|ge)\b/g, match => /leq|le/.test(match) ? '<=' : '>=')
    .replace(/\$/g, '')
    .replace(/\\/g, '')
    .replace(/_\{i\+1\}/g, 'Ip1')
    .replace(/_\{([^}]*)\}/g, (_, inner) => inner.replace(/[^A-Za-z0-9]/g, ''))
    .replace(/_([A-Za-z0-9])/g, '$1')
    .replace(/[{}]/g, '')
    .replace(/[₀₁₂₃₄₅₆₇₈₉]/g, ch => String('₀₁₂₃₄₅₆₇₈₉'.indexOf(ch)))
    .replace(/'/g, 'p')
    .replace(/≤/g, '<=')
    .replace(/≥/g, '>=')
    .replace(/\s+/g, '');
}

export function reviewDerivation(text) {
  const defs = new Map();
  const notes = [];
  for (const piece of canon(text).split(/[^A-Za-z0-9+<=>()\-]+/).filter(Boolean)) {
    const diff = piece.match(/^([A-Za-z][A-Za-z0-9]*)-([A-Za-z][A-Za-z0-9]*)<=(.+)$/);
    if (diff) {
      const left = defs.get(diff[1]);
      const right = defs.get(diff[2]);
      const claimed = parseExpr(diff[3]);
      if (left?.op === '<=' && right?.op === '=' && claimed) {
        const expected = add(left.expr, scale(right.expr, -1));
        if (!same(claimed, expected)) {
          const pretty = value => value.replaceAll('PhiIp1', 'Phi_{i+1}').replaceAll('Phii', 'Phi_i');
          notes.push(`推导未通过复核：${pretty(diff[1])}-${pretty(diff[2])} 由已写明的上界相减应为 ${pretty(show(expected))}，正文写成 ${pretty(show(claimed))}`);
        }
      }
      continue;
    }
    const defined = piece.match(/^([A-Za-z][A-Za-z0-9]*)(<=|=)(.+)$/);
    if (!defined || defined[2] === '=' && defined[3].includes('<=')) continue;
    const expr = parseExpr(defined[3]);
    if (expr) defs.set(defined[1], { op: defined[2], expr });
  }
  return notes;
}

export function withDerivation(verdict, text) {
  const extra = reviewDerivation(text);
  if (!extra.length || verdict.register === REGISTER.failed) return verdict;
  return { register: REGISTER.draft, notes: [...verdict.notes, ...extra] };
}
