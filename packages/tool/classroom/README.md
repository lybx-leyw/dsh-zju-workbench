# @lybx-leyw/dsh-zju-tool-classroom

智云课堂工具包：把已整理的讲义放进 agent 的工具表。

| 工具 | 作用 |
| --- | --- |
| `study_catalog` | 浏览当前账号的课程资料目录（**已整理的讲义**） |
| `study_read` | 按课程 + 节次 + 资料标识读取全文 |
| `study_search` | 按关键词定位出处（只用于定位，不凭摘要作答） |
| `campus_classroom_read` | 平台原始数据：课程 / 节次 / 课件 / 字幕检索 / 直播状态（**不过审批**） |

## 为什么叫 classroom 而不是 study

本仓的 `tool/*` 与 `source/*` 按**同一个域**配对，包名带前缀区分层：

| 包 | 是什么 |
| --- | --- |
| `source/classroom` | 智云课堂的**平台接口** |
| `tool/classroom` | 它的**工具面** |

两者是同域的上下层，不是同一个包 —— 前缀已经把这件事说清了。

原先叫 `tool-study` 的代价是：它读的是课堂讲义，却与 `core/study`（学习空间
聚合页）同名，而那个才是 "study" 在别处指的东西。

## 依赖什么

`inject: ['zhiyunStudy', 'tools']` —— `zhiyunStudy` 由 `core/study` 提供，
两个包之间只剩**服务契约**，没有模块级 import。

两条注入都是惰性的：宿主没有 `tools` 服务时这一包不起作用，学习页照常可用。
工具表是附加能力，不该成为学习功能的前置。

## 挂载

本包**不带** `dsh.bundle.patch`，仓库里**没有** `cordis.patch.yml`。这不是遗漏：
两边各写一份挂载行的后果是同一个工具在表里出现两次。

目前唯一的注入点是 `@lybx-leyw/dsh-zju-preset-lecture` 的 `cordis.patch.yml`
（`- id: tool-classroom`）。要把它给别的 preset，在那个 preset 的 `plugins`
树里加一行即可，不要把它加进 profile 的 bundles。

## 读工具（`campus_classroom_read`）

平台原始数据的读：课程、节次、课件与录像、字幕检索、直播采集状态、课堂文字。

它**不与** `study_*` 争同一件事：`study_*` 读的是**已整理的讲义**（`zhiyunStudy`
的知识库），本工具读的是**平台上的原始数据**（`source/classroom`）。前者是加工过的，
后者是取证用的。

`zhiyunClassroom` **没有**写进 `inject`：那样课堂数据源没装时，连 `study_*` 三个
讲义工具都会一起不激活。它只提供平台取证，是附加能力，缺席时那一个工具如实报
`SERVICE_MISSING`，`study_*` 照常可用。

直播只读状态，不启动 / 不停止采集 —— `liveStart` / `liveStop` 会起停后台进程，
而直播链路还没真机验证（清单 B-3）。一个不留神启动的采集进程没人会发现。
