/**
 * 课堂宿主包的领域错误。
 *
 * 写法照 `dsh-zhiyun-host-deeptutor/src/protocol.js`：错误种类是一份**封闭枚举**，
 * 未知种类一律落回 `E_INTERNAL`，绝不静默吞掉。理由同那边：
 *
 * - 上层（页面包 / 领域包）靠 `kind` 决定「重试还是提示用户」，
 *   如果把上游失败混进「配置错误」，重试逻辑会去重试一个永远失败的请求；
 * - `kind` 是**写进 contract 的**，改了就是破坏性变更，所以它必须集中在这一个文件里。
 *
 * 与 DeepTutor 的差别只有一条：那边还有 Python 运行时那一层，这边的失败面是
 * 「上游 route 迁移进度」与「宿主服务缺失」，所以种类是新的这七个。
 */

/**
 * 错误 taxonomy。
 *
 * | kind | 谁的问题 | 页面该怎么办 |
 * |---|---|---|
 * | `E_NOT_IMPLEMENTED` | 本包自己：该 service 方法还是空壳 | 显示「尚未迁移」，别重试 |
 * | `E_DISABLED` | 组合层：本 profile 没启用课堂子系统 | 显示占位 |
 * | `E_MISSING_SERVICE` | 组合层：依赖的 `ctx.*` 服务没装/没就绪 | 显示「需要 X 插件」 |
 * | `E_UPSTREAM_ERROR` | 上游（模型、第三方 HTTP）失败 | 可以重试 |
 * | `E_INVALID_INPUT` | 调用方给的入参不合法 | 修正入参，别重试 |
 * | `E_NOT_FOUND` | 引用的 run / 课堂 / 资产不存在 | 刷新列表 |
 * | `E_CANCELLED` | 调用方自己取消的 | 忽略 |
 *
 * 刻意**不**设 `E_INTERNAL` 作为「兜底可重试」：`E_INTERNAL` 表示我们自己的代码
 * 走到了不该到的分支，重试没有意义，上报才有。
 */
export const ERROR_KINDS = Object.freeze([
  'E_NOT_IMPLEMENTED',
  'E_DISABLED',
  'E_MISSING_SERVICE',
  'E_UPSTREAM_ERROR',
  'E_INVALID_INPUT',
  'E_NOT_FOUND',
  'E_CANCELLED',
  'E_INTERNAL',
]);

/** `status().state` 枚举。`partial` = 宿主半边在、领域半边还没搬完。 */
export const STATUS_STATES = Object.freeze([
  'ready',
  'partial',
  'degraded',
  'disabled',
  'conflict',
  'not-implemented',
]);

export class ClassroomError extends Error {
  /**
   * @param {string} kind 见 {@link ERROR_KINDS}；未知值落回 `E_INTERNAL`
   * @param {string} message 给人看的一句话（页面可以直接显示）
   * @param {object} [detail] 结构化细节：`{ upstream, source, hint }`
   */
  constructor(kind, message, detail) {
    super(message);
    this.name = 'ClassroomError';
    this.kind = ERROR_KINDS.includes(kind) ? kind : 'E_INTERNAL';
    // 独立字段而不是只放 message 里：上层要按 `code` 分支，字符串匹配是最脆的写法。
    this.code = this.kind;
    if (detail !== undefined) this.detail = detail;
    // 保留调用栈：空壳方法抛出来后，reviewer 要能一眼看到是谁调的。
    if (Error.captureStackTrace) Error.captureStackTrace(this, ClassroomError);
  }

  toJSON() {
    return {
      kind: this.kind,
      code: this.code,
      message: this.message,
      ...(this.detail === undefined ? {} : { detail: this.detail }),
    };
  }
}

/**
 * 空壳方法的统一出口。
 *
 * `source` 必须是**上游文件的真实路径:行号**，因为「还没搬」的下一步动作就是
 * 去那个位置读代码；只写「未实现」等于把定位成本转嫁给下一个人。
 *
 * @param {string} method 服务方法名，例如 `zhiyunClassroomStudio.generate`
 * @param {string} source 上游源位置，例如 `app/api/generation-runs/route.ts:43-81`
 */
export function notImplemented(method, source) {
  return new ClassroomError('E_NOT_IMPLEMENTED', `${method} 尚未迁移`, {
    method,
    source,
    hint: '本方法是按规范第 4 节声明的形状空壳，等 L1 第二批把该 route 的 handler body 搬进来',
  });
}

/** 依赖的宿主服务缺席。绝不在 `apply()` 里抛，只在被调用时抛。 */
export function missingService(serviceName, why) {
  return new ClassroomError('E_MISSING_SERVICE', `依赖的宿主服务 ${serviceName} 不可用`, {
    service: serviceName,
    detail: why,
  });
}

/** 入参不合法。`field` 指明是哪个字段，免得页面只能显示一整句话。 */
export function invalidInput(message, field) {
  return new ClassroomError('E_INVALID_INPUT', message, field === undefined ? undefined : { field });
}

/** 资源不存在。 */
export function notFound(message, id) {
  return new ClassroomError('E_NOT_FOUND', message, id === undefined ? undefined : { id });
}

/** 内部契约被违反（例如 apply 之后 service 形状不对）。 */
export function internal(message, detail) {
  return new ClassroomError('E_INTERNAL', message, detail);
}
