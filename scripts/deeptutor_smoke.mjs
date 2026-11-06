#!/usr/bin/env node
// DeepTutor 上游服务 · 真实联调冒烟
//
// 目的：用**真实模型**把「Python 上游出题流水线 → 反向请求 → 宿主模型服务 → 真实模型 -->
// 事件流 --> 结构化题目」这一整条链路跑一遍，留下可复核的证据。
//
// 与 tests/deeptutor-*.test.mjs 的分工：
//   - 那边用假模型桥，证明**形状**正确、能离线复跑，属于 CI 该跑的东西；
//   - 这边真的花钱、真的连网，只证明**这条链路今天在这台机器上真的通**，不放进 npm test。
//
// 凭证来源（按顺序）：
//   1. 环境变量 ZHIYUN_SMOKE_BASE_URL / ZHIYUN_SMOKE_API_KEY / ZHIYUN_SMOKE_MODEL
//   2. 仓库根 `.env` 的 BaseURL / APIkey / ModelName（该文件已被 .gitignore 忽略）
// 本脚本**从不打印密钥**，也不把它写进任何落盘文件。
//
// 用法：
//   node scripts/deeptutor_smoke.mjs                     # 跑 1 道单选题
//   node scripts/deeptutor_smoke.mjs --num 3             # 跑 3 道
//   node scripts/deeptutor_smoke.mjs --topic "红黑树的性质"
//   node scripts/deeptutor_smoke.mjs --dry-run           # 只探测解释器/依赖，不调模型
//   node scripts/deeptutor_smoke.mjs --json              # 机器可读输出
//
// 退出码：0 成功；1 有失败；2 环境不具备（没凭证/没解释器/没依赖）。

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

import {
  PythonBridge,
  probeVendorDeps,
  resolvePython,
} from '../packages/dsh-zhiyun-host-deeptutor/src/runtime.js';
import { createLlmBridge } from '../packages/dsh-zhiyun-host-deeptutor/src/models.js';
import { toQuizCandidates } from '../packages/dsh-zhiyun-host-deeptutor/src/adapters/quiz.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const PACKAGE_DIR = join(REPO_ROOT, 'packages', 'dsh-zhiyun-host-deeptutor');
const VENDOR_PATH = join(PACKAGE_DIR, 'vendor', 'deeptutor');

// ── 参数 ────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const options = {
    topic: '数据结构：二叉搜索树的基本性质',
    num: 1,
    types: ['choice'],
    difficulty: 'easy',
    timeoutMs: 600_000,
    dryRun: false,
    json: false,
    keepHome: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`参数 ${arg} 缺少取值`);
      i += 1;
      return value;
    };
    switch (arg) {
      case '--topic': options.topic = next(); break;
      case '--num': options.num = Math.max(1, Number(next()) || 1); break;
      case '--types': options.types = next().split(',').map((item) => item.trim()).filter(Boolean); break;
      case '--difficulty': options.difficulty = next(); break;
      case '--timeout': options.timeoutMs = Math.max(30_000, Number(next()) || 600_000); break;
      case '--dry-run': options.dryRun = true; break;
      case '--json': options.json = true; break;
      case '--keep-home': options.keepHome = true; break;
      case '--help': case '-h': options.help = true; break;
      default:
        if (arg.startsWith('--')) throw new Error(`未知参数：${arg}`);
    }
  }
  return options;
}

const USAGE = `DeepTutor 真实联调冒烟

  node scripts/deeptutor_smoke.mjs [选项]

  --topic <文本>        出题主题（默认「数据结构：二叉搜索树的基本性质」）
  --num <整数>          题目数量（默认 1）
  --types <a,b>         题型，逗号分隔（默认 choice）
  --difficulty <级别>   easy | medium | hard（默认 easy）
  --timeout <毫秒>      单次 turn 的上限（默认 600000）
  --dry-run             只探测解释器与依赖，不调用模型、不花 token
  --json                输出机器可读的 JSON 结果
  --keep-home           保留本次运行的 DEEPTUTOR_HOME（默认跑完删除）
  -h, --help            显示这段说明
`;

// ── 凭证 ────────────────────────────────────────────────────────────────────

/** 读仓库根 .env（KEY=VALUE，忽略注释与空行、剥引号）。文件不存在或不可读都返回空表。 */
async function readDotEnv(path) {
  const result = new Map();
  let raw = '';
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return result;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) result.set(key, value);
  }
  return result;
}

