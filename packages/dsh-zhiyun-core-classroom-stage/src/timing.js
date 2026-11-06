/**
 * 朗读时长估算：从独立包转发。
 *
 * 这段逻辑原本在 `stage` 里，但 `stage` 是**客户端包**（有 client.jsx / lib/client.js，
 * 在 CLIENT_PACKAGES 里）。`export` 与 `agent` 是服务端包，依赖它会连带内联
 * 整条链（timeline → ledger → geometry），越过「客户端包不该被内联」的边界。
 *
 * 所以纯函数下沉到 `dsh-zhiyun-core-classroom-timing`（零依赖、无 React、无 IO）。
 * 这里保留转发，是为了 `stage/timing` 这个子路径的老引用不断。
 */
export { estimateSpeechDurationMs } from 'dsh-zhiyun-core-classroom-timing';
