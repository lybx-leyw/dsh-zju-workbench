/**
 * 消息格式转换的回归测试。
 *
 * # 锁住的事故（2026-10-31 第五次真机失败）
 *
 * core-question 按 OpenAI 约定造消息：`{role:'user', content:'一段文字'}`。
 * 宿主的 deepseek adapter 走 **Anthropic Messages API**，在 `serialize()` 与
 * 请求前检查里对 content 调 `.some(block => ...)`。字符串没有 `.some`：
 *
 *   TypeError: content.some is not a function
 *   → 被 generate() 的 catch 吞成 `DeepSeek Messages transport failed`(TRANSPORT)
 *
 * 所以错误信息看似网络故障，真因是消息格式。仓库里正确的写法在
 * `packages/dsh-zhiyun-core-quiz/src/engines/r3-v9/tools.mjs:66`：
 *   `const blocks = text => [{type:'text', text}]`
 *
 * 用法：node tests/message-format.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const BACKEND = 'packages/dsh-zhiyun-core-study/src/core-question-backend.js';
const source = fs.readFileSync(path.resolve(BACKEND), 'utf8');

/** 从源码里把 toHostMessages 抽出来独立跑（它没依赖外部符号）。 */
function loadToHostMessages() {
  const start = source.indexOf('function toHostMessages(');
  assert.ok(start > 0, '找不到 toHostMessages —— 消息格式转换是本次修复的核心，不能在后续重构里被删掉');
  // 从函数开头截到「文件里下一个顶层 function 或 export」之前
  const rest = source.slice(start);
  const endMatch = rest.match(/\n(?:export )?(?:function|const|class) /);
  const body = endMatch ? rest.slice(0, endMatch.index) : rest;
  // eslint-disable-next-line no-new-func
  return new Function(`${body}; return toHostMessages;`)();
}

/** 复刻宿主 serializer 对 content 的关键操作。 */
const hostAccepts = content => {
  if (typeof content?.some !== 'function') {
    throw new TypeError('content.some is not a function');
  }
  return content;
};

test('字符串 content 会被宿主拒绝（这就是 TRANSPORT 的来源）', () => {
  assert.throws(
    () => hostAccepts('一段普通文本'),
    /content\.some is not a function/,
    '宿主对 content 调 .some；字符串没有该方法',
  );
});

test('转换后 user/system 消息变成块数组', () => {
  const toHostMessages = loadToHostMessages();
  const out = toHostMessages([
    { role: 'system', content: '系统提示' },
    { role: 'user', content: '用户问题' },
  ]);
  for (const m of out) {
    assert.ok(Array.isArray(m.content), `${m.role} 的 content 必须是数组`);
    assert.doesNotThrow(() => hostAccepts(m.content), '宿主必须能接受');
    assert.ok(m.content.every(b => b.type === 'text' && typeof b.text === 'string'));
  }
  assert.equal(out[0].role, 'system');
  assert.equal(out[0].content[0].text, '系统提示');
});

test('已经是块数组的 content 原样保留（幂等）', () => {
  const toHostMessages = loadToHostMessages();
  const blocks = [{ type: 'text', text: '已经是块' }];
  const out = toHostMessages([{ role: 'user', content: blocks }]);
  assert.deepEqual(out[0].content, blocks);
});

test('空 content 转成空数组，不产生 {text:undefined}', () => {
  const toHostMessages = loadToHostMessages();
  const out = toHostMessages([
    { role: 'assistant', content: null },
    { role: 'user', content: '' },
  ]);
  assert.deepEqual(out[0].content, []);
  assert.deepEqual(out[1].content, []);
});

test('工具结果消息的关联 id 必须在顶层 toolCallId（宿主读那里）', () => {
  const toHostMessages = loadToHostMessages();
  const out = toHostMessages([
    { role: 'tool', content: '{"ok":true}', toolCallId: 'call-1' },
  ]);
  assert.equal(out[0].role, 'tool');
  assert.ok(Array.isArray(out[0].content), 'content 必须是块数组');
  // 宿主序列化时读 message.toolCallId（dsh-llm-deepseek:1668），
  // 写在 source.callId 上宿主读不到，会导致 tool_result 找不到对应 tool_use
  assert.equal(out[0].toolCallId, 'call-1', '宿主靠顶层 toolCallId 把结果接回调用');
});

