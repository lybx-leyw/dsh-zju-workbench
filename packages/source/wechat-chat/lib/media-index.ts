/**
 * Find the local files of one message's media in WeChat's own indexes: voice clips in media_N.db, image, video and
 * file paths in hardlink.db, and the cached attachments of merged forwards under msg/attach/<chat>/<month>/Rec.
 * A port of the former Python chat_media.py. Nothing is written; only paths inside the profile are returned.
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { MediaRef } from './content.ts'
import { compareText, small, truthy, type Value } from './values.ts'

export interface Resource { kind: string; name?: unknown; size?: unknown; durationMs?: unknown; path?: string; data?: string; format?: string; variant?: string; status?: string }
type Entry = MediaRef & { candidates: string[]; data?: string }

const CATEGORIES: Record<string, string> = { image: 'Img', video: 'V', file: 'F', voice: 'Voice' }

/** The real path, as Python's Path.resolve() gives it; a path that does not exist is only made absolute. */
function resolve(target: string): string {
  const absolute = path.resolve(target)
  try { return fs.realpathSync.native(absolute) } catch { return absolute }
}

const isFile = (file: string) => { try { return fs.statSync(file).isFile() } catch { return false } }
const exists = (file: string) => { try { fs.statSync(file); return true } catch { return false } }

/** Path.stem and Path.suffix of a Windows path. */
function nameParts(file: string): { stem: string; suffix: string } {
  const name = path.win32.basename(file)
  const suffix = path.win32.extname(name)
  return { stem: suffix ? name.slice(0, -suffix.length) : name, suffix }
}

/** Whether `child` is `parent` or inside it (Windows paths compare without case). */
function within(child: string, parent: string): boolean {
  const relative = path.win32.relative(parent, child)
  return relative === '' || (!relative.startsWith('..') && !path.win32.isAbsolute(relative))
}

export class MediaIndex {
  private readonly profile: string
  private readonly chatId: string
  private readonly resources: Entry[]

  constructor(profile: string, chatId: string, resources: MediaRef[]) {
    this.profile = resolve(profile)
    this.chatId = chatId
    this.resources = resources.map(item => ({ ...item, candidates: [] }))
    // Attachments of merged forwards live under their record id, numbered by their position in the forward.
    for (const item of this.resources) {
      const record = typeof item.record === 'string' ? item.record : ''
      const index = typeof item.index === 'string' ? item.index : ''
      if (!/^[a-f0-9]{16}$/.test(record) || !/^\p{Nd}+(?:_\p{Nd}+)*$/u.test(index)) continue
      const category = CATEGORIES[item.kind]
      if (!category) continue
      const folder = path.join(this.profile, 'msg', 'attach', createHash('md5').update(chatId, 'utf8').digest('hex'))
      let months: string[]
      try { months = fs.readdirSync(folder) } catch { continue }
      for (const month of months) {
        const rec = path.join(folder, month, 'Rec', record, category)
        if (!exists(rec)) continue
        const candidates = item.kind === 'file'
          ? [path.join(rec, index, path.win32.basename(String(item.name)))]
          : ['', '_h', '_t', '.mp4', '_t.jpg'].map(suffix => path.join(rec, index + suffix))
        for (const source of candidates) if (isFile(source)) item.candidates.push(source)
      }
    }
  }

  /** Add what one media database knows about the requested resources. */
  read(database: string, db: DatabaseSync): void {
    if (database.startsWith('media_')) {
      for (const item of this.resources) {
        if (item.kind !== 'voice' || !truthy(item.serverId)) continue
        // Prepared only when needed: a shard without VoiceInfo fails a voice download, nothing else.
        const statement = db.prepare('SELECT voice_data FROM VoiceInfo v JOIN Name2Id n ON n.rowid=v.chat_name_id WHERE n.user_name=? AND v.svr_id=? AND length(voice_data)>0 LIMIT 1')
        const row = statement.get(this.chatId, String(item.serverId)) as { voice_data: Value } | undefined
        if (row) {
          if (!(row.voice_data instanceof Uint8Array)) throw new TypeError('Voice data is not bytes')
          item.data = Buffer.from(row.voice_data).toString('base64')
        }
      }
    } else if (database === 'hardlink.db') {
      const directories = db.prepare('SELECT rowid, username FROM dir2id')
      directories.setReadBigInts(true)
      const dirs = new Map<number | bigint, Value>()
      for (const row of directories.all() as { rowid: bigint; username: Value }[]) dirs.set(small(row.rowid), row.username)
      for (const item of this.resources) {
        const kind = item.kind
        const digests = new Set(item.hashes)
        if ((kind !== 'image' && kind !== 'video' && kind !== 'file') || !digests.size) continue
        const statement = db.prepare(`SELECT file_name,dir1,dir2 FROM ${kind}_hardlink_info_v4 WHERE md5=?`)
        statement.setReadBigInts(true)
        for (const digest of digests) {
          for (const row of statement.all(digest) as { file_name: Value; dir1: Value; dir2: Value }[]) {
            const first = directory(dirs, row.dir1), second = directory(dirs, row.dir2)
            let folder = path.join(this.profile, 'msg', kind === 'image' ? 'attach' : kind, first)
            if (kind === 'image') folder = path.join(folder, second, 'Img')
            if (typeof row.file_name !== 'string') throw new TypeError('File name is not text')
            const file = resolve(path.resolve(folder, row.file_name))
            if (within(file, this.profile) && isFile(file)) item.candidates.push(file)
          }
        }
      }
    }
  }

  /** One entry per resource: voice data, the best local file (originals before thumbnails, "_h" before others), or a status. */
  result(): Resource[] {
    return this.resources.map(item => {
      const thumbnail = (file: string) => {
        const { stem, suffix } = nameParts(file)
        return stem.endsWith('_t') || (item.kind === 'video' && ['.jpg', '.png'].includes(suffix.toLowerCase()))
      }
      const rank = (file: string): [number, number] => [thumbnail(file) ? 1 : 0, nameParts(file).stem.endsWith('_h') ? 0 : 1]
      const paths = [...new Set(item.candidates)].sort((a, b) => {
        const [x, y] = [rank(a), rank(b)]
        return x[0] - y[0] || x[1] - y[1] || compareText(a, b)
      })
      const common: Resource = { kind: item.kind }
      for (const key of ['name', 'size', 'durationMs'] as const) if (Object.hasOwn(item, key)) common[key] = item[key]
      if (truthy(item.data)) return { ...common, data: item.data!, format: 'silk', variant: 'original' }
      if (paths.length) return { ...common, path: paths[0]!, variant: thumbnail(paths[0]!) ? 'thumbnail' : 'original' }
      return { ...common, status: 'media_not_local' }
    })
  }
}

/** A dir2id name by rowid; a missing id is "" as before, and a name that is not text fails the query. */
function directory(dirs: Map<number | bigint, Value>, id: Value): string {
  if (id === null) return ''
  const value = dirs.get(typeof id === 'bigint' ? small(id) : id as number)
  if (value === undefined) return ''
  if (typeof value !== 'string') throw new TypeError('Directory name is not text')
  return value
}
