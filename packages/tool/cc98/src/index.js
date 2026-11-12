/**
 * `@lybx-leyw/dsh-zju-tool-cc98` —— CC98 论坛写操作工具包。
 *
 * 一个包只装一个域：**发帖 / 回复 / 编辑 / 私信 / 赞踩评分收藏 / 每日签到**。
 *
 * 发出后其他人立刻可见；编辑与私信都会留下痕迹。所以每个动作都要逐次批准。
 * 审批与注册器在 `tool/write-kit`，**不重复实现**。
 */
import { createWriteToolRegistrar, contractOf, inputError, serviceLookup, str } from '@lybx-leyw/dsh-zju-tool-write-kit';
import { createReadToolRegistrar } from '@lybx-leyw/dsh-zju-tool-kit';
import { createCc98ReadTools } from './reads.js';

export const name = 'zw-tool-cc98';

export const inject = ['tools', 'approval', 'zwCc98'];

const SERVICE_SOURCES = Object.freeze({
  zwCc98: '@lybx-leyw/dsh-zju-source-cc98',
});

/**
 * CC98 写工具的定义。**纯数据 + 纯函数**。
 *
 * @param services - 已解析的 source 服务。
 * @returns 工具定义数组。
 */
export function createCc98WriteTools(services) {
  const need = (key) => serviceLookup(services, key, SERVICE_SOURCES[key]);

  return [
    {
      name: 'campus_post',
      description: '在 CC98 发帖、回复、编辑自己的帖子，或发私信。发出后其他人立刻可见；编辑与私信都会留下痕迹。执行前会请求你批准。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['post', 'reply', 'edit', 'message'], description: 'post 发帖、reply 回复、edit 编辑、message 私信' },
          board: { type: 'string', description: '版面编号（post 需要）' },
          topic: { type: 'string', description: '帖子编号（reply 需要）' },
          post: { type: 'string', description: '楼层编号（edit 需要；要编辑的是某一楼，不是整个主题）' },
          title: { type: 'string', description: '标题（post 可选；不给就取正文前 30 字）' },
          content: { type: 'string', description: '正文' },
          tag1: { type: 'string', description: '主标签（post；版面要求必选标签时必须给）' },
          tag2: { type: 'string', description: '次标签（post）' },
          quote: { type: 'string', description: '被引用的楼层编号（reply 可选）' },
          anonymous: { type: 'boolean', description: '是否匿名（post / reply）' },
          notifyAll: { type: 'boolean', description: '是否通知全体（reply 可选）' },
          recipient: { type: 'string', description: '收信人用户名或数字 id（message 需要）' },
        },
        required: ['action', 'content'],
        additionalProperties: false,
      },
      async prepare(args) {
        const action = str(args.action, 'action');
        const content = str(args.content, '正文', { max: 20000 });

        // 先认 action，再取服务：用户把 action 写错了，不该先收到
        // 「包没装」这种与他的输入毫无关系的提示。
        if (!['post', 'reply', 'edit', 'message'].includes(action)) {
          throw inputError(`不认识的 action：${action}`);
        }
        const cc98 = need('zwCc98');

        if (action === 'post') {
          const board = str(args.board, '版面编号（post 需要）');
          const { prepare, execute, cancel } = contractOf(cc98, 'postTopic');
          const extra = {
            ...(args.title === undefined ? {} : { title: str(args.title, '标题', { max: 100 }) }),
            ...(args.tag1 === undefined ? {} : { tag1: str(args.tag1, '主标签', { max: 100 }) }),
            ...(args.tag2 === undefined ? {} : { tag2: str(args.tag2, '次标签', { max: 100 }) }),
            ...(args.anonymous === undefined ? {} : { anonymous: Boolean(args.anonymous) }),
          };
          return { summary: await prepare({ board, content, ...extra }), execute, cancel };
        }
        if (action === 'reply') {
          const topic = str(args.topic, '帖子编号（reply 需要）');
          const { prepare, execute, cancel } = contractOf(cc98, 'replyTopic');
          const extra = {
            ...(args.quote === undefined ? {} : { quote: str(args.quote, '被引用楼层') }),
            ...(args.anonymous === undefined ? {} : { anonymous: Boolean(args.anonymous) }),
            ...(args.notifyAll === undefined ? {} : { notifyAll: Boolean(args.notifyAll) }),
          };
          return { summary: await prepare({ topic, content, ...extra }), execute, cancel };
        }
        if (action === 'edit') {
          // 编辑针对的是**楼层**（postId），不是主题（topicId）。多楼帖里
          // 两者不同，传错了会改到别的楼。所以这里明确要 post。
          const post = str(args.post, '楼层编号（edit 需要）');
          const { prepare, execute, cancel } = contractOf(cc98, 'editPost');
          const extra = args.title === undefined ? {} : { title: str(args.title, '标题', { max: 100 }) };
          return { summary: await prepare({ post, content, ...extra }), execute, cancel };
        }
        if (action === 'message') {
          const recipient = str(args.recipient, '收信人（message 需要）');
          const { prepare, execute, cancel } = contractOf(cc98, 'sendMessage');
          return { summary: await prepare({ recipient, content }), execute, cancel };
        }
        // 上面已前置校验过 action，走到这里说明分支漏了一个 —— 那是本文件的 bug，
        // 不该表现为「用户参数错了」。
        throw new Error(`campus_post 的 action 分派漏了 ${action}`);
      },
    },

    {
      name: 'campus_react',
      description: '给 CC98 的楼层点赞、踩、取消赞踩、评分或收藏帖子。评分会消耗你的评分额度且不可撤销；赞踩可以随时改或取消。执行前会请求你批准。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['like', 'down', 'unlike', 'rate', 'favorite', 'unfavorite'], description: 'like 点赞、down 点踩、unlike 取消赞踩、rate 评分、favorite 收藏、unfavorite 取消收藏' },
          post: { type: 'string', description: '楼层或帖子编号' },
          value: { type: 'integer', description: 'rate 时的分值（正评/负评由符号决定）' },
          reason: { type: 'string', description: 'rate 时的理由编号（可从 reasons 动作查到）' },
        },
        required: ['action', 'post'],
        additionalProperties: false,
      },
      async prepare(args) {
        const action = str(args.action, 'action');
        const post = str(args.post, '目标编号');

        // 同上：先认 action，再取服务。
        if (!['like', 'down', 'unlike', 'favorite', 'unfavorite', 'rate'].includes(action)) {
          throw inputError(`不认识的 action：${action}`);
        }
        const cc98 = need('zwCc98');

        if (action === 'like' || action === 'down' || action === 'unlike') {
          const { prepare, execute, cancel } = contractOf(cc98, 'likeFloor');
          const state = action === 'like' ? 1 : (action === 'down' ? 2 : 'none');
          return { summary: await prepare({ post, state }), execute, cancel };
        }
        if (action === 'favorite' || action === 'unfavorite') {
          const { prepare, execute, cancel } = contractOf(cc98, 'favoriteTopic');
          return { summary: await prepare({ post, on: action === 'favorite' }), execute, cancel };
        }
        if (action === 'rate') {
          if (!Number.isInteger(args.value)) throw inputError('rate 需要整数 value');
          // reason 是平台必填项（理由编号）。不传的话 source 会抛，但那时
          // 用户看到的是一句「评分需要 reason（理由编号）」—— 他不知道编号从哪来。
          // 在这里挡住并说清去哪查。
          const reason = str(args.reason, '理由编号（rate 需要；可用 reasons 动作查）');
          const { prepare, execute, cancel } = contractOf(cc98, 'rateFloor');
          return { summary: await prepare({ post, value: args.value, reason }), execute, cancel };
        }
        // 已前置校验，走到这里说明分派漏了一个分支，那是本文件的 bug。
        throw new Error(`campus_react 的 action 分派漏了 ${action}`);
      },
    },

    {
      name: 'campus_signin',
      description: 'CC98 每日签到。签到有连签奖励，重复签到不会有额外收益。执行前会请求你批准。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      async prepare() {
        const cc98 = need('zwCc98');
        const { prepare, execute, cancel } = contractOf(cc98, 'signIn');
        return { summary: await prepare(), execute, cancel };
      },
    },
  ];
}

export function apply(ctx) {
  const registrar = createWriteToolRegistrar({
    ctx,
    build: createCc98WriteTools,
    serviceSources: SERVICE_SOURCES,
  });
  registrar.register(createCc98WriteTools);

  // 读工具**不过审批**：CC98 的 22 条读能力零风险，给它们配批准对话框只会
  // 让用户对「批准」这件事脱敏。写工具照旧逐次审批。
  createReadToolRegistrar({
    ctx,
    build: createCc98ReadTools,
    serviceSources: SERVICE_SOURCES,
  }).register(createCc98ReadTools);
}

export { createCc98ReadTools } from './reads.js';
