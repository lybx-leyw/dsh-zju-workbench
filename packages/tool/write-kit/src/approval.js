/**
 * 写操作的审批封装。
 *
 * # 为什么写操作必须过审批
 *
 * 这个包里的每一个动作都**改变外部状态**：选上课、报了名、约了场地、交了作业、
 * 签到、发帖、私信。这类动作做错了没法靠「再读一次」挽回 —— 选课有窗口、
 * 预约有名额、发帖发出去就收不回。
 *
 * 所以每个动作执行前都要向用户问一次，而且**只有明确批准才做**。
 *
 * # 宿主的契约（`@deepseek-ai/dsh-user-approval`，已核实）
 *
 * `ctx.approval.request(req)` 返回四种结果之一：
 *
 * | 返回值 | 含义 |
 * | --- | --- |
 * | `'allowed-once'` | **只批准这一次** —— 唯一算授权的值 |
 * | `'rejected'` | 用户拒绝 |
 * | `'cancelled'` | 被中止（signal 触发） |
 * | `'unavailable'` | 没有应答通道 / 应答者抛错 → fail closed |
 *
 * # 四条必须守住的约束
 *
 * 1. **只能在已开启的 turn 内调用**。裸事件在崩溃恢复时是「垃圾尾巴」。
 *    → 本包全部经 agent turn 里的工具调用进入，没有后台路径。
 * 2. **`'never'` 策略在服务内部就判掉了**，早于任何 listener。业务侧不要再写
 *    一遍 never 判断；只用来**选措辞**。
 * 3. **`'unavailable'` 是 fail closed**：没有审批通道时**不做**，而不是默认允许。
 * 4. **审计必然成对**（`approval/asked` / `approval/decided`），由服务分配 id。
 */

/** 审批拒绝时抛的错误。`code` 稳定，下游按码分派。 */
export class WriteRejected extends Error {
  /**
   * @param {string} code - 稳定错误码（见 {@link WRITE_CODES}）。
   * @param {string} message - 给人看的一句话。
   * @param {object} [details] - 附加信息。
   */
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'WriteRejected';
    this.code = code;
    this.details = details;
  }
}

/**
 * 本包的稳定错误码。
 *
 * 分开的原因：**用户拒绝**与**没有审批通道**对调用方的含义完全不同 ——
 * 前者是用户的决定（不要重试），后者是配置问题（重试也没用，得去开通道）。
 * 混成一句「写操作失败」，模型会反复重试一个永远不会成的动作。
 */
export const WRITE_CODES = Object.freeze({
  /** 用户明确拒绝。 */
  NOT_APPROVED: 'WRITE_NOT_APPROVED',
  /** 没有审批通道（headless / 后台 turn）。 */
  NO_CHANNEL: 'WRITE_NO_CHANNEL',
  /** 用户或系统中止。 */
  ABORTED: 'WRITE_ABORTED',
  /** 已经问过但被取消了。 */
  CANCELLED: 'WRITE_CANCELLED',
});

/**
 * 问一次审批，只有 `'allowed-once'` 才放行。
 *
 * @param options.approval - `ctx.approval`（宿主的审批服务）。
 * @param options.agent - 发起请求的 agent（审计写进它的 session log）。
 * @param options.toolName - 工具名（展示与审计）。
 * @param options.callId - 关联已流式呈现的那次调用（`exec.callId`）。
 * @param options.reason - 一句话说明要做什么（给人看）。
 * @param options.displayReason - 本地化展示 `{ en, zh }`（**从不持久化**）。
 * @param options.signal - 中止信号。
 * @returns {Promise<void>} 批准时 resolve。
 * @throws {WriteRejected} 未批准时按具体原因抛。
 */
export async function requireApproval({ approval, agent, toolName, callId, reason, displayReason, signal }) {
  // 没有服务就是没有通道 —— fail closed，不当作「默认允许」。
  if (!approval || typeof approval.request !== 'function') {
    throw new WriteRejected(
      WRITE_CODES.NO_CHANNEL,
      '这个环境没有审批通道，写操作不会执行。请在交互式会话里重试。',
      { toolName },
    );
  }

  const outcome = await approval.request({
    agent,
    toolName,
    ...(callId !== undefined ? { callId } : {}),
    ...(reason ? { reason } : {}),
    ...(displayReason ? { displayReason } : {}),
    ...(signal ? { signal } : {}),
  });

  if (outcome === 'allowed-once') return;

  // 四种结果三种失败，各自给不同的码 —— 见 WRITE_CODES 的说明。
  if (outcome === 'rejected') {
    throw new WriteRejected(WRITE_CODES.NOT_APPROVED, '用户没有批准这次写操作，已停止。', { toolName, outcome });
  }
  if (outcome === 'cancelled') {
    throw new WriteRejected(WRITE_CODES.CANCELLED, '这次写操作被中止了。', { toolName, outcome });
  }
  // `'unavailable'` 与非词表返回值都落这里 —— fail closed。
  throw new WriteRejected(
    WRITE_CODES.NO_CHANNEL,
    '审批没有可用的应答通道，写操作不会执行。',
    { toolName, outcome },
  );
}

/**
 * 把一次写操作包成「先审批、再执行」。
 *
 * # 为什么审批与执行要绑在一起
 *
 * 若让每个工具自己写「先 request 再 act」，忘掉一次就是一次无审批写入，
 * 而那种漏洞**不会表现为报错** —— 它表现为「某天有人发现作业被交了」。
 * 所以这里只提供一个入口，工具定义里不出现裸的 `act()`。
 *
 * @param options.approval - 审批服务。
 * @param options.agent - 发起请求的 agent（必填：审计要写进它的 session log）。
 * @param options.act - `(signal) => Promise<T>`，真正的写动作。
 * @param options.signal - 中止信号。
 * @param options.toolName - 工具名。
 * @param options.callId - 本次调用 id。
 * @param options.reason - 给人看的说明。
 * @param options.displayReason - 本地化版本。
 * @returns {Promise<T>} 写动作的返回值。
 * @throws {WriteRejected} 未批准，或写动作本身抛错（原样透传）。
 */
export async function guardWrite({ approval, agent, act, signal, toolName, callId, reason, displayReason }) {
  signal?.throwIfAborted();
  await requireApproval({ approval, agent, toolName, callId, reason, displayReason, signal });
  // 审批可能耗时很久，回来之后再确认一次没被中止 —— 否则会在用户已经走开的
  // 情况下把写发出去。
  signal?.throwIfAborted();
  return act(signal);
}

/**
 * 一个动作的中文说明（给审批对话框用）。
 *
 * 写操作要在对话框里说清**具体做了什么**，不能只写「执行写操作」——
 * 用户需要凭这句话决定批不批。
 *
 * @param action - 动作短语，如「选课」「报名」。
 * @param target - 对象描述，如课程名与班次。
 * @param detail - 额外细节（周次、时段等）。
 * @returns 一句话。
 */
export function describeWrite(action, target, detail) {
  const tail = detail ? `（${detail}）` : '';
  return `即将${action}：${target}${tail}。这会改变你在平台上的状态，批准后立即生效。`;
}
