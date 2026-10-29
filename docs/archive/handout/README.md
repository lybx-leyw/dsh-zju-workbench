# 讲义 ⇄ 笔记库联动：交付交接单

> **状态：实现到一半，记录被叫停。** 本文是交接用的临时材料，不是仓库文档。
>
> **⚠️ 完成全部规划后请归档此文件夹**（整个 `tmp-handoff-handout/` 目录）。
> 它是过程产物，不该跟着代码一起留在这份仓库里。建议归档方式：移到 `docs/archive/`、
> 或直接删除（内容已在实现与本目录各处留下痕迹）。归档/删除前请先确认其中的「待您决策」都已处理。

日期：2026-02（会话 g-mvt12jsjhc9t）
仓库：zhiyun-pro-js ／ profile：zhiyun-bench

---

## 一、一句话现状

新插件包 `packages/dsh-zhiyun-core-handout/` 已经建好，编解码、版本对、宿主服务三块**已实现且 60 条测试全绿**；笔记库的归档拆分（`page-notes`）也已改完并测试通过。剩下的读取路径、生成钩子、版本面板 UI、四处登记、回归报告**未动**。

系统里的进度记录停在 4/10：第 5 步的实物与测试都就位，但记录通路反复返回「outcome is unknown」，被您叫停，故不再推进。

---

## 二、核心设计（这是关键，改代码前先读这段）

### 2.1 两套真源，各管一件事

| | 位置 | 谁读它 |
|---|---|---|
| 用户读的讲义 | 笔记库 `课程/节次.md` | 学习页讲义阅读器、讲义检索 |
| AI 基线 | 知识记录 `record.lecture` | 出题、知识点导航、「隐藏我的更改」 |

两边的正文**一开始是同一份**（生成时由基线编码而来），之后**只有 md 会变**。基线不被用户改动，所以它永远能当「原版」用。

为什么不让 `record.lecture` 继续兼任正文：用户改写 md 会污染出题材料。分开之后，无论用户把 md 改成什么样，出题拿到的仍是 AI 原稿。

⚠️ **基线必须留完整正文，不能只留结构骨架。** 出题取的材料是 `strings(topic) || strings(source)`（`packages/dsh-zhiyun-core-quiz/src/knowledge-points.js:30`）；骨架为空时会**静默**退化成课堂口述原文——质量掉一档且不报错。

### 2.2 版本 = 一对，不是一个文件

```
版本 = （AI 基线, 讲义 md）
```

二者**同生同灭**，用户改动**随版走**：重新生成开出新的一版，新版 md 是纯 AI 稿、不含旧版里用户写的东西；旧版那一对整体留在归档里，随时可以整体换回来。

这条是产品决定，不是实现方便。如果基线与 md 能各自回退，就会出现「基线是第 2 版、md 却停在第 4 版」的错位状态，而那个状态没有任何人能解释。

### 2.3 磁盘布局

```
课程/节次.md                        ← 当前版本的 md（用户读与改的那一份）
讲义归档/课程/节次/v1/讲义.md        ← v1 的 md（这一版停下时用户手里的样子）
讲义归档/课程/节次/v1/基线.json      ← v1 的 AI 基线（生成时就定下，此后不变）
讲义归档/课程/节次/v2/…
```

### 2.4 两条由此推出的规则

1. **基线一旦写进 `v<N>/基线.json` 就不再变。** 它是 AI 稿，与用户改动无关。于是「当前基线」就是 `v<当前版>/基线.json`，不需要另存一份。
2. **归档只装已结束的版本。** 当前版本的正文只存在于 `课程/节次.md`；`v<当前版>/讲义.md` 在它结束的那一刻才被写。

规则 2 是为了堵一个很具体的坑（这是实测踩出来的，见第六节「已解释的反常」）：如果新版生成时顺手也写一份 `v<新>/讲义.md`，那份就是**占位副本**——用户在 live 上改了正文，归档里那份不跟着变，点开归档看到「这不是我现在的内容」；而且它和「归档里可以直接编辑」直接冲突，下一次收尾会覆盖用户刚在归档里改的那份。

干净 AI 稿不会因此丢：随时能从 `基线.json` 重建（`baselineToMarkdown`）。

### 2.5 swap（回退）为什么只需要动 md

「回退」不是覆盖，是**对调**：

