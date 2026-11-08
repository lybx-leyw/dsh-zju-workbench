/**
 * 写操作前经 dsh 的审批（ctx.approval）请用户点头。放不放行只看 dsh 的回答：allowed-once 才算批准，这里不改。
 *
 * 这里管的是没批准时怎么说。下面两种情况 dsh 根本不问用户就回 rejected，和用户点了拒绝分不出来，所以问之前先看是哪一种：
 * 权限模式的审批策略是 never（「完全权限」就是）；子任务的策略固定是 never，切父对话的模式也没用。
 * 照旧调用 request，这次请求才会记进会话的审计日志。
 */
function unasked(ctx, approval, agent, notDone) {
  if (ctx.get('agents')?.roots().includes(agent) === false) return `子任务不能请用户批准，${notDone}。把要做的事写进结果，交回主对话执行，不要改用命令行或别的办法绕过。`
  if ((approval.overrideOf?.(agent.session) ?? approval.config?.policy) === 'never') return `当前权限模式（例如「完全权限」）不弹批准，dsh 直接拒绝了这次请求。用户没有被问过，${notDone}。请告诉用户：把这个对话切到「工作区内修改」（或输入 /permission workspace-write）后再让你做一次。不要改用命令行或别的办法绕过。`
  return ''
}

/**
 * 请用户批准这一次调用，批准了才返回，别的情况都抛错。
 * request 是给 approval.request 的工具名和理由；notDone 是报错里说结果的那半句，如「命令没有执行」。
 */
export async function askToWrite(ctx, exec, request, notDone) {
  const approval = ctx.get('approval')
  if (!approval || !exec.agent) throw new Error(`这里没有能请用户批准的地方，${notDone}。`)
  const reason = unasked(ctx, approval, exec.agent, notDone)
  const outcome = await approval.request({ agent: exec.agent, callId: exec.callId, signal: exec.signal, ...request })
  if (outcome === 'allowed-once') return
  if (outcome === 'rejected') throw new Error(reason || `用户没有批准，${notDone}。`)
  throw new Error(`没有得到批准，${notDone}。`)
}
