/**
 * 文档工具（`campus_doc`）：把 `core/doc` 的四条能力挂到 agent 的工具表。
 *
 * # 为什么这一层必须存在
 *
 * `core/doc` 是一个服务（`ctx.zhiyunDoc`），模型看不到服务 —— 它只看得到工具表。
 * 只做服务不做工具，结果就是 `coverage-gaps.md` 里反复记过的那种失效：
 * **名字对得上，工具走不到**。上游这四条是 CLI 命令（`zju doc text|pdf|pages|find`），
 * 迁移到本仓就是四个 **action** —— 一个工具收 `action`，比四个工具少占三格表面，
 * 而它们共享同一套参数（`file` / `out`）。
 *
 * # 为什么走读链（不过审批）
 *
 * 判据是**会不会改变外部状态**。这四条都只读本机文件、往本机写新文件：
 * 没有平台的写接口，没有不可撤销的动作（输出不覆盖已有文件，见 `core/doc`）。
 * 审批链的定位（`tool/write-kit` 开头那段）是「选课、交作业、发帖」那一类，
 * 给「把一个 PDF 拆成几页」配批准框只会让用户对「同意」脱敏。
 *
 * # 为什么不自己拼路径
 *
 * `out` 原样交给服务，服务负责「已存在就报错、父目录不存在就建」。工具层若也做一遍
 * 校验，就有了两个真相 —— 而模型看到的是先被触发的那一个。
 */

import { createReadToolRegistrar, inputError, optStr, serviceLookup, str } from '@lybx-leyw/dsh-zju-tool-kit';

/** 本包消费的服务。`inject` 由包入口 `index.js` 声明。 */
export const SERVICE_SOURCES = Object.freeze({
  zhiyunDoc: '@lybx-leyw/dsh-zju-core-doc',
});

/**
 * 本包需要的宿主服务。
 *
 * # 为什么必须声明 `tools`（而不是只靠 `ctx.tools` 碰运气）
 *
 * Cordis 的**真实行为**（与 `core/notes` 头部记的是同一条）：没写进 `inject` 的服务，
 * 直接读会抛 `cannot get property "tools" without inject` —— 它不是 `undefined`。
 * 也就是说「不声明、用时判空」这条路根本走不通：第一次注册就炸。
 *
 * ## 为什么也声明 `zhiyunDoc`
 *
 * 声明它等于「没有 `core/doc` 时本包不激活」。这是**对的**：本包唯一能做的事就是
 * 调那个服务的四个方法，服务不在时它没有任何价值。不声明的话，插件会激活、
 * 注册一个每次都报 `SERVICE_MISSING` 的工具 —— 模型会看到一格永远失败的工具，
 * 而真相是「那个包没装」。
 *
 * ⚠️ 与 `tool/classroom` 的取舍一致（那里是 `['zhiyunStudy', 'tools']`）。
 *    `tool/ebook` / `tool/notice` 那几个只读包**没有** `inject` —— 它们目前
 *    也没有任何 preset 挂载，所以「不声明也能跑」这件事从未被验证过。
 *    本包会被 `preset/lecture` 挂上，所以按能跑的那条路写。
 */
export const inject = ['tools', 'zhiyunDoc'];

/** `action` 的取值，顺序与上游 `docCommands` 一致（text / pdf / pages / find）。 */
export const DOC_ACTIONS = Object.freeze(['text', 'pdf', 'pages', 'find']);

/**
 * 把 `a|b|c` 或 `a、b、c` 拆成数组。
 *
 * 上游用竖线（因为文件名里可能有逗号），但用户在中文输入法下很容易打出全角竖线；
 * 顿号也一样常见。三种都收 —— 「分隔符不对」不该变成一次猜谜。
 *
 * @param {string} value 原始字符串。
 * @param {string} name 参数名（报错时用）。
 * @returns {string[]} 非空片段。
 * @throws {Error} `INPUT` 拆完是空的。
 */
export function splitList(value, name) {
  const text = str(value, name, { max: 4000 });
  const items = text.split(/[|｜、,，]/).map((item) => item.trim()).filter(Boolean);
  if (items.length === 0) throw inputError(`${name} 里没有内容`);
  return items;
}

/**
 * 读工具的定义。**纯数据 + 纯函数**，不碰 Cordis。
 *
 * @param {object} services 已解析的服务表。
 * @returns {object[]} 工具定义数组（只有一个）。
 */
export function createDocTools(services) {
  const need = () => serviceLookup(services, 'zhiyunDoc', SERVICE_SOURCES.zhiyunDoc);

  return [
    {
      name: 'campus_doc',
      description:
        '处理本机上的文档：把 PDF、Word、Excel、PPT、网页、纯文本里的文字取出来（按页给出，全文另存 Markdown）；'
        + '把图片和 PDF 按顺序合成一个 PDF；从 PDF 取出指定页另存；找关键词在 PDF 的哪几页。'
        + '它读的是本地文件，不下载。扫描件和纯图片没有文字层，会如实返回 no_text —— 要看内容得把页面渲染成图。'
        + 'Word / Excel / PPT 目前直接读 OOXML 里的文字（.doc/.xls/.ppt 这类 97-2003 老格式读不了，要先另存）。',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: [...DOC_ACTIONS],
            description: 'text 取文字；pdf 合成；pages 取指定页；find 找关键词',
          },
          file: {
            type: 'string',
            description: '输入文件路径。pdf（合成）时可用 | 分隔多个文件，按给出的顺序排页',
          },
          pages: {
            type: 'string',
            description: 'pages：页码从 1 起，如 43-49,390-391',
          },
          keyword: {
            type: 'string',
            description: 'find：关键词，多个用 | 分隔',
          },
          size: {
            type: 'string',
            enum: ['a4', 'original'],
            description: 'pdf：图片页 a4 居中放在 A4 上（默认），original 保持原图大小',
          },
          out: {
            type: 'string',
            description: '输出 PDF 路径，如按作业要求命名；省略时存到 profile 的 data/doc，已有文件不覆盖',
          },
        },
        required: ['action', 'file'],
        additionalProperties: false,
      },
      async run(args) {
        const action = str(args.action, 'action');
        if (!DOC_ACTIONS.includes(action)) {
          throw inputError(`不认识的 action：${action}（只认 ${DOC_ACTIONS.join(' / ')}）`);
        }
        const file = str(args.file, 'file', { max: 4000 });
        const out = optStr(args.out, 'out', { max: 4000 });
        const doc = need();

        if (action === 'text') return doc.text(file);
        if (action === 'find') return doc.find(file, splitList(args.keyword, 'keyword'));
        if (action === 'pages') {
          const rule = str(args.pages, 'pages', { max: 200 });
          return doc.pages(file, rule, out === undefined ? {} : { out });
        }
        // pdf：多文件用 `|` 分隔，顺序即页序。
        const files = splitList(file, 'file');
        const size = optStr(args.size, 'size', { max: 20 }) ?? 'a4';
        return doc.pdf(files, out === undefined ? { size } : { size, out });
      },
    },
  ];
}

export function apply(ctx) {
  createReadToolRegistrar({
    ctx,
    build: createDocTools,
    serviceSources: SERVICE_SOURCES,
  }).register(createDocTools);
}
