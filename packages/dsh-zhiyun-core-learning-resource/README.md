# dsh-zhiyun-core-learning-resource

智云 Pro **标准学习资源层**：一份资源（讲义 / 阅读材料 / 题源）在这套仓库里长什么样、
怎么校验、怎么算缓存键、怎么投影给 DeepTutor 上游，以及**产出的题目怎么回到来源**。

本包是**纯函数包**：不落盘、不读环境变量、不碰宿主存储、不依赖任何宿主服务
（`inject: []`）。落盘是宿主侧 `packages/dsh-zhiyun-host-deeptutor/src/resources.js` 的事
—— 只有那边知道数据目录在哪。

契约真源：[`contracts.md`](../../packages/dsh-zhiyun-host-deeptutor/docs/contracts.md) 的
§6（schema）、§11（服务和 Resources 子面）、§13（模块导出签名）。

---

## 模块地图

| 文件 | 职责 | 关键导出 |
| --- | --- | --- |
| `schema/learning-resource.v1.json` | schema v1 真源（2020-12）。**只读**，由 Lead 维护 | —— |
| `src/validate.js` | 零依赖 JSON Schema 子集校验器 | `validate`、`assertValid`、`formatErrors`、`loadSchema`、`KNOWN_KEYWORDS` |
| `src/hash.js` | 规范序列化 + sha256 → `contentHash` / `revision` | `canonicalJson`、`contentHash`、`revisionOf`、`stamp`、`hashOf`、`contentOf` |
| `src/project.js` | `chapters → topics → blocks` 投影成上游紧凑结构 + 锚点反查 | `project`、`lookupAnchor` |
| `src/anchors.js` | `sourceAnchors` 的规范化索引（按 id / topic / 页码三种取法） | `anchors`、`buildAnchorIndex`、`normalizeAnchor` |
| `src/sources.js` | 从既有讲义结构造 bundle（丢掉写作态字段） | `fromLecture`、`resourceIdFor`、`describeResource`、`lectureBlockType` |
| `src/index.js` | Cordis 插件壳 | `name`、`inject`、`apply` |

宿主侧配套：`packages/dsh-zhiyun-host-deeptutor/src/resources.js`
（`createResourceRegistry` / `toUpstreamResourcePayload`）。

---

## 三条不能退让的约束

### 1. 校验：报准位置，一次报全

错误带 **JSON Pointer** 路径，并**一次收齐全部错误**：

```js
import { validate, formatErrors } from 'dsh-zhiyun-core-learning-resource/validate';

const { valid, errors } = validate(bundle);
// errors: [{ path: '/chapters/0/topics/1/title', keyword: 'minLength', message: '…' }]
if (!valid) console.error(formatErrors(errors)); // 前若干条拼成一行中文
```

校验器实现了 schema 实际用到的关键字（`type` 含数组、`enum`、`const`、`required`、
`additionalProperties`、`properties`、`items`、`$ref`、`pattern`、`minimum`/`maximum`、
`minLength`/`maxLength`、`format`），并在**加载 schema 时**做关键字白名单检查：
schema 出现了本校验器没实现的关键字会直接抛错。

> 为什么要有白名单：上游给 schema 加一个关键字、而校验器不认识它，
> 结果是校验**静默变松** —— 一份本该被拒的资源顺利进了快照，之后所有人都当它是好的。

### 2. 缓存键：对键序不敏感、对内容敏感

```js
import { contentHash, revisionOf } from 'dsh-zhiyun-core-learning-resource/hash';

contentHash(a) === contentHash(b);  // a 与 b 内容相同、键序不同
```

- `canonicalJson(value)`：递归按键排序 + 稳定 JSON（无空格）。
  语义约定：**`undefined` 被丢弃，`null` 保留** —— 否则 `subId: undefined` 与
  `subId: null` 会打出两个哈希，同一份终稿在两台机器上 revision 不同，运行指纹随之失效。
- `contentHash` = sha256(规范化后的**内容**)，**排除** `revision` / `contentHash` / `generatedAt`
  三个派生字段。把它们算进去等于让哈希依赖自己，且每次重新生成都换缓存键。
- `revision` = sha256(内容哈希 + 资源身份 `{schemaVersion, resourceId, accountScope, courseId, subId}`)。
  身份为什么也算：快照路径是 `<revision>.json`，**一条路径只能有一份内容**；
  两个账号恰好投影出同样的空讲义时不能让它们互相顶掉。
- `stamp(bundle)`：补齐三个派生字段并返回**新对象**（不改原对象）。

### 3. 投影：来源定位链的落点

```js
import { project, lookupAnchor } from 'dsh-zhiyun-core-learning-resource/project';

const { text, blocks, anchorIndex, stats, warnings } = project(bundle);
const { anchor, block } = lookupAnchor({ anchorIndex, blocks }, 'a1-1-1');
// anchor → { topicId, blockId, page, timeRange: { startMs, endMs }, assetRef, confidence, origin }
// block  → 那块正文（UI 要高亮它，只给页码不够）
```

- `text`：纯文本，每个块前带 `[blockId]`，块号就是反查的钥匙。
- `blocks`：分块结构（`type` / `text` / `assetRef` / `anchorIds` / `topicId` / `blockId` / `meta`）。
- `anchorIndex`：`anchorId → { topicId, blockId, page, timeRange }`。

