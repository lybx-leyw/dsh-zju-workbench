## 校园通知

学校各部门和本人学院的通知（notice）。下表是 `zju` 的 `args`。

| 用户目标 | 调用 |
|---|---|
| 最近的通知，按关键词、部门或学院找 | `notice list`，默认最新 10 条完整正文与附件；可加 `--keyword`（几个说法用顿号一次给完）、`--source`（来源、栏目或学院名，本人学院写 学院）、`--since`/`--until`、`--limit` |
| 有没有新通知、哪些和我有关 | `notice new`，只回上次之后新发布的标题和链接；按标题挑出相关的，再用一次 `notice view --url` 取全文 |
| 某条通知全文 | `notice view --url 通知链接`，多条用竖线分隔；只知道标题时 `--title` |

关键词已含常见简称的全称，一次结果即可作答，不换词重查。status=partial 时说明没取全，sourceErrors 是这次没读到的来源。新通知页面上也会读，进校园事务的「校园通知」。

命令细节：[通知]({{core}}/zju/references/notice.md)
