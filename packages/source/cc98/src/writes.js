/**
 * CC98 的写操作：**算参数 + 执行**，两段分开。
 *
 * # 这个文件与 `reads.js` 的分界
 *
 * `reads.js` 只发 GET。本文件发 `PUT` / `POST` / `DELETE`，是**改变外部状态**的动作。
 *
 * # 为什么每个动作都是 `XxxPrepare` + `XxxExecute` 两个方法
 *
 * 审批要在「知道将要做什么」之后、在「真的做」之前发生。所以：
 *
 * | 方法 | 做什么 | 会不会改变状态 |
 * | --- | --- | --- |
 * | `xxxPrepare(args)` | 查库、算 id、拼 body、**算出一句给人看的说明** | 不会 |
 * | `xxxExecute(signal)` | 把算好的东西发出去 | **会** |
 *
 * `packages/tool/campus-write` 拿到这两个方法：先调 Prepare 让用户看说明，
 * 批准后再调 Execute。**数据源不做审批** —— 它不知道什么叫 turn、什么叫审批通道，
 * 那些是宿主概念，不该漏进来。
 *
 * # 一处重要的安全约束
 *
 * `Execute` 依赖 `Prepare` 算好的参数（在同一个 session 对象里）。所以
 * **必须先 Prepare 再 Execute**，跳过 Prepare 直接 Execute 会报 `NEED_PREPARE`。
 * 这不是防御性编程，是防止「参数还没算就发请求」这类低级错。
 */

import { ClassroomError } from '@lybx-leyw/dsh-zju-source-http';

/**
 * 一次写操作的会话：Prepare 存参数，Execute 用参数。
 *
 * 每个动作一个实例（`reader.signIn()` 这类入口内部新建），不跨动作复用 ——
 * 复用会让「上一次的 body 被这一次发出去」变成可能。
 */
class WriteSession {
  constructor() {
    /** @type {{ summarized: string, run: (signal?: AbortSignal) => Promise<unknown> } | null} */
    this.prepared = null;
  }

  /**
   * 记下这次要做什么。
   *
   * @param summarized - 一句给人看的说明（进审批对话框）。
   * @param run - `(signal) => Promise<unknown>`，真正发请求。
   * @returns 说明本身（方便调用方串起来）。
   */
  set(summarized, run) {
    this.prepared = { summarized, run };
    return summarized;
  }

  /**
   * 丢掉这次准备（不执行写请求）。
   *
   * 两个调用点：`execute` 执行完之后（一次 Prepare 只执行一次）、
   * 以及 `cancel`（审批被拒 / 超时 / 中止时由 tool 层调）。
   */
  clear() {
    this.prepared = null;
  }

  /**
   * 执行 Prepare 记下的动作。
   *
   * @param signal - 取消信号。
   * @returns 写操作的结果。
   * @throws {ClassroomError} 没 Prepare 就 Execute。
   */
  async run(signal) {
    if (!this.prepared) {
      throw new ClassroomError(
        'NEED_PREPARE',
        '写操作必须先 Prepare 再 Execute —— 参数还没算出来，不能直接发请求。',
      );
    }
    const { run } = this.prepared;
    return run(signal);
  }
}

/** 参数错误。与平台的拒绝分开：那是服务端说的，这是调用方说错了。 */
const invalid = (message) => new ClassroomError('INVALID_ARGUMENT', message);

/**
 * 校验正整数 id。
 *
 * @param value - 候选值。
 * @param name - 字段名（报错时用）。
 * @returns 数字。
 */
const id = (value, name) => {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw invalid(`${name} 必须是正整数`);
  return number;
};

/**
 * 校验正文。
 *
 * @param value - 正文。
 * @param name - 字段名。
 * @param max - 上限（CC98 回帖上限 8000 字）。
 * @returns 去空白后的正文。
 */
