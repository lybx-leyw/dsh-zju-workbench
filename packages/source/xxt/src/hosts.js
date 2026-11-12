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
 * 学习任务引擎。
 *
 * 老师常把作业打包进课程「任务」栏里按周发的学习任务，这种作业**不在**作业栏里，
 * 手机端的作业列表也不全（见 `homework.ts` 顶部）。所以它是一条独立的域名，
 * 不能塞进 `mooc1` / `mooc2-ans` 那一串。
 */
export const XXT_TASK_ORIGIN = 'https://task.chaoxing.com';

/** 移动端接口集合。作业的「全局列表」在这里（`/work/stu-work` 在 mooc1-api 上）。 */
export const XXT_MOBILELEARN_ORIGIN = 'https://mobilelearn.chaoxing.com';

/** 作业的全局列表（服务端渲染 HTML，所有课混在一页）。 */
export const XXT_STU_WORK = 'https://mooc1-api.chaoxing.com/work/stu-work';

/**
 * 超星的文件 CDN。
 *
 * 下载地址（`cldisk` / `ananas`）与接口**不是同一套主机**：接口在 `chaoxing.com`
 * 上，文件在 `cldisk.com` 上。所以「能不能拨这个地址」和「能不能带 Cookie 去」
 * 是两个不同的判定，见 {@link isXxtFileHost}。
 */
export const XXT_CDN_HOST = 'cldisk.com';

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
  /**
   * 课程页（HTML）—— 章节目录从这里取。
   *
   * \mooc2-ans\ 是超星 2.0 的课程页；旧版 \mooc-ans\ 用另一套路径。
   * 本仓只支持 2.0（上游同口径）。
   */
  chapterList: 'https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/studentcourse',

  /**
   * 章节卡片内容（HTML 片段）—— 附件清单从这里取。
   *
   * \
um\ 从 0 递增，取到没有卡片为止（见 \
eads.js\ 的 MAX_CARDS）。
   */
  chapterCards: 'https://mooc1.chaoxing.com/mooc-ans/knowledge/cards',

  /**
   * 我的课表（JSON）。
   */
  schedule: 'https://kb.chaoxing.com/pc/curriculum/getMyLessons',

  /**
   * 资料栏列表（HTML 片段，每个文件夹一层）。
   *
   * 与章节卡片是**两条独立的通路**：老师把课件放「资料」里时，章节卡片
   * 里一张附件都没有 —— 只读章节就会得到「这门课没有课件」的错误结论。
   */
  dataList: 'https://mooc2-ans.chaoxing.com/mooc2-ans/coursedata/stu-datalist',

  /**
   * 资料栏文件的下载入口：302 到带签名的文件地址。
   *
   * 它**不直接回文件**，所以只能取 `Location`，不能当普通下载地址用。
   */
  dataDownload: 'https://mooc1.chaoxing.com/coursedata/downloadData',

  /**
   * 章节附件的对象状态（JSON）。
   *
   * `download` 是原文件、`http|httphd|httpmd` 是视频的播放版、`pdf` 是文档的
   * 预览用 PDF。三者不是同一份文件，体积差一个数量级，所以要分别取。
   */
  objectStatus: 'https://mooc1.chaoxing.com/ananas/status',

  /** 学习任务列表（JSON）：一门课有哪些学习任务、各自进度。 */
  taskList: 'https://mobilelearn.chaoxing.com/v2/apis/active/getData',

  /**
   * 学习任务的跳转中间页（HTML）。
   *
   * 明细要一个**加密的任务编号**，它只出现在这一页的脚本里
   * （`const eTaskUserId = "…"`）；任务列表给的 `id` 不能直接用。
   */
  taskMiddlePage: 'https://task.chaoxing.com/api/v1/middlePageApi/jumpStudyPlanList',

  /** 学习任务明细（JSON）：里面每一项的 `planType` 区分作业与其他内容。 */
  taskStandard: 'https://task.chaoxing.com/userStudyPlan/getUserStandard',

  /** 作业的全局列表（HTML，所有课混在一页）。 */
  stuWork: 'https://mooc1-api.chaoxing.com/work/stu-work',
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

/**
 * 判断一个主机名是不是超星的文件 CDN。
 *
 * # 为什么要和接口域分开判
 *
 * 接口域上的请求要带 Cookie（那是身份），文件 CDN 上的请求**不需要也不该**
 * 带 Cookie —— 地址本身带签名，而 Cookie 是给第三方的。两者用同一个判定，
 * 结果要么是文件下载 403（少带了 Referer），要么是把会话 Cookie 发给了
 * 一个只负责存文件的主机。
 *
 * @param {string} hostname - 已是小写的 URL 主机名。
 * @returns {boolean}
 */
export function isXxtFileHost(hostname) {
  const host = String(hostname ?? '').toLowerCase();
  return isXxtHost(host) || host === XXT_CDN_HOST || host.endsWith(`.${XXT_CDN_HOST}`);
}

/**
 * 下载地址的协议升级。
 *
 * # 为什么必须升
 *
 * 平台**经常**在 JSON 里给 `http://` 的 `download` 地址（真机响应就是这样），
 * 而本包的请求白名单只放 https。不升级的后果是「清单列得出来、文件下不下来」，
 * 且错误落在 `INVALID_PATH` 上 —— 看起来像参数写错，实际是平台给的地址形态。
 *
 * 只对超星自己的主机升级：别的域（第三方图床之类）不在本包的职责里，
 * 擅自改协议会让原本能用的链接变成不能用的。
 *
 * @param {string} url - 平台给的地址。
 * @returns {string} 升级后的地址（不属于本平台主机时原样返回）。
 */
export function secureXxtUrl(url) {
  const text = String(url ?? '');
  if (!/^http:\/\//i.test(text)) return text;
  try {
    return isXxtFileHost(new URL(text).hostname) ? text.replace(/^http:\/\//i, 'https://') : text;
  } catch {
    return text;
  }
}
