/**
 * 讲义导出到笔记库：**领域服务**，只做「把当前讲义写成一份 md」。
 *
 * # 这个文件里唯一重要的一句话
 *
 * **落盘不出现在本包的任何一行里。** 所有文件操作都经一个注入的窄接口：
 *
 *   {
 *     tree(): Promise<Array<{path, type}>>      // 扁平条目表（用来算重名）
 *     read(name): Promise<{markdown}|null>      // 读 .md（name 不带扩展名）
 *     write(name, markdown): Promise<unknown>   // 写 .md（原子替换由对面负责）
 *   }
 *
 * 为什么不直接 `node:fs`：本仓的纪律是领域包不碰文件系统。原子写、Windows 上
 * rename 的瞬态重试、路径安全（`safePath` / `resolveIn` 的越界断言）都已在笔记库里
 * 解决过一遍，在这里再写一遍只会得到一份更脆的副本。
 *
 * # 为什么只需要这三条
 *
 * 旧设计还要 `readRaw` / `writeRaw`：它要把**基线 JSON** 存进归档目录，而笔记页的
 * `write` 会无条件补 `.md`。新架构没有基线、没有归档，导出的只有 `.md`，
 * 所以那两条任意扩展名的通路在这里不再需要 —— 少一条注入面，就少一处「接线时才发现」。
 *
 * # 导出与生成的关系
 *
 * **两者无关。** 生成讲义是主流程，导出是用户按一下才发生的附加动作。
 * 所以本服务不被生成流程调用，失败也不该影响任何生成结果。
 */

import { availableNotePath, currentNotePath, existingNoteKeys } from './version.js';
import { baselineToMarkdown } from './codec.js';

/** 讲义导出层的错误类型。`code` 是给界面分流的，不是给人看的。 */
export class HandoutError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'HandoutError';
    this.code = code;
    this.details = details;
  }
}

const fail = (code, message, details) => {
  throw new HandoutError(code, message, details);
};

/**
 * 校验注入的笔记服务。
 *
 * 缺方法就在构造时失败，而不是等用户点了「导出」才在里面炸 —— 那时错误会出现在
 * 一个「为什么导出没反应」的空白里，看起来像是讲义坏了，实际是接线不全。
 */
function assertNotes(notes) {
  const required = ['tree', 'read', 'write'];
  if (!notes || typeof notes !== 'object') {
    fail('CONFIG', '讲义导出需要一个笔记服务（zhiyunVaultNotes 的形状）', { got: typeof notes });
  }
  const missing = required.filter((name) => typeof notes[name] !== 'function');
  if (missing.length) {
    fail('CONFIG', `笔记服务缺少方法：${missing.join('、')}`, { missing });
  }
  return notes;
}

/**
 * 一节课的身份：课程名 + 节名。
 *
 * 讲义在知识库里是按 `账号:课程:节次` 存的，但笔记库是**用户的文件夹**，
 * 路径里不该出现账号与冒号 —— 那是机器标识，不是人给自己东西起的名字。
 * 所以这里只用标题。学期（`termName`）作为**第一层文件夹**参与路径，但它缺失时
 * 只是少一层，不编造一个「未分学期」的假目录（见 `currentNotePath`）。
 */
function sessionOf(input) {
  const courseTitle = String(input?.courseTitle ?? '').trim();
  const lessonTitle = String(input?.lessonTitle ?? '').trim();
  if (!courseTitle) fail('INPUT', '缺少课程名');
  if (!lessonTitle) fail('INPUT', '缺少节次名');
  const rawTerm = input?.termName;
  const termName = typeof rawTerm === 'string' && rawTerm.trim() !== '' ? rawTerm.trim() : null;
  return { courseTitle, lessonTitle, termName };
}

/**
 * 建立导出服务。
 *
 * @param {{notes: object, log?: Function, warn?: Function}} options
 */
export function createHandoutService({ notes, log, warn } = {}) {
  const store = assertNotes(notes);
  const say = (message) => (typeof log === 'function' ? log(message) : undefined);

  return {
    /**
     * 把一份讲义导出成笔记库里的 md。**每次调用都新写一份，从不覆盖。**
     *
     * 重名时按「（2）（3）…」加后缀，让用户在笔记库里自己决定留哪个。
     * 这是有意的：导出是附加动作，用户可能已经在上次导出的那份上手写了很久，
     * 再导一次就拿新内容盖掉它，等于把他的工作删了。
     *
     * @param {{courseTitle: string, lessonTitle: string, chapters: Array, title?: string}} input
     * @returns {{path: string, name: string, folder: string, deduped: boolean, chars: number}}
     */
    async exportLecture(input) {
      const { courseTitle, lessonTitle, termName } = sessionOf(input);
      const chapters = input?.chapters;
      if (!Array.isArray(chapters) || chapters.length === 0) {
        // 空讲义不落笔：写一个空文件进用户的笔记库，比什么都不写更糟 ——
        // 用户会以为「这一节的讲义就是这样」，而实际是生成没产出内容。
        fail('NO_CHAPTERS', '这份讲义没有章节，不导出到笔记库');
      }

      const markdown = baselineToMarkdown(chapters, input?.title ?? lessonTitle);
      const base = currentNotePath({ courseTitle, lessonTitle, termName });
      const taken = existingNoteKeys(await store.tree());
      const name = availableNotePath(base, taken);

      // 笔记页的 `write` 只收不带扩展名的键，`tree` 里的笔记条目也是这个形状，
      // 所以两边对得上 —— 不需要在这里补 `.md`。
      await store.write(name, markdown);

      const deduped = name !== base;
      const cut = name.lastIndexOf('/');
      const folder = cut === -1 ? '' : name.slice(0, cut);
      const bare = cut === -1 ? name : name.slice(cut + 1);
      say(`讲义已导出到笔记库：${name}${deduped ? '（重名，已加后缀）' : ''}`);

      return { path: name, name: bare, folder, deduped, chars: markdown.length };
    },

    /**
     * 导出**已有**的一份 markdown（不多走一次编码）。
     *
     * 给「学习页上已经把讲义编码好了」的场合用，避免调用方为了导出再持有一份 chapters。
     * 与 `exportLecture` 走同一套重名规避。
     *
     * @param {{courseTitle: string, lessonTitle: string, markdown: string}} input
     */
    async exportMarkdown(input) {
      const { courseTitle, lessonTitle, termName } = sessionOf(input);
      const markdown = input?.markdown;
      if (typeof markdown !== 'string' || markdown.trim() === '') {
        fail('NO_CONTENT', '没有可导出的讲义内容');
      }
      const base = currentNotePath({ courseTitle, lessonTitle, termName });
      const taken = existingNoteKeys(await store.tree());
      const name = availableNotePath(base, taken);
      await store.write(name, markdown);

      const deduped = name !== base;
      const cut = name.lastIndexOf('/');
      const folder = cut === -1 ? '' : name.slice(0, cut);
      const bare = cut === -1 ? name : name.slice(cut + 1);
      say(`讲义已导出到笔记库：${name}${deduped ? '（重名，已加后缀）' : ''}`);
      return { path: name, name: bare, folder, deduped, chars: markdown.length };
    },
  };
}
