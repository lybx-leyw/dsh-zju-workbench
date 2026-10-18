# 中转站：让用户把自己的数据喂给 AI

一台**用户自己部署、自己持有密钥**的小服务器。用户的抓取脚本把个人规划、日记、笔记推上去，
工作台拿读密钥去读，于是每个人都能多一个**完全自定义的数据源** —— 而我们不托管任何数据。

```text
用户的抓取脚本 / 手动提交 ──写密钥──►  中转站（用户自己的创空间）
                                          │  append-only 事件日志
AI / 工作台            ──读密钥──►        └── 按时间正序读出
```

## 为什么是这个形状

| 备选 | 为什么不用 |
| --- | --- |
| 我们替用户存 | 个人规划与日记是私人内容，托管就等于把它们收进了我们的责任范围 |
| 让用户对着我们写 API key | 用户不该为了给 AI 读数据就把内容交出去，也不该依赖我们的可用性 |
| 让用户自建服务器 | 门槛太高，大部分人没有公网机器 |

用户已经能在魔搭免费拿到一台容器，于是**把"落点"做成一台他能自己拥有的服务器**，
我们只提供协议和模板。

## 权限模型

两个密钥，职责不相交。这不是风格问题：工作台把读密钥存在用户本机，一旦泄露，
泄露的只该是"读"，不该连带把"往这个人的数据源里注入内容"的能力也交出去。

| 变量 | 谁持有 | 能做什么 |
| --- | --- | --- |
| `WRITEKEY` | 用户的推送脚本 | 只能 `POST /entries` |
| `READKEY` | 用户填进工作台 | 只能 `GET /entries` |

> **平台限制**：创空间的环境变量名**不接受下划线**。`WRITE_KEY` 会被平台以
> `invalid_environment_variable_name` 直接拒掉，只能写 `WRITEKEY`。服务端两个拼写都认，
> 本地和各平台通用写法仍然可用。

两个密钥都从环境变量读，用**平台 Secret**（不是明文变量）保存 —— Secret 只回键名、不回读值。

## 接口

| 方法 | 路径 | 需要 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/` | — | 说明页，只讲怎么用，**不含任何数据** |
| `GET` | `/health` | — | `{ok, count}`，用于判断服务是否起来 |
| `POST` | `/entries` | `X-Zy-Write-Key` | 追加一条 |
| `GET` | `/entries` | `X-Zy-Read-Key` | 全部条目，按时间正序 |
| `GET` | `/entries?since=N` | `X-Zy-Read-Key` | 只要 `seq > N`，供增量拉取 |
| `OPTIONS` | `*` | — | CORS 预检 |

请求头用 `X-Zy-*` 而不是 `Authorization`：**魔搭占用了 `Authorization`、`X-modelscope-*`、
`X-studio-*`**，照用会被网关吃掉。

未授权的请求一律返回 **404 而不是 403** —— 403 等于告诉扫描器"这里有个入口"。

写入的字段是白名单，出现白名单外的键直接 400：

```json
{ "kind": "plan", "title": "本周计划", "text": "……", "tags": ["plan"] }
```

`kind` ∈ `plan / diary / note / event`；`title` ≤200 字符，`text` ≤8000 字符，
`tags` ≤8 个且只允许字母数字下划线连字符；`at` 省略则取服务端当前时间。
**`name` / `studentId` / `email` 这类身份字段刻意不在白名单里** —— 这是公开协议的延伸，
出现即拒。

## 部署（照做版）

### 1. 建创空间

类型选 **Docker**。⚠ 需要在魔搭上先绑定阿里云账号并完成实名认证，否则建不了 Docker 类型。

| 项 | 值 |
| --- | --- |
| 类型 | `docker` |
| 硬件 | `platform/2v-cpu-16g-mem`（免费档够用） |
| 可见性 | 公开（私有也能跑，但公开才拿得到 `.ms.show` 域名） |
| 端口 | `0.0.0.0:7860`（**平台要求，8080 被占用**） |

### 2. 推代码

本目录的 `server.py` 要作为创空间的 **`app.py`** 提交（入口文件名），`Dockerfile` 原样放根目录。

```bash
git clone https://oauth2:<访问令牌>@www.modelscope.cn/studios/<你的账号>/<空间名>.git
cp deploy/relay-service/server.py <空间目录>/app.py
cp deploy/relay-service/Dockerfile  <空间目录>/
cp deploy/relay-service/README.md   <空间目录>/
git add -A && git commit -m "add relay" && git push
```

也可以把本目录的 `ms_deploy.json` 连同代码一起，用「快速创建并部署」模式上传。

### 3. 配密钥（Secret，不是明文变量）

设置页 → 环境变量，或用 OpenAPI：

```bash
OWNER=<你的账号>; REPO=<空间名>
curl -X POST "https://modelscope.cn/openapi/v1/studios/$OWNER/$REPO/secrets" \
  -H "Authorization: Bearer $MODELSCOPE_API_KEY" -H "Content-Type: application/json" \
  -d '{"key":"WRITEKEY","value":"换成你自己的随机串"}'