1. 把当前这一版停下：`v<当前>/讲义.md` ← 当前 live 的正文（保住用户最后的样子）
2. 把目标版本的那份写到 live：`课程/节次.md` ← `v<目标>/讲义.md`

**基线一个字节都不用搬**：交换后「当前版本」变成目标版，而当前基线按规则 1 就是 `v<目标>/基线.json`——本来就是它的。

### 2.6 md 的形状：只有内容，没有机器字段

```markdown
# 数据结构 第三讲

## 第一章 绪论

### 1.1 什么是算法

#### 讲解

算法是求解问题的有限步骤。

#### 例题 · 二分查找

给定有序数组，求目标下标。

##### 解答

O(log n)，每次折半。
```

- `##` 章、`###` 知识点、`#### 类型 · 小标题` 块
- 块类型只有五种：讲解 / 定义 / 步骤 / 例题 / 说明（与 `dsh-zhiyun-page-study/src/lecture-content.jsx` 的 `kinds` 一致）
- **例题**用一行 `##### 解答` 分隔题干与解答（其余四种块只有一段正文）——**这是本方案唯一新增的语法**
- 页码、时间锚点、`blockIndexes` **不写进 md**：结构锁定时块的身份就是它的位置，那些字段由当前版本的基线按位置 join 回来

### 2.7 为什么结构锁定

用户不允许改章 / 知识点 / 块的层级与顺序，只改内容。好处是连锁的：

- 身份由位置决定 → md 不需要行内 id（`^c1t1` 那种），文件保持干净
- 结构不变 → 用户改动只有「某块文字变了」几类，diff 现算就够，不需要三方合并
- 「一键隐藏我的更改」= 当前版内改渲染基线，全有或全无

⚠️ **这是约定，不是强制**：笔记库是普通文件夹，任何编辑器都能打开，用户手写一行 `## 我自己的一章` 就会被当成章标题。文件系统层面拦不住，只能靠界面与文档说明。

---

## 三、已落地的部分（含实测结果）

### 3.1 包与源码

```
packages/dsh-zhiyun-core-handout/
├── package.json        exports: . / ./codec / ./version / ./package.json
├── OWNERS              Owner: @lybx-leyw + Open
├── README.md           双源分工、md 形态、结构锁、错误态度
├── cordis.patch.yml    insert: id zhiyun-core-handout
└── src/
    ├── codec.js        Markdown 编解码 + 基线覆盖（11.7 KB）
    ├── version.js      版本对与归档布局，纯函数零 IO（14.4 KB）
    ├── store.js        领域服务：把版本对搬进搬出笔记库（14.8 KB）
    └── index.js        宿主半边：ctx.provide('zhiyunHandout')
```

**零 IO 纪律**：`src/` 下没有一行实际的 `node:fs` / `node:path` import（`node:fs` 只在注释里被提到）。由 `tests/handout-discipline.test.mjs` 钉住。

### 3.2 codec.js 的接口

```js
baselineToMarkdown(chapters, title)   // 基线 → md
markdownToChapters(markdown)          // md → 基线（含 warnings）
roundtrip(chapters, title)            // 往返，测试与自检用
BLOCK_KINDS / BLOCK_KIND_LABELS       // 五种块的闭集
SOLUTION_MARKER = '##### 解答'
resolveBlockKind(raw) / kindOf(block) / blockParts(block) / effectiveBlocks(topic)
```

**错误态度**：认不出的块类型**不抛错**，降级成「讲解」并留 warning，正文一个字不丢——md 可能已经被人改过，为一个排版失误让整份讲义读不出来，是拿用户的正文去惩罚它。结构性错乱（块出现在没有知识点的地方）只丢那一块，并说出来。

**行首 `#` 转义**：正文若有一行以 `#` 开头，解码时会被当成结构标题，往返就坏了。所以编码时把正文行首的 `#` 写成 `\#`（Markdown 自身的转义写法，渲染出来仍是 `#`，不引入私有记号）。

### 3.3 version.js 的接口

