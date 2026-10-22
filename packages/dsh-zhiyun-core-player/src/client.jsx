// 播放统计的客户端入口：把同一份纯函数交给学习页的视频栏。
//
// 页面包不能把本包源码打进自己的 bundle（构建守卫不许内联本包 src/ 之外的文件），
// 所以这里单独成一个客户端包，学习页用 external import 在运行时拿到它。
// 宿主半边的 `zhiyunPlayerStats` 仍然是同一批函数，两边不各写一份算法。
export const name = 'zhiyun-player-client';
export const inject = [];
export function apply() {}

export { computeSectionStats, toSeekBar } from './stats.js';
