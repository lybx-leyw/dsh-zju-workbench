import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collegeOptions } from './colleges.mjs'

test('学院名录按学部分组，官网读不了的学院也能选，名字不重复', () => {
  const { faculties, others } = collegeOptions()
  assert.ok(faculties.length >= 5)
  const names = [...faculties.flatMap(faculty => faculty.colleges), ...others]
  assert.ok(names.includes('计算机科学与技术学院'))
  assert.equal(new Set(names).size, names.length)
  for (const faculty of faculties) assert.ok(faculty.name && faculty.colleges.length > 0)
})
