/**
 * **共享队列 + 全局 worker 池**：vision 往队列里产，mix 从队列里取。
 *
 * # 为什么要有这一层
 *
 * 旧实现的形状是「先把所有页 vision 完，再统一 mix」，于是：
 *   · vision 阶段 mix 的并发额度全空着，反之亦然 —— **总时长 = 两段之和**；
 *   · 想调速度只能改某一阶段的并发，而真正决定时长的是**一次能同时跑几个**。
 *
 * 现在只有一个队列和 N 个 worker：**影响速度的有且只有一次性并发数**。
 * 一门课和四门课在调度器眼里只是「队列里工作量不同」。
 *
 * # 背压
 *
 * 队列有上限。vision 产得比 mix 快时，产的那一侧**等**（而不是把内存吃满），
 * 这正是用户要的"堵住上游"而不是"悄悄堆积"。
 *
 * ⚠️ 这里**不做重试、不做缓存、不认识页面**：它只管"谁在什么时候拿到一个
 *    工作项"。所有业务语义留在调用方 —— 否则调度器会变成第二个解析器。
 */

/** 一个可以关闭的异步队列（FIFO，有上限，支持取消）。 */
export class SharedQueue {
  /**
   * @param {{capacity?:number, signal?:AbortSignal}} [options]
   *   `capacity` 是**未消费**项的上限；生产者超过它就等。
   */
  constructor({ capacity = 32, signal } = {}) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError('队列上限须为正整数');
    this.capacity = capacity;
    this.signal = signal;
    this.items = [];
    this.closed = false;
    this._waiters = new Set();     // 等取货的消费者
    this._producers = new Set();   // 等空位的生产者
    this.stats = { produced: 0, consumed: 0, peak: 0, waitedForSlot: 0, waitedForItem: 0 };
  }

  /** 当前队列深度。调度器判背压时要读它，所以必须暴露。 */
  get length() { return this.items.length; }

  #rejectIfAborted() { this.signal?.throwIfAborted(); }

  #wake(set) { for (const fn of [...set]) fn(); }

  /** 生产者：放一项进去；队列满就**等**（这就是背压）。 */
  async push(item) {
    while (!this.closed && this.items.length >= this.capacity) {
      this.stats.waitedForSlot++;
      await new Promise((resolve) => {
        const entry = () => { this._producers.delete(entry); this.signal?.removeEventListener('abort', cancel); resolve(); };
        // ⚠️ abort 时**resolve** 而不是 reject：拒绝会留下一个没人 await 的
        //    rejected promise（取消路径上必然发生），在 Node 里就是
        //    unhandledRejection。取消的判断统一交给下面的 throwIfAborted()。
        const cancel = () => { this._producers.delete(entry); resolve(); };
        this._producers.add(entry);
        this.signal?.addEventListener('abort', cancel, { once: true });
      });
      this.#rejectIfAborted();
    }
    if (this.fatal) throw this.fatal;      // 失败取消：生产者立即收手
    this.#rejectIfAborted();
    if (this.closed) return false;
    this.items.push(item);
    this.stats.produced++;
    this.stats.peak = Math.max(this.stats.peak, this.items.length);
    this.#wake(this._waiters);
    return true;
  }

  /** 消费者：取一项；没有就**等**，队列关闭且空了返回 `null`（= 收工信号）。 */
  async take() {
    for (;;) {
      if (this.fatal) throw this.fatal;      // 失败取消：把真实错误传出去
      this.#rejectIfAborted();
      if (this.items.length) {
        const item = this.items.shift();
        this.stats.consumed++;
        this.#wake(this._producers);   // 让等空位的生产者进来
        return item;
      }
      if (this.closed) return null;
      this.stats.waitedForItem++;
      await new Promise((resolve) => {
        const entry = () => { this._waiters.delete(entry); this.signal?.removeEventListener('abort', cancel); resolve(); };
        const cancel = () => { this._waiters.delete(entry); resolve(); };   // 同上：resolve，由上面统一抛
        this._waiters.add(entry);
        this.signal?.addEventListener('abort', cancel, { once: true });
      });
    }
  }

  /** 关闭：不再收新项，但**已经进去的仍会被取完**（不丢工作）。 */
  close() {
    this.closed = true;
    this.#wake(this._waiters);
    this.#wake(this._producers);
  }

  /**
   * 立即作废：丢掉未消费项，所有等待者解除。
   *
   * @param {Error} [reason] 致命原因。记下来供 `take()` / `push()` 抛出，
   *   让"消费者先挂 → 生产者还在填队列"这种局面**立刻收场**，
   *   而不是让生产者永久等在空位上。
   *
   * 传 reason 时行为是"**失败**取消"（等待者会被抛错），
   * 不传时是"**正常**收工"（等待者拿到 null / false）。
   */
  abort(reason) {
    if (reason) this.fatal = reason;
    this.closed = true;
    this.items.length = 0;
    this.#wake(this._waiters);
    this.#wake(this._producers);
  }

  get size() { return this.items.length; }
}

