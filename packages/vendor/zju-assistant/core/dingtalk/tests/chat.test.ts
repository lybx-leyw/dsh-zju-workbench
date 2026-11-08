import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test, { afterEach, beforeEach } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { ChatReader, dateMs } from '../lib/chat.ts'
import { parseContent } from '../lib/content.ts'
import { SkillError } from '../lib/errors.ts'
import { parseArgs, validate } from '../lib/cli.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))

/** The error a call throws (assert.throws does not return it). */
function caught<T extends Error>(fn: () => unknown): T {
  try { fn() } catch (error) { return error as T }
  throw new assert.AssertionError({ message: 'expected a throw' })
}

/** The reader never searches recalled, shielded or undecrypted payloads, so synthetic text is safe to assert on. */
function fixture(): { db: DatabaseSync; members: DatabaseSync } {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE tbconversation(cid TEXT,type INTEGER,title TEXT,alias TEXT,originTitle TEXT,memberCount INTEGER,ownerId INTEGER,createAt INTEGER,lastModify INTEGER,unreadCount INTEGER,status INTEGER);
    INSERT INTO tbconversation VALUES ('g1',2,'开发群','','',3,101,1000,3000,0,1),('g2',2,'开发群','','',3,102,1000,2000,0,1),('101:999',1,'小张','','',2,0,1000,1000,0,1);
    CREATE TABLE tbuser_profile_v2(uid INTEGER,nick TEXT,alias TEXT,dingtaklId TEXT);
    INSERT INTO tbuser_profile_v2 VALUES (101,'小张','','zhang'),(102,'小李','同事','li');
    CREATE TABLE tbuser_alias_name(uid INTEGER,alias TEXT);
    INSERT INTO tbuser_alias_name VALUES (101,'张老师');
    CREATE TABLE tbuser_group_nick(cid TEXT,uid TEXT,groupNick TEXT);
    INSERT INTO tbuser_group_nick VALUES ('g1','101','群内小张');
    CREATE TABLE msg_clear_info(cid TEXT,clear_timestamp INTEGER,clear_type INTEGER);
  `)
  for (const table of ['tbmsg_000', 'tbmsg_001', 'tblastmsg']) {
    db.exec(`CREATE TABLE ${table}(primaryKey INTEGER PRIMARY KEY, cid TEXT,localId TEXT,mid INTEGER,senderId INTEGER,type INTEGER,createdAt INTEGER,lastModify INTEGER,contentType INTEGER,content TEXT,extension TEXT,recallStatus INTEGER,isDecrypt INTEGER,shieldStatus INTEGER,version INTEGER,contentVersion INTEGER)`)
  }
  const message = (table: string, mid: string, when: number, text: string, extra: Record<string, unknown> = {}) => {
    const values: Record<string, unknown> = {
      cid: 'g1', localId: '', mid, senderId: 101, type: 1, createdAt: when, lastModify: when,
      contentType: 1, content: JSON.stringify({ text }), extension: '{}', recallStatus: 0,
      isDecrypt: 1, shieldStatus: 0, version: 1, contentVersion: 1, ...extra,
    }
    const keys = Object.keys(values)
    const statement = db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`)
    statement.run(...keys.map(key => values[key] as never))
  }
  message('tbmsg_000', '9007199254740993', 3000, "周会 100%_ ' OR 1=1 --")
  message('tblastmsg', '9007199254740993', 3000, "周会 100%_ ' OR 1=1 --")
  message('tbmsg_001', '2', 3000, '第二条周会')
  message('tbmsg_000', '3', 2000, 'older secret')
  message('tblastmsg', '3', 2000, 'older secret', { lastModify: 4000, recallStatus: 1 })
  message('tbmsg_001', '4', 1000, 'hidden cipher', { isDecrypt: 0 })
  message('tblastmsg', '5', 4000, 'only in last cache', { cid: 'g2', senderId: 102 })
  const members = new DatabaseSync(':memory:')
  members.exec(`
    CREATE TABLE tbmember_000(cid TEXT,uid TEXT,group_nick TEXT,display_name TEXT,alias TEXT,nick TEXT,member_role INTEGER);
    INSERT INTO tbmember_000 VALUES ('g1','101','群内小张','','','小张',1),('g1','102','','显示小李','','小李',0);
  `)
  return { db, members }
}

let db: DatabaseSync, members: DatabaseSync, reader: ChatReader
beforeEach(() => { ({ db, members } = fixture()); reader = new ChatReader(db, '999', 'synthetic_v3', members) })
afterEach(() => { db.close(); members.close() })

const rows = (result: object, key: string): Record<string, any>[] => (result as Record<string, any>)[key]

test('name ambiguity never selects an arbitrary group', () => {
  const error = caught<SkillError>(() => reader.query({ op: 'read', chat: '开发群' }))
  assert.equal(error.status, 'chat_ambiguous')
  assert.equal((error.details.candidates as unknown[]).length, 2)
})

