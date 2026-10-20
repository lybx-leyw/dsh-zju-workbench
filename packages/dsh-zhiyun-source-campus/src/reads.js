/** Coalesce page consumers and briefly reuse results, including explicit failures.
 * Failures retain ok:false; the cache never turns them into empty successes.
 */
export function sharedRead(load, { key = async () => '', ttlMs = 60000, now = Date.now } = {}) {
  let current = null;
  const read = async () => {
    const identity = await key();
    if (current?.key === identity && (current.pending || current.until > now())) return structuredClone(await current.promise);
    const entry = { key: identity, pending: true, until: 0, promise: null };
    current = entry;
    entry.promise = Promise.resolve().then(load).then(value => {
      entry.pending = false;
      entry.until = now() + ttlMs;
      return structuredClone(value);
    }, error => {
      if (current === entry) current = null;
      throw error;
    });
    return structuredClone(await entry.promise);
  };
  read.invalidate = () => { current = null; };
  return read;
}

