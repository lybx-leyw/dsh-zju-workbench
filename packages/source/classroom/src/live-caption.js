/**
 * 官方**实时字幕**（对应上游 `zhiyun live start/status/stop/text`）。
 *
 * # 先说清楚这四条到底是什么语义
 *
 * 上游 `core/zju/lib/zhiyun/live-socket.ts` 的注释写着「Official glue 1.9.1
 * read-only subscription」。读了协议之后可以确定它**既不是 WebSocket，也不是 SSE**，
 * 而是 **HTTP comet 长轮询**（`POST` 到 `https://qlite2.cmc.zju.edu.cn/<频道>/glue/ajax`，
 * 服务端 hold 住请求直到有帧或超时）：
 *
 * ```text
 * POST i                          → "uid&token"        // 建会话，拿 uid 与当前 token
 * POST u<uid>&in{"version":"1.9.1"} → 订阅
 * POST o<uid>&<token>             → "t"                // 本次无数据（超时响应，token 不前进）
 *                                 → "<token2>&<frame>" // 有新帧：先换 token，再解 frame
 * frame: in / pi / po / cd<size>&m<json> / cl / dr / iv / other-channel
 * ```
 *
 * 生命周期与心跳（照抄上游，都是实测出来的常量）：
 *
 *   - **无数据时 token 不前进**，所以 `"t"` 必须原样 `continue`，不能当成新 token；
 *   - 空闲 **35 秒**推一次 `pi`，服务端回 `pi` 时要回 `po`；
 *   - 发出 `pi` 后 **8 秒**没有帧 → 判定心跳无响应，连接作废（新建会话）；
 *   - `cl` / `dr` / `iv` 是「被关闭 / 被拒 / 会话失效」，必须重新取地址建会话；
 *   - 停止时要 `POST u<uid>&cl` 主动退订，否则服务端会留着这路订阅。
 *
 * # 在数据源层做长连接合适吗（这是本仓必须自己答的问题）
 *
 * **不完全合适，所以这里做了一个明确的取舍。**
 *
 * 本包其余方法都是「一次请求一次响应」。实时字幕是**持续几十分钟到几小时**的
 * 订阅，还要超时重建、心跳、按课次切换。上游把这件事交给一个**脱离宿主进程的
 * 后台采集器**（`live-task.ts`：Windows 走 WMI 起隐藏进程、POSIX `detached+unref`，
 * 配租约文件 `task.lock/owner.json` 与 `stop.json`），因此 CLI 能「启动后立刻返回」。
 *
 * 本包**不**复制那套进程编排，理由三条：
 *
 *   1. 数据源里 spawn 分离进程并写租约，等于把「进程管理」塞进一个只读读取层；
 *      出问题时的症状是「有进程在跑但没人知道是谁的」。
 *   2. 本包已有「进程内后台任务」的先例（`prefetchInBackground`），语义与
 *      `dispose()` 的取消契约一致；沿用同一套比引入第二种生命周期更容易审。
 *   3. 宿主是常驻的 GUI 进程，不是一次性 CLI —— 「后台进程」在这个宿主里就是
 *      「本进程里的定时器」。
 *
 * 代价（如实写进 README 的「已知限制」）：
 *
 *   - **进程退出 = 采集停止**，没有脱离进程的守护；
 *   - `liveStart()` 返回的是「已经开始采集」，不是「已经在收字」——
 *     连上之前 `connected` 为假；
 *   - 同一个进程里同一个范围只会有一个任务（重复调用复用），
 *     跨进程没有租约，两个进程可能各采一份（互不影响，但会各发一轮请求）。
 *
 * 因此四条方法的语义按「会话」设计，而不是按「进程」：
 *
 *   - `liveStart` —— **只建立会话**（起定时器），立刻返回状态，不阻塞到收字；
 *   - `liveStatus` —— 纯本地快照，**不联网**、不改状态；
 *   - `liveText` —— 取窗口内的**已收**文字，并如实报缺口，不等待未来；
 *   - `liveStop` —— 停定时器、退订、把状态落成 `stopped`。
 */

import { ClassroomError, object } from './errors.js';

