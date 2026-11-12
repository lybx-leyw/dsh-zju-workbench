# @lybx-leyw/dsh-zju-tool-write-kit

校园写操作的**共享底座**。不是能单独挂的插件 —— 它没有 `apply()`、没有
`cordis.patch.yml`、不注册任何工具。

它只提供两样东西，给按域拆开的写工具包共用：

| 导出 | 作用 |
| --- | --- |
| `guardWrite` / `requireApproval` / `WriteRejected` / `WRITE_CODES` | 审批封装。只有 `allowed-once` 放行，其余一律 fail closed |
| `createWriteToolRegistrar` | 把纯数据的工具定义包成宿主能注册的形状，接好 source 的 prepare / execute / cancel 三段 |

## 为什么审批只能有一个入口

若让每个工具自己写「先 request 再 act」，忘掉一次就是一次**无审批写入**，
而那种漏洞不会表现为报错 —— 它表现为「某天有人发现作业被交了」。

## 为什么 source 契约里有 `cancel`

用户可能点了拒绝，也可能审批超时 / 中止 —— 那时 `execute` 永远不会被调用，
而 `prepare` 已经把参数存进了 source 的写会话。若不撤销，下一次 `prepare`
会撞上 `WRITE_BUSY`，**这个动作此后一直不能用**（直到重启进程）。

拒绝不等于封锁：撤销之后立刻可以重新准备、重新问用户。

## 谁在用

`packages/tool/{zdbk,sztz,tyys,xuezai,pta,cc98,lab}` —— 每个一个域。