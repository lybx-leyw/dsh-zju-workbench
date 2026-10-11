/**
 * 兼容层自有的 HTTP 面（前缀 `/zhiyun-paper`）。
 *
 * # 为什么只有两条路由
 *
 * 阅读、文献库、转录、整篇翻译、会话注入 —— 上游那 24 条 `/paper-reader/*` 路由
 * 我们**原样复用**（上游宿主半边以子插件挂在本包下，见 `index.js`），页面直接
 * 打它们即可。这一层只补齐上游没有的那一件事：**选中即译**。
 *
 * 之所以不把上游的路由反代一遍（页面统一打 `/zhiyun-paper/*`）：那需要复刻
 * 上游每个端点的请求/响应形状，等于把「兼容层」写成了「重新实现」，
 * 上游一升级就要跟着改一遍 —— 而锁版的意义正是「不改上游」。
 *
 * # 前缀为什么不能是 `/paper-reader`
 *
 * 宿主的 `webserver.register` 对同 (kind, path) 重复注册会直接抛
 * `webserver: duplicate prefix route "/paper-reader"`。上游已经占了那条前缀，
 * 我们再用就是把自己炸掉；换个前缀，两条路由表各活各的。
 */

import { PaperError, paperErrorStatus } from './errors.js';

/** 本包自有路由前缀。页面侧的同名常量在 `dsh-zhiyun-page-paper/src/library.js`。 */
export const PAPER_ROUTE_PREFIX = '/zhiyun-paper';

/** 请求体上限：一段选中文本最多千余字符，64KB 只用来拦住畸形请求。 */
const MAX_BODY_BYTES = 64 * 1024;

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req, limit = MAX_BODY_BYTES) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new PaperError('INPUT', `请求体过大（上限 ${limit} 字节）`);
    chunks.push(chunk);
  }
  if (size === 0) return {};
  let parsed;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new PaperError('INPUT', '请求体不是合法 JSON');
  }
  return parsed && typeof parsed === 'object' ? parsed : {};
}

/** 把任意异常收敛成 PaperError，保证对外永远是 `{ error, code }` 的形状。 */
function asPaperError(err) {
  if (err instanceof PaperError) return err;
  return new PaperError('INTERNAL', err instanceof Error ? err.message : String(err), { cause: err });
}

/**
 * @param options.connection - 宿主 `connection` 服务；`requestRejection(req)` 返回
 *   401/403/undefined，挡掉非本应用来源的请求（与上游同一套防护）。
 * @param options.getTranslator - 惰性取翻译器。返回 `null` 表示当前拿不到窄 llm 接口。
 * @param options.describe - 产出 `/api/status` 的负载（上游挂载状态、版本核对结果、缓存统计）。
 */
export function createPaperHandler({ connection, getTranslator, describe }) {
  const deps = { getTranslator, describe };

  return function handler(req, res) {
    const rejection = typeof connection?.requestRejection === 'function'
      ? connection.requestRejection(req)
      : undefined;
    if (rejection !== undefined) {
      sendJson(res, rejection, { error: rejection === 401 ? 'unauthorized' : 'forbidden' });
      return;
    }

    const url = new URL(req.url ?? '/', 'http://localhost');
    const sub = url.pathname.slice(PAPER_ROUTE_PREFIX.length);

    Promise.resolve()
      .then(() => dispatch(req, res, url, sub, deps))
      .catch((err) => {
        const error = asPaperError(err);
        if (!res.headersSent) sendJson(res, paperErrorStatus(error.code), { error: error.message, code: error.code });
        else res.end();
      });
  };
}

async function dispatch(req, res, url, sub, { getTranslator, describe }) {
  if (sub === '/api/status') {
    if (req.method !== 'GET') return sendMethodNotAllowed(res, 'GET');
    return sendJson(res, 200, describe());
  }

  if (sub === '/api/translate') {
    if (req.method !== 'POST') return sendMethodNotAllowed(res, 'POST');
    const body = await readJsonBody(req);
    const translator = getTranslator();
    if (!translator) {
      throw new PaperError('NO_LLM', '选中翻译需要文本模型：请在「个人 → 设置 → AI 服务」里配置一个模型，'
        + '并确认 profile 已启用 dsh-zhiyun-parser');
    }
    const result = await translator.translate(body.text);
    return sendJson(res, 200, result);
  }

  return sendJson(res, 404, { error: `not found: ${url.pathname}`, code: 'NOT_FOUND' });
}

function sendMethodNotAllowed(res, allow) {
  res.writeHead(405, { 'content-type': 'application/json; charset=utf-8', allow });
  res.end(JSON.stringify({ error: `只支持 ${allow}`, code: 'METHOD' }));
}
