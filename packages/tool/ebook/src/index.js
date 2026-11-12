/**
 * 电子图书（ebook）**读**工具定义。
 *
 * 只有一条 provides：`ebook search`。纯只读，不下载、不借阅。
 */

import { createReadToolRegistrar, defined, inputError, optInt, optStr, serviceLookup } from '@lybx-leyw/dsh-zju-tool-kit';

const SERVICE_SOURCES = Object.freeze({
  zhiyunEbook: '@lybx-leyw/dsh-zju-source-ebook',
});

/**
 * 读工具的定义。**纯数据 + 纯函数**。
 *
 * @param services - 已解析的 source 服务。
 * @returns 工具定义数组。
 */
export function createEbookReadTools(services) {
  const need = () => serviceLookup(services, 'zhiyunEbook', SERVICE_SOURCES.zhiyunEbook);

  return [
    {
      name: 'campus_ebook_read',
      description:
        '在浙大电子图书库里查书：按书名或 ISBN 查有没有、在哪个平台、能不能在线读。'
        + '只查目录与链接，不下载、不借阅。',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '书名（与 isbn 二选一）' },
          isbn: { type: 'string', description: 'ISBN，10 位或 13 位数字，可带连字符（与 title 二选一）' },
          limit: { type: 'integer', minimum: 1, maximum: 50, description: '最多几条，默认 10' },
        },
        required: [],
        additionalProperties: false,
      },
      async run(args) {
        // 先校验参数再取服务：两个都没给是调用方的错，与「包没装」无关。
        const title = optStr(args.title, '书名');
        const isbn = optStr(args.isbn, 'ISBN');
        if (!title && !isbn) throw inputError('需要 title（书名）或 isbn 其中一个');
        if (title && isbn) throw inputError('title 与 isbn 只能给一个');
        const ebook = need();
        return ebook.search(defined({ title, isbn, limit: optInt(args.limit, 'limit', { min: 1, max: 50 }) }));
      },
    },
  ];
}

export function apply(ctx) {
  createReadToolRegistrar({
    ctx,
    build: createEbookReadTools,
    serviceSources: SERVICE_SOURCES,
  }).register(createEbookReadTools);
}
