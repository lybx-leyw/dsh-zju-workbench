# 学习区的 AI 宠物（鲸鱼娘素材）

学习区那个「点开即可问答」的宠物用这套图。**素材不是本仓原创**，全部取自
[vlln/whale-girl](https://github.com/vlln/whale-girl)（MIT），也就是
[xiaoshihou514/dsh-desktop-pet](https://github.com/xiaoshihou514/dsh-desktop-pet)（「大肥鱼」桌面端）
所渲染的同一套角色资源。角色设计署名 **ZipZipPipe**，详见下方[致谢](#致谢)。

之前本目录里手绘的 `pet-bot.svg` / `pet-whale.svg` / `pet-whale-calf.svg` 已删除，统一改用这套素材。

## 目录

```
docs/ai-pet/
├── index.html                    预览页（本地服务器打开）
├── README.md                     本文件
├── CREDITS.md                    致谢与许可
└── assets/
    ├── manifest.json             帧数 / fps / playback，15 个状态
    ├── LICENSE-whale-girl        whale-girl 的 MIT 原文
    ├── whale-girl-original.png   角色原始立绘（originals/鲸鱼娘.png）
    └── whale-girl/               15 张 sprite sheet
        ├── idle.png working.png celebrate.png error.png disappointed.png
        ├── joy.png eat.png play.png drag.png walk.png sleep.png
        ├── wake.png welcome.png think.png wait.png
```

## 素材规格

- 每张 sheet **宽 `256 × 帧数`、高 256**，帧横向并排，帧 0 在最左。
- 帧数、fps、播放方式以 `assets/manifest.json` 为准，不要写死在调用方：

| 状态 | 中文 | 帧 | fps | playback |
| --- | --- | --- | --- | --- |
| `idle` | 待机 | 3 | 2 | blink |
| `working` | 干活中 | 3 | 3 | loop |
| `celebrate` | 庆祝 | 3 | 4 | loop |
| `error` | 出错 | 2 | 8 | once |
| `disappointed` | 失落 | 2 | 2 | loop |
| `joy` | 开心 | 2 | 5 | loop |
| `eat` | 吃东西 | 3 | 8 | loop |
| `play` | 玩耍 | 3 | 4 | loop |
| `drag` | 被拖动 | 1 | 5 | loop |
| `walk` | 走路 | 3 | 6 | pingpong |
| `sleep` | 睡觉 | 2 | 1 | loop |
| `wake` | 醒来 | 2 | 3 | once（`frameMs: [1000, 200]`）|
| `welcome` | 打招呼 | 2 | 3 | loop |
| `think` | 思考 | 1 | 2 | loop |
| `wait` | 等待 | 1 | 2 | loop |

四种 playback：`loop` 循环、`once` 停在尾帧、`blink`（idle 那种间歇眨眼）、`pingpong` 来回。

## 预览

`index.html` 用 canvas 按 manifest 播放全部 15 个状态，点卡片切主画布。

**必须用本地静态服务器打开**，直接双击会因为 `fetch('assets/manifest.json')` 被 CORS 拒绝而白屏：

```sh
# 任选一种，在仓库根目录跑
npx serve docs/ai-pet
python -m http.server --directory docs/ai-pet 8000
```

## 与宠物行为的关系

这套图只负责外观。「知道当前时间戳」「按课程上下文调工具」属于行为层，与素材无关。
状态映射建议：

| 宠物在做什么 | 用哪个状态 |
| --- | --- |
| 空闲、等用户开口 | `idle` |
| 正在调工具 / 流式生成中 | `working` |
| 正在思考（还没出字） | `think` |
| 等用户补充信息 | `wait` |
| 回答成功、任务完成 | `joy` 或 `celebrate` |
| 工具报错 | `error` |
| 答不出来 | `disappointed` |
| 首次进入学习区 | `welcome` |
| 长时间无操作 | `sleep` → 有输入时 `wake` |

## 致谢

| 角色 / 代码 | 作者 | 许可 |
| --- | --- | --- |
| 鲸鱼娘角色设计 | [ZipZipPipe](https://space.bilibili.com/4168597) | 角色设计署名，随图保留 |
| whale-girl 插件与 sprite 素材 | [Sam Gao (vlln)](https://github.com/vlln/whale-girl) | MIT |
| 桌面端适配（大肥鱼） | [xiaoshihou514](https://github.com/xiaoshihou514/dsh-desktop-pet) | MIT |

MIT 许可要求保留版权声明，原文见 `assets/LICENSE-whale-girl`。完整致谢见 [CREDITS.md](CREDITS.md)。

素材是从 `vlln/whale-girl` 的 `lib/assets/` 原样拷贝的，未做改绘；`whale-girl-original.png` 对应该仓的
`originals/鲸鱼娘.png`。
