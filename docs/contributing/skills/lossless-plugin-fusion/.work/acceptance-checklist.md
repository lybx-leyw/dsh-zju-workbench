# 验收脚本：机械检查 → 人工判断

**用途**：子代理交付后，先跑这个脚本拿到机械事实，再人工做实质判断。
脚本只报事实，不下结论。

---

## 一、自动化检查项

### 1. 分层合规（硬规则，任一违反即阻断）

```powershell
$pkg = "packages/source/<name>"

# 不应该注册工具
Select-String -Path "$pkg\src\*.js" -Pattern 'ctx\.tools|defineTool|tools\.register'

# 写操作痕迹
Select-String -Path "$pkg\src\*.js" -Pattern 'method:\s*["'']POST|method:\s*["'']PUT|method:\s*["'']DELETE'

# tier 1 依赖 tier 1（违反即阻断）
node -e "const j=require('./$pkg/package.json'); console.log(j.dsh.capability.requires)"

# 服务名/路由名全仓唯一
Select-String -Path 'packages/**/*.js' -Pattern "<服务名>|<路由名>" -List
```

**判断**：
- 出现 `ctx.tools` / `defineTool` → **阻断**
- `requires` 里有 `@lybx-leyw/dsh-zju-source-{zdbk,campus,cc98,xxt,classroom,...}` → **阻断**（tier 1 依赖 tier 1）
- `POST` 不必然是写操作（见 `tyys` 的 `READ_POSTS`），要逐个人工判断

### 2. 关键缺陷模式（前几轮真实事故，逐条排查）

| 模式 | 检查命令 | 为什么 |
| --- | --- | --- |
| `jar: null` | `Select-String -Path "$pkg\src\*.js" -Pattern 'jar:\s*null'` | `Transport.request` 会无条件调 `session.jar.getCookies` → 一次请求也发不出（yjsy 事故） |
| 假超时参数 | `Select-String -Path "$pkg\src\*.js" -Pattern 'timeoutMs'` | 只有 `Transport` 读它；`sharedFetch`/`egress` 不读。用了 `sharedFetch` 还传 `timeoutMs` 就是假参数 |
| 无超时 | 查有没有 `AbortController` / `Promise.race` / `setTimeout` | ebook 事故：全链路无超时，半开连接无限挂起 |
| 非原子写 | `Select-String -Path "$pkg\src\*.js" -Pattern 'writeFile\('` | 应为 `writeFileAtomic`；且需 `mkdir`（chalaoshi 事故） |
| 缓存无账号键 | `Select-String -Path "$pkg\src\*.js" -Pattern 'cached'` | 缓存复用不比对 username → 隐私泄露（yjsy 事故） |
| 单位猜测 | `Select-String -Path "$pkg\src\*.js" -Pattern '>\s*1000\s*\?'` | cnki 事故：`ttl > 1000 ? ttl : ttl*1000` 把 20 分钟变成 1.2 秒 |
| 静默吞错 | `Select-String -Path "$pkg\src\*.js" -Pattern 'catch\s*\{\s*\}'` | 空 catch 是静默失败 |
| 死代码 | 检查导出的常量有没有被引用 | cnki 的 `SORTS` 搬了不用；chalaoshi 的 `API` 零引用 |

### 3. 声明诚实性

```powershell
# description 与代码一致？
node -e "console.log(require('./$pkg/package.json').description)"

# files 里声明的文件真的存在？
node -e "
const j=require('./$pkg/package.json'); const fs=require('fs'); const p='$pkg/';
for (const f of j.files) { const t=f.endsWith('/')?f:f.replace(/\/$/,''); console.log(fs.existsSync(p+t)?'OK    ':'MISSING', f); }
"

# 无 BOM
node -e "
const fs=require('fs'); const p='$pkg/package.json'; const b=fs.readFileSync(p);
console.log(b[0]===0xEF&&b[1]===0xBB&&b[2]===0xBF ? 'BOM!' : '无 BOM');
"

# README 真的存在且有内容
Get-Item "$pkg\README.md" | Select-Object Length
```

### 4. 测试质量（重点，前几轮问题最多）

