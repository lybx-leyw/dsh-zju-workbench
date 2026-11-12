/**
 * `@lybx-leyw/dsh-zju-preset-lecture`
 *
 * 本包的**实质内容**在 `cordis.patch.yml`：它用 `@deepseek-ai/dsh-agent-preset`
 * 声明了一个名为 `lecture` 的 Agent preset（标准模式 + 课程资料检索工具）。
 *
 * # 为什么还要有 index.js
 *
 * 1. patch 的第一行是加载本包本身 —— 那是 Loader 去 `import()` 我们的入口，
 *    少了它本包任何代码都不执行（踩过）。
 * 2. `apply` 做一次自检：确认 `lecture` 真的进了 roster。
 *    「bundle 装上了但 preset 没进 roster」是这个机制最安静的失败模式 ——
 *    preset 不出现在选择器里，没有任何报错，只能靠翻 DOM 才看得出来。
 *
 * # 为什么自检要等
 *
 * preset 的注册行（patch 里第二个 insert 项）**排在本包之后**执行。`inject`
 * 只保证 `agentPresets` 服务就绪，不保证同一次 patch 里后面的行已经跑完。
 * 实测：apply 刚进来时 roster 是 0 项，3 秒后才是完整的 6 项。
 * 所以自检放在一个短延时里，且**只读不写**，出错也只 warn。
 */
export const name = 'zw-preset-lecture';

export const inject = ['agentPresets'];

/** 自检的延时：给同批 patch 里后续的 preset 声明留出注册时间。 */
const SELF_CHECK_DELAY_MS = 3000;

export function apply(ctx) {
  const timer = setTimeout(() => {
    void (async () => {
      try {
        const presets = await ctx.agentPresets.list();
        const mine = presets.find((preset) => preset.id === 'lecture');
        if (mine === undefined) {
          console.warn(
            '[preset-lecture] lecture 未出现在 preset roster 中（当前 %d 项：%s）——'
            + ' 检查 cordis.patch.yml 里 preset-lecture 那一行是否被 Loader 接受',
            presets.length,
            presets.map((preset) => preset.id).join(','),
          );
          return;
        }
        console.info(`[preset-lecture] lecture 已注册（roster ${presets.length} 项）`);
      } catch (error) {
        console.warn(`[preset-lecture] 读取 preset roster 失败：${error?.message ?? error}`);
      }
    })();
  }, SELF_CHECK_DELAY_MS);

  // fiber 卸载时撤掉定时器，避免已销毁的 ctx 上再读一次。
  ctx.effect(() => () => clearTimeout(timer));
}
