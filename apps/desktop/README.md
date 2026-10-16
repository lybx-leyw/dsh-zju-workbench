# zhiyun-pro-desktop

智云 Pro 的**桌面快捷入口**：起一个 DSH 实例，把它开在窗口里。

## 它是什么，不是什么

| 是 | 不是 |
| --- | --- |
| 一个双击就能用的启动器 | ❌ 一个安装包（不做 .exe、不打包） |
| 起实例 + 开窗口 | ❌ 不安装 dsh |
| 读地复用现有 profile | ❌ 不管 profile 的内容 |

**它与产品完全脱节**。宿主在哪、版本对不对、profile 里该有哪些链接 —— 这些
**只读地复用** [`scripts/profile.mjs`](../../scripts/profile.mjs)，也就是 `npm start`
走的那条路。所以壳里打开的与命令行起的是**同一份数据、同一个 profile**，
不是一个平行世界。

## 前置条件

必须先有一个配置好的环境 —— 壳**不会**帮你准备它：

1. 仓库里装好依赖、构建过客户端产物（`npm run build`）；
2. `npm start` 能起来（即宿主已就位、profile 已生成）。

没准备好的话，壳会在窗口里直接说清缺什么（缺客户端产物会点名到包），
并给一个「重试」按钮。**它不会去猜、也不会自动改你的配置。**

## 用法

```bash
npm --prefix apps/desktop install   # 首次：装 Electron（100MB+）
npm run desktop                     # 起壳
```

日志写在 Electron 的 userData 目录（`launcher.log`）—— Windows 上 `electron.exe`
是 GUI 子系统程序，stdout 不回传，所以诊断信息只能落文件。

## 宿主用哪个 node

`npm run desktop` 本身就跑在 node 上。启动器把**这个** node 的路径交给壳，宿主用它拉起，
和 `npm start` 是同一个运行时。

不能改用 Electron 自带的那个 node。`dsh --version` 在 `ELECTRON_RUN_AS_NODE=1` 下能过，
但宿主的原生模块会拒绝这份指纹（当前是 Electron 44.8.0 的 Node 24.22.0 / V8 `…-electron.0`，
它只认 43.0.0、44.0.0、45.0.0-alpha.6），实例马上以退出码 1 结束。

## 验收

```bash
node scripts/test-desktop.mjs
```

起实例那段（`src/boot.js`，不依赖 electron）跑的是**真宿主、真 profile**：
拿地址 → 带 token 303 且下发 cookie、不带 token 401 → `stop()` 后不留孤儿进程。

Electron 能不能完成初始化也在这条验收里（`electron --version` 必须正常退出）。
仓库目录若被标成 **Low 完整性**，`electron.exe` 会继承这个标签，Chromium 沙箱在
进入应用代码之前就崩溃（退出码 `0x80000003`）。窗口不会出现，`launcher.log`
也不会写。事件查看器里这一阶段的失败还会记成 `electron.exe` 自身的访问违规
`0xC0000005`。`src/launch.mjs` 会在启动前只把 **Electron 发行目录**调到 Medium，
渲染进程的沙箱保持开启。

手动看窗口：`npm run desktop`。

## 结构

| 文件 | 职责 |
| --- | --- |
| `src/launch.mjs` | 启动前把 Electron 发行目录的完整性调到 Medium，再拉起 `electron.exe` |
| `src/boot.js` | 起实例、解析地址、收进程。**不 import electron**，所以可测 |
| `src/main.js` | 只有 GUI：窗口、菜单、单实例、退出时收拾 |
| `src/preload.cjs` | 把启动状态递给加载页（`sandbox: true` 下 preload 必须是 CJS） |
| `src/launcher.html/.css/.js` | 启动中的界面：进度、出错原因、宿主输出、重试 |

窗口加载产品页时**按不可信内容对待**：`sandbox: true`、无 node 集成、外链交给系统
浏览器。壳不给页面任何额外能力 —— 它只是个快捷入口。
