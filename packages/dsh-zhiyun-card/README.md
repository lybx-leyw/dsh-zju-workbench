# dsh-zhiyun-card

「浙大一卡通」账号密码：**智云课堂与学在浙大共用的唯一凭证来源**。

## 它解决什么

原来这份凭据有两个毛病：

1. **写入点错位** —— 要去「个人」页点一次「连接课堂」才能填账号密码。可学在浙大待办与
   "进课堂上课"是两件不相关的事，用户想看待办却先被要求登录课堂；
2. **读取点各写一份** —— 课堂与校园数据包各自实现"怎么读账号"，规则漂了就会一处能读、
   另一处读不到。

现在：**在设置里配一次，两处都读同一份**。

## 「一卡通」到底指什么

本仓用「浙大一卡通」称呼**浙大统一身份认证账号**：学号 + 密码，也就是 CAS
（`zjuam.zju.edu.cn`）认的那一套。

⚠️ 它**不是**校园卡的消费查询密码。将来若真要接"食堂消费记录"之类，
那是**另一套凭证、另一个记录 id**，不能复用这里。

## 存放位置

宿主凭据服务（`ctx.credentials`）的 `kind: 'grant'` 记录：

| 项 | 值 |
| --- | --- |
| 记录键 | `zhiyun-classroom/account` |
| label | 浙大一卡通 |
| payload | `{ username, password }` |

**记录键为什么还带 classroom**：已经有用户的数据存在那个键上。换 id 会让所有人的
凭据凭空失效、被迫重登一次 —— 为了名字好看付出这个代价不值得。语义上它现在表示
"浙大一卡通账号"，别名见 `CARD_RECORD_KEY` 上的注释。

加密与不回显由宿主凭据服务负责（Windows 上是 DPAPI）。

## 给别的包用

```js
import { readCard } from '../dsh-zhiyun-card/src/index.js';

const card = await readCard(ctx);   // → { username, password } | null
```

**每次调用现取**凭据服务，不要缓存：凭据包在 profile 里排在后面是常态，
apply 阶段缓存成 null 会永久失效。

| 导出 | 作用 |
| --- | --- |
| `readCard(ctx)` | 读账号密码，没有则 null |
| `writeCard(ctx, {username, password})` | **无条件覆盖**（设置里"保存"用） |
| `fillCardIfEmpty(ctx, {username, password})` | **只在空时写**（登录成功后回填用） |
| `clearCard(ctx)` | 删（幂等） |
| `cardStatus(ctx)` | `{ configured, username }` —— **只回有无** |

### 为什么"保存"与"回填"是两个入口

它们语义相反，混用会出事故：

- **保存**（设置界面）是用户显式动作，必须覆盖 —— `writeCard`；
- **回填**（某次登录成功后顺手记住）是补充，**绝不能覆盖**用户配的值 —— `fillCardIfEmpty`。

早先 classroom 的回填写成"先 `readCard()` 判空、再写入"，那是**两步**：中间窗口里
用户在设置里点了保存，随后回填就会用旧账号把新配置盖掉。
`fillCardIfEmpty` 用 `modifyRecord` 的「一个锁内 read-decide-replace」语义，把这个窗口消掉。

⚠️ 两条路**共用同一份记录形状构造**（含 `label`）。早先 classroom 自己写
`{kind, payload}` 而不带 `label`，于是它回填一次，宿主凭据列表里那条的 label 就没了。

## 设置路由

`/_dsh/zhiyun-card`

| 动作 | 作用 |
| --- | --- |
| `GET` | `{ card: { configured, username, password } }`，`password` 只有打码值 |
| `POST ?save` | 存；`password` 传 `********` 表示**不改密码** |
| `POST ?clear` | 清除 |

POST 需要 `x-zhiyun-card: 1` 头，且只接受回环 Host。

## 两条不能松的边界

**密码永不回显明文。** 读状态一律给打码值 —— 同源页面被 XSS 时也拿不到密码。
只有 `username` 会回显（它不是秘密）。

**密码不 trim。** 空格是密码的一部分；裁掉会把合法密码改坏，用户永远登不上。

## 验证

```bash
node --test tests/card.test.mjs
```

17 项，重点在边界而非 CRUD：密码不回显、打码值表示不改、没存过密码却传打码值要拒、
缺写头/非回环 Host 要 403、记录 id 不能变（变了会丢凭据）。
