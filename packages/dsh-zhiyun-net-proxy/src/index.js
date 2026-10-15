/**
 * 智云 Pro 的**网络代理宿主半边**。
 *
 * # 它解决什么问题
 *
 * DSH 实例默认会继承全局代理设置（环境变量或宿主启动器解析出的策略）。对
 * DeepSeek 官方接口这类**海外**目标，走代理是对的；但智云（`*.zju.edu.cn`）是
 * 国内站点，绕道海外代理既慢又不稳。此前 `NO_PROXY` 里没有任何 zju 域名，
 * 于是「我的课 / 学习 / 今天」的取数全被送去海外代理 —— 表现为页面长时间
 * 停在「正在连接课堂与学习资料…」。
 *
 * 更根本的问题是：**环境变量表达不了分域路由**。它只能给出「一个代理 + 一串
 * 绕开名单」，没法让「域 A 走代理 1、域 B 走代理 2」。所以本包不靠环境变量，
 * 而是让所有出口流量经过一个本地中继，由中继按用户配置的路由表分发：
 *
 * ```
 *   页面取数 / agent 抓取 ─► 宿主的出口策略 ─► 本中继 ─┬─► 代理 A（如海外）
 *                                                    ├─► 代理 B（如校园）
 *                                                    └─► 直连
 * ```
 *
 * 配置（代理列表、域名规则、默认策略）全部由用户在「个人 → 网络代理」里填写；
 * 代理数量不设上限。本包**不预设任何代理地址或域名**。
 *
 * # 生命周期
 *
 *   apply  ：读配置 → 起中继 → 若启用则接管出口 → 注册设置路由
 *   热更   ：设置页保存后调 `reload()`，重新读配置；出口的增删即时生效
 *   卸载   ：还原出口、停中继、摘服务（不影响别的插件）
 *
 * 中继端口**终身不变**：出口策略一旦指向它就不需要重装。宿主侧有些组件
 * （如别的插件的 `EnvHttpProxyAgent`）是模块级单例、构造时读一次地址并
 * 长连接池化，端口一变它们会连到死端口且永不自愈 —— 保持端口稳定是刻意选择。
 */

import { DEFAULT_TIMEOUT_MS, ROUTE_PATH } from './constants.js';
import { configPath, loadConfig, saveConfig, withInheritedDirect } from './config.js';
import { createRelay } from './relay.js';
import { directHosts, installEgress, verifyEgress } from './egress.js';
import { createSettingsHandler } from './settings.js';

export const name = 'zhiyun-net-proxy';

/**
 * 只硬依赖 `profileContext`（拿数据目录）。`webServer` 走 `ctx.inject` 惰性取 ——
 * 可选宿主服务不写进 inject，否则对方没就绪时本插件会一直 pending，
 * 连累整个前端（这条规矩见 dsh-zhiyun-paper 与 dsh-zhiyun-study-core 的注释）。
 */
export const inject = ['profileContext'];

