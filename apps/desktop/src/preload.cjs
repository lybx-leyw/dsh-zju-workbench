// 预加载：把主进程的启动状态递给加载页。
//
// ⚠️ 必须是 CommonJS（`.cjs`）：窗口开了 `sandbox: true`，沙箱下的 preload 不能用 ESM。
// 这里只暴露**读状态**与**重试**两件事 —— 壳是快捷入口，不给页面任何额外能力。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('launcher', {
  /** 拿一份当前状态（页面可能在状态推送之后才加载完）。 */
  snapshot: () => ipcRenderer.invoke('launcher:snapshot'),
  /** 订阅后续状态。返回取消订阅函数。 */
  onState: (listener) => {
    const handler = (_event, state) => listener(state);
    ipcRenderer.on('launcher:state', handler);
    return () => ipcRenderer.removeListener('launcher:state', handler);
  },
  retry: () => ipcRenderer.send('launcher:retry'),
});
