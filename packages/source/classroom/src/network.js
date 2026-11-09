import { Agent, fetch } from 'undici';

/** A private dispatcher keeps campus requests independent of the host LLM proxy. */
export function classroomNetwork() {
  const dispatcher = new Agent({ connect: { timeout: 15000 } });
  return {
    fetch: (url, init) => fetch(url, { ...init, dispatcher }),
    close: () => dispatcher.close(),
  };
}
