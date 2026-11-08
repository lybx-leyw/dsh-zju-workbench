import { createCredentialVault } from '../../lib/core/credential-vault.mjs'

/** Real authenticated encryption with an isolated in-memory OS-keyring substitute. */
export function memoryVault() {
  const keys = new Map()
  const vault = createCredentialVault({ entry: id => ({
    setPassword: value => keys.set(id, value),
    getPassword: () => keys.get(id) ?? null,
    deleteCredential: () => keys.delete(id),
  }) })
  return { vault, keys }
}
export const testVault = memoryVault().vault