test('工具结果消息：OpenAI 的 tool_call_id 也能被识别', () => {
  const toHostMessages = loadToHostMessages();
  const out = toHostMessages([
    { role: 'tool', content: 'x', tool_call_id: 'call-2' },
  ]);
  assert.equal(out[0].toolCallId, 'call-2');
});

test('assistant 的 tool_calls 变成 tool-call 块', () => {
  const toHostMessages = loadToHostMessages();
  const out = toHostMessages([
    {
      role: 'assistant',
      content: '我先查一下',
      tool_calls: [{ id: 'c1', name: 'rag', arguments: { query: 'x' } }],
    },
  ]);
  const blocks = out[0].content;
  assert.ok(blocks.some(b => b.type === 'text' && b.text === '我先查一下'));
  const call = blocks.find(b => b.type === 'tool-call');
  assert.ok(call, '必须有 tool-call 块');
  assert.equal(call.id, 'c1');
  assert.equal(call.name, 'rag');
  // 参数必须是字符串（宿主协议）
  assert.equal(typeof call.arguments, 'string');
  assert.deepEqual(JSON.parse(call.arguments), { query: 'x' });
});

test('每条消息都带 id 与 source（会话归因依赖它们）', () => {
  const toHostMessages = loadToHostMessages();
  const out = toHostMessages([{ role: 'user', content: 'hi' }]);
  assert.ok(out[0].id, '缺 id');
  assert.ok(out[0].source, '缺 source');
  assert.equal(out[0].source.kind, 'zhiyun-quiz');
});

// ── 工具定义格式（2026-10-31 第六次真机失败）────────────────────────────

/** 把 toHostTools 从源码里抽出来独立跑。 */
function loadToHostTools() {
  const start = source.indexOf('function toHostTools(');
  assert.ok(start > 0, '找不到 toHostTools —— 工具格式转换是必须的，删掉会让每次带工具的调用 400');
  const rest = source.slice(start);
  const endMatch = rest.match(/\n(?:\/\*\*|function )/);
  const body = endMatch ? rest.slice(0, endMatch.index) : rest;
  // eslint-disable-next-line no-new-func
  return new Function(`${body}; return toHostTools;`)();
}

test('工具定义：OpenAI 形状必须转成宿主扁平形状', () => {
  const toHostTools = loadToHostTools();
  const openai = [{
    type: 'function',
    function: { name: 'rag', description: '检索讲义', parameters: { type: 'object', properties: { q: { type: 'string' } } } },
  }];
  const out = toHostTools(openai);

  assert.equal(out.length, 1);
  // 宿主直接读 tool.name；OpenAI 形状外层没有 name，不转换就会
  // 报 "tools[0]: missing field `name`"
  assert.equal(out[0].name, 'rag', '宿主要读扁平 name');
  assert.equal(out[0].description, '检索讲义');
  assert.deepEqual(out[0].parameters, { type: 'object', properties: { q: { type: 'string' } } });
  assert.equal(out[0].type, undefined, '不该把 type:"function" 透传给宿主');
  assert.equal(out[0].function, undefined, '不该保留 function 包装');
});

test('工具定义：已经是扁平形状时保持可用', () => {
  const toHostTools = loadToHostTools();
  const flat = [{ name: 'kb_files', description: '清单', parameters: { type: 'object', properties: {} } }];
  const out = toHostTools(flat);
  assert.equal(out[0].name, 'kb_files');
  assert.deepEqual(out[0].parameters, { type: 'object', properties: {} });
});

test('工具定义：缺 parameters 时给空对象，不让宿主拿到 undefined', () => {
  const toHostTools = loadToHostTools();
  const out = toHostTools([{ type: 'function', function: { name: 'x' } }]);
  assert.equal(out[0].name, 'x');
  assert.deepEqual(out[0].parameters, { type: 'object', properties: {} });
});
