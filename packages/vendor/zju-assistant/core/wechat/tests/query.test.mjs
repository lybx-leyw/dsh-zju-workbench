import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { zstdCompressSync } from 'node:zlib'
import { Query } from '../lib/query.mjs'
import { parseContent, textContent, groupNicknames } from '../lib/content.mjs'
function fixture(t) {
  const contacts = new DatabaseSync(':memory:'),
    session = new DatabaseSync(':memory:'),
    messages = new DatabaseSync(':memory:')
  t.after(() => {
    contacts.close()
    session.close()
    messages.close()
  })
  contacts.exec(`CREATE TABLE contact(username TEXT,nick_name TEXT,remark TEXT,alias TEXT,verify_flag INTEGER,description TEXT,is_in_chat_room INTEGER);
  INSERT INTO contact VALUES('g@chatroom','年级群','','',0,'',1),('u','同学','老师','',0,'',0),('gh_news','公众号','','',8,'',0),('self','我','','',0,'',0);
  CREATE TABLE chat_room(username TEXT,owner TEXT,ext_buffer BLOB); INSERT INTO chat_room VALUES('g@chatroom','u',NULL);
  CREATE TABLE name2id(username TEXT); INSERT INTO name2id VALUES('g@chatroom'),('u'); CREATE TABLE chatroom_member(room_id INTEGER,member_id INTEGER); INSERT INTO chatroom_member VALUES(1,2);`)
  session.exec(
    "CREATE TABLE SessionTable(username TEXT,last_timestamp INTEGER,unread_count INTEGER,summary TEXT,is_hidden INTEGER,last_msg_sender TEXT); INSERT INTO SessionTable VALUES('g@chatroom',1792116000,1,'摘要',0,'u')"
  )
  messages.exec(
    "CREATE TABLE Name2Id(user_name TEXT); INSERT INTO Name2Id VALUES('g@chatroom'),('u'),('self')"
  )
  const table = 'Msg_' + createHash('md5').update('g@chatroom').digest('hex')
  messages.exec(
    `CREATE TABLE ${table}(local_id INTEGER,server_id INTEGER,local_type INTEGER,sort_seq INTEGER,real_sender_id INTEGER,create_time INTEGER,message_content BLOB,packed_info_data BLOB)`
  )
  messages
    .prepare(`INSERT INTO ${table} VALUES(?,?,?,?,?,?,?,NULL)`)
    .run(1, 9007199254740993n, 1, 1, 2, 1792116000, zstdCompressSync(Buffer.from('u:\n通知原文\n  保留缩进')))
  messages.prepare(`INSERT INTO ${table} VALUES(?,?,?,?,?,?,?,NULL)`).run(2, 2, 1, 2, 2, 1792116000, '第二条')
  const run = (input) => {
    const q = new Query({ profile: 'self_abc', limit: 50, ...input })
    q.read('contact.db', contacts)
    q.read('session.db', session)
    if (['read', 'search'].includes(input.op)) q.read('message_0.db', messages)
    return q.result()
  }
  return { run, messages, table }
}
test('WeChat readers keep exact ids, original whitespace and deterministic same-second pagination', (t) => {
  const { run } = fixture(t),
    first = run({ op: 'read', chat: 'g@chatroom', limit: 1 })
  assert.equal(first.messages[0].text, '第二条')
  assert.equal(first.hasMore, true)
  const second = run({ op: 'read', chat: 'g@chatroom', limit: 1, cursor: first.nextCursor })
  assert.equal(second.messages[0].serverId, '9007199254740993')
  assert.equal(second.messages[0].text, '通知原文\n  保留缩进')
  assert.equal(second.messages[0].sender.name, '老师')
  assert.throws(
    () => run({ op: 'read', chat: 'u', limit: 1, cursor: first.nextCursor }),
    (e) => e.status === 'invalid_cursor'
  )
})
test('public accounts are excluded from chats; group owner and local member coverage are explicit', (t) => {
  const { run } = fixture(t)
  assert.equal(run({ op: 'list' }).chats.length, 1)
  assert.ok(run({ op: 'contacts' }).contacts.every((p) => p.kind !== 'public'))
  const members = run({ op: 'members', chat: 'g@chatroom' })
  assert.equal(members.members[0].isOwner, true)
  assert.equal(members.roleCoverage, 'owner_only')
})
test('dates and literal filters apply inside the selected chat', (t) => {
  const { run } = fixture(t)
  assert.equal(
    run({ op: 'read', chat: 'g@chatroom', since: 1792116000000, until: 1792116001000 }).messages.length,
    2
  )
  assert.equal(run({ op: 'read', chat: 'g@chatroom', until: 1792116000000 }).messages.length, 0)
  assert.equal(run({ op: 'search', chat: 'g@chatroom', query: "' OR 1=1 --" }).messages.length, 0)
})
test('quotes and forwarded XML preserve nested visible text', () => {
  const result = parseContent(
    49,
    '<msg><appmsg><type>57</type><title>请查收</title><refermsg><type>1</type><content>原来的通知</content><displayname>辅导员</displayname></refermsg></appmsg></msg>'
  )
  assert.equal(result.type, 'quote')
  assert.equal(result.reference.text, '原来的通知')
  assert.match(textContent(result), /原来的通知/)
  assert.throws(() => groupNicknames(Buffer.from([10, 255])))
  const link = parseContent(
    49,
    '<msg><appmsg><type>5</type><title>报名</title><url>https://example.org/?a=1&amp;b=2</url></appmsg></msg>'
  )
  assert.equal(link.url, 'https://example.org/?a=1&b=2')
})

test('page boundaries consume all equal time/sequence rows even when local ids sort differently', t => {
  const {run, messages, table} = fixture(t)
  messages.exec(`DELETE FROM ${table}`)
  const insert = messages.prepare(`INSERT INTO ${table} VALUES(?,?,?,?,?,?,?,NULL)`)
  // The SQL local-id order sees 2, 3, 9, 1. A cursor sorted by server ID must still start at 1.
  for (const [local, server] of [[4,2],[3,3],[2,9],[1,1]]) insert.run(local,server,1,1,2,1792116000,'通知')
  const query = {op:'read',chat:'g@chatroom',limit:1}, ids=[]
  for (;;) {
    const result=run(query); ids.push(...result.messages.map(message=>message.serverId))
    if (!result.hasMore) break
    query.cursor=result.nextCursor
  }
  assert.deepEqual(ids,['1','2','3','9'])
})
