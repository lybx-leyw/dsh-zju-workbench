# ATTRIBUTION · dsh-radar-notify-capability

本骨架**未包含任何上游源代码**，也没有锁版引入任何上游包。
本文件只记录「为什么把它列为本轮候选」的依据，以及**将来**若真的要移植时的归属要求。

| 项 | 值 |
| --- | --- |
| 上游项目 | `plugins/notifications`（dsh-public-plugins monorepo 内的单插件） |
| 仓库 | https://github.com/bertholomus/dsh-public-plugins |
| 许可证 | **MIT**（仓库 `/LICENSE`，本轮**未读实文**，仅据仓库扫描结果；评审时必须补读） |
| npm 包 | **`dsh-plugin-notifications` —— 查询 404，未发布** |
| 使用方式 | **仅参照问题形态，未复制任何代码，未锁任何版本** |

## 为什么「未发布」反而是它被选中的原因

本仓已有的两个通知骨架都卡在同一处：

- `packages/radar/dsh-radar-zone-notify/src/upstream.js` 第 16 行声明依赖 `dsh-plugin-notifications`，
  第 81 行注释记明 `registry.npmjs.org/dsh-plugin-notifications → 404`；
- `packages/radar/dsh-radar-notify-push/src/index.js` 第 16 行写了同一句结论：
  「`dsh-plugin-notifications` 至今未发布到 npm ⇒ 那个骨架锁不住版、跑不起来」。

也就是说：**通知方向卡住的不是能力，而是「锁版」这个前提本身**。
`dsh-radar-notify-capability` 换掉了这个前提 —— 它不依赖任何上游包，
只回答「你现在这条通道能走到哪一级」这一个问题，因此**可以零锁版落地**。

## 未来移植时的强制要求

若评审通过并开始实现：

1. 不引入 `dsh-plugin-notifications`（npm 上不存在，无法锁版），也不复制其代码；
2. 若最终改为 A 类（上游补发了 npm 包），必须在 `package.json` 的 `dependencies` 里
   **写死精确版本**（禁 `^ ~ >=`），并把本文件改为标准 A 类归属表；
3. 保留上游 `Copyright` 与 MIT 全文，并在派生文件头部注明来源路径与**提交哈希**。
