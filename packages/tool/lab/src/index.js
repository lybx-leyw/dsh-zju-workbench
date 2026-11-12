/**
 * `@lybx-leyw/dsh-zju-tool-lab` —— 实验选课平台（lab）写操作工具包。
 *
 * 一个包只装一个域：**选实验班次 / 退选**。
 *
 * 每个班次的名额独立，退选之后名额可能被别人占掉，所以每个动作都要逐次批准。
 * 审批与注册器在 `tool/write-kit`，**不重复实现**。
 */
import { createWriteToolRegistrar, contractOf, inputError, serviceLookup, str } from '@lybx-leyw/dsh-zju-tool-write-kit';

export const name = 'zhiyun-tool-lab';

export const inject = ['tools', 'approval', 'zhiyunLab'];

const SERVICE_SOURCES = Object.freeze({
  zhiyunLab: '@lybx-leyw/dsh-zju-source-lab',
});

/**
 * 实验课写工具的定义。**纯数据 + 纯函数**。
 *
 * @param services - 已解析的 source 服务。
 * @returns 工具定义数组。
 */
export function createLabWriteTools(services) {
  const need = (key) => serviceLookup(services, key, SERVICE_SOURCES[key]);

  return [
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
        const action = str(args.action, 'action');
        const course = str(args.course, '实验课程名或编号');
        // 先认 action，再取服务：写错了动作不该收到「包没装」。
        if (!['select', 'cancel'].includes(action)) {
          throw inputError(`lab 只支持 select / cancel，收到 ${action}`);
        }

        if (action === 'select') {
          const target = str(args.lab, '班次编号（select 需要）');
          const week = str(args.week, '周次段（select 需要）');
          const lab = need('zhiyunLab');
          const { prepare, execute, cancel } = contractOf(lab, 'selectLab');
          return { summary: await prepare({ course, lab: target, week }), execute, cancel };
        }
        const record = str(args.record, '选课记录编号（cancel 需要）');
        const lab = need('zhiyunLab');
        const { prepare, execute, cancel } = contractOf(lab, 'cancelLab');
        return { summary: await prepare({ course, record }), execute, cancel };
      },
    },
  ];
}

export function apply(ctx) {
  const registrar = createWriteToolRegistrar({
    ctx,
    build: createLabWriteTools,
    serviceSources: SERVICE_SOURCES,
  });
  registrar.register(createLabWriteTools);
}
