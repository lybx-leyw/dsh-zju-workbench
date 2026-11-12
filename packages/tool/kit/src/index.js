/**
 * `@lybx-leyw/dsh-zju-tool-kit` —— 校园**读**类工具的共享底座。
 *
 * # 它是什么，不是什么
 *
 * 它是一个**库**，不是一个能单独挂的插件：没有 `apply()`，没有 `cordis.patch.yml`，
 * 也不注册任何工具。它只提供两样东西，给按域拆开的读工具包共用：
 *
 * 1. **参数校验小件**（`inputError` / `str` / `optStr` / `optBool` / `optInt` /
 *    `serviceLookup`）——「必填字符串」「可选整数」这类判据每个包都会写一遍，
 *    写第二遍就开始漂；
 * 2. **读工具注册器**（`createReadToolRegistrar`）—— 把纯数据的读工具定义包成
 *    宿主能注册的形状，并在每次执行时重新查一次 source 服务。
 *
 * # 为什么读与写要分开两个底座
 *
 * 写工具必须过审批（`tool/write-kit` 的 `guardWrite`），读工具**必须不过** ——
 * 给「查课表」配一个批准对话框，会让用户养成一路点同意的习惯，等到真的要
 * 选课、交作业时，那次点击就没有意义了。两件事共用一条注册链的后果是：
 * 某天有人为了省事把审批也套在读工具上，而测试里看不出来。
 *
 * 参数判据是同一条，所以 `tool/write-kit` 从这里**转出**它们，不复制一份。
 */

export { inputError, str, optStr, optBool, optInt, serviceLookup, defined } from './args.js';
export { createReadToolRegistrar, readTool } from './register.js';