/** 上游实测常量：空闲多久补一次 ping、ping 多久没回就判死。 */
export const IDLE_MS = 35000;
export const PING_TIMEOUT_MS = 8000;
/** 一节课结束后还继续听 5 分钟（老师经常拖堂）。 */
export const LESSON_GRACE_MS = 5 * 60000;
/** 开课前 5 分钟开始尝试取地址。 */
export const LESSON_LEAD_MS = 5 * 60000;
/** 没拿到地址时的重试间隔。 */
export const ADDRESS_RETRY_MS = 10000;
/** 断线重连的退避上限。 */
export const RECONNECT_MAX_MS = 30000;
/** 一条字幕允许的最大时长；超过基本可以判定时间字段串了。 */
const MAX_CAPTION_MS = 10 * 60000;

/**
 * 校验并规范化实时字幕地址。
 *
 * 这个地址来自**上游 JSON**（`content.trans_socket_url`），随后会被直接 `POST`。
 * 不做白名单就等于「让上游字段决定我们往哪发请求」，所以规则收得很紧：
 * 只认 `qlite2.cmc.zju.edu.cn`、只认 http(s)、不许带端口与凭证、
 * 路径必须是**单段** `[A-Za-z0-9_-]+`。然后拼成 `<频道>/glue/ajax`。
 *
 * @param {unknown} value
 * @returns {string}
 */
export function subtitleEndpoint(value) {
  const text = String(value ?? '').trim();
  if (!text) throw new ClassroomError('API_SHAPE', '实时字幕地址为空');
  let url;
  try { url = new URL(text); } catch { throw new ClassroomError('API_SHAPE', '未知的官方实时字幕地址'); }
  const bad = !['http:', 'https:'].includes(url.protocol)
    || url.hostname !== 'qlite2.cmc.zju.edu.cn'
    || url.port !== ''
    || url.username !== ''
    || url.password !== ''
    || !/^\/[A-Za-z0-9_-]+\/?$/.test(url.pathname);
  if (bad) throw new ClassroomError('API_SHAPE', '未知的官方实时字幕地址', { host: url.hostname });
  url.pathname = `${url.pathname.replace(/\/$/, '')}/glue/ajax`;
  url.search = '';
  url.hash = '';
  return url.href;
}

/**
 * 解一帧 glue 协议。
 *
 * `cd` 帧的负载是 `<长度>&<频道><JSON>`：长度是**字节数**，频道通常只有 `m`
 * （字幕）。别的频道要显式标成 `other-channel`，**不当成解析失败** ——
 * 上游随时可能加一路通道，把它当错误只会让整个订阅断掉。
 *
 * @param {string} message
 * @returns {{command: string, data?: unknown}}
 */
export function decodeFrame(message) {
  const frame = String(message ?? '');
  const command = frame.slice(0, 2);
  const rest = frame.slice(2);
  if (command === 'cd') {
    const match = /^(\d+)&/.exec(rest);
    if (!match) throw new ClassroomError('API_SHAPE', '字幕频道帧无效');
    const size = Number(match[1]);
    const payload = rest.slice(match[0].length);
    if (!Number.isSafeInteger(size) || size < 1 || size > payload.length) throw new ClassroomError('API_SHAPE', '字幕频道长度无效');
    const channel = payload.slice(0, size);
    if (channel !== 'm') return { command: 'other-channel' };
    try { return { command, data: JSON.parse(payload.slice(size)) }; }
    catch { throw new ClassroomError('API_SHAPE', '字幕消息不是有效 JSON'); }
  }
  if (command === 'in') {
    let data;
    try { data = JSON.parse(rest); } catch { throw new ClassroomError('API_SHAPE', '字幕握手响应无效'); }
    if (typeof data?.socketID !== 'string' || !data.socketID) throw new ClassroomError('API_SHAPE', '字幕握手缺少 socketID');
    return { command };
  }
  if (['pi', 'po', 'cl', 'dr', 'iv'].includes(command)) return { command };
  throw new ClassroomError('API_SHAPE', '未知字幕协议帧');
}

