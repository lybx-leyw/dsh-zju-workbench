# 智云课堂解析器

从 Flutter `lib/fusion/` 移植的独立 Cordis 插件。profile 自动加载并提供 `ctx.zhiyunParser`。所有模型调用直接使用宿主 `ctx.llm`；图片由 `ctx.attachments` 持久化与校验。没有独立 API key、模型 HTTP 客户端或另一套 agent runtime。

```js
export const inject = ['zhiyunClassroom', 'zhiyunParser'];
export async function apply(ctx) {
  // 登录交给数据源与产品账号流程，不自动读取开发凭证。
  const result = await ctx.zhiyunParser.parseClassroom(courseId, subId, {
    context: '课程名 · 节次', signal, onProgress: progress => { /* 更新进度 */ }
  });
}
```

也可以调用 `parse({ slides, subtitles, sourceId, context, signal, onProgress })`，独立验证解析器。每页需要 `page`、`createdSec` 及 `imageBytes` / `imagePath` / 智云资源 `imageUrl` 之一；字幕是 `{startMs,endMs,text}`，时间单位为毫秒。

## 流水线形状：一个队列，N 个 worker

`docs/show/zhiyun-pipeline.html` 是这条流水线的**可执行规格**。代码按它的顺序落：

```
                 ┌──────────── 共享 FIFO（有上限，背压）────────────┐
   4 页拼图 → vision 产块 ─┐                                     ├─→ mix 逐块打标
   4 页拼图 → vision 产块 ─┼─→ [ 页, 页, 页, … ] ─────────────────┘   （N 个 worker 共享）
   4 页拼图 → vision 产块 ─┘
                            ↓
        ③ 建树：筛支线 → 挂账 → 正交审查 → 并发合并
        ④ 重构：拆叶 → 重聚知识点叶 → 分级聚合
```

- **vision 与 mix 并行**，不是"先全部识别再全部标记"。生产者跑 vision（每批 4 页拼一张图），把**页**推进队列；消费者从队列取页做 mix。队列里放的是"页"而不是"批"—— 放批的话消费者要等这一批 vision 全做完才能开工，那还是串行。
- **影响速度的有且只有一次性并发数**（`concurrency`）：一门课和四门课在调度器眼里只是"队列里工作量不同"。
- **背压**：`queueCapacity` 是未消费项的上限。vision 产得比 mix 快时**产的那一侧等**，而不是把内存吃满。
- 生产端也并发（否则 vision 一次只有一个调用在飞，全局额度白空着）。
- **`visionBatchSize` 决定流水线的"启动延迟"**：一个拼图批次是最小产出单位，mix 要等**第一批** vision 回来才能开工（4 页一批 ≈ 4 页的识别时间；1 页一批则第一页回来就开始）。批越小启动越快、但 vision 调用次数越多。实测（8 页 / 4 worker）：批 4 时首个 mix 在 311ms，批 2 时在 217ms。

## mix同次标记与正式语言组织

mix每页同一次调用返回逐句clean转录稿、块区间及role/facets/summary，不再有流水线结束后的独立tags调用。缺少标记或JSON不合法时，在该页mix内重试；旧缓存只有同时通过纠错、覆盖和标记校验才可复用。

建树时先筛支线和元信息，再按叶并发执行merge正式语言组织，之后切分、摊平和重聚。块的sentences保留逐句clean转录；sourceText保存正式组织前正文，text为正式正文，register标记written或draft。重构和讲义优先使用text；组织失败进入mergeFailures并使产物为partial，不得称为正式完成。书面化要求明确对象、符号、条件、因果和指代，不能用删除口语词代替。

## 建树与重构（不做判定的地方绝不判定）

