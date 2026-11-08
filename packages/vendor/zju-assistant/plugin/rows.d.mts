import type { AccountId } from './accounts.mjs'

export interface Row {
  key: string
  title: string
  id: string
  on: boolean
  modules: string[]
  accounts?: AccountId[]
  platforms?: string[]
  settings?: string
}

export const PACKAGE: string
export const BUNDLE: string
export const ROWS: readonly Row[]
export function moduleName(row: Row): string
export function rowConfigKey(row: Row): string
export function accountRow(account: AccountId): string
export function disabledModules(active: ReadonlySet<string>): string[]