const body = (value, name, max) => {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw invalid(`${name} 不能为空`);
  if (text.length > max) throw invalid(`${name} 超过 ${max} 字`);
  return text;
};

/**
 * 把 CC98 的写方法挂到 reader 上。
 *
 * 每个方法返回 `{ prepare, execute }` 形状的**两个**函数，
 * 由 `index.js` 把它们注册成 `xxxPrepare` / `xxxExecute` 两个服务方法。
 *
 * @param reader - 已构造的 `Cc98Reader`（用到它的 `client`）。
 * @returns 写操作集合。
 */
export function createCc98Writes(reader) {
  const client = reader.client;

  /**
   * 造一对 Prepare / Execute / Cancel。
   *
   * # 为什么有 `cancel`
   *
   * 用户可能**点了拒绝**，也可能审批通道超时/中止 —— 那时 `execute` 永远不会被
   * 调用，而 `prepare` 已经把参数存进了 session。若不撤销，下一次 `prepare`
   * 会撞上上面那个 `WRITE_BUSY` 闸，**这个动作此后一直不能用**（直到重启进程）。
   *
   * 这条是复审查出来的（`recheck-2026-11-11.md` 的 Z-1），七个包全部如此。
   *
   * **拒绝不等于封锁**：撤销之后立刻可以重新准备、重新问用户。
   * 用户拒绝一次是「这次不做」，不是「以后都不许做」。
   *
   * @param name - 动作名（只用于报错）。
   * @param build - `(args) => Promise<{ summarized, run }>`。
   * @returns `{ prepare, execute, cancel }`。
   */
  const pair = (name, build) => {
    const session = new WriteSession();
    return {
      /** 算参数，不发写请求。 */
      prepare: async (args = {}) => {
        if (session.prepared) {
          throw new ClassroomError(
            'WRITE_BUSY',
            `${name} 上一次还没执行完，先别重复准备。`,
            { action: name },
          );
        }
        const { summarized, run } = await build(args);
        session.set(summarized, run);
        return summarized;
      },
      /** 执行 Prepare 记下的动作；执行完清空，避免重放。 */
      execute: async (signal) => {
        try {
          return await session.run(signal);
        } catch (error) {
          // 让报错带上动作名 —— 否则一串「操作失败」里分不清是哪个动作。
          if (error instanceof ClassroomError && !error.details?.action) {
            error.details = { ...(error.details ?? {}), action: name };
          }
          throw error;
        } finally {
          // 一次 Prepare 只能被执行一次：清空之后想再做要重新 Prepare，
          // 那意味着重新问用户 —— 正是我们要的。
          session.clear();
        }
      },
      /**
       * 撤销这次 Prepare（**不执行写请求**）。
       *
       * 审批被拒 / 超时 / 中止时由 tool 层调用。反复调用是安全的 ——
       * 没有准备好的东西时它什么都不做，不报错（报错只会让 tool 的清理逻辑
       * 自己变成新的失败源）。
       */
      cancel: async () => {
        session.clear();
      },
    };
  };

  return {
    signIn: pair('cc98.signIn', async () => {
      // 签到不需要参数 —— 但要先确认「今天是不是已经签过」，否则用户会看到
      // 一次「成功」而实际什么都没发生（平台对重复签到不报错）。
      const status = await client.request('GET', 'me').catch(() => null);
      const signedToday = Boolean(status?.lastSignInTime && isToday(status.lastSignInTime));
      return {
        summarized: signedToday ? '今天已经签到过了（再签一次不会有额外奖励）' : 'CC98 每日签到',
        run: (signal) => client.request('POST', 'me/signin', { signal }),
      };
    }),

    likeFloor: pair('cc98.likeFloor', async (args) => {
      const post = id(args.post, '楼层编号');
      // 三种状态：1 赞、2 踩、0 取消。
      //
      // # 为什么必须支持「取消」
      //
      // 平台的口径是「再发一次当前状态即取消」，等价于发 0。本包原先只认
      // 1 / 2，于是赞错了撤不回 —— 那不是「少一个选项」，是**没有回退路径**。
      // 与 `rateFloor` 的「评分不可撤销」不同，赞踩是随时可改的。
      const raw = args.state ?? args.value;
      const state = raw === 'none' || raw === 0 || raw === '0' || raw === 'cancel'
        ? 0
        : (raw === 'down' || raw === 2 || raw === '2' ? 2 : 1);
      const label = state === 0 ? '取消' : (state === 1 ? '点赞' : '点踩');
      return {
        summarized: `${label}楼层 ${post}`,
        run: (signal) => client.request('PUT', `post/${post}/like`, { body: String(state), signal }),
      };
    }),

    rateFloor: pair('cc98.rateFloor', async (args) => {
      const post = id(args.post, '楼层编号');
      const value = Number(args.value);
      if (!Number.isInteger(value) || value === 0) throw invalid('value 必须是非零整数');
      // 平台用 1 表示正评、2 表示负评；正负由 value 的符号决定。
      const type = value > 0 ? 1 : 2;
      if (args.reason === undefined) throw invalid('评分需要 reason（理由编号）');
      const reasonId = id(args.reason, '理由编号');
      return {
        summarized: `给楼层 ${post} 评 ${value > 0 ? '+' : ''}${value} 分（理由 ${reasonId}）`,
        run: (signal) => client.request('PUT', `post/${post}/rating-v2`, {
          body: { reasonId, type, value: Math.abs(value) },
          signal,
        }),
      };
    }),

    favoriteTopic: pair('cc98.favoriteTopic', async (args) => {
      // topic 与 post 都收：前者是 CC98 的说法（收藏的是主题），
      // 后者是工具层统一用的说法（对用户来说都是「那个帖子」）。
      const topic = id(args.topic ?? args.post, '帖子编号');
      const on = args.on !== false;
      return {
        summarized: on ? `收藏帖子 ${topic}` : `取消收藏帖子 ${topic}`,
        run: (signal) => client.request(on ? 'PUT' : 'DELETE', `me/favorite/${topic}${on ? '?groupid=0' : ''}`, { signal }),
      };
    }),

    postTopic: pair('cc98.postTopic', async (args) => {
      const board = id(args.board, '版面编号');
      const content = body(args.content, '正文', 8000);
      const title = args.title === undefined ? content.slice(0, 30) : body(args.title, '标题', 100);
      // 版面可以要求必选标签。原先写死 `tag1: ''`，于是**有必选标签的版面
      // 直接发不出去** —— 平台会回一句「请选择标签」，用户却看到浏览器
      // 里明明能选。所以这里三个字段都要收。
      const tag1 = args.tag1 ?? args.tag ?? '';
      const tag2 = args.tag2 ?? args.subTag ?? '';
      const form = new URLSearchParams({ title, content, type: String(args.type ?? 0), tag1, tag2 });
      // 匿名与 Markdown 是帖子属性，不是渲染选项：平台按 contentType 存正文，
      // 写错了正文会被当成另一种格式展示（乱码），所以必须走参数。
      if (args.contentType !== undefined) form.set('contentType', String(args.contentType));
      if (args.anonymous !== undefined) form.set('anonymous', args.anonymous ? 'true' : 'false');
      const tags = [tag1, tag2].filter(Boolean);
      return {
        summarized: `在版面 ${board} 发帖「${title}」${tags.length ? `（标签 ${tags.join('/')}）` : ''}`,
        run: (signal) => client.request('POST', `topic/${board}`, {
          // 上游用 form 提交，字段名照它。
          body: form.toString(),
          signal,
        }),
      };
    }),

    replyTopic: pair('cc98.replyTopic', async (args) => {
      const topic = id(args.topic, '帖子编号');
      const content = body(args.content, '回复正文', 8000);
      const form = new URLSearchParams({ content, contentType: String(args.contentType ?? 0) });
      // 引用的是**楼层号**（`quoteId`），不是帖子号：平台要定位到具体那一楼。
      if (args.quote !== undefined) form.set('quoteId', String(id(args.quote, '被引用楼层')));
      if (args.anonymous !== undefined) form.set('anonymous', args.anonymous ? 'true' : 'false');
      // 「通知全体」只在楼主回复时可用，但要不要用是用户的事，不是我们替他决定。
      if (args.notifyAll !== undefined) form.set('notifyAll', args.notifyAll ? 'true' : 'false');
      const marks = [
        args.quote !== undefined ? '引用' : null,
        args.anonymous ? '匿名' : null,
        args.notifyAll ? '通知全体' : null,
      ].filter(Boolean);
      return {
        summarized: `回复帖子 ${topic}（${content.length} 字${marks.length ? `，${marks.join('/')}` : ''}）`,
        run: (signal) => client.request('POST', `topic/${topic}/post`, { body: form.toString(), signal }),
      };
    }),

    editPost: pair('cc98.editPost', async (args) => {
      // 收 post，也收 topic —— 工具层按「编辑帖子」把它当 topic 传。
      // 走 PUT post/{id} 时那个 id 是**楼层 postId**，不是 topicId；
      // 两者在 CC98 的「回复即楼层」结构下对单楼帖子是同一个值，
      // 但多楼帖不同。所以这里只认 post 优先、topic 兜底，并在
      // 说明里写清用的是楼层号。
      const post = id(args.post ?? args.topic, '楼层编号');
      const content = body(args.content, '正文', 8000);
      return {
        summarized: `编辑楼层 ${post} 的内容`,
        run: (signal) => client.request('PUT', `post/${post}`, {
          body: new URLSearchParams({ content, title: args.title ?? '' }).toString(),
          signal,
        }),
      };
    }),

    sendMessage: pair('cc98.sendMessage', async (args) => {
      const content = body(args.content, '私信正文', 4000);

      // 收信人可以是**数字 id** 或**用户名**。
      //
      // # 为什么这里要自己解析
      //
      // 平台接口要 `toUserId`（数字），而用户和模型手里通常只有用户名。
      // 让工具层去查一次用户 id，等于把 CC98 的「名字→id」这条路径抄到别处；
      // 而且工具层要为此多调一次读方法，失败时错误会归因错层。
      //
      // 所以 source 自己解析：数字直接认，字符串先按名字查。
      let recipient;
      const raw = String(args.recipient ?? args.user ?? '').trim();
      if (!raw) throw invalid('需要 recipient（收信人用户名或数字 id）');
      if (/^\d+$/.test(raw)) {
        recipient = Number(raw);
      } else {
        const found = await reader.user({ name: raw });
        const foundId = Number(found?.id);
        if (!Number.isSafeInteger(foundId) || foundId <= 0) {
          throw invalid(`找不到用户「${raw}」的 id，无法发私信（用 user({name}) 确认用户名）`);
        }
        recipient = foundId;
      }

      return {
        summarized: `给 ${raw} 发私信（${content.length} 字）`,
        run: (signal) => client.request('POST', 'message', {
          body: new URLSearchParams({ toUserId: String(recipient), content }).toString(),
          signal,
        }),
      };
    }),
  };
}

/**
 * 一个时间戳是不是今天（按本机时区）。
 *
 * 签到判定用它：平台对重复签到不报错，所以「今天签过没有」只能自己判。
 *
 * @param value - ISO 串或毫秒时间戳。
 * @returns 是否今天。
 */
function isToday(value) {
  const at = typeof value === 'number' ? value : Date.parse(String(value));
  if (!Number.isFinite(at)) return false;
  const today = new Date();
  const target = new Date(at);
  return today.getFullYear() === target.getFullYear()
    && today.getMonth() === target.getMonth()
    && today.getDate() === target.getDate();
}
