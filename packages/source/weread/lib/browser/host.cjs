// Skill 自带 Electron 的入口：由 runtime.ts 启动，通过私有管道收发一行一条的 JSON。浏览器能力本身在 service.cjs。
const { app, BrowserWindow, session, ipcMain } = require('electron')
const net = require('node:net')
const { createBrowserService } = require('./service.cjs')
app.setPath('userData', process.argv[3])
const socket = net.connect(process.argv[2])
const fatal = (code,message) => { socket.write(JSON.stringify({event:'fatal',code,message})+'\n'); app.quit() }

app.whenReady().then(async()=>{
  if(!app.requestSingleInstanceLock())return fatal('browser_busy','另一个 weread 命令正在使用浏览器，请等它结束。')
  const service=await createBrowserService({BrowserWindow,ipcMain,session:session.fromPartition('persist:weread')})
  // 续期后的登录状态要落盘，下个命令才能接着用。
  service.serve(socket,{close:async()=>{try{await service.flush()}finally{app.quit()}}})
  socket.write(JSON.stringify({event:'ready'})+'\n')
}).catch(()=>fatal('browser_start_failed','Electron 初始化失败。'))
socket.on('close',()=>app.quit())
app.on('window-all-closed',()=>{})
