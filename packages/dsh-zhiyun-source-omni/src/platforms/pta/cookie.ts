export type CookieSource = "curl 命令" | "请求头" | "DevTools Cookies 表格" | "Cookie 字符串";

export type ExtractedCookie = { cookie: string; source: CookieSource; names: string[] };

const COOKIE_PAIR = /[\w\-]+=[^;\s]+/;

function normalizePairs(pairs: [string, string][]): string | undefined {
  const seen = new Map<string, string>();
  for (const [name, value] of pairs) {
    if (!/^[\w\-]+$/.test(name)) continue;
    if (!value) continue;
    seen.set(name, value);
  }
  return seen.size ? [...seen].map(([k, v]) => `${k}=${v}`).join("; ") : undefined;
}

function splitTableLine(line: string): string[] {
  return line.split("\t").length > 1 ? line.split("\t") : line.trim().split(/\s{2,}|,(?=\s)|\s{1,}(?=[^ ]+$)/);
}

/**
 * 接受用户从浏览器里随手复制的任何形态，避免要求他们精确地只挑出 Cookie 那一行。
 */
export function extractCookie(input: string): ExtractedCookie | undefined {
  const text = input.replace(/\r\n?/g, "\n").trim();
  if (!text) return undefined;

  const curl = text.match(/(?:--header|-H)\s+['"]?\s*cookie\s*:\s*([^'"\n]+)['"]?/i) ?? text.match(/(?:--cookie|-b)\s+['"]([^'"]+)['"]/i);
  if (curl?.[1]?.match(COOKIE_PAIR)) return finish(curl[1].replace(/^['"]|["';,]+$/g, ""), "curl 命令");

  const header = text.match(/^\s*(?:[-*]\s*)?cookie\s*:\s*(.+)$/im)?.[1];
  if (header?.match(COOKIE_PAIR)) return finish(header, "请求头");

  if (text.includes("\n")) {
    const rows: [string, string][] = [];
    for (const line of text.split("\n")) {
      const cells = splitTableLine(line).map((cell) => cell.trim().replace(/^["']|["']$/g, ""));
      if (cells.length < 2) continue;
      const skip = ["name", "名称", "cookie", "domain", "域"];
      if (skip.includes(cells[0].toLowerCase()) || /^(value|值)$/.test(cells[1])) continue;
      if (!/^[\w\-]{1,80}$/.test(cells[0])) continue;
      // 属性行（`Path /`、`HttpOnly ✓` …）与 Cookie 排成同样的两列，必须排除。
      // 不排除就会存进「名为 Path、值为 /」的假 Cookie —— 实测它让 `pta.problemSets`
      // 抛 NOT_FOUND：鉴权看起来过了，返回却是空。
      if (!isRealCookie(cells[0], cells[1])) continue;
      // DevTools 的表格列是 Name, Value, Domain…；只要前两列，后面的域/路径/过期时间对请求没用。
      if (!cells[1] || cells[1].length > 512) continue;
      rows.push([cells[0], cells[1]]);
    }
    const joined = normalizePairs(rows);
    if (joined) return finish(joined, "DevTools Cookies 表格");
  }

  const loose = [...text.matchAll(/([\w\-]+)\s*[=]\s*([^;\s"']+)/g)].map((m) => [m[1], m[2]] as [string, string]);
  if (loose.length >= 2 || text.match(COOKIE_PAIR)) {
    const joined = normalizePairs(loose);
    if (joined) return finish(joined, "Cookie 字符串");
  }
  return undefined;
}

function finish(cookie: string, source: CookieSource): ExtractedCookie | undefined {
  const joined = normalizePairs(
    cookie.split(";").map((part) => {
      const idx = part.indexOf("=");
      return idx < 0 ? ["", ""] : [part.slice(0, idx).trim(), part.slice(idx + 1).trim()];
    }) as [string, string][],
  );
  if (!joined) return undefined;
  return { cookie: joined, source, names: joined.split("; ").map((pair) => pair.split("=")[0]) };
}

/**
 * **Cookie 属性名**，不是 Cookie。
 *
 * `Set-Cookie` 与 DevTools 的表格把属性和 Cookie 排成同样的两列
 * （`Path /`、`Domain pintia.cn`、`HttpOnly ✓` …）。不排除它们的结果是
 * 「名为 Path、值为 /」的假 Cookie 被存进会话罐 —— 请求带着它去问接口，
 * 服务端把它当未知 Cookie 忽略，鉴权看起来过了，返回却是空或 404。
 * 实测后果：`pta.problemSets` 抛 NOT_FOUND，而 Cookie 明明"配置成功"。
 */
const COOKIE_ATTRIBUTES = new Set([
  "path", "domain", "expires", "max-age", "maxage", "secure", "httponly", "samesite",
  "partitioned", "priority", "size", "hostonly", "session", "created", "lastaccessed",
  "会话", "大小", "创建时间", "过期时间", "已过期", "来源",
]);

/**
 * 判断一对「名字 → 值」是不是真实的 Cookie。
 *
 * @param name - 候选名字。
 * @param value - 候选值。
 * @returns 是真实 Cookie 返回 true。
 */
export function isRealCookie(name: string, value: string): boolean {
  if (!name || !value) return false;
  if (COOKIE_ATTRIBUTES.has(name.toLowerCase())) return false;
  // 勾选列 / 占位符（DevTools 的 Secure、HttpOnly 列就是 ✓）
  if (/^\.\.\.$|^✓$|^✔$|^-$|^N\/A$/i.test(value)) return false;
  // 值以斜杠开头（路径）或含空格（描述文本）都不是 Cookie 值
  if (value.startsWith("/") || value.includes(" ")) return false;
  return true;
}
