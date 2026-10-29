# ATTRIBUTION

本包是**候选骨架**，仅引入上游作为依赖，**未复制、未改写任何上游源码**。

| 项 | 值 |
| --- | --- |
| 上游项目 | `clientside-search` |
| 仓库 | https://github.com/kyr0/clientside-search |
| 作者 | kyr0（Kyrylo Silin 之外的另一位 kyr0，见仓库页） |
| 许可证 | MIT（仓库 `LICENSE` 1069 B，GitHub `/license` 与 npm `license` 双源一致） |
| 引入版本 | `1.8.1`（写死，不用 `^`） |
| 引入方式 | `package.json` 的 `dependencies`，**只作为依赖** |
| 复制源码 | **无** |

## 使用时须遵守

- MIT 要求在再分发时保留版权声明与许可全文。本仓以 npm 依赖形式引入，
  上游 `LICENSE` 随包分发（`node_modules/clientside-search/LICENSE`），
  因此**无需**在本仓另存一份；若将来评审决定 **vendor 而非依赖**，必须同时复制 `LICENSE`。
- 上游 README 声明的能力是「多语言全文检索」；本包 README 的实测结论（**无中文分词**、
  **同分并列**）是**本仓实测**，不代表上游的承诺，引用时须标明来源为本轮 E-1 ~ E-5。

## 待评审确认

- 若评审后决定把上游源码内联进本包（会违反本 skill「不搬运上游源码」的硬边界），
  本条须改写并**在评审记录里显式豁免**，否则应维持「只依赖、不复制」。
