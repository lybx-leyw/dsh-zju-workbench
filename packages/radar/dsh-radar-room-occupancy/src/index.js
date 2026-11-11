// dsh-radar-room-occupancy —— 候选骨架（未评审、未接入 profile、不可直接使用）
//
// 目标：为「教室维度」提供一个纯计算层 —— 给定「某教室在某时刻」，
// 答出「可用 / 占用 / 课间切换 / 受限」四态之一。
//
// TODO（评审通过后再实现，本文件当前不提供任何可用行为）：
//   1. 数据来源未定：本仓 `dsh-zhiyun-source-campus` 目前只有 xzzd 待办与 PTA 题集，
//      **没有教室/楼栋/排课数据源**。先确认 zdbk 课表接口是否带教室与楼栋字段
//      （与 `dsh-radar-tongge-schedule` 的待办同一项前置）。
//   2. 若无公开接口 → 只能由用户导入的 .ics / 课表快照在本地合成占用表；
//      合成表不得回传、不得落盘到共享位置。
//   3. 四态判定与 `src/upstream.js` 的上游语义保持一致（见该文件注释）。
//   4. 输出只允许是纯数据，不得在此处直接渲染 DOM / 注册控件。

export const PACKAGE_ID = 'dsh-radar-room-occupancy'

/**
 * 候选骨架占位：未实现。
 *
 * @returns {never} 永远抛错 —— 本骨架不提供任何可用能力
 */
export function apply() {
  throw new Error(
    'dsh-radar-room-occupancy 是候选骨架（未评审），不可挂载。见 README.md 的 TODO 清单。',
  )
}

/**
 * 教室在某时刻的占用状态判定（占位）。
 *
 * @param {unknown} _input 评审后定义形状
 * @returns {never}
 */
export function roomState(_input) {
  throw new Error('未实现：等待评审通过并确定上游语义映射')
}
