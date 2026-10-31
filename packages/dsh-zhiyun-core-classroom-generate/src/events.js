// 源：ref/OpenMAIC/lib/server/generation/run/types.ts:254-321（run 事件的形状与事件名）
// 源：ref/OpenMAIC/lib/server/generation/run/sse.ts:1-213（有序事件日志 + 断线续读）
// 源：ref/OpenMAIC/lib/generation-run-client/reducer.ts:1-223（客户端把事件折成视图）

/**
 * 生成管线的事件：`{ runId, phase, kind, sceneId?, payload, ts }`。
 *
 * # 与上游事件名的一一对应（不必逐字相同，但语义要对得上）
 *
 * | 本包 | 上游 | 差别 |
 * |---|---|---|
 * | `phase-start` | `step_started` | 上游按 step（每场三步），本包按 phase（四段） |
 * | `phase-progress` | `step_retry` / `media` / `outline_item` | 合并成一条「进度」，`payload.step` 指明细粒度 |
 * | `scene-ready` | `scene_ready` | 同名同义（`data.index/sceneId/order` → `payload`） |
 * | `phase-done` | `step_completed` | 同上 |
 * | `run-done` | `completed` | 上游 `{ stageId }`，本包多带 `sceneCount` 与段序 |
 * | `run-error` | `step_failed` + `error` | 上游「暂停在某步」，本包终止本次 run |
 *
 * # 为什么用「日志 + 等待者」而不是纯回调
 *
 * 规范 §4 末条：事件流用 `AsyncIterable`，不用回调注册表（避免卸载泄漏）。
 * 但 `cancel(runId)` 必须能在消费者还没开始迭代时生效，`stream(runId)` 也要能
 * 在 run 已经跑完后被调用（页面晚挂载）—— 所以日志保留历史，迭代器从头重放，
 * 之后转成等待新事件。代价是内存里留一份事件（run 结束后由 service 保留，
 * `cancel`/`run-done` 之后不再增长）。
 */

/** 四段。顺序即执行顺序，`index` 直接用它算。 */
export const PHASES = Object.freeze(['outline', 'scenes', 'media', 'finalize']);

export const EVENT_KINDS = Object.freeze([
  'phase-start',
  'phase-progress',
  'scene-ready',
  'phase-done',
  'run-done',
  'run-error',
]);

/**
 * 造一条事件。字段顺序与任务书写的形状一致（`sceneId` 只在有值时出现）。
 *
 * # 为什么同时带 `kind` 与 `type`
 *
 * 本包内部按 `kind` 写（kebab-case，读起来像动作），但**消费方历史上有两套写法**：
 * 上游 SSE 用 snake_case（`scene_ready` / `completed`），`page-classroom-build` 的
 * `reduce()` 读的是 `event.type`。端到端测试证明过：只发 `kind` 时页面永远停在
 * `idle` —— 事件在传输层没丢，是名字对不上，且字段名也不同。
 *
 * 所以这里一条事件同时给两种读法（`type` 是 `kind` 的 snake_case 镜像）。这不是
 * 冗余：它让「页面 / 宿主 / 上游 SDK」三种消费方式都能直接吃，而不用谁去猜。
 */
export function makeEvent({ runId, phase, kind, sceneId, payload, ts }) {
  const event = { runId, phase, kind, type: snakeOf(kind) };
  if (sceneId !== undefined && sceneId !== null) event.sceneId = String(sceneId);
  event.payload = payload ?? {};
  event.ts = typeof ts === 'number' ? ts : Date.now();
  return event;
}

/** `phase-start` → `phase_start`；已是 snake 的原样返回。 */
export function snakeOf(kind) {
  return String(kind ?? '').replace(/-/g, '_');
}

/**
 * 有序事件日志：支持「先 push 后消费」「消费中 push」「关闭后迭代结束」。
 *
 * 关闭后仍可迭代（历史还在），这是 `stream(runId)` 能被重复调用的前提；
 * 关闭后的 `push` 被丢弃 —— 取消之后不该再冒出「场景就绪」。
 */
export function createEventLog() {
  const history = [];
  const waiters = [];
  let closed = false;

  const notify = () => {
    const pending = waiters.splice(0, waiters.length);
    for (const resolve of pending) resolve();
  };

  return {
    get size() {
      return history.length;
    },
    get closed() {
      return closed;
    },
    /** run 结束后给 `status()` 用的只读视图。 */
    snapshot() {
      return history.slice();
    },
    push(event) {
      if (closed) return event;
      history.push(event);
      notify();
      return event;
    },
    close() {
      if (closed) return;
      closed = true;
      notify();
    },
    async *iterate() {
      let index = 0;
      for (;;) {
        if (index < history.length) {
          yield history[index];
          index += 1;
          continue;
        }
        if (closed) return;
        await new Promise((resolve) => {
          waiters.push(resolve);
        });
      }
    },
  };
}
