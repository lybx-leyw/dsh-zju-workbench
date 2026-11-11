/**
 * 主机归属表：某个主机「只在校内可达」还是「公网可达」。
 *
 * # 为什么需要这张表
 *
 * 本包从前的判定只有一条：`*.zju.edu.cn` 在校外一律绕 WebVPN。那条规则是
 * **对域名规律的猜测**，而实测证明它两个方向都会错：
 *
 *   - 误判：`zdbk` / `courses` / `classroom` / `tyys` / `yjsy` 等站点从校外**能直连**，
 *     却被强制绕道网关 —— 多一跳、多一次网关登录、还要维护网关会话；
 *   - 漏判：`cc98.org` 不在 `zju.edu.cn` 下却只在校内可达；实验选课平台是私网 IP
 *     `10.203.16.55`，同样漏掉。两者在现行规则下都会直连，**校外必然失败**。
 *
 * 所以「哪些站点只在校内」不是可以推断的规律，而是**每个站点的事实**。
 *
 * # 数据出处（两份，互相补充）
 *
 * 1. **模块声明**（`network` 字段）来自上游各模块的 `module.json`：
 *    `zju-assistant` 的 `core/zju/lib/*​/module.json`。这是逐模块的权威声明。
 * 2. **逐站实测表**来自 `core/zju/lib/notice/hosts.json`：`generatedAt: 2026-10-09`、
 *    `via: "server"`，在一台校外干净主机上用 curl 实测生成。判法是
 *    「跟跳转走到底：停在统一身份认证登录页 → public+cas；200 → public；
 *    连不上/超时/403/5xx/落到 nopermit_zjusub.jsp → campus」。
 *
 * # 这是一份**快照**，不是真理
 *
 * 学院站会换域名、加 CDN、改目录结构。表过期时表现为「本来能直连的被绕道」
 * 或「本来要绕道的直连失败」—— 前者慢，后者错。重新生成用同目录的
 * `scripts/probe-hosts.mjs`（需要一台校外主机）。
 *
 * # 本文件是纯数据 + 纯函数
 *
 * 不 import 任何东西，不碰网络，不读环境变量。调用方（`egress.js`）自己决定怎么用。
 */

/** 这份表生成的时间。过期时应重新探测，不要凭印象改。 */
export const HOSTS_GENERATED_AT = '2026-10-09';

/** 生成方式：`server` 表示在外部干净主机上实测，`module` 表示取模块声明。 */
export const HOSTS_VIA = 'server';

/**
 * 逐站实测表（`campus` = 只在校内，校外需经网关）。
 *
 * 键是主机名，值是 `'campus'`。**只列 campus**：不在表里的主机按 `unknown` 处理，
 * 由调用方回退到后缀规则。这样表可以只维护「异常」，而不是维护全部站点。
 */
const CAMPUS_HOSTS = Object.freeze([
  // ── 逐站实测判为 campus 的学院与部门站（来自 hosts.json） ──
  'ai.office.zju.edu.cn',
  'bksy.zju.edu.cn',
  'bmsoa.zju.edu.cn',
  'che.cn.zju.edu.cn',
  'cspo.zju.edu.cn',
  'doe-oa.zju.edu.cn',
  'ee.office.zju.edu.cn',
  'literature.zju.edu.cn',
  'oca.zju.edu.cn',
  'office.cab.zju.edu.cn',
  'office.cas.zju.edu.cn',
  'office.chem.zju.edu.cn',
  'office.cmic.zju.edu.cn',
  'office.ls.zju.edu.cn',
  'office.polymer.zju.edu.cn',
  'saa.office.zju.edu.cn',
  'www.cls.office.zju.edu.cn',
  'ygb.zju.edu.cn',
  'zjutw.zju.edu.cn',

  // ── 模块声明为 campus（来自各 module.json） ──
  // 二三四课堂：只在校内。
  'sztz.zju.edu.cn',
  // CC98：不在 zju.edu.cn 下，但只在校网内可达。
  'cc98.org',
  // 知网：靠校内 IP 登录（IPLoginFlush），校外必须经网关。
  'cnki.net',
  // 学校订购的电子图书：两个平台都只在校内授权。
  'gk4pb6yy8y.search.serialssolutions.com',
  'sslibrary.com',
  // 实验选课平台：私网 IP，两个端口（86 静态页 / 8098 API）。
  // 上游 lab 模块注释明确写了「走 WebVPN 重写 http-8098」。
  '10.203.16.55',
]);

