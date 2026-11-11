# ATTRIBUTION · dsh-radar-cc98-ubb-ast

本骨架**未包含任何上游源代码**，仅在 README / `src/index.js` 的 `PROPOSED_TAG_MAP`
中**转述**了上游的标签名称与语义（为保证归属准确性而记录于此）。

| 项 | 值 |
| --- | --- |
| 上游项目 | Griseous — An alternative frontend for Zhejiang University CC98 Forum |
| 仓库 | https://github.com/CoolSpring8/griseous |
| 作者 | CoolSpring8 |
| 许可证 | **MIT License** — `Copyright (c) 2021 CoolSpring8` |
| 参照提交 | `master` 分支，2022-07-07 最后一次推送（`push 2022-07-07`） |
| 参照文件 | `src/utils/Ubb.ts`（213 行）、`src/utils/boardInfoJson.ts`（14 KB） |
| 使用方式 | **仅参照语义，未复制代码** |

上游 `src/utils/Ubb.ts` 首行声明其来源为：

```
// https://github.com/ZJU-CC98/Forum/blob/dev/CC98.Forum/CC98.Forum/Ubb/UbbCodeExtension.tsx
```

即 CC98 官方论坛客户端的 UBB 扩展实现。**后续若有任何代码级移植**，
需同时核对 `ZJU-CC98/Forum`（Apache-2.0）与 `griseous`（MIT）两处的归属要求，
并在本文件追加对应段落与提交哈希。

## 未来移植时的强制要求

若评审通过并开始实现：

1. 保留 `Copyright (c) 2021 CoolSpring8` 与 MIT 全文；
2. 在派生文件头部注明来源路径与**提交哈希**（而非分支名 —— 上游已停更，分支名不可靠）；
3. 不引入上游的客户端代码（`src/pages/*`、`src/components/*`、`src/store.ts`）；
4. 若同时参照 `ZJU-CC98/Forum`（Apache-2.0），需另附其 `NOTICE`。
