# dsh-zhiyun-page-classroom-build

「生成课堂」页：**说清楚要什么 → 看一眼大纲并改掉 → 场景一个个生成出来**。

```
① brief                     ② 大纲                      ③ 生成
主题 / 受众 / 深度三档        增删场景、改类型、拖序        场景逐个出现
可选 PDF                      「开始生成」                 可取消 / 失败可重试
        └──────────────►             └──────────────►
```

## 边界

- **只注入 `slots`**（写在 `src/client.jsx`）。课堂宿主服务 `zhiyunClassroomStudio`
  不写进 `inject`：宿主包没搬完时写进去会让整页一直 pending。页面在渲染时
  `ctx.get('zhiyunClassroomStudio')` 惰性取，取不到就显示「课堂服务未就绪」，
  页面本身仍然站得住。
- **宿主半边是空壳**（`src/index.js` 的 `apply()`）。宿主侧没有 `slots` 服务，
  把 `inject: ['slots']` 写在这里会让插件在宿主上永远等不到依赖 —— 那一行只会把
  「页面没注册」升级成「整个包没启动」。真正的 `inject` 与注册动作在 `client.jsx`，
  插槽名与 `registerSlot()` 集中在 `index.js`，两边不复制字符串。
- 不 import 任何别的包的 `src/`；只走 `ctx.*` 与 `dsh-zhiyun-shell-ui` 的公开导出。
- 不新增宿主种子，不加 npm 依赖。PDF 只在浏览器里记下文件名/大小，**不上传**（见下）。
- 样式一张 `src/style.css`，选择器全部 `.zyc-build-*`，颜色只取外壳的 `--zy-*`。

## 插槽

在 **`zhiyun.classroom.build`** 注册页面组件。声明 `children` 的是外壳。

⚠️ 外壳当前渲染的是 `zhiyun.<page>.content`（`shell-workbench/src/components.jsx:386`），
而 `NAV` 里还没有 `classroom-build` 这一页。也就是说插槽注册是对的，但要看见页面，
还需要在壳里加页面 id 与导航条目 —— **那部分在壳里，不在本包**。本包改不了它，
也不应该为了让它显示而复制一份外壳。

## 文件

| 文件 | 职责 |
| --- | --- |
| `src/index.js` | 宿主空壳 + 插槽名 + `registerSlot()` |
| `src/client.jsx` | 三步界面；调 `generate`、取消、重试 |
| `src/progress.js` | **所有状态转移**：事件流归约 + 大纲增删改拖序（纯函数） |
| `src/style.css` | `.zyc-build-*`，窄屏断点在文件末尾 |
| `tests/classroom-page-build.test.mjs` | 归约 + 三步静态渲染 |

## 事件契约（本包读到的部分）

`generate()` 返回 `{ runId, events: AsyncIterable<event> }`。本包把每个事件按
`{ type, data }` 读（也容忍 `data.scene` 嵌套与 event 顶层字段）：

| 事件 type | 归约结果 |
| --- | --- |
| `run_start` / `start` | `phase → running` |
| `outline`（`data.scenes`） | 补齐 `pending` 场景，不覆盖已生成的 |
| `scene_start` / `scene` | 场景 `running`，按 `id` 去重 |
| `scene_done` / `scene_end` | 场景 `done`；终局场景不被迟到的 start 拉回 |
| `scene_error` | 该场景 `failed`，整条流继续 |
| `done` / `complete` | `phase=done`、`done=true`，在跑的收成 `done` |
| `error` | `phase=failed`、`done=true`、`error={message,code}` |
| `cancel` / `cancelled` / `abort` | `phase=cancelled`、`done=true` |
| 其余（`text_delta`/心跳/agent） | 原样返回，不触发重渲染 |

状态恒为 `{ phase, scenes, done, error }`；终局后迟到的事件一律忽略。空流保持
`idle`，**不**冒充 `done`。

## 已知不够用的地方

1. **`generate` 本身还没实现**：`host-classroom/src/service.js` 目前抛
   `E_NOT_IMPLEMENTED`，页面会如实落到失败态并提供「重试」。契约只写了
   `AsyncIterable<event>`，**没写事件名、字段、终局保证**，所以上面的兼容集是猜的。
2. **没有附件通道**：规范 §4 的 `generate(brief, opts)` 没定义上传；本包只把
   `{ name, size, type }` 放进 `brief.attachment`，PDF 内容从未离开浏览器。
3. **取消没有确认语义**：`runs.cancel()` 可能抛（未实现），本地仍会中止迭代并置
   `cancelled`；但无法知道宿主是否真的停了生成。
4. **构建登记未做**：按本轮硬约束不改 `scripts/build.mjs`，所以本包尚未进
   `CLIENT_PACKAGES`，也不会自动产出 `lib/client.js`（`tests/build-seeds.test.mjs`
   会因此报一条「有 client.jsx 却不在清单里」）。解除约束后把包名加进去即可。
