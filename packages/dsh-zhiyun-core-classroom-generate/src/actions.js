/**
 * actions 段解析器。
 *
 * 源：上游 `packages/@openmaic/generation/src/action-parser.ts` 的
 * `parseActionsFromStructuredOutput`（7 步后处理）与
 * `scene-generator.ts` 的 action 语义修正。
 *
 * # 输入形态
 *
 * 模型按上游约定直接输出一个 **JSON 数组**，元素是两种之一：
 *
 *   { "type": "action", "name": "spotlight", "params": { "elementId": "text_1" } }
 *   { "type": "text",   "content": "第一，我们看这个公式……" }
 *
 * # 为什么需要这一层「后处理」而不是 JSON.parse 就完事
 *
 * 模型输出不可信。上游总结出六类必须修的问题，这里逐条照做：
 *
 * 1. **裸数组前面常带废话或围栏** —— 要先把 `[` … `]` 区间找出来
 * 2. **JSON 可能轻微损坏** —— 尾逗号、单引号、未转义换行
 * 3. **`discussion` 必须是最后一项** —— 否则学生被叫起来讨论后还有旁白，播放器会卡住
 * 4. **非 slide 场景不能有 slide-only 动作** —— quiz 页没有聚光灯可打
 * 5. **`elementId` 可能不存在** —— 要退回第一个元素，而不是让播放器找不到目标
 * 6. **`widget_setState.state` 可能缺失** —— 补成 `{}`
 *
 * 这些都不是"锦上添花"，是**播放器会不会崩**的区别。
 */

/** slide 场景才有的动作（上游 `dsl/src/action.ts` 的 `SLIDE_ONLY_ACTIONS`）。 */
const SLIDE_ONLY_ACTIONS = ['spotlight', 'laser'];

/** 允许的动作名（对齐上游 DSL 的 ActionType，只收生成管线会产出的那些）。 */
export const GENERATABLE_ACTIONS = Object.freeze([
  'spotlight',
  'laser',
  'play_video',
  'discussion',
  'widget_highlight',
  'widget_setState',
  'widget_annotation',
  'widget_reveal',
]);

/**
 * 从模型输出里抠出 JSON 数组。
 *
 * 三级容错（对应上游 action-parser.ts:22-82）：
 * 精确解析 → 去围栏/定位区间 → 修补尾逗号与常见转义问题。
 */
export function extractActionArray(raw) {
  if (typeof raw !== 'string') return null;
  let text = raw.trim();
  if (!text) return null;

  // 剥离 markdown 围栏（```json … ```）
  text = text.replace(/^```(?:json|JSON)?\s*/m, '').replace(/```\s*$/m, '').trim();

  const tryParse = (candidate) => {
    try {
      const parsed = JSON.parse(candidate);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  };

  // 1) 直接解析
  const direct = tryParse(text);
  if (direct && looksLikeActions(direct)) return direct;

  // 2) 定位第一个 [ 到最后一个 ] 的区间
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start !== -1 && end > start) {
    const slice = text.slice(start, end + 1);
    const parsed = tryParse(slice);
    if (parsed && looksLikeActions(parsed)) return parsed;

    // 3) 修补：去掉尾逗号、清掉控制字符
    const repaired = slice
      .replace(/,\s*([\]}])/g, '$1')
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
    const retried = tryParse(repaired);
    if (retried && looksLikeActions(retried)) return retried;
  }

  return null;
}

/**
 * 这个数组**看起来像不像** actions 段该产出的东西？
 *
 * # 为什么必须有这个校验
 *
 * 曾经的 bug：模型回了场景格式（`{"elements":[{…}],"speech":"…"}`），
 * 而 `extractActionArray` 用「第一个 [ 到最后一个 ]」的宽松策略，
 * 把里面的 **elements 数组**当成了动作数组 —— 于是幻灯片元素被当成一条
 * 旁白，旁白变成一段 HTML，而真正的 speech 丢失。
 *
 * ⚠️ 判据不能只看 `type === 'text'`：幻灯片元素也有 `type:"text"`。
 * 区别在于**元素有几何字段**（left/top/width/height），动作的 text 没有。
 */
function looksLikeActions(items) {
  if (!Array.isArray(items)) return false;
  if (items.length === 0) return true;

  const GEOMETRY_KEYS = ['left', 'top', 'width', 'height'];
  const isSpeechItem = (item) => {
    if (!item || typeof item !== 'object' || item.type !== 'text') return false;
    // 带几何字段的是幻灯片元素，不是旁白。
    return !GEOMETRY_KEYS.some((key) => key in item);
  };
  const isActionItem = (item) => Boolean(item)
    && typeof item === 'object'
    && item.type === 'action'
    && typeof item.name === 'string';

  const candidates = items.filter((item) => isSpeechItem(item) || isActionItem(item));
  if (candidates.length === 0) return false;

  // 只要**存在**元素形状的项（有 type 却既不是旁白也不是动作），就说明这不是 actions 输出。
  // 用比例判定以免个别脏项误伤：超过一半不合格就判否。
  return candidates.length * 2 >= items.length;
}

/**
 * 把模型的数组归一成播放器能吃的 action 列表。
 *
 * @param {unknown[]} items   `extractActionArray` 的结果
 * @param {object} options
 * @param {string} options.sceneId
 * @param {string} options.sceneType       'slide' | 'quiz' | 'interactive' | 'pbl'
 * @param {string[]} [options.elementIds]  slide 上真实存在的元素 id
 * @returns {{actions: object[], issues: object[]}}
 */
