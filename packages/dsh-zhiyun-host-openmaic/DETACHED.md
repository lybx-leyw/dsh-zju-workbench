# 未接入：先放着吃灰（2026-10-30）

上游托管包**已经能跑**，但按决定**暂不接进 profile**。本文件是它的状态标记，
与 `packages/dsh-zhiyun-page-classroom/DETACHED.md` 成对。

## 为什么留着一个不启用的包

它不是半成品：vendor 三重校验通过（归档 `09d61133…`、树摘要 `7b009d12…`、
3835 文件、版本 1.3.0），上游构建成功，服务起得来，`/api/stages` 返回 200，
页面里 iframe 实测渲染出了上游完整首页且零报错。停用是**产品决定**，不是技术失败。

## 重新接入前必须先解决的事

1. **PostgreSQL 不在宿主生命周期里**。目前是手工起的便携版（临时目录、gitignore）。
   换机器或重启后页面会报 `no-database`。要把它做成开箱可用，得在宿主包里托管
   数据库的起停，或者接受「需要用户自己提供一个库」并写进文档。
2. **构建必须带 `ALLOWED_FRAME_ANCESTORS`**，否则 iframe 必被 CSP 拦：
   上游在 `next.config.ts` 的 `headers()` 里读它，而 `headers()` 是构建期求值、
   写死进 `.next/routes-manifest.json` 的。运行时再设环境变量完全无效。
3. **连接串只能走环境变量**。实测 profile 的 `cordis.patch.yml` 覆盖对
   `config` 没生效（`dump` 里条目没有 `config`），所以 `OPENMAIC_DATABASE_URL`
   才是实际入口。这一点要在文档里写死，别让人去改 patch 文件试。

## 接入步骤

见 `packages/dsh-zhiyun-page-classroom/DETACHED.md` 的清单。