```powershell
# 测试条数
Select-String -Path "tests/<name>.test.mjs" -Pattern "^test\(" | Measure-Object

# 真空真断言（空数组上 every/some 永远过）
Select-String -Path "tests/<name>.test.mjs" -Pattern '\.every\(|\.some\(' -Context 2,0

# 有没有集成层测试
Select-String -Path "tests/<name>.test.mjs" -Pattern 'apply\(|ctx\.provide|zhiyun[A-Z]'

# 唯一的 assert.rejects 是不是只看 instanceof（弱断言）
Select-String -Path "tests/<name>.test.mjs" -Pattern 'instanceof' -Context 0,2
```

### 5. 回归有效性（**必做，不能只看代理自述**）

这是最容易被敷衍的一项。做法：

```powershell
# 1. 备份被打包的关键文件
Copy-Item "$pkg\src\<name>.js" "$env:TEMP\<name>.bak.js" -Force

# 2. 故意改坏一处关键逻辑（选一个「改坏了功能就明显错」的点）
#    例如：把一个判据反过来、把一个系数改掉、把一个条件删掉

# 3. 跑测试，必须红灯
node --test tests/<name>.test.mjs 2>&1 | Select-String "^ℹ (pass|fail)|^✖"

# 4. 恢复
Copy-Item "$env:TEMP\<name>.bak.js" "$pkg\src\<name>.js" -Force

# 5. 确认恢复后绿
node --test tests/<name>.test.mjs 2>&1 | Select-String "^ℹ (pass|fail)"
```

**如果改坏了测试还是绿的 → 该处测试无效，必须要求补。**

---

## 二、上游覆盖度验收（人工，不可自动化）

### 必查格式

对账表必须**逐条**，每条一个状态：

- ✅ **对应** —— 给出本仓的符号名与文件:行号
- ❌ **明确丢弃 + 理由** —— 理由要成立（「D17 禁写」成立，「嫌麻烦」不成立）

**不允许第三态**。出现以下写法一律打回：
- 「部分实现」而不说清哪部分
- 「参考了」
- 「类似」
- 「基本一致」

### 逐包必问

**tyys**：
- 9 条 `provides` 逐一交代了吗？source 应实现 7 条（`rollcall history`、`session login/status/logout`、`venue list`、`venue order list`、`venue notice`），tool 收 2 条（`venue book`、`venue order cancel`）
- `sign.ts` 的三段算法（AES 解密 / canonicalize 双键排序 / splitmix64 + 定点插字符）是否**逐处**实现？
- `READ_POSTS` 那 4 个「POST 但只读」的接口有没有被误归 tool？
- `captcha.ts`（点选验证码自动求解）有没有被悄悄搬进来？**搬了就是严重问题**
- `network` 是 `public` 不是 `campus` —— 写对了吗？

**notice**：
- `SOURCES` 是 **9** 个（不是 35、不是 26）
- 三套适配器（`webplus` 8 来源 / `zdbk` 1 来源 / `kyjs` 独立路径）都交代了吗？
- **`zdbk` 适配器怎么处理分层的？** 上游 `requires` 含 `zdbk`，但 tier 1 不能依赖 tier 1
- `hosts.json` / `colleges.json` 放进 `data/` 了吗？`files` 里有 `data/` 吗？有没有内联成 JS 常量？
- 结构漂移检测（「页面说有 N 条但解析出 0 条」）有没有显式标出？

---

## 三、判定标准

| 结论 | 条件 |
| --- | --- |
| **通过** | 无阻断项；重要项 ≤2 且已记录；测试能抓回归 |
| **有条件通过** | 有重要项，但不影响「只读、分层、无泄露」三条底线，且已写进 README 已知限制 |
| **打回** | 任一：注册了工具 / 有写操作 / tier1 依赖 tier1 / 搬了验证码求解 / 测试无效 / 覆盖度有第三态 |

---

## 四、我在前几轮验收时犯过的错（提醒自己）

| 错误 | 教训 |
| --- | --- |
| 相信代理的「已修复」自述 | 必须自己跑改坏→红灯→改回 |
| 只看 `grep` 数出的条目数 | `grep` 会漏多行结构；要用跨行正则或结构法交叉验证 |
| 用括号深度法数顶层条目 | 会被嵌套数组骗；要用「字段出现次数」交叉核对 |
| 把「两套适配器」写进任务 | 实际三套；任务描述必须基于亲读源码 |
| 没注意 `network: public` vs `campus` | 直接影响校外能否使用 |
