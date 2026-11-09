import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { CORE_ROOT } from './core.mjs'

const coreModule = name => import(pathToFileURL(path.join(CORE_ROOT, 'zju', 'lib', 'core', name)).href)
export const { readAccountFile, writeAccountFile } = await coreModule('account-file.mjs')
export const { credentialVault } = await coreModule('credential-vault.mjs')
