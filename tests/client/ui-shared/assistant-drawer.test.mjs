import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * AI 助手抽屉的契约。
 *
 * # 守什么
 *
 * 抽屉是**页面内**的 UI：不碰宿主 DOM、不注册插槽、切页即卸载。这三条是它
 * 能安全复用到任何页面的前提 —— 一旦它开始 `document.querySelector` 找宿主
 * 节点，就会重演「page 层影响 home」。
 *
 * 另外守「导出清单不漏」：`ui-shared` 的入口是逐个别名导出的，漏一个会让
 * 使用方拿到 `undefined`（React #130，整块插槽崩掉）。
 */

const root = fileURLToPath(new URL('../../..', import.meta.url));
const drawer = path.join(root, 'packages/client/ui-shared/src/assistant-drawer.jsx');
const entry = path.join(root, 'packages/client/ui-shared/src/client.jsx');

test('抽屉组件存在且导出 AssistantDrawer', () => {
  assert.ok(existsSync(drawer), 'assistant-drawer.jsx 必须存在');
  const src = readFileSync(drawer, 'utf8');
  assert.match(src, /export function AssistantDrawer\(/, '要具名导出 AssistantDrawer');
});

test('ui-shared 入口导出抽屉（漏了会让使用方拿到 undefined）', () => {
  const src = readFileSync(entry, 'utf8');
  assert.match(src, /export \{ AssistantDrawer \} from '\.\/assistant-drawer\.jsx'/);
});

test('抽屉不碰宿主 DOM（页面作用域的唯一承诺）', () => {
  const src = readFileSync(drawer, 'utf8');
  // 只允许 document 出现在「创建/查询自己容器」以外的地方吗？这里更严格：
  // 只要出现宿主选择器就是违规。
  for (const hostSel of ['data-rightbar', 'data-sidebar-right', 'data-slot', 'data-dsh-pages', 'headerUtilities']) {
    assert.ok(!src.includes(hostSel), `抽屉不该引用宿主的 ${hostSel}`);
  }
  // 不许把东西挂到全局（样式、节点都算）
  assert.ok(!/document\.head\.appendChild|document\.body\.appendChild/.test(src),
    '抽屉不该往全局挂东西 —— 它的样式全内联');
});

test('抽屉不注册任何插槽', () => {
  const src = readFileSync(drawer, 'utf8');
  assert.ok(!/slots\.(inject|register)/.test(src), '抽屉是页面内的普通组件，不注册插槽');
});

test('折叠态与展开态都有稳定选择器（供页面测试）', () => {
  const src = readFileSync(drawer, 'utf8');
  assert.match(src, /data-zhiyun-drawer="open"/, '展开态要能选到');
  assert.match(src, /data-zhiyun-drawer="collapsed"/, '折叠态要能选到');
});

test('宽度有上下界，不会把正文挤没', () => {
  const src = readFileSync(drawer, 'utf8');
  assert.match(src, /const MIN_WIDTH = \d+/, '要有最小宽度');
  assert.match(src, /const MAX_WIDTH = \d+/, '要有最大宽度');
  const min = Number(/const MIN_WIDTH = (\d+)/.exec(src)[1]);
  const max = Number(/const MAX_WIDTH = (\d+)/.exec(src)[1]);
  assert.ok(min >= 280, `最小宽度 ${min} 太窄，放不下消息`);
  assert.ok(max <= 900, `最大宽度 ${max} 太宽，会挤掉正文`);
  assert.ok(min < max);
});

test('拖宽手柄有定位基准（不然会跑到窗口角落）', () => {
  const src = readFileSync(drawer, 'utf8');
  // 手柄是 position:absolute + left:-3；其父容器必须有 position:relative
  assert.match(src, /position: 'relative'/, '展开态容器需要 position:relative');
  assert.match(src, /data-zhiyun-drawer-handle/, '拖宽手柄要有标记');
});

test('传输层由调用方决定（send 是回调，不写死接口）', () => {
  const src = readFileSync(drawer, 'utf8');
  assert.match(src, /send,/, 'send 是 props');
  // 只检查**代码行**：注释里说明「论文页用 /paper-reader/api/ask」是合理的文档，
  // 把它算成耦合会让真正的违规淹没在噪音里。
  const code = src.split(String.fromCharCode(10)).filter(line => {
    const t = line.trim();
    return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"));
  }).join(String.fromCharCode(10));
  assert.ok(!code.includes("/paper-reader/"), "抽屉代码里不该写死论文阅读的接口");
  assert.ok(!code.includes("/zhiyun-paper/"), "抽屉代码里不该写死智云的接口");
});

test('偏好（开合与宽度）用 localStorage 记住，且失败不崩', () => {
  const src = readFileSync(drawer, 'utf8');
  assert.match(src, /localStorage\.getItem/, '要恢复上次的宽度/开合');
  assert.match(src, /localStorage\.setItem/, '要记住本次的宽度/开合');
  // try/catch 包裹：隐私模式写不了 localStorage
  assert.match(src, /catch \{ return defaultOpen; \}|catch \{ return DEFAULT_WIDTH; \}/,
    'localStorage 读取失败要有默认值');
});