/**
 * 规范化一条实时字幕。
 *
 * 时间字段是**毫秒时间戳**，而且顺序会翻转（`text_end_time < text_begin_time`
 * 的情况真实存在），所以取 min/max 并记下 `fieldOrder`。
 *
 * 所有边界都要查：超出课次窗口、比接收时间还晚、单段超过 10 分钟，
 * 都说明字段串了。**宁可丢这一条并报错，也不要把接收时间伪装成字幕时间** ——
 * 那会让「老师这句话在第几分钟说的」永久错位。
 *
 * @returns {object|null} 空文本返回 null（不是错误：静音段就是这样）。
 */
export function normalizeCaption(value, { receivedAt, startsAt, endsAt, subId } = {}) {
  const row = object(value) ? value : null;
  if (!row) throw new ClassroomError('API_SHAPE', '实时字幕不是对象');
  if (row.error) throw new ClassroomError('BUSINESS', '官方字幕上游报告错误');
  if (typeof row.sourcetext !== 'string') throw new ClassroomError('API_SHAPE', '实时字幕缺少原文');
  const text = row.sourcetext.trim();
  if (!text) return null;
  const final = Number(row.end_time);
  if (![1, -1].includes(final)) throw new ClassroomError('API_SHAPE', '实时字幕定稿标识无效');
  const begin = Number(row.text_begin_time);
  const end = Number(row.text_end_time);
  const time = Number(row.time);
  if (![begin, end, time].every(Number.isSafeInteger)) throw new ClassroomError('API_SHAPE', '实时字幕时间字段非整数');
  const startMs = Math.min(begin, end);
  const endMs = Math.max(begin, end);
  const outside = (Number.isFinite(startsAt) && startMs < startsAt - LESSON_LEAD_MS)
    || (Number.isFinite(endsAt) && endMs > endsAt + LESSON_GRACE_MS)
    || (Number.isFinite(receivedAt) && endMs > receivedAt + 60000)
    || endMs - startMs > MAX_CAPTION_MS
    || (time !== begin && time !== end);
  if (outside) throw new ClassroomError('API_SHAPE', '实时字幕时间字段异常，未将其伪造为接收时间');
  return {
    id: `${subId ?? ''}:${startMs}:${endMs}:${text}`,
    startMs,
    endMs,
    receivedAtMs: receivedAt ?? null,
    text,
    final: final === 1,
    fieldOrder: begin <= end ? 'normal' : 'reversed',
  };
}

/** 给状态里用的时间串（`+08:00` 形态），与上游 `beijingTime` 同口径。 */
export function beijingTime(ms) {
  if (!Number.isFinite(ms)) return null;
  return new Date(ms + 8 * 3600000).toISOString().replace('Z', '+08:00');
}

/** 一条课次的采集状态。`interval` 记录「真的在听」的时间段，`text` 用它算缺口。 */
function lessonState(lesson) {
  return {
    courseId: String(lesson.courseId ?? ''),
    subId: String(lesson.subId ?? ''),
    title: String(lesson.title ?? ''),
    room: lesson.room ? String(lesson.room) : null,
    startsAt: Number(lesson.startsAt ?? 0),
    endsAt: Number(lesson.endsAt ?? 0),
    status: 'waiting',
    connected: false,
    captions: [],
    seen: new Set(),
    intervals: [],
    initialCount: 0,
    lastActivityAt: null,
    lastCaptionAt: null,
    latest: null,
    error: null,
    failed: 0,
  };
}

/**
 * 计算「窗口里没被监听到的」时间段。
 *
 * 这是 `liveText` 敢说 `partial` 的依据：晚启动、断线、进程被杀都会留下空洞，
 * 而空洞里的文字**补不回来**（实时字幕不存档）。所以必须逐段报出来，
 * 不能拿「窗口内有的句子」冒充「窗口内所有句子」。
 */
export function missingIntervals(start, end, intervals, now) {
  const gaps = [];
  let cursor = start;
  for (const interval of [...intervals].sort((a, b) => a.start - b.start)) {
    const a = Math.max(start, interval.start);
    const b = Math.min(end, interval.end ?? now);
    if (b <= cursor || a > end) continue;
    if (a > cursor) gaps.push({ start: cursor, end: a });
    cursor = Math.max(cursor, b);
  }
  if (cursor < end) gaps.push({ start: cursor, end });
  return gaps;
}

