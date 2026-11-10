/**
 * 校园写操作的工具定义。**纯数据 + 纯函数**，不碰 Cordis、不碰审批。
 *
 * # 分工（这条决定了整个文件的形状）
 *
 * | 谁 | 做什么 |
 * | --- | --- |
 * | `source/*` | 算好**执行写操作需要的全部参数**（表单字段、签名、令牌、目标 id） |
 * | 本包 `tool/*` | 审批、参数校验、把 source 算好的参数**发出去**、回报结果 |
 *
 * 这个分工与 D21（下载归 core、source 只暴露参数）是同一条原则：
 * **「怎么和平台说话」是 source 的知识；「要不要做、做的时候怎么问用户」是 tool 的。**
 *
 * # 为什么不是 21 个工具
 *
 * 按**动作语义**归并，不按上游模块划分：
 *
 * | 工具 | 覆盖的上游写能力 | 条数 |
 * | --- | --- | --- |
 * | `campus_course_select` | zdbk select / reorder / drop | 3 |
 * | `campus_activity` | sztz signup / cancel + tyys book / cancel | 4 |
 * | `campus_homework` | xuezai submit / retract + pta save / submit | 4 |
 * | `campus_checkin` | xuezai rollcall + cc98 signin | 2 |
 * | `campus_post` | cc98 post / reply / edit / message | 4 |
 * | `campus_react` | cc98 like / rate / favorite | 3 |
 * | `campus_lab_select` | lab select / cancel | 2 |
 *
 * 共 22 条。模型面对 22 个平铺工具会选错，面对 7 个带 `action` 枚举的能选对 ——
 * 「选课」本来就有 3 种做法，它们该在一个工具里。
 *
 * # 为什么每个工具都调 `prepare()`
 *
 * 因为**校验与参数构造都在 source 那边**。工具里只做两件事：
 * 把用户的自然语言参数交给 source 去算，然后（在审批通过后）调 `execute()`。
 *
 * source 的契约是两个方法：
 * - `prepareXxx(args)` → `{ summary, execute(signal) }`
 *   - `summary` 是给人看的「将要做什么」，进审批对话框
 *   - `execute` 才真的发请求
 * - 拿不到 source 时如实报错，不静默
 */

/** 参数错误。与 `WriteRejected` 分开：那是「用户不批」，这是「调用方说错了」。 */
const inputError = (message) => Object.assign(new Error(message), { code: 'INPUT' });

/**
 * 七个写工具的定义。
 *
 * @param options.services - 已解析的 source 服务（可能缺项；缺的那部分动作如实报错）。
 * @returns {Array<object>} 工具定义（未注册、未审批）。
 */
