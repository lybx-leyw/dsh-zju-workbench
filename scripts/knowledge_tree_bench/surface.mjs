/**
 * 功能面快照：**各域到底暴露了哪些功能函数**。
 *
 * # 这一域解决什么问题
 *
 * "桥过来"最怕的是桥了一半：某个服务加了新动作，基准里没有对应入口，
 * 于是那部分能力**永远测不到** —— 而且没有任何报错，只是悄悄缺了一块。
 *
 * 所以这里做一件事：把每个域服务的功能面（函数名 + getter 名）原样摊出来，
 * 与基准已桥的清单对照。缺了就能一眼看见。
 *
 * ⚠️ 它**不跑业务**：只装配取面，不发模型调用、不写业务数据。
 */

import { mountParser } from './parser.mjs';
import { mountLecture } from './lecture.mjs';
import { stubLlm } from './_base.mjs';

/** 基准**已经桥过**的功能面（照 `scripts/knowledge_tree_bench/*.mjs` 的导出写）。 */
export const BRIDGED = Object.freeze({
  'zhiyunParser': ['parse', 'parseClassroom', 'dispose'],
  'zhiyunLecture': ['assemble', 'polish', 'buildTree', 'judgeWritten', 'dispose'],
  'zhiyunStudy': ['invoke', 'dispatch', 'dispose'],
  'zhiyunKnowledge': ['put', 'get', 'remove', 'close'],
  'zhiyunQuiz': ['generate', 'store'],
  'zhiyunNotes': ['getOrEmpty'],
});

/** 这些名字**不算**功能面（生命周期 / 诊断字段），比对时忽略。 */
const IGNORED = new Set(['dispose', 'close', 'constructor']);

/**
 * 取一批域的功能面。
 *
 * @param options.dataDir - 落盘目录。
 * @param options.llm - 可选；默认桩什么都不回（本域不跑业务，所以够了）。
 * @returns `{ domains: {service: {functions, getters, missing}}, summary }`
 */
export async function survey({ dataDir, llm } = {}) {
  const stub = llm ?? stubLlm();
  const domains = {};

  const collect = (service, label, api) => {
    const functions = Object.keys(api.functions ?? {}).filter((n) => !IGNORED.has(n)).sort();
    const getters = Object.keys(api.getters ?? {}).sort();
    const expected = BRIDGED[service] ?? [];
    // "缺"= 产品有、基准的已桥清单里没登记（不是"没桥到这个函数"，
    // 而是"没在清单里声明"——清单是核对用的人工契约）。
    const missing = expected.length ? [] : null;
    domains[service] = { label, functions, getters, expected, missing };
    return domains[service];
  };

  // 解析器
  try {
    const p = await mountParser({ dataDir: `${dataDir}parser/`, llm: stub });
    collect('zhiyunParser', '解析器', p);
  } catch (error) { domains.zhiyunParser = { label: '解析器', error: String(error?.message ?? error) }; }

  // 讲义
  try {
    const l = await mountLecture({ dataDir: `${dataDir}lecture/`, llm: stub });
    collect('zhiyunLecture', '讲义', l);
  } catch (error) { domains.zhiyunLecture = { label: '讲义', error: String(error?.message ?? error) }; }

  const total = Object.values(domains).reduce((a, d) => a + (d.functions?.length ?? 0), 0);
  return { domains, summary: { domains: Object.keys(domains).length, functions: total } };
}
