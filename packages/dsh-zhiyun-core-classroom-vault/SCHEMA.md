# 课堂持久层：上游表 → 本地文件

> 本文件是 `dsh-zhiyun-core-classroom-vault` 的**存储契约**。表结构照
> `ref/OpenMAIC/packages/@openmaic/storage/src/**` 一比一落地，只是把
> PostgreSQL 的行换成了文件。改布局先改这里。

## 1. 根与布局

```
<profile>/data/zhiyun-classroom/            # 与 host-classroom 同一个数据根
├── classroom/<stageId>/
│   ├── meta.json                           # document_stages 一行
│   ├── stage-meta.json                     # stage_meta 一行
│   ├── outline.json                        # document_outlines 一行（有才写）
│   ├── scenes/<order>-<sceneId>.json       # document_scenes 一行（order 补零 6 位）
│   ├── assets/
│   │   ├── entries/<assetId>.json          # asset_entries 一行
│   │   ├── refs/<scope>-<sceneId>-<assetId>.json   # document_asset_refs 一行
│   │   └── blobs/<sha256>                  # asset_blobs.bytes（内容寻址，同内容只存一份）
│   └── snapshots/<seq>.json                # lib/store/snapshot.ts 的 undo/redo 历史
├── folders/<folderId>.json                 # document_folders 一行
├── runs/<runId>/
│   ├── run.json                            # generation_runs 一行
│   ├── steps/<stepId>.json                 # generation_run_steps 一行
│   ├── events/<seq>.json                   # generation_run_events 一行
│   └── commands/<commandId>.json           # generation_run_commands 一行
├── materials/<sessionId>/<materialId>.json # agent_session_materials 一行
└── kv/<scope>/<sha256(key)>.json           # KVStore 一个键（scope = account | device）
```

**复合主键**在端口里写成 `<父>/<子>`（与上游主键列顺序一致），例如场景是
`<stageId>/<sceneId>`，资产是 `<stageId>/<assetId>`。

## 2. 表 → 文件 → 字段

| 上游表（DDL 出处） | 本地文件 | 字段映射 |
|---|---|---|
| `document_folders`（`document/pg.ts:200-215`） | `folders/<id>.json` | `owner_id→ownerId`、`normalized_name→normalizedName`、`folder_order→order`、`created_at/updated_at→毫秒数`；另加存储维护的 `rev` |
| `document_stages`（`document/pg.ts:217-233`） | `classroom/<id>/meta.json` | `id/name/description/interactive_mode→interactiveMode/task_engine_mode→taskEngineMode/created_at/updated_at/folder_id→folderId`；JSONB `data` **展开成平铺字段**（`Stage` 形状），DSL 版本戳写根上的 `dslVersion`；附加 `sceneCount`（列表页不必解码） |
| `document_scenes`（`document/pg.ts:235-244`） | `classroom/<stageId>/scenes/<order>-<id>.json` | `stage_id→stageId`、`scene_order→order`（同时进文件名）、JSONB `data` 展开为平铺字段 |
| `document_outlines`（`document/pg.ts:246-249`） | `classroom/<stageId>/outline.json` | `{ id, outline }`，`outline` 原样存，不校验不迁移（上游同语义） |
| `stage_meta`（`lib/persistence/stage-meta.ts:24-45`） | `classroom/<stageId>/stage-meta.json` | `stage_id→stageId/owner_id→ownerId/is_public→isPublic/published_at→publishedAt/generation_complete→generationComplete/deleted_at→deletedAt` |
| `document_stage_revision` / `document_scene_revision`（`document/pg.ts:290-300`，触发器维护） | 不单独落文件 | `rev` 直接写在各行根上：`upsert` 时 +1，`updateIfRev` 比对；合并成一行一个计数器而不是两张伴生表 |
| `generation_runs`（`lib/persistence/generation-runs.ts:44-101`） | `runs/<id>/run.json` | 全列保留：`input/state/step/outline/outline_revision/agents/stage_id/scenes_total/scenes_completed/error/seq/lease_worker_id/lease_heartbeat_at/lease_generation/takeovers/media_pending/narration_unvoiced/media_summary/outline_auto_confirm_at/host_attributes`；`created_at/updated_at` 为毫秒数 |
| `generation_run_steps`（同上 `:69-75`） | `runs/<runId>/steps/<stepId>.json` | `{ runId, id: stepId, output, completedAt }` |
| `generation_run_events`（同上 `:77-84`） | `runs/<runId>/events/<seq>.json` | `{ runId, id: String(seq), seq, ts, type, data }`；`seq` 由存储分配，run 行的 `seq` 是最后分配值 |
| `generation_run_commands`（同上 `:86-93`） | `runs/<runId>/commands/<commandId>.json` | `{ runId, id: commandId, type, result, createdAt }`；重复 commandId 返回第一次的结果 |
| `asset_entries`（`asset/pg.ts:200-213`） | `classroom/<stageId>/assets/entries/<assetId>.json` | `principal→ownerId`（本仓按 owner 分区，故用同一个键）、`content_hash→contentHash`、`byte_size→byteSize`、`meta/revision/created_at` |
| `asset_blobs`（`asset/pg.ts:194-199`） | `classroom/<stageId>/assets/blobs/<contentHash>` | `bytes` 就是文件内容；`byte_size` 由 `stat` 得出；`unreferenced_at` 不落（见 §4） |
| `document_asset_refs`（`asset/pg.ts:221-229`） | `classroom/<stageId>/assets/refs/<scope>-<sceneId>-<assetId>.json` | `{ stageId, scope: 'stage'|'scene', sceneId, assetId }`，`scope` 的 CHECK 在写入时校验 |
| `agent_session_materials`（`material/pg.ts:58-88`） | `materials/<sessionId>/<id>.json` | 全列保留（`kind` / `extraction_status` 等枚举写入时校验） |
| `snapshots`（IndexedDB，`lib/store/snapshot.ts:38-120`） | `classroom/<stageId>/snapshots/<seq>.json` | IndexedDB 的 `{ index, slides }` → `{ seq, index, scenes, createdAt }`；上限 20，游标回退时截断后继历史 |
| `KVStore`（`kv/types.ts:10-22`） | `kv/<scope>/<sha256(key)>.json` | `{ key, scope, value, updatedAt }`；`key` 原样存在文件里，文件名用哈希（key 是不受约束的任意字符串，不能当路径） |

