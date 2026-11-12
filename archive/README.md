# 归档区

这里放的是**当前不参与构建、但需要保留可还原性**的东西。归档不是删除：
每个条目都写清「为什么归档」和「怎么还原」。

## deeptutor-vendor-1.6.15（76 MB）

### 是什么

上游 DeepTutor 的完整 Python 源码（`deeptutor/`、`web/`、`assets/`、`tests/` 等
1082 个文件、约 30 万行）。它原本位于
`packages/dsh-zhiyun-host-deeptutor/vendor/deeptutor/`。

### 为什么归档

2026-10-31 起，出题链路由**纯 JS 重构版**接管：

```js
// packages/dsh-zhiyun-core-study/src/quiz-engine-runtime.js
export const NATIVE_BACKEND = 'core-question';
```

重构版（`dsh-zhiyun-core-llm` / `-tool` / `-lecture-tools` / `-question`）
是对 `deep_question` 全链的逐行为重写，零第三方依赖、不启 Python 子进程。
质量对照结果：`writing_flaws 0.972`（基线 vendor 0.940）、
`shortcuts 0.933`（基线 0.933）。

vendor 因此不再参与出题，只在**回退**时才需要。

### 归档前验证过什么

1. 移除 vendor 后，`dsh-zhiyun-host-deeptutor` 插件仍能正常 `apply()`
   ——它设计上「永不因上游缺失抛错」，实测确认。
2. `status()` 如实报 `deps-missing` / `not-installed`，不编造版本号。
3. quiz 全链路测试（295 项）在无 vendor 下全绿。
4. 把目录移回原位后，`deeptutor-host` 的 14 项测试恢复全绿，
   第 ⑭ 项重新走「vendor 在仓库里」分支并断言 `ready` + 版本 `1.6.15`。

### 怎么还原

```powershell
mv archive/deeptutor-vendor-1.6.15 packages/dsh-zhiyun-host-deeptutor/vendor/deeptutor
```

再把开关改回 vendor：

```js
export const NATIVE_BACKEND = 'deeptutor';
```

两处都做完才是一次完整回退。只移目录不改开关，出题仍走重构版；
只改开关不移目录，会因缺 vendor 报 `deps-missing`。

### 注意

- `packages/dsh-zhiyun-host-deeptutor/package.json` 的 `files` 里**仍保留**
  `vendor/deeptutor/` 声明。这是有意的：移回来后无需再改清单即可打包。
- `tests/deeptutor-host.test.mjs` 第 ③、⑭ 项会自己判断 vendor 在不在，
  两种情形分别断言，不会因为 vendor 缺席就静默跳过。

## deprecated-packages/dsh-zhiyun-core-llm（305 KB）

### 为什么废弃

这个包的名字和职责都错了。

**名字**：`core-llm` 听起来像「一套 LLM 客户端」。宿主的 `dsh-llm`
（`@deepseek-ai/dsh-llm` + `dsh-llm-deepseek`）才是唯一的传输层，
它管鉴权、HTTP、SSE 解析、usage 计量、重试策略、idle watchdog、
provider 方言差异（OpenAI 兼容 / Anthropic Messages）。

**职责**：包内 4095 行里，约 3300 行在重复实现宿主已有的能力：

| 模块 | 行数 | 宿主已有 |
|---|---:|---|
| `wire.js` | 767 | `serialize()` / `createUserMessage` |
| `providers.js` | 519 | `adapters` 注册表 + `registration()` |
| `usage.js` | 360 | `_usage` / `AssistantStreamAccumulator` |
| `config.js` | 357 | `resolveCallWithInfo` / `resolveModelInfo` |
| `reasoning.js` | 255 | `reasoningEffort` 处理 |
| `messages.js` | 151 | 消息工厂 |
| `think.js` / `labels.js` / `labeled-step.js` | 987 | **宿主没有** ← 只有这部分是真需求 |

最实际的危害不是浪费代码，而是**制造了一套并行的 LLM 栈**：
2026-10-31 一整天的 `TRANSPORT` / `NO_ADAPTER` 事故，全部源于在两条栈之间
判断该用哪条、以及绕开宿主自己拼请求。

### 拆成了什么

