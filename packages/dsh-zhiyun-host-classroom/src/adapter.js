/**
 * 存储适配层（规范第 3 通道）。**本文件只有接口与映射说明，没有实现。**
 *
 * # 为什么要单独一个文件
 *
 * 上游 `lib/persistence/` 与 `lib/store/` 里散着 400+ 处 SQL（`@openmaic/storage`
 * 的 `Queryable` 端口）。规范第 3 通道要求：**SQL 语义保留，driver 换成 `ctx.vault`，
 * 且不许在业务里散写 IO**。于是所有"怎么落盘"的问题都必须收敛到这一个文件：
 * 业务代码只调 `zhiyunClassroomStudio.classroom.load()` 这一层，它再调本文件的端口。
 *
 * # ⚠️ 落地前必须先解决的一件事（会阻塞 L2）
 *
 * 规范 §2 写着"driver 换成 `ctx.vault`（本仓既有）"。**本仓没有 `ctx.vault` 这个服务。**
 * 全仓 grep `ctx.vault` / `provide('vault'` 零命中；与之名字最接近的是
 * `dsh-zhiyun-core-vault` 提供的 `zhiyunVault`（笔记库，`src/host.js`），它的接口是
 * "笔记的索引与查询"，**没有事务、没有行级写、没有 owner 分区**。
 *
 * 所以在有 `ctx.vault` 之前，本文件只能声明端口。三种可能，必须先选一种再动手：
 *
 * 1. 新增宿主服务 `vault`（真做 SQL 语义：事务 + 行锁 + 键集分页）；
 * 2. 复用 `zhiyunVault` 并扩展它（会把它从"纯笔记"变成"通用存储"，影响两个既有包）；
 * 3. 让 `dsh-zhiyun-core-classroom-vault` 直接持 `pg`（违反第 3 通道"不许散写 IO"的初衷，
 *    但只需要一个 driver 名字对齐）。
 *
 * 这一条已写进 `ROUTES.md` 的「契约缺口」小节与交付报告。
 *
 * # SQL → 端口的映射表
 *
 * | 上游 SQL | 语义 | 本端口 |
 * |---|---|---|
 * | `SELECT ... FROM <t> WHERE owner_id=$1 AND id=$2` | 按 owner + 主键取一行 | `readOne(table, ownerId, id)` |
 * | `SELECT ... WHERE owner_id=$1 ORDER BY updated_at DESC, id DESC LIMIT $2` | 键集分页 | `readPage(table, ownerId, { limit, before })` |
 * | `INSERT ... ON CONFLICT (owner_id, id) DO UPDATE` | 幂等写 | `upsert(table, ownerId, row)` |
 * | `UPDATE ... SET ... WHERE owner_id=$1 AND id=$2 AND rev=$3` | 乐观锁 | `updateIfRev(table, ownerId, id, rev, patch)` → 返回新 rev 或 `null` |
 * | `DELETE ... WHERE owner_id=$1 AND id=$2` | 删除（含墓碑） | `remove(table, ownerId, id)` |
 * | `BEGIN … COMMIT`（多表一致性写） | 事务 | `transaction(async (tx) => …)` |
 * | `LISTEN/NOTIFY stage_rev` | 变更推送 | **无映射**：上游已经用轮询兜底（见 `app/api/stages/[id]/freshness/route.ts:1-25` 的注释） |
 * | `SELECT COUNT(*) … WHERE owner_id=$1`（配额） | 配额检查 | `count(table, ownerId)` |
 *
 * ## 三条不能丢的语义
 *
 * 1. **owner 分区是强制的，不是可选过滤**：上游每个 store 都以 `owner_id` 为前缀，
 *    漏掉就是跨用户读。端口签名里 `ownerId` 是**必填位置参数**，不给默认值。
 * 2. **`rev` 单调递增由存储维护**（触发器），不是应用算的；`updateIfRev` 返回 `null`
 *    即表示"别人先写了"，业务必须把它翻译成 `409 CONFLICT` 而不是重试。
 * 3. **写入的原子性**：上游 `createFolderForOwner` 之类在**同一个事务里**做"判重 + 插入"
 *    （见 `lib/server/folder-persistence.ts`）。端口若拆成两步就必然出现竞态，
 *    所以 `upsert` 必须是单次调用。
 */

import { notImplemented } from './errors.js';

/** 端口方法清单（顺序即依赖顺序）。L2 的实现必须**一个不少**地提供。 */
export const ADAPTER_METHODS = Object.freeze([
  'readOne',
  'readPage',
  'upsert',
  'updateIfRev',
  'remove',
  'count',
  'transaction',
]);

/**
 * 建一个**空壳**适配器。
 *
 * 刻意不写成 `class` 抽象基类：本仓没有"必须继承"的基类传统，
 * 而且测试要能塞一个 `{ readOne: async () => … }` 的字面量进去。
 *
 * 每个方法都抛 `E_NOT_IMPLEMENTED`，并在 `detail.source` 里指到上游对应的
 * persistence 模块 —— 这样"实现到一半"与"完全没实现"在错误里是分得开的。
 *
 * @param {object} [deps] 预留：将来的 `{ vault, clock, newId }`
 */
export function createVaultAdapter(deps = {}) {
  const bind = (method) =>
    async function unimplemented() {
      void deps;
      throw notImplemented(
        `adapter.${method}`,
        'lib/persistence/ + lib/store/（见本文件头注的映射表）',
      );
    };

  return {
    /** 端口自称：`'keyset'` = 支持键集分页（上游唯一用到的分页方式）。 */
    kind: 'keyset',
    /** `false` = 空壳。业务层据此决定是否提前报错，而不是等第一次读写才炸。 */
    ready: false,
    readOne: bind('readOne'),
    readPage: bind('readPage'),
    upsert: bind('upsert'),
    updateIfRev: bind('updateIfRev'),
    remove: bind('remove'),
    count: bind('count'),
    transaction: bind('transaction'),
  };
}

/**
 * 校验一个外部塞进来的适配器是否满足端口。
 *
 * 只在 `apply()` 里用，且**永不抛**：缺方法就返回缺失清单，由 `status()` 如实报出来。
 *
 * @param {unknown} adapter
 * @returns {string[]} 缺失的方法名
 */
export function inspectAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object') return [...ADAPTER_METHODS];
  return ADAPTER_METHODS.filter((name) => typeof adapter[name] !== 'function');
}
