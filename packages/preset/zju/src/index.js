/**
 * `@lybx-leyw/dsh-zju-preset-zju`
 *
 * 本包的**实质内容**在 `cordis.patch.yml`：它用 `@deepseek-ai/dsh-agent-preset`
 * 声明了一个名为 `zju` 的 Agent preset（标准模式 + 全部校园工具）。
 *
 * # 为什么还要有 index.js
 *
 * 1. patch 的第一行是加载本包本身 —— 那是 Loader 去 `import()` 我们的入口，
 *    少了它本包任何代码都不执行。
 * 2. `apply` 做一次自检：确认 `zju` 真的进了 roster。
 *    「bundle 装上了但 preset 没进 roster」是这个机制最安静的失败模式 ——
 *    preset 不出现在选择器里，没有任何报错。
 *
 * # 为什么会话里能看到两个本仓 preset
 *
 * `lecture`（讲义模式，order 5）与 `zju`（校园模式，order 6）是两个独立条目。
 * 它们是**互斥选择**，不是叠加：一次会话用一个 preset，所以
 * `tool-classroom` 虽然两边都挂，工具表里只会出现一份，不会重复注册。
 *
 * # 为什么自检要等
 *
 * preset 的注册行（patch 里第二个 insert 项）**排在本包之后**执行。`inject`
 * 只保证 `agentPresets` 服务就绪，不保证同一次 patch 里后面的行已经跑完。
 * 实测：apply 刚进来时 roster 里还没有新 preset，几秒后才是完整的。
 * 所以自检放在一个短延时里，且**只读不写**，出错也只 warn。
 */
export const name = 'zhiyun-preset-zju';

export const inject = ['agentPresets'];

/** 自检的延时：给同批 patch 里后续的 preset 声明留出注册时间。 */
const SELF_CHECK_DELAY_MS = 3000;

export function apply(ctx) {
  const timer = setTimeout(() => {
    void (async () => {
      try {
        const presets = await ctx.agentPresets.list();
        const mine = presets.find((preset) => preset.id === 'zju');
        if (mine === undefined) {
          console.warn(
            '[preset-zju] zju 未出现在 preset roster 中（当前 %d 项：%s）——'
            + ' 检查 cordis.patch.yml 里 preset-zju 那一行是否被 Loader 接受',
            presets.length,
            presets.map((preset) => preset.id).join(','),
          );
          return;
        }
        console.info(`[preset-zju] zju 已注册（roster ${presets.length} 项）`);
      } catch (error) {
        console.warn(`[preset-zju] 读取 preset roster 失败：${error?.message ?? error}`);
      }
    })();
  }, SELF_CHECK_DELAY_MS);

  // fiber 卸载时撤掉定时器，避免已销毁的 ctx 上再读一次。
  ctx.effect(() => () => clearTimeout(timer));
}
