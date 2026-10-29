/**
 * 讲义导出的**宿主半边**。
 *
 * 挂 `ctx.zhiyunHandout` 服务：把当前讲义导出成笔记库里的一份 md。
 *
 * # 依赖方向
 *
 * `zhiyunVaultNotes` 是**惰性**取的，**不写进 `inject`**：它缺席时导出只是不可用，
 * 不该把学习页整片拖成 pending。这是本仓已经踩过的坑（见
 * `dsh-zhiyun-core-study/src/host.js` 那段「只声明硬依赖」的注释）。
 *
 * # 为什么这里可以碰不到文件系统
 *
 * 全部读写都经 `zhiyunVaultNotes`（它自己做路径安全、原子写与索引刷新）。
 * 本包连 `node:path` 都不需要 —— 路径推导全在 `src/version.js` 里以相对路径表达。
 *
 * # 这个服务**不**参与生成
 *
 * 讲义生成完不会自动导出（旧设计的钩子已废弃）。导出是用户在看讲义时按一下才发生的
 * 动作 —— 一次生成就往用户笔记库里塞一份文件，而他可能根本不想导，那是噪音。
 *
 * 也没有版本、归档、回退与基线：笔记库里的副本归用户自己管，重名时加后缀而不是覆盖。
 */

import { createHandoutService } from './store.js';

export const name = 'zhiyun-core-handout';

export const inject = ['profileContext'];

export async function apply(ctx) {
  const log = (message) => {
    const line = `[zhiyun-core-handout] ${message}`;
    if (typeof ctx.logger?.info === 'function') ctx.logger.info(line);
    else console.log(line);
  };
  const warn = (message) => {
    const line = `[zhiyun-core-handout] ${message}`;
    if (typeof ctx.logger?.warn === 'function') ctx.logger.warn(line);
    else console.warn(line);
  };

  /**
   * 惰性建立服务：`zhiyunVaultNotes` 若还没就绪（或没装），第一次调用时才报出来。
   *
   * 每次调用重新取一次，而不是在 apply 时抓一次实例：笔记页可能因为配置变化被
   * 重新挂载，抓着旧实例会让服务在一个已经停用的对象上读写。
   */
  function currentService() {
    const notes = ctx.get('zhiyunVaultNotes');
    if (!notes) {
      throw Object.assign(new Error('讲义导出需要笔记库（zhiyunVaultNotes 未就绪）'), { code: 'NOT_WIRED' });
    }
    return createHandoutService({ notes, log, warn });
  }

  /**
   * 服务面：每次方法调用都取一次当前笔记服务。
   *
   * 为什么不把 service 缓存起来：见上面 currentService 的说明。代价是每次调用多一次
   * `ctx.get`（微秒级），换来的是「笔记页重挂之后仍然能用」。
   */
  const facade = {};
  for (const method of ['exportLecture', 'exportMarkdown']) {
    facade[method] = (...args) => currentService()[method](...args);
  }
  /** 诊断：这一层能不能用。 */
  facade.ready = () => Boolean(ctx.get('zhiyunVaultNotes'));

  const remove = ctx.provide('zhiyunHandout', facade);
  log('讲义导出层就绪');

  return () => {
    if (typeof remove === 'function') remove();
  };
}