/** 按「环境变量优先、.env 兜底」解析凭证。**只返回内容，不负责脱敏**——调用方别打印。 */
async function resolveCredentials() {
  const env = await readDotEnv(join(REPO_ROOT, '.env'));
  const pick = (...keys) => {
    for (const key of keys) {
      const fromProcess = process.env[key];
      if (fromProcess) return { value: fromProcess, source: `env:${key}` };
    }
    for (const key of keys) {
      const fromFile = env.get(key);
      if (fromFile) return { value: fromFile, source: `.env:${key}` };
    }
    return { value: '', source: '' };
  };
  // 仓库根的键名是 BaseURL / APIkey / ModelName；同时接受更规范的大写写法。
  const baseUrl = pick('ZHIYUN_SMOKE_BASE_URL', 'DEEPSEEK_BASE_URL', 'BaseURL', 'BASE_URL');
  const apiKey = pick('ZHIYUN_SMOKE_API_KEY', 'DEEPSEEK_API_KEY', 'APIkey', 'API_KEY');
  const model = pick('ZHIYUN_SMOKE_MODEL', 'DEEPSEEK_MODEL', 'ModelName', 'MODEL_NAME');
  return {
    baseUrl: baseUrl.value,
    apiKey: apiKey.value,
    model: model.value,
    sources: { baseUrl: baseUrl.source, apiKey: apiKey.source, model: model.source },
  };
}

/** 永远不会打印出密钥本身：只报长度与前 3 个字符。 */
function maskSecret(value) {
  if (!value) return '(未提供)';
  if (value.length <= 6) return `${'*'.repeat(value.length)}`;
  return `${value.slice(0, 3)}…（${value.length} 字符）`;
}

// ── 宿主的真实模型服务适配器 ────────────────────────────────────────────────
//
// 形状对齐 DSH 的 `ctx.llm`：resolveModelInfo / prepareCall 返回的 prepared.stream(...)。
// 这里只是把它换成真实的 OpenAI 兼容 HTTP 调用（DeepSeek 走的就是 /chat/completions SSE）。
// 生产环境用的是宿主自己的 ctx.llm，这个适配器只服务于本冒烟脚本。

function createRealLlm({ baseUrl, apiKey, model, logger, temperature }) {
  const endpoint = `${String(baseUrl).replace(/\/+$/, '')}/chat/completions`;

  return {
    async resolveModelInfo(provider, requestedModel) {
      return {
        provider,
        model: requestedModel,
        // 上游会在没有显式档位时挑一个「关闭推理」的档位，这里如实给出。
        reasoning: { efforts: [{ id: 'off' }, { id: 'high' }] },
        inputModalities: ['text'],
        contextWindow: 131_072,
      };
    },

    async prepareCall(config) {
      return {
        config: { provider: config.provider, model: config.model ?? model, ...config },
        inputModalities: ['text'],
        async *stream({ messages = [], tools, signal, maxTokens, temperature: temp, system } = {}) {
          const body = {
            model: config.model ?? model,
            messages: toOpenAiMessages(messages, system),
            stream: true,
            stream_options: { include_usage: true },
          };
          const limit = Number(maxTokens ?? temp?.maxTokens ?? 0);
          if (Number.isFinite(limit) && limit > 0) body.max_tokens = limit;
          const t = Number(temp ?? temperature);
          if (Number.isFinite(t)) body.temperature = t;
          if (Array.isArray(tools) && tools.length > 0) {
            body.tools = toOpenAiTools(tools);
            body.tool_choice = 'auto';
          }

          const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify(body),
            signal,
          });
          if (!response.ok) {
            const detail = await response.text().catch(() => '');
            throw Object.assign(
              new Error(`模型接口返回 ${response.status}：${detail.slice(0, 300)}`),
              { status: response.status },
            );
          }

          let textIndex = 0;
          let reasoningIndex = 0;
          let finishReason = null;
          let toolIndex = 0;
          const pendingTools = new Map();

          for await (const event of readSse(response.body, signal)) {
            let payload;
            try {
              payload = JSON.parse(event);
            } catch {
              continue;
            }
            const choice = payload?.choices?.[0];
            const delta = choice?.delta ?? {};
            if (delta.reasoning_content) {
              yield { type: 'reasoning-delta', index: reasoningIndex, text: String(delta.reasoning_content) };
              reasoningIndex += 1;
            }
            if (delta.content) {
              yield { type: 'text-delta', index: 0, text: String(delta.content) };
              textIndex += 1;
            }
            if (Array.isArray(delta.tool_calls)) {
              for (const call of delta.tool_calls) {
                const key = call.index ?? toolIndex;
                const entry = pendingTools.get(key) ?? { id: call.id ?? '', name: '', arguments: '' };
                if (call?.function?.name) entry.name = String(call.function.name);
                if (call?.function?.arguments) entry.arguments += String(call.function.arguments);
                if (call?.id) entry.id = String(call.id);
                pendingTools.set(key, entry);
                toolIndex = Math.max(toolIndex, Number(key) + 1);
              }
            }
            if (choice?.finish_reason) finishReason = String(choice.finish_reason);
            if (payload?.usage) {
              const u = payload.usage;
              const input = Number(u.prompt_tokens ?? 0);
              const output = Number(u.completion_tokens ?? 0);
              yield {
                type: 'usage',
                usage: {
                  input,
                  output,
                  total: Number(u.total_tokens ?? input + output),
                  cacheRead: Number(u.prompt_cache_hit_tokens ?? 0) || undefined,
                  cacheWrite: Number(u.prompt_cache_miss_tokens ?? 0) || undefined,
                },
              };
            }
          }

          // 把拼好的工具调用作为 block-end 交回去：上游按 block 处理，半截 JSON 它不好用。
          for (const [key, entry] of pendingTools) {
            yield {
              type: 'block-end',
              index: key,
              block: { type: 'tool-call', id: entry.id, name: entry.name, arguments: entry.arguments },
            };
          }
          yield {
            type: 'finish',
            reason: {
              kind: finishReason === 'length'
                ? 'max-tokens'
                : finishReason === 'tool_calls' ? 'tool-calls' : 'stop',
            },
          };
          logger?.debug?.(`模型流结束：text chunks=${textIndex}, finish=${finishReason ?? 'stop'}`);
        },
      };
    },
  };
}

