/**
 * 把「供应商 + 每供应商 worker 数」的池子接到课堂生成上。
 *
 * # 为什么要这一层
 *
 * 讲义链路早就用 `WorkerPoolLlm`（`core-parser/worker-pool.js`）定义并发：
 * 一个池子由若干 `{ provider, model, workers }` 组成，**总并发 = Σ workers**，
 * 请求进来按负载均衡分给各供应商，超出配额的排队。
 *
 * 课堂生成最初只有「一个 provider + 一个 model」，于是章节并发只能写成
 * 一个裸数字 —— 那等于**绕过**了这套调度：既不能跨供应商分摊，也没有配额
 * 约束，用户还得同时理解「章节数」和「并发数」两个东西。
 *
 * 所以这里只做**形状适配**：把课堂生成的窄接口
 * `call({ stage, messages, signal }) → string` 接到池子的
 * `execute(work, { signal })` 上，让 `work` 拿到池子分配好的 route。
 *
 * # 为什么池子是注入的鸭子类型
 *
 * 本包不依赖 `core-parser`（那边拖着 sharp 之类的原生依赖）。池子只要求两个成员：
 *   - `execute(work, { signal })`：`work(route)` 在拿到配额后才执行
 *   - `concurrency`：总并发（Σ workers），章节并发的天然上限
 * 这样 `core-study` 用 `parser.createRun({ workers })` 造出来的池子可以直接传进来，
 * 测试里也能塞一个假的。
 */

/**
 * @param {object} pool 池子端口：`{ execute(work, {signal}), concurrency }`
 * @param {(request: object) => Promise<string>} transport 宿主窄通道
 * @returns {{ call: (request: object) => Promise<string>, concurrency: number }}
 */
export function adaptPoolTransport(pool, transport) {
  if (!pool || typeof pool.execute !== 'function') {
    throw new Error('LLM 池子需要 execute(work, { signal })');
  }
  if (typeof transport !== 'function') throw new Error('LLM 池子需要一个宿主通道');

  return {
    /** 总并发 = Σ workers；章节并发用它，不再另设上限。 */
    concurrency: Number.isInteger(pool.concurrency) && pool.concurrency > 0 ? pool.concurrency : 1,

    async call(request = {}) {
      const { signal } = request;
      // 池子负责排队与选供应商：`route` 里已经带着 provider/model 及各档设置。
      return pool.execute(async route => {
        if (signal?.aborted) throw Object.assign(new Error('已取消'), { code: 'CANCELLED' });
        const text = await transport({
          ...request,
          // route 是池子分配的（可能和调用方默认的不一样），必须以它为准。
          provider: route?.provider ?? request.provider,
          model: route?.model ?? request.model,
          route,
          signal,
        });
        return typeof text === 'string' ? text : String(text ?? '');
      }, { signal });
    },
  };
}
