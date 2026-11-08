/** 校园事务页上说时间和拼句子用的几样，作业那一栏和通知那一栏共用。 */
import { useEffect, useState } from 'react'

export const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR

export const two = (value: number) => String(value).padStart(2, '0')
export const midnight = (at: number) => new Date(at).setHours(0, 0, 0, 0)
export const clock = (date: Date) => `${two(date.getHours())}:${two(date.getMinutes())}`

/** 几月几日，不是今年的带上年份。 */
export function dateText(at: number, now: number): string {
  const date = new Date(at)
  return `${date.getFullYear() === new Date(now).getFullYear() ? '' : `${date.getFullYear()}年`}${date.getMonth() + 1}月${date.getDate()}日`
}

/** 多久以前读到的。 */
export function agoText(at: number, now: number): string {
  const passed = now - at
  if (passed < MINUTE) return '刚刚'
  if (passed < HOUR) return `${Math.floor(passed / MINUTE)} 分钟前`
  if (passed < DAY) return `${Math.floor(passed / HOUR)} 小时前`
  return dateText(at, now)
}

/** 现在的时间，半分钟走一次：「还有几小时」跟着变，过了截止时间的作业自己从两周内的列表里出去。 */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => { setNow(Date.now()) }, 30_000)
    return () => { window.clearInterval(timer) }
  }, [])
  return now
}

export const joined = (names: readonly string[]) => names.length > 1 ? `${names.slice(0, -1).join('、')}和${names[names.length - 1]}` : names.join('')
/** 系统的名字（PTA）拼进句子里时，字母和汉字之间空一格，和别处的写法一致。 */
export const mixed = (text: string) => text.replace(/([A-Za-z0-9])(?=\p{Script=Han})|(\p{Script=Han})(?=[A-Za-z0-9])/gu, '$1$2 ')
