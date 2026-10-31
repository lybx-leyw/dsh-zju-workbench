/**
 * 「课堂播放」页的宿主半边。
 *
 * 这一页没有自己的服务端行为：场景来自 `ctx.zhiyunClassroomStudio.classroom.load(id)`
 * （docs/architecture/classroom-port.md §4），页面只负责把场景按类型摆到舞台上。
 * 保留 Loader entry 是为了让客户端 bundle 进入启动图谱 —— 宿主先扫到本包，
 * 才会把 `dsh.client` 列进模块表。
 *
 * # 插槽为什么在 `src/client.jsx` 里注册
 *
 * `inject: ['slots']` 与 `ctx.slots.register(...)` 是**浏览器侧**的事：宿主进程没有
 * `slots` 这个服务。把这条声明写进本文件会让宿主条目永远停在 pending（缺失的服务
 * 不会报错，只会不 apply），正是规范 §4 警告的那种「把前端拖成 pending」。
 * 所以本文件只留插槽的描述符，客户端与它有同一个真源，避免两处各写一份字面量。
 */
export const name = 'zhiyun-page-classroom-play';

/** 插槽名：外壳在播放路由下渲染的内容位。 */
export const SLOT_NAME = 'zhiyun.classroom.play';

/** 优先级 10：外部扩展用默认 0 就能盖住这一页（与「今天」页一致）。 */
export const SLOT_PRIORITY = 10;

/** 无宿主行为：页面内容全部在客户端。 */
export function apply() {}
