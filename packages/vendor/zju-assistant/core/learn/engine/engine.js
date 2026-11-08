'use strict';
/* Drawing + timing toolkit. Everything is a pure function of absolute time `t`,
   so any frame can be rendered on its own (seek, ?t=, frame-by-frame export). */
const V = (() => {
  const W = 1920, H = 1080;
  /* Scenes draw inside SAFE: the strip above it carries the chapter label, the strip below the caption. */
  const SAFE = { x0: 90, y0: 130, x1: 1830, y1: 930 };
  /* Two looks. Every theme defines the same role names, so a scene written with roles works in both.
     accent = the one thing being talked about; cat = identities of up to five things that coexist. */
  const THEMES = {
    anthropic: {
      bg: '#F0EEE6', paper: '#FAF9F5', ink: '#1F1E1D', mute: '#6B6A64', faint: '#A8A599', hair: '#D6D2C4',
      accent: '#D97757', accentDeep: '#B5583A', good: '#788C5D', bad: '#B5583A', wash: '#E3DACC',
      cat: ['#D97757', '#5B8FC4', '#788C5D', '#C46686', '#C7963A'],
    },
    keynote: {
      bg: '#FFFFFF', paper: '#F5F5F7', ink: '#1D1D1F', mute: '#6E6E73', faint: '#A1A1A6', hair: '#D2D2D7',
      accent: '#0071E3', accentDeep: '#0058B0', good: '#1F9D4C', bad: '#E8352B', wash: '#E8E8ED',
      cat: ['#0071E3', '#F56300', '#1F9D4C', '#AF52DE', '#0A97A6'],
    },
  };
  const C = {}, CAT = [];
  function setTheme(name) {
    const th = THEMES[name]; if (!th) throw new Error('unknown theme: ' + name);
    for (const k in th) if (k !== 'cat') C[k] = th[k];
    CAT.length = 0; CAT.push(...th.cat);
  }
  setTheme('anthropic');
  /* Everything on the picture is set in one sans face. Serif faces fall to Songti on Chinese Windows, thin and
     sharp on screen, so `serif` and `title` now name the same sans stack: scenes that ask for them keep working.
     "Learn Sans" is the face the reader supplies (HarmonyOS Sans SC with Inter for Latin and digits, the user's pick:
     the free pair closest to PingFang and SF). Opened on its own, the film uses the first of the rest the machine has. */
  const SANS = '"Learn Sans","Inter","HarmonyOS Sans SC","PingFang SC","Noto Sans SC","Microsoft YaHei UI","Microsoft YaHei",system-ui,sans-serif';
  /* Code is set the way VS Code sets it out of the box (the user's pick): Consolas on Windows, Menlo on a Mac,
     lines FONT.codeLine × the font size apart. Chinese inside code falls through to the sans faces after them. */
  const FONT = {
    sans: SANS, serif: SANS, title: SANS,
    mono: 'Consolas,Menlo,Monaco,"Courier New","Noto Sans SC","Microsoft YaHei",monospace', codeLine: 1.35,
  };
  let ctx = null;
  const setCtx = c => { ctx = c; };

  // ---- math ----
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, p) => a + (b - a) * p;
  const ease = v => { v = clamp(v); return v * v * v * (v * (v * 6 - 15) + 10); };
  const easeOut = v => 1 - Math.pow(1 - clamp(v), 3);
  const easeBack = v => { v = clamp(v); const c = 1.6; return 1 + (c + 1) * Math.pow(v - 1, 3) + c * Math.pow(v - 1, 2); };
  const TAU = Math.PI * 2;
  const rad = d => d * Math.PI / 180;
  function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  // ---- colour ----
  const hex = h => { const n = parseInt(h.slice(1), 16); return [n >> 16, n >> 8 & 255, n & 255]; };
  const rgba = (h, a = 1) => { const [r, g, b] = hex(h); return `rgba(${r},${g},${b},${a})`; };
  const mixc = (h1, h2, p) => { const a = hex(h1), b = hex(h2); p = clamp(p); return `rgb(${a.map((v, i) => Math.round(lerp(v, b[i], p))).join(',')})`; };

  // ---- primitives ----
  function alpha(a, fn) { if (a <= 0.003) return; ctx.save(); ctx.globalAlpha *= clamp(a); fn(); ctx.restore(); }
  function fontOf({ size = 36, font = 'sans', weight = 400, italic = false } = {}) { return `${italic ? 'italic ' : ''}${weight} ${size}px ${FONT[font] || font}`; }
  /* A string that holds $…$ is set as formulas (see below); o.math = false draws the dollar signs as they are. */
  function txt(str, x, y, o = {}) {
    const a = o.alpha === undefined ? 1 : o.alpha; if (a <= 0.003 || str === '') return 0;
    ctx.save(); ctx.globalAlpha *= clamp(a); ctx.font = fontOf(o); ctx.fillStyle = o.color || C.ink;
    ctx.textAlign = o.align || 'center'; ctx.textBaseline = o.baseline || 'middle';
    if (o.ls) ctx.letterSpacing = o.ls + 'px';
    if (o.halo) { ctx.lineWidth = o.halo; ctx.strokeStyle = o.haloColor || C.bg; ctx.lineJoin = 'round'; }
    let w;
    if (ismath(str, o)) {
      const dy = mdrop(), L = mline(str, o), x0 = x - (o.align === 'left' ? 0 : o.align === 'right' ? L.w : L.w / 2);
      if (o.halo) L.f(x0, y + dy, true);
      L.f(x0, y + dy, false); w = L.w;
    } else { if (o.halo) ctx.strokeText(str, x, y); ctx.fillText(str, x, y); w = ctx.measureText(str).width; }
    ctx.restore(); return w;
  }
  function measure(str, o = {}) { ctx.save(); ctx.font = fontOf(o); if (o.ls) ctx.letterSpacing = o.ls + 'px'; const w = ismath(str, o) ? mline(str, o).w : ctx.measureText(str).width; ctx.restore(); return w; }
  /* How far a line reaches: its width, and how far its ink goes above and below the y it is drawn at. */
  function extent(str, o = {}) {
    ctx.save(); ctx.font = fontOf(o); ctx.textBaseline = o.baseline || 'middle'; if (o.ls) ctx.letterSpacing = o.ls + 'px';
    let r;
    if (ismath(str, o)) { const dy = mdrop(), L = mline(str, o); r = { w: L.w, up: L.a - dy, down: L.d + dy }; }
    else { const m = ctx.measureText(str); r = { w: m.width, up: m.actualBoundingBoxAscent, down: m.actualBoundingBoxDescent }; }
    ctx.restore(); return r;
  }
  /* Rich text: runs = [{t, color, font, italic, weight, sub, sup, bg, size}] laid out on one line. */
  function rich(runs, x, y, o = {}) {
    const a = o.alpha === undefined ? 1 : o.alpha; if (a <= 0.003) return 0;
    const size = o.size || 36;
    const mk = r => ({ size: (r.sub || r.sup) ? size * 0.62 : (r.size || size), font: r.font || o.font || 'sans', weight: r.weight || o.weight || 400, italic: !!r.italic });
    const ws = runs.map(r => measure(r.t, mk(r)) + (r.pad || 0) * 2);
    const total = ws.reduce((s, v) => s + v, 0);
    let cx = o.align === 'left' ? x : o.align === 'right' ? x - total : x - total / 2;
    ctx.save(); ctx.globalAlpha *= clamp(a);
    runs.forEach((r, i) => {
      const f = mk(r), dy = r.sub ? size * 0.28 : r.sup ? -size * 0.36 : 0, ra = r.alpha === undefined ? 1 : r.alpha;
      if (r.bg && ra > 0) { ctx.save(); ctx.globalAlpha *= ra; rrect(cx, y - size * 0.68, ws[i], size * 1.36, size * 0.2, { fill: r.bg }); ctx.restore(); }
      txt(r.t, cx + (r.pad || 0), y + dy, { ...f, color: r.color || o.color || C.ink, align: 'left', alpha: ra });
      if (r.hat) { const mx = cx + ws[i] * 0.56, hy = y - f.size * 0.36, hw = f.size * 0.17; poly([[mx - hw, hy], [mx, hy - f.size * 0.13], [mx + hw, hy]], { color: r.color || o.color || C.ink, w: Math.max(1.5, f.size * 0.045), alpha: ra }); }
      cx += ws[i];
    });
    ctx.restore(); return total;
  }
  function line(x1, y1, x2, y2, o = {}) {
    const p = o.p === undefined ? 1 : clamp(o.p); if (p <= 0) return;
    ctx.save(); if (o.alpha !== undefined) ctx.globalAlpha *= clamp(o.alpha);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(lerp(x1, x2, p), lerp(y1, y2, p));
    ctx.strokeStyle = o.color || C.ink; ctx.lineWidth = o.w || 2; ctx.lineCap = o.cap || 'round'; if (o.dash) ctx.setLineDash(o.dash); ctx.stroke(); ctx.restore();
  }
  function arrow(x1, y1, x2, y2, o = {}) {
    const p = o.p === undefined ? 1 : clamp(o.p); if (p <= 0.001) return;
    const ex = lerp(x1, x2, p), ey = lerp(y1, y2, p), w = o.w || 4, len = Math.hypot(ex - x1, ey - y1);
    const head = Math.min(o.head || w * 4.2, len * 0.6), q = Math.atan2(ey - y1, ex - x1);
    ctx.save(); if (o.alpha !== undefined) ctx.globalAlpha *= clamp(o.alpha);
    ctx.strokeStyle = ctx.fillStyle = o.color || C.ink; ctx.lineWidth = w; ctx.lineCap = 'round'; if (o.dash) ctx.setLineDash(o.dash);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(ex - Math.cos(q) * head * 0.7, ey - Math.sin(q) * head * 0.7); ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(ex - head * Math.cos(q - 0.36), ey - head * Math.sin(q - 0.36)); ctx.lineTo(ex - head * Math.cos(q + 0.36), ey - head * Math.sin(q + 0.36)); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  function circle(x, y, r, o = {}) {
    if (r <= 0) return; ctx.save(); if (o.alpha !== undefined) ctx.globalAlpha *= clamp(o.alpha);
    ctx.beginPath(); ctx.arc(x, y, r, o.a0 || 0, o.a1 === undefined ? TAU : o.a1);
    if (o.fill) { ctx.fillStyle = o.fill; ctx.fill(); }
    if (o.stroke) { ctx.strokeStyle = o.stroke; ctx.lineWidth = o.w || 2; if (o.dash) ctx.setLineDash(o.dash); ctx.stroke(); }
    ctx.restore();
  }
  function rrect(x, y, w, h, r, o = {}) {
    ctx.save(); if (o.alpha !== undefined) ctx.globalAlpha *= clamp(o.alpha);
    ctx.beginPath(); ctx.roundRect(x, y, w, h, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
    if (o.shadow) { const k = ctx.getTransform().a; ctx.shadowColor = o.shadow.color || 'rgba(70,55,30,0.16)'; ctx.shadowBlur = (o.shadow.blur || 36) * k; ctx.shadowOffsetY = (o.shadow.y === undefined ? 10 : o.shadow.y) * k; }
    if (o.fill) { ctx.fillStyle = o.fill; ctx.fill(); ctx.shadowColor = 'transparent'; }
    if (o.stroke) { ctx.strokeStyle = o.stroke; ctx.lineWidth = o.w || 2; if (o.dash) ctx.setLineDash(o.dash); ctx.stroke(); }
    ctx.restore();
  }
  /* Polyline with optional partial reveal p in [0,1] measured along its length. */
  function poly(pts, o = {}) {
    if (pts.length < 2) return; const p = o.p === undefined ? 1 : clamp(o.p); if (p <= 0) return;
    ctx.save(); if (o.alpha !== undefined) ctx.globalAlpha *= clamp(o.alpha);
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    if (p >= 1) { for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); if (o.close) ctx.closePath(); }
    else {
      let total = 0; const seg = []; for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(d); total += d; }
      let left = total * p; for (let i = 1; i < pts.length && left > 0; i++) { const d = seg[i - 1]; const q = d <= left ? 1 : left / d; ctx.lineTo(lerp(pts[i - 1][0], pts[i][0], q), lerp(pts[i - 1][1], pts[i][1], q)); left -= d; }
    }
    if (o.fill) { ctx.fillStyle = o.fill; ctx.fill(); }
    if (o.color !== null) { ctx.strokeStyle = o.color || C.ink; ctx.lineWidth = o.w || 2; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; if (o.dash) ctx.setLineDash(o.dash); ctx.stroke(); }
    ctx.restore();
  }
  const bezPt = (a, b, c, d, u) => { const v = 1 - u; return [v * v * v * a[0] + 3 * v * v * u * b[0] + 3 * v * u * u * c[0] + u * u * u * d[0], v * v * v * a[1] + 3 * v * v * u * b[1] + 3 * v * u * u * c[1] + u * u * u * d[1]]; };
  function curve(a, b, c, d, o = {}) { const pts = []; for (let i = 0; i <= 48; i++) pts.push(bezPt(a, b, c, d, i / 48)); poly(pts, o); }
  // ---- formulas ----
  /* "…$n_{h-1} + \frac{1}{\sqrt 5}$…": what stands between dollar signs is TeX, the rest is ordinary text.
     A formula the build has set with real TeX (TEX.f: glyph outlines, in units of TEX.em to the em) is filled from
     there. Any other, such as one a scene puts together while it runs, is set here from a subset of TeX: scripts,
     \frac, \sqrt, Greek, the common operators and relations, \text. A string is parsed once; it is laid out on
     every call, because a typeface may arrive after the first frame. */
  const bare = o => Object.assign(Object.create(null), o);       // a table that holds no word it was not given
  const TEX = { em: 10, g: [], f: bare({}) }, TEXG = [], TEXP = new Map(), MSEEN = new Map();
  const GREEK = 'alpha α beta β gamma γ delta δ epsilon ε varepsilon ε zeta ζ eta η theta θ vartheta θ iota ι kappa κ lambda λ mu μ nu ν xi ξ pi π rho ρ sigma σ tau τ upsilon υ phi φ varphi φ chi χ psi ψ omega ω Gamma Γ Delta Δ Theta Θ Lambda Λ Xi Ξ Pi Π Sigma Σ Upsilon Υ Phi Φ Psi Ψ Omega Ω'.split(' ');
  /* Atom classes, which decide the spacing as in TeX: 0 ordinary, 1 named function, 2 binary operator, 3 relation,
     4 opening, 5 closing, 6 punctuation, 7 fraction. MGAP[left][right]: 1 thin, a b c thin, medium, thick but not inside scripts. */
  const MGAP = ['01bc000a', '110c000a', 'bb00b00b', 'cc00c00c', '00000000', '01bc000a', 'aa0aaaaa', 'a1bca0aa'];
  const MCMD = bare({}), MCH = { '+': 2, '−': 2, '∗': 2, '=': 3, '<': 3, '>': 3, ':': 3, '(': 4, '[': 4, ')': 5, ']': 5, ',': 6, ';': 6 };
  [[0, 'infty ∞ dots … ldots … cdots ⋯ partial ∂ forall ∀ exists ∃ emptyset ∅ prime ′ ell ℓ'], [1, 'sum ∑ prod ∏'], [2, 'cdot · times × div ÷ pm ± mp ∓ cup ∪ cap ∩'],
    [3, 'le ≤ leq ≤ ge ≥ geq ≥ ne ≠ neq ≠ approx ≈ equiv ≡ sim ∼ to → rightarrow → leftarrow ← Rightarrow ⇒ Leftrightarrow ⇔ in ∈ notin ∉ subset ⊂ subseteq ⊆ ll ≪ gg ≫ propto ∝'],
    [4, 'lfloor ⌊ lceil ⌈ langle ⟨ { {'], [5, 'rfloor ⌋ rceil ⌉ rangle ⟩ } }']].forEach(([c, s]) => s.split(' ').forEach((k, i, a) => { if (i % 2 === 0) { MCMD[k] = [a[i + 1], c]; if (c === 2 || c === 3) MCH[a[i + 1]] = c; } }));
  GREEK.forEach((k, i) => { if (i % 2 === 0) MCMD[k] = [GREEK[i + 1], 0]; });
  const MFN = 'log ln lg min max sin cos tan exp lim gcd deg det mod'.split(' ');
  const MSP = bare({ ',': 3 / 18, ':': 4 / 18, ';': 5 / 18, '!': -3 / 18, ' ': 0.25, quad: 1, qquad: 2 });
  /* TeX source → a list of atoms: { t, c, it } a run of glyphs, { g } a group, { ss, b, sub, sup } scripts on b,
     { n, d } a fraction, { r, idx } a root, { sp } a space in ems. Never throws: what it cannot read it shows as written. */
  function mtex(src, bad) {
    let i = 0;
    const skip = () => { while (/\s/.test(src[i] || '')) i++; };
    const next = () => { const ch = String.fromCodePoint(src.codePointAt(i)); i += ch.length; return ch; };
    const arg = () => { skip(); if (i >= src.length) return []; if (src[i] === '{') { i++; return list(); } const out = []; one(out); return out; };
    const raw = () => { skip(); if (src[i] !== '{') return i < src.length ? next() : ''; let d = 0, j = i; do { d += src[j] === '{' ? 1 : src[j] === '}' ? -1 : 0; j++; } while (d > 0 && j < src.length); const s = src.slice(i + 1, d ? j : j - 1); i = j; return s; };
    function list() { const out = []; while (i < src.length) { if (src[i] === '}') { i++; break; } one(out); } return out; }
    function one(out) {
      const ch = next(), last = out[out.length - 1];
      if (/\s/.test(ch)) return;
      if (ch === '{') return out.push({ g: list(), c: 0 });
      if (ch === '}') return;
      if (ch === '_' || ch === '^') {
        const k = ch === '_' ? 'sub' : 'sup';
        if (last && last.ss && !last[k]) last[k] = arg();
        else { const b = last && last.sp === undefined ? out.pop() : null; out.push({ ss: 1, b, c: b ? b.c : 0, [k]: arg() }); }
        return;
      }
      if (ch === '~') return out.push({ sp: 0.33 });
      if (ch === '\\') {
        const m = /[A-Za-z]+|./suy; m.lastIndex = i; const name = (m.exec(src) || [''])[0]; i += name.length;
        if (/^[dt]?frac$/.test(name)) return out.push({ n: arg(), d: arg(), c: 7 });
        if (name === 'sqrt') { skip(); let idx = null; if (src[i] === '[') { const j = src.indexOf(']', i), e = j < 0 ? src.length : j; idx = mtex(src.slice(i + 1, e), bad); i = e + 1; } return out.push({ r: arg(), idx, c: 0 }); }
        if (/^(text|textbf|mathrm|mathbf|operatorname)$/.test(name)) { const s = raw(); return out.push({ t: name[0] === 't' ? s : s.replace(/\s+/g, ''), c: name[0] === 'o' ? 1 : 0, it: 0, bold: name.endsWith('bf') }); }
        if (name in MSP) return out.push({ sp: MSP[name] });
        if (name === 'left' || name === 'right') { skip(); if (src[i] === '.') i++; return; }
        if (MFN.includes(name)) return out.push({ t: name, c: 1, it: 0 });
        if (MCMD[name]) return out.push({ t: MCMD[name][0], c: MCMD[name][1], it: /[α-ω]/.test(MCMD[name][0]) });
        if (name && '$%&#_|'.includes(name)) return out.push({ t: name, c: 0, it: 0 });
        bad.push('\\' + name); return out.push({ t: '\\' + name, c: 0, it: 0 });
      }
      if (/\d/.test(ch) || (ch === '.' && last && last.num && /\d/.test(src[i] || ''))) { if (last && last.num) last.t += ch; else out.push({ t: ch, c: 0, it: 0, num: 1 }); return; }
      if (/[A-Za-z]/.test(ch)) { if (last && last.run) last.t += ch; else out.push({ t: ch, c: 0, it: 1, run: 1 }); return; }
      const t = ch === '-' ? '−' : ch === '*' ? '∗' : ch === "'" ? '′' : ch;
      out.push({ t, c: MCH[t] || 0, it: /[α-ω]/.test(t) });
    }
    const out = []; while (i < src.length) one(out); return out;
  }
  function mparse(str) {
    let m = MSEEN.get(str); if (m) return m;
    const cut = str.split(/(?<!\\)\$/), odd = cut.length % 2 === 0;
    if (odd) cut.push(cut.splice(-2).join('$'));                 // a dollar sign with no partner stays a dollar sign
    const parts = cut.map((s, i) => { if (i % 2 === 0) return s.replace(/\\\$/g, '$'); const bad = []; return { src: s.trim(), a: mtex(s, bad), bad }; });
    if (MSEEN.size > 3000) MSEEN.clear();
    MSEEN.set(str, m = { parts, odd, math: cut.length > 2 }); return m;
  }
  const ismath = (str, o) => typeof str === 'string' && o.math !== false && str.indexOf('$') >= 0 && mparse(str).math;
  /* A binary operator with nothing to work on, as in −1 or (−x), is a sign and gets no space. Spaces have class −1. */
  function mcls(a) {
    const cl = a.map(n => (n.sp !== undefined ? -1 : n.c || 0)), at = cl.map((c, i) => i).filter(i => cl[i] >= 0);
    at.forEach((i, j) => { if (cl[i] === 2 && ([1, 2, 3, 4, 6].includes(j ? cl[at[j - 1]] : 4) || [3, 5, 6].includes(j + 1 < at.length ? cl[at[j + 1]] : 5))) cl[i] = 0; });
    return cl;
  }
  /* Layout. Every piece is a box { w, a, d, f(x, y, stroke) } on the alphabetic baseline: width, reach above, reach below, how to draw. */
  const MS = [1, 0.7, 0.55], NIL = { w: 0, a: 0, d: 0, f() {} };
  function mglyph(t, S, it, o, bold) {
    const font = fontOf({ size: S, font: o.font, weight: bold ? 700 : o.weight, italic: !!it || !!o.italic });
    ctx.font = font; const m = ctx.measureText(t);
    return { w: m.width, a: Math.max(0, m.actualBoundingBoxAscent), d: Math.max(0, m.actualBoundingBoxDescent), f: (x, y, st) => { ctx.font = font; if (st) ctx.strokeText(t, x, y); else ctx.fillText(t, x, y); } };
  }
  function mrow(a, lv, o) {
    const S = (o.size || 36) * MS[lv], cl = mcls(a), kids = []; let x = 0, up = 0, dn = 0, prev = -1;
    a.forEach((n, i) => {
      if (cl[i] >= 0) { const g = prev < 0 ? '0' : MGAP[prev][cl[i]]; x += S * (g === '1' || (g === 'a' && !lv) ? 3 : g === 'b' && !lv ? 4 : g === 'c' && !lv ? 5 : 0) / 18; prev = cl[i]; }
      const b = mbox(n, lv, o); kids.push([b, x]); x += b.w; up = Math.max(up, b.a); dn = Math.max(dn, b.d);
    });
    return { w: x, a: up, d: dn, f: (X, Y, st) => { for (const [b, dx] of kids) b.f(X + dx, Y, st); } };
  }
  function mbox(n, lv, o) {
    const S = (o.size || 36) * MS[lv], k = Math.min(lv + 1, 2), s = (o.size || 36) * MS[k], th = Math.max(1.5, S * 0.055);
    if (n.sp !== undefined) return { ...NIL, w: n.sp * S };
    if (n.g) return mrow(n.g, lv, o);
    if (n.n) {
      const N = mrow(n.n, k, o), D = mrow(n.d, k, o), pad = S * 0.08, w = Math.max(N.w, D.w) + pad * 2, ax = S * 0.27, gap = S * 0.11;
      const ny = ax + th / 2 + gap + N.d, dy = -ax + th / 2 + gap + Math.max(D.a, s * 0.7);
      return { w, a: ny + N.a, d: dy + D.d, f: (x, y, st) => { N.f(x + (w - N.w) / 2, y - ny, st); D.f(x + (w - D.w) / 2, y + dy, st); if (!st) ctx.fillRect(x + pad * 0.4, y - ax - th / 2, w - pad * 0.8, th); } };
    }
    if (n.r) {
      const R = mrow(n.r, lv, o), I = n.idx ? mrow(n.idx, 2, o) : NIL, top = Math.max(R.a, S * 0.5) + S * 0.1 + th, bot = Math.max(R.d, S * 0.04), x0 = Math.max(0, I.w - S * 0.2), rw = S * 0.5;
      return { w: x0 + rw + R.w + S * 0.06, a: Math.max(top, top * 0.5 + I.a), d: bot, f: (x, y, st) => {
        R.f(x + x0 + rw, y, st); I.f(x, y - top * 0.5, st); if (st) return;
        ctx.save(); ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = th; ctx.lineJoin = 'miter'; ctx.lineCap = 'butt'; ctx.setLineDash([]); ctx.beginPath();
        ctx.moveTo(x + x0 + S * 0.03, y - top * 0.4); ctx.lineTo(x + x0 + S * 0.13, y - top * 0.48); ctx.lineTo(x + x0 + S * 0.27, y + bot - th / 2);
        ctx.lineTo(x + x0 + rw - S * 0.05, y - top + th / 2); ctx.lineTo(x + x0 + rw + R.w + S * 0.04, y - top + th / 2); ctx.stroke(); ctx.restore();
      } };
    }
    if (n.ss) {
      const B = n.b ? mbox(n.b, lv, o) : NIL, P = n.sup ? mrow(n.sup, k, o) : null, Q = n.sub ? mrow(n.sub, k, o) : null;
      let up = Math.max(S * 0.38, B.a - s * 0.34), dn = Math.max(S * 0.2, B.d + s * 0.08);
      if (P && Q) { const lack = S * 0.12 - (up - P.d + dn - Q.a); if (lack > 0) { up += lack * 0.4; dn += lack * 0.6; } }
      const ic = n.b && n.b.it ? S * 0.05 : 0;
      return { w: B.w + Math.max(P ? P.w + ic : 0, Q ? Q.w : 0) + S * 0.03, a: Math.max(B.a, P ? up + P.a : 0), d: Math.max(B.d, Q ? dn + Q.d : 0), f: (x, y, st) => { B.f(x, y, st); if (P) P.f(x + B.w + ic, y - up, st); if (Q) Q.f(x + B.w, y + dn, st); } };
    }
    return mglyph(n.t, S, n.it, o, n.bold);
  }
  /* Computer Modern looks small and thin beside the sans text at the same size: set it a little larger, and thicken it where the text is medium or bold. */
  const TEXK = 1.16;
  /* The outline of a formula the build has set. Its box rides along as P.box for whoever wants to know where it lands. */
  function mpath(src, e) {
    let P = TEXP.get(src); if (P) return P;
    P = new Path2D();
    for (let i = 0; i < e[3].length; i += 3) P.addPath(TEXG[e[3][i]] || (TEXG[e[3][i]] = new Path2D(TEX.g[e[3][i]])), { e: e[3][i + 1], f: e[3][i + 2] });
    for (let i = 0; i < e[4].length; i += 4) P.rect(e[4][i], e[4][i + 1], e[4][i + 2], e[4][i + 3]);
    P.box = [0, -e[1], e[0], e[2], TEX.em]; TEXP.set(src, P); return P;
  }
  /* The distance from the line that textBaseline names down to the alphabetic baseline, in the current font. */
  const mdrop = () => { const up = () => ctx.measureText('H').actualBoundingBoxAscent, a = up(); ctx.textBaseline = 'alphabetic'; return up() - a; };
  function mline(str, o) {
    const size = o.size || 36, s = size * TEXK / TEX.em, kids = []; let x = 0, up = 0, dn = 0;
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    for (const p of mparse(str).parts) {
      const e = typeof p === 'string' ? null : TEX.f[p.src];
      const b = typeof p === 'string' ? (p ? mglyph(p, size, 0, o) : NIL) : !e ? mrow(p.a, 0, o) : { w: e[0] * s, a: e[1] * s, d: e[2] * s, f: (X, Y, st) => {
        const P = mpath(p.src, e); ctx.save(); ctx.translate(X, Y); ctx.scale(s, s); if (st) { ctx.lineWidth /= s; ctx.stroke(P); } else { ctx.fill(P); if ((o.weight || 400) >= 500) { ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = TEX.em * 0.022; ctx.lineJoin = 'round'; ctx.setLineDash([]); ctx.stroke(P); } } ctx.restore();
      } };
      kids.push([b, x]); x += b.w; up = Math.max(up, b.a); dn = Math.max(dn, b.d);
    }
    return { w: x, a: up, d: dn, f: (X, Y, st) => { for (const [b, dx] of kids) b.f(X + dx, Y, st); } };
  }
  /* A formula as plain text. say = false: for subtitle files and labels, with Unicode scripts where they exist (nₕ₋₁, x²)
     and A_L, 2^(h+3) where they do not. say = true: the way it is read aloud in Chinese, for the voice and for timing. */
  const MLOW = ['0123456789+−=()aehijklmnoprstuvx', '₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₐₑₕᵢⱼₖₗₘₙₒₚᵣₛₜᵤᵥₓ'], MHIGH = ['0123456789+−=()ni', '⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱ'];
  const MSAY = bare({ '=': '等于', '+': '加', '−': '减', '·': '乘', '×': '乘', '∗': '乘', '÷': '除以', '/': '除以', '±': '正负', '≤': '小于等于', '≥': '大于等于', '≠': '不等于', '≈': '约等于', '≡': '恒等于', '<': '小于', '>': '大于', '≪': '远小于', '≫': '远大于',
    '→': '到', '∞': '无穷', '∈': '属于', '∉': '不属于', '∑': '求和', '∏': '连乘', '…': '等等', '⋯': '等等', '′': '撇', '⌊': '', '⌋': '下取整', '⌈': '', '⌉': '上取整', '|': '' });
  GREEK.forEach((k, i) => { if (i % 2 === 0 && !MSAY[GREEK[i + 1]]) MSAY[GREEK[i + 1]] = k; });
  function mflat(a, say, deep) {
    const cl = mcls(a), tight = s => (/^[^\s+−=<>≤≥≠≈·×÷±/,]+$/u.test(s) ? s : `(${s})`);       // brackets only around what would otherwise read wrong
    const script = (s, [from, to], mark) => (s === '' ? '' : [...s].every(ch => from.includes(ch)) ? [...s].map(ch => to[from.indexOf(ch)]).join('') : mark + tight(s));
    const parts = a.map((n, i) => {
      if (n.sp !== undefined) return n.sp >= 0.9 ? ' ' : '';
      if (n.g) return mflat(n.g, say, deep);
      if (n.n) { const N = mflat(n.n, say, true), D = mflat(n.d, say, true); return say ? `${D}分之${N}` : `${tight(N)}/${tight(D)}`; }
      if (n.r) { const R = mflat(n.r, say, true), I = n.idx ? mflat(n.idx, say, true) : ''; return say ? `${I && I + '次'}根号${R}` : `${script(I, MHIGH, '')}√${tight(R)}`; }
      if (n.ss) {
        const B = n.b ? mflat([n.b], say, deep) : '', P = n.sup ? mflat(n.sup, say, true) : '', Q = n.sub ? mflat(n.sub, say, true) : '';
        if (say && n.b && (n.b.t === '∑' || n.b.t === '∏')) return `${B}${Q && '从' + Q}${P && '到' + P}`;
        return say ? `${B} ${Q}${P === '2' ? '的平方' : P === '3' ? '的立方' : P === '′' ? '撇' : P ? `的${P}次方` : ''}` : B + script(Q, MLOW, '_') + script(P, MHIGH, '^');
      }
      const t = n.t.replace(/^\\(?=.)/, '');
      if (say) return n.t === '−' && cl[i] === 0 ? '负' : n.t === '+' && cl[i] === 0 ? '正' : MSAY[n.t] === undefined ? t : MSAY[n.t];
      return t;
    });
    if (say) return parts.filter(Boolean).join(' ').replace(/ *([^\x00-\x7F]+|[(),;]) */g, '$1');
    let out = '', p = -1;                                        // spaces where TeX leaves some: around = and +, after a comma, after log
    parts.forEach((s, i) => { const c = cl[i]; if (s === '') return; if (out && p >= 0 && c >= 0 && ((!deep && (p === 2 || p === 3 || c === 2 || c === 3)) || p === 6 || (p === 1 && [0, 1, 7].includes(c)) || (c === 1 && [0, 5, 7].includes(p)))) out += ' '; out += s; p = c; });
    return out;
  }
  const mtext = (str, say) => (typeof str === 'string' && str.indexOf('$') >= 0 ? mparse(str).parts.map(p => (typeof p === 'string' ? p : mflat(p.a, say))).join('') : str);
  const plain = str => mtext(str, false), spoken = str => mtext(str, true);
  /* What the build needs to know about a string: its formulas, the commands the subset does not know, a dollar sign left over. */
  /* A scene that makes up its strings as it runs (numbers filled in from data) names them here while it loads.
     The build runs the scene files once to hear this, and sets those formulas with TeX as well. */
  const needs = [], need = (...list) => { for (const s of list.flat(Infinity)) if (typeof s === 'string' && s.indexOf('$') >= 0 && !needs.includes(s)) needs.push(s); };
  const math = str => { const m = mparse(String(str)); return { odd: m.odd, parts: m.parts.filter(p => typeof p !== 'string').map(p => ({ src: p.src, bad: p.bad })) }; };

  // ---- narration timeline ----
  /* Each line of narration owns a slot: its spoken length, then a pause.
     Spoken length is the measured voice-over clip when one exists (durations[key]), else an estimate
     from the text (a formula counts as the words it is read with, not as its TeX source), so scenes can be
     written and previewed before anything is recorded.
     Line options: gap = pause after the line; min = the least time the line's visuals need,
     which stretches the pause when the voice turns out shorter than the picture.
     Scene options: pre / post = empty time before the first and after the last line, none where two scenes run on; join (below). */
  function speakUnits(s) {
    let u = 0;
    for (const ch of s) {
      const c = ch.codePointAt(0);
      if (/[，、；：]/.test(ch)) u += 0.9; else if (/[。？！…]/.test(ch)) u += 0.5; else if (/[“”‘’（）《》「」—]/.test(ch)) u += 0;
      else if (c > 0x2E80) u += 1; else if (/[A-Za-z]/.test(ch)) u += 0.4; else if (/[0-9]/.test(ch)) u += 1.4; else if (ch === '%') u += 3; else if (ch === '.') u += 1; else u += 0.15;
    }
    return u;
  }
  const RATE = 4.7;
  /* Where in a line a few of its words fall, as a share of the line's spoken length: 0 at its first sound, 1 at its last.
     end = false: where the words begin; true: where they end. -1 when the line does not hold them.
     An estimate from the count of sounds before them, good to a few tenths of a second when the voice reads the caption itself. */
  function share(text, part, end) {
    const i = text.indexOf(part); if (i < 0 || part === '') return -1;
    const u = s => speakUnits(spoken(s)), all = u(text);
    return all > 0 ? u(text.slice(0, end ? i + part.length : i)) / all : 0;
  }
  /* What a caption shows of its line (cue.show): the comma or full stop that closes the line is left off; a question mark,
     an ellipsis, and a closing quote or bracket after the stop all stay. The voice and the timing go by the whole line (cue.text). */
  const shown = s => s.replace(/(?:[，。、；：,;:]|(?<!\.)\.)+(?=[”’」』）)》】\]"']*\s*$)/, '');
  /* Voice-over language (LESSON.dub). Captions are Chinese and so is the voice unless a film says otherwise: it reads the
     caption itself. For another language it reads a translation of each line. pace = how much longer that translation runs
     than the Chinese line would (measured on examples/heap-intro), used only for the estimate. */
  const DUB = { zh: { name: '中文', pace: 1 }, ja: { name: '日语', pace: 1.3 }, en: { name: '英语', pace: 1.05 } }, DUB_DEFAULT = 'zh';
  function buildTimeline(script, durations = {}, dub = DUB_DEFAULT) {
    const pace = DUB[dub].pace;
    const T = {}, cues = [], scenes = []; let t = 0;
    // Inside an act the scenes run on: no pause, no fade. A scene that opens an act (it has a chapter name) fades in after a pause.
    // join: true on a scene makes it run on from the one before whatever it opens; join: false makes it fade.
    const joins = script.map((sc, i) => i > 0 && (sc.join === undefined ? !sc.chapter : !!sc.join));
    script.forEach((sc, i) => {
      const s0 = t; t += sc.pre === undefined ? (joins[i] ? 0 : 0.9) : sc.pre;
      for (const [key, text, o = {}] of sc.lines) {
        if (T[key]) throw new Error('duplicate caption key: ' + key);
        const voiced = durations[key] !== undefined;
        const d = voiced ? durations[key] : o.d !== undefined ? o.d : Math.max(1.25, speakUnits(o.tts || spoken(text)) / RATE * pace + 0.25);
        const gap = o.gap === undefined ? 0.32 : o.gap;
        const s = t, e = t + d; T[key] = { s, e, text: text || '' }; if (text) cues.push({ key, s, e, text, show: shown(text), scene: sc.id, voiced });
        t = e + Math.max(gap, (o.min || 0) - d);
      }
      t += sc.post === undefined ? (joins[i + 1] ? 0 : 1.1) : sc.post;
      scenes.push({ id: sc.id, title: sc.title, no: sc.no, chapter: sc.chapter || '', s: s0, e: t, join: joins[i] });      // a scene with a chapter name opens a segment
    });
    // A scene that runs on picks up the previous scene's final picture, so the pair cuts without a fade.
    scenes.forEach((sc, i) => { sc.fadeIn = sc.join ? 0 : 0.7; sc.fadeOut = scenes[i + 1] && scenes[i + 1].join ? 0 : 0.6; });
    return { T, cues, scenes, duration: t };
  }

  return { W, H, SAFE, C, CAT, THEMES, setTheme, FONT, TAU, rad, setCtx, get ctx() { return ctx; }, clamp, lerp, ease, easeOut, easeBack, rng, rgba, mixc, alpha, txt, measure, extent, rich, line, arrow, circle, rrect, poly, bezPt, curve, fontOf,
    math, plain, spoken, need, needs, tex: d => { TEX.em = d.em; TEX.g = d.g; TEX.f = bare(d.f); TEXG.length = 0; TEXP.clear(); }, buildTimeline, speakUnits, share, DUB, DUB_DEFAULT, SCENES: {} };
})();
