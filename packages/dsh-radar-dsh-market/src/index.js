// 【候选骨架 · 未评审 · 未接入 profile · 不可直接使用】
//
// 目标：锁定挂载上游 dsh-market，为「插件」页提供插件市场能力。
// 性质：强化式集成 —— 仍是同一个「插件」面板，底层换更优质的实现。
//
// TODO（采用前必须完成）：
//   1. 确认上游 dsh-market 的版本，并【锁版】写入 package.json 的 dependencies
//      （版本号写死，不用 ^ —— 见 packages/dsh-zhiyun-host-paper 的 @ggboy123/dsh-paper-reader 写法）。
//   2. 效法 packages/dsh-zhiyun-host-paper：宿主半边挂载上游 + 补本仓自有能力。
//   3. 效法 packages/dsh-zhiyun-page-paper：页面半边用同源 iframe 承载上游页面、
//      注入 --zy-* 主题、接管已搬进本壳的上游控件；数据走上游 API。
//   4. 不改上游源码；完成后按 CONTRIBUTING 的流程测试、接入 profile、写 OWNERS。

export const name = 'dsh-radar-dsh-market';
