/**
 * `@lybx-leyw/dsh-zju-tool-xuezai` —— 学在浙大（xuezai）写操作工具包。
 *
 * 一个包只装一个域：**交作业 / 撤回作业 / 课堂点名签到**。
 *
 * 提交后通常不能改，撤回可能不被允许或有时限，点名窗口通常只有几分钟。
 * 所以每个动作都要逐次批准。审批与注册器在 `tool/write-kit`，**不重复实现**。
 */
import { createWriteToolRegistrar, contractOf, inputError, optStr, serviceLookup, str } from '@lybx-leyw/dsh-zju-tool-write-kit';
import { createReadToolRegistrar } from '@lybx-leyw/dsh-zju-tool-kit';
import { createXuezaiReadTools } from './reads.js';

export const name = 'zw-tool-xuezai';

export const inject = ['tools', 'approval', 'zwXuezai'];

const SERVICE_SOURCES = Object.freeze({
  zwXuezai: '@lybx-leyw/dsh-zju-source-xuezai',
});

/**
 * 学在浙大写工具的定义。**纯数据 + 纯函数**。
 *
 * @param services - 已解析的 source 服务。
 * @returns 工具定义数组。
 */
export function createXuezaiWriteTools(services) {
  const need = (key) => serviceLookup(services, key, SERVICE_SOURCES[key]);

  return [
    {
      name: 'campus_homework',
      description: '提交或撤回作业（学在浙大）。提交后通常不能改，撤回可能不被允许或有时限。执行前会请求你批准。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['submit', 'retract'], description: 'submit 提交、retract 撤回' },
          course: { type: 'string', description: '课程名' },
          homework: { type: 'string', description: '作业名或编号' },
          content: { type: 'string', description: '要提交的正文（submit 需要）' },
        },
        required: ['action', 'course', 'homework'],
        additionalProperties: false,
      },
      async prepare(args) {
        const action = str(args.action, 'action');
        const course = str(args.course, '课程名');
        const homework = str(args.homework, '作业');
        // 先认 action，再取服务：写错了动作不该收到「包没装」。
        if (!['submit', 'retract'].includes(action)) {
          throw inputError(`xuezai 只支持 submit / retract，收到 ${action}`);
        }

        if (action === 'submit') {
          const content = str(args.content, '要提交的正文', { max: 20000 });
          const xuezai = need('zwXuezai');
          const { prepare, execute, cancel } = contractOf(xuezai, 'submitHomework');
          return { summary: await prepare({ course, homework, content }), execute, cancel };
        }
        const xuezai = need('zwXuezai');
        const { prepare, execute, cancel } = contractOf(xuezai, 'retractHomework');
        return { summary: await prepare({ course, homework }), execute, cancel };
      },
    },

    {
      name: 'campus_checkin',
      description: '课堂点名签到（学在浙大）。点名通常只有几分钟窗口，错过不能补。'
        + '给 course 是签指定的这一门；给 all=true 是**一次签全部待签的点名**'
        + '（可能一批准就签上好几个）。执行前会请求你批准。',
      parameters: {
        type: 'object',
        properties: {
          course: { type: 'string', description: '课程名。给了就只签这一门' },
          code: { type: 'string', description: '点名口令（数字点名时用）' },
          all: {
            type: 'boolean',
            description: '批量：一次签全部待签的点名（可能多个）。与 course 二选一，不给 course 时签全部',
          },
          passes: { type: 'integer', minimum: 1, maximum: 600, description: '批量：扫几轮，默认 1（盯一段时间就给大一点）' },
        },
        // ⚠️ `course` 不再是必填：批量模式恰恰是「不知道该签哪门」时用的。
        // 但两个都不给是不行的 —— 那种调用会变成「随便签点什么」，所以运行时校验。
        required: [],
        additionalProperties: false,
      },
      async prepare(args) {
        const course = optStr(args.course, '课程名');
        const code = optStr(args.code, '点名口令');
        const all = args.all === true;
        if (!all && !course) {
          throw inputError('需要 course（签哪一门）或 all: true（签全部待签的点名）');
        }
        if (all && code) {
          // 批量模式下每门课的口令不同，一个口令签不了多个点名 —— 那是两个动作。
          throw inputError('all: true 时不能同时给 code：批量签到不猜口令，数字点名会如实报「签不了」');
        }
        const xuezai = need('zwXuezai');

        if (all) {
          const { prepare, execute, cancel } = contractOf(xuezai, 'rollcallAll');
          // `course` 在批量模式里是**筛选器**（可选）：给了就只签名字含它的那些。
          return {
            summary: await prepare({
              ...(course ? { course } : {}),
              ...(args.passes === undefined ? {} : { passes: args.passes }),
            }),
            execute,
            cancel,
          };
        }

        const { prepare, execute, cancel } = contractOf(xuezai, 'rollcall');
        return { summary: await prepare({ course, code }), execute, cancel };
      },
    },
  ];
}

export function apply(ctx) {
  const registrar = createWriteToolRegistrar({
    ctx,
    build: createXuezaiWriteTools,
    serviceSources: SERVICE_SOURCES,
  });
  registrar.register(createXuezaiWriteTools);

  // 读工具**不过审批**：审批只给会改变平台状态的动作。两条注册链分开，
  // 免得某天有人「顺手」把审批也套在查作业上。
  createReadToolRegistrar({
    ctx,
    build: createXuezaiReadTools,
    serviceSources: SERVICE_SOURCES,
  }).register(createXuezaiReadTools);
}

export { createXuezaiReadTools } from './reads.js';
