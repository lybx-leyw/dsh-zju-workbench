import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { rows } from '../../chat/common.mjs'
export class MediaIndex {
  constructor(profile, chatId, resources) {
    this.profile = path.resolve(profile)
    this.chatId = chatId
    this.resources = resources.map((item) => ({ ...item, candidates: [] }))
    for (const item of this.resources) {
      if (!/^[a-f0-9]{16}$/.test(item.record || '') || !/^\d+(?:_\d+)*$/.test(item.index || '')) continue
      const category = { image: 'Img', video: 'V', file: 'F', voice: 'Voice' }[item.kind]
      if (!category) continue
      const folder = path.join(this.profile, 'msg/attach', createHash('md5').update(chatId).digest('hex'))
      for (const entry of fs.existsSync(folder) ? fs.readdirSync(folder, { withFileTypes: true }) : []) {
        if (!entry.isDirectory()) continue
        const rec = path.join(folder, entry.name, 'Rec', item.record, category)
        const candidates =
          item.kind === 'file'
            ? [path.join(rec, item.index, path.basename(item.name || ''))]
            : ['', '_h', '_t', '.mp4', '_t.jpg'].map((s) => path.join(rec, item.index + s))
        item.candidates.push(...candidates.filter((p) => this.valid(p)))
      }
    }
  }
  valid(file) {
    try {
      const resolved = fs.realpathSync(file),
        relative = path.relative(this.profile, resolved)
      return (
        relative &&
        !relative.startsWith('..' + path.sep) &&
        relative !== '..' &&
        !path.isAbsolute(relative) &&
        fs.statSync(file).isFile()
      )
    } catch {
      return false
    }
  }
  read(database, db) {
    if (database.startsWith('media_'))
      for (const item of this.resources) {
        if (item.kind !== 'voice' || !item.serverId) continue
        const row = rows(
          db,
          'SELECT voice_data FROM VoiceInfo v JOIN Name2Id n ON n.rowid=v.chat_name_id WHERE n.user_name=? AND v.svr_id=? AND length(voice_data)>0 LIMIT 1',
          this.chatId,
          item.serverId
        )[0]
        if (row) item.data = Buffer.from(row.voice_data).toString('base64')
      }
    else if (database === 'hardlink.db') {
      const dirs = new Map(
        rows(db, 'SELECT rowid,username FROM dir2id').map((r) => [String(r.rowid), r.username])
      )
      for (const item of this.resources) {
        if (!['image', 'video', 'file'].includes(item.kind)) continue
        for (const digest of new Set(item.hashes || []))
          for (const row of rows(
            db,
            `SELECT file_name,dir1,dir2 FROM ${item.kind}_hardlink_info_v4 WHERE md5=?`,
            digest
          )) {
            let folder = path.join(
              this.profile,
              'msg',
              item.kind === 'image' ? 'attach' : item.kind,
              dirs.get(String(row.dir1)) || ''
            )
            if (item.kind === 'image') folder = path.join(folder, dirs.get(String(row.dir2)) || '', 'Img')
            const candidate = path.resolve(folder, row.file_name)
            if (this.valid(candidate)) item.candidates.push(candidate)
          }
      }
    }
  }
  result() {
    return this.resources.map((item) => {
      const thumb = (p) =>
        path.parse(p).name.endsWith('_t') ||
        (item.kind === 'video' && ['.jpg', '.png'].includes(path.extname(p).toLowerCase()))
      const paths = [...new Set(item.candidates)].sort(
        (a, b) =>
          Number(thumb(a)) - Number(thumb(b)) ||
          Number(!path.parse(a).name.endsWith('_h')) - Number(!path.parse(b).name.endsWith('_h')) ||
          a.localeCompare(b)
      )
      const common = Object.fromEntries(
        ['kind', 'name', 'size', 'durationMs'].filter((k) => item[k] !== undefined).map((k) => [k, item[k]])
      )
      return item.data
        ? { ...common, data: item.data, format: 'silk', variant: 'original' }
        : paths.length
          ? { ...common, path: paths[0], variant: thumb(paths[0]) ? 'thumbnail' : 'original' }
          : { ...common, status: 'media_not_local' }
    })
  }
}
