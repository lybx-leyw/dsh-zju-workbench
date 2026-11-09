import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'

/** 「文档」文件夹的位置。Windows 上问系统要（可能被挪到别的盘或 OneDrive 里），别的系统用主目录下的 Documents。 */
function documentsDirectory() {
  if (process.platform !== 'win32') return Promise.resolve(path.join(os.homedir(), 'Documents'))
  return new Promise((resolve) => {
    const command = '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); [Environment]::GetFolderPath([Environment+SpecialFolder]::MyDocuments)'
    execFile('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, timeout: 10_000 }, (error, stdout) => {
      const found = error ? '' : stdout.trim()
      resolve(found && path.isAbsolute(found) ? found : path.join(os.homedir(), 'Documents'))
    })
  })
}

/**
 * 课件、转写和讲解放的地方：<文档>\CampusAgent，和桌面版是同一个位置（课程\<课名>、讲解\）。照 ui/profile/chats.mjs 搬过来，
 * 只留了找位置的那一半：插件版不给每个对话建文件夹。
 * CAMPUS_CHATS_DIR 可以把整个位置换掉（界面测试时用，免得往真实的「文档」里写）。
 */
export class Documents {
  constructor(root = process.env.CAMPUS_CHATS_DIR) {
    this.located = root ? Promise.resolve(path.resolve(root)) : documentsDirectory().then(documents => path.join(documents, 'CampusAgent'))
  }

  root() { return this.located }
}