真需求（标签协议状态机）搬进新包 **`dsh-zhiyun-core-question-stream`**：

- `labeled-step.js`（736 行）—— 流式标签路由、`finalMeta` 两态、`<think>` 前置状态机
- `labels.js`（151 行）—— 协议标签识别
- `think.js`（100 行）—— `<think>` 块跨 chunk 处理
- `usage-frame.js`（新增，约 60 行）—— 只保留三个纯形状转换函数，
  不搬 `UsageTracker` 的计价逻辑（那是客户端的职责，宿主已做）

新包**不发起任何 HTTP 请求**：所有传输由调用方注入的 `client.prepareCall()` 完成
（生产环境即 `pool.base.llm`，宿主的 `LlmRuntime`）。

### 同时删掉的兜底

`core-question-backend.js` 里原来有一条「没有宿主就自建 client」的兜底，
已删除改为明确抛 `NOT_WIRED`。理由：偷偷走另一条 HTTP 栈，
会让「界面选的模型」和「实际调用的模型」可能不是同一个，且失败信息无法归因。

### 怎么还原

不打算还原。若确需对照旧实现：

```powershell
mv archive/deprecated-packages/dsh-zhiyun-core-llm packages/
```

## deprecated-packages/dsh-zhiyun-page-classroom + dsh-zhiyun-host-openmaic

### 是什么

一套完整的**旧课堂方案**：

| 包 | 作用 |
|---|---|
| `host-openmaic` | 把上游 OpenMAIC 整站（Next.js）跑起来，含 PostgreSQL 依赖 |
| `page-classroom` | 用同源 iframe 承载那个整站，UI 与上游一致 |

### 为什么归档

2026-10-31 起，课堂功能由**重构版**接管：

| 新包 | 职责 |
|---|---|
| `page-classroom-build` | brief → 可编辑大纲 → 流式生成 |
| `page-classroom-play` | 场景进度条 + 舞台 + 控制条 |
| `core-classroom-stage` | 账本 / 时间轴 / 白板动作重放 |
| （另 10 个 core-classroom-* 领域包） | |

旧方案与新版**并存但互不相通**，是典型的「各管一半」：

1. `page-classroom` 注册的 slot 是 `zhiyun.classroom.content`
2. 而 NAV 现在找的是 `zhiyun.classroom.play`
3. 两个包都不在 `profiles/zhiyun-bench/package.json` 的 bundles 里
4. 没有任何包依赖它们

**slot 名对不上，加载了也不会显示。** 两个包已被 AI 标了 `DETACHED.md`（未接入）。

### 归档前验证过什么

1. 全仓无任何包依赖这两个包（grep 所有 package.json）
2. 5 个测试文件引用的是 `page-classroom-build` / `page-classroom-play`，
   **没有一处**引用 `page-classroom`
3. `css-order.test.mjs` 的包清单里也没有它们
4. 从 profile 移除后 `npm install` 与构建均通过

### 注意：vendor 目录留在本地

`host-openmaic/vendor/` 有 **18.9 万个文件**（上游整站源码 + node_modules + .next
构建产物），被 `.gitignore` 排除，**从未进入 git**。

所以本次归档只移动了 git 跟踪的 16 个源码文件。本地那份 vendor 因为进程占用
（`Device or resource busy`）没能一起移走，留在 `packages/dsh-zhiyun-host-openmaic/vendor/`。

**这不影响仓库状态** —— git 里它本来就不存在，任何人都不会 clone 到它。
需要时可以直接删除该目录回收磁盘；要恢复旧方案则按下面步骤。

### 怎么还原

```powershell
# 1. 把源码移回
git mv archive/deprecated-packages/dsh-zhiyun-host-openmaic packages/dsh-zhiyun-host-openmaic
git mv archive/deprecated-packages/dsh-zhiyun-page-classroom packages/dsh-zhiyun-page-classroom

# 2. 删掉 DETACHED.md 标记
Remove-Item packages/dsh-zhiyun-host-openmaic/DETACHED.md -ErrorAction SilentlyContinue
Remove-Item packages/dsh-zhiyun-page-classroom/DETACHED.md -ErrorAction SilentlyContinue

# 3. 按 DETACHED.md 里「要重新接进来时」那 5 步做
```

