/**
 * `@lybx-leyw/dsh-zju-tool-xxt` —— 学习通（超星 / chaoxing）工具包。
 *
 * # 一个包只装一个域
 *
 * 与 `source/xxt` 一一对应：那个包提供学习通的**平台接口**，本包提供它的**工具面**。
 * 上游 `chaoxing` 模块的 10 条 provides 里，7 条是数据能力（课程、章节、课件、
 * 视频、作业的清单与下载），3 条是会话动作。会话动作（登录 / 状态 / 登出）在本仓
 * 属于装配层与设置页，不是 agent 该调的工具 —— 模型没有办法替用户扫码。
 *
 * # 为什么这一包**没有写工具**
 *
 * 学习通里所有「写」都是用户自己的决定且不可逆：交作业、开始考试、签到。
 * 本包刻意一条都不做（`index.js` 顶部的只读边界是产品口径，不是实现细节）。
 * 所以这里只有一条注册链 —— 读工具那条，**不过审批**。
 *
 * 下载文件不算写：它读平台、写本机，平台上的状态一点没变。判据是
 * 「有没有改别人的状态」，不是「有没有碰磁盘」。
 *
 * # 本包不带自己的挂载行
 *
 * `package.json` **没有** `dsh.bundle.patch`，仓库里**没有** `cordis.patch.yml`。
 * 工具包只负责「怎么注册」，不负责「什么时候装」—— 后者是 preset 的决定
 * （D11 未定）。两边各写一份挂载行的后果是同一个工具在表里出现两次。
 */
import { createReadToolRegistrar } from '@lybx-leyw/dsh-zju-tool-kit';

import { createXxtReadTools } from './reads.js';

export const name = 'zhiyun-tool-xxt';

/**
 * 只声明 `tools` 与自己的数据源。
 *
 * 没有 `approval`：这一包一条写操作都没有，声明它只会误导后来加工具的人
 * 「审批已经接好了」。
 */
export const inject = ['tools', 'zhiyunXxt'];

const SERVICE_SOURCES = Object.freeze({
  zhiyunXxt: '@lybx-leyw/dsh-zju-source-xxt',
});

export function apply(ctx) {
  createReadToolRegistrar({
    ctx,
    build: createXxtReadTools,
    serviceSources: SERVICE_SOURCES,
  }).register(createXxtReadTools);
}

export { createXxtReadTools } from './reads.js';