```js
ARCHIVE_DIR = '讲义归档'
HANDOUT_FILE = '讲义.md'    BASELINE_FILE = '基线.json'

currentNotePath(courseTitle, lessonTitle)          // 不带 .md（笔记页的键形状）
archiveSessionPath(courseTitle, lessonTitle)
versionPath / versionHandoutPath / versionBaselinePath
isArchivePath(rel)
createState({courseTitle, lessonTitle, versions, current})
nextVersionNumber(state)          // 最大号 + 1，绝不回退复用
planArchiveLayout(state)
planDeactivate(state, version)    // 这一版停下：live 正文存进它的归档目录
planRegenerate(state, next)       // 一次重新生成的全部搬运
planSwap(state, target)           // 回退：对调正文
resolvePlan(plan, read)           // 执行前先解析全部 copyFrom
versionsOnDisk(entries, courseTitle, lessonTitle)
```

**版本号不回退复用的理由**：版本号是用户唯一能指的东西（「回到 v3」）。复用号码会让「v3 是什么」在一段时间里有两个答案。

**`resolvePlan` 必须先读后写**：计划里有 `copyFrom`（读一个路径再写到另一个路径），执行方**必须先把所有 `copyFrom` 读成内容，再开始任何写入**。否则「读 A 写 B、再读 B 写 A」这类交换会读到刚被自己改过的新内容，把旧内容吃掉。这是从磁盘上真的丢数据。

**`versionsOnDisk` 以磁盘为准**：归档目录可能被用户手动改名或删掉某个 `v<N>`，所以状态文件只是加速用的，磁盘才是事实。

### 3.4 store.js 的接口

服务面（经 `ctx.zhiyunHandout` 暴露）：

```js
exportLecture(input)   // 生成后：写 md + 登记版本
regenerate(input)      // 同 exportLecture，语义不同（旧的留下、新的另开一版）
listVersions(input)    // 列版本（磁盘为准），带每版能否读回基线
swapTo(input)          // 回退
baselineMarkdown(input)// 「隐藏我的更改」：取某一版基线编码成 md（只读，不回写）
readHandout(input)     // 读用户当前看到的讲义；拿不到 md 时退回基线
hasHandout(input)
currentBaseline(input) // v<当前版>/基线.json —— 出题与知识点导航读它
isArchivePath(path)
```

**注入的窄接口**（`zhiyunVaultNotes` 的形状）：

```js
tree()                    // 扁平条目表
read(name)                // 读 .md（name 不带扩展名）+ write(name, markdown)
readRaw(path)             // 读任意扩展名文本    + writeRaw(path, text)
```

为什么需要 `readRaw` / `writeRaw`：笔记页的 `write` 会**无条件补 `.md`**（`page-notes/index.js` 的 write 分支是 `${resolveIn(rel)}${NOTES_EXT}`）。基线是 JSON，没有这条通路归档就只能存 markdown，而「隐藏我的更改」需要那份结构化基线（逐块的 kind、例题的题干与解答），从 md 反推会丢东西。**这是接线时发现的真实缺口，不是设计洁癖。**

### 3.5 index.js（宿主半边）

```js
export const name = 'zhiyun-core-handout';
export const inject = ['profileContext'];
```

`zhiyunVaultNotes` 是**惰性**取的，**不写进 `inject`**：它缺席时讲义联动只是不可用，不该把学习页整片拖成 pending。每次方法调用都重新 `ctx.get` 一次（笔记页可能因配置变化被重新挂载）。

### 3.6 page-notes 的改动（已完成）

`packages/dsh-zhiyun-page-notes/src/index.js`（+89 行）：

- `walk(rel, { skipArchive })` —— 列树时照常下去（用户要能点开、能直接改），建索引时整棵跳过
- `readAll()` 走 `walk('', { skipArchive: true })`，并额外按 `isArchivePath` 过滤
- 新增 `ARCHIVE_DIR = '讲义归档'` 与 `isArchivePath(rel)`
- 新增 `readRaw` / `writeRaw` 两条任意扩展名通路（路径过 `safePath`，落点过 `resolveIn`，上限 `MAX_NOTE_BYTES`）

**为什么不用 `.` 开头的隐藏目录**：Obsidian 默认把点开头的文件夹整条隐藏，那样用户既在应用里看不到、也在 Obsidian 里看不到，归档就只剩版本面板一个入口。

**两条路径分开的理由**：列树与建索引对归档的要求正好相反——树里要能看见（否则用户点不开旧版），索引里不能有（否则同一节的 `[[链接]]` 会按历史版本数被重复计数，反链与图谱全都虚高，而且是「数字变大」这种最不显眼的错）。