export function normalizeActions(items, options = {}) {
  const sceneId = options.sceneId ?? 'scene';
  const sceneType = options.sceneType ?? 'slide';
  const elementIds = Array.isArray(options.elementIds) ? options.elementIds : [];
  const issues = [];

  const actions = [];
  let textIndex = 0;
  let actionIndex = 0;

  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item !== 'object') continue;

    // ── 旁白 ──
    if (item.type === 'text') {
      const content = typeof item.content === 'string' ? item.content.trim() : '';
      if (!content) continue;
      textIndex += 1;
      actions.push({
        id: `${sceneId}-text-${textIndex}`,
        type: 'speech',
        text: content,
      });
      continue;
    }

    if (item.type !== 'action') continue;
    const name = typeof item.name === 'string' ? item.name : '';
    if (!GENERATABLE_ACTIONS.includes(name)) {
      issues.push({ code: 'ACTION_UNKNOWN', name });
      continue;
    }

    // ── 非 slide 场景剥离 slide-only 动作（上游 action-parser.ts:138-146）──
    if (sceneType !== 'slide' && SLIDE_ONLY_ACTIONS.includes(name)) {
      issues.push({ code: 'ACTION_NOT_ALLOWED_ON_SCENE', name, sceneType });
      continue;
    }

    const params = item.params && typeof item.params === 'object' ? { ...item.params } : {};
    actionIndex += 1;
    const base = { id: `${sceneId}-${name}-${actionIndex}`, type: name };

    if (name === 'spotlight' || name === 'laser' || name === 'play_video') {
      // 「提供了元素清单」与「清单为空」是两件事：
      //   - 未提供（undefined）→ 无从校验，放行模型给的 id
      //   - 提供了但是空数组 → 这一页根本没有元素，任何指向元素的动作都无意义
      const hasElementList = Array.isArray(options.elementIds);
      let elementId = typeof params.elementId === 'string' ? params.elementId : '';

      if (hasElementList && elementIds.length === 0) {
        issues.push({ code: 'ACTION_DROPPED_NO_TARGET', name, reason: 'slide has no elements' });
        continue;
      }
      // elementId 不在元素表里 → 退回第一个元素（上游 scene-generator.ts:2003-2014）
      if (hasElementList && !elementIds.includes(elementId)) {
        issues.push({ code: 'ELEMENT_ID_FALLBACK', from: elementId, to: elementIds[0], name });
        elementId = elementIds[0];
      }
      if (!elementId) {
        // 没有任何 id 可指：丢掉，别让播放器拿到空目标。
        issues.push({ code: 'ACTION_DROPPED_NO_TARGET', name });
        continue;
      }
      actions.push({ ...base, elementId });
      continue;
    }

    if (name === 'discussion') {
      const topic = typeof params.topic === 'string' ? params.topic.trim() : '';
      if (!topic) {
        issues.push({ code: 'ACTION_DROPPED_NO_TOPIC', name });
        continue;
      }
      actions.push({
        ...base,
        topic,
        ...(typeof params.prompt === 'string' && params.prompt.trim() ? { prompt: params.prompt.trim() } : {}),
        ...(typeof params.agentId === 'string' && params.agentId ? { agentId: params.agentId } : {}),
      });
      continue;
    }

    // widget_* 四个
    const target = typeof params.target === 'string' ? params.target : '';
    if (!target) {
      issues.push({ code: 'ACTION_DROPPED_NO_TARGET', name });
      continue;
    }
    const widgetAction = { ...base, target };
    if (name === 'widget_setState') {
      // state 缺失补成 {}（上游 action-parser.ts:118-124）
      widgetAction.state = params.state && typeof params.state === 'object' ? params.state : {};
      if (!params.state) issues.push({ code: 'WIDGET_STATE_DEFAULTED' });
    }
    if (typeof params.content === 'string' && params.content.trim()) {
      widgetAction.content = params.content.trim();
    }
    actions.push(widgetAction);
  }

  // ── discussion 必须是最后一项（上游 action-parser.ts:132-136）──
  const discussionAt = actions.findIndex((action) => action.type === 'discussion');
  if (discussionAt !== -1 && discussionAt !== actions.length - 1) {
    const [discussion] = actions.splice(discussionAt, 1);
    actions.push(discussion);
    issues.push({ code: 'DISCUSSION_MOVED_TO_END' });
  }

  return { actions, issues };
}

/**
 * 一步到位：模型原始输出 → 可用的 action 列表。
 *
 * 解析彻底失败时返回 `null`（区别于"解析出空数组"），调用方据此决定
 * 是报错重试还是接受空动作。
 */
export function parseSceneActions(raw, options = {}) {
  const items = extractActionArray(raw);
  if (!items) return null;
  return normalizeActions(items, options);
}

/**
 * 确定性默认动作（上游 `generateDefaultSlideActions` 等四个的等价物）。
 *
 * actions 段不可用时的兜底：至少让这一页有旁白，而不是静默无声。
 * 上游同样有这层 —— 内容已经生成好了，不能因为"怎么讲"没安排好就整页丢掉。
 *
 * @param {{sceneId: string, speech?: string}} options
 * @returns {object[]}
 */
export function generateDefaults({ sceneId, sceneType, speech } = {}) {
  const text = typeof speech === 'string' ? speech.trim() : '';
  if (!text) return [];
  return [{
    id: `${sceneId}-speech-1`,
    type: 'speech',
    text,
  }];
}
