/**
 * 编排域：`zhiyunStudy` 的**全部 RPC 动作**。
 *
 * 这一层是"把各域串起来"的地方，也是基准最想测的 —— 因为**跨域契约**
 * 只在这里成立：讲义必须只取主线块、润色不许改动解析产物、换账号要取消
 * 在飞任务……这些约束没有一个是单个域自己保证的。
 *
 * # 为什么直接 `invoke(method, args)`
 *
 * `invoke` 就是产品暴露给页面的那一层（RPC 路由最终调它）。基准直接打它，
 * 等价于"页面点了那个按钮"。若基准自己调 `workbench.assembleLecture`，
 * 就绕过了 `dispatch` 的入参校验与错误归一 —— 而那两层正是产品行为。
 */

import path from 'node:path';
import { mount, serviceOf, apiOf, memoryCredentials, urlOf } from './_base.mjs';

/** 知识域：存储服务（study 需要它，否则构造直接拒绝）。 */
export async function mountKnowledge({ dataDir } = {}) {
  const mounted = await mount('dsh-zhiyun-core-knowledge', { dataDir });
  const service = serviceOf(mounted, 'zhiyunKnowledge');
  return { mounted, service, ...apiOf(service) };
}

/**
 * 装配学习工作台。
 *
 * 它 `inject` 了课堂、解析器、llm、知识库，并且**惰性**取用讲义/出题/笔记。
 * 基准里除了"知识库"必须有（构造期硬校验），其余都可以用替身 ——
 * 这正是它设计成惰性的理由：停用一个可选项只该让对应动作报未接入。
 *
 * @param options.dataDir - 落盘目录。
 * @param options.llm - 可编程的 llm 桩。
 * @param options.parser - 解析器服务（不给就用一个报错的替身）。
 * @param options.classroom - 课堂服务（不给就用内存替身）。
 * @param options.lecture / options.quiz / options.notes - 可选加工服务。
 */
export async function mountStudy({ dataDir, llm, parser, classroom, lecture, quiz, notes } = {}) {
  // 知识库是**构造期硬依赖**：没有它工作台根本起不来（记录没地方落）。
  const knowledge = await mountKnowledge({ dataDir: path.join(dataDir, 'knowledge') });

  const mounted = await mount('dsh-zhiyun-core-study', {
    dataDir,
    llm,
    services: {
      zhiyunKnowledge: knowledge.service,
      zhiyunParser: parser ?? { llm, async parse() { throw Object.assign(new Error('基准没有接解析器'), { code: 'NO_PARSER' }); } },
      zhiyunClassroom: classroom ?? inMemoryClassroom(),
      ...(lecture ? { zhiyunLecture: lecture } : {}),
      ...(quiz ? { zhiyunQuiz: quiz } : {}),
      ...(notes ? { zhiyunNotes: notes } : {}),
    },
  });
  const service = serviceOf(mounted, 'zhiyunStudy');
  return { mounted, service, knowledge, ...apiOf(service) };
}

/**
 * 课堂源替身：**只够工作台跑通"已有一份终稿"的那些动作**。
 *
 * 基准不该真的去登浙大 —— 它测的是"有了终稿之后，树与讲义怎么长"。
 * 真机链路有 `scripts/source_bridge/classroom.mjs` 负责。
 */
export function inMemoryClassroom() {
  const state = { user: { id: 'bench-account', name: '基准账号' } };
  return {
    async getCurrentUser() { return state.user; },
    async login() { return { user: state.user }; },
    async logout() { state.user = null; },
    async listCourses() { return { items: [], meta: { complete: true } }; },
    async listLessons() { return { items: [], meta: { complete: true } }; },
    async getLessonContent() {
      throw Object.assign(new Error('基准课堂没有节内容：请注入自己的 content'), { code: 'NO_CONTENT' });
    },
    transport: { request() { throw Object.assign(new Error('基准课堂没有出口'), { code: 'NO_EGRESS' }); } },
  };
}

/** quiz 域：题库动作。 */
export async function mountQuiz({ dataDir, parser } = {}) {
  const mounted = await mount('dsh-zhiyun-core-quiz', {
    dataDir,
    services: { zhiyunParser: parser ?? { async parse() { throw Object.assign(new Error('基准没有接解析器'), { code: 'NO_PARSER' }); } } },
  });
  const service = serviceOf(mounted, 'zhiyunQuiz');
  return { mounted, service, ...apiOf(service) };
}

/** notes 域：节笔记。 */
export async function mountNotes({ dataDir } = {}) {
  const mounted = await mount('dsh-zhiyun-core-notes', { dataDir });
  const service = serviceOf(mounted, 'zhiyunNotes');
  return { mounted, service, ...apiOf(service) };
}

/** 讲义文本 codec（study 侧要核对润色前后的结构不变量）。 */
export async function agentTextModule() {
  return import(urlOf('dsh-zhiyun-core-lecture', 'src/agent-text.js'));
}

export { memoryCredentials };
