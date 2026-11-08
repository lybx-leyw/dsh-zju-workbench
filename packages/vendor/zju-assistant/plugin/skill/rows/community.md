## 校园社区

CC98（cc98）和查老师（chalaoshi）。下表是 `zju` 的 `args`。

| 用户目标 | 调用 |
|---|---|
| CC98 消息 | `cc98 account notifications`，回复、@、系统通知和未读私信一次返回 |
| 私信 | `cc98 private-message list`；回 `cc98 private-message send --user 用户名 --content 文本 --confirm` |
| 搜索、看帖 | `cc98 search --keyword "说法一、说法二"`，几种说法一次给完；看帖 `cc98 topic view --id 主题ID`（多个 `--id "A|B"`，只看楼主 `--lz`，找词 `--find`）；版面 `cc98 board topics --name 版面名`；十大 `cc98 hot` |
| 回帖、发主题 | `cc98 topic reply --id 主题ID --content 文本 --confirm`，楼主回帖要通知所有回复过的人加 `--notify-all`；`cc98 board post --board 版面 --title 标题 --content 正文 --confirm`，带图加 `--image` |
| 改自己发的楼（含主题楼） | 先 `cc98 floor original --post 楼层ID` 取原文，再 `cc98 floor edit --post 楼层ID --content 新的完整正文 --confirm`；标题、格式和主题的标签不给时沿用原来的 |
| 帖子里的图片、视频、附件 | `cc98 topic download --id 主题ID`，其他楼加 `--floor`；只有链接时 `--url` |
| 教师评价 | `chalaoshi teacher --name 姓名` |

只发布用户提供并授权的内容，遵守站点规则。CC98 上本人收到的消息页面会自己隔一阵读，进校园事务的「个人消息」，不用你盯。

命令细节：[CC98]({{core}}/zju/references/cc98.md) · [查老师]({{core}}/zju/references/chalaoshi.md)
