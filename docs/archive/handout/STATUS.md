# 现状对照：哪块能跑、哪块是空壳

> 配套 [README.md](README.md) 与 [TO-DO.md](TO-DO.md)。本文按「模块 → 现状 → 证据」列，用来快速判断一段代码该不该信。

---

## 一、能跑的部分（有测试为证）

| 模块 | 现状 | 证据 |
|---|---|---|
| `codec.js` 编码 | ✅ 完整 | 10 条测试；`baselineToMarkdown` 三层结构、例题两段、行首 `#` 转义 |
| `codec.js` 解码 | ✅ 完整 | 同上；未知类型降级 + warning |
| `codec.js` 往返 | ✅ 完整 | `roundtrip()` 逐块比对 |
| `version.js` 路径推导 | ✅ 完整 | 16 条测试覆盖 `currentNotePath` / `archiveSessionPath` / `versionPath` 等 |
| `version.js` 版本号 | ✅ 完整 | `nextVersionNumber` 最大号 +1，不回退复用，有测试 |
| `version.js` 换版计划 | ✅ 完整 | `planRegenerate` 搬运清单有测试；**已确认不写占位 md** |
| `version.js` swap 计划 | ✅ 完整 | `planSwap` 与 `planRegenerate` 互逆有测试 |
| `version.js` 先读后写 | ✅ 完整 | `resolvePlan` 把所有 `copyFrom` 解析完才返工 |
| `version.js` 磁盘为准 | ✅ 完整 | `versionsOnDisk` 从 tree 条目筛 |
| `store.js` exportLecture | ✅ 完整 | 12 条测试（内存假笔记服务） |
| `store.js` regenerate | ✅ 完整 | 委托 exportLecture，测试覆盖 |
| `store.js` listVersions | ✅ 完整 | 测试覆盖 |
| `store.js` swapTo | ✅ 完整 | 测试覆盖 |
| `store.js` baselineMarkdown | ✅ 完整 | 测试覆盖 |
| `store.js` readHandout | ✅ 完整 | 测试覆盖「有 md 读 md，没有回落基线」 |
| `store.js` currentBaseline | ✅ 完整 | 测试覆盖 |
| `index.js` 宿主半边 | ✅ 完整 | `ctx.provide('zhiyunHandout')`，8 个方法转发，惰性取 notes |
| `page-notes` 归档拆分 | ✅ 完整 | 9 条归档测试 + 11 条 vault-notes 回归 |
| `page-notes` readRaw/writeRaw | ✅ 完整 | 归档测试覆盖「不补 .md」「路径中和」「拒绝覆盖文件夹」 |

**合计 60 条测试全绿**（`node --test` 一次跑完，`pass 60 / fail 0`）。

---

## 二、还不是空壳但没接上的部分

| 模块 | 现状 | 缺什么 |
|---|---|---|
| `zhiyunHandout` 服务 | ✅ 已 provide，但**没有调用方** | 第 7 步的生成钩子、第 8 步的面板 |
| `ARCHIVE_DIR` 两处常量 | ✅ 两处都在 | 一个由 `page-notes` 导出、一个由 `handout` 导出；**一致性只靠测试钉住**（`handout-notes-archive.test.mjs`） |
| `cordis.patch.yml` | ✅ 文件在 | 没进 `bundles`，所以**现在不会被加载**（第 9 步） |
| `page-notes` 的 `readRaw/writeRaw` | ✅ 服务面已暴露 | `store.js` 已经在用（测试里是假的）——**真实链路还没跑过一次** |

⚠️ 最后一条值得注意：`store.js` 对 `readRaw/writeRaw` 的调用**只在内存假服务上验证过**。真实笔记服务的这两条通路虽然写了测试，但**两者从未在一条链路上会合**。第 7 步接上生成钩子之后，才算真跑通一次。

---

## 三、完全没有的部分

| 模块 | 现状 |
|---|---|
| 讲义读取路径（`knowledge/service.js` 的 `handoutFragments`） | ⬜ 仍读 `record.lecture` |
| 讲义读取路径（`page-study/layered-search.js` 的 lecture 层） | ⬜ 仍读 `result.lecture` |
| 生成钩子（`core-study/workbench.js`） | ⬜ 生成完不写笔记库 |
| 版本面板 UI（`src/client.jsx` / `src/style.css`） | ⬜ 文件不存在 |
| 四处登记（profile / build.mjs / profile.test.mjs） | ⬜ 全未做 |
| `reports/handout-regression.md` | ⬜ 未跑 |

---

## 四、几个容易被误判的细节

### 4.1 `store.js` 的路径派发有两套形状

```js
readPath(path):
  1. 以 .md 结尾         → 走 store.read(path 去掉 .md)      // 归档里的讲义
  2. 不含点号 或 以 / 结尾 → 走 readLiveNote(path)           // live 笔记（键不带扩展名）
  3. 其余                  → 走 store.readRaw(path)          // 基线.json 这类
```

