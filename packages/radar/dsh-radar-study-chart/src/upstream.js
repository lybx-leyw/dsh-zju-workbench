/**
 * 【候选骨架·未评审】上游 `dsh-chart@0.5.0` 的封装占位。
 *
 * 为什么单独一层：上游是 `main: lib/index.js` + `exports["./client"]` 的**双半包**
 * （宿主半边注册工具、浏览器半边注册 slot）。宿主侧**只允许通过本文件**接触它 ——
 * 将来上游改 slot 契约（如 `turnTail` 改名），要改的只有这一个文件。
 *
 * 锁版事实（本轮 npm registry 实测，非 README 自述）：
 *   - `dist-tags.latest = 0.5.0`，历史版本仅 `0.1.0 / 0.2.0 / 0.5.0`；
 *   - `peerDependencies = { "@deepseek-ai/dsh-tools": "*" }` —— 通配，无版本冲突；
 *   - `dependencies` 为空；`unpackedSize = 23264`（22.7 KB）；
 *   - recharts 是**开发依赖、构建期内联进客户端 bundle**，不在运行时依赖里。
 *   - `package.json` 自带 `dsh.bundle.patch = "./cordis.patch.yml"`，
 *     上游 patch 内容为 `insert: [{ id: chart, name: dsh-chart }]`。
 *
 * 上游对外契约（来自 src/index.ts / src/client/index.ts）：
 *   - 工具名 `show_chart`，参数 `{ type: 'pie'|'bar'|'line', title?, labels[], values[], seriesName? }`
 *   - `MAX_POINTS = 100`（超过即降级，模型应自行聚合 —— 与本仓「一学期 attempt 数」量级要核对）
 *   - pie 超过 `MAX_SLICES` 时最小的几片折叠成 "Other"
 *   - 校验唯一权威是 `chart-spec.ts` 的 `checkChartSpec` / `parseChartSpec`，两半共用
 *
 * TODO(评审后)：
 *   - `seriesToSpec(series)`：把 `attemptSeries()` 的输出转成上游 spec
 *     （**在本地先做 100 点截断**，不要指望上游兜底 —— 上游只会降级，不会聚合）；
 *   - `registerChartTool(ctx)`：透传上游宿主半边的注册，不重写 `defineTool` 描述；
 *   - 上游 slot 只有 `conversation.chat.turnTail` 与 `tool.call.toolview`，
 *     **面板内嵌需要另找挂点**，这是评审阻塞项。
 *
 * 注意：不要在这里重写 SVG 渲染 —— 上游已用 recharts 内联渲染，
 * 再写一套就是「重复且无增益」。
 */

export const UPSTREAM = 'dsh-chart';
export const UPSTREAM_VERSION = '0.5.0';

/** 上游单图最大数据点数（与 `chart-spec.ts` 的 `MAX_POINTS` 保持一致，改动需同步）。 */
export const MAX_POINTS = 100;

/**
 * 占位：把 `{ labels, values }` 序列交给上游 `show_chart`。
 * @returns {Promise<never>}
 */
export async function invokeShowChart() {
  throw new Error('skeleton: invokeShowChart 未实现（候选骨架，未评审）');
}
