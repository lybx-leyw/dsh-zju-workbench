# dsh-radar-study-chart

> ⚠️ **候选骨架：未评审、未接入 profile、不可直接使用。**
> 这里只有占位代码，`apply()` 恒返回 `ok: false`，`invokeShowChart()` 直接抛错。
> 它的唯一作用是：把「这个上游锁得住 + 这个位置是空的」这件事固化成可评审的脚手架。

## 集成性质：**强化式集成**（三条判据**全部成立**）

按 skill 的三条判据逐条核对：

| 判据 | 结论 | 依据 |
| --- | --- | --- |
| ① **仍是同一个面板** | ✅ | 落点是「题库」页**已有**的作答历史区（`page-quiz/src/question-history.jsx`）与「学习」页已有的进度区（`page-study/src/study-workspace.jsx`）。**不新建页面、不新建导航项。** |
| ② **功能仍相似正交** | ✅ | 仍是「作答正确率 / 掌握度」这一件事，只是从**逐条文字**升级为**时间序列图**。不引入新的功能域。 |
| ③ **底层多调了更优质实现** | ✅ | 上游提供 `show_chart` 工具 + recharts 内联渲染（8 色分类调色板、明暗双主题色觉分离校验）。本仓目前**连图表库都没有**，要从零写。 |

## 现状实测（为什么这块是空的）

| 事实 | 位置 | 说明 |
| --- | --- | --- |
| 无图表库 | `classroom-renderer/package.json` | deps 只有 `katex@0.16.38` |
| 图表被显式排除 | `classroom-renderer/src/view/slide.jsx:7` | 自述「产品实际只用到 4 类」，chart 不在内 |
| 注释里的 echarts 不算实现 | `core-classroom-stage/src/client.jsx:192` | 「图表与公式**不在这里**实现渲染器」 |
| 作答历史只有文字 | `page-quiz/src/question-history.jsx:20` | `作答：… · 掌握/待复习/已记录`，**无正确率、无趋势** |
| 评分不跨次聚合 | `core-study/src/grading.js` | 只有 `buildAttempt()` 单次判定，无 `accuracy` / 时间序列 |

⇒ 本仓**没有**可复用的图表渲染，也**没有**正确率时间序列。这不是「重复集成」，
而是既有面板**缺一块统计视图**。

## 上游锁版事实（npm 实测）

| 项 | 值 |
| --- | --- |
| 包名 / 版本 | `dsh-chart@0.5.0`（历史仅 0.1.0 / 0.2.0 / 0.5.0） |
| 解压体积 | **23,264 B**（22.7 KB） |
| 运行时 `dependencies` | 无（recharts 构建期内联进客户端 bundle） |
| `peerDependencies` | `@deepseek-ai/dsh-tools: "*"` —— 通配，无版本冲突 |
| DSH 插件形态 | **A 类**：`dsh.bundle.patch = ./cordis.patch.yml`，`dsh.client.platform = "web"` |
| 上游 patch | `insert: [{ id: chart, name: dsh-chart }]` |
| 许可证 | MIT ✅ |

## 与在册图表候选的区别

| 候选 | 形态 | 判定 |
| --- | --- | --- |
| `lxfu1/dsh-plugin-chart`（registry 🔵） | AntV 底座的**独立图表面板** | 判据①不成立（新建面板） |
| `Max-Samson/dsh-usage-chart` 及用量簇（registry ⛔） | token 用量 / 成本 | 与学习无关 |
| **本包** | 复用上游 `show_chart` 给**既有**题库统计供数 | 三条判据全成立 |

## 风险 / 评审阻塞项

1. **面板内嵌不在上游 slot 范围内。** 上游客户端只注册 `tool.call.toolview`（聊天工具行）
   与 `conversation.chat.turnTail`（回合末尾）。要让图出现在**题库页面板里**，
   需要另找挂点或自己做一层外壳 —— **这一条未解决前不得声称「已接入面板」**。
2. **真正的工作量是数据聚合，不是画图。** `attemptSeries(attempts, { bucket })` 要先写好，
   且分母口径（只算已判定 / 含未判定）必须先定死，否则正确率会随时间虚高。
3. `MAX_POINTS = 100`：一学期 attempt 数很容易超过。必须**在本地先聚合再传**，
   上游只会降级不会聚合。
4. 中文标签宽度、8 色调色板在浅色主题下的对比度**未验**。

## 文件

| 文件 | 作用 |
| --- | --- |
| `package.json` | 锁版 `dsh-chart@0.5.0`（写死，不用 `^`） |
| `cordis.patch.yml` | 以本包 id 插一条，避免与上游 `id: chart` 冲突 |
| `src/index.js` | 落位与聚合 TODO |
| `src/upstream.js` | 上游封装占位（双半包契约） |