⚠️ **判据不能只看 `endsWith('.md')`**。live 笔记的键**不带 `.md`**（那是笔记页的形状），第一版就是这样写错的：live 路径被当成「其余文件」走 `readRaw('课程/节次')`，那个路径磁盘上不存在，读回 null，整条链路**静默什么都拿不到**。被测试当场抓住。

⚠️ 规则 2 里 `!text.includes('.')` 这个启发式**有真实缺陷**：如果课程名里带点（「1.2 算法」这种），会被误判成「带扩展名的文件」，走 `readRaw` 而不是 `readLiveNote`，于是读回 null。

实测确认（2026-02，用与 `readPath` 相同的判定逻辑跑）：

```
"数据结构/第三讲"                      -> readLiveNote   ✅
"1.2 算法/二分查找"                    -> readRaw        ❌ 应为 readLiveNote
"讲义归档/课程/节次/v1/基线.json"       -> readRaw        ✅
"讲义归档/课程/节次/v1/讲义.md"         -> read(去 .md)   ✅
```

现有测试**没有覆盖**带点的课程/节次名，所以 60 条全绿并不代表这里没问题。

**建议改法**：判据改成「取最后一段，看它是否含点」而不是整串 `includes('.')`：

```js
const tail = text.slice(text.lastIndexOf('/') + 1);
if (!tail.includes('.')) return readLiveNote(text);
return store.readRaw(text);
```

改完要补一条测试：课程名或节次名带点时，live 笔记仍走 `readLiveNote`。

### 4.2 `stateOf` 的「当前版本」靠猜

```js
// store.js:123-127
// 磁盘上有哪些版本由磁盘说；谁是当前版本磁盘说不出来
//（正文在 live 路径里，它与任何一版的归档内容都可能不同），
// 所以由调用方给，缺省取最大号。
```

⚠️ 这意味着**如果用户从 v3 回退到 v1，然后调用方不传 `current`，下次就会被当成 v3**。现在的测试没覆盖这个场景。接第 7 步时要决定：是让调用方一律传 `current`，还是把「当前版本」记到一个地方（例如 `state.json`——`version.js` 里提到过它的形状，但**当前实现没用它**）。

### 4.3 `handoutFragments` 是同步 generator

`service.js:133` 是 `function* handoutFragments(record)`，而 `readHandout` 是 async。**这两个东西不能直接拼**。第 6 步必须选一条路线（`async function*` 或「先取好再传进去」），详见 [TO-DO.md](TO-DO.md) 第 6 步。

### 4.4 `generationVersion` 是硬门槛

`knowledge-points.js:21`：

```js
const lecture = record.lecture?.generationVersion === 'architecture-v4' ? record.lecture : null;
```

⚠️ 字符串必须**逐字**是 `'architecture-v4'`。写错或漏写，lecture 会被当成不存在，出题静默退化成课堂口述原文。写第 6 步的测试时这是第一个要写对的东西。

### 4.5 `semanticPlan` 优先于 `lecture.chapters`

`knowledge-points.js:22`：

```js
const chapters = record.semanticPlan?.length ? record.semanticPlan : lecture?.chapters ?? [];
```

⚠️ 如果 record 上有 `semanticPlan`，出题的章节来源就**不是** lecture。这影响第 6 步判断「基线不受用户改动影响」的测法——要确认测试 record 不带 `semanticPlan`，否则测的其实是另一条路径。

### 4.6 `record.lecture` 每次生成都被整体覆盖

`workbench.js:355-372`：每次 `start()` 都重新解析并**整体覆盖** `lecture`，且总写 `lectureHistory: []`。

⚠️ 后果：**知识记录里不留版本历史**，版本事实只在笔记库磁盘上。这与「以磁盘为准」一致，但别指望从 `lectureHistory` 恢复旧版。

### 4.7 pointId 里嵌了 revision

`knowledge-points.js:33`：

```js
out.push({ id: `${record.courseId}:${record.subId}:${revision}:${ci}:${ti}`, ...
```

而 `revision = record.lecture?.revision ?? record.sourceVersion ?? record.fetchedAt`（第 20 行），每次生成都是新 UUID。

⚠️ 后果：**题目与某一版讲义绑定**。重新生成后旧题目的 pointId 就对不上了。这是既有设计，本次不改，但第 6 步的测试要小心别被它绊到。

---

## 五、验证方式速查

```bash
# 全部讲义相关测试（应 60 条全过）
node --test tests/handout-codec.test.mjs tests/handout-version.test.mjs \
  tests/handout-store.test.mjs tests/handout-discipline.test.mjs \
  tests/handout-notes-archive.test.mjs tests/vault-notes.test.mjs

# 单个文件
node --test tests/handout-codec.test.mjs

# 确认包里没有真 IO（应当只匹配到注释）
grep -rn "node:fs\|node:path" packages/dsh-zhiyun-core-handout/src/
```
