export interface CredentialVault {
  seal(text: string, purpose: string, previous?: unknown): unknown;
  open(sealed: unknown, purpose: string): string;
  forget(sealed: unknown): void;
}
export function readAccountFile(file: string, options?: { vault?: CredentialVault }): { raw: string; data: Record<string, unknown> };
export function writeAccountFile(file: string, data: Record<string, unknown>, options?: { expectedRaw?: string; vault?: CredentialVault }): { raw: string; data: Record<string, unknown> };