/**
 * 跑一条**生产者 / 消费者**流水线。
 *
 * 形状固定为：一个生产者（可以是并发的多个生产任务）+ N 个消费者 worker，
 * 共享同一个队列。**并发上限只由 `workers` 决定** —— 这正是演示里
 * 「影响速度的有且只有一次性并发数」那句的实现。
 *
 * @param {object} options
 * @param {(queue:SharedQueue)=>Promise<void>} options.produce 生产者；结束时自己 close 队列
 * @param {(item:any, index:number)=>Promise<void>} options.consume 单个工作项
 * @param {number} options.workers 消费者数量（= 一次性并发数）
 * @param {number} [options.capacity] 队列上限（背压）
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{queue:SharedQueue, consumed:number}>}
 */
/**
 * **调度器**：谁在什么时候拿到工作。
 *
 * # 直接对应图 `queue-pipeline.html` 的 `pick(s)`
 *
 * 图里那套逻辑有四条**互相牵制**的规则，缺一条就会出问题：
 *
 * ① **背压要算在飞预留。**
 *    判据是 `queue.length + reserved + batchSize <= cap`。
 *    只看 `queue.length` 会漏掉"已认领但还没 push"的页 —— 那些页马上就要
 *    落到队列里。实测只看长度时峰值冲到 52/40。
 *
 * ② **认领必须当场生效。**
 *    同一 tick 里多个 worker 会拿到同一个 `produced` 旧值，各算一次剩余页，
 *    结果同一门课被重复产出（实测 30 页变 32 页）。所以 `claim()` 立刻
 *    累加 `reserved`，不留"稍后再记"的窗口。
 *
 * ③ **轮流喂课。**
 *    固定按顺序取第一门课会把它喂饱、后面的饿死。用 `ticks % 可产课数`
 *    轮转，每门课都能推进。
 *
 * ④ **队列够深时优先消费。**
 *    队列深度 ≥ worker 数就先做 mix，压低单页延迟；否则先生产，
 *    让队列长起来。这条决定"稳态时队列深度大约等于 worker 数"。
 *
 * # 为什么单独成类而不是塞进 `runPipeline`
 *
 * 调度是**纯决策**（给定状态，返回该干什么），没有 IO。单独出来才能
 * 用单测把上面四条逐条钉住 —— 塞进异步流程里就只能靠"跑一遍看看"。
 */
export class PipelineScheduler {
  /**
   * @param {object} options
   * @param {SharedQueue} options.queue
   * @param {number} options.capacity   队列硬上限。
   * @param {number} [options.batchSize] 一次认领多少页（= vision 批大小）。
   * @param {number} [options.workers]   消费者数；决定"多深算够深"。
   */
  constructor({ queue, capacity, batchSize = 1, workers = 1 }) {
    this.queue = queue;
    this.capacity = Math.max(1, capacity);
    this.batchSize = Math.max(1, batchSize);
    this.workers = Math.max(1, workers);

    /** 已认领但还没 push 进队列的页数。 */
    this.reserved = 0;
    /** 各课程的生产进度。 */
    this.courses = new Map();
    this.ticks = 0;
  }

  /** 登记一门课（一次解析 = 一门课）。 */
  addCourse(id, total) {
    this.courses.set(id, { id, total: Math.max(0, total), produced: 0 });
    return this;
  }

  /** 该课已产完。 */
  markProduced(id, pages) {
    const c = this.courses.get(id);
    if (c) c.produced = Math.min(c.total, c.produced + Math.max(0, pages));
    return this;
  }

  /** 还有哪些课可以产。 */
  producers() {
    return [...this.courses.values()].filter((c) => c.produced < c.total);
  }

  allProduced() {
    return this.producers().length === 0;
  }

  /** 背压：算上在飞预留之后，还能不能再认领一批。 */
  canVision() {
    if (!this.producers().length) return false;
    return this.queue.length + this.reserved + this.batchSize <= this.capacity;
  }

  /** 队列够深（≥ worker 数）就该先消费。 */
  shouldMixFirst() {
    const hasMix = this.queue.length > 0;
    if (!hasMix) return false;
    return this.queue.length >= this.workers || !this.producers().length;
  }

  /**
   * 认领一批页。
   *
   * @returns {{courseId:string, pages:number, start:number}|null} 无课可产时 null。
   *
   * ⚠️ 认领**当场**累加 `reserved` 与 `produced` —— 这是防重复产出的关键。
   */
  nextVision() {
    const producers = this.producers();
    if (!producers.length) return null;
    if (!this.canVision()) return null;

    this.ticks += 1;
    /* 轮流喂课，避免某一门被饿死。 */
    const course = producers[this.ticks % producers.length];
    const pages = Math.min(this.batchSize, course.total - course.produced);
    if (pages <= 0) return null;

    const start = course.produced + 1;
    course.produced += pages;      // 当场生效，防止同 tick 重复认领
    this.reserved += pages;
    return { courseId: course.id, pages, start };
  }

