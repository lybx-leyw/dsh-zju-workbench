/**
 * 浙大邮箱的客户端专用密码存在 dsh 的凭据服务里（ctx.credentials 的一条 grant 记录，键是 dsh-zju-campus/mail），
 * 不放在 mail.json，也不经工具和页面的快照。桌面版原来交给 Electron 的 safeStorage 加密，插件里没有 Electron。
 * grant 里只保存由系统凭据库保管密钥的密文；旧 password 字段首次读取时迁移。
 * mail.json 里只记一个标记 credentials:dsh-zju-campus/mail，open 认这个标记才去读。
 */
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { credentialVault } from './security.mjs'

const KEY = credentialKey('dsh-zju-campus', 'mail')
const MARK = `credentials:${KEY}`

/** credentials 返回凭据服务；dsh 没有挂载它时为 undefined。 */
export function mailVault(credentials, vault = credentialVault) {
  const service = () => {
    const found = credentials()
    if (!found) throw new Error('这个 dsh 没有凭据服务，存不了邮箱的专用密码。')
    return found
  }
  return {
    async seal(password) {
      await service().modifyRecord(KEY, async previous => ({ kind: 'grant', payload: { sealed: vault.seal(password, 'campus-mail', previous?.payload?.sealed) } }))
      return MARK
    },
    async open(secret) {
      if (secret !== MARK) throw new Error('邮箱的专用密码不在了，请重新连接邮箱。')
      let record = await service().readRecord(KEY)
      if (record?.kind === 'grant' && typeof record.payload?.password === 'string' && record.payload.password) {
        record = await service().modifyRecord(KEY, async current => {
          if (current?.kind !== 'grant' || !current.payload?.password) return current
          return { kind: 'grant', payload: { sealed: vault.seal(current.payload.password, 'campus-mail', current.payload.sealed) } }
        })
      }
      if (record?.kind !== 'grant' || !record.payload?.sealed) throw new Error('邮箱的专用密码不在了，请重新连接邮箱。')
      return vault.open(record.payload.sealed, 'campus-mail')
    },
    async forget() {
      const found = credentials()
      if (!found) return
      const record = await found.readRecord(KEY)
      await found.deleteRecord(KEY)
      if (record?.payload?.sealed) vault.forget(record.payload.sealed)
    },
  }
}
