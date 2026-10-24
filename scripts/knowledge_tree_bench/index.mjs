#!/usr/bin/env node
/**
 * 知识树基准台（knowledge tree bench）的入口。
 *
 * 用法：
 *
 *     node scripts/knowledge_tree_bench/index.mjs --root <repo/> --what tree
 *     node scripts/knowledge_tree_bench/index.mjs --what pipeline,shell --json
 *     node scripts/knowledge_tree_bench/index.mjs --what all
 *
 * `--what` 选要桥哪几域（逗号分隔）：
 *
 *     tree      建树/重构的纯函数（筛支线 → 挂账 → 审查 → 合并 → 拆叶 → 重聚）
 *     pipeline  共享队列 + worker 池（vision‖mix 的调度器）
 *     tokenize  斩杀线的 token 估算
 *     shell     版式与路由契约（NAV / FULL_BLEED_PAGES / 页面画像 / 侧栏）
 *     lecture   讲义两级加工（assemble / polish）+ 建树与文本 codec
 *     parser    真解析器服务（需要 llm 桩，跑真 parse 链路）
 *     surface   各域服务**暴露了哪些功能函数**（契约快照，不跑业务）
 *
 * 输出：每条一行 `@@BENCH@@{json}`，便于外层（脚本或 CI）流式解析。
 * 失败也走同一行格式（`ok:false` + `code`），**不让进程以异常退出** ——
 * 一域失败不该吞掉其它域的结论。
 *
 * # 组织方式
 *
 * 一个域一个文件，共享 `_base.mjs` 的装配与工具。新增一域只要加一个文件
 * + 在下面的 `DOMAINS` 里登记一行。
 *
 * # 与 `scripts/source_bridge` 的关系
 *
 * 同一个套路（桥而不是重写、一域一文件、`@@RESULT@@` 式流式输出），
 * 但目标不同：source_bridge 验的是**真机数据源**，这里验的是**算法与契约**。
 */

import path from 'node:path';

import { setRoot, fail } from './_base.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

/**
 * 域注册表。
 *
 * `needsLlm` 说明这一域要不要模型桩 —— 基准**永远不调真模型**，
 * 需要的一方由入口注入一个显式回包的桩（没给回包就报 NOT_CONFIGURED）。
 */
const DOMAINS = {
  tree: { module: './parser.mjs', fn: 'pureApi', label: '建树与重构（纯函数）' },
  pipeline: { module: './parser.mjs', fn: 'pipelineFunctions', label: '共享队列与 worker 池' },
  tokenize: { module: './parser.mjs', fn: 'tokenizeFunctions', label: 'token 估算' },
  shell: { module: './shell.mjs', fn: 'shellFunctions', label: '版式与路由契约' },
  lecture: { module: './lecture.mjs', fn: 'pureApi', label: '讲义加工（纯函数面）' },
  parser: { module: './parser.mjs', fn: 'mountParser', label: '解析器服务', needsLlm: true },
  surface: { module: './surface.mjs', fn: 'survey', label: '各域功能面快照' },
};

function parseArgs(argv) {
  const args = { root: null, what: '', json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--root') { args.root = argv[++i]; continue; }
    if (token === '--what') { args.what = argv[++i] ?? ''; continue; }
    if (token === '--json') { args.json = true; continue; }
  }
  return args;
}

const emit = (value) => process.stdout.write(`@@BENCH@@${JSON.stringify(value)}\n`);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.root) args.root = path.resolve(HERE, '..', '..');
  const root = args.root.replace(/[\\/]+$/, '') + path.sep;
  setRoot(root);

  const names = (args.what || 'tree,tokenize,shell').split(',').map((s) => s.trim()).filter(Boolean);
  const unknown = names.filter((name) => !DOMAINS[name]);
  if (unknown.length) {
    emit({ ok: false, code: 'UNKNOWN_DOMAIN', message: `未知域：${unknown.join(', ')}。可用：${Object.keys(DOMAINS).join(', ')}` });
    return 0;
  }

  for (const name of names) {
    const spec = DOMAINS[name];
    const begin = Date.now();
    try {
      const domain = await import(new URL(spec.module, import.meta.url).href);
      // 需要模型的域：给"模型说什么"，不给"一个 llm 对象"—— 中间还有产品自己的
      // 适配层要走。默认不回包（`NOT_CONFIGURED`），基准用例必须显式说明。
      const respond = spec.needsLlm
        ? () => { throw Object.assign(new Error('基准没有为这条链路提供模型回包'), { code: 'NOT_CONFIGURED' }); }
        : undefined;
      const api = await domain[spec.fn]({
        dataDir: path.join(root, '.verify-scratch', 'knowledge-tree-bench', name) + path.sep,
        respond,
      });
      emit({ domain: name, ok: true, ms: Date.now() - begin, label: spec.label, keys: Object.keys(api ?? {}).sort() });
    } catch (error) {
      emit({ domain: name, ms: Date.now() - begin, label: spec.label, ...fail(error) });
    }
  }

  return 0;
}

main().then((code) => { process.exitCode = code ?? 0; }).catch((error) => {
  emit({ ok: false, code: error?.code ?? 'BENCH_ERROR', message: String(error?.message ?? error).slice(0, 400) });
  process.exitCode = 1;
});
