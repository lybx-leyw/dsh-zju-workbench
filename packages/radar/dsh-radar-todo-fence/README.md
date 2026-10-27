# dsh-radar-todo-fence

> ⚠️ **候选骨架：未评审、未接入 profile、不可直接使用。**
> 本目录由每日「生态雷达」生成（2026-10-25 / r67，B 组·浙大场景）。
> 所有入口在 TODO 完成前一律抛 `FenceNotImplemented`，被误挂载会立刻报错而不是静默生效。

## 一句话

给「今天 / 规划」页已经消费的那一份学在浙大待办 `rows` 补一层**可复核的来源与完整性元数据**，
让「今天真没事」与「今天读不到数据」不再长得一样。

## 集成性质：强化式集成（判据③ 部分成立，如实标注）

| 判据 | 结论 |
| --- | --- |
| ① 仍是同一个面板 | ✅ 「今天」页与「规划」页消费的仍是 `source-campus` 给的那份 `rows`，本包**不新增页面、不重新抓取** |
| ② 功能相似且正交 | ✅ 现有代码回答「抓什么」（`todosFast` / `todos`），本包回答「抓到的这份能不能信」 |
| ③ 底层多调了更优质实现 | ⚠ **部分成立**：类型判定表取自 `8eoyw/zju-learning-cli`（MIT）真机枚举，**但上游是脚本不是库**，不存在「调用它得到更好结果」这回事 |

> 判据③ 不成立到位，所以按 r65 先例本骨架**只作对照物**，不宣称可直接落地。
> 这也是它判 🟢 而非 🟡 的唯一争议点 —— 请评审优先裁决这一点。

## 为什么需要它（本轮的三个实证）

见 `docs/ecosystem-radar/2026-10-25-r67.md` §3。摘要：

| # | 现象 | 实测 |
| --- | --- | --- |
| F-1 | `diffTodos()` 的「漏没漏」阈值 `type !== 'classroom'` 建立在一个**仓库里不存在**的词（`TODO_TYPE_CN`）上 | `grep -rn TODO_TYPE_CN .` 只命中文档自己一行；第三方 MIT 源码显示真机活动类型至少 13 种 |
| F-2 | `isPendingTodo` 的第一道闸 `published !== true`，而对照实现（ZLA）**完全不读** `published` | `published: undefined` → `false`（整课静默清零），`published: true` → `true` |
| F-3 | 默认 `fast` 模式把 slow 的「逐端点降级」换成了「整包失败」 | 同一类 403：slow 保住 1 条作业，fast 抛 `FORBIDDEN` → 上层 `rows=[]` 全部清零 |

## 上游

| 项 | 值 |
| --- | --- |
| 上游 | [`8eoyw/zju-learning-cli`](https://github.com/8eoyw/zju-learning-cli) ★14 |
| 作者 | 8eoyw（部分移植自 PeiPei233/zju-learning-assistant） |
| 许可 | **MIT** ✅（`LICENSE` 1,137 B，逐字读过，无附加限制） |
| 取用 | **只读契约、不取代码**：只借「真机上有哪些活动类型」这一事实，见 `ATTRIBUTION.md` |
| 可锁版 | **无**（Python 单文件脚本，npm 上不存在对应包；本包 `dependencies` 为空） |

## 待拍板（评审）

1. **判据③**：接受「只作对照物」，还是要求先找一个**真正可调用**的实现（若要求，本轴应退回 🔵，不出骨架）。
2. **L-12**：`type !== 'classroom'` 是改成白名单（只 `homework/quiz/exam` 计入漏），还是先补 `TODO_TYPE_CN` 的出处？
3. **L-13**：`fast` 失败时是否降级到 `slow` 跑一次（成本 5N 但只在失败时发生）？

## 不做

- 不搬 `zju.py` 任何代码；不内置登录；不改 `fast/slow` 默认值（产品决策）。
- 不接 `profiles/zhiyun-bench/package.json`（候选包一律不接 profile）。
