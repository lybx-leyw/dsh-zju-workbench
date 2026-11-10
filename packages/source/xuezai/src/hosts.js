/**
 * 学在浙大的站点常量。
 *
 * # 为什么单独一个文件
 *
 * `xzzd.js` / `xzzd-reads.js` / `index.js` 三处都要用这些地址，而 `index.js`
 * 又要引用那两个模块 —— 放一起就成循环导入。常量最没有依赖，单独一层最省事。
 *
 * # 这份清单从 `source/campus` 的 `hosts.js` 拆出来，但**收窄了**
 *
 * campus 那份是「学在浙大 + 拼题A」两个平台的并集（还含 WebVPN 网关）。
 * 本包只服务学在浙大，所以这里只留**本包真的会碰**的三台主机。
 *
 * 收窄不是洁癖，`Transport` 的主机白名单直接决定 cookie 会不会被发出去 /
 * 存下来（见 `XUEZAI_HOSTS` 的注释）—— 白名单里多一台主机，就多一份把
 * 学在浙大的会话 cookie 发到无关站点的暴露面。拼题A 的会话属于
 * `@lybx-leyw/dsh-zju-source-pta`，不该由本包代为携带。
 */

/** 学在浙大。 */
export const XZZD_HOST = 'courses.zju.edu.cn';
export const XZZD_BASE = `https://${XZZD_HOST}`;

/** CAS 统一身份认证（登录链路会走到这里）。 */
export const CAS_HOST = 'zjuam.zju.edu.cn';
export const CAS_BASE = `https://${CAS_HOST}/cas`;

/** 统一身份认证的另一个域（`identity.zju.edu.cn`，跳转链上会经过）。 */
export const IDENTITY_HOST = 'identity.zju.edu.cn';

/**
 * 本包会碰的**全部**主机。
 *
 * ⚠️ 这份清单直接决定「cookie 会不会被发出去 / 存下来」—— `Transport` 只对
 *    命中它的请求读写 cookie。少一个主机，那条链路上的会话就永远是空的，
 *    而且**不会报错**，只是表现为「登录成功但立刻又未登录」。
 *
 *    这是学在浙大「连不上」的历史根因：`Transport` 的默认白名单是从
 *    `source/classroom` 复制的，只含智云课堂的域名，里面**没有**
 *    `courses.zju.edu.cn`。漏传的后果是请求一个 cookie 都不带、
 *    回来的 `Set-Cookie` 也一个都不存 —— 登录流程「成功」而会话永远是空的。
 *
 *    所以构造 `Transport` 时必须显式传入本集合（见 `src/index.js` 的
 *    `xuezaiTransport()`）。
 */
export const XUEZAI_HOSTS = new Set([
  CAS_HOST,
  IDENTITY_HOST,
  XZZD_HOST,
]);

/**
 * # 为什么不带 WebVPN 网关
 *
 * `courses.zju.edu.cn` 在 `@lybx-leyw/dsh-zju-source-webvpn` 的主机归属表里
 * 判为 **`public`**（该表由校外干净主机实测生成：跟跳转走到底、200 即公网可达）。
 * 也就是说校外**能直连**，绕网关只会多一跳、多一次网关登录。
 *
 * 所以本包的 `dsh.capability.network` 是 `public` 而不是 `campus`，也不自带
 * WebVPN 会话。若哪天这张表把学在浙大改判成 `campus`，出口层（`zhiyunEgress`，
 * 由 `@lybx-leyw/dsh-zju-source-http` 提供）会自己升级到网关 —— 那是那层的职责，
 * 本包不需要为此改代码。真正需要它时抛的是 `WEBVPN_REQUIRED`，
 * `translateXzzdError()` 会把 message 原样交给用户（里面已经写了去配上网账号）。
 */
