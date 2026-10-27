# 常用配置与排查

## 常用命令

| 需求 | 命令 |
| --- | --- |
| 检查宿主版本、初始化或更新 profile | `npm run profile:check` |
| 查看合并后的插件配置 | `npm run profile:dump` |
| 只构建不启动 | `npm run build` |
| 换端口启动 | `npm start -- --port 3081` |
| 跑全部单测 | `npm test` |
| 检查样式表顺序隐患 | `npm run check:css` |
| 在真实宿主里验收 | `npm run test:host` |

## 三个环境变量

需要指定安装或数据位置时才设置，都在**同一终端**里生效：

| 变量 | 作用 | 默认 |
| --- | --- | --- |
| `ZHIYUN_DSH_APP_DIR` | 宿主绝对路径，指向包含 `node_modules` 的那一层 | 先找 Windows 默认位置的 DSH Desktop，再找 `.runtime/dsh-<版本>/` |
| `ZHIYUN_DSH_HOME` | 会话、配置与存储的数据目录 | `.runtime/home/` |
| `ZHIYUN_PORT` | 端口 | `3091`，可被 `--port` 覆盖 |

以 PowerShell 为例，把路径换成自己机器上的实际位置：

```powershell
$env:ZHIYUN_DSH_APP_DIR = 'C:\Users\me\dsh-host'
npm start
```

> 文档里一律写占位路径（`C:\Users\me\…`）。**不要把带自己用户名的真实路径贴进仓库**，
> 原因见「个人信息与提交」那一篇。

**`.runtime/home/` 保存真实数据，不要当缓存删掉。** `.runtime/dsh-<版本>/` 才是可以
随时重装的宿主目录。

## 起不来时按这个顺序查

1. **提示宿主缺失或版本不匹配** → 按「安装与启动」装对应版本，并检查有没有设
   指向别处的 `ZHIYUN_DSH_APP_DIR`。显式指定的宿主不可用时脚本会直接报错，
   不会自动回退到别的位置。
2. **提示缺少客户端产物** → 先 `npm run dev`（或只 `npm run build`）。`lib/` 是构建产物，
   不进仓库。
3. **整页空白、终端有插件加载失败** → 大概率是某个包声明了 `dsh.client` 却没有
   `exports["./client"]`。这种情况宿主会**拒启整个工作台**，不是只挂掉那一页。
   往 `profiles/zhiyun-bench/package.json` 里临时删掉那一项就能起来。
4. **某一页显示"当前未启用"** → 那是外壳的 fallback：这一页的包被取消了，或者没进 profile。
   用 `npm run profile:dump` 看合并后的配置。
5. **窗口提示实例退出（退出码 1）** → 关掉窗口，回到能 `npm start` 成功的终端重开桌面壳。

## 改样式之后必跑的那条

```bash
npm run check:css
```

它检查的是"同特异性规则被拆到不同包里、胜负只剩挂载顺序"这一类隐患 —— 这种问题
在单包里看是好的，装到一起才错，且错得很难解释（某个断点的媒体查询突然不生效）。
详见「测试与验证」。

---

> 内容摘写自 `docs/contributing/CONTRIBUTING.md` 第 1.3 节。
