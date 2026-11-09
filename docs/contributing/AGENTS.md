# AGENTS.md

本文件是面向 agent 的仓库约定。agent 指令文件需要在仓库根才会被自动读取，所以仓库根的 [AGENTS.md](../../AGENTS.md) 只是入口指针，正文放在这里，由维护者管理。协作规范正文见 [CONTRIBUTING.md](CONTRIBUTING.md)。

本文件只讲每次工作都必须遵守的几件事：**共享仓库**、**开工前的检查**、**文件归属**、**第三方来源**、**信息泄露检查**与**提交与推送**。

## 共享仓库

本项目的共享仓库是唯一的一个，地址固定为：

```text
https://github.com/lybx-leyw/dsh-zju-workbench.git
```

它的 `origin` 必须正好是上面这个地址。所有提交最终都只推到这里，不推其他任何仓库。

## 每次开始工作前

依次执行下面的命令，并把结果简要汇报给用户：

```bash
git status                    # 是否有未提交的改动
git branch --show-current
git remote get-url origin     # 输出必须是 https://github.com/lybx-leyw/dsh-zju-workbench.git
git fetch origin
git config user.name          # 确认当前用户是谁，用于下文的“文件归属”检查
git config user.email         # 提交者邮箱，会进入公开历史，见“信息泄露检查”
```

- `git config user.email` 会写进每一条公开提交记录。**如果它本来就是该 GitHub 账号的注册邮箱，可以用**；只有在它并非账号注册邮箱、又含学号之类可识别信息时，才提醒用户改用 GitHub 的 noreply 地址。
- `git remote get-url origin` 的输出**必须与上节地址逐字符一致**；不一致（`origin` 不存在、指向 fork、指向别的项目、用 SSH 别名或跳转链接写法、或其他任何地址）一律视为错误配置。
- 遇到上述错误配置，**停下来向用户说明差异，由用户决定是否修改远端**，不要默默继续，也不要凭自己的判断“纠正”成其他地址。
- 如果当前目录还不是 Git 仓库，先向用户说明，再协助其 `git clone https://github.com/lybx-leyw/dsh-zju-workbench.git`。**不要在错误的目录里初始化新仓库。**
- 需要添加或修正远端时，用完整地址：`git remote add origin https://github.com/lybx-leyw/dsh-zju-workbench.git`，或 `git remote set-url origin https://github.com/lybx-leyw/dsh-zju-workbench.git`。
- 如果有未提交的改动，先弄清这些改动是不是用户想要的，再决定提交、暂存（`git stash`）还是保留。**不要丢弃用户的改动。**

`git config user.name` 的结果就是后文里的“当前用户”。归属判断依据是这个值，而不是发起请求的账号 —— 两者可能不一致。

## 依赖：**不要用 `npm install` 装工作区**

这条是踩过坑写下的，请当成硬规则。

```bash
# ✅ 装第三方依赖（esbuild / react / katex…）或按锁文件重装
npm ci

# ✅ 链接 51 个 workspace 包（junction，不联网，不碰锁文件）
node scripts/link-workspace-packages.mjs
node scripts/link-workspace-packages.mjs --check   # 期望 linked 51
```

**不要跑 `npm install`。** 它的后果实测过：

```text
removed 252 packages, changed 1 package
package-lock.json: +550 / -3231 行
51 个工作区包全部掉链接，katex 等第三方依赖被删
```

原因是仓库用**两层目录**（`packages/core/*`、`packages/client/*`…），
而根 `package.json` 的 `workspaces` 早先只写了 `"packages/*"` —— 那个 glob 匹配到的是
7 个**分组目录**，它们自己都没有 `package.json`，于是 npm 认为本仓库**零工作区**，
把 51 个真实包当成 `extraneous` 一并清掉。（`workspaces` 已改成五个分组 glob，
但 `npm install` 仍会重写锁文件，所以依然优先用 `npm ci`。）

判断依据很简单：**仓库里有 `scripts/link-workspace-packages.mjs`，就说明工作区
不由 npm 管。** 需要新包被链接时跑那个脚本，不要动 npm。

新增分组目录（例如将来的 `packages/foo/*`）时，两处都要补：

1. `package.json` 的 `workspaces`
2. `scripts/link-workspace-packages.mjs` 第 38 行那个 `for (const pattern of [...])`

`packages/radar/*`（79 个候选骨架）与 `packages/vendor/*` **有意不进 workspaces**，
不要加进去。

### 依赖坏了怎么修（实测可用的完整流程）

`node_modules` 被清空、或构建报 `Could not resolve "katex"` / `Could not resolve "@lybx-leyw/dsh-zju-*"`
时，按这个顺序走。**不要在中间插 `npm install`。**

