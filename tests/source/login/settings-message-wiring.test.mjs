/**
 * 设置卡片的**状态字段一致性**。
 *
 * # 这份测试守的是一个真实 bug（2026-11-17 用户报「保存不了，没反应」）
 *
 * 后端一切正常（`POST /_dsh/zw-card?save` 返回 `{"ok":true,...}`），但页面上
 * 什么都看不到。三个同源问题都出在**字段名对不上**：
 *
 * | 写入方 | 读取方 | 后果 |
 * | --- | --- | --- |
 * | `setBusy('card-save')` | `busy === 'save'` | 按钮文字永不变成「正在保存…」 |
 * | `setMessage({kind})`（无 scope） | `message.scope === 'card'` | **成功/失败提示都不显示** |
 * | `setMessage({tone})` | 渲染读 `message.text` + `scope` | 提示不显示 |
 *
 * 结果就是「点了保存，页面没任何变化」—— 用户只能以为按钮坏了。
 *
 * 这类 bug 不会被类型检查抓到（都是对象字面量 + 字符串比较），也不会被
 * 后端测试抓到（后端是对的）。只能在**源码层面**核对「写的值」与「读的值」
 * 是不是同一个集合。
 *
 * # 为什么用源码文本检查而不是渲染测试
 *
 * 本仓没有 React 测试环境（`client.jsx` 是浏览器 bundle，靠宿主注入 React）。
 * 而这几条规则的失效方式是**字符串不匹配**，源码文本检查反而更直接、更稳。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const SOURCE = new URL('../../../packages/source/login/src/client.jsx', import.meta.url);
const text = await readFile(SOURCE, 'utf8');

/** 抽出所有 `busy === 'x'` 里的值。 */
function busyReads() {
  return [...text.matchAll(/busy === '([a-z-]+)'/g)].map((m) => m[1]);
}

/** 抽出所有 `setBusy('x')` 与 `setBusy(\`${kind}-save\`)` 的模板。 */
function busyWrites() {
  const literal = [...text.matchAll(/setBusy\('([a-z-]+)'\)/g)].map((m) => m[1]);
  const templated = [...text.matchAll(/setBusy\(`\$\{kind\}-([a-z]+)`\)/g)].map((m) => `card-${m[1]}`);
  return { literal, templated };
}

test('保存/清除的进行中提示：写入值与读取值必须来自同一个集合', () => {
  const reads = new Set(busyReads());
  const { literal, templated } = busyWrites();

  // 模板写的是 `${kind}-save`，kind 只会是 card / webvpn；这里展开成具体值。
  const expanded = [];
  for (const suffix of ['save', 'clear']) {
    for (const kind of ['card', 'webvpn']) expanded.push(`${kind}-${suffix}`);
  }

  assert.ok(templated.length >= 2, '应当有 `${kind}-save` 形式的写入');
  for (const value of expanded) {
    assert.ok(reads.has(value), `按钮读取了 '${value}' 吗？读到的集合是 ${[...reads].join(', ')}`);
  }
  for (const value of literal) {
    assert.ok(reads.has(value), `setBusy('${value}') 写的值没有任何按钮在读`);
  }
});

test('每条提示都带 scope —— 否则渲染处的条件永远不成立', () => {
  // 渲染处是 `message.scope === 'card' / 'webvpn' / 'sources'`
  const renders = new Set([...text.matchAll(/message\.scope === '([a-z]+)'/g)].map((m) => m[1]));
  assert.ok(renders.size >= 3, '三块卡片各有一个渲染处');

  const messages = [...text.matchAll(/setMessage\(\{([^}]*)\}/g)].map((m) => m[1]);
  assert.ok(messages.length >= 5, '应当有多处 setMessage');
  for (const body of messages) {
    assert.match(body, /scope:/, `这条 setMessage 没有 scope，提示会永远不显示：{${body.trim()}}`);
  }
});

test('提示用 kind 而不是 tone —— 渲染只读 text，写 tone 是死字段', () => {
  // 早期代码混用过 `tone`。它不会报错，但也没有任何地方读它。
  const withTone = [...text.matchAll(/setMessage\(\{[^}]*tone:/g)];
  assert.equal(withTone.length, 0, 'setMessage 不该再写 tone（没人读它，改了也不会生效）');
});

test('scope 的取值必须与某个渲染处对应', () => {
  const renders = new Set([...text.matchAll(/message\.scope === '([a-z]+)'/g)].map((m) => m[1]));
  const writes = new Set();
  for (const m of text.matchAll(/setMessage\(\{([^}]*)\}/g)) {
    const scope = /scope: '([a-z]+)'/.exec(m[1]);
    if (scope) writes.add(scope[1]);
    // `scope: kind` 的动态写法：kind 只会是 card / webvpn
    if (/scope: kind/.test(m[1])) { writes.add('card'); writes.add('webvpn'); }
  }
  for (const value of writes) {
    assert.ok(renders.has(value), `写了 scope: '${value}'，但没有对应的渲染处，那条提示看不到`);
  }
});

test('canSave 的判据包含非空账号 —— 学号+密码场景必须可点', () => {
  // 用户填的是学号 + 密码，`canSave` 当时应该是 true。
  assert.match(text, /Boolean\(source\.username\.trim\(\)\)/, '账号非空是必要条件');
  assert.match(text, /Boolean\(source\.password\) \|\| hasSaved/, '密码非空或已存过，二者之一');
});

test('动作名拼接：一卡通是 save，不是 -save', () => {
  // 这是第五个 bug，也是最致命的一个：`actionPrefix` 对一卡通是空字符串，
  // 无条件拼 `${prefix}-save` 会得到 `-save`，宿主回「未知动作 -save」。
  //
  // 它一直存在，只是先后被 busy 不匹配、message.scope 缺失遮住 ——
  // 三层错误叠在一起，看到的永远是最后一层的症状。
  assert.match(text, /const actionOf = \(prefix, op\) => \(prefix \? `\$\{prefix\}-\$\{op\}` : op\)/,
    '必须有跳过连字符的拼接函数');
  assert.ok(!/settings\(`\$\{spec\.actionPrefix\}-/.test(text),
    '不得再无条件拼 `${actionPrefix}-op`');

  // 直接用真实宿主动作表核对：写出来的名字必须都在白名单里。
  const hostActions = new Set(['save', 'clear', 'webvpn-save', 'webvpn-clear']);
  const actionOfReal = (prefix, op) => (prefix ? `${prefix}-${op}` : op);
  assert.equal(actionOfReal('', 'save'), 'save');
  assert.equal(actionOfReal('', 'clear'), 'clear');
  assert.equal(actionOfReal('webvpn', 'save'), 'webvpn-save');
  assert.equal(actionOfReal('webvpn', 'clear'), 'webvpn-clear');
  for (const prefix of ['', 'webvpn']) {
    for (const op of ['save', 'clear']) {
      assert.ok(hostActions.has(actionOfReal(prefix, op)),
        `${prefix || '(空)'} + ${op} 拼出的动作必须在宿主白名单里`);
    }
  }
});
