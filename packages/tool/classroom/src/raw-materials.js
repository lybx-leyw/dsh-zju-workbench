/**
 * `raw_*` —— 读**原始素材**，与 `study_*`（整理过的 wiki 讲义）分开。
 *
 * # 为什么必须分开
 *
 * 这两类东西的回答方式不同，混在一个工具里模型分不清：
 *
 * | | wiki 讲义（`study_*`） | 原始素材（`raw_*`） |
 * | --- | --- | --- |
 * | 是什么 | 按知识点重新组织的经验笔记，有结构、有推导 | 课堂原话（字幕）、PPT 原图 |
 * | 能不能直接引用 | 能，但它已经是二次加工 | **能，这是最原始的证据** |
 * | 没有整理过的课 | 没有 | **有** —— 平台上的字幕与课件一直都在 |
 * | 读起来 | 快，几百字一个知识点 | 慢，一节课几千句 / 几十页图 |
 *
 * # 三个数据来源，两种形态
 *
 * | 来源 | 形态 | 需要装东西吗 |
 * | --- | --- | --- |
 * | 平台字幕（`getSubtitles`） | **文字**，带时间戳 | 不需要，平台已经转好了 |
 * | 本地转写（`transcribeAudio`） | 文字 | **需要** ASR 内核 + 模型，没装就如实报错 |
 * | PPT（`getSlides`） | **图片 URL**，没有文字 | 不需要，但读不了内容 |
 *
 * **PPT 是图不是字** 这一点必须让模型知道：它拿到的是一串图片地址，
 * 想从 PPT 里找文字得自己看图（本仓没有 OCR）。工具描述里写明了。
 *
 * # 为什么不做 OCR
 *
 * 本仓不装 OCR 依赖。用户要 PPT 里的文字时，正确做法是：
 * 优先读字幕（老师讲的往往覆盖了 PPT）、或者让用户自己复制。
 * 假装能 OCR 会给出错误的「原文」。
 */

import { createReadToolRegistrar, inputError, optInt, optStr, serviceLookup } from '@lybx-leyw/dsh-zju-tool-kit';

const SERVICE_SOURCES = Object.freeze({
  zhiyunStudy: '@lybx-leyw/dsh-zju-core-study',
  zhiyunClassroom: '@lybx-leyw/dsh-zju-source-classroom',
});

/**
 * 造 `raw_*` 工具的定义。
 *
 * @param services - 已解析的 source 服务。
 * @returns 工具定义数组。
 */