/**
 * 宿主的工具形状 → OpenAI 的 tools。
 *
 * 宿主侧 `ctx.llm` 认的是扁平 `{ name, description, parameters }`（见 packages/dsh-zhiyun-core-parser
 * 的 llm.js 与 models.js 的 toToolSchemas），而 OpenAI 的 `tools` 要求外面再套一层
 * `{ type: 'function', function: {...} }`。少了这层 `type`，服务端会以 422
 * 「missing field `type`」拒掉整个请求 —— 这里必须补，不能把宿主形状直传。
 */
function toOpenAiTools(tools) {
  const out = [];
  for (const tool of tools) {
    if (!tool) continue;
    // 已经是 OpenAI 形状的就原样放行（幂等，避免二次包装）。
    if (tool.type === 'function' && tool.function) {
      out.push(tool);
      continue;
    }
    const name = String(tool.name ?? tool.function?.name ?? '').trim();
    if (!name) continue;
    out.push({
      type: 'function',
      function: {
        name,
        description: String(tool.description ?? ''),
        parameters: tool.parameters ?? tool.inputSchema ?? { type: 'object', properties: {} },
      },
    });
  }
  return out;
}

/** 宿主的消息形状（content 是块数组）→ OpenAI 的 messages。 */function toOpenAiMessages(messages, system) {
  const out = [];
  if (system) out.push({ role: 'system', content: String(system) });
  for (const message of messages ?? []) {
    const role = message?.role === 'assistant' ? 'assistant' : message?.role === 'system' ? 'system' : 'user';
    const parts = Array.isArray(message?.content) ? message.content : [{ type: 'text', text: String(message?.content ?? '') }];
    const text = parts
      .filter((part) => part?.type === 'text')
      .map((part) => String(part.text ?? ''))
      .join('');
    if (text) out.push({ role, content: text });
  }
  return out.length > 0 ? out : [{ role: 'user', content: '' }];
}

/** 读 SSE：按行切，取出 `data:` 后的 JSON 文本。 */
async function* readSse(stream, signal) {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of stream) {
    if (signal?.aborted) return;
    buffer += decoder.decode(chunk, { stream: true });
    let index = buffer.indexOf('\n');
    while (index >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line.startsWith('data:')) {
        const data = line.slice(5).trim();
        if (data && data !== '[DONE]') yield data;
      }
      index = buffer.indexOf('\n');
    }
  }
  const tail = buffer.trim();
  if (tail.startsWith('data:')) {
    const data = tail.slice(5).trim();
    if (data && data !== '[DONE]') yield data;
  }
}

// ── 主流程 ──────────────────────────────────────────────────────────────────

const stripWindowsLeadingSlash = (value) => String(value).replace(/^\/([A-Za-z]:)/, '$1');