- **筛支线**：`role === '支线'` 与元信息（教学安排/作业）进 `board`（大黑板），**不进树**。元信息判据优先于宿主判据 —— 同时标「概念」和「教学安排」的块更像"安排"。
- **挂账**：主线块按页挂到叶上，只累加 token 与块数，**永不真合并**。批次阶段做判定等于在信息不全时做决定。
- **依附块不走宿主正文**：例题/案例/实验/故事进 `leaf.attach`，真合并时挂成子叶。这是"例题不会被压没"的根本原因 —— 它压根不在正文那一堆里。
- **正交审查**：只合并**直接连叶**的同名标题（越往上越是"章"这种粗粒度名字，同名很正常）。合并后叶的块集合互不相交，所以并发合并**不需要锁**。
- **斩杀线按 token 算**（`splitLine`，默认 1200），不按块数：块数表示"几段"，长度却参差不齐。超线就长成叶树，切分是**长尾**的（Zipf），所以层数自然出来（2–4 层）而不是永远一层。
- **拆叶**：叶树每一层的小标题全部作废，只留最深层的叶；依附叶一并摊平（它同样是内容）。
- **重聚**：摊平出来的是内容段，不是知识点。按斩杀线并回"一片叶 = 一个知识点" —— 否则重建出来的树会"叶比知识点多三倍"。

产物里的 `tree` / `treeStats` / `board` / `knowledgePoints` / `leafTrees` / `mergeStats` / `pipeline` 就是上面这几步的如实结果与统计。

执行顺序为vision与mix并发（mix同时纠错、分块和标记），再生成整节主线、建树并执行merge正式组织与重构。mix后续不重复上传图片；原始逐句来源始终保留。

课件描述默认每组最多 **4 页**，以 2×2 原尺寸拼图发送，按原课件页码拆回独立的页面文字、画面与术语。剩余 2–3 页仍拼图，单页直接发送；已有单图缓存继续复用，只把未缓存的页拼在一起。`concurrency` 限制的是模型请求数，默认三个组可同时处理最多十二页，混合解析也使用同一并发闸。拼图不主动缩小原图，超过宿主默认 4194304 像素预算则退回单图。图片构建由插件声明的 `sharp` 依赖完成，模型及附件仍全部使用原生 DSH 服务。

拼图响应若缺页、重复页码、缺少段落或发生超时/截断，会对受影响的页单图补发；正常页照常保留，回退原因记入 `warnings`。一张损坏图片不会让邻页字幕丢失。拼图与单图缓存分开保存；可配置 `visionBatchSize: 1` 完整退回原单图路径（支持 1–4，默认 4）。这项优化允许视觉细节有一定损失，未改变终稿、讲义及字幕来源语义。

句子层分两处：`sentences` 是**页内**句子（块层的坐标基准），`unassignedSentences` 是没落到任何一页上的字幕 —— 它们没有页，所以没有图可以对照纠错、也不进块层与标注，但内容一句不丢；有它们时产物标为 `partial`。块永远只覆盖页内句子。

标记在每页mix中与纠错和分块一起返回，所有页共享开跑时加载的词表快照；只有JSON、角色、类型和概述均完整才缓存该页。失败信息按页保留在tagFailures中。整节主线仍单独生成，并机械剔除越界和重叠区间。

混合解析每页最多 3 轮；纠错被拒与块覆盖违规在同一个循环里收敛，重试提示会逐条点名被拒条目与违规区间。**只有收敛的回包才进缓存**：未收敛的页不固化，用户「重新整理」时那一页才会真的重试（这一处与 App 的段缓存策略不同，理由见迁移记录）。

纠错采用 JS 的宽松策略：比较时先做 Unicode NFKC 归一化（含全半角和上下标字符），排除空白、零宽空格，并统一等价引号、句号、减号和分数斜线；展示时保留模型输出的排版。实质编辑距离上限由 App 的 50% / 30 字放宽为原句的 **80% / 80 字**，允许结合课件恢复严重听错的公式和术语，仍不允许无依据补写或改变句子来源。`correctionDistance` 为排除格式差异后的距离；被拒记录同时保存 `rawEditDistance`。原始 App 提示词基线保留，构造请求时同步应用新策略。旧策略下成功的混合解析缓存经新规则复核后复用，失败页继续重试。

公式比较也识别 LaTeX 数学定界符、常用希腊字母与算符命令、排版空白、字体包装和上下标，与等价 Unicode 写法比较；未知命令保留，不会随意吞掉数学内容。单句块的 `块 21` 与 `块 21-21` 等价，仍须通过完整覆盖检查。

默认跟随 DSH 当前模型的 provider/model，但不继承聊天的推理档位。视觉模型必须明确支持 image；否则开跑前抛 `VISION_MODEL`。可用用户 profile overlay 单独选择视觉与文本路由（凭据仍在宿主模型设置中）：