curl -X POST "https://modelscope.cn/openapi/v1/studios/$OWNER/$REPO/secrets" \
  -H "Authorization: Bearer $MODELSCOPE_API_KEY" -H "Content-Type: application/json" \
  -d '{"key":"READKEY","value":"换成另一串随机串"}'
```

两个值必须不同（服务端会拒绝启动）。**没配密钥时服务直接退出**，而不是起一个敞开的服务 ——
启动失败在日志里一眼可见，敞开的数据源可能几个月都没人发现。

### 4. 上线

```bash
curl -X POST "https://modelscope.cn/openapi/v1/studios/$OWNER/$REPO/deploy" \
  -H "Authorization: Bearer $MODELSCOPE_API_KEY"
curl "https://modelscope.cn/openapi/v1/studios/$OWNER/$REPO/logs/run" \
  -H "Authorization: Bearer $MODELSCOPE_API_KEY"
```

Gradio 类型首次构建约 2–3 分钟，Docker 类型更久。日志里应出现：

```text
[relay] 监听 0.0.0.0:7860，落盘 /mnt/workspace/entries.jsonl
```

### 5. 填进工作台

拿到 `https://<你的账号>-<空间名>.ms.show`，把**域名 + 读密钥**填进工作台的设置。

## 验证

```bash
BASE=https://<你的账号>-<空间名>.ms.show
W='X-Zy-Write-Key: <写密钥>'
R='X-Zy-Read-Key: <读密钥>'
UA='User-Agent: Mozilla/5.0'      # 见下节，不带会被网关拦

curl -s -H "$UA" $BASE/health
curl -s -H "$UA" -H "$W" -H 'Content-Type: application/json' \
     -d '{"kind":"plan","title":"试一条","text":"本地验证"}' $BASE/entries
curl -s -H "$UA" -H "$R" $BASE/entries
```

四条断言，缺一不可：

1. 用**写密钥读** → 404
2. 用**读密钥写** → 404
3. 不带密钥读 → 404
4. 请求体夹带 `realName` → 400

单元测试（不连网、起真服务打真端口）：

```bash
python -m unittest tests/test_relay_service.py
```

## 踩过的坑

**1. 环境变量名不能带下划线。** 平台会拒掉 `WRITE_KEY`，只收 `WRITEKEY`。
症状是服务起来就退出，日志一行 `缺少 WRITE_KEY / READ_KEY 环境变量`。服务端现在两个拼写都认。

**2. 平台探针会请求 `/invoke`、`/config`。** 这些是平台自己的探针，原样转发到容器，
在日志里会看到 `POST /invoke 404`。**这不代表用户请求也被改了路径** —— 用户带密钥打
`/entries`，到达的仍然是 `/entries`。服务端对这两个前缀做了容忍式剥离，纯粹是防御：
万一以后网关改了行为，业务路由仍然命中，不必重新发版。

**3. `.ms.show` 对非浏览器 UA 会拦。** 裸 `curl` 或 Python `urllib` 默认的
`Python-urllib/3.x` 可能被 WAF 挡掉，必须带一个浏览器 User-Agent。写推送脚本时记得显式设置。

**4. 数据会丢。** `/mnt/workspace` 能扛重启，但**转移或重命名创空间就会丢**。
所以主人侧应当定期把 `GET /entries` 的结果导出到本地，别把它当唯一副本 ——
数据本来就是用户自己抓的，丢了重推一次即可。

**5. 创空间不能通过 API 删除。** 只能停（`POST .../stop`），删除要去网页控制台。

## 边界

**适合**：低流量、无身份、可容忍丢失的个人数据中转。

**不适合**：多用户共用一个实例（密钥是全局的，谁拿到读密钥都能读全部）、
需要事务一致性、或需要"绝不丢数据"的场景。
