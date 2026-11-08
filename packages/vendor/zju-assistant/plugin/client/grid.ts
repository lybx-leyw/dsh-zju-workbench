/**
 * 日程表格子里一天的事怎么摆（SchedulePage.tsx 用，单独放一个文件好测）：
 * 一个时刻落在第几行，课和事按时间放进格子、重叠的并排，截止钉成一行高的卡片、从下往上叠。
 */
import type { PlanItem } from '../calendar.mjs'

export interface Period { period: number, startTime: string, endTime: string }
export interface Placed { item: PlanItem, top: number, bottom: number, lane: number, lanes: number }
/** 钉在格子里的一张卡片（截止、没有时间的事）：一行高，top 是第几行。 */
export interface Pinned { item: PlanItem, top: number }

export const minutes = (time: string) => +time.slice(0, 2) * 60 + +time.slice(3, 5)

/** 一个时刻落在第几行（从 0 起，可以是小数）：在一节课里按比例算，课间算到上一节的底。 */
export function rowAt(time: string, periods: readonly Period[]): number {
  const at = minutes(time)
  for (let index = 0; index < periods.length; index++) {
    const start = minutes(periods[index]!.startTime), end = minutes(periods[index]!.endTime)
    if (at < start) return index
    if (at <= end) return index + (at - start) / Math.max(1, end - start)
  }
  return periods.length
}


/**
 * 一天的事分两种放。有开始时间、落在上课时间里的课、考试和备忘按时间放进格子（top、bottom 是第几行），时间重叠的并排放。
 * 截止，和没有时间、在第一节之前或最后一节之后的事，做成一行高的卡片钉在格子里：卡片的底对着那个时刻，
 * 最后一节以后的（比如 23:59 截止）落在最底下；晚的在下面，早一点的叠在它上面，碰到了就往上抬。没有时间的算一天的最后。
 */
export function place(items: readonly PlanItem[], periods: readonly Period[]): { grid: Placed[], pins: Pinned[] } {
  const first = minutes(periods[0]!.startTime), last = minutes(periods.at(-1)!.endTime)
  const grid: Placed[] = [], loose: PlanItem[] = []
  for (const item of items) {
    const start = item.time ? minutes(item.time) : -1, end = item.end ? minutes(item.end) : start
    if (item.kind === 'due' || !item.time || start >= last || end <= first) { loose.push(item); continue }
    const top = rowAt(item.time, periods)
    const bottom = item.end ? Math.max(rowAt(item.end, periods), top + 0.6) : top + 1
    grid.push({ item, top, bottom: Math.min(bottom, periods.length), lane: 0, lanes: 1 })
  }
  grid.sort((a, b) => a.top - b.top || b.bottom - a.bottom)
  let cluster: Placed[] = [], reach = -1
  const close = () => { const lanes = Math.max(...cluster.map(placed => placed.lane)) + 1; for (const placed of cluster) placed.lanes = lanes; cluster = [] }
  for (const placed of grid) {
    if (cluster.length && placed.top >= reach - 0.001) { close(); reach = -1 }
    const used = new Set(cluster.filter(other => other.bottom > placed.top + 0.001).map(other => other.lane))
    let lane = 0
    while (used.has(lane)) lane++
    placed.lane = lane
    cluster.push(placed)
    reach = Math.max(reach, placed.bottom)
  }
  if (cluster.length) close()
  let floor = periods.length
  const pins = [...loose].sort((a, b) => (b.time ?? '24:00').localeCompare(a.time ?? '24:00')).map((item) => {
    const bottom = Math.min(item.time ? Math.max(rowAt(item.time, periods), 1) : periods.length, floor)
    const top = Math.max(0, bottom - 1)
    floor = top
    return { item, top }
  })
  return { grid, pins }
}
