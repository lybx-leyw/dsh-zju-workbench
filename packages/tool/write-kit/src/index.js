/**
 * `@lybx-leyw/dsh-zju-tool-write-kit` —— 校园写操作的共享底座。
 *
 * # 它是什么，不是什么
 *
 * 它是一个**库**，不是一个能单独挂的插件：没有 `apply()`，没有 `cordis.patch.yml`，
 * 也不注册任何工具。它只提供两样东西，给按域拆开的写工具包共用：
 *
 * 1. **审批封装**（`guardWrite` / `requireApproval` / `WriteRejected`）——
 *    「要不要做」是用户与 agent 之间的事，每个写工具都必须问，而问法只能有一份。
 * 2. **注册器**（`createWriteToolRegistrar`）—— 把一个纯数据的工具定义包成
 *    宿主能注册的形状，并把 source 的 `prepare` / `execute` / `cancel` 三段
 *    接线接对。
 *
 * # 为什么审批必须只有一个入口
 *
 * 若让每个工具自己写「先 request 再 act」，忘掉一次就是一次**无审批写入**，
 * 而那种漏洞不会表现为报错 —— 它表现为「某天有人发现作业被交了」。
 * 所以工具定义里不出现裸的 `act()`，只出现 `guardWrite`。
 *
 * # 为什么 source 契约里有 `cancel`
 *
 * 用户可能点了拒绝，也可能审批超时 / 中止 —— 那时 `execute` 永远不会被调用，
 * 而 `prepare` 已经把参数存进了 source 的写会话。若不撤销，下一次 `prepare`
 * 会撞上 `WRITE_BUSY`，**这个动作此后一直不能用**（直到重启进程）。
 *
 * **拒绝不等于封锁**：撤销之后立刻可以重新准备、重新问用户。
 */

export { guardWrite, requireApproval, describeWrite, WriteRejected, WRITE_CODES } from './approval.js';
export { createWriteToolRegistrar, contractOf, serviceLookup, inputError, str, optStr } from './register.js';
