import test from 'node:test'
import assert from 'node:assert/strict'
import { place, rowAt } from './grid.ts'

/** 浙大一天的 13 节。 */
const PERIODS = [
  ['08:00', '08:45'], ['08:50', '09:35'], ['10:00', '10:45'], ['10:50', '11:35'], ['11:40', '12:25'],
  ['13:25', '14:10'], ['14:15', '15:00'], ['15:05', '15:50'], ['16:15', '17:00'], ['17:05', '17:50'],
  ['18:50', '19:35'], ['19:40', '20:25'], ['20:30', '21:15'],
].map(([startTime, endTime], index) => ({ period: index + 1, startTime, endTime }))
const lesson = (title, time, end) => ({ kind: 'class', title, time, end })
const due = (title, time) => ({ kind: 'due', title, time })

test('a time maps to its row: inside a period by proportion, a break counts as the end of the period before', () => {
  assert.equal(rowAt('08:00', PERIODS), 0)
  assert.equal(rowAt('10:00', PERIODS), 2)
  assert.equal(rowAt('09:50', PERIODS), 2)
  assert.equal(rowAt('12:25', PERIODS), 5)
  assert.ok(Math.abs(rowAt('10:30', PERIODS) - (2 + 30 / 45)) < 1e-9)
  assert.equal(rowAt('07:00', PERIODS), 0)
  assert.equal(rowAt('23:59', PERIODS), 13)
})

test('classes go into the grid by time, overlapping ones side by side', () => {
  const { grid, pins } = place([lesson('概率论', '10:00', '12:25'), lesson('考试', '10:30', '12:30'), lesson('计算机组成', '13:25', '15:00')], PERIODS)
  assert.deepEqual(pins, [])
  const by = title => grid.find(placed => placed.item.title === title)
  assert.equal(by('概率论').top, 2)
  assert.equal(by('概率论').bottom, 5)
  assert.deepEqual([by('概率论').lane, by('考试').lane, by('概率论').lanes, by('考试').lanes], [0, 1, 2, 2])
  assert.equal(by('计算机组成').lanes, 1)
})

test('a 23:59 deadline sits at the very bottom; an earlier one in the evening is lifted above it', () => {
  const { grid, pins } = place([due('书法作业', '23:59'), due('实验报告', '22:00'), lesson('书法', '18:50', '21:15')], PERIODS)
  assert.equal(grid.length, 1)
  const top = title => pins.find(pinned => pinned.item.title === title).top
  assert.equal(top('书法作业'), 12)
  assert.equal(top('实验报告'), 11)
})

test('a deadline inside class hours sits with its bottom at the due time, and is lifted if a later one is in the way', () => {
  const { pins } = place([due('预习报告', '12:25'), due('小测', '11:35')], PERIODS)
  const top = title => pins.find(pinned => pinned.item.title === title).top
  assert.equal(top('预习报告'), 4)
  assert.equal(top('小测'), 3)
  // 早上八点前截止的不往格子外面放。
  assert.equal(place([due('早交', '07:30')], PERIODS).pins[0].top, 0)
})

test('things with no time count as the end of the day, below anything timed', () => {
  const { pins } = place([{ kind: 'event', title: '交体检表' }, due('作业', '23:59')], PERIODS)
  assert.deepEqual(pins.map(pinned => [pinned.item.title, pinned.top]), [['交体检表', 12], ['作业', 11]])
})