## 3. 三条不能丢的语义（上游 `document/pg.ts` 头注 / `adapter.js` 的映射表）

1. **owner 分区是强制的**：每行都带 `ownerId`，读写在比对失败时返回「没有这一行」。
   本仓单机单用户，数据根本身按 profile 隔离，所以 owner 是**字段校验**而非目录分区；
   端口签名里 `ownerId` 仍然是必填位置参数。
2. **rev 单调递增由存储维护**，不是应用算的。`updateIfRev` 返回 `null` 表示
   「别人先写了」，业务必须翻译成 409，不许重试。
3. **写入原子**：所有写都是「同目录随机后缀临时文件（`wx`）→ `rename`」，
   照 `@deepseek-ai/dsh-atomic-write` 的语义（不引依赖，见 `src/fs.js` 头注）。
   整份 `classroom.save` 另外持有一个跨进程写锁 `classroom/<id>/.write.lock`，
   写入顺序是「场景 → outline/stage_meta → meta → 删多余场景」，读者只会看到
   旧 meta（旧场景集）或新 meta（新场景集），不会看到悬空引用。

## 4. 没有落下来的查询语义（按表名）

| 表 / 查询 | 上游位置 | 现状 |
|---|---|---|
| `asset_root_refs` | `asset/pg.ts:247-252` | 未实现。外部根（不属于任何课堂的持有者）引用资产的能力没有；`assets.remove` 只保护 `document_asset_refs`。 |
| `asset_reference_tracking` | `asset/pg.ts:236-239` | 未实现。收集器的「本库在维护引用表」标记不需要：本包不做 GC 扫描。 |
| `document_asset_withdrawals` | `asset/pg.ts:240-245` | 未实现。没有「课堂退休但保留行」这个概念，所以也没有需要跳过的回填。 |
| `asset_blob_stages` | `asset/pg.ts:269-280` | 未实现。上传是同步写 blob 再写 entry，没有「跨上传的长事务」需要 pin。 |
| `asset_entries` 的配额聚合 | `SELECT SUM(byte_size) WHERE principal=$1` | 未实现。没有配额扣减；需要时全表扫 `assets/entries/`。 |
| `agent_session_events` / `agent_session_entries` / `agent_owner_session_event_counters` / `agent_owner_session_events` / `agent_session_urls` | `agent-session/pg.ts:174-235` | 未实现（整张 agent-session 运行时表组）。本包只搬了 `agent_session_materials`。 |
| `agent_user_skill` | `skill/pg.ts:73-90` | 未实现。 |
| `runtime_sessions` / `runtime_records` | `runtime/pg.ts:131-160` | 未实现（运行时引用计数与记录）。 |
| `schema_migrations` / 启动迁移锁 | `pg-migrations.ts:229-260`、`schema-bootstrap-lock.ts` | 未实现。文件布局是版本无关的平铺 JSON，不需要迁移表；代价是**上游加列时这里不会自动跟进**。 |
| `stage_meta` 的公开源查询 | `stage_meta_public_live_idx`（`stage-meta.ts:35-38`） | 只存字段，没有 `is_public AND deleted_at IS NULL` 的专用查询；要列公开课堂只能全扫 `classroom/*/stage-meta.json`。 |
| `generation_runs` 的租约与抢占查询 | `generation_runs_owner_active_idx` / `generation_runs_executable_idx` / `generation_runs_stage_active_idx` | 只存行，没有「跳过活跃 run 抢占」「按 stage 找未完成 run」的 SQL 等价查询；`runs.list({ state })` 是全扫后内存过滤。 |
| `document_folders` 的 `UNIQUE (owner_id, normalized_name)` | `document/pg.ts:212` | 靠 owner 级串行锁 + 内存判重实现（`folders.create`），并发进程之间**没有**唯一性保证。 |
| `LISTEN/NOTIFY stage_rev` | `document/pg.ts:300-340` | 无映射（上游自己用轮询兜底，见 `app/api/stages/[id]/freshness/route.ts:1-25`）。 |
| `BEGIN … COMMIT` 的多表一致性 | 全线 | 降级成「进程内串行 + 写暂存 + 顺序提交」，**失败不回滚**；`updateIfRev` 的乐观锁仍然有效，但它保护的是单行。 |

## 5. 已知取舍

- **不做索引文件**：列表与分页靠扫目录 + 读 JSON。课堂量级是百到千，重算比维护索引便宜，
  也根除「索引与文件不一致」。代价是 `classroom.list` 是 O(课堂数)，大库需要换成按 `updatedAt` 分桶的目录。
- **不是真事务**（见上表最后两行）：跨文件写到一半失败会留下部分新内容；所有单文件永远是完整的。
- **快照不修正倒数第二份的翻页焦点**（`lib/store/snapshot.ts:74-81` 的 PPTist 行为）：
  那是 UI 焦点语义，本包只存 `{ index, scenes }`。
