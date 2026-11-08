# 第三方代码与素材

项目自有代码采用 GNU General Public License 第 3 版，仅限该版本（`GPL-3.0-only`），全文见 [LICENSE](LICENSE)。第三方代码、依赖、字体及其他素材保留原有版权声明和许可，项目许可证不会替换这些许可。

- `core/zju/lib/xuezai/rollcall.ts` 的雷达签到流程、校区参考点坐标和球面距离拟合（100 位 Decimal 的 Gauss-Newton 三边测量）移植自 [5dbwat4/ZJU-live-better](https://github.com/5dbwat4/ZJU-live-better) 的 `courses.zju/autosign.js`，拟合部分由 5dbwat4 在提交 `466e2bd`（2025-12-10）加入，版权归该仓库的各位贡献者。上游以 GNU GPL 第 3 版发布：仓库附 GPL v3 全文，源文件本身不带许可标注。这段代码先进入本项目作者自用、未公开的整理版 `ZJU-Course-Autosign`（`src/core.js`，从上游 `9f3fec5` 改写），再经 zju skill 于 2026-11-01 引入本项目，按 `GPL-3.0-only` 分发；相对上游的改动写在该文件开头的注释里。
- 微信数据库格式相关来源及 MIT 许可全文见 [core/wechat/THIRD_PARTY_NOTICES.txt](core/wechat/THIRD_PARTY_NOTICES.txt)、[core/weread/THIRD_PARTY_NOTICES.txt](core/weread/THIRD_PARTY_NOTICES.txt)。
- DeepSeek Harness、微信公众号浏览器适配器所用的 Electron，以及插件按需下载的 FFmpeg，沿用各自的许可证。FFmpeg 下载来源 `ffmpeg-static` 标注为 `GPL-3.0-or-later`。
- 系统凭据库桥接库 `@napi-rs/keyring` 使用 MIT 许可，完整声明随该依赖分发。

分发修改版或安装包时，须保留适用的第三方声明，并按 GPL 和各组件许可证履行相应的源码提供及分发义务。上面是仓库内明确保留的来源索引，不替代依赖包各自的完整许可文本。
