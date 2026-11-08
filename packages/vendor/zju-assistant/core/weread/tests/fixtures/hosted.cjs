// A host application's main process: its own Electron serves the Skill's browser to every command that connects to its pipe.
const { app, BrowserWindow, ipcMain, session } = require('electron')
const fs = require('node:fs'), net = require('node:net'), path = require('node:path')
const { createBrowserService } = require('../../lib/browser/service.cjs')
const [directory, endpoint] = process.argv.slice(2)
app.setPath('userData', directory)
app.on('window-all-closed', () => {})
app.whenReady().then(async () => {
  const service = await createBrowserService({ BrowserWindow, ipcMain, session: session.fromPartition('persist:hosted'),
    // The host decides whether the feature is switched on; the test flips it by creating a file.
    guard: () => { if (fs.existsSync(path.join(directory, 'off'))) throw Object.assign(new Error('功能已关闭。'), { code: 'plugin_disabled' }) } })
  net.createServer(socket => service.serve(socket)).listen(endpoint, () => fs.writeFileSync(path.join(directory, 'ready'), ''))
}).catch(() => app.exit(1))