export async function apply(ctx, config = {}) {
  const log = (message) => {
    const line = `[zhiyun-net-proxy] ${message}`;
    if (typeof ctx.logger?.info === 'function') ctx.logger.info(line);
    else console.log(line);
  };
  const warn = (message) => {
    const line = `[zhiyun-net-proxy] ${message}`;
    if (typeof ctx.logger?.warn === 'function') ctx.logger.warn(line);
    else console.warn(line);
  };

  const file = config.dataFile ?? configPath(ctx.profileContext.dir);
  // ⚠️ 必须在**装出口之前**读一次：`installEgress` 会把 no_proxy 改写成我们自己的值，
  //    之后再读就只能读到自己的结果（用户原意已经不可见了）。
  const inherited = directHosts();

  /**
   * 读配置，并把「从环境继承来的直连域名」并进去。
   *
   * 合并放在这里（而不是散在策略层与中继各自处理）的理由：两条通道**必须**给出
   * 同一个答案 —— 策略层说「直连」而中继说「走代理」正是宿主那条硬约束禁止的不一致。
   */
  const readConfig = () => withInheritedDirect(loadConfig(file, warn), inherited);
  let current = readConfig();

  const status = {
    file,
    relay: { port: null, listening: false },
    active: false,
    verified: false,
    egressVia: null,
    errors: [],
  };

  // 中继每连接实时取配置：设置页一保存就生效，无需重启，也不需要重装出口策略。
  const relay = createRelay({
    getConfig: () => current,
    timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    log: (entry) => {
      // 只记「去向」这一类可解释信息，不记请求内容：这是排查分流的唯一线索。
      if (entry.error) status.errors.push(`${entry.kind} ${entry.host ?? ''}: ${entry.error}`.trim());
      if (entry.error) warn(`${entry.host ?? entry.kind} 失败：${entry.error}`);
      else if (config.verboseRouting) log(`${entry.host}:${entry.port ?? ''} → ${entry.via}${entry.matched ? `（命中 ${entry.matched}）` : '（默认策略）'}`);
    },
  });

  /** 出口还原函数。启用/停用切换时用它回到安装前状态。 */
  let restoreEgress = null;

  /**
   * 按当前配置决定是否接管出口。幂等：重复调用不会叠加策略。
   *
   * ⚠️ 停用时**先改状态、再等还原**，不能反过来。宿主返回的还原函数内部是
   *    「先恢复环境变量、再 `await agent.close()`」，而 `close()` 会等**在飞请求**
   *    结束才返回。真机上踩过：一条卡死的请求（代理不可用 → 连接一直挂着）让
   *    `close()` 永不返回，于是写在它后面的 `status.active = false` 永远执行不到 ——
   *    界面显示「已接管」而用户已经点了关闭，看起来像开关失灵。
   *    环境变量其实是同步就恢复了的，所以状态可以也应该立刻反映出来。
   */
  async function syncEgress() {
    if (current.enabled && !restoreEgress) {
      const url = relay.url;
      if (!url) {
        warn('中继未启动，无法接管出口');
        return;
      }
      try {
        restoreEgress = await installEgress(url, warn);
        status.active = true;
        status.egressVia = 'relay';
        const check = await verifyEgress();
        status.verified = check.verified;
        if (!check.verified) warn(`出口自检未通过：${check.reason}（请求可能仍走旧出口）`);
      } catch (error) {
        status.active = false;
        status.errors.push(`接管出口失败：${error.message}`);
        warn(`接管出口失败，本次仍按原出口运行：${error.message}`);
        restoreEgress = null;
      }
      return;
    }

    if (!current.enabled && restoreEgress) {
      const dispose = restoreEgress;
      // 立刻清引用：否则紧接着的重新启用会看到「已接管」而跳过安装。
      restoreEgress = null;
      status.active = false;
      status.verified = false;
      status.egressVia = null;
      log('已停用代理接管（回到宿原本的出口策略）');
      try {
        // 不 await 到「确保关闭」为止：在飞请求可能很久才结束，而那不是停用该等的事。
        // 环境变量在 dispose 内部是同步恢复的，所以此刻新请求已经走回原出口。
        await dispose();
      } catch (error) {
        warn(`还原出口时出错（环境已恢复，仅连接池清理未完成）：${error.message}`);
      }
    }
  }

  /** 保存后重新读配置并同步出口。 */
  async function reload() {
    current = readConfig();
    await syncEgress();
    return current;
  }

  // ── 起中继 ──────────────────────────────────────────────────────────
  // 中继**始终**监听（即使当前未启用）：端口终身不变，启用时无需重建，
  // 也避免「启用/停用」反复切换时端口漂移导致第三方单例连到死端口。
  try {
    const port = await relay.start();
    status.relay = { port, listening: true };
    log(`中继已监听 127.0.0.1:${port}（代理 ${current.proxies.length} 个，规则 ${current.rules.length} 条，当前${current.enabled ? '已启用' : '未启用'}）`);
  } catch (error) {
    status.errors.push(`中继启动失败：${error.message}`);
    warn(`中继启动失败，网络代理不可用：${error.message}`);
  }

  await syncEgress();

  // ── 设置路由 ────────────────────────────────────────────────────────
  ctx.inject(['webServer'], (scope) => {
    scope.effect(() => {
      const handler = createSettingsHandler({
        getConfig: () => current,
        save: async (next) => {
          const saved = saveConfig(file, next);
          await reload();
          return saved;
        },
        reload,
        // 只回运行状态，**不回配置**：配置里含代理密码，而路由是给同源页面读的。
        // 配置本身单独经 `config` 字段返回，那条路径会打码（见 settings.js 的 maskConfig）。
        // 早先这里顺手把 `config` 挂在 status 上，等于让打码形同虚设。
        status: () => ({ ...status }),
      });
      const dispose = scope.webServer.register({ kind: 'exact', path: ROUTE_PATH, handler });
      log(`设置路由：${ROUTE_PATH}`);
      return dispose;
    }, 'zhiyun: net-proxy settings route');
  });

  const removeService = ctx.provide('zhiyunNetProxy', {
    routePath: ROUTE_PATH,
    file,
    relayUrl: () => relay.url,
    config: () => current,
    reload,
    status: () => status,
  });

  return async () => {
    // 顺序要紧：先摘设置路由与服务，再还原出口，最后停中继。
    // 反过来的话，还原出口的异步窗口里若还有请求打进来，会打到一个已停的中继上。
    if (typeof removeService === 'function') removeService();
    if (restoreEgress) {
      try { await restoreEgress(); } catch { /* 卸载即退出，尽力而为 */ }
      restoreEgress = null;
    }
    relay.stop();
    status.active = false;
    status.relay.listening = false;
  };
}