export function createRawMaterialTools(services) {
  const need = (key) => serviceLookup(services, key, SERVICE_SOURCES[key]);

  return [
    {
      name: 'raw_transcript',
      description:
        '读一节课的**原始语音转写稿**（老师说过的原话，带时间戳）。'
        + '这是最原始的课堂记录，与 study_read 读的「整理过的 wiki 讲义」不是一回事。'
        + '**没整理过的课也能读** —— 平台上的字幕一直在。'
        + '用途：核实某个说法老师到底怎么讲的、讲义里没有的细节、'
        + '或者用户问「老师上课提到过 XX 吗」。'
        + '先调 study_courses 拿到 courseId 与 subId，不要猜编号。'
        + '如果平台没转好这一节（结果是空），可以用 transcribe=true 走本地转写 —— '
        + '但那需要本机装了 ASR 内核，没装会如实报错，不会返回假文本。'
        + '转写稿是长文，一次可能几千句，用 keyword 过滤或分页读。',
      parameters: {
        type: 'object',
        properties: {
          courseId: { type: 'string', description: '课程编号（从 study_courses 拿）' },
          subId: { type: 'string', description: '节次编号（从 study_courses 拿）' },
          keyword: { type: 'string', description: '只留包含这个词的句子（字面匹配，不区分大小写）' },
          offset: { type: 'integer', minimum: 0, description: '从第几句开始，默认 0' },
          limit: { type: 'integer', minimum: 1, maximum: 2000, description: '最多几句，默认 400' },
          transcribe: { type: 'boolean', description: '平台没有字幕时用本地转写（需 ASR 内核），默认 false' },
        },
        required: ['courseId', 'subId'],
        additionalProperties: false,
      },
      async run(args = {}, context = {}) {
        const signal = context.signal;
        signal?.throwIfAborted();
        assertArgs(args, ['courseId', 'subId', 'keyword', 'offset', 'limit', 'transcribe']);
        const courseId = str(args.courseId, '课程编号');
        const subId = str(args.subId, '节次编号');
        const keyword = optStr(args.keyword, '关键词', { max: 200 });
        const offset = optInt(args.offset, 'offset', { min: 0 }) ?? 0;
        const limit = optInt(args.limit, 'limit', { min: 1, max: 2000 }) ?? 400;

        const classroom = need('zhiyunClassroom');
        let sentences = [];
        let via = 'platform';
        try {
          const result = await classroom.getSubtitles(courseId, subId, { signal, tolerateNoSpeech: true });
          sentences = Array.isArray(result?.items) ? result.items : [];
        } catch (error) {
          if (args.transcribe !== true) throw error;
        }

        if (!sentences.length && args.transcribe === true) {
          // 本地转写：需要内核。没装时 source 会抛 DEPENDENCY_MISSING —— 原样透传，
          // 因为「装了什么、缺什么」是用户要照做的下一步，不该被包装成通用错误。
          const transcribed = await classroom.transcribeAudio(courseId, subId, { signal });
          sentences = Array.isArray(transcribed?.segments) ? transcribed.segments : [];
          via = transcribed?.engine ? `local:${transcribed.engine}` : 'local';
        }

        signal?.throwIfAborted();
        const all = sentences
          .map((item) => ({
            at: item.start ?? item.atSec ?? item.startMs ?? null,
            text: String(item.text ?? '').trim(),
          }))
          .filter((item) => item.text);
        const filtered = keyword
          ? all.filter((item) => item.text.toLowerCase().includes(keyword.toLowerCase()))
          : all;
        const page = filtered.slice(offset, offset + limit);

        return {
          guidance:
            '这是课堂原话（原始素材），不是整理过的讲义。引用时注明「据课堂录音」并给时间点，'
            + '不要说成讲义的结论。已用 keyword 过滤：' + (keyword ? '是' : '否') + '。',
          via,
          courseId,
          subId,
          matched: filtered.length,
          total: all.length,
          items: page,
          nextOffset: offset + limit < filtered.length ? offset + limit : null,
        };
      },
    },

    {
      name: 'raw_slides',
      description:
        '列出某一节课的**PPT 页面**，返回每一页的图片地址（按页序）。'
        + '⚠️ **这些都是图片，不是文字** —— 本仓没有 OCR，读不出页面上的字。'
        + '要 PPT 里讲了什么，优先用 raw_transcript 读老师讲的话（通常覆盖了 PPT 内容）；'
        + '确实需要看某页时，把图片地址给用户看。'
        + '用途：确认某节课有没有课件、共有几页、把课件地址交给用户。'
        + '先调 study_courses 拿 courseId 与 subId。',
      parameters: {
        type: 'object',
        properties: {
          courseId: { type: 'string', description: '课程编号（从 study_courses 拿）' },
          subId: { type: 'string', description: '节次编号（从 study_courses 拿）' },
          offset: { type: 'integer', minimum: 0, description: '从第几页开始（从 0 算），默认 0' },
          limit: { type: 'integer', minimum: 1, maximum: 500, description: '最多几页，默认 50' },
        },
        required: ['courseId', 'subId'],
        additionalProperties: false,
      },
      async run(args = {}, context = {}) {
        const signal = context.signal;
        signal?.throwIfAborted();
        assertArgs(args, ['courseId', 'subId', 'offset', 'limit']);
        const courseId = str(args.courseId, '课程编号');
        const subId = str(args.subId, '节次编号');
        const offset = optInt(args.offset, 'offset', { min: 0 }) ?? 0;
        const limit = optInt(args.limit, 'limit', { min: 1, max: 500 }) ?? 50;

        const classroom = need('zhiyunClassroom');
        const result = await classroom.getSlides(courseId, subId, { signal });
        signal?.throwIfAborted();
        const items = Array.isArray(result?.items) ? result.items : [];
        const page = items.slice(offset, offset + limit).map((item, index) => ({
          page: offset + index + 1,
          imageUrl: item.imageUrl ?? item.url ?? null,
          ...(item.cacheUrl ? { localUrl: item.cacheUrl } : {}),
        }));

        return {
          guidance:
            '这些是 PPT 页面图片，没有文字层。不要把图片当成「页面上的内容」去引用；'
            + '要文字请用 raw_transcript。把 imageUrl 原样交给用户即可。',
          kind: 'images-not-text',
          courseId,
          subId,
          total: items.length,
          items: page,
          nextOffset: offset + limit < items.length ? offset + limit : null,
        };
      },
    },
  ];
}

/** 只收白名单里的键 —— 挡掉账号与文件路径这类不该出现在工具参数里的东西。 */
function assertArgs(args, allowed) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw inputError('参数无效');
  const extra = Object.keys(args).filter((key) => !allowed.includes(key));
  if (extra.length) throw inputError(`工具参数无效；不接受的字段：${extra.join('、')}`);
}

/** 必填字符串。 */
function str(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw inputError(`需要 ${name}`);
  if (value.length > 200) throw inputError(`${name} 过长`);
  return value.trim();
}

export function apply(ctx) {
  createReadToolRegistrar({
    ctx,
    build: createRawMaterialTools,
    serviceSources: SERVICE_SOURCES,
  }).register(createRawMaterialTools);
}
