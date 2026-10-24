# dsh-zhiyun-core-study

「学习」这个产品的**领域状态层**：多页共用的唯一真源。它一个人管三件事 —— 学习空间、学习控制器（账号 / 课程 / 节次 / 解析 / 讲义 / 习题的状态机）、以及 `/api/zhiyun-study` 后端。

页面包不认识彼此，只认这里的服务名：

| 服务 | 谁提供 | 谁取用 |
| --- | --- | --- |
| `zhiyunStudy` | `src/host.js`（宿主半边） | 宿主侧插件、测试 fixture |
| `zhiyunStudyController` | `src/client.jsx`（客户端半边） | 今天、我的课、学习、个人 |
| `zhiyunLearningSpace` | `src/client.jsx` | 外壳的会话抽屉（`ctx.get` 惰性取） |

页面包用 `ctx.inject(['zhiyunStudyController'], …)` 等它到位再注册插槽；外壳用 `ctx.get('zhiyunLearningSpace')` 直接取。两者都不写进 `inject` —— 领域层被停用时，外壳照常启动，只是列不出会话。

## 学习空间

每个数据目录恰好一个工作区记录：路径取 `DSH_HOME`（本工作台自己的数据目录）优先，没有该变量时退回宿主进程的工作目录。`workspaceRegistry.create` 是「建或复用」且按 `fs.realpath` 归一化，重复启动只会拿到同一条记录。建不出来时只警告不抛错 —— 学习面板不该因此装不上。

空间的识别与会话行投影（`LEARNING_SPACE_TITLE`、`pickLearningWorkspace`、`sessionRows`、`relativeLabel`）都在 `src/learning-space.js`：**标题是单一来源**，宿主半边与客户端半边都从这里 import，不写字面量。

## 后端

`/api/zhiyun-study` 是 POST-only 的 RPC，信封 `{type:'client-request', rpcId, method:'zhiyun-study', payload:{method, args}}`，方法使用显式白名单；响应统一 `{type:'server-response', rpcId, result}` 且 `cache-control: no-store`。错误进 `{ok:false, error:{code, message, details:{}}}`，不把内部堆栈漏给浏览器。

`schedule` 只读课表，沿用当前登录身份。不传日期时由课堂数据源按上海时区的今天取一天。日期不合法记为 `INPUT`。课表是否收全看返回的 `meta.complete`，今天页在它不是 `true` 时不把列表画成全天安排。

`recent` / `recent-save` 只记当前账号上次打开的那一节，写在学习数据目录的 `recent.json`。打开一节课时由客户端记下课程和节次标题；时间由服务端填写。另一个账号读不到这条。文件损坏时报 `RECENT`，不把它说成「还没打开过」。

`review` 只读当前账号已经采纳的题：题干和定位，不带答案。待审和已放弃的题不在这份列表里。最多 20 条。

基础服务在加载时注入；讲义服务惰性读取，点击生成时要求 zhiyunLecture.generate 已接入。出题和笔记按需读取各自服务。

出题只接受调用方点名的知识片段，不接受整节。生成结果经出题包的 `saveGenerated` 落成 `proposed`，写进该节的知识库记录；复习队列只在用户采纳之后出现。终稿一变，这一节的题目随讲义一起作废。节笔记走 `zhiyunNotes`，键是 `账号.节次`，避免笔记服务本身不带账号时串到另一个登录身份。页码和时间链接由笔记包生成，学习页只负责在本节课件和字幕里定位。

## 统一生成（v4）

App 仅通过 start 启动后台任务：读取整节 → 课件识别与转录清洗/标记并发 → 语义分组 → 分级聚合与重构树 → 按知识点成稿 → 逐点终审。

成稿和终审由讲义包的 generate 编排，bench 也调用同一入口。App 只存储和展示产物，不重新建树、筛块或拼装另一份提示词。未另配时默认并发 3；使用页面配置时，各阶段并发上限统一取所选供应商 worker 数之和。切分阈值 1200、课件拼图 4 页，清洗和聚合输出预算 16384，终审预算 32768。模型来自个人配置；比较实跑结果时应选用 bench 相同的模型。

result 轮询返回整条任务的实际阶段、完成数、阶段开始时间与总耗时。识别和清洗分别保留进度；成稿分卷、终审知识点完成时立即更新。取消或切换账号会中断整条链。逐点终审部分失败时保留原稿并标记部分完成。

不再提供 lecture、lecture-polish 或 lecture-restore RPC。没有 v4 标记的旧讲义不展示，重新生成后替换；不从历史数据另建树兼容。解析资源仍保留完整来源供检索和跳转。

## 验证

- `npm run test:study`：真实宿主知识库存储、账号隔离、迁移、版本失效、互斥写入与失败保留。
- `npm run test:study-host`：原生宿主 RPC、终稿阅读、课件、字幕、主题、窄屏与刷新恢复。

## 多供应商生成配置

models 返回宿主模型目录和已保存的 workers；models-save 接受 `{ workers: [{ provider, model, workers }] }`，只保存标识与整数配额，校验供应商已配置且模型可解析。开始生成时快照该配置，创建独立解析器和讲义服务，共用一个 WorkerPoolLlm；启动、保存与运行中的配置变更互斥，任务结束释放实例。任务查询返回各供应商的配额、在途数、完成数和失败数。

## 全局生成队列

`start` 将节次加入 FIFO 队列，同节正在运行或等待时返回已有任务；不同节默认串行执行，每节内部继续使用共享 worker 配额。入队时快照供应商、模型和 worker，队列状态不依赖当前选中的课程。`queue` 与 `state` 返回当前账号的任务、标题、阶段与耗时；前端轮询整条队列，并单独加载当前课堂完成后的结果。`cancel` 可取消正在运行的任务或移出等待任务，失败和取消后自动继续。切换账号或关闭服务会中断全部任务；队列由当前宿主进程持有，不跨宿主重启恢复。

## 知识点题库

`bank-catalog` 读取当前账号所有已整理节次的知识点，按语义分组归属材料，优先采用同名讲义正文。客户端只提交知识点标识、题型与数量；材料、范围、来源修订和锚点均由宿主重新查得。`bank-generate` 先按模式分配数量，再逐知识点改写、生成和规则检查，逐题存入独立题库，失败如实返回计划与实际数量。`bank-load`、`bank-practice`、`bank-answer`、`bank-discard` 共用账号级写互斥；作答以练习会话与题号核对，重复提交不重复计数。

## 后台出题批次

`bank-generate` 持久化分配方案与检查点后立即返回批次。`bank-progress` 无需等待模型或持有长事务；`bank-pause`、`bank-resume` 控制同一批次。批次、题目和练习写操作通过账号级短事务串行，模型请求在事务外运行。批次停止与账号切换、宿主卸载一起等待；缓存和原始分配在宿主重启后仍可恢复。阶段检查点包含版本及资料指纹，题目与草稿游标一次提交，缓存不匹配时拒绝恢复。

新批次接受 `strategies:[{id,weight}]`、`difficulty`（basic/advanced/challenge）、`source`（course/web），与 `mode`（uniform/random）、`types`、`count` 独立。概念底稿存入同账号 `conceptCache`，通过资料摘要跨批次复用。完整历史题只在服务端用于生成上下文与去重，客户端无法提供或覆盖资料。`bank-load` 附带概念与考查角度覆盖统计；`bank-practice` 支持 `freshRatio`、策略与题型过滤，`bank-answer` 的简答题必须显式提交 `selfVerdict`，存为自评而非机器判分。
