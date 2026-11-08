import test from 'node:test'
import assert from 'node:assert/strict'
import { page, argumentsFor, time } from './common.mjs'
test('cursor binds to full query and profile, with stable tie ordering', () => {
  const query = { op: 'read', chat: 'group', profile: 'a', limit: 2 },
    records = [
      { id: 'c', at: 2 },
      { id: 'a', at: 2 },
      { id: 'b', at: 2 }
    ]
  const key = (m) => [-m.at, m.id],
    first = page(query, records, key, 'messages')
  assert.deepEqual(
    first.messages.map((m) => m.id),
    ['a', 'b']
  )
  assert.deepEqual(
    page({ ...query, cursor: first.nextCursor }, records, key, 'messages').messages.map((m) => m.id),
    ['c']
  )
  assert.throws(
    () => page({ ...query, profile: 'b', cursor: first.nextCursor }, records, key, 'messages'),
    (e) => e.status === 'invalid_cursor'
  )
})
test('invalid time, bounds and ambiguous arguments fail before reading databases', () => {
  assert.equal(time('2026-10-16'), Date.parse('2026-10-16T00:00:00+08:00'))
  for (const value of ['2026-02-30', '2026-10-16T12:00', '2026-10-16T25:00:00Z'])
    assert.throws(() => time(value))
  for (const args of [
    ['chat', 'read'],
    ['chat', 'search'],
    ['chat', 'list', '--limit', '0'],
    ['chat', 'read', '--chat', 'x', '--since', '2026-10-17', '--until', '2026-10-16'],
    ['chat', 'send']
  ])
    assert.throws(() => argumentsFor(args))
})
