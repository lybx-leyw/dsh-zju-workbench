# @lybx-leyw/dsh-zju-preset-zju

「校园」Agent preset：标准模式 + **全部校园工具**。

## 与 `lecture` preset 的关系

两个 preset 共用同一份 composition（宿主 `standard.patch.yml` 那棵 row 树），
差别只在追加哪些工具：

| preset | id | order | 追加的工具 |
| --- | --- | --- | --- |
| 讲义模式 | `lecture` | 5 | `tool-classroom` + `tool-doc` |
| 校园模式 | `zju` | 6 | **全部 12 个工具包** |

`tool-classroom` **两边都有**。这不是重复挂载：一次会话只用一个 preset，
工具表里只会出现一份。

## 为什么要一个「什么都有」的 preset

本仓的 27 个工具覆盖教务、学在浙大、CC98、二课、场馆、实验课、学习通、
拼题A、通知、查老师、电子书、课堂资料、文档处理。

它们各自只对某一类任务有意义，但用户的请求**会随时跨域**：

> 「帮我查一下选课」→ 教务
> 「论坛上有人问过这门课吗」→ CC98
> 「我的作业交了没」→ 学在浙大

拆成多个 preset 只会让用户每次先猜「这次该选哪个」。所以这一个装全部。

**代价**是工具表长（27 个），**换来**的是「不用先选对模式」。
校园场景下，「工具选错了」比「多读几行工具描述」更贵。

## 装了哪些

| 工具包 | 工具数 | 覆盖 |
| --- | --- | --- |
| `tool-classroom` | 7 | 课堂资料（wiki）+ 原始素材 + 平台数据 |
| `tool-zdbk` | 2 | 教务网（课表/成绩/选课） |
| `tool-xuezai` | 3 | 学在浙大（作业/点名/下载） |
| `tool-cc98` | 4 | CC98 论坛 |
| `tool-sztz` | 2 | 二课活动 |
| `tool-tyys` | 2 | 体育场馆 |
| `tool-lab` | 2 | 实验选课 |
| `tool-xxt` | 1 | 学习通 |
| `tool-pta` | 2 | 拼题A |
| `tool-notice` | 1 | 校内通知 |
| `tool-chalaoshi` | 1 | 查老师 |
| `tool-ebook` | 1 | 电子图书 |
| `tool-yjsy` | 1 | 研究生教务 |
| `tool-doc` | 1 | 本地文档处理 |

**13 个包、27 个工具。**

## 为什么工具包不进 profile bundles

工具包只负责「怎么注册」，不负责「什么时候装」。放进 profile 就是**主机平面**，
所有 preset 的 agent 都会看到 —— 那会让 `standard` 的职责变模糊，
也让工具表在不需要它的场景里白白变长。

所以它们只出现在**这个 preset** 的 `plugins` 树里。

## 一个包缺席会怎样

每个工具包 `inject` 的都是主机的服务（`zhiyunZdbk` / `zhiyunCc98` / …）与
`tools` 注册表。某个数据源没装时，它对应的工具如实报 `SERVICE_MISSING`，
**不影响其他工具** —— 这正是按域分包的好处。

## patch 由脚本生成

```bash
cd packages/preset/zju
node gen.mjs <dsh-web-app/presets/standard.patch.yml 路径>
```

`gen.mjs` 是唯一真源。**不要手改 `cordis.patch.yml`** —— 它会被下一次生成覆盖。

宿主版本变了（`runtime.lock.json` 的 `preferredHostVersion`）时要重新生成：
`standard.patch.yml` 的 row 树在版本间会变，照抄旧版会漏掉新的宿主 row。
