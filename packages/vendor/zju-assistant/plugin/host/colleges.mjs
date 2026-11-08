import fs from 'node:fs'
import path from 'node:path'
import { CORE_ROOT } from './core.mjs'

/**
 * 设置里的个人档案选学院用的名录，按学部分组。就是 ZJU Core 查学院通知用的那一份（core/zju/lib/notice/colleges.json），
 * 这样页面上选的名字 core 一定对得上。官网读不了的几个学院没有学部信息，放在 others 里，照样能选。
 */
export function collegeOptions(file = path.join(CORE_ROOT, 'zju', 'lib', 'notice', 'colleges.json')) {
  const catalog = JSON.parse(fs.readFileSync(file, 'utf8'))
  const faculties = []
  for (const college of catalog.colleges) {
    let group = faculties.find(item => item.name === college.faculty)
    if (!group) faculties.push(group = { name: college.faculty, colleges: [] })
    group.colleges.push(college.name)
  }
  return { faculties, others: catalog.skipped.map(college => college.name) }
}
