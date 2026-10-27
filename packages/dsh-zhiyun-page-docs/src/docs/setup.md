# 安装与启动

以下命令都在**仓库根目录**执行。除标明终端的例子外，PowerShell、cmd 与
macOS / Linux 终端通用。

## 环境要求

- **Node.js**：22.19.0 至 22.x，或 24.0.0 及以上（以根 `package.json` 的 `engines` 为准）
- **npm**：安装依赖、构建、启动
- **Git**：版本协作，以及可选地拉取参考源码

先验证三条命令都能输出：

```bash
node -v
npm -v
git --version
```

版本不对就先用包管理器装好再往下走。Windows 上先确认 `winget` 可用，
macOS 可以用 `xcode-select --install`，Linux 用发行版自己的包管理器。

## 首次安装

依次三步：装独立宿主、装项目依赖、构建并启动。

```bash
npm install --prefix .runtime/dsh-0.2.0-rc.2 @deepseek-ai/dsh@0.2.0-rc.2
npm ci
npm run dev
```

三个细节都是必要的：

1. **版本号写死**，取 `runtime.lock.json` 里的 `preferredHostVersion`。不要换成 `@latest` ——
   宿主版本一变，插件面可能整体不兼容。
2. **不要省略 `--prefix`**。它把宿主装进 `.runtime/` 下的独立目录，与本项目的依赖互不干扰。
3. Windows 上如果默认位置已经有受支持的 DSH Desktop，第一条可以跳过。

## 启动成功的标志

终端会打印实际使用的宿主、profile、数据目录和访问地址。用终端给出的**完整地址**
（带临时访问令牌）打开，能看到左侧导航就是成功了。

默认端口 `3091`。要换端口：`npm start -- --port 3081`。

## 日常开发

- 改了源码 → `npm run dev`（构建 + 启动）
- 只改宿主侧、不需要重新构建 → `npm start`
- **`dev` 不会持续监听源码变化**，改完要重跑
- 依赖锁文件变了 → `npm ci`

## 桌面窗口（可选）

命令行能起来之后，可以用 Electron 壳把**同一个** profile 开在窗口里。壳不安装宿主、
不构建客户端，所以 `npm run dev` 必须已经成功。

```bash
npm --prefix apps/desktop install   # 首次，要下 Electron，一百多 MB
npm run desktop                     # 之后都在仓库根执行
```

窗口里应看到与浏览器相同的导航。日志在 Electron userData 目录的 `launcher.log` ——
Windows 上 `electron.exe` 不把标准输出回传到终端，卡住时只能看这个文件。

壳用**启动它的那个 Node** 拉起宿主。Electron 自带的 Node 会被宿主原生模块拒绝
（运行时指纹不匹配），表现是实例立刻以退出码 1 结束。遇到就先关窗口，回到能
`npm start` 成功的终端重开。

---

> 内容摘写自 `docs/contributing/CONTRIBUTING.md` 第 0、1 章。
