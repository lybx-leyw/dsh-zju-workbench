# 并行派单的文件冲突处理规则

**背景**：多个实现代理同时交付时，有几个文件是**共用的**。串行时没问题，并行时会互相覆盖。

---

## 冲突文件清单

| 文件 | 谁改 | 冲突形态 |
| --- | --- | --- |
| `profiles/zju-workbench/package.json` | 每个包加 1 行 | 两个代理同时读 → 后写的覆盖先写的 |
| `tests/source-settings.test.mjs` | 每个包加 1 行到 `NO_SETTINGS` | 同上 |
| `package-lock.json` | `link-workspace-packages.mjs` 可能动 | 不同时跑就没事 |
| `packages/source/campus/**` | 拆包代理 | 与任何「读 campus」的代理冲突 |

---

## 处置办法

### 1. 让代理**不要**改这两个共享文件

在派单时明确要求：**只建自己的包 + 自己的测试文件**，两处注册由我统一做。

好处：
- 代理之间零冲突
- 我能看到完整的注册列表，避免「谁漏了」或「谁覆盖了谁」

代价：
- 代理的自检会失败（`source-settings` 守卫要求每个 source 包都在白名单里）

**解决**：让代理在报告里写「**需要在 `NO_SETTINGS` 加一行**」，我统一加完后跑守卫。

### 2. 拆包类任务**单独串行**

`source/campus` 要拆成 `xuezai` + `pta`，这是**破坏性改动**：
- 旧包要退役（加进 `retiredBundles`）
- `zhiyunCampus` 服务要留兼容 shim（现有消费者不能断）
- `/api/zhiyun-campus` 路由要保留

**任何并行代理都可能正在读 campus**，所以这类任务等前面清完再派。

### 3. 派单前先确认没有代理在跑同类任务

```powershell
git status --short   # 看有没有别的代理正在动的包
```

---

## 我这轮的派单编排

| 批次 | 包 | 理由 |
| --- | --- | --- |
| **已在跑** | `tyys`、`notice` | 独立新建，互不依赖 |
| **本批派** | `mail`、`wechat-chat`、`dingtalk-chat`、`weread` | 独立新建，不碰 campus |
| **下批（串行）** | `xuezai` + `pta`（拆 campus） | 破坏性改动，必须独占 |
| **最后** | `tool/campus-write`（收 21 条写） | 依赖前面所有 source 包的数据层 |

---

## 给代理的统一约束（每条派单都写）

```
## 文件边界（重要）

你**只能**建/改这些：
- packages/source/<name>/**（新建）
- tests/<name>.test.mjs（新建）

你**不要**改：
- profiles/zju-workbench/package.json
- tests/source-settings.test.mjs
- 任何其它 packages/** 的文件

原因：多个代理在并行工作，同时改这两个共享文件会互相覆盖。
两处注册（profile bundles + NO_SETTINGS 白名单）由验收方统一处理。

你的报告里请写一句：
「需要在 NO_SETTINGS 加一行：['<name>', '<理由>']」
```

---

## 验收方的收尾动作（代理全部交付后）

```powershell
# 1. 统一加 NO_SETTINGS 白名单（每个包一行，按已有风格写理由）
# 2. 统一加 profile bundles（每个包一行，8 空格缩进，LF 换行）
# 3. 链接所有新包
node scripts/link-workspace-packages.mjs

# 4. 跑全部守卫
node --test tests/source-capability.test.mjs tests/source-settings.test.mjs \
  tests/publish-guard.test.mjs tests/profile-bundles.test.mjs

# 5. 跑全部新包的测试
node --test tests/<name>.test.mjs
```

**注意**：`source-capability` 的「裸 import 都被 requires 覆盖」会在代理漏声明依赖时失败 —— 这是好事，说明守卫在工作。