/**
 * 模块声明为 `network: public` 的主机 —— 实测公网可达，**永远直连**。
 *
 * 这份名单只用于两件事：① 让 `classifyHost` 对它们明确回答 `public`
 * （覆盖后缀规则）；② 让运行时降级知道「这些主机本来该直连」。
 *
 * 注意与 `PUBLIC_AUTH_HOSTS` 的区别：那个是「登录域，与校园网身份无关」，
 * 这个是「公网可达的业务站」。
 */
const PUBLIC_HOSTS = Object.freeze([
  // 网关自己与统一身份认证（tier 0）
  'webvpn.zju.edu.cn',
  'zjuam.zju.edu.cn',
  'identity.zju.edu.cn',

  // 教务与学工
  'zdbk.zju.edu.cn',
  'yjsy.zju.edu.cn',

  // 学在浙大 / 智云课堂（含四个 cmc 媒体域）
  'courses.zju.edu.cn',
  'classroom.zju.edu.cn',
  'yjapi.cmc.zju.edu.cn',
  'education.cmc.zju.edu.cn',
  'tgmedia.cmc.zju.edu.cn',

  // 体艺
  'tyys.zju.edu.cn',
  'www.tyys.zju.edu.cn',

  // 公网站（非浙大域，本来就不经网关；列出来是为了让判定可读）
  'chalaoshi.de',
  'api.chalaoshi.de',
  'chaoxing.com',
  'pintia.cn',
  'passport.pintia.cn',

  // 逐站实测判为 public 的学院与部门站（来自 hosts.json，49 个）
  'ai.zju.edu.cn',
  'bms.zju.edu.cn',
  'che.zju.edu.cn',
  'ee.zju.edu.cn',
  'gs.zju.edu.cn',
  'ic.zju.edu.cn',
  'icsr.zju.edu.cn',
  'itc.zju.edu.cn',
  'libweb.zju.edu.cn',
  'ls.zju.edu.cn',
  'marx.zju.edu.cn',
  'me.zju.edu.cn',
  'mse.zju.edu.cn',
  'oc.zju.edu.cn',
  'opt.zju.edu.cn',
  'physics.zju.edu.cn',
  'polymer.zju.edu.cn',
  'saa.zju.edu.cn',
  'www.cab.zju.edu.cn',
  'www.caefs.zju.edu.cn',
  'www.cas.zju.edu.cn',
  'www.cbeis.zju.edu.cn',
  'www.ccea.zju.edu.cn',
  'www.cec.zju.edu.cn',
  'www.ced.zju.edu.cn',
  'www.cers.zju.edu.cn',
  'www.chem.zju.edu.cn',
  'www.cls.zju.edu.cn',
  'www.cmic.zju.edu.cn',
  'www.cps.zju.edu.cn',
  'www.cs.zju.edu.cn',
  'www.cse.zju.edu.cn',
  'www.cst.zju.edu.cn',
  'www.doe.zju.edu.cn',
  'www.ghls.zju.edu.cn',
  'www.grs.zju.edu.cn',
  'www.isee.zju.edu.cn',
  'www.lit.zju.edu.cn',
  'www.math.zju.edu.cn',
  'www.neuroscience.zju.edu.cn',
  'www.philosophy.zju.edu.cn',
  'www.phs.zju.edu.cn',
  'www.psych.zju.edu.cn',
  'www.sis.zju.edu.cn',
  'www.soaa.zju.edu.cn',
  'www.som.zju.edu.cn',
  'www.spa.zju.edu.cn',
  'www.xgb.zju.edu.cn',
  'zhfw.zju.edu.cn',
]);

