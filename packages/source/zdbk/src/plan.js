/**
 * 培养方案（`pyfagl`）的**纯解析层**：不碰网络、不碰 cordis。
 *
 * # 与 `parse.js` 的分界
 *
 * `parse.js` 是「学生个人数据」四个接口（成绩 / 考试 / 课表 / GPA）；
 * 培养方案是**培养计划**这一类公共数据，字段与口径都不一样，
 * 而且它的列表走 jqGrid、详情在 PDF 里 —— 单开一层更清楚。
 *
 * # 上游对应物
 *
 * 对应 `vendor/zju-assistant/core/zju/lib/zdbk/pyfagl.ts` 的 `toPlan` / `pdfUrl`。
 * 两处**刻意不同**，理由写在各自函数上：
 *
 *   1. 上游的 `viewPlan` 会**下载 PDF 到本地**并返回文件路径。本包只给链接 ——
 *      `Transport` 走的是文本通道，为一条链接加二进制通道不划算（见 README 已知限制）；
 *   2. 上游 `toPlan` 只按 `<br>` 与**双空格**切核心课；这里额外处理全角空格，
 *      因为中文页面上「　」比两个半角空格更常见，而漏切只会让一长串课名挤在一起。
 */

import { ClassroomError } from '@lybx-leyw/dsh-zju-source-http';

const text = (value) => (value == null ? '' : String(value)).trim();

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ldquo: '“', rdquo: '”' };

/**
 * 解 HTML 实体（培养方案里的课程名常带 `&amp;` 之类）。
 *
 * @param {string} value - 含实体的文本。
 * @returns {string} 解好的文本。
 */
function decode(value) {
  return String(value ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (match, name) => ENTITIES[String(name).toLowerCase()] ?? match);
}

/**
 * 把培养方案里的多值字段切成数组。
 *
 * 实测同一份响应里三种分隔写法都有：
 *   - `课A<br>课B`（HTML 换行）；
 *   - `课A  课B`（两个及以上半角空格）；
 *   - `课A　课B`（全角空格）。
 *
 * 只认第一种的后果是「核心课」变成一个长字符串，而它被下游当成列表用时
 * 只会渲染成一段文字 —— 看起来像页面排版问题，其实是解析没切开。
 *
 * @param {unknown} value - 原值。
 * @returns {string[]} 课程名数组（已去空、解实体）。
 */
export function splitCourses(value) {
  return decode(String(value ?? ''))
    .split(/<br\s*\/?>|\s{2,}|\u3000+/i)
    .map((item) => item.replace(/<[^>]*>/g, '').trim())
    .filter(Boolean);
}

/**
 * 解析一条培养方案记录（jqGrid 的一行）。
 *
 * # 缺教学计划号是**错误**，不是「这条不显示」
 *
 * 教学计划号（`jxjhh`）是这份方案唯一的定位符：它查不了、PDF 也开不了。
 * 上游用 `String(r.jxjhh ?? r.pyfaxx_id ?? "")` 兜成空串，于是会产出一条
 * `id: ''` 的方案 —— 界面上看起来正常，点「查看」却打不开任何东西。
 *
 * 所以这里抛 `SCHEMA_CHANGED`，交给 `ZdbkReader.rows()` 逐条计入 `skipped`；
 * **如果全部行都没有号**，`rows()` 会把整个调用判成 `SCHEMA_CHANGED` ——
 * 那才是真的接口字段变了。
 *
 * @param {Record<string, unknown>} row - 原始记录。
 * @returns {object} 方案视图。
 * @throws {ClassroomError} `SCHEMA_CHANGED` —— 缺教学计划号。
 */
export function parsePlan(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new ClassroomError('SCHEMA_CHANGED', '培养方案列表返回的条目不是对象。');
  }
  const id = text(row.jxjhh) || text(row.pyfaxx_id);
  if (!id) {
    throw new ClassroomError('SCHEMA_CHANGED', '培养方案条目缺少教学计划号 jxjhh，无法定位。');
  }
  return {
    id,
    major: text(row.zymc),
    college: text(row.xymc),
    year: text(row.synj),
    credits: text(row.zdbyxf),
    degree: text(row.syxw),
    duration: text(row.xz),
    campus: text(row.xqmc),
    category: text(row.dlbsmc),
    core_courses: splitCourses(row.zyhxkc),
    frontier_courses: splitCourses(row.qywkc),
  };
}

/**
 * jqGrid 的 `showCount` 上限（一次取回某年级全部方案）。
 *
 * 一个年级约 150 个方案；正方默认 `showCount=10`，不显式拉大就会**静默截断**，
 * 表现是「这个学院只有 10 个专业」。
 */
export const PLAN_PAGE_SIZE = 500;
