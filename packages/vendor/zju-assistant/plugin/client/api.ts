/** 页面和根行（host/index.mjs）之间的唯一通道。 */

export async function campusApi<T>(action: string, input: unknown = {}): Promise<T> {
  const response = await fetch('/api/zju-campus', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, input }),
  })
  // 根行只回 200，或带原因的 400；别的状态说明请求没到它那里。
  if (!response.ok && response.status !== 400) throw new Error('ZJU All-in-One Assistant 没有响应，请在插件页确认它开着。')
  const result = await response.json()
  if (!response.ok || result.error) throw new Error(result.error || '请求没有完成，请再试一次。')
  return result.value
}

export const errorText = (error: unknown) => error instanceof Error ? error.message : String(error)

/** 账号的全部内容：各系统的账号、密码和校内站点的访问方式。有哪些键见 accounts.mjs。 */
export interface AccountSnapshot {
  values: Record<string, string>
  revision: string
}
