/**
 * 组件里的 **hooks 顺序**：任何 `useXxx()` 都不许出现在提前 `return` 之后。
 *
 * # 这条测试守的是真实故障
 *
 * 「插件」页（`dsh-zhiyun-page-plugins`）在加「吃灰」一栏时，把 `useUsageRows`
 * 写在了两个提前 return 之后。这一页的运行期顺序恰好是：
 *
 *   1. 挂载 → `status: 'idle'` / `view: null` → 走第一个 return，渲染「正在读取…」
 *      （此时只调用了 3 个 hook）；
 *   2. 读到依赖图 → 同一个 `Panel` 实例重渲染 → 走到正文，多出 2 个 `useMemo`
 *      （第 4、5 个 hook）。
 *
 * React 对此的原话是 `Rendered more hooks than during the previous render.`。
 * 宿主 slot 的错误边界随后把整页换成空节点 —— 用户看到的是**侧栏点「插件」
 * 什么也没有**，而当时所有闸都是绿的：
 *
 *   - `tests/plugins-page.test.mjs` 测的是 `runtime.js` 的纯函数，不渲染 React；
 *   - `scripts/build.mjs` 成功（esbuild 只看语法）；
 *   - 现有渲染测试（`planning-render.test.mjs`）用的是 `renderToStaticMarkup`，
 *     **只渲染一次**，天然看不见「两次渲染之间」的差异。
 *
 * # 为什么是静态扫描，而不是再渲染一次
 *
 * 要真渲染两次同一组件，得有能 rerender 的渲染器（jsdom + react-dom/client 或
 * react-test-renderer）—— 本仓两个都没装，而 `renderToStaticMarkup` 做不到。
 * 而这条规则本身是**纯粹的语法约束**，扫描源码就能判定，且不引入任何依赖。
 *
 * 扫描器自己也要有牙：末尾那条用「修复前的形状」做夹具，证明它确实会报；
 * 否则一个永远返回空数组的扫描器也能让上面所有断言变绿。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

/** 一个 hook 调用：`useState(`、`useMemo(`、`useSyncExternalStore(` …… 但不含 `use-foo(`。 */
const HOOK_PREFIX = /^use[A-Z]\w*$/;

/**
 * 把注释与字符串/模板/正则字面量抹成等长的空格，保留换行与位置。
 *
 * 只需要做到「不会把字符串里的 `return`、注释里的 `})` 当成代码」，不做完整词法。
 * @param source - 原始源码。
 * @returns 同长度的遮罩文本。
 */
