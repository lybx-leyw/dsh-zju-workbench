// 预加载：把主进程的启动状态递给加载页。
//
// ⚠️ 必须是 CommonJS（`.cjs`）：窗口开了 `sandbox: true`，沙箱下的 preload 不能用 ESM。
// 只暴露启动状态、重试和用户主动选择位置的 PDF 保存，不提供任意文件读写。
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('lecturePdf', {save:filename=>ipcRenderer.invoke('lecture:pdf-save',filename)});

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
