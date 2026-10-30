/**
 * 为「重构版出题链」提供一个可注入的假模型。
 *
 * 为什么需要独立一份：现有 toolModel 是给 r3 用的，按工具名回复；
 * 重构版按「阶段」决定返回什么，三个阶段的协议标签不同：
 *   explore -> FINISH 开头的前言
 *   plan    -> PLAN 开头 + JSON(analysis + templates)
 *   quiz    -> FINISH 开头的单题 JSON
 * 硬塞会导致「plan 解析不出模板」，而报错在几百行之外，很难倒推。
 *
 * 为什么必须可注入：完整链路 Workbench -> QuestionBank -> createNativeQuizRun
 * -> 适配层 -> 流水线，只能接真模型的话它永远无法在测试里验证。
 */
function messageText(messages) {
  return (messages ?? []).map(m => {
    // 宿主会给消息补 source 等元数据，也可能把 content 拆成块数组。
    // 这里只关心文字，尽量宽容地取，避免因包装差异判错阶段。
    if (typeof m.content === 'string') return m.content;
    if (Array.isArray(m.content)) return m.content.map(c => (typeof c === 'string' ? c : c?.text ?? '')).join('');
    if (m.content && typeof m.content === 'object' && typeof m.content.text === 'string') return m.content.text;
    return '';
  }).join('\n');
}

export function detectStage(messages) {
  const text = messageText(messages);
  if (/出题规划器/.test(text) || /``PLAN``/.test(text)) return 'plan';
  if (/干扰项|正确项|question_type/.test(text)) return 'quiz';
  return 'explore';
}

const wrap = label => '``' + label + '``';

export function quizFakeModel({ templates = 1 } = {}) {
  const calls = [];
  return {
    calls,
    async resolveModelInfo() {
      return { inputModalities: ['text'], capabilities: { tools: true, vision: false } };
    },
    async prepareCall(config) {
      return {
        config,
        async *stream(options) {
          const stage = detectStage(options.messages);
          calls.push({ stage });
          let body;
          if (stage === 'plan') {
            body = wrap('PLAN') + JSON.stringify({
              analysis: '基础概念辨析，单选题更合适。',
              templates: Array.from({ length: templates }, (_, i) => ({
                question_id: `q_${i + 1}`,
                topic: `知识点${i + 1}的核心概念`,
                question_type: 'choice',
                difficulty: 'easy',
              })),
            });
          } else if (stage === 'quiz') {
            body = wrap('FINISH') + JSON.stringify({
              question_type: 'choice',
              question: '下列关于该知识点的说法中，正确的是？',
              options: { A: '第一个候选表述', B: '第二个候选表述', C: '第三个候选表述', D: '第四个候选表述' },
              correct_answer: 'B',
              explanation: '依据讲义原文可以推出第二个表述成立。',
            });
          } else {
            body = wrap('FINISH') + '已通读讲义，明确各知识点的边界与易混点。';
          }
          yield { type: 'text-delta', index: 0, text: body };
          yield { type: 'usage', usage: { input: 100, output: 50, total: 150 } };
          yield { type: 'finish', reason: { kind: 'stop' } };
        },
      };
    },
  };
}