/**
 * 进程内的实时字幕采集任务。
 *
 * 一个实例 = 一个任务 = 一批课次。`start()` 立即返回，采集在后台跑；
 * `dispose()` 会等后台真的收手（与 `ClassroomSource.dispose` 同一套契约）。
 */
export class LiveCollector {
  /**
   * @param {object} options
   * @param {object} options.live - `LiveSource` 实例（取地址用）。
   * @param {Array<object>} options.lessons - `[{courseId,subId,title,room,startsAt,endsAt}]`。
   * @param {(event: object) => void} [options.log]
   * @param {number} [options.pollMs] - 两次轮询之间的最小间隔（测试里给 0）。
   * @param {() => number} [options.now]
   * @param {(ms: number, signal: AbortSignal) => Promise<void>} [options.sleep]
   * @param {object} [options.store] - `{ read(), append(caption) }`，可选落盘。
   */
  constructor({ live, lessons, log = () => {}, pollMs = 0, now = () => Date.now(), sleep, store = null } = {}) {
    if (!live || typeof live.subInfo !== 'function') throw new TypeError('实时字幕需要注入 live');
    if (!Array.isArray(lessons)) throw new TypeError('实时字幕需要课次列表');
    this.live = live;
    this.log = log;
    this.pollMs = pollMs;
    this.now = now;
    this.store = store;
    this.sleep = sleep ?? ((ms, signal) => wait(ms, signal));
    this.lessons = lessons.map(lessonState);
    this.status = 'starting';
    this.startedAt = now();
    this.updatedAt = this.startedAt;
    this.error = null;
    this.controller = new AbortController();
    this.worker = null;
  }

  get signal() { return this.controller.signal; }

  /** 任务范围标识（`liveStart` 判断「是不是同一个范围」用）。 */
  get scope() {
    return this.lessons.map((l) => `${l.courseId}:${l.subId}`).sort().join(',');
  }

  /** 起后台采集。**不 await 采集本身**，返回 this。 */
  start() {
    this.worker = this.run().catch((error) => {
      if (this.signal.aborted) return;
      this.error = error?.message ?? String(error);
      this.status = 'failed';
      this.log({ event: 'live-failed', error: this.error });
    });
    return this;
  }

  async run() {
    this.status = 'running';
    await Promise.allSettled(this.lessons.map((lesson) => this.collect(lesson)));
    if (this.signal.aborted) { this.status = 'stopped'; return; }
    this.status = 'ended';
  }

  /** 单节课从「等开课」到「听完」的完整循环。 */
  async collect(lesson) {
    const deadline = lesson.endsAt ? lesson.endsAt + LESSON_GRACE_MS : Infinity;
    // 还没开课就先等 —— 但等待本身要能被 stop 打断。
    const lead = lesson.startsAt ? lesson.startsAt - LESSON_LEAD_MS : this.now();
    if (lead > this.now()) await this.sleep(lead - this.now(), this.signal);
    while (!this.signal.aborted && this.now() < deadline) {
      let address;
      try {
        const info = await this.live.subInfo(lesson.courseId, lesson.subId, { signal: this.signal });
        if (this.signal.aborted) break;
        if (info.ended) { lesson.status = 'ended'; this.touch(); return; }
        address = info.address;
      } catch (error) {
        if (this.signal.aborted) break;
        lesson.status = 'reconnecting';
        lesson.error = error?.message ?? String(error);
        this.touch();
        await this.sleep(this.backoff(lesson), this.signal);
        continue;
      }
      if (!address) {
        // 还没开播：上游的地址字段要到开讲之后才出现。
        lesson.status = 'waiting';
        this.touch();
        await this.sleep(Math.min(ADDRESS_RETRY_MS, Math.max(0, deadline - this.now())), this.signal);
        continue;
      }
      try {
        await this.receive(lesson, address);
        lesson.failed = 0;
      } catch (error) {
        if (this.signal.aborted) break;
        lesson.status = 'reconnecting';
        lesson.error = error?.message ?? String(error);
        lesson.failed += 1;
        this.touch();
        await this.sleep(this.backoff(lesson), this.signal);
      }
    }
    if (this.signal.aborted) { lesson.status = 'stopped'; this.closeInterval(lesson); }
    else if (lesson.status !== 'ended') { lesson.status = 'ended'; this.closeInterval(lesson); }
    this.touch();
  }

