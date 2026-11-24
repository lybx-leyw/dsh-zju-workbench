/** 宿主半边与客户端半边共用的常量（客户端不能 import index.js，会把 apply/node:fs 打进浏览器）。 */
export const ROUTE_PATH = '/_dsh/yonkik'
export const WRITE_HEADER = 'x-zw-yonkik'
export const MASK = '********'

export function errorText(error, status) {
  if (typeof error === 'string' && error) return error
  if (error && typeof error === 'object') {
    const message = typeof error.message === 'string' ? error.message.trim() : ''
    if (message) return message
    if (typeof error.code === 'string' && error.code) return error.code
  }
  return `设置接口返回 ${status}`
}