### 3.7 测试：60 条全绿

```
tests/handout-codec.test.mjs            10 条   编解码往返、例题两段、空章节、未知类型降级、行首 # 转义
tests/handout-version.test.mjs          16 条   版本对、归档布局、换版与 swap 互逆、版本号不回退
tests/handout-store.test.mjs            12 条   内存假笔记服务跑通 exportLecture/regenerate/swapTo/listVersions
tests/handout-discipline.test.mjs        2 条   src 下无 node:fs
tests/handout-notes-archive.test.mjs     9 条   归档进树不进索引、索引条数不随版本数涨、readRaw 不补 .md
tests/vault-notes.test.mjs              11 条   既有笔记库测试，无回归
```

实测命令与结果：

```bash
node --test tests/handout-codec.test.mjs tests/handout-version.test.mjs \
  tests/handout-store.test.mjs tests/handout-discipline.test.mjs \
  tests/handout-notes-archive.test.mjs tests/vault-notes.test.mjs
# ℹ tests 60   ℹ pass 60   ℹ fail 0
```

---

## 四、待做的部分（按依赖顺序）

### 4.1 第 6 步：改讲义的两处读取路径

**目标**：讲义检索与学习页读 md（用户版），而不是 `record.lecture`。

要改的地方：

- `packages/dsh-zhiyun-core-knowledge/src/service.js:133` `handoutFragments(record)` —— 现在读 `record.lecture?.chapters`（第 134 行），且在 296 行按 `layer === 'lecture'` 派发
- `packages/dsh-zhiyun-page-study/src/layered-search.js:267-296` 讲义层 —— 现在读 `result?.lecture?.chapters`（第 270 行）

**要点**：

- 改为**优先读用户版 md**（经注入的通道，即 `zhiyunHandout.readHandout`），读不到时**回落** `record.lecture`
- ⚠️ `handoutFragments` 是 generator（`function*`），注入服务是 async——需要改造为 async generator，或把 markdown 先取好再同步遍历。这是本步最容易出结构问题的点
- **不要动** `knowledge-points.js`：出题与知识点导航必须继续读 `record.lecture`
- 两处都改完后，`readHandout` 返回的 warnings 应当透出（用户改了结构时不该静默）

**判据**：有测试证明——用户改写讲义 md 后 `knowledgePoints()` 对同一 record 返回的 `title` 与 `text` 与改写前**逐字一致**；`handoutFragments` 返回的是 **md 里的内容**而非 `record.lecture` 原文。两个包的既有测试 fail 为 0。

**这条对应判断「基线不受用户改动影响」**，推翻条件：改写 md 后 `knowledgePoints()` 返回的 title 或 text 发生变化。

### 4.2 第 7 步：生成钩子

**目标**：生成完讲义后自动把新版落到笔记库。

位置：`packages/dsh-zhiyun-core-study/src/workbench.js`，生成完成处。
现在的两次 save 在 **358–359 行**（清空 lecture）与 **370–372 行**（写入完整 lecture）。

**要点**：

- 在 **370–372 行的 save 之后**调用 `zhiyunHandout.exportLecture({ courseTitle, lessonTitle, current, chapters, title, baseline })`
- ⚠️ 基线**必须完整写进 `record.lecture`**（不能只写骨架，理由见 2.1）
- ⚠️ `workbench.js:239` 会在 `generationVersion !== 'architecture-v4'` 时把 lecture 置 null；导出时也要尊重这个前提
- 用 `ctx.get('zhiyunHandout')` **惰性取**，缺席时**只警告、不阻断生成**（讲义生成是主流程，笔记联动是附加价值）
- ⚠️ `workbench.js:355-372` 每次 `start()` 都会重新解析并整体覆盖 `lecture`，且总是写 `lectureHistory: []`——导出钩子要考虑「重新生成时 current 从哪来」，否则每次都会当成 v1

**判据**：生成后笔记库出现 `<课程>/<节次>.md` 且内容与基线一致；服务缺席时生成流程仍完成且只打一条警告。

### 4.3 第 8 步：版本面板 UI

**目标**：学习页上有版本面板——列版本、回退、隐藏我的更改。

**要点**：

