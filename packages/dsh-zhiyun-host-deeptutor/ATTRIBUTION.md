# 上游来源与改动说明

## 来源

- 项目：[HKUDS/DeepTutor](https://github.com/HKUDS/DeepTutor)
- 许可证：Apache License 2.0（全文见 `vendor/deeptutor/LICENSE`）
- 固定提交：`a31d82624c27d75f4e771d4fcb78dce16470b383`
- 上游版本：`1.6.15`（`vendor/deeptutor/deeptutor/__version__.py`）
- 获取方式：GitHub codeload 归档（`git clone` 在本机多次超时），
  归档 SHA-256 `bb9b1281afccf632a4f51f1d834233051970b44143967fa206e24314ff457830`。
- 快照位置：`vendor/deeptutor/`，3875 个文件、约 60.8 MB，逐字节保留上游原样（含其自身
  `.gitignore`、`pyproject.toml`、`THIRD_PARTY_NOTICES.md`）。

## 改动

**没有。** `vendor/deeptutor/` 是未经修改的上游快照。

宿主侧的一切差异都落在包自己的目录里：

- 模型传输：`python/llm_shim.py` 在**运行时**替换 `deeptutor.services.llm.complete/stream`，
  让上游全部 agent 的模型调用走智云宿主的 `ctx.llm`。这是 monkeypatch，不是改源码。
- 数据位置：只设置环境变量 `DEEPTUTOR_HOME`，不碰上游任何路径常量。
- 首次运行播种：`python/deeptutor_bridge.py` 在构造 `DeepTutorApp()` 之前调一次上游自己的
  `services.setup.init_user_directories(None)` + `services.config.ensure_runtime_settings_files()`
  （上游 `runtime/launcher.py:1440-1443` 与 `api/main.py:522-524` 在起服务前做的同一套动作）。
  **`data/user/settings/*.yaml` 是上游函数写出的产物，宿主不编造、不复制任何默认值**；
  桥只是替上游 launcher 补了一次调用 —— 因为把上游当库用时它会跳过自己入口里的这段初始化。
  该调用幂等（上游只在文件缺失时写默认值），因此每次启动都调。
- 若将来确实必须改上游行为，改动要写成 `patches/` 下的可重放补丁（带 `git apply --check`
  前置校验），不得手改 `vendor/` 内的文件。当前 `patches/` 为空。

这样设计的理由：上游还在活跃演进，我们希望「升级上游」始终等于「换一个提交 + 重放补丁」，
而不是「把上次的改编再手工合一遍」。

## 分发

`vendor/deeptutor/` 全量留在仓库里（便于审计与复现），但打包分发时按 `distribution.json`
排除非运行内容：开发截图（`assets/`，25 MB）、上游前端源码（`web/`，15.8 MB）、
上游测试（`tests/`）、开发文档与示例脚本。Python 运行只需要
`deeptutor/`、`deeptutor_cli/`、`requirements/`、`pyproject.toml`、`LICENSE`、
`THIRD_PARTY_NOTICES.md`。

## 上游的第三方依赖

上游自己的 `vendor/deeptutor/THIRD_PARTY_NOTICES.md` 原样保留，随包分发。
Python 依赖通过 `vendor/deeptutor/requirements/*.txt` 安装，按各依赖自身的许可证使用。
