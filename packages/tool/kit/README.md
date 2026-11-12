# @lybx-leyw/dsh-zju-tool-kit

校园**读**类工具的共享底座。不是能单独挂的插件 —— 它没有 `apply()`、没有
`cordis.patch.yml`、不注册任何工具。

| 导出 | 作用 |
| --- | --- |
| `inputError` / `str` / `optStr` / `optBool` / `optInt` / `defined` | 参数判据（必填字符串、可选整数、去掉 undefined） |
| `serviceLookup` | 取 source 服务；缺了就说清装哪个包（`SERVICE_MISSING`） |
| `createReadToolRegistrar` | 把纯数据的读工具定义包成宿主能注册的形状 |

## 为什么读与写要分开两个底座

写工具必须过审批（`tool/write-kit` 的 `guardWrite`），读工具**必须不过**。

给「查课表」配一个批准对话框，会让用户养成一路点同意的习惯 —— 等真的要选课、
交作业时，那次点击就没有意义了。两件事共用一条注册链的后果是：某天有人为了
省事把审批也套在读工具上，而**测试里看不出来**（审批照样能通过）。

所以：`createReadToolRegistrar` 里**没有任何审批调用**，`tests/tool/reads` 里
有一条断言守着「读工具的 execute 不请求审批」—— 它走宿主注册出来的那个对象，
不是直接调 `run()`，否则绕过注册器就测不到（这条曾经确实测不到）。

## 参数判据为什么只有一份

`tool/write-kit` 从这里**转出** `inputError` / `str` / `optStr` / `serviceLookup`，
不复制一份。两处各写一份时它们会漂：一个包把空串当「没给」、另一个当成错误，
模型于是在两个同名参数上得到相反的反馈。

## 谁在用

| 包 | 读工具 |
| --- | --- |
| `tool/zdbk` | `campus_zdbk_read` |
| `tool/xuezai` | `campus_xuezai_read` |
| `tool/cc98` | `campus_cc98_read` |
| `tool/pta` | `campus_pta_read` |
| `tool/sztz` | `campus_sztz_read` |
| `tool/tyys` | `campus_tyys_read` |
| `tool/lab` | `campus_lab_read` |
| `tool/classroom` | `campus_classroom_read` |
| `tool/notice` | `campus_notice_read` |
| `tool/chalaoshi` | `campus_chalaoshi_read` |
| `tool/ebook` | `campus_ebook_read` |
| `tool/yjsy` | `campus_yjsy_read` |