```powershell
# 1. 备份锁文件（后面要对比改了什么）
Copy-Item package-lock.json "$env:TEMP\package-lock.backup.json" -Force

# 2. 离线重建锁文件 —— 不动 node_modules，不需要网络
#    这一步同时会修掉「锁里还按旧扁平路径记录工作区」的问题
npm install --package-lock-only --legacy-peer-deps --offline --no-audit --no-fund

# 3. 落盘。用 --prefer-offline（严格 --offline 会因个别 tarball 未缓存失败）
npm ci --legacy-peer-deps --prefer-offline --ignore-scripts --no-audit --no-fund

# 4. 确认 51 个包都链上了
node scripts/link-workspace-packages.mjs --check   # 期望 {"total":51,"linked":51,"missing":[]}

# 5. 构建
npm run build
```

**如果第 3 步报 `EPERM ... libvips-42.dll`**：那是一个**中断安装留下的孤儿暂存目录**
（`node_modules/@img/.sharp-win32-x64-XXXXXXXX`）被某个进程占着。注意两点：

- **给目录改名不能绕过锁**（锁在文件对象上，不在路径上），实测无效；
- 正确做法是把它**整个移出 `node_modules`**：

```powershell
Get-ChildItem node_modules\@img -Directory -Force | Where-Object { $_.Name -like '.*' } |
  ForEach-Object { Move-Item $_.FullName "$env:TEMP\sharp-orphan-$($_.Name)" -Force }
```

移走后再跑第 3 步即可。**不要 `Remove-Item node_modules`** —— 那才真的会撞上 EPERM，
而且要把 105 个包全部重装。

### 两条容易踩的版本约束

1. **`@deepseek-ai/dsh-atomic-write` 必须与 `runtime.lock.json` 的
   `preferredHostVersion` 一致**（当前 `0.2.2-rc.1`）。8 个工作区包在
   `peerDependencies` 里写死了这个版本；根依赖若停留在 `^0.2.0-rc.2`，caret 范围
   **覆盖不到** `0.2.2-rc.1`，npm 会一路装 `0.2.0-rc.2` 并发 peer 警告。
   因为 peer 标了 `optional: true`，它**不会硬失败**——所以这个不一致会静默存在很久。
2. **内部包互相引用的版本号必须等于对方的 `version`**，不能落后。曾经
   `source/campus` 与 `source/http` 把 `source-webvpn` 钉在 `0.1.0` 而它已经是 `0.2.0`：
   本地不满足 → npm 回退去 registry 找 → 这个包 `private: true` 从未发布 → **404**。
   改内部包版本号时，先全局搜一遍谁引用它。

## 文件归属

