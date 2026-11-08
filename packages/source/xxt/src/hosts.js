/**
 * 学习通（超星）的站点常量。
 *
 * 单独一个文件而不是塞进 `index.js`：`client.js` / `reads.js` 都要用这些地址，
 * 而 `index.js` 又要引用那两个模块 —— 放一起就成循环导入。常量最没有依赖。
 */

/** 学习通的根域。所有子域都以它结尾。 */
export const XXT_HOST = 'chaoxing.com';

/** 登录域。请求落到它上面就说明 Cookie 已经失效（见 `client.js` 的 `inspect`）。 */
export const XXT_PASSPORT_HOST = 'passport2.chaoxing.com';

/** 个人主页。课程列表要靠它先问出 `fid`（学校/机构的数字 id）。 */
export const XXT_ORIGIN = 'https://i.chaoxing.com';
export const XXT_BASE = `${XXT_ORIGIN}/base`;

/**
 * 默认 Referer。
 *
 * 学习通部分接口会校验来源页；上游一直用 mooc1 的首页，实测有效。
 * 只写一次，避免每个调用点各猜一个。
 */
export const XXT_REFERER = 'https://mooc1.chaoxing.com/';

/** 本包会打交道的端点。集中在这里，避免地址散落在解析逻辑里。 */
export const XXT_ENDPOINTS = Object.freeze({
  /** 个人主页（HTML）。从中取 `fid`。 */
  base: XXT_BASE,
  /** 课程列表数据（HTML 片段）。 */
  courseList: 'https://mooc2-ans.chaoxing.com/mooc2-ans/visit/courselistdata',
  /** 课程中间页（HTML）。从中取作业签名 `enc` / `openc`。 */
  stuMiddle: 'https://mooc1.chaoxing.com/visit/stucoursemiddle',
  /** 作业列表（HTML）。 */
  workList: 'https://mooc1.chaoxing.com/mooc2/work/list',
  /** 考试列表（HTML 表格）。 */
  examList: 'https://mooc1-api.chaoxing.com/exam-ans/exam/test/examcode/examlist',
  /** 通知列表（JSON）。 */
  noticeList: 'https://notice.chaoxing.com/pc/notice/getNoticeList',
  /** 我的课表（JSON）。 */
  schedule: 'https://kb.chaoxing.com/pc/curriculum/getMyLessons',
});

/**
 * 判断一个主机名是不是学习通的域。
 *
 * ⚠️ 直接 `endsWith('chaoxing.com')` 会把 `evilchaoxing.com` 也算进来 ——
 * 那是别人的域，拿它当自己人等于把 Cookie 送给第三方。必须带点边界。
 *
 * @param {string} hostname - 已是小写的 URL 主机名。
 * @returns {boolean}
 */
export function isXxtHost(hostname) {
  const host = String(hostname ?? '').toLowerCase();
  return host === XXT_HOST || host.endsWith(`.${XXT_HOST}`);
}

/**
 * `Transport` 的主机白名单。
 *
 * # 为什么不是 `new Set([...])`
 *
 * `Transport` 只在 `hosts.has(hostname)` 为真时才读写 Cookie，而它**只调用
 * `.has()`** —— 这里给的是一个同形状的对象，不是 `Set`。
 *
 * 理由是学习通把同一套接口分在 `i` / `mooc1` / `mooc1-1` / `mooc2-ans` / `mooc1-api`
 * 一串分片域上，作业详情链接还会指向 `mooc1-3.chaoxing.com` 这类**按负载分配**的
 * 主机名。写死几个域名，一旦页面换了分片，请求就**一个 Cookie 都不带**：
 * 服务端返回登录页，本包报「Cookie 已失效」—— 用户于是反复重新导入一份完全
 * 有效的 Cookie。按后缀判才是这条路线的正确形状。
 */
export const XXT_HOSTS = {
  has: (hostname) => isXxtHost(hostname),
};
