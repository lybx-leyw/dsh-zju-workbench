/** 建隧道 / 上游握手的默认超时。 */
export const DEFAULT_TIMEOUT_MS = 60000;

/**
 * 本插件在宿主里注册的设置路由。
 *
 * 用 `/_dsh/` 前缀与宿主自带设置路由保持一致（宿主的 `net-proxy` 类插件
 * 也挂在这个前缀下），但路径是本包自己的，避免和别的插件撞车 ——
 * 宿主 `webServer.register` 遇到重复路径会抛错，那会连累整个前端。
 */
export const ROUTE_PATH = '/_dsh/zhiyun-net-proxy';
