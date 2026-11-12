# @lybx-leyw/dsh-zju-tool-xuezai

学在浙大工具包。一个包只装一个域：**交作业、点名签到（单次与批量），以及它们要的读侧**。

对应数据源：`source/xuezai`（包名 `@lybx-leyw/dsh-zju-source-xuezai`）。

## 工具

| 工具 | 作用 |
| --- | --- |
| `campus_homework` | 写：提交 / 撤回作业（逐次审批） |
| `campus_checkin` | 写：给 `course` 签指定的那一门；给 `all: true` **一次签全部待签的点名**（逐次审批） |
| `campus_xuezai_read` | 读：待办、课程、课程文件、作业、点名历史；下载课件与作业文件（**不过审批**） |

### `campus_xuezai_read` 的两个下载 action

| action | 入参 | 落到哪 |
| --- | --- | --- |
| `materialDownload` | `names` 或 `uploadIds` 二选一，或显式 `all: true` | `<数据目录>/downloads/<课程>/课件/` |
| `homeworkDownload` | `homework` 必填；可选 `parts`（`attachments` / `submission` / `corrections`）、`names` / `uploadIds` | `<数据目录>/downloads/<课程>/<作业>/`，老师批改在 `老师批改/` 子目录 |

`all` 与 `names` / `uploadIds` 互斥：同时给会让结果取决于实现里的判序。
三个都不给会报 `INPUT` —— **不默认下整门课**（一门课的视频常有几个 GB）。

### 下载**不过审批**，判断依据

判据是「会不会改变**平台**上的状态」。下载只从平台读字节、往本机写文件，
平台侧一个字节都没变；而审批链的定位（`tool/write-kit` 的说明）正是
「会改变外部状态、做错了没法靠再读一次挽回」的那一类。

这不是新口径，是同仓已有的：

- `campus_cc98_read` 的 `topicDownload` 把一个楼层里的文件流式落盘，走读链、不过审批；
- `tool/classroom/src/reads.js` 也明写「审批只给会改变平台状态的动作」。

两个下载能力在同一仓里用两套审批口径，比任何单独一边的口径都更难解释。

给下载配批准框的代价是可预期的：用户会把「同意」当成翻页，等真的交作业、
点名时那次点击就没有意义了 —— 而点名窗口只有几分钟。

「写本机文件」这一半不是不管，而是**关在已知范围内**（全部在 source 侧）：

| 风险 | 处置 |
| --- | --- |
| 写到任意位置 | 目录根由装配层定（`config.downloadDir`），**参数里没有 `dir` / `path`** |
| 路径穿越 | `safeFileName()` + resolve 后再核一次不越界 |
| 同名覆盖 | 发布用 `link()`（`EEXIST` 即失败）；大小不同则另存 `(n)` |
| 一次下太多 | `all` 必须显式给；单个文件有 `downloadMaxBytes` 上限 |
| 老师设了禁止下载 | `allow_download: false` 的文件不下载、连签名地址都不去要 |

### `campus_checkin` 的两条路

| 入参 | 走哪个 source 动作 | 语义 |
| --- | --- | --- |
| `course`（+ 可选 `code`） | `rollcallPrepare` / `rollcallExecute` | **单次**：签调用方点名的这一门 |
| `all: true`（+ 可选 `course` 筛选、`passes` 轮数） | `rollcallAllPrepare` / `rollcallAllExecute` | **批量**：自己列当前点名、把待签的都签掉 |

批量模式的 `course` 是**筛选器**而不是必填项 —— 批量恰恰是「不知道该签哪门」时用的。
但两个都不给会报 `INPUT`：那种调用等于「随便签点什么」。
`all` 与 `code` 也不能同时给：一个口令签不了多个点名。

审批理由会写明**可能一次签多个**并指名会签哪几个 —— 用户批准的是「签这几个」，
不是「某个动作」。审批框上只写「批量签到」等于没写。

## 分工

| 层 | 做什么 |
| --- | --- |
| `source/xuezai` | **基础函数**：算好执行所需的全部参数（表单字段、签名、令牌、目标 id），并接受用户能给出的各种形式（编号 / 名称） |
| 本包 | **封装**：把用户话术翻成参数、校验、审批、暴露给模型 |

写操作本质也是函数：**source 做完整的基础函数，tool 做现成的封装调用暴露**。
所以「参数名对不上」不是分工问题，是接线错误；「source 少收字段」不是归他处，
是基础函数不完整。

## 为什么按域拆

原先 7 个工具装在同一个 `campus-write` 包里，横跨 7 个数据源。代价是：
想只给「选课」的能力，得把发帖、交作业、场馆预约一起给出去。

现在与 `source/*` 一一对应。审批与注册器在 `@lybx-leyw/dsh-zju-tool-write-kit`，
**不重复实现**。

## 挂载

本包**不带** `dsh.bundle.patch`，仓库里**没有** `cordis.patch.yml`。
工具包只负责「怎么注册」，不负责「什么时候装」—— 后者是 preset 的决定。

## 读工具与写工具分开两条注册链

本包同时挂写工具（`createXxxWriteTools`，走 `tool/write-kit`，**每一步都审批**）
与读工具（`createXxxReadTools`，走 `tool/kit`，**不审批**）。

这不是代码风格，是产品决定：审批只给会改变平台状态的动作。给「查课表」配一个
批准对话框，会让用户养成一路点同意的习惯 —— 等真的选课、交作业时，那次点击
就不再有意义了。两条链分开，才不会有「顺手把审批也套在读工具上」的余地。
