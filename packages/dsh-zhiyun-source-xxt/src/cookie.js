/**
 * 学习通 Cookie：**提取**与**注入**。
 *
 * # 为什么先复用 `dsh-zhiyun-source-campus` 的 `parsePtaCookie`
 *
 * 用户粘贴的形态是随机的：DevTools 里复制的 cURL、`Cookie:` 请求头、Cookies 表格、
 * 或者干脆是 `a=1; b=2`。这四种形态的识别规则**已经有一份实现**（拼题A 那条链路
 * 每天在用，踩过的坑都写在它的注释里：表头 `Name`/`Value`、属性行 `Path /`、
 * `HttpOnly ✓` 都必须排除，否则会存进"名为 Path 的假 Cookie"，鉴权看起来过了
 * 但接口回空）。
 *
 * 学习通要的正好是同一套规则，没有任何一条是拼题A 特有的 —— 所以**照搬调用**，
 * 不在这里再写一个解析器。多写一份的代价不是几十行代码，而是两份规则日后分叉：
 * 某天有人修好了其中一份的属性行判定，另一份仍会把 `SameSite` 当 Cookie 发出去。
 *
 * # 为什么还留了一层薄包装
 *
 * 1. 学习通有**必需键**（`UID` / `_uid` / `fid`）。缺了不报错，只表现成"导入了但
 *    什么都读不到"；这里把缺哪个键算出来给用户看。
 * 2. 注入的域是学习通专用的：所有 `name=value` 都要种到 `.chaoxing.com`。
 *    这一步不能交给通用解析器，它对平台一无所知。
 *
 * # 已知取舍
 *
 * 从 DevTools 整表复制时，用户可能连带复制了**别的站点的行**（域列被丢弃后无法
 * 分辨）。上游 omni 也是这个口径，本包不额外猜：README 明确要求"复制 chaoxing.com
 * 请求的 Cookie"。多猜一步等于自己发明一套域判定，反而会把学习通自己的 Cookie
 * 误删掉。
 */

import { parsePtaCookie } from 'dsh-zhiyun-source-campus';

import { XXT_BASE, XXT_HOST } from './hosts.js';

/**
 * 学习通鉴权必需的 Cookie 名。
 *
 * `UID` 是用户 id、`_uid` 是会话绑定的 uid、`fid` 是学校/机构 id。三者缺一个，
 * 请求能通但列表恒为空 —— 这种"成功但没数据"最难归因，所以单独查一遍。
 */
export const XXT_REQUIRED = Object.freeze(['UID', '_uid', 'fid']);

/**
 * 从用户粘贴的原文里提取学习通 Cookie。
 *
 * @param {string} input - cURL / 请求头 / DevTools 表格 / 裸 Cookie 串。
 * @returns {{ cookie: string, source: string, names: string[] } | null} 识别不出来为 null。
 */
export function parseXxtCookie(input) {
  const parsed = parsePtaCookie(input);
  if (!parsed) return null;
  if (!parsed.cookie) return null;
  return parsed;
}

/**
 * 算出缺了哪些必需键。
 *
 * @param {string[]} names - 已识别到的 Cookie 名。
 * @returns {string[]} 缺失项；空数组表示齐全。
 */
export function missingRequired(names) {
  const seen = new Set(Array.isArray(names) ? names : []);
  return XXT_REQUIRED.filter((name) => !seen.has(name));
}

/**
 * 把一串 `name=value` 种进会话罐，域固定为 `.chaoxing.com`。
 *
 * 逐个 `setCookie` 并各自 try/catch：用户粘的是一整段，其中某个值带了非法字符
 * （比如引号没去掉）不该让整次导入失败。返回实际种进去的条数，好让调用方发现
 * "一个都没成功"这种明显错配。
 *
 * @param {import('tough-cookie').CookieJar} jar - 会话罐（来自 `SessionStore`）。
 * @param {string} cookie - `a=1; b=2` 形态。
 * @param {string} [url] - 判定用的来源 URL，必须是 https。
 * @returns {Promise<number>} 成功种入的条数。
 */
export async function seedCookies(jar, cookie, url = XXT_BASE) {
  let stored = 0;
  for (const pair of String(cookie ?? '').split(';')) {
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (!name || !value) continue;
    // 名字必须是 RFC 6265 的 token 形状。不校验的后果很具体：`bad name=x`
    // 会被罐子当成一条合法 Cookie 存下来（它只挑了几个字符去报错），
    // 于是 `importCookie` 数出来的条数比真实可用条数多。
    if (!/^[\w-]+$/.test(name)) continue;
    try {
      // Secure：学习通的接口全在 https 上，标上它可以让 Cookie 永远不落到明文 HTTP。
      await jar.setCookie(`${name}=${value}; Domain=.${XXT_HOST}; Path=/; Secure`, url);
      stored += 1;
    } catch {
      // 单个 Cookie 不合规不拖垮整次导入
    }
  }
  return stored;
}

/**
 * 读出会话罐里**已经存着**的 Cookie 名。
 *
 * 只回名字不回值：状态查询要回答"配了没、缺什么"，不该顺手把凭据打印出去
 * （错误信息会进日志，也会被用户贴进对话）。
 *
 * @param {import('tough-cookie').CookieJar} jar - 会话罐。
 * @param {string} [url] - 取哪个地址适用的 Cookie。
 * @returns {Promise<string[]>} Cookie 名，保持罐里的顺序。
 */
export async function storedCookieNames(jar, url = XXT_BASE) {
  try {
    return (await jar.getCookies(url)).map((item) => item.key);
  } catch {
    return [];
  }
}
