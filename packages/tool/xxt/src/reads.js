/**
 * 学习通（超星 / chaoxing）**读**工具定义。
 *
 * # 这一包补的是哪七条
 *
 * 审计清单 B-1 列的七条上游能力，在这里都有对应的 action：
 *
 * | provides | action | 关键点 |
 * | --- | --- | --- |
 * | `chaoxing course list` | `courseList` | 课程页链接也认，重名课分得开 |
 * | `chaoxing chapter list` | `chapterList` | 一次给出整门课每节有什么文件 |
 * | `chaoxing material list` | `materialList` | **含「资料」栏**，两条通路按 `objectId` 合并 |
 * | `chaoxing material download` | `materialDownload` | 真落盘（不是只给参数） |
 * | `chaoxing video list` | `videoList` | 按 16 种视频扩展名判类型 |
 * | `chaoxing video download` | `videoDownload` | 可选原文件 / 播放版 |
 * | `chaoxing homework list` | `homeworkList` | **三个来源**合并（课程作业栏 / 学习任务 / 手机端） |
 *
 * # 为什么只有一个工具、七个 action
 *
 * 上游把 162 条命令压进一个 `zju` 工具（省上下文），本仓别处是一个动作一个字段
 * 齐全的工具。这里取中间：**一个域一个工具 + action 枚举**，与
 * `campus_cc98_read` / `campus_zdbk_read` 同形。七个 action 共享同一批参数
 * （课程、章节、文件名），拆成七个工具会让「课程」这个字段出现七次 ——
 * 而模型的上下文里，重复的字段名比多一个 enum 值更贵。
 *
 * # 为什么读操作一律不过审批
 *
 * 审批只给会改变**平台**状态的动作。这一包的七个 action 全是查询与「把文件
 * 读到本机」—— 学习通上的任何状态都没变。给「看作业清单」配一个批准对话框，
 * 会让用户养成一路点同意的习惯；等真的到了需要用户决定的地方（交作业、
 * 开始考试），那次点击就不再有意义。
 *
 * **下载**尤其要说明：它不是写操作。判据是「有没有改别人的状态」，
 * 而下载只读平台、写本机。真正的边界在**目录**上 —— 落盘根目录由数据源装配时
 * 决定，本工具不接受路径参数（见下）。
 *
 * # 为什么参数里没有 `outDir`
 *
 * 让模型传路径等于让它往任意位置写文件。目录由 `source/xxt` 装配时定
 * （`downloadDir`），工具层只翻译「下哪些」。这与 `source/cc98` 的
 * `downloadDir`、`campus_classroom_read` 的下载口径一致。
 */

import {
  createReadToolRegistrar,
  defined,
  inputError,
  optBool,
  optStr,
  serviceLookup,
  str,
} from '@lybx-leyw/dsh-zju-tool-kit';

const SERVICE_SOURCES = Object.freeze({
  zhiyunXxt: '@lybx-leyw/dsh-zju-source-xxt',
});

/**
 * action 表。顺序即描述里列举的顺序。
 *
 * 名词与上游 provides 一一对应（`course` / `chapter` / `material` / `video` / `homework`），
 * 后缀区分「清单」与「下载」。
 */
const ACTIONS = [
  'courseList',
  'chapterList',
  'materialList',
  'materialDownload',
  'videoList',
  'videoDownload',
  'homeworkList',
];

/**
 * 读工具的定义。**纯数据 + 纯函数**，不碰 Cordis、不碰审批。
 *
 * @param services - 已解析的 source 服务（缺的那个动作如实报错）。
 * @returns 工具定义数组。
 */