  /** 断线退避：1s、2s、4s… 上限 30s，且不超过离截止还有多久。 */
  backoff(lesson) {
    const deadline = lesson.endsAt ? lesson.endsAt + LESSON_GRACE_MS : Infinity;
    const delay = Math.min(RECONNECT_MAX_MS, 1000 * 2 ** Math.min(lesson.failed, 5));
    return Math.max(0, Math.min(delay, deadline - this.now()));
  }

  /** 一次「建会话 → 订阅 → 轮询到断」的完整 glue 生命周期。 */
  async receive(lesson, address) {
    const endpoint = subtitleEndpoint(address);
    const post = async (body, signal = this.signal) => {
      const result = await this.live.transport.request(endpoint, {
        method: 'POST',
        body,
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        // 长轮询一次可能 hold 很久；给 45 秒，与上游一致。
        timeoutMs: 45000,
        signal,
      });
      if (result.status !== 200) throw new ClassroomError('BUSINESS', `实时字幕 HTTP ${result.status}`, { status: result.status });
      return result.text;
    };
    const push = (message) => post(`u${uid}&${message}`).then(() => undefined);
    let uid = '', token = '', connected = false;
    let lastActivity = this.now();
    let pingAt = 0;
    let ping = null;
    let failure = null;

    const initial = await post('i');
    const match = /^([A-Za-z0-9_-]+)&([A-Za-z0-9_-]+)$/.exec(initial);
    if (!match) throw new ClassroomError('API_SHAPE', '字幕连接初始化无效');
    [uid, token] = [match[1], match[2]];
    await push('in{"version":"1.9.1"}');

    const timer = setInterval(() => {
      if (ping || this.signal.aborted || !connected) return;
      if (pingAt && this.now() - pingAt > PING_TIMEOUT_MS) {
        failure = new ClassroomError('TIMEOUT', '字幕心跳无响应');
        this.controller.abort();
        return;
      }
      if (this.now() - lastActivity < IDLE_MS || pingAt) return;
      pingAt = this.now();
      ping = push('pi').catch((error) => { failure = error; this.controller.abort(); }).finally(() => { ping = null; });
    }, 1000);
    timer.unref?.();

    try {
      while (!this.signal.aborted) {
        if (this.pollMs > 0) await this.sleep(this.pollMs, this.signal);
        // 让一次步再发下一轮。看起来多余，但 `await` 一个**已解决**的 promise 只是
        // 一个微任务，不会把控制权交给定时器 —— 轮询在本地立刻返回时（假 fetch、
        // 或上游 hold 极短）会变成一个饿死事件循环的死循环，abort 永远收不到。
        // 上游 asr.ts 的 `breathe()` 是同一个理由。
        else await new Promise((resolve) => setImmediate(resolve));
        const response = await post(`o${uid}&${token}`);
        // 超时响应（整个响应体就是一个 `t`）不前进 token：当成「这次没数据」，原样继续。
        if (response === 't') continue;
        if (response === 'c') throw new ClassroomError('BUSINESS', '字幕连接已由服务端关闭');
        const split = response.indexOf('&');
        const next = response.slice(0, split);
        if (split <= 0 || !/^[A-Za-z0-9_-]+$/.test(next)) throw new ClassroomError('API_SHAPE', '字幕轮询令牌无效');
        token = next;
        const frame = decodeFrame(response.slice(split + 1));
        lastActivity = this.now();
        pingAt = 0;
        lesson.lastActivityAt = lastActivity;
        if (frame.command === 'in') {
          connected = true;
          lesson.connected = true;
          lesson.status = 'connected';
          this.openInterval(lesson, lastActivity);
          this.touch();
        } else if (frame.command === 'pi') {
          await push('po');
        } else if (frame.command === 'other-channel') {
          // 别的频道与我们无关；不记录、不报错。
        } else if (frame.command === 'cd') {
          if (!connected) throw new ClassroomError('API_SHAPE', '握手前收到字幕消息');
          this.caption(lesson, frame.data, lastActivity);
        } else if (['cl', 'dr', 'iv'].includes(frame.command)) {
          throw new ClassroomError('BUSINESS', `字幕连接被拒绝或关闭（${frame.command}）`);
        }
      }
    } finally {
      clearInterval(timer);
      // 停的时候必须主动退订，否则服务端会留着这路订阅（上游同样处理）。
      if (uid) await post(`u${uid}&cl`, AbortSignal.timeout(2000)).catch(() => {});
      await ping;
    }
    if (failure) throw failure;
  }