### 还差什么才能真的用起来

`DETACHED.md` 里写明了两条硬前置，当时没解决：

1. **PostgreSQL 是手工起的便携版**，不在宿主生命周期里。换机器或重启后
   页面会报 `no-database`
2. 上游构建**必须**带 `ALLOWED_FRAME_ANCESTORS`，它在 `next.config.ts` 的
   `headers()` 里构建期求值、写死进 `routes-manifest.json`。少了它 iframe 一定
   被 CSP 拦，**运行时不报错，只表现为白屏**

这两条决定了它不是「开箱可用」的方案，也是被重构版取代的原因之一。

## deprecated-packages/dsh-zhiyun-source-bilibili

### 是什么

B 站视频数据源：把一条 B 站视频解析成与智云课堂同形状的 `{ slides, subtitles }`，
供 `ctx.zhiyunParser.parse()` 直接消费。15 个源文件，含 WBI 签名、字幕轨、
分段拉流、抽帧、triage 分流。

### 为什么归档

**它从未完成、也从未接进 profile** —— `package.json` 的 description 自己写着
「未完成、未接入 profile」。它不在 `profiles/zju-workbench/package.json` 的
bundles 里，也不在 `scripts/build.mjs` 的 `CLIENT_PACKAGES` 里，没有任何别的包
import 它。

2026-11-06 的全仓自底向上重构在整理 `packages/source/` 时把它移出产品树：
一个没有入口、没有消费方、自述「未完成」的包留在 `packages/` 里，
只会让「哪些包真的在产品里」这个问题每年都要重新回答一次。

### 代码仍然可用，但测试已删除

归档**不是删除**，源码就在本机归档区里，WBI 签名、字幕切分、错误码分类、
抽帧与 playurl 这些纯逻辑都还在正常工作。

但 `tests/bilibili-source.test.mjs` 已随 2026-11-11 的测试分层整理**删除**，
原因有两条，任一条都足以让它永远红：

1. **归档区在 `.gitignore` 里**（`/archive/*/`）。新 clone 上根本没有
   `archive/deprecated-packages/dsh-zhiyun-source-bilibili/`，
   那份测试的 20 个 import 全部解析不到，整个文件在加载期就崩。
2. 它守的是一个**从没进过仓库、也从未接进 profile** 的包：`package.json` 自述
   「未完成、未接入 profile」，没有任何消费方。一条永远跑不起来的测试不算覆盖，
   只会让 `npm test` 常态变红、训练人忽略红色。

要重新启用这个包时，把下面第 3 步补上就是一份新测试 —— 按现在的新布局放到
`tests/source/bilibili/bilibili-source.test.mjs`。

### 怎么还原

```bash
# 1. 搬回产品树
mv archive/deprecated-packages/dsh-zhiyun-source-bilibili packages/source/bilibili

# 2. 校验它还能跑（包内的纯函数没有外部依赖）
node -e "import('./packages/source/bilibili/src/wbi.js').then(m=>console.log(Object.keys(m)))"

# 3. 写一份新的契约测试放到 tests/source/bilibili/
#    （旧文件可用 git 历史找回：git log --all --diff-filter=D -- tests/bilibili-source.test.mjs）

# 4. 接进 profile（如果要让它真的加载）
#    profiles/zju-workbench/package.json 的 bundles 追加新包名
```

### 要真能用还差什么

它的产出形状与智云课堂对齐，但**没有经过 `zhiyunParser` 的端到端验证**——
当时只做到「能解析出 slides/subtitles」，没做到「能驱动那个解析器跑完一节课」。
另外 B 站需要 WBI 签名（已实现）与可选的登录 cookie（字幕轨才需要），
这两条在真实视频上的长期稳定性没有实测记录。


## dsh-zju-shell-workbench / -shell-bridge（产品界面外壳）

### 是什么

两个**产品外观与外壳**包，2026-11 一并归档。

| 包 | 职责 | 规模 |
| --- | --- | --- |
| `dsh-zju-shell-workbench` | 侧栏 / 页框架 / 主题 / 导航服务 `zwNavigation` / 11 个页面目录 | 10 个源文件，约 40 KB |
| `dsh-zju-shell-bridge` | 产品背景样式 + 原生首页 slogan 替换 | 5 个源文件，约 12 KB |

