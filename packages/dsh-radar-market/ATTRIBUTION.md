# 第三方来源

本包为**候选骨架**，按 [CONTRIBUTING 3.3](../../docs/contributing/CONTRIBUTING.md) 记录来源与许可。

## 运行时依赖（锁版引入，未复制源码）

- [dsh-market](https://github.com/dsh-market/dsh-market) · **MIT** · npm 包名 `dshmarket`，
  **精确锁定 `1.66.21`**（见 `src/upstream.js` 与 `package.json` 两处，必须逐字符一致）。

  本包拟以**子插件**方式挂载其**宿主半边**（`ctx.plugin(upstream, …)`，卸载走 `fiber.dispose()`），
  按 MIT 正常使用，**未复制其源码到本仓库**。其客户端半边（`dshmarket/client`）**刻意不引入**
  —— 理由见 `README.md`「只挂宿主半边」一节。

  锁版理由：上游的读法是 `dsh-cli`、profile 与用户 `cordis.patch.yml`，这些都不是稳定的公开协议，
  patch 版本就可能改形状。

## 简单借鉴（无实现引入）

- [dsh-paper-reader](https://github.com/GGboya/dsh-paper-reader) · MIT · 版本 `1.3.1`。
  本包的**结构**（`src/index.js` 挂载/拆卸 + `src/upstream.js` 锁版凭据两个文件的划分、
  「版本不符只警告不拦启动」的取舍）参考了本仓 `packages/dsh-zhiyun-host-paper/` 的写法。
  这是**同一作者的仓库内部参考**，不构成第三方借鉴；此处仅记录形态来源，便于人工评审对照。

## 含实现移植

**暂无**。本骨架不含任何上游实现，只有占位与 TODO。