  /** 收一条字幕：未定稿只做预览，定稿才入库去重。 */
  caption(lesson, data, receivedAt) {
    let caption;
    try {
      caption = normalizeCaption(data, { receivedAt, startsAt: lesson.startsAt, endsAt: lesson.endsAt, subId: lesson.subId });
    } catch (error) {
      // 单条字段异常不废掉整节课：记在状态里，继续收后面的。
      lesson.error = error?.message ?? String(error);
      this.touch();
      return;
    }
    if (!caption) return;
    if (!caption.final) {
      // 定稿之后再到的旧草稿不能把已定稿的句子复活。
      const through = lesson.captions.reduce((max, item) => Math.max(max, item.endMs), 0);
      if (caption.startMs >= through) lesson.latest = caption;
      this.touch();
      return;
    }
    if (!lesson.seen.has(caption.id)) {
      lesson.seen.add(caption.id);
      lesson.captions.push(caption);
      this.store?.append?.(lesson, caption);
    }
    if (!lesson.latest || lesson.latest.startMs <= caption.endMs) lesson.latest = caption;
    lesson.lastCaptionAt = receivedAt;
    this.touch();
  }

  openInterval(lesson, at) {
    if (lesson.intervals.at(-1)?.end === null) return;
    lesson.intervals.push({ start: at, end: null });
  }

  closeInterval(lesson) {
    const open = lesson.intervals.at(-1);
    if (open?.end === null) open.end = Math.min(this.now(), lesson.lastActivityAt ?? this.now());
  }

  touch() { this.updatedAt = this.now(); }

  /**
   * 状态快照。**纯本地**：不联网、不改状态。
   *
   * 与上游 `liveStatus()` 同口径：`healthy` 为假时，正在跑的状态一律降级成
   * `unavailable` —— 「显示 running 但其实早就死了」是最误导人的一种状态。
   */
  statusView() {
    const now = this.now();
    const alive = !['stopped', 'ended', 'failed'].includes(this.status);
    const lessons = this.lessons.map((lesson) => {
      let status = lesson.status;
      if (!alive && ['waiting', 'connected', 'reconnecting'].includes(status)) {
        status = this.status === 'stopped' ? 'stopped' : this.status === 'ended' ? 'ended' : 'unavailable';
      }
      return {
        courseId: lesson.courseId,
        subId: lesson.subId,
        title: lesson.title,
        room: lesson.room,
        startsAt: beijingTime(lesson.startsAt),
        endsAt: beijingTime(lesson.endsAt),
        status,
        connected: lesson.connected,
        sentences: lesson.captions.length,
        newSentences: Math.max(0, lesson.captions.length - lesson.initialCount),
        lastCaptionAt: beijingTime(lesson.lastCaptionAt),
        lastActivityAt: beijingTime(lesson.lastActivityAt),
        preview: lesson.latest ? { text: lesson.latest.text, final: Boolean(lesson.latest.final) } : null,
        error: lesson.error,
      };
    });
    const sentences = lessons.reduce((sum, item) => sum + item.sentences, 0);
    return {
      status: this.status,
      taskId: this.taskId ?? null,
      scope: this.scope,
      startedAt: beijingTime(this.startedAt),
      updatedAt: beijingTime(this.updatedAt),
      sentences,
      lessons,
      error: this.error,
      // 这条必须显式给：连接成功 ≠ 已经收到字。
      receiving: alive && lessons.some((item) => item.status === 'connected' && item.sentences > 0),
      now: beijingTime(now),
    };
  }

