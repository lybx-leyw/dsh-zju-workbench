'use strict';
/* Player: owns the clock, dispatches scenes, draws captions, wires the controls. It makes no sound.
   Expects globals from the bundle: V (engine), SCRIPT, and optionally LESSON, DURATIONS, AUDIO, SPOKEN.
   An optional external reader may show the film in a frame and control it
   through window.film, at the end of this file: it has the texts in SPOKEN read aloud ({ zh: { key: text }, ja: … }),
   gives back each line's real length (retime) and keeps the clock out of the lines whose sound has not come (gate).
   Opened by itself the film plays silent, on the lengths it was built with: DURATIONS where given, else estimates. */
(() => {
  const { W, H, C, clamp, ease } = V;
  const EMBED = { dur: typeof DURATIONS === 'undefined' ? {} : DURATIONS, clips: typeof AUDIO === 'undefined' ? {} : AUDIO };   // embedded clips speak BASE
  const BASE = typeof LESSON !== 'undefined' && LESSON.dub || V.DUB_DEFAULT;
  let TL = V.buildTimeline(SCRIPT, EMBED.dur, BASE), DURATION = TL.duration;
  const need = key => { const c = TL.T[key]; if (!c) throw new Error('unknown caption key: ' + key); return c; };
  V.TL = TL; V.t = 0;
  // at(key) / en(key): when a line starts and ends. at(key, '几个字') / en(key, '几个字'): when the voice reaches those words of the line
  // and when it has said them, estimated from where they stand in the caption (V.share).
  const moment = (key, part, end) => {
    const c = need(key); if (typeof part !== 'string') return end ? c.e : c.s;
    const k = V.share(c.text, part, end); if (k < 0) throw new Error(`句子 ${key} 里没有“${part}”`);
    return c.s + (c.e - c.s) * k;
  };
  V.at = (key, part) => moment(key, part, false);
  V.en = (key, part) => moment(key, part, true);

  const $ = id => document.getElementById(id);
  const canvas = $('film'), ctx = canvas.getContext('2d'), stage = $('stage'), player = $('player');
  const seek = $('seek'), playButton = $('play'), elapsed = $('elapsed'), total = $('total'), chaptersEl = $('chapters');
  V.setCtx(ctx);
  stage.style.background = C.bg;
  const clock = t => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

  // chapters
  const chapters = SCRIPT.filter(s => s.chapter).map(s => ({ title: s.chapter, id: s.id, s: 0 }));
  chapters.forEach(c => { const b = document.createElement('button'); b.type = 'button'; b.className = 'chapter'; b.innerHTML = `<span></span>${c.title}`; b.addEventListener('click', () => { setTime(c.s + 0.05); }); chaptersEl.appendChild(b); c.el = b; });
  // the chapters stand in a column left of the picture. In a narrow window they are a strip under it instead: titles that do not fit
  // are not cut short, the strip scrolls sideways, and an ordinary mouse wheel turns it until it reaches an end
  chaptersEl.addEventListener('wheel', e => { const to = clamp(chaptersEl.scrollLeft + e.deltaY, 0, chaptersEl.scrollWidth - chaptersEl.clientWidth); if (e.deltaX || Math.abs(to - chaptersEl.scrollLeft) < 1) return; e.preventDefault(); chaptersEl.scrollLeft = to; }, { passive: false });
  // everything on the page that shows a time read off the timeline
  function layout() {
    total.textContent = clock(DURATION); seek.max = DURATION.toFixed(2);
    chapters.forEach(c => { c.s = TL.scenes.find(x => x.id === c.id).s; c.el.firstChild.textContent = clock(c.s); });
  }
  layout();

  let width = W, height = H, dpr = 1, unit = 1, ox = 0, oy = 0;
  let time = 0, playing = false, captionsOn = true, lastFrame = null, rate = 1;
  let gate = null, holding = false;                     // the reader's: a moment the clock may not pass, and whether it is waiting there

  /* The reader has a line's real length in place of an estimate, or its voice now speaks another language, so
     every later moment moves. Keep the playhead on the same spot of the caption it is in (or of the pause after it). */
  function retime(durations, lang) {
    const at = [...TL.cues].reverse().find(c => c.s <= time);
    const inPause = at && time >= at.e, off = at ? time - (inPause ? at.e : at.s) : 0;
    TL = V.buildTimeline(SCRIPT, durations, V.DUB[lang] ? lang : BASE); DURATION = TL.duration; V.TL = TL;
    if (at) { const c = TL.T[at.key]; time = Math.min(DURATION, inPause ? c.e + off : Math.min(c.s + off, c.e - 0.01)); }
    for (const id in layers) if (V.SCENES[id].retime) V.SCENES[id].retime();
    layout(); render(time);
  }

  function caption(t) {
    const cues = TL.cues; let cue = null;
    for (let i = 0; i < cues.length; i++) { const c = cues[i], nx = cues[i + 1]; const hold = nx && nx.s - c.e < 0.7 ? nx.s : c.e + 0.25; if (t >= c.s && t < hold) { cue = c; break; } }
    if (!cue) return '';
    if (captionsOn && cue.show) {
      const a = clamp((t - cue.s) / 0.12), o = { size: 42, font: 'sans', weight: 500 };
      let e = V.extent(cue.show, o);
      // One line on a fixed baseline. The plate grows with a tall formula but keeps out of V.SAFE; a line too wide or too tall is set smaller.
      const lo = V.SAFE.y1 + 12, hi = H - 16, k = Math.min(1, (W - 188) / e.w, (hi - lo) / (e.up + e.down));
      if (k < 1) { o.size = Math.floor(o.size * k); e = V.extent(cue.show, o); }
      const y = Math.max(lo + e.up, Math.min(1003, hi - e.down));    // a tall formula moves the baseline inside the strip before anything is set smaller
      const top = Math.min(y - 42, y - e.up - 10), bottom = Math.max(y + 38, y + e.down + 10);
      V.rrect(W / 2 - e.w / 2 - 34, top, e.w + 68, bottom - top, 16, { fill: V.rgba(C.paper, 0.92), alpha: a });
      V.txt(cue.show, W / 2, y, { ...o, color: C.ink, alpha: a });
    }
    return V.plain(cue.show);
  }
  /* A scene is a function that draws on the canvas, or it brings its own layer: V.SCENES.id = { mount(el), draw(t), retime() }.
     el is a 1920×1080 box under the canvas, scaled with the picture, for whatever the scene draws with (DOM, SVG, a canvas
     of its own, a WebGL renderer). mount(el) runs once, the first time the scene is on; draw(t) on every frame and every seek
     while it is on, and must leave the layer as it is at t; retime() after the captions' times have moved. */
  const layers = {};
  const place = el => { el.style.transform = `translate(${ox}px,${oy}px) scale(${unit})`; };
  function layer(id, scene, on) {
    let el = layers[id];
    if (!el) { if (!on) return; el = layers[id] = Object.assign(document.createElement('div'), { className: 'layer' }); stage.insertBefore(el, canvas); place(el); if (scene.mount) scene.mount(el); }
    el.style.display = on ? 'block' : 'none';
  }
  function render(t) {
    V.t = t;
    // The canvas is see-through: the stage under it carries the film's ground colour, and a scene that brings its own layer
    // shows from under the captions. Where the stage is not 16:9 (full screen, the reader's window) the picture is fitted
    // into it whole and centred, and the room left over beside it is that same ground: the drawing is cut off at the picture's edge.
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr * unit, 0, 0, dpr * unit, ox * dpr, oy * dpr);
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
    ctx.clearRect(0, 0, W, H);
    for (const sc of TL.scenes) {
      const on = !(t < sc.s || t >= sc.e && sc.e < DURATION), scene = V.SCENES[sc.id], own = !!scene && typeof scene !== 'function';
      if (own) layer(sc.id, scene, on);
      if (!on) continue;
      const a = (sc.fadeIn ? ease((t - sc.s) / sc.fadeIn) : 1) * (sc.fadeOut ? 1 - ease((t - (sc.e - sc.fadeOut)) / sc.fadeOut) : 1);
      ctx.save(); ctx.globalAlpha = a;
      try { if (own) { layers[sc.id].style.opacity = a; scene.draw(t); } else (scene || (() => V.txt('[' + sc.id + ']', W / 2, H / 2, { size: 60, color: C.faint })))(t); }
      catch (err) { ctx.restore(); ctx.save(); V.txt(String(err.message), W / 2, 80, { size: 30, color: '#b00' }); if (!render.warned) { render.warned = true; console.error(err); } document.documentElement.dataset.filmError = String(err.message); }
      if (sc.no) { V.txt(sc.no, 84, 70, { size: 26, color: C.accent, align: 'left', ls: 2 }); V.line(128, 70, 164, 70, { color: C.hair, w: 2 }); V.txt(sc.title, 180, 71, { size: 26, color: C.mute, align: 'left' }); }
      ctx.restore();
    }
    const text = caption(t);
    if (holding) { const note = '正在准备配音…', w = V.measure(note, { size: 30 }) + 60; V.rrect(W - 90 - w, 42, w, 56, 28, { fill: V.rgba(C.paper, 0.92) }); V.txt(note, W - 90 - w / 2, 71, { size: 30, color: C.mute }); }
    ctx.restore();
    canvas.setAttribute('aria-label', text || '动画画面');
    elapsed.textContent = clock(t); seek.value = t; seek.style.setProperty('--p', (t / DURATION * 100) + '%');
    let cur = 0; chapters.forEach((c, i) => { if (t >= c.s - 0.01) cur = i; });
    chapters.forEach((c, i) => { const on = String(i === cur); if (c.el.getAttribute('aria-current') !== on) { c.el.setAttribute('aria-current', on); if (i === cur) chaptersEl.scrollTo({ left: c.el.offsetLeft - chaptersEl.offsetLeft - (chaptersEl.clientWidth - c.el.offsetWidth) / 2, top: c.el.offsetTop - chaptersEl.offsetTop - (chaptersEl.clientHeight - c.el.offsetHeight) / 2, behavior: 'smooth' }); } });   // the list turns to the segment being played; the page itself stays put
    document.documentElement.dataset.filmTime = t.toFixed(3);
  }
  function resize() {
    const box = stage.getBoundingClientRect(); width = box.width; height = box.height;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    unit = Math.min(width / W, height / H); ox = (width - W * unit) / 2; oy = (height - H * unit) / 2;
    for (const id in layers) place(layers[id]);
    render(time);
  }
  function setPlaying(v) { playing = v; lastFrame = null; if (!v && holding) { holding = false; render(time); } playButton.setAttribute('aria-pressed', String(v)); playButton.setAttribute('aria-label', v ? '暂停' : '播放'); $('play-label').textContent = v ? '暂停' : time >= DURATION ? '重看' : '播放'; }
  function setTime(v) { time = clamp(Number(v) || 0, 0, DURATION); lastFrame = null; if (time >= DURATION) setPlaying(false); render(time); }
  function toggle() { if (time >= DURATION) setTime(0); setPlaying(!playing); }
  /* Giving the picture everything there is. 'page' (网页全屏): it fills the window the film is in. 'screen' (全屏): the whole screen
     as well, by the Fullscreen API. Both are one look, html.full in the stylesheet: the picture alone, the controls laid over its
     bottom edge. The captions are down there too, so the controls stay away unless the pointer comes down to them (html.near), and
     a pointer left alone for a while is put away with them (html.still). The reader app watches for html.full to hand the film its
     whole window. */
  const root = document.documentElement, controls = player.querySelector('.controls');
  let full = '', rest = 0, over = false, spot = '';      // over: the pointer was last seen on the controls, which then stay; spot: where on the screen it was
  const letGo = () => { if (controls.contains(document.activeElement)) document.activeElement.blur(); };   // a button out of sight must not be what the space bar presses
  function stir(near) {
    root.classList.remove('still'); root.classList.toggle('near', near); clearTimeout(rest);
    rest = setTimeout(() => { if (over) return; root.classList.add('still'); root.classList.remove('near'); letGo(); }, 2500);
  }
  async function setFull(mode) {
    const show = () => { root.classList.toggle('full', !!full); $('wide').setAttribute('aria-pressed', String(full === 'page')); $('fullscreen').setAttribute('aria-pressed', String(full === 'screen')); };
    full = mode; show(); letGo();                         // the look first: the screen, when it comes, opens on the picture and not on the page
    over = false;                                         // everything has moved under the pointer: where it is now is not known until it stirs
    if (full) stir(true); else { clearTimeout(rest); root.classList.remove('near', 'still'); }
    try { if (mode === 'screen') await root.requestFullscreen(); else if (document.fullscreenElement) await document.exitFullscreen(); }
    catch (e) { if (full === 'screen') { full = 'page'; show(); } }   // refused, or a browser without it (an iPhone): the window is the most there is
  }
  // the controls come for a pointer on them (or on a menu of theirs) or near the bottom edge; a finger has no hovering, so any touch brings them
  const stirred = e => {
    if (!full) return;
    const at = e.screenX + ',' + e.screenY, same = at === spot; spot = at;
    if (same && e.type === 'pointermove') return;         // the browser also reports a move when it is the page that moved under a pointer at rest
    over = controls.contains(e.target); stir(over || e.pointerType !== 'mouse' || e.clientY > innerHeight - controls.offsetHeight - 40);
  };
  document.addEventListener('pointermove', stirred);
  document.addEventListener('pointerdown', stirred);
  root.addEventListener('pointerleave', () => { if (full) { over = false; stir(false); } });   // gone from the window
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && full === 'screen') setFull('');                    // Esc, or whatever else took the screen back
    else if (document.fullscreenElement && full !== 'screen') document.exitFullscreen();   // called off while the screen was still being taken
  });

  playButton.addEventListener('click', toggle);
  canvas.addEventListener('click', toggle);
  $('replay').addEventListener('click', () => { setTime(0); setPlaying(true); });
  seek.addEventListener('input', () => setTime(seek.value));
  $('speed').addEventListener('change', e => { rate = Number(e.target.value); lastFrame = null; });
  $('captions').addEventListener('click', e => { captionsOn = !captionsOn; e.currentTarget.setAttribute('aria-pressed', String(captionsOn)); render(time); });
  $('wide').addEventListener('click', () => setFull(full === 'page' ? '' : 'page'));
  $('fullscreen').addEventListener('click', () => setFull(full === 'screen' ? '' : 'screen'));
  document.addEventListener('keydown', e => {
    if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName) && e.target !== seek) return;
    const k = e.code;
    if (k === 'Space' && e.target.tagName !== 'BUTTON') { e.preventDefault(); toggle(); }
    else if (k === 'ArrowRight') { e.preventDefault(); setTime(time + (e.shiftKey ? 1 : 5)); }
    else if (k === 'ArrowLeft') { e.preventDefault(); setTime(time - (e.shiftKey ? 1 : 5)); }
    else if (k === 'KeyF') $('fullscreen').click();
    else if (k === 'KeyW') $('wide').click();
    else if (k === 'Escape' && full === 'page') setFull('');
    else if (k === 'KeyC') $('captions').click();
    else if (k === 'Home') setTime(0);
  });
  document.addEventListener('visibilitychange', () => { lastFrame = null; });
  new ResizeObserver(resize).observe(stage);

  const params = new URLSearchParams(location.search);
  if (params.get('bare') === '1') document.body.classList.add('bare');
  time = clamp(Number(params.get('t')) || 0, 0, DURATION); resize();
  setPlaying(params.get('autoplay') === '1');
  function tick(now) {
    if (playing && !document.hidden) {
      let next = lastFrame === null ? time : Math.min(DURATION, time + Math.min(now - lastFrame, 250) / 1000 * rate);
      // never run past the reader's gate, the start of a line whose voice has not arrived: wait there until it moves
      holding = gate !== null && next >= gate;
      if (holding) next = Math.min(next, Math.max(time, gate));
      time = next; lastFrame = now; render(time); if (time >= DURATION) setPlaying(false);
    } else lastFrame = null;
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => render(time));
  // Handle for inspection, frame capture and the reader app: film.seek(t) renders exactly that frame; redraw() paints the current
  // frame again, for when a typeface arrives after the first paint. The rest is what the reader voices the film with.
  // texts = what the voice reads for each line, in every language the film carries; base = the language it was built for;
  // audio / durations = the clips embedded at build time, which speak base, and their lengths; rate = the speed being played at.
  // retime(durations, lang) lays the timeline out again: real lengths (key → seconds) where given, else estimated at lang's pace.
  // gate = a moment the clock may not pass, null for none; holding = playing, and waiting at the gate.
  window.film = { get time() { return time; }, get duration() { return DURATION; }, get playing() { return playing; }, get timeline() { return TL; }, seek: setTime, play: () => setPlaying(true), pause: () => setPlaying(false),
    redraw: () => render(time), plain: s => V.plain(s), texts: typeof SPOKEN === 'undefined' ? {} : SPOKEN, base: BASE, audio: EMBED.clips, durations: EMBED.dur, get rate() { return rate; }, retime,
    get gate() { return gate; }, set gate(t) { gate = typeof t === 'number' ? t : null; }, get holding() { return holding; } };
})();
