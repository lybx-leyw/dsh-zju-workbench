// 【候选骨架 · 未评审 · 未接入 profile · 不可直接使用】
//
// 目标：锁定挂载上游 dsh-score，为「插件」页（dsh-zhiyun-page-plugins）增强
//       **插件质量评估**维度。
//
// 性质：**强化式集成** —— 三条同时成立：
//   1. 仍是**同一个「插件」面板**（侧栏第 7 项，不新增导航项）；
//   2. 功能**相似正交** —— 现有页答「关掉谁、会不会连坐」（依赖关系图 + 启停开关），
//      本包答「装谁、它靠不靠得住」（安装实测 + 维护活跃度 + 文档完备度多维评分）；
//   3. 底层**多调了更优质的实现** —— 本仓原本**完全没有**任何插件质量评分能力。
//
// 上游：https://github.com/PerryLink/dsh-score
//   许可证：Apache-2.0 ✅（宽松白名单）
//   语言：TypeScript
//   ★：12（⚠ 低，属早期项目 —— 采用前必须在隔离环境验证）
//
// TODO（采用前必须完成）：
//   1. 【锁版】确认上游实际版本，写入 package.json 的 dependencies，**版本号写死、不用 `^`**
//      （见 src/upstream.js 的 UPSTREAM_VERSION，与 packages/dsh-zhiyun-paper 的写法一致）。
//      注意：须先确认上游在 npm 上的**真实包名** —— 本骨架的 `@perrylink/dsh-score`
//      仅为占位，未经 registry 核实。
//   2. 效法 packages/dsh-zhiyun-paper：宿主半边挂载上游 + 补本仓自有能力。
//   3. 效法 packages/dsh-zhiyun-page-paper：页面半边用同源 iframe 承载上游页面、
//      注入 --zy-* 主题、接管已搬进本壳的上游控件；数据走上游 API。
//   4. **确认评分数据源可否离线** —— 若上游依赖外部 API 计算分数，
//      须评估在浙大网络环境下的可达性，并设计降级（无分数时页面照常可用）。
//   5. 现有「插件」页有明确的**只读 / 写入口边界**（见其 README「边界」一节：
//      「宿主半边只读一个方法 graph。要改开关请走 pluginManager，不要在这里加写入口」）。
//      **本包必须沿用同一条边界** —— 评分是**只读展示**，不得在此新增写入口。
//   6. **不改上游源码**；完成后按 CONTRIBUTING 的流程测试、接入 profile、写 OWNERS。
//   7. 补 tests/radar-plugin-score.test.mjs，断言「声明版本 = 实际安装 = 代码预期」三者一致。

export const name = 'radar-plugin-score';

// 骨架阶段不注册任何内容 —— 真正的挂载在评审通过后按上述 TODO 落地。
// 保留一个空的 apply 是为了让 Loader entry 的形状与真实包一致（便于评审时对照）。
export function apply() {
  // TODO: 挂载上游 dsh-score 的宿主半边，并把评分读数经 /api/ 暴露给「插件」页。
}
