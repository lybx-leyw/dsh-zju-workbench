export type AccountId = 'zju' | 'webvpn' | 'pta' | 'lab' | 'chaoxing' | 'cc98' | 'tyys' | 'buddy'

export interface AccountField {
  /** accounts.json 里的键。 */
  key: string
  label: string
  placeholder?: string
  /** 可以留空。 */
  optional?: boolean
}

export interface Account {
  title: string
  /** 可以填好几个，再添加的在键名后加 _2、_3……。 */
  multiple?: boolean
  user?: AccountField
  secret: AccountField
}

export const ACCOUNTS: Record<AccountId, Account>
export const TRANSPORT: { key: string, label: string, options: readonly { value: string, label: string }[] }
export const MAX_ACCOUNTS: number
export function accountKeys(): string[]
export function numberedKeys(id: AccountId, index: number): { user: string | undefined, secret: string }
export function isAccountKey(key: string): boolean
export function accountIndexes(values: Record<string, string>, id: AccountId): number[]
export function accountReady(values: Record<string, string>, id: AccountId): boolean

export interface IdentityField {
  key: string
  label: string
  /** ZJU Core 会读这一项。 */
  core?: boolean
  /** 只能从这几项里选。 */
  options?: readonly string[]
}
export const IDENTITY_FIELDS: readonly IdentityField[]
