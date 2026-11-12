/**
 * 把文件**真的写到磁盘**。
 *
 * # 为什么落盘在 source（D21 的落地）
 *
 * D21 的裁决原文是「下载由 `packages/core/*` 执行；`source/*` 只暴露下载所需的
 * 全部参数」。而本仓**没有**任何 core 包消费 `downloadParams` —— 于是
 * 「清单列得出来、文件下不下来」这条缺口在审计里挂了很久（漏-6）。
 *
 * 2026-11-12 的更正把那条追加的「source 不碰文件系统」删掉了：`source` 可以落盘，
 * 缓存与临时文件也在它的职责内。所以这里补上执行方，`downloadParams` 照旧
 * 保留 —— 它已经是最合适的「取地址」基础函数，重复写一份只会分叉。
 *
 * # 为什么不是「一次 fetch 拿完整文件」
 *
 * 课程视频动辄几百 MB。`await response.arrayBuffer()` 会把整个文件放进内存，
 * 一台跑着工作台的机器很容易被一个 2 GB 的录像拖垮，而且**看起来像卡住**。
 * 所以走流式：边收边写，`maxBytes` 到了就停。
 *
 * # 断点续传做不做
 *
 * 做，但只做**最保守的那一种**：先写 `.part`，收完再原子改名成目标文件。
 * 不做 `Range` 续传 —— 超星的下载地址带时效签名（`cldisk` 的地址几分钟就过期），
 * 同一个文件再次请求拿到的往往是另一份签名地址，续传的语义不成立。
 * 半途中断时 `.part` 留着，下次整份重下（`saveOne` 会先删残留）。
 */

import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { ClassroomError } from '@lybx-leyw/dsh-zju-source-http';

/** 单请求的默认超时（毫秒）。大文件比普通接口慢得多。 */
const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;

/**
 * 下载一个地址到本地文件。
 *
 * @param {{request: Function}} client - `XxtClient`（要能拿到流式响应）。
 * @param {object} options
 * @param {string} options.url - 已升级成 https 的下载地址。
 * @param {string} options.destination - **绝对路径**目标文件。
 * @param {Record<string, string>} [options.headers] - 额外请求头（超星要 Referer）。
 * @param {number} [options.maxBytes] - 超过就中止（预期大小的防呆）。
 * @param {AbortSignal} [options.signal]
 * @param {number} [options.timeoutMs]
 * @returns {Promise<{path: string, bytes: number}>}
 */
export async function downloadTo(client, {
  url,
  destination,
  headers = {},
  maxBytes = 0,
  signal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (!path.isAbsolute(String(destination ?? ''))) {
    throw new ClassroomError('INVALID_ARGUMENT', '下载目标必须是绝对路径。');
  }
  const target = path.resolve(destination);
  const partial = `${target}.part`;
  let opened;

  try {
    await mkdir(path.dirname(target), { recursive: true });
    opened = await client.stream(url, { headers, signal, timeoutMs });
    const response = opened.response;

    if (response.status === 401 || response.status === 403) {
      throw new ClassroomError('REJECTED', '学习通拒绝了这个下载（地址可能已过期或没有权限）。', {
        http_status: response.status,
      });
    }
    if (response.status < 200 || response.status >= 300) {
      throw new ClassroomError('PLATFORM_ERROR', `下载返回 HTTP ${response.status}。`, {
        http_status: response.status,
      });
    }
    if (!response.body) {
      throw new ClassroomError('SCHEMA_CHANGED', '下载响应没有内容。');
    }

    const total = Number(response.headers.get('content-length') ?? 0);
    // 平台给的长度是权威值：清单里的大小可能来自页面的约数（「310KB」）。
    if (maxBytes > 0 && total > 0 && total > maxBytes) {
      throw new ClassroomError('REJECTED', '平台给的文件比清单里写的大，已中止（避免下错文件）。', {
        expected: maxBytes,
        actual: total,
      });
    }

    let received = 0;
    const counter = new Transform({
      transform(chunk, _encoding, callback) {
        received += chunk.length;
        // 没有 content-length 时用预期大小兜底：写到一半发现远超预期，
        // 说明这不是那个文件（超星偶尔会拿一个跳转页顶替）。
        if (maxBytes > 0 && received > maxBytes) {
          callback(new ClassroomError('REJECTED', '收到的内容超过预期大小，已中止。', { expected: maxBytes }));
          return;
        }
        callback(null, chunk);
      },
    });

    await pipeline(
      Readable.fromWeb(response.body),
      counter,
      createWriteStream(partial, { mode: 0o600 }),
      { signal: opened.signal },
    );

    if (total > 0 && received !== total) {
      throw new ClassroomError('REJECTED', '文件没有下载完整（连接提前结束）。', {
        expected: total,
        actual: received,
      });
    }

    // 收完才改名：中途失败时目标文件名**不存在**，`saveOne` 的复用逻辑
    // 就不会把一个半截文件当成已下载。
    await rm(target, { force: true });
    await rename(partial, target);
    const info = await stat(target);
    return { path: target, bytes: info.size };
  } catch (error) {
    if (error instanceof ClassroomError) throw error;
    if (signal?.aborted || opened?.signal?.aborted) {
      throw new ClassroomError('CANCELLED', '下载已取消。');
    }
    throw new ClassroomError('NETWORK', '下载中断，可以重试。');
  } finally {
    if (opened) {
      await opened.response.body?.cancel?.().catch(() => {});
      opened.release?.();
    }
  }
}
