import { createHash } from 'node:crypto'
import { rows, fail, iso, resolve, contains, page, publicValue, after, compare } from '../../chat/common.mjs'
import {
  decodeContent,
  parseContent,
  groupNicknames,
  hashes,
  textContent,
  mediaItems,
  protobuf
} from './content.mjs'
import { MediaIndex } from './media-index.mjs'
const SYSTEM = new Set([
  'filehelper',
  'weixin',
  'fmessage',
  'newsapp',
  'medianote',
  'floatbottle',
  'qqmail',
  'qmessage',
  'tmessage',
  'qqsync',
  'weibo',
  'brandsessionholder',
  'notification_messages',
  'notifymessage',
  'service_officialaccounts',
  'appbrandcustomerservicemsg'
])
const tables = (db) => rows(db, "SELECT name FROM sqlite_master WHERE type='table'").map((r) => r.name)
const contact = (r) => ({
  id: r.username,
  name: r.remark || r.nick_name || r.username,
  nickname: r.nick_name || '',
  remark: r.remark || '',
  alias: r.alias || '',
  kind: r.username.endsWith('@chatroom')
    ? 'group'
    : r.username.startsWith('gh_') || Number(r.verify_flag || 0) & 8
      ? 'public'
      : SYSTEM.has(r.username)
        ? 'system'
        : 'personal'
})
const supported = (p) => ['personal', 'group'].includes(p.kind)
export class Query {
  constructor(query) {
    this.query = query
    this.contacts = new Map()
    this.sessions = new Map()
    this.rooms = new Map()
    this.members = new Map()
    this.nicknames = new Map()
    this.found = new Map()
    this.cursor = after(query)
  }
  person(id) {
    return this.contacts.get(id) || contact({ username: id })
  }
  resolve(id) {
    const item = resolve(id, [...this.contacts.values()].filter(supported))
    if (!supported(item)) fail('chat_kind_unsupported', '请选择个人或群聊。')
    return item
  }
  read(database, db) {
    const { op } = this.query
    if (database === 'contact.db') {
      for (const r of rows(
        db,
        'SELECT username,nick_name,remark,alias,verify_flag,description,is_in_chat_room FROM contact'
      ))
        this.contacts.set(r.username, {
          ...contact(r),
          description: r.description || '',
          ...(r.username.endsWith('@chatroom') ? { isInGroup: !!r.is_in_chat_room } : {})
        })
      const available = tables(db)
      if (available.includes('chat_room')) {
        const cols = rows(db, 'PRAGMA table_info("chat_room")').map((r) => r.name)
        for (const r of rows(
          db,
          `SELECT username,owner${cols.includes('ext_buffer') ? ',ext_buffer' : ''} FROM chat_room`
        )) {
          this.rooms.set(r.username, { ownerId: r.owner || null })
          if (r.ext_buffer) this.nicknames.set(r.username, groupNicknames(r.ext_buffer))
        }
      }
      if (['info', 'members'].includes(op)) {
        if (available.includes('chat_room_info_detail'))
          for (const r of rows(
            db,
            'SELECT username_,announcement_,announcement_editor_,announcement_publish_time_ FROM chat_room_info_detail'
          ))
            this.rooms.set(r.username_, {
              ...this.rooms.get(r.username_),
              announcement: r.announcement_ || null,
              announcementEditorId: r.announcement_editor_ || null,
              announcementAt: iso(Number(r.announcement_publish_time_) * 1000)
            })
        if (!available.includes('chatroom_member') || !available.includes('name2id'))
          fail('chat_schema_unsupported', '未找到可识别的群成员结构。')
        for (const r of rows(
          db,
          'SELECT room.username AS room,member.username AS member FROM chatroom_member m JOIN name2id room ON room.rowid=m.room_id JOIN name2id member ON member.rowid=m.member_id'
        )) {
          if (!this.members.has(r.room)) this.members.set(r.room, new Set())
          this.members.get(r.room).add(r.member)
        }
      }
    } else if (database === 'session.db') {
      const titles = new Map(
        tables(db).includes('SessionNoContactInfoTable')
          ? rows(db, 'SELECT username,session_title FROM SessionNoContactInfoTable').map((r) => [
              r.username,
              r.session_title
            ])
          : []
      )
      for (const r of rows(
        db,
        'SELECT username,last_timestamp,unread_count,summary,is_hidden,last_msg_sender FROM SessionTable'
      )) {
        const item = { ...this.person(r.username) }
        if (!this.contacts.has(item.id) && titles.get(item.id)) item.name = titles.get(item.id)
        if (!this.contacts.has(item.id)) this.contacts.set(item.id, item)
        this.sessions.set(item.id, {
          ...item,
          lastAt: iso(Number(r.last_timestamp) * 1000),
          unreadCount: r.unread_count,
          summary: r.summary || '',
          hidden: !!r.is_hidden,
          lastSenderId: r.last_msg_sender || null,
          _time: Number(r.last_timestamp || 0)
        })
      }
    } else if (/^message_\d+\.db$/.test(database)) this.messages(database, db)
    else if (database === 'hardlink.db' || /^media_\d+\.db$/.test(database)) {
      if (!this.media) {
        const target = this.found.get(this.query.message)
        if (!target) fail('message_not_found', '未找到指定消息。')
        this.media = new MediaIndex(this.query.profilePath, target.chatId, mediaItems(target))
      }
      this.media.read(database, db)
    }
  }
  messages(database, db) {
    const query = this.query,
      names = new Map(
        rows(db, 'SELECT rowid,user_name FROM Name2Id')
          .filter((r) => r.user_name)
          .map((r) => [String(r.rowid), r.user_name])
      )
    for (const name of names.values())
      if (!this.contacts.has(name)) this.contacts.set(name, this.person(name))
    if (query.chat && !this.selected) this.selected = this.resolve(query.chat)
    const sender = query.sender ? this.resolve(query.sender).id : null,
      self = [...names.values()].find((n) => query.profile === n || query.profile?.startsWith(n + '_')),
      available = tables(db)
    for (const chatId of new Set(names.values())) {
      if (
        (this.selected && chatId !== this.selected.id) ||
        !supported(this.person(chatId)) ||
        (query.kind && this.person(chatId).kind !== query.kind)
      )
        continue
      const table = 'Msg_' + createHash('md5').update(chatId).digest('hex')
      if (!available.includes(table)) continue
      const clauses = [],
        params = []
      if (query.message) {
        const identity = query.message.slice(chatId.length + 1)
        if (identity.includes(':')) {
          const [shard, id] = identity.split(':')
          if (shard !== database) continue
          clauses.push('local_id=?')
          params.push(Number(id))
        } else {
          clauses.push('server_id=?')
          params.push(identity)
        }
      }
      for (const [field, sign] of [
        ['since', '>='],
        ['until', '<']
      ])
        if (query[field] !== undefined) {
          clauses.push('create_time ' + sign + ' ?')
          params.push(query[field] / 1000)
        }
      if (sender) {
        const ids = [...names].filter(([, n]) => n === sender).map(([id]) => id)
        if (!ids.length) continue
        clauses.push('real_sender_id IN (' + ids.map(() => '?').join(',') + ')')
        params.push(...ids)
      }
      const statement = db.prepare(
        `SELECT * FROM "${table}"${clauses.length ? ' WHERE ' + clauses.join(' AND ') : ''} ORDER BY create_time DESC,sort_seq DESC,local_id DESC`
      )
      statement.setReadBigInts(true)
      for (const row of statement.iterate(...params)) {
        let senderId = names.get(String(row.real_sender_id)),
          content = decodeContent(row.message_content) || decodeContent(row.compress_content)
        if (chatId.endsWith('@chatroom') && content.includes(':\n')) {
          const i = content.indexOf(':\n'),
            prefix = content.slice(0, i)
          if ([...names.values()].includes(prefix)) {
            senderId = prefix
            content = content.slice(i + 2)
          }
        }
        const serverId = String(row.server_id || 0),
          identity = serverId !== '0' ? serverId : database + ':' + row.local_id,
          key = [-Number(row.create_time), -Number(row.sort_seq || 0), chatId, identity]
        if (this.cursor) {
          if (
            this.cursor.length !== 4 ||
            !this.cursor.slice(0, 2).every(Number.isFinite) ||
            !this.cursor.slice(2).every((v) => typeof v === 'string')
          )
            fail('invalid_cursor', '分页游标格式无效。')
          if (compare(key, this.cursor) <= 0) continue
        }
        const nickname = this.nicknames.get(chatId)?.get(senderId),
          item = {
            id: chatId + ':' + identity,
            chatId,
            chatName: this.person(chatId).name,
            localId: Number(row.local_id),
            serverId,
            database,
            sender: senderId
              ? {
                  id: senderId,
                  name: nickname || this.person(senderId).name,
                  groupNickname: nickname || null
                }
              : null,
            isSelf: senderId && self ? senderId === self : null,
            sentAt: iso(Number(row.create_time) * 1000),
            rawType: String(row.local_type || 0),
            ...parseContent(row.local_type, content),
            _key: key
          }
        if (
          (query.type && item.type !== query.type) ||
          (query.query && !contains(query.query, textContent(item))) ||
          (query.message && item.id !== query.message)
        )
          continue
        if (item._media) item._media[0].hashes.push(...hashes(row.packed_info_data))
        if (item.type === 'forward') {
          const record = new Map(protobuf(row.packed_info_data)).get(9)
          if (Buffer.isBuffer(record)) {
            const id = new Map(protobuf(record)).get(1)
            if (Buffer.isBuffer(id)) item._record = id.toString('ascii')
          }
        }
        if (!this.found.has(item.id) || compare(key, this.found.get(item.id)._key) < 0)
          this.found.set(item.id, item)
        if (this.found.size > (query.limit || 50) + 1) {
          const keep = [...this.found.values()]
            .sort((a, b) => compare(a._key, b._key))
            .slice(0, (query.limit || 50) + 1)
          this.found = new Map(keep.map((m) => [m.id, m]))
          // SQL orders ties by local id, while the public cursor uses the stable message id.
          // Consume the entire time/sequence tie before stopping at the page boundary.
          if (compare(key.slice(0, 2), keep.at(-1)._key.slice(0, 2)) > 0) break
        }
      }
    }
  }
  result() {
    const query = this.query,
      { op } = query
    if (!this.contacts.size) fail('chat_schema_unsupported', '未读到可识别的联系人结构。')
    if (['list', 'contacts'].includes(op)) {
      const values = [...(op === 'list' ? this.sessions : this.contacts).values()].filter(
        (p) =>
          supported(p) &&
          (!query.kind || p.kind === query.kind) &&
          contains(query.query || '', p.id, p.name, p.nickname, p.remark, p.alias)
      )
      return page(
        query,
        values,
        op === 'list' ? (p) => [-p._time, p.id] : (p) => [p.name.toLowerCase(), p.id],
        op === 'list' ? 'chats' : 'contacts'
      )
    }
    if (['info', 'members'].includes(op)) {
      const selected = this.resolve(query.chat),
        detail = {
          ...(this.sessions.get(selected.id) || selected),
          ...this.rooms.get(selected.id),
          memberCount: this.members.get(selected.id)?.size || 0
        }
      if (op === 'info') return { ok: true, chat: publicValue(detail), coverage: 'local_synced' }
      if (selected.kind !== 'group') fail('chat_not_group', '成员查询需要群聊。')
      const values = [...(this.members.get(selected.id) || [])]
        .map((id) => {
          const nickname = this.nicknames.get(selected.id)?.get(id)
          return {
            ...this.person(id),
            isOwner: id === detail.ownerId,
            groupNickname: nickname || null,
            name: nickname || this.person(id).name
          }
        })
        .filter((p) => contains(query.query || '', p.id, p.name, p.nickname, p.remark, p.alias))
      return {
        ...page(query, values, (p) => [p.name.toLowerCase(), p.id], 'members'),
        chat: publicValue(detail),
        roleCoverage: 'owner_only',
        membershipCoverage: 'local_cached'
      }
    }
    if (op === 'download') {
      const target = this.found.get(query.message)
      if (!target) fail('message_not_found', '未找到指定消息。')
      const resources = (
        this.media || new MediaIndex(query.profilePath, target.chatId, mediaItems(target))
      ).result()
      if (!resources.length) fail('message_has_no_media', '这条消息没有可提取的媒体。')
      return { ok: true, messageId: query.message, profilePath: query.profilePath, resources }
    }
    return {
      ...page(query, this.found.values(), (m) => m._key, 'messages'),
      ...(this.selected ? { chat: publicValue(this.selected) } : {}),
      order: 'newest_first',
      searchScope: 'text_and_nested_content'
    }
  }
}
