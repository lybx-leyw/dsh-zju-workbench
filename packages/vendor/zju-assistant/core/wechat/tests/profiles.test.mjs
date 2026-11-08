import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('../scripts/wechat.mjs', import.meta.url))

/** 造一个只有 contact.db 占位的账号文件夹；这里只找文件夹，不解密。 */
function account(folder) {
  fs.mkdirSync(path.join(folder, 'db_storage', 'contact'), { recursive: true })
  fs.writeFileSync(path.join(folder, 'db_storage', 'contact', 'contact.db'), 'x')
  return folder
}

/** 在假的 APPDATA 下跑 profiles；env 里的 WECHAT_DATA_DIR 换成给的值。 */
function profiles(appData, args = [], dataDir) {
  const env = { ...process.env, APPDATA: appData }
  delete env.WECHAT_DATA_DIR
  if (dataDir) env.WECHAT_DATA_DIR = dataDir
  const result = spawnSync(process.execPath, [script, 'profiles', ...args], { encoding: 'utf8', env, timeout: 60_000 })
  return JSON.parse(result.stdout)
}

const ids = (result) => result.profiles?.map((p) => p.id)

test(
  'the storage place Weixin records in config is followed, and a chosen folder is accepted at any level',
  { skip: process.platform !== 'win32' },
  (t) => {
    // 临时目录可能是 ADMINI~1 这样的短路径，读取器报的是完整路径。
    const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-位置 ')))
    t.after(() => fs.rmSync(root, { recursive: true, force: true }))
    const appData = path.join(root, 'Roaming'),
      config = path.join(appData, 'Tencent', 'xwechat', 'config')
    fs.mkdirSync(config, { recursive: true })
    // 搬走以前留在默认位置的旧账号：config 里记着新位置时不该读它。
    account(path.join(appData, 'Tencent', 'xwechat', 'xwechat_files', 'wxid_old_0000'))
    const moved = path.join(root, 'D盘', '微信')
    const current = account(path.join(moved, 'xwechat_files', 'wxid_new_1a2b'))
    fs.mkdirSync(path.join(moved, 'xwechat_files', 'all_users'))
    fs.writeFileSync(path.join(config, 'aaaa.ini'), moved)
    assert.deepEqual(profiles(appData).profiles, [{ id: 'wxid_new_1a2b', path: current }])

    fs.writeFileSync(path.join(config, 'aaaa.ini'), 'Appdata:Tencent\\xwechat')
    assert.deepEqual(ids(profiles(appData)), ['wxid_old_0000'])

    // 选存储位置、xwechat_files、账号文件夹或它的 db_storage 都行；不是 wxid_ 开头的账号文件夹也认。
    const custom = account(path.join(moved, 'xwechat_files', 'zhangsan_9f9f'))
    for (const folder of [moved, path.join(moved, 'xwechat_files')])
      assert.deepEqual(ids(profiles(appData, ['--data-dir', folder])), ['wxid_new_1a2b', 'zhangsan_9f9f'])
    for (const folder of [custom, path.join(custom, 'db_storage')])
      assert.deepEqual(profiles(appData, ['--data-dir', folder]).profiles, [{ id: 'zhangsan_9f9f', path: custom }])
    assert.deepEqual(ids(profiles(appData, [], current)), ['wxid_new_1a2b'], 'the plugin passes its choice in WECHAT_DATA_DIR')
    assert.deepEqual(ids(profiles(appData, ['--data-dir', custom], current)), ['zhangsan_9f9f'], '--data-dir wins')

    const empty = path.join(root, '空的')
    fs.mkdirSync(empty)
    for (const folder of [empty, path.join(root, 'missing')]) {
      const result = profiles(appData, ['--data-dir', folder])
      assert.equal(result.ok, false)
      assert.equal(result.status, 'wechat_folder_unrecognized')
    }
  }
)
