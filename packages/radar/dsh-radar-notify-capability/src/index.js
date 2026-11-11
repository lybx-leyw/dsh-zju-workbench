/**
 * dsh-radar-notify-capability —— **候选骨架，未评审、未接入 profile、不可直接使用。**
 *
 * 目标（见 README）：把「当前环境到底能不能推送、能推到哪一步」抽成**一层统一判定**，
 * 让本仓已经读到、但从未被任何 UI 消费的两个通知读侧
 * （`dsh-zhiyun-source-cc98` 的 `notifications()` / `dsh-zhiyun-source-xxt` 的 `notices()`）
 * 在渲染之前先问同一个问题：**现在有哪条通道真的可用？**
 *
 * # 这里为什么一行实现都没有
 *
 * 骨架的用途是**给评审一个可讨论的形状**，不是先做一半。本文件只做三件事：
 *
 *   1. `apply()` 直接抛错 —— 任何人把它挂进 profile 都会立刻失败，**不会静默降级**；
 *   2. 把「评审要先拍板」的四件事写成 TODO-0 ~ TODO-3，每条都带**为什么不能默认决定**；
 *   3. 声明注入面（`inject`）：只取 `slots`，不取任何数据源，不碰网络，不注册任何 Service Worker。
 *
 * ⚠ **本骨架不含任何上游源码**。B 类候选的判定参照来自
 * `bertholomus/dsh-public-plugins` 的 `plugins/notifications`，
 * 但该上游的 npm 包（`dsh-plugin-notifications`）**至今未发布**（见 `ATTRIBUTION.md`），
 * 因此这里既不锁版、也不引码 —— 只借用它「能力探测 → 降级」这个问题本身。
 */

/** 只声明注入面：不取任何数据源、不碰网络、不注册 Service Worker。 */
export const inject = ["slots"];

/**
 * 评审时必须先回答的问题。做成常量而非注释，是为了让 `apply()` 抛出的错误
 * 能直接指向「还没决定的那件事」，而不是一句笼统的 "not implemented"。
 */
export const OPEN_QUESTIONS = Object.freeze([
  "TODO-0 判定对象：本骨架判的是「浏览器/宿主能不能推」，还是「用户愿不愿意收」？" +
    "两者混在一个布尔里，会导致「权限已授权但用户在设置页关了」被误判为可用 —— 判据②的关键",
  "TODO-1 降级链边界：`Web Push` → `Notification API`（前台）→ `页面内未读角标`，三级是否都要，" +
    "还是只做最后一级？本仓是本地优先工作台，第三级其实不依赖任何上游",
  "TODO-2 数据来源归属：cc98 的 `unread-count` 与 xxt 的 `notices(unread_only)` 各自要打一次网络，" +
    "本骨架只做判定、不发请求 —— 那么「谁负责轮询」必须先定，否则等于把轮询藏进判定层",
  "TODO-3 副作用红线：`Notification.requestPermission()` 会弹浏览器模态框。" +
    "自动弹出 = 骚扰；必须由用户显式点击触发，且被拒绝后不得再次自动请求",
]);

/**
 * 候选的判定状态形状（**仅为评审示意，不含实现**）。
 *
 * 键 = 判定名，值 = 该判定为真时**才有**的通道。评审时用它对照本仓真实运行环境
 * （桌面 Electron / 浏览器 / 移动端 WebView 三种外壳各扫一遍），再决定第一版覆盖几级。
 */
export const PROPOSED_CAPABILITIES = Object.freeze({
  // 一级：真推送（需要 Service Worker + 推送服务端）
  serviceWorker: "sw",
  pushManager: "push",
  // 二级：前台通知（页面开着才能弹）
  notificationApi: "notification",
  permissionGranted: "notification",
  // 三级：页面内角标（本仓自有，零外部依赖）
  inPageBadge: "badge",
});

/**
 * 骨架不提供任何实现。挂载即失败，避免被误接进真实环境。
 */
export function apply() {
  throw new Error(
    "dsh-radar-notify-capability 是候选骨架（未评审），不可挂载。评审先回答：" +
      OPEN_QUESTIONS.join(" | ")
  );
}

export default { inject, apply };