`shell-workbench` 的 `NAV` 原先定义整条导轨：

```
today 今天 · paper 论文 · study 学习 · classroom 课堂 · classroom-build 生成
quiz 题库 · planning 规划 · notes 笔记 · plugins 插件 · docs 文档 · feedback 反馈
```

### 为什么归档

profile 在「Step 1 瘦身」后收敛成 **4 个宿主包 + 4 个数据源包**，不含任何页面包，
因此这两个包的运行时消费者为零：

- `zwNavigation` 的 5 个调用方（`core-study`、`page-paper`、
  `page-classroom-build`、`ui-shared/page-registration`、`radar-section-deeplink`）
  全部随页面包一起不在 profile 里；
- 页面外壳改由 profile 直接挂载的 `@lybx-leyw/dsh-pages` 提供 ——
  `shell-bridge` 早就因此退化成「背景 + slogan」；
- 结果是界面为**纯原生 DSH**，两侧导轨一条都不渲染。

### 归档前做了什么

1. **先把 `model.js` 的纯函数拆出去**，搬到
   `packages/client/ui-shared/src/pages-model.js`。
   它是零 import、零副作用的纯数据 + 纯函数（页面目录、插槽名、可见性判定、
   北京日期），被 4 个测试与 2 个脚本用于断言 —— 那些断言**不依赖外壳存在**。
2. 统计并处理了全部 14 处引用：
   - 读 `model.js` 的 → 改指 `ui-shared/src/pages-model.js`（5 处）；
   - 测**通用纪律**的（控件尺寸、学习空间识别、设置浮窗桥接纯函数）→
     改指归档副本，断言保留（4 个测试，16 项断言）；
   - 测**已退休实现本身**的（slogan 文案、桥接包自身）→ 删除
     （`hero-copy.test.mjs`、`shell-bridge.test.mjs`）；
   - `publish-guard` 里「桥接包不许重复声明页面壳」改为检查归档副本，
     约束本身保留。
3. 归档后 `tests/profile.test.mjs`（15 项）、`control-ergonomics`（8 项）、
   `learning-space`（5 项）、`settings-adapter` / `settings-opener` 全绿。

### 怎么还原

```bash
# 1. 搬回产品树
git mv archive/deprecated-packages/dsh-zju-shell-workbench packages/
git mv archive/deprecated-packages/dsh-zju-shell-bridge   packages/

# 2. 恢复 model.js（归档副本里已替换成指针说明）
git show HEAD~1:packages/dsh-zju-shell-workbench/src/model.js \
  > packages/dsh-zju-shell-workbench/src/model.js

# 3. 测试与脚本的 import 改回原路径
#    pages-model.js -> dsh-zju-shell-workbench/src/model.js
#    影响的文件：tests/{profile,feedback,paper,plugins-page}.test.mjs、
#                scripts/test-host.mjs、scripts/knowledge_tree_bench/_base.mjs

# 4. 接进 profile（外壳要真加载，页面包也得一起回来）
#    profiles/zju-workbench/package.json 的 bundles 追加两个包名
#    —— 但只有外壳没有页面包时，导轨是空的，实际意义不大
```

### 要真能用还差什么

**只剩外壳是没用的。** `NAV` 里有 11 个页面，而对应页面包
（`page-today` / `page-paper` / `page-study` / `page-quiz` / `page-planning` /
`page-notes` / `page-plugins` / `page-docs` / `page-feedback` /
`page-classroom` / `page-classroom-build`）**全部不在 profile 里**。
要恢复完整产品界面，得把这些包连同它们的依赖
（`core-study` / `core-quiz` / `core-notes` / `host-paper` 等）一并接回。

换句话说：归档这两个包是**顺着已有事实做的整理**，不是新的产品决定。
真要把产品界面接回来，是一次范围更大的装配决策。

### 顺带记录一个测试教训

`tests/profile.test.mjs` 曾断言「profile 里必须有 `dsh-zju-shell-workbench` 的链接」。
这个包在 Step 1 就离开 profile 了，但断言**一直没红** —— 因为包目录还在仓库里，
`realpath` 能解析到源码。直到本轮把它移进 `archive/`，才暴露出这条断言早已过期。

