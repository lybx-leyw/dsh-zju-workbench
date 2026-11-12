# @lybx-leyw/dsh-zju-tool-doc

文档工具包：一条工具 `campus_doc`，四个 `action` 对应上游 `doc` 模块的四条 provides。

| action | 做什么 | 服务方法 |
|---|---|---|
| `text` | PDF / Word / Excel / PPT / HTML / 纯文本 → 文字（按页），全文另存 Markdown | `zhiyunDoc.text` |
| `pdf` | 图片、PDF、Office 文档按顺序合成一个 PDF | `zhiyunDoc.pdf` |
| `pages` | 从 PDF 取出指定页另存 | `zhiyunDoc.pages` |
| `find` | 找关键词在 PDF 的哪几页 | `zhiyunDoc.find` |

服务由 `@lybx-leyw/dsh-zju-core-doc` 提供（`ctx.zhiyunDoc`）。

## 为什么一个工具而不是四个

它们共享 `file` 参数、都是「对一个本地文档做一件事」，而工具表每多一格都在挤占
模型的注意力。上游那四条之所以是四条命令，是因为 CLI 的子命令是免费的；工具表不是。
参数里 `action` 的取值顺序与上游一致，便于对照。

## 为什么走读链（不过审批）

四条都只读本机文件、写**新**文件：不改任何平台状态，没有不可撤销的动作（输出不覆盖
已有文件）。审批链的定位是「选课、交作业、发帖」那一类 —— 给「把一个 PDF 拆成几页」
配批准框，只会让用户对「同意」脱敏。

## 分隔符

上游用 `|`，本仓另收全角竖线 `｜`、顿号 `、`、逗号（半角/全角）—— 中文输入法下
打出全角符号太常见，而「分隔符不对」不该变成一次猜谜。

- `pdf` 的 `file`：多个输入按给出的顺序排页。
- `find` 的 `keyword`：多个关键词各算各的。

## 没有 `url` 参数

上游 `doc text` 支持 `--url`，它要靠 WebVPN / 教务网会话去下载。`core/doc` 没有网络
出口（理由见它的 README 与 `abandoned.md` 的 Q-1），所以这里也不声明这个参数 ——
声明一个永远走不通的参数，比不声明更糟：模型会一直试。

## 挂载

`package.json` **没有** `dsh.bundle.patch`，仓库里**没有** `cordis.patch.yml`。
与 `tool/classroom` 同一条理由：工具包只负责「怎么注册」，不负责「什么时候装」。
目前没有任何 preset 挂它；要挂时在对应 preset 的 `plugins` 树里加一行
`name: '@lybx-leyw/dsh-zju-tool-doc'`，不要加进 profile 的 bundles（那会让每个
preset 都看到它）。

## 验证

```bash
node --test tests/tool/doc/doc-tool.test.mjs
```

服务是假的：这一份守的是「参数怎么翻成服务调用」（action 分派、透传、错误顺序、
不碰审批）。PDF 与 Office 的真实行为在 `tests/core/doc` 里测。
