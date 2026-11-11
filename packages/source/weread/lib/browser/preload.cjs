const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('wereadVerification', {
  complete: result => ipcRenderer.invoke('weread:captcha-result', {
    taskId:result?.taskId, ret:result?.ret, ticket:result?.ticket, randstr:result?.randstr,
  }),
})
