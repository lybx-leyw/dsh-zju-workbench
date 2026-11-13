/**
 * `@lybx-leyw/dsh-zju-tool-pta` —— 拼题A（pintia）写操作工具包。
 *
 * 一个包只装一个域：**保存答案 / 提交答案**。
 *
 * 提交之后通常不能改，且可能计入成绩，所以每个动作都要逐次批准。
 * 审批与注册器在 `tool/write-kit`，**不重复实现**。
 */
import { createWriteToolRegistrar, contractOf, inputError, optStr, serviceLookup, str } from '@lybx-leyw/dsh-zju-tool-write-kit';
import { createReadToolRegistrar } from '@lybx-leyw/dsh-zju-tool-kit';
import { createPtaReadTools } from './reads.js';

export const name = 'zw-tool-pta';

export const inject = ['tools', 'approval', 'zwPta'];

const SERVICE_SOURCES = Object.freeze({
  zwPta: '@lybx-leyw/dsh-zju-source-pta',
});

/**
 * 拼题A 写工具的定义。**纯数据 + 纯函数**。
 *
 * @param services - 已解析的 source 服务。
 * @returns 工具定义数组。
 */
export function createPtaWriteTools(services) {
  const need = (key) => serviceLookup(services, key, SERVICE_SOURCES[key]);

  return [
    {
      name: 'campus_answer',
      description: '保存或提交拼题A 的题目答案。保存只是暂存，提交之后通常不能改且会计入成绩。执行前会请求你批准。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['save', 'submit'], description: 'save 暂存、submit 提交' },
          problemSet: { type: 'string', description: '题目集编号' },
          problem: { type: 'string', description: '题目编号' },
          content: { type: 'string', description: '要保存的代码（save 用）' },
        },
        required: ['action', 'problemSet', 'problem'],
        additionalProperties: false,
      },
      async prepare(args) {
        const action = str(args.action, 'action');
        const homework = str(args.problemSet, '题目集编号');
        const problem = str(args.problem, '题目编号');
        // 先认 action，再取服务：写错了动作不该收到「包没装」。
        if (!['save', 'submit'].includes(action)) {
          throw inputError(`pta 只支持 save / submit，收到 ${action}`);
        }

        if (action === 'save') {
          const content = optStr(args.content, '要保存的代码', { max: 20000 });
          const pta = need('zwPta');
          const { prepare, execute, cancel } = contractOf(pta, 'saveAnswer');
          return { summary: await prepare({ homework, problem, content }), execute, cancel };
        }
        const pta = need('zwPta');
        const { prepare, execute, cancel } = contractOf(pta, 'submitAnswer');
        return { summary: await prepare({ homework, problem }), execute, cancel };
      },
    },
  ];
}

export function apply(ctx) {
  const registrar = createWriteToolRegistrar({
    ctx,
    build: createPtaWriteTools,
    serviceSources: SERVICE_SOURCES,
  });
  registrar.register(createPtaWriteTools);

  // 读工具**不过审批**；`campus_pta_read` 也**不**开始答题 —— 那会启动计时，
  // 是替用户做决定，属于尚未裁决的产品问题（见 README）。
  createReadToolRegistrar({
    ctx,
    build: createPtaReadTools,
    serviceSources: SERVICE_SOURCES,
  }).register(createPtaReadTools);
}

export { createPtaReadTools } from './reads.js';