```yaml
- id: zhiyun-parser
  config:
    concurrency: 3
    visionBatchSize: 4
    vision:
      provider: your-host-provider
      model: your-host-vision-model
    text:
      provider: your-host-provider
      model: your-host-text-model
```

可选字段 `reasoningEffort`、`maxTokens` 使用 DSH 自己的契约，不转译为供应商私有参数。未指定 reasoningEffort 时，优先选模型声明的 none/off/disabled；没有此档位则由宿主决定。宿主流截断、空响应或异常均不进入成功缓存。

拼图沿用视觉路由与 `accel.faithful` 的输出预算，未配置时由宿主决定；密集页面可在模型支持时配置 `accel.faithful.maxTokens: 32768`，减少整组截断后补发的次数。

### 加速档位 `accel`

按阶段配置，**没给的字段一个都不发送**（由宿主决定默认值），所以不配 `accel` 时发出的请求与不加速逐字段相同：

```yaml
- id: zhiyun-parser
  config:
    accel:
      faithful: { maxTokens: 32768 }        # 看图阶段
      mix: { maxTokens: 32768, reasoningEffort: low }
      tags: { maxTokens: 4096, reasoningEffort: low }
      outline: {}                           # 打开了这一格但没配字段 = 与不配等价
      escalation: { maxTokens: 60000 }      # 撞上输出上限时的升档预算
```

`maxTokens: 0` = 不传该字段。写错的档位名或字段**在开跑前报错**（`CONFIG`），不猜一个近似值 —— 静默换档位会让「我明明设了 low 为什么很慢」永远查不出来。

`escalation`：某次调用以宿主 `finish.reason.kind === 'max-tokens'` 结束时，按升档预算重试**恰好一次**（默认倍数 2、硬顶 131072）；仍截断就走原来的 `TRUNCATED` 失败路径。只配了 `escalation` 而没有阶段档位也能生效：升档预算作为该阶段重试时的预算下限（绝不下调已有预算），`ceiling` 是硬顶上限（必须 ≥ 升档预算，否则开跑前报错）。**抬不动就不重试** —— 预算已到硬顶、或升档档位与现值相同时请求根本没变，重发只会白花一次调用。没配升档预算时同样不重试。

### 词表持久化

`vocabularyStore` 是词表落盘的口子（`{ load(), save(vocabulary) }`），插件默认用 `<profile>/data/zhiyun-parser/vocabulary.json`，落盘走宿主 `@deepseek-ai/dsh-atomic-write`。解析开跑前 `load()` 一次作为种子，解析结束后**只在真的有新增标签时** `save()` 一次；同一节的所有mix页共享加载后那一份快照，因此词表变了旧标注就不会再命中缓存。`load()` 抛错或数据损坏**不会**让解析失败：退回种子词表，原因同时进 `warnings` 与 `parser.loadIssues`，不静默当成「这次没有新增词」。解析失败时会保留已经提名的新标签，**取消时不写盘**（用户按了停，就不在磁盘上留下他没收下的东西）。

缓存位于独立 profile 的 `data/zhiyun-parser/cache`，绑定模型路由、提示词、图片内容、原字幕和时间。缓存含课程转述与文字，属于用户数据。`dispose()` 会取消本插件所有任务，Cordis 卸载自动调用。

`parseClassroom` 默认要求课件和字幕均确认收全；可显式传 `allowPartialSource: true` 调试未完成数据，结果仍标记部分完成。截图过滤是结果上的 gate 元数据，不丢弃其对应字幕。逐页失败不会抹掉其他页的有效结果。

验证命令：`npm run test:parser`、`npm run parser:verify`、`npm run parser:parity`。最后一个需要相邻 Flutter 仓库和 Dart SDK，仅运行纯 Dart 契约导出，不运行 Flutter 全量测试。

## 多供应商 worker 池

`createRun({ workers })` 从宿主适配器建立本次任务的 worker 池，复用相同的 v4 算法、缓存、词表与数据源。配额按供应商合计，所有阶段共用；图片只派给支持图片的模型。队列会跳过当前无合适空位的请求，让其他空闲供应商继续处理工作；取消时移除排队项。缓存身份绑定整个可用模型池及配额，实际请求仍由 HarnessLlm 构造。
