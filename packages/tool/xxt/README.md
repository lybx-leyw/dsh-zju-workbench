# @lybx-leyw/dsh-zju-tool-xxt

学习通（超星 / [chaoxing.com](https://chaoxing.com)）工具包。一个包只装一个域：**课程、章节、
课件与视频的清单与下载、作业清单**。

对应数据源：`source/xxt`（包名 `@lybx-leyw/dsh-zju-source-xxt`）。

## 工具

| 工具 | 作用 | 审批 |
| --- | --- | --- |
| `campus_xxt_read` | 读：7 个 action（课程 / 章节 / 课件 / 视频 / 作业的清单与下载） | **不过审批** |

### 七个 action

| action | 上游 provides | 做什么 |
| --- | --- | --- |
| `courseList` | `chaoxing course list` | 我的课程（课程页链接也认，重名课分得开） |
| `chapterList` | `chaoxing chapter list` | 一次给出整门课每节有什么文件 |
| `materialList` | `chaoxing material list` | 课件清单（**含「资料」栏**，两条通路按 `objectId` 合并） |
| `materialDownload` | `chaoxing material download` | 把课件下到本机 |
| `videoList` | `chaoxing video list` | 视频清单（按 16 种视频扩展名判类型，音频不算） |
| `videoDownload` | `chaoxing video download` | 把视频下到本机（可选平台的播放版） |
| `homeworkList` | `chaoxing homework list` | 作业清单（**三个来源**合并） |

## 分工

| 层 | 做什么 |
| --- | --- |
| `source/xxt` | **基础函数**：接受用户能给出的各种形式（课程名 / id / 课程页链接；章节标题 / 清单里的 `location`；文件名 / 不带扩展名 / 名字里的一段），算好请求与落盘，返回固定形状 |
| 本包 | **封装**：把用户话术翻成参数、校验、暴露给模型 |

**不让工具层调 source 的读方法自己拼参数**：那样每加一个工具就多一份拼法，而
「按名字找章节」这类规则只要有两份就会分叉。

## 为什么没有写工具

学习通里所有「写」都是用户自己的决定且不可逆：交作业、开始考试、签到。本包一条都不做，
`inject` 里也没有 `approval` —— 声明它只会让后来加工具的人以为审批已经接好了。

**下载不是写操作**：它读平台的文件、写本机磁盘，学习通上的状态一点没变。判据是
「有没有改别人的状态」，不是「有没有碰磁盘」。真正的边界在目录上：落盘根目录由数据源
装配时决定（`downloadDir`），**工具的参数里没有路径** —— 让模型传路径等于让它往任意
位置写文件。

## 为什么七个 action 挤在一个工具里

上游把 162 条命令压进一个 `zju` 工具（省上下文），本仓别处是一个动作一个字段齐全的工具。
这里取中间：**一个域一个工具 + action 枚举**，与 `campus_cc98_read`（22 action）、
`campus_zdbk_read`（12 action）同形。

七个 action 共享同一批参数（课程、章节、文件名），拆成七个工具会让「课程」这个字段
出现七次 —— 在模型的上下文里，重复的字段名比多一个 enum 值更贵。

## 挂载

本包**不带** `dsh.bundle.patch`，仓库里**没有** `cordis.patch.yml`。工具包只负责
「怎么注册」，不负责「什么时候装」—— 后者是 preset 的决定（D11 未定）。
两边各写一份挂载行的后果是同一个工具在工具表里出现两次。

## 测试

`tests/tool/xxt/xxt-tool.test.mjs`（工具层参数翻译与注册链）与
`tests/source/xxt/xxt-files.test.mjs`（source 侧的资料栏、下载落盘、三个作业来源）。
两份都**全离线**：source 是记账用的假身，落盘走 `mkdtemp` 出来的临时目录。
