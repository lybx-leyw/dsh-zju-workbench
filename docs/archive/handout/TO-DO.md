# 待做六步：可执行清单

> 配套 [README.md](README.md)。这里只放「每个文件改哪一行、改成什么」，不重复设计与理由。
>
> 仓库根：本仓库（归档时已移除原作者的本机绝对路径）

---

## 第 6 步：讲义的两处读取路径改读 md

### 6.1 `packages/dsh-zhiyun-core-knowledge/src/service.js`

**现状**（第 131–147 行）：

```js
// Handout search is an explicit layer: it must never masquerade as a quote
// from the final transcript. Anchors point to the original parser blocks.
function* handoutFragments(record) {
  const chapters = record.lecture?.chapters;
  if (!Array.isArray(chapters)) return;
  for (const [ci, chapter] of chapters.entries()) {
    ...
  }
}
```

第 296 行派发：

```js
const fragments = layer === 'lecture' ? handoutFragments(record) : ...
```

**要改成**：优先读用户版 md。

⚠️ **结构性难点**：`handoutFragments` 是**同步 generator**，而 `zhiyunHandout.readHandout` 是 **async**。两条路可选，选一条并写进注释：

- **路线 A（推荐）**：把 `handoutFragments` 改成 `async function*`，第 296 行改成 `for await`。改动小但影响派发点的所有分支（`layer === 'all'` 也要拼两个流）
- **路线 B**：在调用 layer 检索**之前**把 `await readHandout()` 取好，作为一个可选参数塞进来，`handoutFragments(record, overrideChapters)` 保持同步

**必须检查**：`record` 在这层不一定带 `courseTitle` / `lessonTitle`。`sessionOf` 用的是**标题**而不是 `accountId:courseId:subId` 键，所以要确认 record 上这两个字段一定在（`knowledge-points.js:34` 显示 `record.lessonTitle ?? record.title ?? record.subId`，说明 lessonTitle 可能缺）。缺的时候要**回落到 `record.lecture`**，不能抛。

**不要动**：`knowledge-points.js` —— 出题与知识点导航必须继续读 `record.lecture`。

### 6.2 `packages/dsh-zhiyun-page-study/src/layered-search.js`

**现状**（第 267–296 行）：

```js
// ── ④ 讲义（App `reference` 层在 JS 的落点）──
if (!hasFilter && needle && wanted.has(LayerId.lecture)) {
  const bucket = branch();
  const chapters = Array.isArray(result?.lecture?.chapters) ? result.lecture.chapters : [];
  ...
}
```

以及第 347 行：

```js
layers[LayerId.lecture] = (Array.isArray(result?.lecture?.chapters) ? result.lecture.chapters : [])
```

**要改成**：从 `result` 上取一个已被替换成「用户版」的 chapters。最省事的做法是**在调用方把 `result.lecture` 换成用户版再传进来**（这样 `layered-search.js` 一行都不用改，它仍然只看 `result.lecture`），但那样「隐藏我的更改」和「出题」就必须各拿各的 record 副本，容易搞混。

⚠️ 更干净的做法：`layered-search.js` 收一个可选参数 `lectureOverride`，第 270 与 347 行改成 `lectureOverride ?? result?.lecture?.chapters`。**推荐这个**，因为它是显式的，看代码就知道有两个来源。

### 6.3 新测试 `tests/handout-read-paths.test.mjs`

必须覆盖的三件事：

1. **改写 md 后 `knowledgePoints()` 的 title/text 逐字不变**——这是判断「基线不受用户改动影响」的直接检验，也是本步的核心
2. **`handoutFragments` 返回 md 里的内容**（改 md 加一句特征串，搜索能搜到）
3. **md 不存在时回落 `record.lecture`**（不出错、不返回空）

⚠️ 第 1 条要**真的造一个 record**：`generationVersion: 'architecture-v4'` 必须写在 `record.lecture` 上，否则 `knowledge-points.js:21` 会把 lecture 当不存在，测试就白跑了。同时注意第 22 行：`record.semanticPlan` 存在时**优先于** `lecture.chapters`——测出题那条路径时要确认 semanticPlan 不干扰。

---

## 第 7 步：生成钩子

### `packages/dsh-zhiyun-core-study/src/workbench.js`

**插入点**：第 370–372 行那个 `await this.save(...)` **之后**。

```js
// 现在是：
await this.save(key, { ...result, sourceVersion, title, courseTitle:job.courseTitle, lessonTitle:job.lessonTitle, knowledgeTree: result.tree,
  lecture: { ...generated.lecture, sourceVersion, revision: randomUUID(), at: new Date().toISOString() },
  lectureHistory: [], quiz: null });
// ← 在这里之后插钩子
job.state = ...
```

**要插入的逻辑**（示意，按本仓风格写注释说明为什么）：

```js
// 把新版讲义落到笔记库。失败只警告：讲义生成才是主流程，
// 笔记联动是附加价值，不该因为文件写不进去就让整次生成算失败。
try {
  const handout = this.ctx?.get?.('zhiyunHandout');
  if (handout) {
    await handout.exportLecture({
      courseTitle: job.courseTitle,
      lessonTitle: job.lessonTitle,
      chapters: generated.lecture.chapters,          // 完整章节，不是骨架
      title: generated.lecture.title ?? title,
      baseline: generated.lecture,                   // 完整基线
      // current 从哪来：见下方警告
    });
  } else {
    this.warn?.('讲义联动未就绪，本次未写入笔记库');
  }
} catch (error) {
  this.warn?.(`讲义写入笔记库失败：${error.message}`);
}
```

**三个必须想清的点**：

