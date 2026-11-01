# ATTRIBUTION — dsh-zhiyun-core-classroom-vault

本包是 [OpenMAIC](https://github.com/THU-MAIC/OpenMAIC) **持久化层**的移植，按上游 SQL / TS 的语义
重写成本仓的本地文件存储（文件头标 `// 源：…:<行范围>`），**不含逐字节副本**。

| 项 | 值 |
| --- | --- |
| 上游仓库 | https://github.com/THU-MAIC/OpenMAIC |
| 上游版本 | v1.3.0 · commit `03dee2bb4e1bf2e3296ad05ca1f78ce863452921` |
| 许可证 | MIT（Copyright (c) 2026 THU-MAIC） |
| 本包 `vendor/` | **无** |

## 移植范围

| 本仓文件 | 上游来源 |
| --- | --- |
| `src/store.js`（表结构、幂等命令、rev 语义） | `lib/persistence/*.ts`（400+ 处 SQL 的语义来源）；`packages/@openmaic/storage/src/{document,asset,material}/pg.ts` |
| `src/paths.js`（路径段校验、复合 id 拆分） | `packages/@openmaic/storage/src/` 的主键约定 |
| `src/index.js` | `lib/persistence/generation-runs.ts` |

## 改动（这是本包与上游差别最大的一处）

**存储后端完全不同**：上游是 PostgreSQL，本包是本地文件（JSON + 目录树）。因此：

- 表结构、主键分段、`generation_run_*` 的字段口径**沿用上游语义**；
- 但**没有**实现 SQL、事务、`rev` 触发器的数据库侧行为 —— 幂等与并发控制在文件层重新实现；
- 「进程重启后 run 仍可见」在上游靠数据库，本仓靠落盘文件；
  **事件日志只在内存**，重启后 `resume()` 仍可用但历史事件会丢（已在 `status().detail` 里写明）。

⚠ 这意味着**不能**把本包当作上游持久化层的等价替代来核对数据迁移；两者只在语义层对齐。

## 升级流程

1. 按新 commit 重新拉取 `ref/OpenMAIC/`；
2. 对照 `lib/persistence/` 与 `packages/@openmaic/storage/` 检查表结构与字段口径；
3. 跑 `node --test tests/vault-*.test.mjs tests/classroom*.test.mjs`。
