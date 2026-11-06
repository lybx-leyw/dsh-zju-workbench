/**
 * 教务系统（正方 zdbk）的站点常量与主机白名单。
 *
 * # 为什么单独一个文件
 *
 * `cas.js` 与 `client.js` 都要用这些地址，而 `index.js` 又要引用那两个模块 ——
 * 放进任何一方都会形成循环导入。常量最没有依赖，单独一层最省事。
 * （与 `dsh-zhiyun-source-campus/src/hosts.js` 同一套理由。）
 */

/** 教务系统主机。所有业务接口都在它的 `/jwglxt` 下。 */
export const ZDBK_HOST = 'zdbk.zju.edu.cn';

/** 业务根。正方把「模块路径」全挂在 `/jwglxt` 之后。 */
export const ZDBK_BASE = `https://${ZDBK_HOST}/jwglxt`;

/**
 * CAS 结束后要回到的地址。
 *
 * ⚠️ **教务必须带 `service`** —— 这是它与学在浙大（campus）最要紧的差别。
 *
 * 学在浙大那条链刻意**不**带 `service`：CAS 把 `iPlanetDirectoryPro` 种在
 * `zjuam` 域上，之后带着这个 cookie 访问业务页，站点的 CAS 过滤器自己认出身份、
 * 自己种站点 session（见 `dsh-zhiyun-source-campus/src/cas/login.js` 的文件头）。
 *
 * 教务这边不能照抄：它的 `/jwglxt` 不是一个「自己会跟 CAS 握手」的业务站，
 * 而是一个**等待 SSO 回调的接收端**。不带 `service` 的话 CAS 登完就停在首页，
 * 没有人把 ticket 送回 `login_ssologin.html`，于是 `/jwglxt` 下永远是未登录。
 * 表现是「登录成功但成绩一条都读不到」，而且不报错 —— 所以这段必须写下来。
 */
export const ZDBK_SERVICE = `${ZDBK_BASE}/xtgl/login_ssologin.html`;

/**
 * CAS 入口。`service` 必须**编码一次**再拼进去。
 *
 * 漏编码的后果不是「拼错了」这么轻：`service` 里的 `?` / `&` 会被 CAS 当成
 * 外层的查询参数分隔符，于是它收到的是一个被截断的 service，回跳到一个 404 页 ——
 * 而 CAS 那一跳本身是成功的，日志里看起来一切正常。
 */
export const ZDBK_CAS_ENTRY = `https://zjuam.zju.edu.cn/cas/login?service=${encodeURIComponent(ZDBK_SERVICE)}`;

/** CAS 主机（登录链路的必经之路）。 */
export const CAS_HOST = 'zjuam.zju.edu.cn';

/**
 * 本包会碰的**全部**主机。
 *
 * ⚠️ 这份清单直接决定「cookie 会不会被发出去 / 存下来」—— 共享层的 `Transport`
 *    只对命中 `hosts` 的请求读写 cookie。少一个主机，那条链路上的会话就永远是空的，
 *    而且**不会报错**，只表现为「登录成功但立刻又未登录」。
 *
 *    必须包含：
 *      - `zjuam.zju.edu.cn` —— CAS 票（`iPlanetDirectoryPro`）种在这里；
 *      - `identity.zju.edu.cn` —— 统一身份认证的部分跳转落在它上面；
 *      - `zdbk.zju.edu.cn` —— 业务 session（`JSESSIONID`）种在这里。
 *
 *    漏掉 `zjuam` 的表现最隐蔽：CAS 返回 200、cookie 也「拿到了」，
 *    但它根本没进 jar，于是紧接着的 SSO 回调不带票，回登录页。
 */
export const ZDBK_HOSTS = new Set([CAS_HOST, 'identity.zju.edu.cn', ZDBK_HOST]);

/**
 * 教务接口路径表（相对 `ZDBK_BASE`）。
 *
 * `majorGrades` 是「专业成绩」视图：同一个接口族，但只列出计入专业绩点的课程。
 * 它与 `grades` 的差别是**服务端过滤**，不是本地筛选 —— 所以两者要分别请求。
 */
export const ZDBK_PATHS = {
  grades: '/cxdy/xscjcx_cxXscjIndex.html',
  majorGrades: '/zycjtj/xszgkc_cxXsZgkcIndex.html',
  exams: '/xskscx/kscx_cxXsgrksIndex.html',
  timetable: '/kbcx/xskbcx_cxXsKb.html',
};
