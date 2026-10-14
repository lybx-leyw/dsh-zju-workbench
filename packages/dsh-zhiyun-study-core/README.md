# dsh-zhiyun-study-core

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

`/api/zhiyun-study` 是 POST-only 的 RPC，信封 `{type:'client-request', rpcId, method:'zhiyun-study', payload:{method, args}}`，方法白名单 28 项；响应统一 `{type:'server-response', rpcId, result}` 且 `cache-control: no-store`。错误进 `{ok:false, error:{code, message, details:{}}}`，不把内部堆栈漏给浏览器。

`schedule` 只读课表，沿用当前登录身份。不传日期时由课堂数据源按上海时区的今天取一天。日期不合法记为 `INPUT`。课表是否收全看返回的 `meta.complete`，今天页在它不是 `true` 时不把列表画成全天安排。

`recent` / `recent-save` 只记当前账号上次打开的那一节，写在学习数据目录的 `recent.json`。打开一节课时由客户端记下课程和节次标题；时间由服务端填写。另一个账号读不到这条。文件损坏时报 `RECENT`，不把它说成「还没打开过」。

`review` 只读当前账号已经采纳的题：题干和定位，不带答案。待审和已放弃的题不在这份列表里。最多 20 条。

`inject` 只声明**硬依赖**（`workspaceRegistry / connection / profileContext / zhiyunClassroom / zhiyunParser / llm / zhiyunKnowledge`）。讲义、终审、出题与节笔记是可选加工步骤，用 `ctx.get('zhiyunLecture')` / `ctx.get('zhiyunFinalPass')` / `ctx.get('zhiyunQuiz')` / `ctx.get('zhiyunNotes')` 惰性取 —— 写进 `inject` 会让「停用其中一个」直接拖死整个学习面板（连解析都用不了）。

出题只接受调用方点名的知识片段，不接受整节。生成结果经出题包的 `saveGenerated` 落成 `proposed`，写进该节的知识库记录；复习队列只在用户采纳之后出现。终稿一变，这一节的题目随讲义一起作废。节笔记走 `zhiyunNotes`，键是 `账号.节次`，避免笔记服务本身不带账号时串到另一个登录身份。页码和时间链接由笔记包生成，学习页只负责在本节课件和字幕里定位。

## 产物语义（继承自原 `dsh-zhiyun-study`）

- **终稿**：三阶段解析后的页面、纠错字幕、时间戳、主支线标签和块；保留全部课堂内容供检索、复核与来源跳转。
- **知识树**：从 PPT 原文抽出的章节和知识点，保留本次未讲到的节点，独立于阅读稿。
- **讲义**：主线块在知识树上的阅读投影，由讲义插件填写正文。支线与未标注块留在终稿，讲义不收录。
- **讲义终审 v2**：使用 DSH 原生 agents/subagents 整节重组，可重写章节和知识点名、拆分合并节点。原稿块 `ref` 追踪承接关系，终稿块 `src` 追踪证据；页码与时间从来源推导。

终稿与原始 PPT 知识树独立保存。存储、版本失效与互斥写入由 `npm run test:study` 覆盖。

## 验证

- `npm run test:study`：真实宿主知识库存储、账号隔离、迁移、版本失效、互斥写入与失败保留。
- `npm run test:study-host`：原生宿主 RPC、终稿阅读、课件、字幕、主题、窄屏与刷新恢复。

`src/workbench.js` 静态 import 了 `dsh-zhiyun-lecture/agent-text`（讲义文本契约），所以 `package.json` 里显式声明了这条依赖 —— 原来它是靠 profile 的 node_modules 链接才解析到的隐式依赖。