> 教训：**断言具体包名时，要同时想清楚「这个包退役后这条断言怎么死」。**
> 已改成从模板取一个当前真实在 profile 里的包做样例。


## deprecated-packages 第二批（2026-11-07，遗留 hosts 清理）

一次清掉 6 个「从未装配、且能力已被重构版取代」的包。判据不是凭印象，
而是先把 11 个剩余包的依赖图与服务面全量拉出来：

- 11 个包**全部没有上游依赖**（没有别的包 import 它们），只能靠 profile 直接装配；
- 逐个核对它们在 profile 里的状态 —— 全部未装配；
- 逐个核对它们的服务提供者关系 —— 只有 `quiz-lab` / `host-classroom` 落在真实链路上。

### 一、直接删除（archive 里已有同名副本）

| 包 | 证据 |
| --- | --- |
| `dsh-zhiyun-host-openmaic` | 见上文第 115 行那节：它早已归档。`packages/` 里的这份是**重复副本**（含 `DETACHED.md`、`vendor/`、`upstream.lock.json`） |
| `dsh-zhiyun-page-classroom` | 同上。它是 openmaic 整站 iframe 版，整页依赖 `/zhiyun-openmaic/*` 路由；与 `host-openmaic` 是同一对 |

> 这两份是「归档后又从别处拷贝回来」的残留。删之前核对了文件结构与 archive 版一致。

### 二、新归档

| 包 | 是什么 | 为什么归档 |
| --- | --- | --- |
| `dsh-zhiyun-host-deeptutor` | 上游 DeepTutor 的宿主桥：`python/` 运行时桥、`distribution.json`、能力五态目录 | 出题能力已由纯 JS 重构版接管（`core-question` / `core-quiz` 的 `r4` / `core-llm`）。它的 vendor 早在 `deeptutor-vendor-1.6.15` 就归档了，包里只剩没有调用方的桥 |
| `dsh-zhiyun-host-bridge` | 局域网桥 + 规划快照（把本机规划整理成手机能读的 JSON） | package.json 描述自己写着「**尚未挂进 profile**」；只有 2 个源文件、无 README；无任何引用方 |
| `dsh-zhiyun-host-office` | `dsh-univer-office` 接入层（表格/文档/幻灯片/多维表格） | 11 个页面**无一涉及 Office**，无消费方 |
| `dsh-zhiyun-settings-account` | 头像登录对话框 + 「账号与数据」设置分区 | 账号面板占位，从未装配 |

### 三、连同归档的测试

| 测试 | 随谁归档 | 说明 |
| --- | --- | --- |
| `deeptutor-bridge.test.mjs`（692 行） | host-deeptutor | 直接 `import` 包的 `src/protocol.js`、`src/runtime.js` |
| `deeptutor-host.test.mjs`（457 行） | 同上 | 读 `PACKAGE_DIR` 做锁版/状态断言 |
| `deeptutor-integration.test.mjs`（127 行） | 同上 | `src/models.js`、`src/wire-options.js` |
| `deeptutor-service.test.mjs`（1424 行） | 同上 | `src/service.js`、`src/capabilities.js` |
| `learning-resource.test.mjs`（753 行） | 同上 | ⚠ 见下方「遗留缺口」 |
| `univer-office.test.mjs` | host-office | 直接删（无还原价值：Office 接入整体废弃） |

它们在 `archive/deprecated-packages/dsh-zhiyun-host-deeptutor/tests/`。
**还原时要一起挪回 `tests/`** —— 它们是「回退是否成功」的判据，不是可选项。

### 四、遗留缺口（重要）

`learning-resource.test.mjs` 是**混合测试**：

- 前三条（`validate()` 的 JSON Pointer 定位、`contentHash` 键序不敏感、`project()` 锚点反查）
  测的是**契约**，重构版 `packages/core/learning-resource` 也实现了这些能力；
- 第四条（`createResourceRegistry` 先校验再落盘）只存在于 deeptutor 版。

它此前已经**跑不起来**（import 路径随包移走而失效），所以归档不损失任何现有覆盖。
但要注意：