function maskNonCode(source) {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') { out += ' '; i += 1; }
      continue;
    }
    if (ch === '/' && next === '*') {
      out += '  ';
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        out += source[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      out += '  ';
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      out += ' ';
      i += 1;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\') { out += '  '; i += 2; continue; }
        out += source[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      out += ' ';
      i += 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * `function name(...) {` 里**函数体**的那个 `{`。
 *
 * 从 `(` 起配平参数表（解构参数里也有花括号），第一个 `)` 归零之后的第一个 `{`
 * 才是函数体。
 * @param code - 已遮罩的源码。
 * @param from - 函数名之后那个 `(` 的位置。
 * @returns 函数体 `{` 的下标，找不到时 -1。
 */
function bodyOpenAfterParams(code, from) {
  const open = code.indexOf('(', from);
  if (open < 0) return -1;
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === '(') depth += 1;
    else if (code[i] === ')') {
      depth -= 1;
      if (depth === 0) {
        const brace = code.indexOf('{', i);
        return brace;
      }
    }
  }
  return -1;
}

/**
 * 找出每个组件里「渲染路径上的提前 return 之后」出现的 hook 调用。
 *
 * 判定分两件事：
 *  1. **渲染路径**：组件的函数体直接那一层。`useEffect(() => { … })` 之类回调里的代码
 *     在嵌套函数体内，不是渲染路径 —— 那里的 hook 是另一类错误，不在这条规则里。
 *     提前 return 写在 `if { … }` 里仍然是渲染路径上的 return，所以判据是「有没有
 *     进入嵌套函数」而不是括弧深度（第一版按括弧深度判，于是 `if` 块里的 return
 *     一个都认不出来，扫描器静默返回空 —— 被「扫描器有牙」那条夹具抓出来的）。
 *  2. **先后**：第一个渲染路径上的 `return` 之后的任何渲染路径 hook 都是违例。
 *
 * @param source - 原始源码（内部会先遮罩注释与字符串）。
 * @returns `{ component, hook, line }[]`。
 */
export function hookOrderViolations(source) {
  const code = maskNonCode(source);
  const lineOf = index => code.slice(0, index).split('\n').length;

  // 组件头：`function Foo(` 与 `const Foo = (…) => {` / `const Foo = x => {`。
  //
  // ⚠️ `function Foo({ store }) {` 的**第一个** `{` 是解构参数，不是函数体 ——
  //    直接 `indexOf('{')` 会把体起点定在参数里，于是 return 与 hook 全落在「函数体外」。
  const heads = [
    ...code.matchAll(/(?:^|\n)\s*(?:export\s+)?(?:default\s+)?function\s+([A-Z]\w*)\s*\(/g),
    ...code.matchAll(/(?:^|\n)\s*(?:export\s+)?const\s+([A-Z]\w*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{/g),
    ...code.matchAll(/(?:^|\n)\s*(?:export\s+)?const\s+([A-Z]\w*)\s*=\s*(?:async\s*)?[A-Za-z_$][\w$]*\s*=>\s*\{/g),
  ].map(match => ({
    name: match[1],
    end: match.index + match[0].length,
    isArrow: !/^\s*(?:export\s+)?(?:default\s+)?function\b/.test(match[0]),
  }));

  const violations = [];
  for (const head of heads) {
    const open = head.isArrow ? head.end - 1 : bodyOpenAfterParams(code, head.end - 1);
    if (open < 0 || code[open] !== '{') continue;

    // 函数体的右端：配平花括号。
    let depth = 0;
    let close = -1;
    for (let i = open; i < code.length; i += 1) {
      if (code[i] === '{') depth += 1;
      else if (code[i] === '}' && --depth === 0) { close = i; break; }
    }
    if (close < 0) continue;

    // 单遍走完函数体：维护「嵌套函数体起始的花括号深度」栈。
    const fnBodies = [];       // 嵌套函数体的花括号深度
    let braces = 0;            // 花括号深度（相对函数体起点）
    let parens = 0;            // 圆括号深度
    let brackets = 0;          // 方括号深度
    let pendingFnBody = false; // 刚见过 `=>` / `function`，下一个 `{` 是函数体
    let firstReturn = -1;
    let reported = false;

    for (let i = open + 1; i < close; i += 1) {
      const ch = code[i];
      const inRenderPath = fnBodies.length === 0;

      if (ch === '(') { parens += 1; continue; }
      if (ch === ')') { parens -= 1; continue; }
      if (ch === '[') { brackets += 1; continue; }
      if (ch === ']') { brackets -= 1; continue; }
      if (ch === '}') {
        if (fnBodies.length > 0 && fnBodies[fnBodies.length - 1] === braces) fnBodies.pop();
        braces -= 1;
        continue;
      }
      if (ch === '{') {
        braces += 1;
        if (pendingFnBody) { fnBodies.push(braces); pendingFnBody = false; }
        continue;
      }

      // `=>` 之后跟 `{` 的是函数体；表达式体箭头函数里不会有 hook。
      if (ch === '=' && code[i + 1] === '>') {
        let j = i + 2;
        while (j < close && /\s/.test(code[j])) j += 1;
        if (code[j] === '{') pendingFnBody = true;
        i += 1;
        continue;
      }
      if (/[A-Za-z_$]/.test(ch) && code.slice(i - 1, i) !== '' && !/[\w$]/.test(code[i - 1])) {
        const word = /^[\w$]+/.exec(code.slice(i, i + 32))?.[0] ?? '';
        if (word === 'function') pendingFnBody = true;
        if (word === 'return' && inRenderPath && firstReturn < 0) firstReturn = i;
        if (inRenderPath && HOOK_PREFIX.test(word) && firstReturn >= 0 && !reported) {
          // 只有真的调用（后面跟 `(`）才算 hook。
          let j = i + word.length;
          while (j < close && /\s/.test(code[j])) j += 1;
          if (code[j] === '(') {
            violations.push({ component: head.name, hook: word, line: lineOf(i) });
            reported = true;
          }
        }
        i += word.length - 1;
        continue;
      }
      // 圆括号里的内容与花括号里的分隔符都无关；这里不用做事。
      void parens; void brackets;
    }
  }
  return violations;
}

/** 收集所有页面包（`dsh-zhiyun-page-*`）的组件源码。 */
function pageSources() {
  const packages = readdirSync(path.join(root, 'packages'), { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name.startsWith('dsh-zhiyun-page-'));
  const files = [];
  for (const entry of packages) {
    const src = path.join(root, 'packages', entry.name, 'src');
    if (!existsSync(src)) continue;
    for (const file of readdirSync(src)) {
      if (!/\.jsx?$/.test(file)) continue;
      files.push({ name: `${entry.name}/${file}`, file: path.join(src, file) });
    }
  }
  return files;
}

test('扫描器有牙：修复前的形状会被判为违例', () => {
  // 这一段就是 2e386d6b 时 Panel.jsx 的真实结构（缩短版）：
  // hook 写在两个提前 return 之后。
  const broken = `
export function Panel({ store }) {
  const state = useStore(store);
  const [open, setOpen] = useState(false);
  useEffect(() => { store.ensure(); }, [store]);
  const view = state.view;
  if (view === null) {
    return <section><p>正在读取…</p></section>;
  }
  const usage = useUsageRows(view.rows);
  return <section>{usage.length}</section>;
}
`;
  const found = hookOrderViolations(broken);
  assert.equal(found.length, 1, `应当报出 1 条，实际：${JSON.stringify(found)}`);
  assert.equal(found[0].component, 'Panel');
  assert.equal(found[0].hook, 'useUsageRows');
});

test('扫描器不误报：hook 全在 return 之前的形状是干净的', () => {
  const fixed = `
export function Panel({ store }) {
  const state = useStore(store);
  const [open, setOpen] = useState(false);
  useEffect(() => { store.ensure(); }, [store]);
  const usage = useUsageRows(state.view?.rows ?? []);
  if (state.view === null) {
    return <section><p>正在读取…</p></section>;
  }
  return <section>{usage.length}</section>;
}
`;
  assert.deepEqual(hookOrderViolations(fixed), []);
});

test('扫描器不误报：回调里的 hook 不算渲染路径（虽然那样写本身也是错的，但不在这条规则里）', () => {
  // `useEffect(() => { … }, [])` 里的东西在函数体第 2 层，不是组件的 hooks。
  const nested = `
export function Widget({ rows }) {
  const label = useMemo(() => rows.map(row => row.name), [rows]);
  return <ul>{label.map(name => <li key={name}>{name}</li>)}</ul>;
}
`;
  assert.deepEqual(hookOrderViolations(nested), []);
});

test('所有页面包：没有组件把 hook 写在提前 return 之后', () => {
  const problems = [];
  for (const file of pageSources()) {
    const source = readFileSync(file.file, 'utf8');
    for (const hit of hookOrderViolations(source)) {
      problems.push(`${file.name}:${hit.line} ${hit.component} 里的 ${hit.hook} 在提前 return 之后 —— React 会抛 "Rendered more hooks than during the previous render."，整页变成空白`);
    }
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});

/**
 * 端到端那一半：拿**已构建的** `lib/client.js` 真渲染两次。
 *
 * 上面对源码的静态扫描回答「有没有写错」，这一条回答「真的会不会炸」——
 * 两者都对上，才算这一类故障被堵住。静态扫描会漏掉不是以 `function Foo(` /
 * `const Foo = … =>` 出现的组件；而构建产物一律是**压缩前的真实 JS**，
 * 不依赖源码的写法。
 *
 * # 为什么不用 react-dom
 *
 * 要 rerender 得有 jsdom + `react-dom/client`（本仓没装），而
 * `renderToStaticMarkup` **只渲染一次** —— 「第 1 次 3 个 hook、第 2 次 5 个」
 * 这种差异它天生看不见（本次事故当时所有渲染测试都是绿的，就是这么来的）。
 *
 * 所以这里装一个按 React 语义记账的 dispatcher：每次渲染记下 hook 的类型序列，
 * 下一次渲染取到上次没有的 hook 时，按 React 原文抛错。这不是「重写 React」——
 * 它只回答一个判断题：同一组件的两次渲染，hook 序列是否一致。
 *
 * ⚠️ 读的是 `lib/client.js`。产物不在版本控制里（各包的 `lib/` 目录被 .gitignore 忽略），
 *    没构建过就跳过，而不是让 CI 红在「没跑 build」这种与代码无关的事上。
 */
test('已构建的「插件」页：读图前后两次渲染的 hook 序列一致', async (t) => {
  const bundle = path.join(root, 'packages/dsh-zhiyun-page-plugins/lib/client.js');
  if (!existsSync(bundle)) {
    t.skip('packages/dsh-zhiyun-page-plugins/lib/client.js 还没构建，跳过');
    return;
  }

  const React = (await import('react')).default;
  const jsxRuntime = await import('react/jsx-runtime');

  // bundle 自带 `window.__ModuleLoader__.load({ id, factory })` 的包装，照宿主的方式接管。
  let factory = null;
  const previousWindow = globalThis.window;
  const previousStorage = globalThis.localStorage;
  globalThis.window = { __ModuleLoader__: { load: entry => { factory = entry.factory; } } };
  globalThis.localStorage = { getItem: () => null };
  try {
    new Function('window', 'globalThis', readFileSync(bundle, 'utf8'))(globalThis.window, globalThis);
  } finally {
    globalThis.window = previousWindow;
    globalThis.localStorage = previousStorage;
  }
  assert.equal(typeof factory, 'function', 'bundle 应当通过 __ModuleLoader__ 注册工厂');

  const shellUi = {
    useStore: store => React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot),
    SectionTitle: ({ children }) => React.createElement('div', null, children),
    Notice: ({ children }) => React.createElement('div', null, children),
    Icon: () => null,
    mountStyle: () => {},
  };
  const { Panel } = factory((id) => {
    if (id === 'react') return React;
    if (id === 'react/jsx-runtime') return jsxRuntime;
    if (id === 'dsh-zhiyun-shell-ui') return shellUi;
    throw new Error(`bundle 里出现了未预期的 require：${id}`);
  });
  assert.equal(typeof Panel, 'function', 'bundle 应当导出 Panel');

  // 按 React 语义记账的 dispatcher：序列不一致就按 React 原文抛错。
  let previousSeq = null;
  const renderOnce = (snapshot) => {
    const seq = [];
    let i = 0;
    const take = (kind, make) => {
      const seen = previousSeq?.[i];
      if (previousSeq !== null && seen === undefined) {
        throw new Error(`Rendered more hooks than during the previous render.（第 ${i + 1} 个 hook 是新增的 ${kind}）`);
      }
      if (seen !== undefined && seen !== kind) {
        throw new Error(`React has detected a change in the order of Hooks: 第 ${i + 1} 个由 ${seen} 变成 ${kind}`);
      }
      seq.push(kind);
      i += 1;
      return make();
    };
    const dispatcher = {
      useSyncExternalStore: (_sub, getSnapshot) => { take('useSyncExternalStore', () => null); return getSnapshot(); },
      useState: init => take('useState', () => [typeof init === 'function' ? init() : init, () => {}]),
      useReducer: (_reducer, init) => take('useReducer', () => [init, () => {}]),
      useEffect: () => take('useEffect', () => {}),
      useLayoutEffect: () => take('useLayoutEffect', () => {}),
      useInsertionEffect: () => take('useInsertionEffect', () => {}),
      useMemo: fn => take('useMemo', () => fn()),
      useCallback: fn => take('useCallback', () => fn),
      useRef: init => take('useRef', () => ({ current: init })),
      useId: () => take('useId', () => 'id'),
      useDebugValue: () => {},
      useContext: () => take('useContext', () => ({})),
      useTransition: () => take('useTransition', () => [false, fn => fn()]),
      useDeferredValue: value => take('useDeferredValue', () => value),
    };
    const internals = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
    internals.ReactCurrentDispatcher.current = dispatcher;
    try {
      const store = {
        subscribe: () => () => {}, getSnapshot: () => snapshot,
        ensure() {}, refresh: () => Promise.resolve(), setPluginEnabled() {}, dismiss() {},
      };
      Panel({ store });
    } finally {
      internals.ReactCurrentDispatcher.current = null;
    }
    previousSeq = seq;
    return seq;
  };

  const row = {
    name: 'dsh-zhiyun-page-today', short: 'page-today', enabled: true, entryId: 'e1',
    deps: [], dependents: [], waiting: [], leaf: true, cancellable: true,
  };
  // 第 1 次：这一页挂载时真实的首帧（图还没读到，走提前 return）。
  const first = renderOnce({ status: 'loading', view: null, error: '', busy: [], pendingAction: null });
  // 第 2 次：跨宿主往返回来、图就绪之后的重渲染 —— 事故就发生在这里。
  const second = renderOnce({
    status: 'ready', error: '', busy: [], pendingAction: null,
    view: {
      rows: [row], order: ['dsh-zhiyun-page-today'], leaves: ['dsh-zhiyun-page-today'],
      cancellable: ['dsh-zhiyun-page-today'], cycles: [], layerViolations: [],
      enabled: ['dsh-zhiyun-page-today'], disabled: [],
    },
  });
  assert.deepEqual(second, first, '两次渲染的 hook 序列必须一致');
});