- 新文件 `packages/dsh-zhiyun-core-handout/src/client.jsx` 与 `src/style.css`
- 注册插槽的现有写法参照 `packages/dsh-zhiyun-page-study/src/client.jsx:22-27`：

  ```js
  export const inject = ['slots'];
  ctx.inject(['zhiyunHandout'], (scope) => {
    scope.slots.inject('zhiyun.study.content', () => scope.slots.register(...));
  });
  ```

- ⚠️ 已有插槽名是 **`zhiyun.study.content`**（学习页）与 `zhiyun.notes.content`（笔记页）。学习页那个是**单一内容大插槽**（整页由一个组件渲染），所以版本面板更可能是**在 `page-study` 内部声明一个新插槽**、由本包去注册——需要读 `study-workspace.jsx` 决定具体落点
- **笔记页绝对不加版本面板**（用户原话：「笔记页根本不需要写版本面板，笔记页可以看到和修改所有笔记库内容，包括被归档的笔记」）
- 三个动作：列版本（`listVersions`）、回退（`swapTo`）、隐藏我的更改（`baselineMarkdown` 渲染，只读）
- 「隐藏我的更改是当前版内改渲染基线，全有或全无」——不要做成逐块开关
- 样式只用壳的 `--zy-*` 变量，类名前缀不要与既有 `zs-` 冲突

**判据**：`client.jsx` 注册了学习页插槽并实现列版本/回退/隐藏更改三个动作；`style.css` 无硬编码颜色值、类名前缀不与 `zs-` 重合；构建后前端产物包含该面板。

### 4.4 第 9 步：四处登记

⚠️ **注意：这三处现在有别人的改动，登记前先看清**（`git diff` 显示 `profiles/zhiyun-bench/package.json`、`scripts/build.mjs`、`tests/profile.test.mjs` 都已有 `dsh-zhiyun-core-playback` 的改动，那是另一个包，不是本次的）。

1. **`profiles/zhiyun-bench/package.json`** —— `dsh.profile.bundles` 数组里加 `"dsh-zhiyun-core-handout"`（建议加在 `dsh-zhiyun-core-knowledge` 之后、`dsh-zhiyun-core-learning-resource` 之前）
2. **`scripts/build.mjs`** —— `CLIENT_PACKAGES` 数组（第 45 行起）加 `'dsh-zhiyun-core-handout'`（因为第 8 步会产出 `client.jsx`）
3. **`packages/dsh-zhiyun-core-handout/cordis.patch.yml`** —— 已存在，内容为：

   ```yaml
   - insert:
       - id: zhiyun-core-handout
         name: dsh-zhiyun-core-handout
   ```

   ⚠️ bundle 列在 `dsh.profile.bundles` 里**并不会自动加载**，必须在自己的 patch 里把自己 insert 进去
4. **`tests/profile.test.mjs:97`** —— 那份 `assert.deepEqual(data.dsh.profile.bundles, [...])` 的**逐字期望清单**，必须补上 `'dsh-zhiyun-core-handout'`。漏写不会报错，只会让 profile 少挂一个包

**判据**：四处登记都在；`tests/profile.test.mjs` 全过；`cordis.patch.yml` 的 id 为 `zhiyun-core-handout` 且能被 bundles 解析。

### 4.5 第 10 步：回归

跑 `npm run build`、`npm run check:css`，以及 vault-notes、knowledge、study、lecture 四套既有测试；把失败项逐个归因成「本改动引入」还是「既有失败」，写成 `reports/handout-regression.md`。

⚠️ **本仓工作区里有大量别的未提交改动**（见第八节），归因时必须用 `git stash` 对照或直接看 `git diff` 判断，不能想当然。

---

## 五、完整规划（10 步，逐条判据）