> `@lybx-leyw/dsh-zju-core-learning-resource` **目前未装配**，也**没有对应的契约测试**。
> 将来要启用学习资源时，必须把前三条断言按 core 版的 API（`revisionOf` 而非 `revisionFor`）
> 重建一份 —— 否则「缓存键算错」「锚点被吞」这两类悄悄错没有任何守卫。

### 五、怎么还原

```powershell
# 1. 包搬回原位
mv archive/deprecated-packages/dsh-zhiyun-host-deeptutor packages/
mv archive/deprecated-packages/dsh-zhiyun-host-bridge packages/
mv archive/deprecated-packages/dsh-zhiyun-host-office packages/
mv archive/deprecated-packages/dsh-zhiyun-settings-account packages/

# 2. 测试搬回
mv archive/deprecated-packages/dsh-zhiyun-host-deeptutor/tests/*.test.mjs tests/

# 3. 两处清单补回（**少一处就构建失败**）
#    scripts/build.mjs 的 CLIENT_PACKAGES → 补 'dsh-zhiyun-settings-account'
#    tests/css-order.test.mjs 的包列表   → 补 'dsh-zhiyun-settings-account'

# 4. 重建 profile 链接
node scripts/profile.mjs init
```

### 六、验证过什么

- 归档后 `npm run build`（`scripts/build.mjs`）全绿；
- profile 启动**零 skipping / 零 pending**；
- 11 个页面全部渲染出内容，`POST /api/zhiyun-study` 返回 200；
- `tests/css-order.test.mjs` 18/18、`tests/vendor-fetch.test.mjs` 通过
  （后者的锁文件断言改成读 archive 路径，断言内容一字未动）。


## deprecated-packages/dsh-zhiyun-classroom-dsl（84 文件）

### 是什么

上游 `@openmaic/dsl@0.12.0` 的构建产物原样 vendored：Slide JSON 的 JSON Schema、
纯校验器、版本/迁移助手。本包 `src/index.js` 只有一行 —— `export * from '../vendor/dsl/index.js'`。

### 为什么归档

**全仓 `import 'dsh-zhiyun-classroom-dsl'` 命中 0 处。**

它唯一的痕迹是 `classroom-renderer` 的 `dependencies` 声明，但 renderer 的源码不引用它：

```js
// packages/dsh-zhiyun-classroom-renderer/src/view/slide.jsx
import React from 'react';
import katex from 'katex';          // 只有这两个
```

成因：2026-10-31 renderer 从「vendor 上游」改成「自研 4 类元素」时，
依赖清单没跟着清（这个时间点见 renderer 自己 `src/index.js` 的头注）。

另外两条候选消费者也都不用它：

- `core/classroom-generate` 生成幻灯片时用自己的 `validateSlideDeck`
  （`src/html-slide-shell.js`），不走上游 schema；
- `core/classroom-stage` 用的是 `classroom-geometry`（另一个包），不是 dsl。

> 对照：**`classroom-geometry` 保留**。它被 `core/classroom-stage/src/geometry.js`
> 的 `validateShapeGeometry` 真实调用，而 stage 已装配。

### 同时做的清理

| 位置 | 改动 |
| --- | --- |
| `packages/dsh-zhiyun-classroom-renderer/package.json` | `dependencies` 摘掉 `"dsh-zhiyun-classroom-dsl": "0.1.0"` |
| `tests/build-seeds.test.mjs` | 从「允许无客户端产物」的例外清单里移除该条目 |
| `tests/classroom-dsl-vendor.test.mjs`（179 行） | 随包移到 `archive/deprecated-packages/dsh-zhiyun-classroom-dsl/tests/` |

### 怎么还原

```powershell
mv archive/deprecated-packages/dsh-zhiyun-classroom-dsl packages/
mv archive/deprecated-packages/dsh-zhiyun-classroom-dsl/tests/*.test.mjs tests/
# 然后把 renderer 的 dependencies 与 build-seeds 的例外清单各补回一行
node scripts/profile.mjs init
```

### 已验证

- `scripts/build.mjs` 全绿（renderer 的客户端产物照常生成，487 KB）；
- `tests/build-seeds.test.mjs` 4/4。