test('cross-table and last-cache de-duplication', () => {
  const messages = rows(reader.query({ op: 'search', since: 0 }), 'messages')
  assert.equal(messages.length, 5)
  assert.equal(new Set(messages.map(message => message.id)).size, 5)
  assert.equal(messages[0]!.text, 'only in last cache')
  assert.ok(messages.some(message => message.serverId === '9007199254740993'))
})

test('recalled and encrypted content is not searchable', () => {
  for (const word of ['secret', 'cipher']) assert.deepEqual(rows(reader.query({ op: 'search', query: word }), 'messages'), [])
  const result = reader.query({ op: 'read', chat: 'g1' })
  assert.deepEqual(new Set(rows(result, 'messages').map(message => message.contentStatus)), new Set(['parsed', 'recalled', 'encrypted']))
})

test('literal query and sender by group nickname', () => {
  const result = reader.query({ op: 'search', chat: 'g1', query: "100%_ ' OR 1=1 --", sender: '群内小张' })
  const messages = rows(result, 'messages')
  assert.equal(messages.length, 1)
  assert.equal(messages[0]!.sender.name, '群内小张')
})

test('time bounds and clear timestamp', () => {
  const result = reader.query({ op: 'search', since: 2000, until: 3000 })
  assert.deepEqual(rows(result, 'messages').map(message => message.serverId), ['3'])
  db.exec("INSERT INTO msg_clear_info VALUES ('g1',3000,0)")
  assert.deepEqual(rows(reader.query({ op: 'read', chat: 'g1' }), 'messages'), [])
})

test('keyset pagination with equal times', () => {
  const query: Record<string, unknown> = { op: 'read', chat: 'g1', limit: 1 }
  const ids: string[] = []
  for (;;) {
    const result = reader.query(query as never) as Record<string, any>
    ids.push(...result.messages.map((message: Record<string, any>) => message.id))
    if (!result.hasMore) break
    query.cursor = result.nextCursor
  }
  assert.equal(ids.length, 4)
  assert.equal(new Set(ids).size, 4)
  const error = caught<SkillError>(() => reader.query({ ...query, chat: 'g2' } as never))
  assert.equal(error.status, 'invalid_cursor')
})

test('contacts, members and group info', () => {
  const contacts = rows(reader.query({ op: 'contacts', query: 'zhang' }), 'contacts')
  assert.equal(contacts[0]!.name, '张老师')
  const result = reader.query({ op: 'members', chat: 'g1' }) as Record<string, any>
  assert.equal(result.cachedMemberCount, 2)
  assert.equal(Number(result.chat.memberCount), 3)
  assert.equal(result.members.find((member: Record<string, any>) => member.id === '101').isOwner, true)
  assert.throws(() => reader.query({ op: 'members', chat: '101:999' }), SkillError)
})

test('dates and invalid filters', () => {
  assert.equal(dateMs('2026-10-16'), dateMs('2026-10-15T16:00:00Z'))
  for (const value of ['2026-02-30', '2026-10-16T25:00:00Z', '2026-10-16T08:00:00']) assert.throws(() => dateMs(value), SkillError)
  for (const args of [['chat', 'search'], ['chat', 'list', '--limit', '0'], ['chat', 'search', '--since', '2026-10-17', '--until', '2026-10-16']]) {
    assert.throws(() => validate(parseArgs(args)), SkillError)
  }
})

test('content allow-list and nested rich text', () => {
  const detail = { payloadV2: { contents: [{ text: { items: [{ data: { text: '富文本测试' } }] } }] }, authCode: 'never-output', authMediaId: 'never-output' }
  const row: Record<string, unknown> = { contentType: 3100, type: 1, isDecrypt: 1, content: JSON.stringify({ attachments: [{ extension: JSON.stringify(detail) }] }) }
  const result = parseContent(row as never)
  assert.ok(result.text.includes('富文本测试'))
  assert.ok(!JSON.stringify(result).includes('never-output'))
  row.recallStatus = 1
  assert.ok(!JSON.stringify(parseContent(row as never)).includes('富文本测试'))
})

test('the CLI reports invalid input as one JSON line with exit code 1', () => {
  const result = spawnSync(process.execPath, [path.join(HERE, '..', 'scripts', 'dingtalk.ts'), 'chat', 'search'], { encoding: 'utf8', env: process.env })
  assert.equal(result.status, 1)
  assert.equal(JSON.parse(result.stdout).status, 'invalid_input')
  assert.equal(result.stderr, '')
})

test('a missing data directory is reported, not crashed on', () => {
  const empty = mkdtempSync(path.join(tmpdir(), 'dingtalk-empty-'))
  const result = spawnSync(process.execPath, [path.join(HERE, '..', 'scripts', 'dingtalk.ts'), 'profiles', '--data-dir', empty], { encoding: 'utf8', env: process.env })
  assert.equal(result.status, 1)
  const printed = JSON.parse(result.stdout)
  assert.equal(printed.ok, false)
  assert.equal(printed.status, 'database_missing')
})