| # | 步骤 | 交付物 | 判据 | 状态 |
|---|---|---|---|---|
| 1 | 建包 + codec | package.json / OWNERS / README / cordis.patch.yml / src/codec.js | exports 含 `.` `./codec` `./version`；导出 baselineToMarkdown 等；无 node:fs | ✅ 已实现并记录 |
| 2 | version.js | src/version.js | 上述 12 个导出；无 fs/path import；resolvePlan 先读后写 | ✅ 已实现并记录 |
| 3 | 核心测试 | handout-codec / handout-version | codec ≥8 条、version ≥12 条，fail 为 0 | ✅ 实测 26 条全过 |
| 4 | store + index | src/store.js / src/index.js / 两个测试 | store 测试跑通四个动作；discipline 证明无 node:fs | ✅ 实测 14 条全过 |
| 5 | page-notes 归档拆分 | page-notes/index.js / handout-notes-archive.test.mjs | 再造版本后索引条数不变；树里看得见；readRaw 不补 .md；vault-notes 无回归 | ⚠️ **实物与测试已完成（20 条全过），仅记录未落地** |
| 6 | 改读取路径 | knowledge/service.js / layered-search.js / handout-read-paths.test.mjs | 改写 md 后 knowledgePoints 的 title/text 逐字不变；handoutFragments 返回 md 内容 | ⬜ 未动 |
| 7 | 生成钩子 | workbench.js / handout-generation.test.mjs | 生成后出现 md 且与基线一致；服务缺席只警告不阻断 | ⬜ 未动 |
| 8 | 版本面板 | src/client.jsx / src/style.css | 三动作齐；无硬编码颜色；类名不与 zs- 冲突；产物含面板 | ⬜ 未动 |
| 9 | 四处登记 | profile package.json / build.mjs / profile.test.mjs（+ cordis.patch.yml 已建） | 四处齐；profile.test.mjs 全过 | ⬜ 未动 |
| 10 | 回归 | reports/handout-regression.md | 失败项逐条归因；构建与 CSS 检查原文照录 | ⬜ 未动 |

### 三条被检验的判断

1. **「编解码往返」**——基线编码成 Markdown 再解码，能逐块恢复三层结构与块正文（含例题题干/解答两段）。
   推翻条件：任一块的正文、块类型或例题的两段在往返后不一致，或章节数量改变。
   → **已支持**（10 条 codec 测试）。

2. **「归档不进索引」**——归档目录既出现在文件树里、又被排除出索引，反链计数不随历史版本数增长。
   推翻条件：新增一个历史版本后，索引里的笔记条数或反链条数随之增加。
   → **实测支持**（9 条归档测试 + 11 条 vault-notes；再造版本后索引条数完全不变，只有 tree() 条目数增长）。但系统记录未落地。

3. **「基线不受用户改动影响」**——用户改写讲义 md 之后，出题所依据的知识点标题与正文仍与改动前一致。
   推翻条件：改写 md 后 `knowledgePoints()` 对同一 record 返回的 title 或 text 发生变化。
   → **尚未有任何证据**（属第 6 步）。

### 已登记的本体概念（`clear/ontology/`）

- 概念：`handout`（讲义）、`lecture_baseline`（AI 基线）、`archive_dir`（归档目录）、`vault_note`、`version_pair`、`block_identity`、`kind_label`
- 实体：`handout-section-md`、`archive-root`、`archive-lecture-md`、`handout-decoded-chapters`、`lecture-baseline-record`
- 关系：`roundtrip_preserves`（往返保持结构）、`archive_excluded_from_index`（归档不进索引但仍可见）、`baseline_feeds_quiz`（基线供出题与知识点导航）、`handout_derives_from_baseline`、`block_identity_by_position`、`version_pair_contains`

---

## 六、踩过的坑（都是实测踩出来的，别再踩）

### 6.1 已解释的反常：swap 不是磁盘逐字节复原

原以为「回退 = swap」是纯交换、磁盘一个字节不变。**实测不成立。**

改成「归档只装已结束的版本」后占位副本不再存在：`planRegenerate` 不再给新版本写归档 md，只写 live md 与 `v<N>/基线.json`；当前版本的正文只有 live 一处，等它结束（重新生成换版或 swap）时由 `planDeactivate` 从 live 写一次。

由此换来的不变量是「**swap 后 live 精确复原 + 每份被覆盖的干净 AI 稿都能从保留的基线重建**」，而不是「磁盘逐字节回到原状」。后者在「当前版本正文只活在 live」这个前提下一开始就不该被当作判据。

**教训**：写 swap 的断言时不要写「两次 swap 后磁盘逐字节相同」。

### 6.2 其他坑