1. ⚠️ **`current` 从哪来**。`exportLecture` 内部会 `stateOf` 从磁盘推版本列表，但「谁是当前版本」磁盘说不出来（`store.js:123-127` 的注释说明了这一点，缺省取最大号）。重新生成时如果 `current` 传错，会当成 v1 再来一次。建议：**不传 current**，让 `stateOf` 取磁盘最大号——重新生成时磁盘上已有 v1，最大号就是它，行为正确。
2. ⚠️ **`workbench.js:355-372` 每次 `start()` 整体覆盖 `lecture`，且总写 `lectureHistory: []`**。这意味着「历史上生成过几版」在知识记录里是**不留痕迹**的，版本事实只在**笔记库磁盘**上。这和「以磁盘为准」的设计一致，但要在注释里写明，免得后来的人以为可以从 `lectureHistory` 恢复。
3. ⚠️ **这条链路是 async 但 `ctx` 可能不在 `this` 上**。先读 `workbench.js` 的构造函数与 `start()` 签名，确认 ctx 怎么传进来（`dsh-zhiyun-core-study/src/host.js` 里可能有线索）。

### 新测试 `tests/handout-generation.test.mjs`

1. 生成后笔记库出现 `<课程>/<节次>.md`，内容与基线编码结果一致
2. `zhiyunHandout` 缺席时生成仍完成（`job.state` 正常），且只打一条警告

---

## 第 8 步：版本面板

### `packages/dsh-zhiyun-core-handout/src/client.jsx`

骨架（按 `page-study/src/client.jsx:22-27` 的写法）：

```jsx
export const name = 'zhiyun-core-handout-client';
export const inject = ['slots'];
export function apply(ctx) {
  mountStyle(ctx, { attribute: 'zhiyunHandoutStyle', css, label: 'zhiyun: handout version panel styles' });
  ctx.inject(['zhiyunHandout'], (scope) => {
    scope.slots.inject('<待定，见下>', () => scope.slots.register(
      { name: '<同上>' },
      () => <VersionPanel handout={scope.zhiyunHandout} />,
    ));
  });
}
```

⚠️ **插槽名待定**。现有插槽只有 `zhiyun.study.content`（学习页整页）与 `zhiyun.notes.content`（笔记页）。学习页那个是单一内容插槽，直接往里注册会**顶掉整页**。所以需要：

- 在 `packages/dsh-zhiyun-page-study/src/study-workspace.jsx` 里找到合适位置 **声明一个新插槽**（例如 `zhiyun.study.handout-version`），然后本包注册到它

⚠️ **笔记页不加版本面板**（用户明确要求）。`zhiyun.notes.content` 不要去碰。

### 三个动作

| 动作 | 调用 | 行为 |
|---|---|---|
| 列版本 | `listVersions({courseTitle, lessonTitle})` | 显示每版号、是否当前版、有没有基线；点开才展开 |
| 回退 | `swapTo({courseTitle, lessonTitle, version})` | 二次确认，提示「原来的那一版会留在归档里」 |
| 隐藏我的更改 | `baselineMarkdown({courseTitle, lessonTitle, version})` | **只读渲染**，不回写文件；给一句「这是 AI 原版，你的改动仍在文件里」 |

### `packages/dsh-zhiyun-core-handout/src/style.css`

- 只用 `--zy-*` 变量取色，**不写硬编码颜色值**（`npm run check:css` 会查这个）
- 类名前缀不要与 `zs-` 冲突，建议 `zhp-`（zhiyun handout panel）

---

## 第 9 步：四处登记

⚠️ **先 `git diff` 看这三个文件**——它们已经带着 `dsh-zhiyun-core-playback` 的改动，**不要回滚**。

| 文件 | 位置 | 加什么 |
|---|---|---|
| `profiles/zhiyun-bench/package.json` | `dsh.profile.bundles` 数组 | `"dsh-zhiyun-core-handout"`，建议放在 `dsh-zhiyun-core-knowledge` 之后 |
| `scripts/build.mjs` | `CLIENT_PACKAGES`（第 45 行起） | `'dsh-zhiyun-core-handout'`，放在 `dsh-zhiyun-core-playback` 之后 |
| `tests/profile.test.mjs` | 第 97 行 `assert.deepEqual(...)` | 那个逐字期望清单里补 `'dsh-zhiyun-core-handout'`（**漏写不报错，只会少挂一个包**） |
| `packages/dsh-zhiyun-core-handout/cordis.patch.yml` | 已存在 | 已写好 `insert: id zhiyun-core-handout`，只需校验能被 bundles 解析 |

⚠️ bundle 列在 `dsh.profile.bundles` 里**并不会自动加载**，必须在自己的 patch 里把自己 insert 进去（`tests/univer-office.test.mjs` 记过这个真机缺陷）。

---

## 第 10 步：回归

```bash
npm run build
npm run check:css
node --test tests/vault-notes.test.mjs
node --test tests/vault.test.mjs
node --test tests/*knowledge*.test.mjs
node --test tests/*study*.test.mjs
node --test tests/*lecture*.test.mjs
node --test tests/handout-*.test.mjs
node --test tests/profile.test.mjs
```

写 `reports/handout-regression.md`：每条失败项的**归因结论**（本改动引入 / 既有失败）+ **判定依据**（`git diff` 看到了什么、或 stash 对照结果）+ 构建与 CSS 检查的**原文**。

⚠️ 工作区里有大量无关的未提交改动（见 README 第八节），归因时不能想当然。

---

## 完成后

1. 确认 README 第九节三个决策都已处理
2. **归档本文件夹**（`tmp-handoff-handout/`）——它是过程产物，不该留在仓库里
