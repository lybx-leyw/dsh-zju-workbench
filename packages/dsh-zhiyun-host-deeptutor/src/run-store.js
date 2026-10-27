import { createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile,rename } from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import { join } from 'node:path';

/**
 * 每次 run 的证据落盘器（契约 §12）。
 *
 * 一个 run 一个目录，里面的文件只追加不改写：
 * - request.json      发起时的完整请求快照
 * - events.ndjson     对外事件流，一行一个（按 sequence 顺序，可断点重放）
 * - diagnostics.ndjson 未能映射的上游事件、stderr 摘要、异常栈尾部
 * - result.json       终态结果
 * - usage.json        用量汇总
 *
 * 为什么单独抽一层：service.js 只负责编排，落盘失败绝不能把 run 弄挂
 * （日志盘满时宁可丢证据也不能丢用户结果），所以这里所有写操作都吞错并回调 logger。
 */
export function createRunStore({ runsDir, logger = {} }) {
  /** @type {Map<string, {dir: string, events: ReturnType<typeof createWriteStream>|null, diagnostics: ReturnType<typeof createWriteStream>|null}>} */
  const open = new Map();
  const cachePath=fingerprint=>join(runsDir,'cache',createHash('sha256').update(fingerprint).digest('hex')+'.json');
  async function atomic(file,value){const temp=file+'.'+randomUUID()+'.tmp';await writeFile(temp,stableJson(value),'utf8');await rename(temp,file);}

  function warn(message, detail) {
    logger.warn?.(message, detail);
  }

  async function ensureDir(runId) {
    const state = open.get(runId);
    if (state) return state;
    const dir = join(runsDir, runId);
    await mkdir(dir, { recursive: true });
    const fresh = { dir, events: null, diagnostics: null };
    open.set(runId, fresh);
    return fresh;
  }

  function appendStream(state, key, file) {
    if (!state[key]) {
      state[key] = createWriteStream(join(state.dir, file), { flags: 'a', encoding: 'utf8' });
      // 流错误必须被吞掉，否则会冒成 uncaught exception 把宿主带崩。
      state[key].on('error', (error) => warn(`写入 ${file} 失败`, error?.message ?? String(error)));
    }
    return state[key];
  }

  return {
    dir(runId) {
      return join(runsDir, runId);
    },

    async writeRequest(runId, request) {
      try {
        const state = await ensureDir(runId);
        await writeFile(join(state.dir, 'request.json'), stableJson(request), 'utf8');
      } catch (error) {
        warn('写请求快照失败', error?.message ?? String(error));
      }
    },

    async appendEvent(runId, event) {
      try {
        const state = await ensureDir(runId);
        appendStream(state, 'events', 'events.ndjson').write(`${JSON.stringify(event)}\n`);
      } catch (error) {
        warn('追加事件失败', error?.message ?? String(error));
      }
    },

    async appendDiagnostic(runId, entry) {
      try {
        const state = await ensureDir(runId);
        appendStream(state, 'diagnostics', 'diagnostics.ndjson').write(`${JSON.stringify(entry)}\n`);
      } catch (error) {
        warn('追加诊断失败', error?.message ?? String(error));
      }
    },

    async writeResult(runId, result) {
      try {
        const state = await ensureDir(runId);
        await atomic(join(state.dir,'result.json'),result);
        if(result.status==='succeeded'&&result.fingerprint){await mkdir(join(runsDir,'cache'),{recursive:true});await atomic(cachePath(result.fingerprint),{runId,fingerprint:result.fingerprint});}
      } catch (error) {
        warn('写结果失败', error?.message ?? String(error));
        throw error;
      }
    },

    async findCompleted(fingerprint){
      try{const entry=JSON.parse(await readFile(cachePath(fingerprint),'utf8'));if(!/^[\w-]+$/.test(entry.runId))return null;const result=await this.readResult(entry.runId);return result?.status==='succeeded'&&result.fingerprint===fingerprint?result:null;}catch{return null;}
    },

    async writeUsage(runId, usage) {
      try {
        const state = await ensureDir(runId);
        await writeFile(join(state.dir, 'usage.json'), stableJson(usage), 'utf8');
      } catch (error) {
        warn('写用量失败', error?.message ?? String(error));
      }
    },

    async readResult(runId) {
      try {
        const raw = await readFile(join(runsDir, runId, 'result.json'), 'utf8');
        return JSON.parse(raw);
      } catch {
        return null;
      }
    },

    async readEvents(runId) {
      try {
        const raw = await readFile(join(runsDir, runId, 'events.ndjson'), 'utf8');
        return raw
          .split('\n')
          .filter((line) => line.trim() !== '')
          .map((line) => JSON.parse(line));
      } catch {
        return [];
      }
    },

    close(runId) {
      const state = open.get(runId);
      if (!state) return;
      state.events?.end();
      state.diagnostics?.end();
      open.delete(runId);
    },

    closeAll() {
      for (const runId of [...open.keys()]) this.close(runId);
    },
  };
}

/** 键排序的稳定 JSON：同一对象不同键顺序得到同一份字节，供指纹与对比使用。 */
export function stableJson(value) {
  return `${JSON.stringify(sortKeys(value), null, 2)}\n`;
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortKeys(value[key]);
    return out;
  }
  return value;
}
