// 预加载：把主进程的启动状态递给加载页。
//
// ⚠️ 必须是 CommonJS（`.cjs`）：窗口开了 `sandbox: true`，沙箱下的 preload 不能用 ESM。
// 只暴露启动状态、重试和用户主动选择位置的 PDF 保存，不提供任意文件读写。
const { contextBridge, ipcRenderer } = require('electron');
// PDF 保存：`kind` 只允许 'lecture' / 'quiz'，由主进程映射到对话框标题与「文档还在不在」
// 的判据选择器。这里不做白名单校验 —— 主进程不认识的值会回落成讲义，而多一处校验
// 就多一处需要同步的地方。
contextBridge.exposeInMainWorld('zhiyunPdf', {
  save: (filename, kind) => ipcRenderer.invoke('zhiyun:pdf-save', filename, kind),
});
/** 旧键：已发布的页面仍可能调用它，保留到下一次桌面壳与前端一起更新为止。 */
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
