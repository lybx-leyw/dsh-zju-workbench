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

export const name = 'zhiyun-tool-xuezai';

export const inject = ['tools', 'approval', 'zhiyunXuezai'];

const SERVICE_SOURCES = Object.freeze({
  zhiyunXuezai: '@lybx-leyw/dsh-zju-source-xuezai',
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
          const xuezai = need('zhiyunXuezai');
          const { prepare, execute, cancel } = contractOf(xuezai, 'submitHomework');
          return { summary: await prepare({ course, homework, content }), execute, cancel };
        }
        const xuezai = need('zhiyunXuezai');
        const { prepare, execute, cancel } = contractOf(xuezai, 'retractHomework');
        return { summary: await prepare({ course, homework }), execute, cancel };
      },
    },

    {
      name: 'campus_checkin',
      description: '课堂点名签到（学在浙大）。点名通常只有几分钟窗口，错过不能补。执行前会请求你批准。',
      parameters: {
        type: 'object',
        properties: {
          course: { type: 'string', description: '课程名' },
          code: { type: 'string', description: '点名口令（数字点名时用）' },
        },
        required: ['course'],
        additionalProperties: false,
      },
      async prepare(args) {
        const course = str(args.course, '课程名');
        const code = optStr(args.code, '点名口令');
        const xuezai = need('zhiyunXuezai');
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
