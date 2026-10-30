/**
 * assistant 消息不能既是空 content 又没有 tool_calls。
 *
 * 这条规则来自 OpenAI 兼容端点的硬校验：
 *   400 Invalid assistant message: content or tool_calls must be set
 *
 * 真实事故（2026-10-30 dsa 3 题实跑）：思考模式下模型只吐 reasoning_content、
 * 正文为空，调用方仍进 TOOL 分支构造消息 → content:null + tool_calls:[] →
 * 之后每一次请求都 400，整批题崩掉。1 题时不复现，3 题时才出现，
 * 因为要跑到第二轮修复回合才会构造出这种消息。
 *
 * 用法：node tests/message-shape.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { assistantMessage, assistantMessageWithToolCalls } from '../packages/dsh-zhiyun-core-tool/src/messages.js';

/** 端点的校验规则：content 非空 或 tool_calls 非空，二者至少一个。 */
function isAcceptable(message) {
  const hasContent = typeof message.content === 'string' && message.content.length > 0;
  const hasCalls = Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
  return hasContent || hasCalls;
}

test('只有推理、正文为空时，消息仍然合法（这就是那次 400 的场景）', () => {
  const message = assistantMessage('', { reasoningContent: '模型这一轮只思考没写正文。' });
  assert.ok(isAcceptable(message), `消息非法：${JSON.stringify(message)}`);
  assert.equal(message.reasoning_content, '模型这一轮只思考没写正文。', '推理内容不能丢');
});

test('chatbox 的 thinking_blocks 路径同样合法', () => {
  const message = assistantMessage(null, { thinkingBlocks: [{ type: 'thinking', text: '...' }] });
  assert.ok(isAcceptable(message), '带 thinking_blocks 时也不能是空 content');
});

test('TOOL 分支：有 tool_calls 时就合法，content 可以是 null', () => {
  const message = assistantMessageWithToolCalls('', [{ id: 'c1', name: 'rag', arguments: '{}' }]);
  assert.ok(isAcceptable(message));
  assert.equal(message.tool_calls.length, 1);
});

test('TOOL 分支：tool_calls 为空且正文为空时也必须合法（那次的元凶）', () => {
  const message = assistantMessageWithToolCalls('', [], { reasoningContent: '只思考了' });
  assert.ok(isAcceptable(message), `消息非法：${JSON.stringify(message)}`);
  assert.equal(message.reasoning_content, '只思考了');
});

test('正常有正文时不被改动', () => {
  const message = assistantMessage('正常正文');
  assert.equal(message.content, '正常正文');
  const withCalls = assistantMessageWithToolCalls('我先查一下', [{ id: 'c', name: 'kb_files', arguments: '{}' }]);
  assert.equal(withCalls.content, '我先查一下');
});

test('补位不改变已有字段：tool_calls 与 thinking_blocks 都保留', () => {
  const calls = [{ id: 'c1', name: 'rag', arguments: '{"query":"x"}' }];
  const blocks = [{ type: 'thinking', text: 't' }];
  const message = assistantMessageWithToolCalls('', calls, {
    reasoningContent: 'r', thinkingBlocks: blocks,
  });
  assert.deepEqual(message.tool_calls.map(c => c.id), ['c1']);
  assert.deepEqual(message.thinking_blocks, blocks);
  assert.equal(message.reasoning_content, 'r');
});
