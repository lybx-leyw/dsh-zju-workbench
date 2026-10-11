# dsh-zhiyun-notes

节笔记的领域层：Markdown 正文、`zy://section` 时间链和页码链、`zy-asset` 附件记录。零 UI。持久化由注入的 store 完成，本包不自己写文件。

学习页的笔记栏在 `dsh-zhiyun-page-study`。读写经过 `dsh-zhiyun-study-core` 的 `note` / `note-save` / `note-link` / `note-link-text`。工作台调用本包时把节 id 写成 `账号.节次`，因为这里的键只有课程和节次，本身不区分登录身份。

## 服务

插件激活后提供 `ctx.zhiyunNotes`。`inject: ['storageDomain']`：没有宿主存储域时不激活，而不是退成重启就丢的内存笔记。测试和离线调用可以传 `config.store`，例如 `createMemorySectionNoteStore()`。

| 方法 | 说明 |
| --- | --- |
| `get` / `getOrEmpty` | 读一节。没有记录时 `get` 返回 `null`，`getOrEmpty` 返回空笔记且不落盘 |
| `put` | 替换这一节的正文。其它节保留 |
| `remove` | 删记录，不删附件字节 |
| `list` | 按存储顺序返回副本 |
| `putAsset` / `getAsset` / `removeAsset` | 只登记 `{id, file, alt, page}`。字节由调用方保管 |
| `exportMarkdown` | 改写内链并交回附件文件名，不读文件 |

纯函数在 `src/note.js`：`timeLink`、`pageLink`、`parseZySectionUri`、`mmss`。生成链接和打开链接是两件事。`page=0` 仍会写进链接，定位时才丢掉。

## 验证

```bash
node --test tests/notes.test.mjs
```

用例不连网。宿主存储域的形状按 `0.2.x` 的 domain API 写；打不开时抛 `CONFIG`，不静默换成内存。