| 坑 | 现象 | 修法 |
|---|---|---|
| `resolvePlan` 拒绝对象基线 | 报「搬运计划缺少内容来源」 | 非字符串 content 序列化成 pretty JSON |
| `planRegenerate` 写了占位 md | 与「归档可直接编辑」冲突 | 删掉那次写入（见 6.1） |
| 局部变量遮蔽导致 TDZ | `Cannot access 'probe' before initialization` | 局部 `const probe` 改名 |
| store 路径派发错 | live 路径不带 `.md` → 误走 `readRaw` → 返回 null | 加 `readLiveNote` 回退 + 非点号启发 |
| 笔记页 `write` 无条件补 `.md` | 基线 JSON 存不了 | 加 `readRaw` / `writeRaw` |
| 同一个 `walk()` 复用 | 归档目录一出现就污染索引 | 拆成列树/索引两条路径 |
| `readPath` 的扩展名启发式 | 课程/节次名带点时（「1.2 算法」）被误判成文件，读回 null | **未修**，见 [STATUS.md](STATUS.md) 4.1；建议按「最后一段是否含点」判定并补测试 |

### 6.3 关于 `^id` 行内标记

曾在方案里考虑过给每个块加行内 id（`^c1t1` 那种）来解决身份问题。**已放弃**：结构锁定之后，块的身份证就是它的位置（第几章 / 第几个知识点 / 第几个块），不需要行内标记，md 保持干净。

---

## 七、协作约束（来自仓库 AGENTS.md）

- 共享仓库：`https://github.com/lybx-leyw/dsh-zju-workbench.git`，`origin` 必须正好是这个地址
- **推送一律走 PR**
- **本仓库是公开仓库**：推送前必须先检查有无泄露个人凭证、本地绝对路径等个人信息
- 提交与 PR 需要您明确批准
- 协作材料在 `docs/contributing/`

---

## 八、当前工作区的真实状态（⚠️ 容易误判）

`git status` 显示**大量与本次无关的未提交改动**。本次改动只涉及：

```
新增：packages/dsh-zhiyun-core-handout/          （整包，未跟踪）
新增：tests/handout-codec.test.mjs
新增：tests/handout-version.test.mjs
新增：tests/handout-store.test.mjs
新增：tests/handout-discipline.test.mjs
新增：tests/handout-notes-archive.test.mjs
修改：packages/dsh-zhiyun-page-notes/src/index.js   （+89 行，归档拆分与本 step 的 readRaw/writeRaw）
修改：clear/ 下的本体与目标记录                    （未跟踪目录）
```

**不属于本次**（别人的或此前的未提交改动）：`profiles/zhiyun-bench/package.json`、`scripts/build.mjs`、`tests/profile.test.mjs` 里的 `dsh-zhiyun-core-playback` 相关改动；`dsh-zhiyun-core-quiz/*`、`dsh-zhiyun-page-study/*`、`dsh-zhiyun-source-classroom/*` 等一大批文件。

⚠️ 因此**第 9 步登记时不要把这些既有改动当成自己写的**，也不要顺手回滚它们。

---

## 九、待您决策

1. **第 5 步怎么处理**——实物与 20 条测试都在，只是记录没落地。选项：(a) 不动，等记录通路恢复后补交；(b) 把它并入第 6 步一起交付；(c) 就这样放着，实现照常往下做，记录最后一次性清理。
2. **第 8 步插槽落点**——学习页现在是**一个内容大插槽**（`zhiyun.study.content` 整页由一个组件渲染）。版本面板要么嵌进 `study-workspace.jsx`，要么在 `page-study` 里新声明一个插槽。前者改动小、耦合高；后者干净、要动 `page-study`。**我倾向后者**（`page-study` 只需多声明一个插槽，符合「新包拥有存储/版本/解析/回退，page-study 只委派正文来源 + 声明新插槽」的原定分工）。
3. **这个临时文件夹何时归档**——建议在第 10 步回归报告写完之后，把本目录整体归档或删除。

---

## 十、下一步最小动作

若接着做，按这个顺序：

1. 读 `packages/dsh-zhiyun-page-study/src/study-workspace.jsx`，确定版本面板的落点（对应上述决策 2）
2. 做第 6 步（读取路径），因为它对应唯一还没被任何证据碰过的判断
3. 第 7 步生成钩子
4. 第 8 步 UI
5. 第 9 步四处登记（注意第八节的警告）
6. 第 10 步回归 + 写 `reports/handout-regression.md`
7. 归档本文件夹
