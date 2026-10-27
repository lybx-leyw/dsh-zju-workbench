# 第三方来源

本包为**候选骨架**，按 [CONTRIBUTING 3.3](../../docs/contributing/CONTRIBUTING.md) 记录来源与许可。

## 能力来源（**未复制任何源码**）

- [p16e0nd/zju-recorder](https://github.com/p16e0nd/zju-recorder) · **MIT** ·
  `Copyright (c) 2026 ZJU Recorder contributors`（LICENSE 实文已核）。
  最后推送 2026-09-30。

  本包拟以 **B 类「能力提取 + 封装」**方式借鉴其三项能力：

  1. **OAuth2 授权码登录链路** —— `casapi auth/login` → `cas/oauth2.0/authorize`
     → `cas/login` → `tgmedia get-info?code=ST-xxx` → `_token` cookie 内的 JWT。
     上游 `app/zjuauth.js` 头部注释描述了该链路，本仓 `dsh-zhiyun-source-classroom`
     现有实现走的是另一条 CAS 直连路径，**二者不重叠**。
  2. **Cookie 匹配语义** —— 上游 `CookieJar` 类的 `domain` / host-only / `path` 三元匹配。
  3. **RSA 密码加密的分块实现** —— 密码整串反转 + 按 modulus 分块 `modpow`，
     用作与本仓 `src/auth.js` 整块实现的**交叉验证**。

  **⚠ 本骨架未复制上游任何一行源码。** `src/index.js` 只有占位与 TODO。
  实际实现时若确需移植，须在实现 PR 中逐段标注来源行号，并按 CONTRIBUTING 3.3 更新本文件。

  **MIT 合规前提**：MIT 允许任用途，但要求保留版权声明与许可全文。
  ⇒ 若将来发生**任何源码移植**，必须在**本文件**完整附上上游 LICENSE 全文
  （`Copyright (c) 2026 ZJU Recorder contributors`）。
  **当前无移植，故不附。**

## ⚠ 明确不引入的第三方产物

- **`app/public/flv.min.js`（144 KB）与 `app/public/hls.min.js`（415 KB）**
  —— 上游仓库内的**第三方构建产物**，**非上游自写代码**。
  这两个文件的许可证**在 2026-10-16 第五轮扫描中未核实**，
  因此**不得引入本仓库**。若需 FLV/HLS 播放能力，
  须走本仓自己的依赖选型并单独记录许可。

## 简单借鉴（无实现引入）

- 本仓 `packages/dsh-zhiyun-host-paper/src/upstream.js` 与 `packages/dsh-radar-market/`
  的**文件划分形态**（`src/index.js` 挂载/拆卸 + 独立的上游凭据模块）。
  这是**同一作者的仓库内部参考**，不构成第三方借鉴；此处仅记录形态来源，
  便于人工评审对照。

  > 注意：本包是 **B 类**，**没有**上游 npm 依赖，
  > 因此**不设** `src/upstream.js`（那是 A 类用于锁 npm 版本的模块）。
  > 上游信息直接内联在 `src/index.js` 的 `status.upstream` 里。

## 含实现移植

**暂无**。本骨架不含任何上游实现，只有占位与 TODO。
