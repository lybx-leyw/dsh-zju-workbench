/**
 * 学在浙大登录链用到的两个纯函数：RSA 加密与 `execution` 抽取。
 *
 * # 为什么从 `cas/auth.js` 里切出来
 *
 * 原文（`source/campus/src/cas/auth.js`）是**智云课堂**的登录实现：它要处理
 * `tgmedia` / `yjapi` 两个入口、`_token` cookie 里的 JWT、CAS 回调后的
 * `finishAtClassroom()` —— 这些和学在浙大一点关系都没有。学在浙大的
 * `cas/login.js` 只用了其中两个函数，所以这里只搬这两个，
 * **逻辑一字未改**。
 *
 * # ⚠️ 这里的 `rsaEncrypt` 与 `@lybx-leyw/dsh-zju-source-login` 的
 *    `encryptCasPassword` **不是同一个算法**，别调换
 *
 * | 维度 | 本文件 | login 包的 `encryptCasPassword` |
 * | --- | --- | --- |
 * | 输入编码 | UTF-8 → hex → BigInt（整串） | UTF-16 单元 → 整串反转 → 小端分块 |
 * | 输出 | 单块 hex，`padStart(128,'0')` | 多块 hex，空格拼接，每块补齐到 4 的倍数 |
 * | 来源 | 本仓 Flutter 版 `zjuam_client.dart` 的口径 | 学在浙大之外的站点（教务等） |
 *
 * 学校前端对**不同站点**用的是不同的打包方式。把其中一份当成"更标准"的那份
 * 换掉，服务端解出来就是一串乱码，现象是密码被拒 —— 而用户会去改一个本来
 * 正确的密码。所以这里**照抄原实现**，不做"统一"。
 */

/**
 * 按浙大 `login.js` 的口径做 RSA 加密。
 *
 * 明文按 UTF-8 转 hex、整体当成一个大整数、模下求幂，结果按 128 位 hex 补齐。
 *
 * @param plaintext - 明文密码。
 * @param modulusHex - 公钥 modulus（hex 串）。
 * @param exponentHex - 公钥 exponent（hex 串）。
 * @returns 加密结果（hex 串）。
 * @throws {TypeError} 公钥格式异常、或参数不是正整数。
 */
export function rsaEncrypt(plaintext, modulusHex, exponentHex) {
  if (!/^[\da-f]+$/i.test(modulusHex) || !/^[\da-f]+$/i.test(exponentHex)) throw new TypeError('RSA 公钥格式异常');
  const modulus = BigInt(`0x${modulusHex}`), exponent = BigInt(`0x${exponentHex}`);
  if (modulus <= 0n || exponent <= 0n) throw new TypeError('RSA 参数须为正整数');
  const hex = Buffer.from(plaintext, 'utf8').toString('hex');
  let base = (hex ? BigInt(`0x${hex}`) : 0n) % modulus, power = exponent, result = 1n;
  while (power > 0n) { if (power & 1n) result = result * base % modulus; power >>= 1n; base = base * base % modulus; }
  return result.toString(16).padStart(128, '0');
}

/**
 * 把一个 HTML 标签上的属性解析成对象。
 *
 * 单引号与双引号都要认：浙大 CAS 的页面在不同版本里混用，只认双引号会漏掉
 * `execution`，表现是「登录页缺少 execution 字段」。
 *
 * @param tag - 形如 `<input name="execution" value="e1">` 的标签原文。
 * @returns 小写属性名 → 值。
 */
function attributes(tag) {
  return Object.fromEntries([...tag.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(m => [m[1].toLowerCase(), m[2] ?? m[3]]));
}

/**
 * 从登录页里抠出 `execution` token。
 *
 * 返回 `null` 表示「这一页不是要填的登录表单」—— 调用方据此区分
 * 「需要登录」与「已经登录 / 页面被劫持成门户页」。
 *
 * @param html - 页面 HTML。
 * @returns token 字符串，或 null。
 */
export function executionToken(html) {
  for (const tag of String(html ?? '').match(/<input\b[^>]*>/gi) ?? []) {
    const a = attributes(tag);
    if (a.name === 'execution') return a.value;
  }
  return null;
}