export function createXxtReadTools(services) {
  const need = () => serviceLookup(services, 'zhiyunXxt', SERVICE_SOURCES.zhiyunXxt);

  return [
    {
      name: 'campus_xxt_read',
      description:
        '查学习通（超星）的只读内容：我的课程、某门课的章节目录、课件清单、视频清单、课程作业清单，'
        + '以及把课件 / 视频下载到本机。课程可以写课程名（可用简称）、课程 id，或直接贴课程页面的链接。'
        + '课件清单同时包含章节附件和「资料」栏里的文件 —— 老师常把课件只放资料栏。'
        + '作业清单合并三个来源（课程作业栏、课程「任务」栏里的学习任务、手机端全局列表），'
        + '所以打包进学习任务的作业也看得到。下载只读平台、写本机，不改变学习通上的任何状态；'
        + '保存目录由数据源配置决定。交作业、开始考试、签到属于你自己的决定，本工具不做。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ACTIONS, description: '要查什么 / 要下什么' },
          course: {
            type: 'string',
            description: '课程：课程名（可用简称）、课程 id，或课程页面的链接。'
              + 'chapterList / materialList / materialDownload / videoList / videoDownload 需要；'
              + 'homeworkList 不给就是全部课程。可先用 courseList 查到名字。',
          },
          chapter: {
            type: 'string',
            description: '只要这一章或这一节：写章节标题里的一段（如「等厚干涉」「5.2」），'
              + '或清单里 locationText 原样（如「第一章 / 5.2 等厚干涉」）；'
              + '资料栏的文件夹也写在这里（如「资料 / 课件」）。不给就是整门课。',
          },
          name: {
            type: 'string',
            description: '要下载的文件名：全名、不带扩展名的名字，或名字里的一段；多个用竖线或顿号分隔。'
              + '可从 materialList / videoList 的返回里取。',
          },
          all: {
            type: 'boolean',
            description: '下载这门课这一组的全部。与 name / chapter 三选一，必须明说。',
          },
          playback: {
            type: 'boolean',
            description: 'videoDownload：true 取平台的播放版（720p 左右，体积约为原文件的十分之一，'
              + '要快、要小或要发给别人时用）；默认取老师上传的原文件。'
              + '平台没有对应版本时会退回另一种，并在 note 里说明。',
          },
          fresh: {
            type: 'boolean',
            description: '不用缓存，整门课重新读一遍。用户说老师刚传了新文件、或刚发了作业时用。',
          },
          unreadOnly: {
            type: 'boolean',
            description: 'homeworkList：只看还没交的。',
          },
        },
        required: ['action'],
        additionalProperties: false,
      },
      async run(args) {
        const action = str(args.action, 'action');
        if (!ACTIONS.includes(action)) {
          throw inputError(`不认识的 action：${action}。可选 ${ACTIONS.join(' / ')}`);
        }
        // 先认 action 再取服务：action 写错时不该先收到「包没装」。
        const xxt = need();

        const fresh = optBool(args.fresh, 'fresh');
        const chapter = optStr(args.chapter, '章节');
        const course = optStr(args.course, '课程');

        switch (action) {
          case 'courseList':
            return xxt.invoke('xxt.listCourses', defined({ fresh }));

          case 'chapterList': {
            const listed = await xxt.invoke('xxt.chapterList', defined({ course: str(course, '课程'), fresh }));
            return listed;
          }

          case 'materialList':
            return xxt.invoke('xxt.materials', defined({ course: str(course, '课程'), chapter, fresh }));

          case 'videoList':
            return xxt.invoke('xxt.videos', defined({ course: str(course, '课程'), chapter, fresh }));

          case 'materialDownload':
          case 'videoDownload': {
            const wantAll = optBool(args.all, 'all') === true;
            const name = optStr(args.name, '文件名');
            const group = action === 'videoDownload' ? 'video' : 'material';
            // 范围没说清时不发请求：一次「下载整门课」的意外动作代价是几百 MB
            // 流量与磁盘，不该靠默认值发生。所以这里先判，错误信息直说三种写法。
            if (wantAll ? Boolean(name) || chapter !== undefined : !name && chapter === undefined) {
              throw inputError(
                `下载需要 name（文件名）、chapter（章节），或 all（这门课的全部${group === 'video' ? '视频' : '课件'}）之一。`,
              );
            }
            return xxt.invoke('xxt.downloadFiles', defined({
              course: str(course, '课程'),
              group,
              chapter,
              name: wantAll ? undefined : name,
              all: wantAll ? true : undefined,
              playback: group === 'video' ? optBool(args.playback, 'playback') : undefined,
            }));
          }

          case 'homeworkList':
            // 「只看未交」交给 source：同一个结果里「交过的还有几条」是用户判断
            // 「我漏了没」的依据，在工具层滤掉就再也拿不回来了。
            return xxt.invoke('xxt.listHomework', defined({
              course,
              fresh,
              pending_only: optBool(args.unreadOnly, 'unreadOnly'),
            }));

          default:
            // 上面已前置校验过 action，走到这里说明分派漏了一个 —— 那是本文件的 bug。
            throw new Error(`campus_xxt_read 的 action 分派漏了 ${action}`);
        }
      },
    },
  ];
}

export function apply(ctx) {
  createReadToolRegistrar({
    ctx,
    build: createXxtReadTools,
    serviceSources: SERVICE_SOURCES,
  }).register(createXxtReadTools);
}