/**
 * 打开就需要过统一身份认证的主机（实测 `cas: true`）。
 *
 * 目前只用于诊断（`state()` 与探测脚本），不参与选路 ——
 * 选路由 `classifyHost` 的 network 维度单独决定。列出来是因为
 * 「public 但需要 CAS」与「public 且匿名可读」在排查时是两回事。
 */
const CAS_HOSTS = Object.freeze([
  'zdbk.zju.edu.cn',
  'yjsy.zju.edu.cn',
  'courses.zju.edu.cn',
  'classroom.zju.edu.cn',
  'yjapi.cmc.zju.edu.cn',
  'education.cmc.zju.edu.cn',
  'tgmedia.cmc.zju.edu.cn',
  'tyys.zju.edu.cn',
  'www.tyys.zju.edu.cn',
  'sztz.zju.edu.cn',
  'itc.zju.edu.cn',
]);

/** 归一化：小写、去掉末尾的点。主机名比较必须忽略大小写与尾点。 */
function normalize(hostname) {
  return String(hostname ?? '').toLowerCase().replace(/\.$/, '');
}

/**
 * 在名单里找最具体的匹配（精确优先，其次是点边界的后缀）。
 *
 * 为什么不用朴素 `endsWith`：那会让 `evilzju.edu.cn` 命中 `zju.edu.cn`，
 * 等于把任意域名当成校内站去发凭据。后缀匹配必须要求点边界。
 *
 * 为什么要「最具体」：名单里可能同时有 `zju.edu.cn` 与 `office.cas.zju.edu.cn`，
 * 更长的那个才是真正的归属声明。
 *
 * @param host - 已归一化的主机名。
 * @param list - frozen 名单数组。
 * @returns 命中的名单项，或 null。
 */
function longestMatch(host, list) {
  let best = null;
  for (const entry of list) {
    const hit = host === entry || host.endsWith(`.${entry}`);
    if (!hit) continue;
    if (best === null || entry.length > best.length) best = entry;
  }
  return best;
}

/**
 * 判定一个主机名的网络归属。
 *
 * 三个取值，语义与上游 `ModuleRequirements.network` 一致：
 *   - `'campus'`：只在校内可达，校外必须经 WebVPN；
 *   - `'public'`：公网可达，**永远直连**（用户选了「都走网关」也不改）；
 *   - `'unknown'`：表里没有，由调用方回退到后缀规则。
 *
 * 已裁决（D5）：未知主机回退后缀规则 —— `*.zju.edu.cn` 仍然绕网关，
 * 其余直连。保守，且与改动前的行为一致，不会因换表而突然改变既有判定。
 *
 * @param hostname - 主机名，可带端口（端口会被忽略）。
 * @returns `'public' | 'campus' | 'unknown'`。
 */
export function classifyHost(hostname) {
  const host = normalize(String(hostname ?? '').split(':')[0]);
  if (!host) return 'unknown';

  const asCampus = longestMatch(host, CAMPUS_HOSTS);
  const asPublic = longestMatch(host, PUBLIC_HOSTS);

  // 两边都命中时取更具体的那个（例如名单里同时有 zju.edu.cn 与某个具体站）。
  if (asCampus && asPublic) return asCampus.length >= asPublic.length ? 'campus' : 'public';
  if (asCampus) return 'campus';
  if (asPublic) return 'public';
  return 'unknown';
}

/**
 * 这个主机打开时是否要过统一身份认证。
 *
 * @param hostname - 主机名。
 * @returns 是否在 CAS 名单里。
 */
export function needsCas(hostname) {
  const host = normalize(String(hostname ?? '').split(':')[0]);
  return host ? longestMatch(host, CAS_HOSTS) !== null : false;
}

/** 表本身：给诊断面板与探测脚本读。返回冻结副本，调用方改不动内部状态。 */
export const HOSTS = Object.freeze({
  generatedAt: HOSTS_GENERATED_AT,
  via: HOSTS_VIA,
  campus: CAMPUS_HOSTS,
  public: PUBLIC_HOSTS,
  cas: CAS_HOSTS,
});