谁的代码由各目录的 `OWNERS` 声明，规则与 [CONTRIBUTING.md 第 2 章](CONTRIBUTING.md#2-owner-机制)一致；本节是供就地判断用的摘要，细节以原文为准。先讲机制，再讲 `OWNERS` 放在哪里。

### Owner 机制

**三种模式**，只约束“谁能改代码”，不表示上下级：

| 模式 | 谁能改 | 责任与裁决 |
| --- | --- | --- |
| `shared`（默认） | 所有人 | 修改者对自己的改动负责，相关回归测试必须通过，实际使用不得破坏已有功能 |
| `@负责人` | 仅名单内成员 | Owner 决定实现方向及破坏性变更；名单外成员有需求时直接联系 Owner，由 Owner 修改 |
| `@负责人 + Open` | 所有人 | 修改者负责验证与修复；Owner 负责事后审查，对该区域的最终状态负责，有权保留、调整或撤销他人的改动 |

指定 Owner 且未标 Open 的区域，限制针对**修改行为本身**，名单外成员不能先改再交给 Owner 审批。需要开放协作时，应先改成 Open。

### OWNERS 的位置与继承

- 每个目录最多一份 `OWNERS`（文件名无后缀），默认作用于该目录及其子目录的全部内容，包括源码、测试、配置和文档。
- 找某个文件的 Owner 时，从它所在目录逐级向上找，第一个遇到的 `OWNERS` 就是它的声明；子目录覆盖父目录。
- 一路到仓库根都没有 `OWNERS` 时按 shared 管理。

### 声明格式

三种写法选用一种：

```text
Owner: shared
Owner: @alice, @bob
Owner: @alice, @bob + Open
```

`Open` 必须同时指定至少一位负责人。负责人使用 GitHub 账号，带 `@` 前缀，多人以英文逗号分隔。

### 拿到归属后怎么做

- **shared 或 Open 区域**：可以直接改。
- **指定 Owner 且非 Open 的区域**：只有 `Owner:` 列出的账号可以改。

**不得修改他人的 `OWNERS`，不得把自己写进他人的、且非 Open 的 `Owner`。**

若任务确实需要改动他人的**非 Open 文件**（例如调整公共接口），**停下来**，建议用户先和负责人沟通，由负责人自己修改。

**声明变更需先达成一致，再修改文件**：不得通过自行修改或删除声明绕过权限限制。

## 第三方来源

参考本仓库之外的任何项目之前，**先确认对方的协议**：找 `LICENSE`（或 `COPYING`、`NOTICE`）并读它。**没有许可证的代码默认保留所有权利，不得复制**，只能当作思路参考，并且这一点也要说明。GPL / AGPL 之类的传染性协议不得用于本项目。

确认后按引入程度记录：

- **只做了简单借鉴**（读了实现、换了写法，没有引入对方的实现）：在仓库根的 [ATTRIBUTION.md](../../ATTRIBUTION.md) 中追加一两行说明即可，不需要合法说明。
- **移植了较多代码**，无法在一两行内写明：在对应的插件包内写一份 `ATTRIBUTION.md`，说清楚用了哪些部分、来源与提交号、依据对方哪个协议所以合法、以及做了哪些改动；再在根 [ATTRIBUTION.md](../../ATTRIBUTION.md) 中指向该包的 `ATTRIBUTION.md`。

**不要用「同一作者」当作省略理由**，除非确实是同一作者的项目（例如 `zhiyun-pro`、`zju-mcp`）；这一点由用户确认，不要自行判断。第三方库通过 `package.json` 正常引入并按原协议使用的，也不需要额外说明。

完整规则见 [CONTRIBUTING.md 3.3](CONTRIBUTING.md#33-参考其他项目前先确认协议)。

## 信息泄露检查

**本仓库是公开仓库。** 推送出去的任何内容都会立刻可见，并可能在很短时间内被自动化工具抓取扫描。因此**每次推送前都必须先检查有无泄露个人信息**，检查范围是本次要提交的全部改动，包括代码、注释、文档、测试夹具与提交信息。

重点检查：

- **个人凭证**：学号、密码、Cookie、API key、token，以及 `.temp_env`、`.env`、`*.dpapi` 这类凭据或会话文件。
- **本地绝对路径**：形如 `C:\Users\<用户名>\...`、`/Users/<用户名>/...` 的路径常因带用户名而暴露身份。代码与文档中应写相对路径或占位符（如 `C:\Users\me\dsh-host`）。**不要只看源码**：注释、文档、测试夹具同样会带路径。
- **个人数据**：真实的课程、成绩，以及从智云解析出的私人内容。
- **姓名等身份信息**：带有用户或组员姓名、学号、头像、联系方式等身份信息的资料不要推送，包括名单、分工安排、会议记录这类交流材料。**仓库内组员之间的交流文档一律用 GitHub 用户名指代，不写真实姓名。** 提交者信息同样进入公开历史，所以要一并检查 `git config user.name`（应为 GitHub 用户名）与 `git config user.email`：**邮箱本来就是该 GitHub 账号的注册邮箱时可以用**，不是注册邮箱、又含学号之类可识别信息时才改用 GitHub 的 noreply 地址。**开工前的检查里要顺带看一眼这两项。**

`.gitignore` 已覆盖 `.env`、`.temp_env`、`*.dpapi`、`.runtime/`、`artifacts/` 等路径，但这些文件本身就不该存放待提交的个人凭证；**也不要为了让它们进仓库而使用 `git add -f`**。

不确定某个值能否公开时，按不能公开处理，先删除或改成占位符，并向用户说明。**一旦发现凭证已经推送出去，应立刻提醒用户作废并重新申请** —— 抓取是自动的，只从历史记录里删掉并不够。历史既已推送过的泄露，要如实说明它仍在历史中，由用户决定是否重写历史。

完整规则见 [CONTRIBUTING.md 3.4](CONTRIBUTING.md#34-推送前检查有无泄露个人信息)。

## 提交与推送

**提交与推送前必须先和用户确认，不得擅自提交。** 改动完成、自检通过后，先停下来说明：改了哪些文件、验证了什么、准备用的提交信息与目标分支，等用户明确同意后再 `git commit` 与 `git push`。推送前按上一节完成信息泄露检查，并把检查结果一并汇报。

推送远程一律走 PR：`main` 已设置分支保护，不要直接向 `main` 推送。推送到其他分支同样适用上一条 —— 一句话概括就是：用户没确认，就不产生新的提交或远端更新。
