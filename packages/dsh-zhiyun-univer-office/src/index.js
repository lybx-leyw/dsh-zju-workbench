/**
 * 智云 Pro 的 **Univer Office 接入层**。
 *
 * # 这个包做什么，不做什么（先读这一段）
 *
 * 上游 `dsh-univer-office` 是一个**完整的双半边 DSH bundle**：宿主半边挂
 * `/univer-viewer` 路由、注册 14 个 agent 工具（`univer_new` / `univer_import` /
 * `univer_export` / `univer_execute` / `univer_inspect` / `univer_screenshot` …），
 * 客户端半边向 7 个宿主 UI 包注入自己的界面。
 *
 * 所以本包**不提供 UI、不包一层插件外壳**，只做四件事：
 *
 *   1. **依赖载体**：把上游锁到精确版本（见 `upstream.js` 与 `package.json`）；
 *   2. **把自己 insert 进层栈**：profile 的层栈从空条目列表开始拼，bundle 列在
 *      `dsh.profile.bundles` 里**不会自动加载** —— 漏了 `cordis.patch.yml` 里
 *      「插自己」那条，本文件的 `apply()` 永远不会被调用（路由 404、启动无日志）；
 *   3. **让上游以自己的名字进 Loader**：patch 里 insert 上游时用的是
 *      `dsh-univer-office` **这个名字** —— 客户端启动图谱按 Loader 行名定位
 *      package.json 读 `dsh.client`，换成我们的名字会把它整块界面挡掉；
 *   4. **版本核对**：启动时比对「代码预期」与「实际安装」，不一致就大声报告。
 *
 * # 与 `dsh-zhiyun-paper` 的差别（同一种接法，形态不同）
 *
 * paper 的上游**只有宿主半边**，所以那个包要自己写 UI、用 `ctx.plugin()` 编程挂载。
 * 这里上游自带客户端半边，装配交给 Loader 的行更可靠 —— 编程挂载会绕开
 * 「行名 → package.json」这条发现路径。
 *
 * # 为什么不拦启动
 *
 * 整个 profile 里任何一条 bundle 抛错，起不来的是**整个工作台**
 * （CONTRIBUTING 3.1）。版本不符有两种可能：上游做了破坏性变更（该警惕），
 * 或只是一次无关的 patch 发布（没必要让用户连侧栏都看不见）。启动那一刻
 * 分辨不出这两者 —— 所以照常启动，把不一致写进日志与状态。
 */

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

import { UPSTREAM_PACKAGE, UPSTREAM_VERSION } from './upstream.js';

export const name = 'zhiyun-univer-office';

/**
 * 只硬依赖 `profileContext`。
 *
 * ⚠️ **不 inject 上游提供的服务**（univer 的 host 服务、`dsh-tools` 等）：
 * 声明了就等于「上游没就绪时本包一直 pending」，而本包除了版本核对没有任何
 * 必须等上游才能做的事。版本核对走 `createRequire` 直接读已安装的 package.json，
 * 与宿主服务无关。
 */
export const inject = ['profileContext'];

/** 读已安装上游包的版本号（用它自己的 package.json）。 */
function installedUpstream() {
  try {
    const require = createRequire(import.meta.url);
    const file = require.resolve(`${UPSTREAM_PACKAGE}/package.json`);
    return { version: JSON.parse(readFileSync(file, 'utf8')).version, file, error: null };
  } catch (error) {
    return { version: null, file: null, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function apply(ctx, config = {}) {
  // ⚠️ 日志走 `console` 而**不是** `ctx.logger`：这一行必须落在**启动日志**里。
  //
  // 本仓成例就是 console —— `dsh-zhiyun-paper` 的版本不一致警告、
  // `dsh-paper-reader` 的 `registered tools` 都在启动日志里看得到；而
  // `ctx.logger.info` 在本机（DSH 0.2.0-rc.2）启动日志里看不到。实测踩过：
  // 宿主半边其实已经跑起来了，却因为「日志里没有这一行」被误判成没加载，
  // 白查了好几轮。锁版的价值全靠这一行刺眼，看不见就等于没锁。
  const log = (message) => { console.log(`[zhiyun-univer-office] ${message}`); };
  const warn = (message) => { console.warn(`[zhiyun-univer-office] ${message}`); };

  const installed = installedUpstream();
  const status = {
    upstream: {
      package: UPSTREAM_PACKAGE,
      expected: UPSTREAM_VERSION,
      installed: installed.version,
      file: installed.file,
      ok: installed.version === UPSTREAM_VERSION,
      error: installed.error,
    },
  };

  if (installed.version !== UPSTREAM_VERSION) {
    const seen = installed.version ?? '(未安装)';
    // 不抛错：见文件头「为什么不拦启动」。但这一行必须刺眼 —— 否则锁版就白锁了。
    warn(`上游版本与锁版不一致：期望 ${UPSTREAM_VERSION}，实际 ${seen}。`
      + 'Office 能力仍会挂载（由上游自己的 Loader 行负责），但协议可能已经变化，'
      + '请核对 /zhiyun-univer-office 的状态。');
  } else {
    log(`上游 ${UPSTREAM_PACKAGE}@${installed.version} 已就位`
      + '（14 个 agent 工具 + /univer-viewer 由上游自己的 Loader 行提供）');
  }

  // 状态查询：这一层唯一的自有路由。
  //
  // ⚠️ 用 `kind: 'prefix'` 而不是 `'exact'` —— 后者在这里拿不到请求（实测 404）。
  //    本仓的成例是 prefix（`dsh-zhiyun-paper` 的 `/zhiyun-paper` 同样形态，
  //    实测 200）。前缀路由要求自己按 pathname 分派，所以下面显式判断一次。
  ctx.inject(['webServer'], (scope) => {
    scope.effect(() => {
      const dispose = scope.webServer.register({
        kind: 'prefix',
        path: '/zhiyun-univer-office',
        handler: (req, res) => {
          const pathname = new URL(req.url, 'http://localhost').pathname;
          if (pathname !== '/zhiyun-univer-office' && pathname !== '/zhiyun-univer-office/status') {
            res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ ok: false, error: 'not found' }));
            return;
          }
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
          res.end(JSON.stringify({ ok: true, status }));
        },
      });
      return dispose;
    }, 'zhiyun: univer office status route');
  });

  const removeService = ctx.provide('zhiyunUniverOffice', {
    status: () => status,
    /** 供测试与诊断用：上游实际装在哪。 */
    upstreamFile: () => installed.file,
  });

  return () => {
    if (typeof removeService === 'function') removeService();
  };
}
