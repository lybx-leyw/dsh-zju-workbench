import { createHash } from 'node:crypto';
import { ClassroomError } from './errors.js';
import { inspectJwt, jwtFromTokenCookie } from './auth.js';

/** Restore from saved credentials only on demand; share attempts and cool down failures. */
export function savedAccountConnection({ source, readAccount, getUser, now = Date.now, cooldownMs = 60000 }) {
  let attempt = null, blocked = null, observed = null;
  const identity = account => createHash('sha256').update(JSON.stringify(account)).digest('hex');
  return {
    async suspend() { blocked = identity(await readAccount()); },
    async ensure() {
      await source.ready;
      const account = await readAccount();
      const key = identity(account);
      const changed = observed !== null && observed !== key;
      observed = key;
      if (blocked === key) return false;
      if (!account) return Boolean(await getUser());
      const cookies = await source.transport.session.jar.getCookies('https://classroom.zju.edu.cn/');
      const token = inspectJwt(jwtFromTokenCookie(cookies));
      const bound = source.transport.session.accountKey === createHash("sha256").update(account.username).digest("hex");
      if (!changed && bound && token.present && !token.malformed && token.expired !== true && await getUser()) return true;
      if (attempt?.key === key && (attempt.pending || attempt.until > now())) return attempt.promise;
      const entry = { key, pending: true, until: 0, promise: null };
      attempt = entry;
      entry.promise = source.login(account, { reuseSso: !changed && bound, entry: 'oauth' }).then(result => {
        if (!result?.authenticated) throw new ClassroomError('AUTH_INCOMPLETE', '课堂登录没有完成');
        return true;
      }).finally(() => { entry.pending = false; entry.until = now() + cooldownMs; });
      return entry.promise;
    },
  };
}