**为什么投影必须带 `anchorIndex`**：DeepTutor 的产出（题目、追问、讲解）要能回到讲义的那一页、
那一秒。投影若把锚点吞掉，之后的任何一层都补不回来 —— 所以 `anchorIndex` 是一等公民，
且连**没有落到任何块上的锚点**（上游只给页码的场合）也要进索引。

选择器：`selectedTopicIds` / `selectedRanges` 为空 = 全量（契约 §6）。非空时只投影选中部分，
索引里不留"索引有、正文无"的假锚点。

---

## 宿主侧：不可变快照

```js
import { createResourceRegistry } from '../dsh-zhiyun-host-deeptutor/src/resources.js';

const registry = createResourceRegistry({
  dataDir,                       // 快照落在 <dataDir>/snapshots/
  validate,                      // 必填（惰性调用）
  contentHash,                   // 必填（惰性调用）
  logger,
});

const handle = await registry.attach(bundle);
// { handleId: 'rh_…', resourceId, revision, snapshotPath, accountScope, courseId, subId, … }
```

- **先校验、再落盘**：不通过就抛，快照目录连碰都不碰（不留半个快照）。
- **快照不可变**：`flag: 'wx'` 独占创建；`EEXIST` → 同 revision 已有副本，**复用不重写**。
- **revision 永远重算**，不沿用调用方给的值 —— 否则可能把**另一个 revision 名下的旧快照**
  当成这份资源的正文交出去（缓存命中变缓存污染，而且 revision 看起来完全合法，出错时零线索）。
- `release` **只摘句柄、不删快照**：另一个 run 可能正拿着同 revision 的 handle 读同一份文件。
  磁盘清理是显式维护动作 `prune()`。
- `validate` / `contentHash` 缺失时**构造期就抛**，不静默降级成"不校验直接落盘"。

快照文件名里的冒号：`revision` 形如 `sha256:<64 hex>`，而 Windows 文件名不允许 `:`
—— `snapshotFileName('sha256:' + 'ab'.repeat(32))` → `sha256-abab….json`，
在本 schema 的 revision 形状上单射（`sha256` 前缀不含 `-`，不会撞名）。

---

## 从既有讲义投影

```js
import { fromLecture } from 'dsh-zhiyun-core-learning-resource/sources';
import { stamp } from 'dsh-zhiyun-core-learning-resource/hash';

const bundle = stamp(fromLecture({
  lecture,                                        // core-lecture 的成稿讲义
  courseId, subId,
  accountScope: { accountId, workspaceId: null },
}));
```

两条取舍：

- **只投影正文，不投影写作态**。`passages` / `register` / `draft` / `notes` 不进 bundle：
  `revision` 是派生资源的缓存键，语气判定抖动一次就重算全部题目是不可接受的。
- **id 由结构位置派生**（`ch1` / `t1-2` / `b1-2-3` / `a1-2-3`），只依赖顺序。
  同一份讲义两次投影必须得到同一个 `resourceId` 与 `revision`；改标题不会把块 id 全换掉。

块类型映射（`LECTURE_BLOCK_TYPE_MAP`）：

| 讲义 `kind` | schema v1 `type` |
| --- | --- |
| `elaboration` | `paragraph` |
| `definition` | `callout` |
| `procedure` | `list` |
| `example` | `question` |
| `note` | `callout` |

认不出的块类型当 `paragraph`（丢内容比错类型严重）；空正文块跳过并记 `EMPTY_BLOCK` 告警。

---

## Cordis 插件

```js
export const name = 'zhiyun-learning-resource';
export const inject = [];
export function apply(ctx, config = {});
// ctx.provide('zhiyunLearningResource', { schema, validate, contentHash, project, anchors, … })
```

`inject` 是空数组而不是省略：全是纯函数，不依赖宿主任何服务 —— 让"本包不拖慢启动"在启动图谱上直接可见。

宿主 `host-deeptutor` 用**惰性闭包**接它（bundle 加载顺序不保证，
core-learning-resource 可能在 host-deeptutor 之后才加载）：

```js
validate: (bundle) => ctx.get('zhiyunLearningResource').validate(bundle),
contentHash: (value) => ctx.get('zhiyunLearningResource').contentHash(value),
```

---

## 测试

```bash
node tests/learning-resource.test.mjs
# 或（本沙箱下 node --test 会 spawn EPERM）
node --test --test-isolation=none tests/learning-resource.test.mjs
```

覆盖：合法 bundle 通过；缺必填 / 多余字段（含 `$ref` 嵌套层）/ 类型错 / `pattern` 错 /
`$ref` 嵌套错 各报对 JSON Pointer；一次收齐全部错误；键序不同 → 同 hash；任一处内容变化 →
不同 hash；`revision` 随资源身份变化；`project()` 的 `anchorIndex` 能反查 `topicId/blockId/page/timeRange`；
orphan 锚点不被吞；选择器只投影选中部分；attach 幂等 / 校验失败零落盘 / release 不删快照。

---

## 本包刻意不做的事

- **不落盘**：快照、账本、证据都在宿主侧。
- **不读环境变量**：`dataDir` 由宿主给。
- **不 import 业务包**（反过来也一样：宿主 `resources.js` 不 import 本包，靠注入）。
  宿主 `host-deeptutor` 是本仓最重的包（vendor + Python 运行时），
  让它反向依赖一个纯数据校验包只为省两个参数，会让 `resources.js` 永远无法被单独取用。
- **不做 UI**。
