/**
 * 上游「可借鉴的契约」清单 —— **不是**依赖封装，本包 `dependencies` 为空。
 *
 * # 为什么 B 类也要有一份 upstream.js
 *
 * A 类在这里写「锁了哪个版本、只用了哪几个导出」。B 类的对应物是「**我借鉴了哪条契约、
 * 哪一条不能借鉴**」——否则下一轮评审无法判断本骨架的结论是从哪来的。
 *
 * # 借鉴对象
 *
 * | 项 | 值 |
 * | --- | --- |
 * | 仓库 | `8eoyw/zju-learning-cli` |
 * | 许可 | **MIT**（仓库根 `LICENSE` 1,137 B，无附加限制） |
 * | 作者 | 8eoyw（partions © PeiPei233，ZLA 移植） |
 * | 取用方式 | **只读契约，不取代码**（见 ATTRIBUTION.md） |
 * | 具体位置 | `zju.py:439`（todos）、`zju.py:452-459`（activities/exams）、`zju.py:739`（ACT_TYPES）、`zju.py:807-815`（act_status） |
 */

/** 本轮从上游读到的端点契约（用于交叉核对，**不参与运行**）。 */
export const UPSTREAM_CONTRACT = Object.freeze({
  /** 聚合端点：上游与本仓 `fast` 用的是同一个 URL，含 `no-intercept=true`。 */
  todos: 'https://courses.zju.edu.cn/api/todos?no-intercept=true',
  /** 逐课活动与测验。 */
  activities: 'https://courses.zju.edu.cn/api/courses/{course_id}/activities',
  exams: 'https://courses.zju.edu.cn/api/courses/{course_id}/exams',
});

/**
 * 上游的「是否还在进行」判据。
 *
 * ⚠️ **与 `isPendingTodo` 不同**：上游读 `is_closed` / `is_started`，本仓读 `published`。
 *    本包**不裁决谁对**（没有真机证据），只把这个差异记下来，供 §9 L-14 讨论。
 */
export const UPSTREAM_PENDING_FIELDS = Object.freeze(['is_closed', 'is_started', 'end_time']);

/**
 * 明确**不可借鉴**的部分（写清楚，比写「可以借鉴什么」更重要）。
 */
export const NOT_BORROWED = Object.freeze([
  '不搬 zju.py 的任何函数体：它是单文件脚本，与本仓 ESM + 包结构不兼容，搬过来就是「搬运上游源码」',
  '不搬它的登录（keyring / Keychain）：本仓用 CAS + SessionStore，两套会话生命周期不同',
  '不搬它的 PPT 截图合并 / 转录链路：本仓 `dsh-zhiyun-core-player` 已有，属重复',
  '不采用它的 `todo` 命令语义：它直接把 `todo_list` 打印出来，没有与逐课对账 —— 这恰恰是本包要补的那一层',
]);

/** 本包**没有**安装任何上游包。留这个函数是为了让「想锁版」的人先看到「没有可锁的东西」。 */
export function loadUpstream() {
  throw new Error('本包（B 类）不依赖任何上游包：不存在可锁的版本，只有可核对的契约。');
}