  /**
   * 手工预留 N 页（测试与外部编排用）。
   *
   * 正常路径由 `nextVision()` 自动预留；这个方法只在"页面已经交给
   * 某个异步任务、但还没 push 进队列"这类场合显式登记。
   */
  reserve(pages) {
    const n = Math.max(0, Math.trunc(pages));
    this.reserved += n;
    return this.reserved;
  }

  /** `nextVision()` 的别名 —— "认领一批"。 */
  claim(pages = this.batchSize) {
    const job = this.nextVision();
    return job ? job.pages : 0;
  }

  /** 某次认领的页真的进了队列（或彻底失败），把预留还回去。 */
  settle(pages) {
    this.reserved = Math.max(0, this.reserved - Math.max(0, pages));
    return this.reserved;
  }

  /** 一次调度决策（与图里 `pick()` 同序）。 */
  pick() {
    if (this.queue.length > 0 && (this.shouldMixFirst())) return { kind: 'mix' };
    if (this.canVision()) {
      const job = this.nextVision();
      /* ⚠️ `nextVision()` 自己也会判断 `canVision()` 并累加 ticks，
       * 这里再调一次会让 ticks 走两步、轮转错位。所以上面那次判断只是
       * 提前返回，真正认领只在这里发生。 */
      if (job) return { kind: 'vision', ...job };
    }
    if (this.queue.length > 0) return { kind: 'mix' };
    return null;
  }

  /** 快照（观测/日志用）。 */
  stats() {
    return {
      reserved: this.reserved,
      queueLength: this.queue.length,
      courses: [...this.courses.values()].map((c) => ({ id: c.id, produced: c.produced, total: c.total })),
      ticks: this.ticks,
    };
  }
}

export async function runPipeline({ produce, consume, workers, capacity = 32, signal, onFatal, onQueue }) {
  if (!Number.isInteger(workers) || workers < 1) throw new RangeError('worker 数须为正整数');
  const queue = new SharedQueue({ capacity, signal });
  /* 让调用方拿到队列（调度器要在建好后才能读长度、判背压）。 */
  onQueue?.(queue);

  /* 消费者**自己**报错时，必须能把生产者叫醒并收场。
   *
   * # 早先的死锁
   *
   * 旧实现是 `await produce(queue)` → 再 `Promise.allSettled(consumers)`。
   * 只要一个消费者在 `consume()` 里抛错就退出循环，消费者少了一个；
   * 如果恰好是**唯一**的消费者（或全部）退出，就再没人 `take()`。
   * 生产者随后在 `queue.push()` 上等空位 → 永远等不到 → `produce` 永不返回
   * → 整个 `parse()` 挂死。而且那个退出消费者的 promise 已经 reject 了、
   * 却没人 await，就是 `unhandledRejection`（Node 默认会杀掉进程）。
   *
   * # 现在的收场顺序
   *
   * ① 任何一个消费者失败 → 立刻置 `fatal` 并 `queue.abort(err)`：
   *    叫醒所有等空位的生产者（让它们抛）、叫醒所有等取货的消费者（让它们拿到 null 退出）。
   * ② 生产者的失败同样记进 `fatal` 并 abort，让消费者能退出。
   * ③ 两边都被 await（`Promise.allSettled`），永远不会留下没人接的 rejection。
   * ④ 最后统一抛第一个真实错误。
   */
  let fatal = null;
  const fail = (error) => {
    if (!fatal) fatal = error;
    /* 让所有等待者立刻动起来：生产者等空位、消费者等取货。 */
    queue.abort(error);
    try { onFatal?.(error); } catch { /* 观测回调不许影响收场 */ }
  };

  let index = 0;
  const consumers = Array.from({ length: workers }, async () => {
    for (;;) {
      let item;
      try {
        item = await queue.take();
      } catch (error) {
        /* abort 导致的取货失败：正常收场，不算新错误。 */
        if (fatal) return;
        fail(error);
        return;
      }
      if (item === null) return;
      try {
        await consume(item, index++);
      } catch (error) {
        fail(error);
        return;
      }
    }
  });

  /* 消费者**不 await**，但要立刻挂一个兜底 catch，
   * 防止"还没轮到 allSettled 就已经 reject"的窗口里报 unhandledRejection。 */
  const guarded = consumers.map((p) => p.catch((error) => { fail(error); }));

  let produced = null;
  try {
    produced = await produce(queue);
  } catch (error) {
    /* 生产者失败：记下来，并叫醒消费者，否则它们会一直等一个永远不会来的项。 */
    fail(error);
  } finally {
    queue.close();
  }

  await Promise.all(guarded);

  const failure = fatal ?? produced?.error ?? null;
  if (failure) throw failure;
  return { queue, consumed: queue.stats.consumed };
}
