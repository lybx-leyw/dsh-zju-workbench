# @lybx-leyw/dsh-zju-source-lab

实验课选课平台（`10.203.16.55`）数据源：**学期、实验课、班次余量、已选、课表、公告**。

纯只读（D17），`auth: own`，`network: campus`。

## ⚠️ 平台在私网 IP 上

`10.203.16.55` 是内网地址，**校外必须经 WebVPN**。两个端口：

| 端口 | 用途 |
| --- | --- |
| **86** | Vue SPA 静态页（`http://10.203.16.55:86/lab-course/selectCourse`） |
| **8098** | API（`http://10.203.16.55:8098/lab-course/api/*`） |

**2026-11-10 实测（校园网内）**：

| 端点 | 结果 |
| --- | --- |
| SPA `:86/...selectCourse` | 200，1120 字节 |
| API `:8098/lab-course/api/` | 404（服务端已响应，只是根路径没路由） |
| `POST /api/login`（JSON body） | `{"code":400,...,"message":"Bad Request"}` |
| `POST /api/login`（上游签名 + **form-urlencoded**） | **`{"code":200,"message":"OK","data":"用户名或密码错误"}`** |

最后一条是决定性的：**签名被接受、字段被识别、返回明确业务错误** —— 协议逐项正确。

## 请求协议（两处容易写错的地方）

### 1. 请求体必须是 form-urlencoded

用 JSON 会**稳定拿到 400**。实测时我先用 JSON 试，一直 400；换成
`application/x-www-form-urlencoded` 才拿到 200 与真实业务错误。

### 2. 签名参数与业务参数混在同一份 form 里

```text
sign = md5(secret + path + 排序后(按参数名)的 k+v（跳过空值和对象） + timestamp + " " + secret)
```

- `app_key` / `timestamp`（毫秒）/ `sign` 与业务参数**一起**提交（GET 进 query，POST 进 body），
  不能只放 header；
- `Authorization: <token_type> <access_token>`（登录接口除外）；
- 响应信封 `{code, message, data}`：**200 成功**、401 无权限、408 token 失效；
- JWT 有效期 48 小时；多角色时默认切到学生角色（换发 token）。

## 能力（10 个只读方法）

| 方法 | 作用 |
| --- | --- |
| `terms()` | 所有学期 |
| `currentTerm()` | 当前学期（**只认服务端唯一的 `currentTerm === 1`**，不按列表顺序猜） |
| `myCourses(term?)` | 我这个学期的实验课 |
| `labs(courseId)` | 某门课的班次；`openWeek` 解析成 `weeks` |
| `weekStatus(term?)` | 各班次各周次已选人数（`"班次id_周次段"` → 人数） |
| `mySelections(term?)` | 我的已选实验 |
| `openStatus(term?)` | 选课窗口 |
| `notices()` | 平台公告（正文转纯文本） |
| `myTimetable(term?)` | 我的课表（每个已选实验展开成按日期的一次课） |
| `myInfo()` | 个人资料（`password` 字段是哈希，剥掉不外传） |

### 几处「宁可报错也不猜」的地方

- `currentTerm()` 标记不唯一时抛 `CONFIG`，**不按列表顺序猜** —— 猜错会让用户看到另一个学期的课表；
- `myCourses()` 返回不是数组时抛 `SHAPE`，**不视为「没有课程」**；
- `weekStatus()` 任何一个值不是有限非负数就**整份作废** —— 这份数据用来判断余量，带着 `NaN` 进去会把「已满」算成「有余」；
- `myTimetable()` 查不到日期的那条给 `date: null`，**不猜一个日期**。

## 登录与会话

凭据由集成层注入，本包不知道凭据从哪来：

```js
const lab = ctx.get('zhiyunLab')
lab.setCredentialProvider(async () => ({ username, password }))
lab.setSession({ load: () => JSON.parse(read()), save: (auth) => write(auth) })
await lab.myTimetable({ term: 7 })
```

token 失效（`code` 401/408）时**重登一次再重放**，收敛条件保证最多重试一次。

## 写操作去哪了

按 D17，**写操作归 `packages/tool/`**。上游的两个写方法：

| 上游方法 | 现在在哪 |
| --- | --- |
| `select()`（选实验班次） | 将来进 `packages/tool/campus-write` |
| `cancel()`（退选） | 同上 |

两者在上游都过写闸（`--confirm` + `ZJU_ALLOW_WRITE`），本包**不含任何写代码**。

## 没有设置分区

`auth: own` 但凭据由集成层注入，本包无用户可配置项 → 进 `tests/source-settings.test.mjs`
的 `NO_SETTINGS` 白名单。

## 已知限制

- **只有「校内可达」被验证**：校外经 WebVPN 改写 `http-8098` 是否也能通，**未测**
  （`10.203.16.55` 是私网 IP，WebVPN 改写基于主机名，上游也没验证过）。
- **没有用真实账号跑通任何只读接口**：所有接口的响应形状来自上游注释与逆向，
  测试全部用合成响应。唯一被真机验证的是「登录端点接受这套签名」。
- 上游 `myTimetable` 对缺 `dates` 的行会再查一次日期表，按课程去重 —— 这个行为保留了，
  但真实数据里「缺 dates 到底有多常见」未知。