function createLogger(quiet) {
  const log = (...args) => { if (!quiet) console.log(...args); };
  return {
    debug() {},
    info: log,
    warn: (...args) => console.warn('[警告]', ...args),
    error: (...args) => console.error('[错误]', ...args),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  const logger = createLogger(options.json);
  const report = {
    ok: false,
    at: new Date().toISOString(),
    options: { topic: options.topic, num: options.num, types: options.types, difficulty: options.difficulty },
    python: null,
    deps: null,
    credentials: null,
    llmShim: null,
    events: [],
    reverseRequests: 0,
    modelCalls: 0,
    result: null,
    error: null,
  };

  // 1. 解释器
  const python = await resolvePython({ rootDir: PACKAGE_DIR, env: process.env, logger });
  report.python = { ok: python.ok === true, version: python.version ?? null, source: python.source ?? null, reason: python.reason ?? null };
  if (python.ok !== true) {
    report.error = { stage: 'python', message: python.reason || '找不到 3.11–3.14 的解释器' };
    return finish(report, options, 2);
  }
  logger.info(`解释器：Python ${python.version}（来源 ${python.source}）`);

  // 2. 依赖
  const deps = await probeVendorDeps({
    pythonPath: python.path, pythonArgs: python.args ?? [], vendorPath: VENDOR_PATH, env: process.env, logger, rootDir: REPO_ROOT,
  });
  report.deps = { installed: deps.installed === true, version: deps.deeptutorVersion ?? null, missing: deps.missing ?? [], reason: deps.reason ?? null };
  if (deps.installed !== true) {
    report.error = {
      stage: 'deps',
      message: deps.reason || `上游依赖未安装（缺 ${(deps.missing ?? []).join('、') || '未知'}）`,
      hint: '用 3.11–3.14 的解释器安装 vendor/deeptutor/requirements/server.txt',
    };
    return finish(report, options, 2);
  }
  logger.info(`上游：deeptutor ${deps.deeptutorVersion}，依赖齐全`);

  // 3. 凭证
  const credentials = await resolveCredentials();
  report.credentials = {
    baseUrl: credentials.baseUrl || null,
    model: credentials.model || null,
    apiKey: maskSecret(credentials.apiKey),
    sources: credentials.sources,
  };
  const missing = [];
  if (!credentials.baseUrl) missing.push('BaseURL');
  if (!credentials.apiKey) missing.push('APIkey');
  if (!credentials.model) missing.push('ModelName');
  if (missing.length > 0) {
    report.error = {
      stage: 'credentials',
      message: `缺少模型凭证：${missing.join('、')}`,
      hint: '在仓库根 .env 里写 BaseURL / APIkey / ModelName，或设置 ZHIYUN_SMOKE_* 环境变量',
    };
    return finish(report, options, 2);
  }
  logger.info(`凭证：${credentials.model} @ ${credentials.baseUrl}（key ${maskSecret(credentials.apiKey)}，来自 ${credentials.sources.apiKey}）`);

  if (options.dryRun) {
    logger.info('--dry-run：环境自检通过，不调用模型。');
    report.ok = true;
    return finish(report, options, 0);
  }

  // 4. 起桥
  const homeDir = join(REPO_ROOT, '.runtime', `smoke-deeptutor-${randomUUID().slice(0, 8)}`);
  await mkdir(homeDir, { recursive: true });
  const bridge = new PythonBridge({
    rootDir: PACKAGE_DIR,
    vendorPath: stripWindowsLeadingSlash(VENDOR_PATH),
    homeDir: stripWindowsLeadingSlash(homeDir),
    profileDir: stripWindowsLeadingSlash(homeDir),
    logger,
    requestTimeoutMs: options.timeoutMs,
  });
  bridge.useResolvedPython(python);

  const realLlm = createRealLlm({
    baseUrl: credentials.baseUrl,
    apiKey: credentials.apiKey,
    model: credentials.model,
    logger,
  });
  const selection = { provider: 'custom', model: credentials.model };
  const llmBridge = createLlmBridge({
    llm: () => realLlm,
    attachments: () => null,
    getSelection: () => selection,
    logger,
  });
  // 旁听：统计反向请求（不抢处理，永远返回 undefined）。
  // **必须在 attachTo 之前注册**：runtime.js 按注册顺序问 handler，谁先回非 undefined 就归谁，
  // 而 models.js 是会真处理的，排在后面就轮不到统计。
  bridge.onRequest(async (method) => {
    if (String(method).startsWith('llm.')) report.reverseRequests += 1;
    return undefined;
  });
  const detachLlm = llmBridge.attachTo(bridge);

  const runId = `smoke-${Date.now().toString(36)}`;
  let settled = false;
  bridge.onNotification((method, params) => {
    if (method === 'turn.event') {
      const event = params?.event ?? params;
      report.events.push({
        seq: event?.seq ?? null,
        kind: event?.kind ?? null,
        upstreamType: event?.upstreamType ?? null,
        stage: event?.stage ?? null,
        content: typeof event?.content === 'string' ? event.content.slice(0, 400) : null,
        // 终态事件的产物在 metadata 里（上游 StreamEvent.result(data) 是把 data 摊进
        // metadata 的，content 反而是空串）。留一份用于诊断 result 形状。
        metadata: event?.metadata && typeof event.metadata === 'object'
          ? truncateValue(event.metadata, 2000)
          : null,
      });
      if (!options.json) {
        const line = String(event?.content ?? '').replace(/\s+/g, ' ').slice(0, 90);
        logger.info(`[${String(report.events.length).padStart(3)}] ${event?.kind ?? '?'} (${event?.upstreamType ?? '-'}) ${event?.stage ?? '-'} ${line}`);
      }
      if (event?.kind === 'done' || event?.kind === 'result' || event?.kind === 'error') settled = true;
    } else if (method === 'run.result') {
      settled = true;
    }
  });

  const startedAt = Date.now();
  try {
    await bridge.start();
    logger.info(`桥状态：${bridge.state()}，传输 ${bridge.info()?.transport ?? '?'}`);

    const handshake = await bridge.request('turn.start', {
      runId,
      capability: 'deep_question',
      content: options.topic,
      llm: selection,
      config: {
        topic: options.topic,
        num_questions: options.num,
        question_types: options.types,
        difficulty: options.difficulty,
      },
    }, { timeoutMs: options.timeoutMs });
    logger.info(`turn.start => ${JSON.stringify(handshake).slice(0, 300)}`);
    report.turn = handshake ?? null;

    const deadline = startedAt + options.timeoutMs;
    while (!settled && Date.now() < deadline) {
      await new Promise((done) => setTimeout(done, 400));
    }

    const result = await bridge.request('turn.result', { runId }, { timeoutMs: 60_000 })
      .catch((error) => ({ error: { kind: error.kind ?? 'E_UNKNOWN', message: error.message } }));
    // `result` 形状随能力变化：`deep_question` 实测交回的是 `{content: "<markdown>"}`，
    // 不是结构化题目数组。结构化解析是适配器的活（src/adapters/quiz.js），桥不猜。
    // 这里两条都跑一遍：结构化能认就报题目，认不出就报 Markdown 证据，别假装没有产物。
    const capabilityResult = result?.result ?? null;
    const adapted = (() => {
      try {
        return toQuizCandidates({ capabilityResult, runId });
      } catch (error) {
        return { questions: [], diagnostics: [{ kind: 'adapter-threw', message: error?.message ?? String(error) }] };
      }
    })();
    const resultText = extractResultText(capabilityResult);
    report.result = {
      status: result?.status ?? null,
      turnId: result?.turnId ?? null,
      sessionId: result?.sessionId ?? null,
      usage: result?.usage ?? null,
      error: result?.error ?? null,
      // 题目本体可能很大，只留关键字段用于汇报；完整内容见落盘的证据文件。
      questions: extractQuestions(capabilityResult?.questions ?? capabilityResult?.questions_list ?? []),
      adaptedCount: adapted.questions.length,
      adaptedTypes: adapted.questions.map((item) => item.type),
      adapterDiagnostics: adapted.diagnostics.slice(0, 10),
      contentLength: resultText.length,
      contentPreview: resultText.slice(0, 600),
    };
    report.llmShim = (await bridge.request('status', {}, { timeoutMs: 30_000 }).catch(() => null))?.llmShim ?? null;
    report.modelCalls = report.reverseRequests;
    report.error = result?.error ?? null;
    // 通过判据：终态成功 **且** 真的产出了内容（题目数组或 Markdown 正文）。
    // 只看 status 会被「成功但空结果」骗过；只看内容会把失败当成功。
    const terminalOk = result?.status === 'succeeded' || result?.status === 'completed';
    const produced = report.result.questions.length > 0 || resultText.length > 0;
    report.ok = terminalOk && produced;
    report.elapsedMs = Date.now() - startedAt;

    const evidenceDir = join(REPO_ROOT, '.runtime', 'deeptutor-smoke');
    await mkdir(evidenceDir, { recursive: true });
    const evidencePath = join(evidenceDir, `smoke-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    await writeFile(evidencePath, `${JSON.stringify({ ...report, raw: result }, null, 2)}\n`, 'utf8');
    report.evidence = evidencePath;
    return finish(report, options, report.ok ? 0 : 1);
  } catch (error) {
    report.error = { stage: 'run', kind: error?.kind ?? null, message: error?.message ?? String(error) };
    return finish(report, options, 1);
  } finally {
    detachLlm?.();
    await bridge.stop({ drain: false }).catch(() => {});
    if (!options.keepHome) await rm(homeDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** 只挑出汇报需要的题目字段：上游 result 形状可能随版本变，这里做宽容提取。 */
function extractQuestions(questions) {
  if (!Array.isArray(questions)) return [];
  return questions.slice(0, 20).map((question, index) => ({
    index,
    type: question?.type ?? question?.question_type ?? null,
    stem: typeof question?.stem === 'string'
      ? question.stem.slice(0, 300)
      : typeof question?.question === 'string' ? question.question.slice(0, 300) : null,
    options: Array.isArray(question?.options) ? question.options.slice(0, 8) : null,
    answer: question?.correct_answer ?? question?.answer ?? null,
    explanation: typeof question?.explanation === 'string' ? question.explanation.slice(0, 300) : null,
  }));
}

/** 把任意值压成可落盘的短表示：字符串截断、深对象只留浅层键。 */
function truncateValue(value, limit) {
  const text = JSON.stringify(value);
  if (typeof text !== 'string') return null;
  return text.length <= limit ? value : { truncated: true, preview: text.slice(0, limit) };
}

/**
 * 从能力结果里取出「用户会看到的正文」。
 *
 * 实测 `deep_question` 交回 `{content: "<markdown>"}`；其它能力可能用 `response`/`text`/
 * `answer`。这里只做展示层提取，**不代替适配器做结构化解析**。
 */
function extractResultText(capabilityResult) {
  if (!capabilityResult) return '';
  if (typeof capabilityResult === 'string') return capabilityResult;
  for (const key of ['content', 'response', 'text', 'answer', 'markdown']) {
    const value = capabilityResult[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return '';
}

function finish(report, options, exitCode) {
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    console.log('\n── 结论 ──────────────────────────────────────');
    console.log(`结果：${report.ok ? '通过' : '未通过'}`);
    console.log(`反向模型请求：${report.reverseRequests}`);
    console.log(`事件数：${report.events.length}（${[...new Set(report.events.map((e) => e.upstreamType).filter(Boolean))].join(', ') || '无'}）`);
    if (report.result?.questions?.length) {
      console.log(`题目数：${report.result.questions.length}`);
      for (const question of report.result.questions) {
        console.log(`  · [${question.type ?? '?'}] ${question.stem ?? '(无题干)'}`);
        if (question.options) console.log(`    选项：${question.options.join(' / ')}`);
        console.log(`    答案：${question.answer ?? '(无)'}`);
      }
    }
    if (report.result?.adaptedCount) {
      console.log(`适配器识别：${report.result.adaptedCount} 道（${report.result.adaptedTypes.join('/')}）`);
    } else if (report.result?.contentLength) {
      console.log(`产物：${report.result.contentLength} 字符正文（上游交回的是正文而非结构化题目；`);
      console.log(`      结构化解析归 core-quiz 适配器，这里只证明产物到了）`);
      console.log(`预览：${String(report.result.contentPreview ?? '').replace(/\s+/g, ' ').slice(0, 160)}…`);
    }
    if (report.result?.adapterDiagnostics?.length) {
      const kinds = [...new Set(report.result.adapterDiagnostics.map((item) => item.kind ?? '?'))];
      console.log(`适配器诊断：${kinds.join(', ')}`);
    }
    if (report.llmShim) {
      console.log(`垫片：${report.llmShim.installed ? '已装' : '未装'}（${(report.llmShim.patchedModules ?? []).length} 个模块）`);
    }
    if (report.error) console.log(`错误：${report.error.message ?? JSON.stringify(report.error)}`);
    if (report.evidence) console.log(`证据：${report.evidence}`);
    console.log('');
  }
  return exitCode;
}

const exitCode = await main().catch((error) => {
  console.error('冒烟脚本崩溃：', error?.stack ?? error);
  return 1;
});
process.exit(exitCode);
