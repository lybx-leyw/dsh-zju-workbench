/**
 * 「课程讲解」：把一次课或一份资料讲成带画面的讲解（core/learn）。不做配音。
 * 可选依赖（TeX、检查版面的浏览器）和讲解的播放在根服务里（learn.mjs、film.mjs），看这一行开没开；技能正文里讲解的那一段只在它开着时有。
 * 这一行打开时，动画用的 gsap 和 three 没下载过就开始下载（learn.mjs 的 prepare）。
 */
import { row } from '../row.mjs'

export default row('learn', { start: (_ctx, campus) => { campus.learnKit.prepare() } })
