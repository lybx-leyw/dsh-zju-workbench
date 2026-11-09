/**
 * 「备课」入口：复用讲义/出题那套 **供应商 + 每供应商 worker 数** 配置。
 *
 * # 为什么不自己造一个「章节并发」数字
 *
 * 第一版这里是个裸数字（`chapterConcurrency`），那是错的抽象：
 *
 *   1. 仓库里早就有并发模型 —— `WorkerPoolLlm`（`core-parser/worker-pool.js`），
 *      由若干 `{ provider, model, workers }` 组成，**总并发 = Σ workers**，
 *      请求按各供应商配额负载均衡。
 *   2. 一个裸数字绕过了这套调度：既不能跨供应商分摊，也没有配额约束，
 *      用户还得同时理解「章节数」和「并发数」两个不同的东西。
 *   3. 上限只能靠猜。真正的上限是 **Σ workers**，池子自己知道。
 *
 * 所以这里直接挂 `GenerationModels`（`dsh-zhiyun-page-quiz` 已导出），
 * 用 `purpose='teaching'` 单独存一份配额（`teaching-models.json`）。
 *
 * # 为什么要包一层 `.zs-qz`
 *
 * `GenerationModels` 的样式（`page-quiz/src/style.css`）**每条规则都限定在
 * `.zs-qz` / `.zs-qz-page` 之下**。不套这个祖先类，浮窗虽然渲染得出来，
 * 但 `zs-generation-split` 会退回 `display:block`、面板宽度/定位全丢 ——
 * 用真实浏览器量过：无祖先时 `display:block`，有祖先时 `display:flex`。
 * 所以这层 wrapper 不是装饰，是让复用成立的前提。
 *
 * **章节并发 = 池子的总并发**：多章同时跑时每次模型调用都进池子排队，
 * 超额自动等待。界面上不需要再多一个「几章并行」的旋钮。
 */
import React from 'react';
import { GenerationModels } from '@lybx-leyw/dsh-zju-page-quiz';

/**
 * @param {object} props
 * @param {object} props.controller 学习页 controller（提供 request/models/models-save/teach-*）
 * @param {boolean} [props.disabled] 运行中禁用配置
 * @param {boolean} [props.running] 正在备课
 * @param {boolean} [props.hasResult] 已有课件（主按钮文案变「重新备课」）
 * @param {() => void} props.onGenerate
 */
export function TeachingGenerate({ controller, disabled = false, running = false, hasResult = false, onGenerate }) {
  return <div className="zs-teach-generate zs-qz">
    <GenerationModels
      controller={controller}
      purpose="teaching"
      // 备课不生成图片，所以不要求视觉模型。
      requiresVision={false}
      disabled={disabled || running}
      generationDisabled={disabled}
      label={running ? '正在备课…' : hasResult ? '重新备课' : '生成课件'}
      // 配额的唯一真源是服务端落盘的 teaching-models.json：只有点过「应用配置」
      // 才会落盘。所以这里不把面板里的临时 rows 传下去 —— 传了就会出现
      // 「界面上是 8 路、实际按 3 路跑」这种无法解释的行为。
      onGenerate={() => onGenerate?.()}
    />
  </div>;
}
