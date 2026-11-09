/**
 * 「校园通知」：学校各部门和本人学院的通知。通知汇总、屏蔽词和按档案判断相关度、读正文、加到备忘录都在根服务里
 * （feed.mjs、notice-*.mjs），看这一行开没开。
 */
import { row } from '../row.mjs'

export default row('notices')