export function createCampusWriteTools({ services }) {
  /**
   * 取一个服务；没有就说清要装哪个包。
   *
   * 缺包是安装问题，模型据此才知道该对用户说什么 ——
   * 笼统的「服务不可用」只会让它反复重试。
   *
   * @param key - 服务名。
   * @param pkg - 对应的包名（报错时用）。
   * @returns 服务对象。
   */
  const need = (key, pkg) => {
    const service = services[key];
    if (!service) {
      throw Object.assign(
        new Error(`这个动作需要 ${pkg}（服务 ${key}），但它没有装配。请先启用那个数据源包。`),
        { code: 'SERVICE_MISSING', service: key },
      );
    }
    return service;
  };

  /** 必填字符串。 */
  const str = (value, name, { max = 200 } = {}) => {
    if (typeof value !== 'string' || !value.trim()) throw inputError(`需要 ${name}`);
    if (value.length > max) throw inputError(`${name} 过长（上限 ${max} 字）`);
    return value.trim();
  };

  /** 可选字符串。 */
  const optStr = (value, name, options) => (value === undefined ? undefined : str(value, name, options));

  /**
   * source 必须提供的两个方法。缺了就是契约不完整，要立即报错而不是等到执行时。
   *
   * @param service - source 服务。
   * @param name - 方法名前缀，如 `prepareSelect`。
   * @returns `{ prepare, execute }`。
   */
  const contract = (service, name) => {
    const prepare = service?.[`${name}Prepare`];
    const execute = service?.[`${name}Execute`];
    if (typeof prepare !== 'function' || typeof execute !== 'function') {
      throw Object.assign(
        new Error(`数据源没有提供 ${name}Prepare / ${name}Execute，这个动作暂时做不了。`),
        { code: 'CONTRACT_MISSING', methods: [`${name}Prepare`, `${name}Execute`] },
      );
    }
    return { prepare, execute };
  };

  return [
    {
      name: 'campus_course_select',
      description: '在教务网选课、退课或调整志愿顺序。选课受名额与选课窗口限制，退课之后该教学班可能被别人占掉。执行前会请求你批准，批准只对这一次有效。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['select', 'drop', 'reorder'], description: 'select 选课、drop 退课、reorder 调整志愿顺序' },
          course: { type: 'string', description: '课程名或课程号' },
          section: { type: 'string', description: '教学班编号（select 必填，可由选课查询结果得到）' },
          order: { type: 'integer', minimum: 1, description: 'reorder 时的目标志愿序号' },
        },
        required: ['action', 'course'],
        additionalProperties: false,
      },
      async prepare(args) {
        // 先校验参数，再取服务：用户把参数写错了，不该先收到「包没装」这种
        // 与他的输入毫无关系的提示。
        const action = str(args.action, 'action');
        const course = str(args.course, '课程名或课程号');
        if (action === 'reorder' && (!Number.isInteger(args.order) || args.order < 1)) {
          throw inputError('reorder 需要正整数 order');
        }
        if (action === 'select') str(args.section, '教学班编号（select 需要）');
        if (!['select', 'drop', 'reorder'].includes(action)) throw inputError(`不认识的 action：${action}`);

        const zdbk = need('zhiyunZdbk', '@lybx-leyw/dsh-zju-source-zdbk');

        if (action === 'select') {
          const { prepare, execute } = contract(zdbk, 'selectCourse');
          return { summary: await prepare({ course, section: str(args.section, '教学班编号（select 需要）') }), execute };
        }
        if (action === 'drop') {
          const { prepare, execute } = contract(zdbk, 'dropCourse');
          return { summary: await prepare({ course }), execute };
        }
        const { prepare, execute } = contract(zdbk, 'reorderCourse');
        return { summary: await prepare({ course, order: args.order }), execute };
      },
    },

    {
      name: 'campus_activity',
      description: '二课活动报名 / 取消报名，或体育场馆预约 / 取消预约。两者都受名额限制，取消之后名额可能被他人占掉。执行前会请求你批准。',
      parameters: {
        type: 'object',
        properties: {
          platform: { type: 'string', enum: ['sztz', 'tyys'], description: 'sztz 是二课活动，tyys 是体育场馆' },
          action: { type: 'string', enum: ['signup', 'cancel', 'book'], description: 'signup 报名、book 预约、cancel 取消' },
          target: { type: 'string', description: '活动名或场馆时段（由查询结果给出）' },
          venue: { type: 'string', description: 'tyys 预约时的场地编号' },
          date: { type: 'string', description: 'tyys 预约日期 YYYY-MM-DD' },
        },
        required: ['platform', 'action', 'target'],
        additionalProperties: false,
      },
      async prepare(args) {
        const platform = str(args.platform, 'platform');
        const action = str(args.action, 'action');
        const target = str(args.target, '目标');

        if (platform === 'sztz') {
          const sztz = need('zhiyunSztz', '@lybx-leyw/dsh-zju-source-sztz');
          if (action === 'signup') {
            const { prepare, execute } = contract(sztz, 'signupActivity');
            return { summary: await prepare({ activity: target }), execute };
          }
          if (action === 'cancel') {
            const { prepare, execute } = contract(sztz, 'cancelActivity');
            return { summary: await prepare({ activity: target }), execute };
          }
          throw inputError(`sztz 只支持 signup / cancel，收到 ${action}`);
        }

        if (platform === 'tyys') {
          const tyys = need('zhiyunTyys', '@lybx-leyw/dsh-zju-source-tyys');
          if (action === 'cancel') {
            const { prepare, execute } = contract(tyys, 'cancelVenue');
            return { summary: await prepare({ order: target }), execute };
          }
          if (action === 'book' || action === 'signup') {
            const venue = str(args.venue, '场地编号（预约需要）');
            const date = str(args.date, '日期（预约需要）');
            if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw inputError('date 要写成 YYYY-MM-DD');
            const { prepare, execute } = contract(tyys, 'bookVenue');
            return { summary: await prepare({ venue, slot: target, date }), execute };
          }
          throw inputError(`tyys 只支持 book / cancel，收到 ${action}`);
        }

        throw inputError(`不认识的 platform：${platform}`);
      },
    },

    {
      name: 'campus_homework',
      description: '提交或撤回作业（学在浙大），或保存 / 提交拼题A 的题目。提交后通常不能改，撤回可能不被允许或有时限。执行前会请求你批准。',
      parameters: {
        type: 'object',
        properties: {
          platform: { type: 'string', enum: ['xuezai', 'pta'], description: 'xuezai 是学在浙大，pta 是拼题A' },
          action: { type: 'string', enum: ['submit', 'retract', 'save'], description: 'submit 提交、retract 撤回、save 保存（仅 pta）' },
          course: { type: 'string', description: '课程名（xuezai 需要）' },
          homework: { type: 'string', description: '作业名或编号' },
          problem: { type: 'string', description: 'pta 的题目编号' },
          content: { type: 'string', description: '要提交的正文或代码' },
        },
        required: ['platform', 'action', 'homework'],
        additionalProperties: false,
      },
      async prepare(args) {
        const platform = str(args.platform, 'platform');
        const action = str(args.action, 'action');
        const homework = str(args.homework, '作业');

        if (platform === 'xuezai') {
          const xuezai = need('zhiyunXuezai', '@lybx-leyw/dsh-zju-source-xuezai');
          const course = str(args.course, '课程名（xuezai 需要）');
          if (action === 'submit') {
            const content = str(args.content, '要提交的正文', { max: 20000 });
            const { prepare, execute } = contract(xuezai, 'submitHomework');
            return { summary: await prepare({ course, homework, content }), execute };
          }
          if (action === 'retract') {
            const { prepare, execute } = contract(xuezai, 'retractHomework');
            return { summary: await prepare({ course, homework }), execute };
          }
          throw inputError(`xuezai 只支持 submit / retract，收到 ${action}`);
        }

        if (platform === 'pta') {
          const pta = need('zhiyunPta', '@lybx-leyw/dsh-zju-source-pta');
          const problem = str(args.problem, '题目编号（pta 需要）');
          if (action === 'save') {
            const content = optStr(args.content, '要保存的代码', { max: 20000 });
            const { prepare, execute } = contract(pta, 'saveAnswer');
            return { summary: await prepare({ homework, problem, content }), execute };
          }
          if (action === 'submit') {
            const { prepare, execute } = contract(pta, 'submitAnswer');
            return { summary: await prepare({ homework, problem }), execute };
          }
          throw inputError(`pta 只支持 save / submit，收到 ${action}`);
        }

        throw inputError(`不认识的 platform：${platform}`);
      },
    },

    {
      name: 'campus_checkin',
      description: '课堂点名签到（学在浙大），或 CC98 每日签到。点名通常只有几分钟窗口，错过不能补。执行前会请求你批准。',
      parameters: {
        type: 'object',
        properties: {
          platform: { type: 'string', enum: ['xuezai', 'cc98'], description: 'xuezai 是课堂点名，cc98 是论坛签到' },
          course: { type: 'string', description: '课程名（xuezai 点名需要）' },
          code: { type: 'string', description: '点名口令（数字点名时用）' },
        },
        required: ['platform'],
        additionalProperties: false,
      },
      async prepare(args) {
        const platform = str(args.platform, 'platform');

        if (platform === 'xuezai') {
          const xuezai = need('zhiyunXuezai', '@lybx-leyw/dsh-zju-source-xuezai');
          const course = str(args.course, '课程名（点名需要）');
          const code = optStr(args.code, '点名口令');
          const { prepare, execute } = contract(xuezai, 'rollcall');
          return { summary: await prepare({ course, code }), execute };
        }

        if (platform === 'cc98') {
          const cc98 = need('zhiyunCc98', '@lybx-leyw/dsh-zju-source-cc98');
          const { prepare, execute } = contract(cc98, 'signIn');
          return { summary: await prepare(), execute };
        }

        throw inputError(`不认识的 platform：${platform}`);
      },
    },

    {
      name: 'campus_post',
      description: '在 CC98 发帖、回复、编辑自己的帖子，或发私信。发出后其他人立刻可见；编辑与私信都会留下痕迹。执行前会请求你批准。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['post', 'reply', 'edit', 'message'], description: 'post 发帖、reply 回复、edit 编辑、message 私信' },
          board: { type: 'string', description: '版面编号（post 需要）' },
          topic: { type: 'string', description: '帖子编号（reply / edit 需要）' },
          content: { type: 'string', description: '正文' },
          recipient: { type: 'string', description: '收信人（message 需要）' },
        },
        required: ['action', 'content'],
        additionalProperties: false,
      },
      async prepare(args) {
        const cc98 = need('zhiyunCc98', '@lybx-leyw/dsh-zju-source-cc98');
        const action = str(args.action, 'action');
        const content = str(args.content, '正文', { max: 20000 });

        if (action === 'post') {
          const board = str(args.board, '版面编号（post 需要）');
          const { prepare, execute } = contract(cc98, 'postTopic');
          return { summary: await prepare({ board, content }), execute };
        }
        if (action === 'reply') {
          const topic = str(args.topic, '帖子编号（reply 需要）');
          const { prepare, execute } = contract(cc98, 'replyTopic');
          return { summary: await prepare({ topic, content }), execute };
        }
        if (action === 'edit') {
          const topic = str(args.topic, '帖子编号（edit 需要）');
          const { prepare, execute } = contract(cc98, 'editPost');
          return { summary: await prepare({ topic, content }), execute };
        }
        if (action === 'message') {
          const recipient = str(args.recipient, '收信人（message 需要）');
          const { prepare, execute } = contract(cc98, 'sendMessage');
          return { summary: await prepare({ recipient, content }), execute };
        }
        throw inputError(`不认识的 action：${action}`);
      },
    },

    {
      name: 'campus_react',
      description: '给 CC98 的楼层点赞、评分或收藏帖子。评分会消耗你的评分额度且不可撤销。执行前会请求你批准。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['like', 'rate', 'favorite'], description: 'like 点赞、rate 评分、favorite 收藏' },
          post: { type: 'string', description: '楼层或帖子编号' },
          value: { type: 'integer', description: 'rate 时的分值' },
          reason: { type: 'string', description: 'rate 时的理由编号' },
        },
        required: ['action', 'post'],
        additionalProperties: false,
      },
      async prepare(args) {
        const cc98 = need('zhiyunCc98', '@lybx-leyw/dsh-zju-source-cc98');
        const action = str(args.action, 'action');
        const post = str(args.post, '目标编号');

        if (action === 'like') {
          const { prepare, execute } = contract(cc98, 'likeFloor');
          return { summary: await prepare({ post }), execute };
        }
        if (action === 'favorite') {
          const { prepare, execute } = contract(cc98, 'favoriteTopic');
          return { summary: await prepare({ post }), execute };
        }
        if (action === 'rate') {
          if (!Number.isInteger(args.value)) throw inputError('rate 需要整数 value');
          const reason = optStr(args.reason, '理由编号');
          const { prepare, execute } = contract(cc98, 'rateFloor');
          return { summary: await prepare({ post, value: args.value, reason }), execute };
        }
        throw inputError(`不认识的 action：${action}`);
      },
    },

    {
      name: 'campus_lab_select',
      description: '选实验班次或退选（实验课平台）。每个班次的名额独立，退选后名额可能被别人占掉。执行前会请求你批准。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['select', 'cancel'], description: 'select 选实验、cancel 退选' },
          course: { type: 'string', description: '实验课程名或编号' },
          lab: { type: 'string', description: '班次编号（select 需要）' },
          week: { type: 'string', description: '周次段（select 需要，由班次的 weeks 给出）' },
          record: { type: 'string', description: '选课记录编号（cancel 需要）' },
        },
        required: ['action', 'course'],
        additionalProperties: false,
      },
      async prepare(args) {
        const lab = need('zhiyunLab', '@lybx-leyw/dsh-zju-source-lab');
        const action = str(args.action, 'action');
        const course = str(args.course, '实验课程');

        if (action === 'select') {
          const id = str(args.lab, '班次编号（select 需要）');
          const week = str(args.week, '周次段（select 需要）');
          const { prepare, execute } = contract(lab, 'selectLab');
          return { summary: await prepare({ course, lab: id, week }), execute };
        }
        if (action === 'cancel') {
          const record = str(args.record, '选课记录编号（cancel 需要）');
          const { prepare, execute } = contract(lab, 'cancelLab');
          return { summary: await prepare({ record }), execute };
        }
        throw inputError(`不认识的 action：${action}`);
      },
    },
  ];
}