  /**
   * 取窗口内已收的文字。
   *
   * `status` 三态（与上游同名同义）：
   *   - `unavailable` —— 窗口里没有任何课次在采，或课次不匹配；
   *   - `no-text`     —— 有课次，但还没收到字；
   *   - `partial` / `available` —— 有字；`partial` 表示窗口含未监听时段或仍在进行。
   *
   * @param {object} options
   * @param {string} [options.course] - 课程名 / courseId，用于在多课次窗口里消歧。
   * @param {number} [options.at] - 窗口中心（默认现在）。
   * @param {number} [options.before] - 往前多少毫秒（默认 5 分钟）。
   * @param {number} [options.after] - 往后多少毫秒（默认 0；**不等待未来**）。
   */
  text({ course, at, before = 5 * 60000, after = 0 } = {}) {
    const now = this.now();
    const center = Number.isFinite(at) ? at : now;
    const start = center - Math.max(0, before);
    const end = center + Math.max(0, after);
    const inWindow = this.lessons.filter((lesson) => lesson.startsAt - LESSON_LEAD_MS <= end && lesson.endsAt + LESSON_GRACE_MS >= start);
    let matched = inWindow;
    if (course) {
      const wanted = String(course).trim();
      matched = inWindow.filter((lesson) => lesson.title === wanted || lesson.courseId === wanted);
      if (!matched.length) {
        throw new ClassroomError('INVALID_INPUT', `窗口内没有这门课的采集：${wanted}`, {
          candidates: inWindow.map((lesson) => ({ course: lesson.title, courseId: lesson.courseId })),
        });
      }
    }
    if (matched.length > 1) {
      throw new ClassroomError('INVALID_INPUT', '文字窗口对应多个课次，请指定课程或缩小时间范围', {
        candidates: matched.map((lesson) => ({ course: lesson.title, startsAt: beijingTime(lesson.startsAt) })),
      });
    }
    const lesson = matched[0];
    if (!lesson) {
      return {
        status: 'unavailable',
        message: '该时间窗口没有正在采集的课堂字幕；晚启动不能补回此前实时文字。',
        text: '',
        segments: [],
        gaps: [{ start: beijingTime(start), end: beijingTime(end) }],
      };
    }
    const rows = lesson.captions.filter((item) => item.startMs <= end && item.endMs >= start);
    const receiving = this.status === 'running' && lesson.connected && now - (lesson.lastActivityAt ?? 0) < 45000;
    const intervals = lesson.intervals.map((interval) => ({ start: interval.start, end: interval.end ?? (receiving ? now : this.updatedAt) }));
    const gaps = missingIntervals(start, Math.min(end, now), intervals, now);
    const pending = end > now;
    const status = !rows.length ? 'no-text' : gaps.length || pending ? 'partial' : 'available';
    const latest = lesson.latest && !lesson.latest.final && lesson.latest.startMs <= end ? lesson.latest : null;
    return {
      status,
      message: `${lesson.title}：${rows.length} 句已定稿文字。${gaps.length ? '窗口含未监听或断线时段。' : '监听区间连续；官方字幕仍可能漏识别。'}${pending ? '窗口包含尚未发生的时间。' : ''}`,
      course: lesson.title,
      window: { start: beijingTime(start), end: beijingTime(end) },
      text: rows.map((item) => item.text).join('\n'),
      segments: rows.map((item) => ({ start: beijingTime(item.startMs), end: beijingTime(item.endMs), text: item.text, receivedAt: beijingTime(item.receivedAtMs) })),
      preview: latest ? { text: latest.text, final: false } : null,
      pending,
      gaps: gaps.map((gap) => ({ start: beijingTime(gap.start), end: beijingTime(gap.end) })),
      source: 'official-live',
    };
  }

  /** 停：取消定时器、等后台收手、把每条课次落成 `stopped`。 */
  async stop() {
    this.controller.abort();
    if (this.worker) await this.worker;
    this.worker = null;
    for (const lesson of this.lessons) {
      lesson.connected = false;
      if (!['ended'].includes(lesson.status)) lesson.status = 'stopped';
      this.closeInterval(lesson);
    }
    if (this.status !== 'failed') this.status = 'stopped';
    this.touch();
    return this.statusView();
  }
}

/** 可取消的等待。`signal.aborted` 时立刻返回，不抛错（循环自己会检查）。 */
export function wait(ms, signal) {
  if (!Number.isFinite(ms) || ms <= 0 || signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve(); };
    const timer = setTimeout(done, ms);
    timer.unref?.();
    signal?.addEventListener('abort', done, { once: true });
  });
}
