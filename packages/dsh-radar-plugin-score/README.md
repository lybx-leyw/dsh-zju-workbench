# dsh-radar-plugin-score

> ⚠️ **候选骨架：未评审、未接入 profile、不可直接使用。**
> 由「DSH 生态雷达」自动生成（2026-10-16）。采用前请**重写**并走正常包流程。
> **不得**写进 `profiles/zhiyun-bench/package.json` 的 `dsh.profile.bundles`。

## 上游

| 项 | 值 |
| --- | --- |
| 仓库 | https://github.com/PerryLink/dsh-score |
| 许可证 | **Apache-2.0** ✅（宽松白名单） |
| 语言 | TypeScript |
| ★ | 12（⚠ 低） |
| fork | 0 |
| 最近 push | 2026-10-12 |
| 创建于 | 2026-08-17 |

上游描述：*Multi-dimensional quality scoring for DeepSeek Harness plugins: scores a repo or
npm package across install success (consuming `dsh-test-drive` results), maintenance activity,
documentation completeness…*

## 集成判定

- **类型**：**A · 原生 DSH 插件包**（最高优先）
- **关系**：**强化式集成**（✅ 鼓励）—— 不是「全新」，也不是「重复且无增益」
- **集成方式**：**锁版挂载上游 + 外围兼容层**（效法 `packages/dsh-zhiyun-paper`
  与 `packages/dsh-zhiyun-page-paper`）
- **增强哪个现有功能**：**「插件」页** `packages/dsh-zhiyun-page-plugins`（侧栏第 7 项）
- **UI 预期**：仍是**同一个「插件」面板**，**不新增导航项**、不改交互路径

### 强化式集成三条件（为什么成立）

| # | 条件 | 本包情况 |
| --- | --- | --- |
| 1 | **仍是同一个面板** | ✅ 落在既有「插件」页，不新开导航项 |
| 2 | **功能仍相似正交** | ✅ 现有页答「**关掉谁、会不会连坐**」（依赖关系图 + 行级启停开关）；本包答「**装谁、它靠不靠得住**」（安装实测 / 维护活跃度 / 文档完备度多维评分）。同属「插件管理」域，**不重叠** |
| 3 | **底层多调了更优质实现** | ✅ 本仓 22 个 bundle **零质量元数据**，完全没有评分能力；评分逻辑引入上游而非自建 |

## 尚未完成（采用前必做）

- [ ] **核实上游在 npm 上的真实包名与版本**，并**锁版**引入
  （`dependencies`，版本写死，不用 `^` —— 见 `src/upstream.js`）
- [ ] 撰写兼容层（挂载上游 + 主题注入 + 控件接管）
- [ ] **确认评分数据源可否离线**；若依赖外部 API，评估浙大网络可达性并设计降级
  （无分数时「插件」页照常可用）
- [ ] **沿用既有「插件」页的只读/写入口边界** —— 评分是只读展示，
  **不得在此新增写入口**（见 `dsh-zhiyun-page-plugins/README.md` 的「边界」一节：
  「要改开关请走 `pluginManager`，不要在这里加写入口」）
- [ ] 不改上游源码
- [ ] 补 `tests/radar-plugin-score.test.mjs`：断言「声明版本 = 实际安装 = 代码预期」三者一致
- [ ] 走 CONTRIBUTING 流程测试、接入 profile、写 `OWNERS`

## ⚠ 评审重点：上游成熟度风险

上游 ★ 仅 **12**、fork **0**、创建不足 2 个月，属**早期项目**。
这是本骨架**最需要人工判断**的一点：

- 若评审认为不成熟 → **降级为 🔵 只作参考**，不接入；
- 若认为可试 → 必须在**隔离环境**跑通，并确认其评分的**数据来源稳定性**。

雷达只负责提出「这是一个强化式集成的候选」，**是否采用由人工决定**。

## 目录

```text
packages/dsh-radar-plugin-score/
├── package.json     # dsh.bundle.patch → ./cordis.patch.yml；dependencies 锁版（待填）
├── cordis.patch.yml # - insert: [{ id: radar-plugin-score, name: dsh-radar-plugin-score }]
├── src/index.js     # 占位 + TODO（说明适配点，不写业务逻辑）
├── src/upstream.js  # 上游封装占位：锁版凭据 + 上游元信息
├── README.md        # 本文件
└── OWNERS           # Owner: shared
```

## 边界

- 候选骨架，**未评审、未接入 profile、不可直接使用**。
- **不搬运上游源码**；**不改上游源码**。
- `dsh-radar-` 前缀，避免与本仓 `dsh-zhiyun-*` 混淆。
- 纳入第三方来源记录按 [CONTRIBUTING 3.3](../../docs/contributing/CONTRIBUTING.md) 执行。
