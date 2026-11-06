# dsh-zhiyun-page-classroom-play

「课堂播放」页：一份 classroom（`{ scenes, meta, assets }`）按顺序放给你看 ——
顶部是场景进度条，中间是舞台，底部是上一场 / 下一场 / 朗读 / 全屏。

**改这一页的东西都在这里**：进度条、四类场景的呈现、控制条与空状态。场景怎么生成、
账本怎么记、slide 怎么画，都不在这一页。

## 边界

- `inject: ['slots']`，注册插槽时 `priority: 10`，外部扩展用默认 0 就能盖住这一页。插槽名与优先级写在 `src/index.js`（`SLOT_NAME` / `SLOT_PRIORITY`），客户端与宿主读同一份字面量。插槽的注册动作本身在 `src/client.jsx` —— 宿主进程没有 `ctx.slots`，把它写进 `src/index.js` 会让宿主条目停在 pending。
- 惰性 `ctx.inject(['zhiyunClassroomStudio'], …)`：课**不直接找**宿主的课堂包。领域包停用时这一页不注册，外壳显示占位，不会把整个前端拖成 pending。
- 只换壳，不重写渲染树（`docs/architecture/classroom-port.md` §2 通道 4）。slide 整块交给 `dsh-zhiyun-core-classroom-stage` 的 `<ClassroomStage>`（它内部再调 `dsh-zhiyun-classroom-renderer` 的 `<ClassroomSlide>`），本页不碰画布、公式与图表。账本来源是 `scene.ledger` / `scene.ledger.records` / `scene.actions`，`autoplay: false` —— 换场由这一页的游标决定，不让两条时间轴互相抢。
- 另外三类只给最小呈现，不复制上游组件：`quiz` 出题、选项与对错反馈（正确项从 `options[].correct` 或 `answerIndex` / `correctIndex` / `answer` 读，读不到就**不判**，不把第一项当答案）；`interactive` 用 `iframe srcdoc`，沙箱只给 `allow-scripts allow-forms allow-popups`（开 `allow-same-origin` 等于没有沙箱）；`pbl` 显示 briefing 与交付物清单（勾选只在本页，不回写）。
- 不 import 别的包的 `src/`，只走 `exports` 子路径；不新增宿主服务，也不往 `HOST_SEEDS` 加东西。
- 浏览器 API 只在事件与副作用里碰：`requestFullscreen` / `exitFullscreen` / `fullscreenchange`、`speechSynthesis` / `SpeechSynthesisUtterance`。模块级没有任何 `window` / `document`，所以 `renderToStaticMarkup` 与 Node 测试里都能渲染；没有语音合成时「朗读」会自己关掉，不留一个按不动的开。
- 数据只读：本页不调 `classroom.save`，也不发起生成。

## 插槽

在 `zhiyun.classroom.play` 注册内容，渲染函数收到外壳给的 props（`classroomId` 等），
也接受直接传入 `doc` 做编辑器预览。声明 `children` 的是外壳。

## 文件

| 文件 | 职责 |
| --- | --- |
| `src/index.js` | 宿主半边：Loader entry、插槽名与优先级 |
| `src/client.jsx` | 页面：进度条、四类场景的分派、控制条、空状态 |
| `src/style.css` | `.zyc-play-` 前缀的样式（与外壳 `.zy-`、渲染层 `.zyc-` 不相交） |
| `cordis.patch.yml` | 条目 `zhiyun-page-classroom-play` |
