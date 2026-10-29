/**
 * dsh-radar-cc98-md-render · 入口占位
 *
 * ⚠️ 候选骨架：**未评审、未接入 profile、不可直接使用**。
 *
 * 本文件只打一行日志，不注册槽位 / RPC / 路由 / 设置分节。
 * `apply()` 不读网络、不读配置、不碰任何凭证。
 *
 * 评审通过后，真正的挂载要在这里做三件事（除此之外不做别的）：
 *
 *   1. 在「笔记」页**已有的** Markdown 通路上注册一个**转换器**：
 *      `ubb → markdown`，输入是 `source-cc98` 已经拿到的 UBB 正文，
 *      输出交给宿主 `MarkdownText` 渲染 —— **不换渲染器**（笔记页
 *      `src/client.jsx:23-28` 说明了为什么必须复用宿主组件）。
 *
 *   2. 复用 `dsh-zhiyun-source-cc98` 的 `Cc98Client` / `TokenStore` 取正文，
 *      **不要**另建一套登录与请求栈（那是重复且无增益）。
 *
 *   3. 与 `dsh-radar-cc98-ubb-bridge`（Markdown → UBB，**写**方向）配对：
 *      两者共享同一张标记表，读写的方括号规则必须同源，否则会出现
 *      「写出去再读回来对不上」—— 这正是 ubb-bridge 评审时已记录的隐患。
 *
 * 见 `src/upstream.js`：那里写清了要提取哪几个文件的**语义**、
 * 以及为什么不能锁版（上游是 VS Code 扩展，`vscode` 是虚拟模块）。
 */

export const name = 'dsh-radar-cc98-md-render';

/** 骨架阶段不抛错、不装作已挂载，只如实报状态。 */
export async function apply(ctx) {
  void ctx;
  console.info(`[${name}] candidate skeleton — 未挂载。见 README 的「评审要点」。`);
}

export default { name, apply };
