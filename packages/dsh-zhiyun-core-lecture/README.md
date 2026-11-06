# dsh-zhiyun-core-lecture

智云 Pro 的**讲义装配**层：PPT 知识树 → 录音稿填充 → 书面语验收。

零 UI、零 Flutter 依赖、**零落盘**。llm 由集成层注入窄接口（`{ call({stage, route, constant, variable, signal}) }`），
本包不自建模型客户端，也不碰宿主存储。

## 规格来源

**逐条对齐 App 的 Dart 实现，不自己发明算法。** 每个源文件头都写明了它对齐的是哪一件：

| 本包文件 | App 侧规格 |
|---|---|
| `src/tree.js` | 课件页面 → 章 / 知识点树（页眉页脚识别、噪音行、标题判定） |
| `src/polish.js` | 逐知识点填充：提示词、分块、解析、填充词与长度验收 |
| `src/register.js` | 书面语验收（课堂称呼、半截句、口语词比例） |
| `src/agent-text.js` | 讲义 ⇄ agent 文本（导出 / 回填 / 复核单元） |
| `src/index.js` | 无（本包自己的宿主接缝） |

## 三条硬纪律在这一层的落点

1. **不平行实现第二套真源** —— 讲义正文只在宿主存储里；本包只做纯函数变换，
   `assemble()` 返回结构，不落盘。
2. **不许自己发明算法** —— 阈值（`kPolishLengthRatio` / `kPolishMaxFillerKeep` /
   `kTreeHeaderPageRatio` …）与失败文案都照抄 Dart 侧。
3. **实验条件不许动** —— `kLectureWrittenSystemPrompt` 是那次 A/B 对照的输入，
   与 `fixtures/system-prompt.txt` **逐字节**一致（`tests/lecture.test.mjs` 钉死）。
   改它等于换掉实验条件，必须显式面对。

## fixtures

| 文件 | 作用 |
|---|---|
| `fixtures/system-prompt.txt` | Dart 侧 `kLectureWrittenSystemPrompt` 的冻结副本 |
| `fixtures/dart-golden.json` | 真的跑 Dart 导出的差分快照（树 / 验收 / 清洗三类用例） |

两份都冻在**包内**而不是 `tests/fixtures/`：它们是这个包自己的磁盘契约，跟着包走。

## 用法

```js
import { apply } from 'dsh-zhiyun-core-lecture';

// 宿主侧：提供 llm（这里由 zhiyunParser 透传），也可以用 config.llm 直接给
const dispose = await apply(ctx, { concurrency: 2 });
const lecture = await ctx.zhiyunLecture.assemble({ tree, blocks, context: 'T' });
```

没有可用的 llm 时 `apply()` 抛 `CONFIG`（**不静默降级**）—— 装配一条没有模型的讲义，
产出的东西看起来像讲义，但内容全是原始口语。

## 测试

```bash
node --test tests/lecture.test.mjs
```

单文件覆盖：树、验收、填充、解析容错、prompt 冻结、真实 Cordis 宿主挂载 / 隔离 / 卸载释放、
零宿主依赖扫描、Dart golden 差分。

## v4 共享生成入口

产品集成与 bench 均调用 `zhiyunLecture.generate({ record, title, signal, onProgress, onAssembled })`。它要求解析器的重构树，统一主线输入映射，顺序执行现有装配和逐点终审；返回 `{ assembled, polished, lecture }`。`onAssembled` 可保存成稿检查点；进度按实际完成分卷/知识点报告。提示词、分组和验收算法继续由原模块负责。

`createRun({ llm, concurrency })` 为一次生成建立隔离实例，可与解析器共享多供应商 worker 池；成稿和终审使用传入的总 worker 数，不另设较低并发上限。
