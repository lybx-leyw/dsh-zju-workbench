// 源：ref/OpenMAIC/lib/pdf/pdf-providers.ts:303-357（parsePDF 的 provider 分派与 key 校验）
// 源：ref/OpenMAIC/lib/pdf/pdf-providers.ts:358-446（unpdf：文本 + sharp 转 PNG base64）
// 源：ref/OpenMAIC/lib/pdf/pdf-providers.ts:729-820（自建 MinerU：multipart /file_parse）
// 源：ref/OpenMAIC/lib/pdf/mineru-parser.ts:17-122（extractMinerUResult）
// 源：ref/OpenMAIC/lib/pdf/mineru-cloud.ts:491-700（batch → 预签名上传 → 轮询 → zip）
// 源：ref/OpenMAIC/lib/pdf/mineru-cloud.ts:318-490（zip 内的 full.md / content_list / images）
// 源：ref/OpenMAIC/lib/pdf/alidocmind-client.ts:123-300（AliDocMind submit→poll→get 的入口形状）
//
// # 四个分支都在，但两个需要外部依赖
//
// - `unpdf`：本地纯 JS 解析，要 `unpdf`（+ 可选 `sharp` 转图）。本仓未装 → 调用时返回
//   `E_DEPENDENCY_MISSING`，而不是"假装成功"。
// - `mineru`：自建服务，纯 HTTP，**可用**。
// - `mineru-cloud`：官方云，纯 HTTP + 本包自带 zip 解析，**可用**。
// - `alidocmind`：阿里云 SDK（`@alicloud/docmind-api20220711`）做 ACS3-HMAC 签名，
//   本仓未装 → 同样返回 `E_DEPENDENCY_MISSING`。手写签字算法风险高于收益，故不硬造。

import { MediaError, dependencyMissing, invalidInput, invalidResponse, notConfigured, unsupportedProvider, upstreamError } from '../errors.js';
import { PDF_PROVIDERS } from '../providers.js';
import { readZipEntries } from './zip.js';

const MINERU_CLOUD_DEFAULT_BASE = 'https://mineru.net/api/v4';
const MINERU_CLOUD_POLL_INTERVAL_MS = 2_500;
const MINERU_CLOUD_POLL_MAX_MS = 15 * 60 * 1000;

const DEFAULT_MINERU_BACKEND = 'pipeline';

/** source:pdf-providers.ts:155-168 —— 默认 pipeline（hybrid 后端可能要 GPU）。 */
export function getMinerUBackend() {
  const raw = process.env.PDF_MINERU_BACKEND?.trim();
  return raw || DEFAULT_MINERU_BACKEND;
}

/** source:pdf-providers.ts:240-264 —— 错误体只读有限字节。 */
async function readBoundedErrorBody(response, maxBytes = 64 * 1024) {
  const text = await response.text().catch(() => '');
  return text.slice(0, maxBytes);
}

/** source:pdf-providers.ts:266-290 */
function selfHostedMinerUFailure(status, rawBody) {
  if (status === 401 || status === 403) {
    return new MediaError('E_UPSTREAM_ERROR', '自建 MinerU 鉴权失败，请检查 API key', {
      provider: 'mineru',
      status,
      retryable: false,
    });
  }
  if (status === 413) {
    return new MediaError('E_UPSTREAM_ERROR', '自建 MinerU 拒收：文件过大（413）', {
      provider: 'mineru',
      status,
      retryable: false,
    });
  }
  return upstreamError('自建 MinerU', status, rawBody, { provider: 'mineru' });
}

function guessMimeType(value) {
  if (value.startsWith('/9j/')) return 'image/jpeg';
  if (value.startsWith('iVBORw0KGgo')) return 'image/png';
  if (value.startsWith('R0lGOD')) return 'image/gif';
  if (value.startsWith('UklGR')) return 'image/webp';
  return 'image/png';
}

/** source:mineru-parser.ts:17-122 */
export function extractMinerUResult(fileResult) {
  const markdown = fileResult?.md_content || '';
  const imageData = {};
  let pageCount = 0;

  if (fileResult?.images && typeof fileResult.images === 'object') {
    for (const [key, value] of Object.entries(fileResult.images)) {
      if (typeof value !== 'string') continue;
      // 只有裸 base64 才包成 data URL（按字节判类型）；URL / 路径原样保留。
      const mimeType = value.startsWith('data:') ? null : guessMimeType(value);
      imageData[key] = mimeType ? `data:${mimeType};base64,${value}` : value;
    }
  }

  const imageMetaLookup = new Map();
  let contentList;
  try {
    contentList = typeof fileResult?.content_list === 'string'
      ? JSON.parse(fileResult.content_list)
      : fileResult?.content_list;
  } catch {
    contentList = undefined;
  }
  if (Array.isArray(contentList)) {
    const pages = new Set(contentList.map((item) => item.page_idx).filter((v) => v != null));
    pageCount = pages.size;
    const imageTypes = new Set(['image', 'table', 'equation']);
    for (const item of contentList) {
      if (!imageTypes.has(item.type) || !item.img_path) continue;
      const captions = item.type === 'table' ? item.table_caption : item.image_caption;
      const metaEntry = {
        pageIdx: item.page_idx ?? 0,
        bbox: item.bbox || [0, 0, 1000, 1000],
        caption: Array.isArray(captions) ? captions[0] : undefined,
      };
      imageMetaLookup.set(item.img_path, metaEntry);
      const basename = item.img_path.split('/').pop();
      if (basename && basename !== item.img_path) imageMetaLookup.set(basename, metaEntry);
    }
  }

  const imageMapping = {};
  const pdfImages = [];
  Object.entries(imageData).forEach(([key, src], index) => {
    const imageId = key.startsWith('img_') ? key : `img_${index + 1}`;
    imageMapping[imageId] = src;
    const meta =
      imageMetaLookup.get(key)
      || imageMetaLookup.get(`images/${key}`)
      || imageMetaLookup.get(src);
    pdfImages.push({
      id: imageId,
      src,
      pageNumber: meta ? meta.pageIdx + 1 : 0,
      description: meta?.caption,
      width: meta ? meta.bbox[2] - meta.bbox[0] : undefined,
      height: meta ? meta.bbox[3] - meta.bbox[1] : undefined,
      path: key,
    });
  });

  return {
    text: markdown,
    images: Object.values(imageMapping),
    metadata: { pageCount, parser: 'mineru', imageMapping, pdfImages },
  };
}

/**
 * 两个入口，顺序有讲究：包管理器装了就先用那份（谁也没规定版本），没装才退回包内
 * vendor —— 后者是为了 clone 下来不跑 `npm i` 也能解析讲义。`unpdf` 是可选依赖，
 * 缺它不影响其他能力，只影响 PDF 文本抽取。
 */
const UNPDF_VENDORED = new URL('../../vendor/unpdf/dist/index.mjs', import.meta.url).href;

async function loadUnpdf() {
  try {
    return await import('unpdf');
  } catch {
    try {
      return await import(UNPDF_VENDORED);
    } catch {
      throw dependencyMissing('unpdf', 'PDF 解析（unpdf）', 'npm i unpdf');
    }
  }
}

/** source:pdf-providers.ts:358-446 */
async function parseWithUnpdf(pdfBuffer, textOnly = false) {
  const unpdf = await loadUnpdf();
  const { extractText, getDocumentProxy, extractImages } = unpdf;

  const pdf = await getDocumentProxy(
    new Uint8Array(pdfBuffer),
    textOnly ? { maxImageSize: 16_000_000 } : {},
  );
  const numPages = pdf.numPages;
  const { text } = await extractText(pdf, { mergePages: true });

  const images = [];
  const pdfImagesMeta = [];
  let sharp = null;
  if (!textOnly) {
    try {
      sharp = (await import('sharp')).default;
    } catch {
      // 没有 sharp 就只出文本：图片提取是增强项，上游同样是"失败不整体失败"。
      sharp = null;
    }
  }

  for (let pageNum = 1; sharp && pageNum <= numPages; pageNum += 1) {
    let pageImages;
    try {
      pageImages = await extractImages(pdf, pageNum);
    } catch {
      continue;
    }
    for (const imgData of pageImages) {
      try {
        const png = await sharp(Buffer.from(imgData.data), {
          raw: { width: imgData.width, height: imgData.height, channels: imgData.channels },
        }).png().toBuffer();
        const base64 = `data:image/png;base64,${png.toString('base64')}`;
        const imgId = `img_${images.length + 1}`;
        images.push(base64);
        pdfImagesMeta.push({
          id: imgId,
          src: base64,
          pageNumber: pageNum,
          width: imgData.width,
          height: imgData.height,
        });
      } catch {
        // 单张图转换失败不影响整篇（上游同）。
      }
    }
  }

  return {
    text,
    images,
    metadata: {
      pageCount: numPages,
      parser: 'unpdf',
      imageMapping: Object.fromEntries(pdfImagesMeta.map((m) => [m.id, m.src])),
      pdfImages: pdfImagesMeta,
    },
  };
}

/** source:pdf-providers.ts:729-820 */
async function parseWithMinerU(ctx, config, pdfBuffer, options) {
  if (!config.baseUrl) {
    throw invalidInput(
      '自建 MinerU 必须给 baseURL（部署地址），详见 https://github.com/opendatalab/MinerU',
      'baseUrl',
    );
  }
  const fileName = options.fileName || 'document.pdf';
  const mimeType = options.mimeType || 'application/pdf';

  const formData = new FormData();
  formData.append('files', new Blob([pdfBuffer], { type: mimeType }), fileName);
  formData.append('parse_method', 'auto');
  formData.append('backend', getMinerUBackend());
  formData.append('return_content_list', 'true');
  formData.append('return_images', 'true');

  const headers = config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {};

  let response;
  try {
    response = await ctx.fetch(`${config.baseUrl.replace(/\/+$/, '')}/file_parse`, {
      method: 'POST',
      redirect: 'manual',
      headers,
      body: formData,
      signal: config.signal,
    });
  } catch (error) {
    throw new MediaError('E_UPSTREAM_ERROR', '连不上自建 MinerU 服务，请检查 baseURL', {
      provider: 'mineru',
      retryable: true,
      cause: error?.message ?? String(error),
    });
  }

  if (!response.ok) {
    throw selfHostedMinerUFailure(response.status, await readBoundedErrorBody(response));
  }

  let json;
  try {
    json = await response.json();
  } catch {
    throw new MediaError('E_INVALID_RESPONSE', '自建 MinerU 返回的不是 JSON', { provider: 'mineru' });
  }

  // 响应形状：{ results: { "<fileName>": { md_content, images, content_list } } }
  const fileResult = json?.results?.[fileName];
  if (!fileResult) {
    const keys = json?.results ? Object.keys(json.results) : [];
    const fallback = keys.length > 0 ? json.results[keys[0]] : null;
    if (!fallback) throw new MediaError('E_INVALID_RESPONSE', 'MinerU 没有返回结果');
    return extractMinerUResult(fallback);
  }
  return extractMinerUResult(fileResult);
}

/** source:mineru-cloud.ts:252-285 —— 文件名只保留安全字符。 */
function sanitizeFileName(name) {
  const base = String(name || 'document.pdf').split(/[\\/]/).pop() ?? 'document.pdf';
  const cleaned = base.replace(/[^\w.\-\u4e00-\u9fa5]/g, '_');
  return cleaned || 'document.pdf';
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (signal?.aborted) reject(signal.reason ?? new MediaError('E_CANCELLED', '操作已取消'));
      else resolve();
    }, ms);
    // 不 unref：这个定时器是此刻唯一的活动句柄，unref 会让短命进程在轮询中途直接退出。
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason ?? new MediaError('E_CANCELLED', '操作已取消'));
    }, { once: true });
  });
}

/** source:mineru-cloud.ts:318-490 —— zip 结果 → ParsedPdfContent。 */
async function parseMinerUZip(ctx, zipUrl, signal) {
  const zipRes = await ctx.fetch(zipUrl, { signal });
  if (!zipRes.ok) throw upstreamError('MinerU Cloud ZIP', zipRes.status, '');
  const zipBuf = Buffer.from(await zipRes.arrayBuffer());

  let files;
  try {
    files = readZipEntries(zipBuf);
  } catch (error) {
    if (error instanceof MediaError) throw error;
    throw new MediaError('E_INVALID_RESPONSE', `MinerU Cloud ZIP 解析失败：${error?.message ?? error}`);
  }

  const paths = [...files.keys()];
  const fullMdPath = paths.find((p) => /(^|\/)full\.md$/i.test(p));
  const contentListPath = paths.find((p) => p.endsWith('_content_list.json') || /(^|\/)content_list\.json$/i.test(p));
  if (!fullMdPath) {
    throw new MediaError('E_INVALID_RESPONSE', `MinerU Cloud ZIP 里没有 full.md（含 ${paths.slice(0, 10).join(', ')}）`);
  }

  const markdown = files.get(fullMdPath).toString('utf8');
  const dirPrefix = fullMdPath.includes('/') ? fullMdPath.slice(0, fullMdPath.lastIndexOf('/') + 1) : '';
  const contentList = contentListPath
    ? JSON.parse(files.get(contentListPath).toString('utf8'))
    : undefined;

  // 图片按 `images/` 前缀与 full.md 同目录两种命名收集，MIME 由扩展名定。
  const imageData = {};
  for (const [path, data] of files.entries()) {
    if (!/\.(png|jpe?g|webp|gif|bmp)$/i.test(path)) continue;
    const ext = path.split('.').pop().toLowerCase();
    const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png';
    const relative = path.startsWith(dirPrefix) ? path.slice(dirPrefix.length) : path;
    imageData[relative] = `data:${mime};base64,${data.toString('base64')}`;
  }

  return extractMinerUResult({
    md_content: markdown,
    images: imageData,
    content_list: contentList,
  });
}

/** source:mineru-cloud.ts:491-700 */
async function parseWithMinerUCloud(ctx, config, pdfBuffer, sourceFileName) {
  const token = config.apiKey;
  if (!token) throw notConfigured('PDF 解析', 'mineru-cloud');

  const apiRoot = (config.baseUrl || MINERU_CLOUD_DEFAULT_BASE).replace(/\/+$/, '');
  const fileName = sanitizeFileName(sourceFileName);

  // 1) 建批次，拿预签名上传地址
  const batchRes = await ctx.fetch(`${apiRoot}/file-urls/batch`, {
    method: 'POST',
    redirect: 'manual',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      files: [{ name: fileName }],
      enable_formula: true,
      enable_table: true,
      model_version: 'vlm',
      language: 'ch',
    }),
    signal: config.signal,
  });
  if (!batchRes.ok) throw upstreamError('MinerU Cloud', batchRes.status, await readBoundedErrorBody(batchRes));
  const batch = await batchRes.json();
  const uploadUrls = batch.file_urls ?? batch.files;
  if (!batch.batch_id || !uploadUrls?.length) {
    throw new MediaError('E_INVALID_RESPONSE', 'MinerU Cloud 批次响应缺少 batch_id 或上传地址');
  }

  // 2) 上传（预签名 URL 对请求头敏感，刻意不带 Content-Type）
  const putRes = await ctx.fetch(uploadUrls[0], {
    method: 'PUT',
    redirect: 'manual',
    body: pdfBuffer,
    signal: config.signal,
  });
  if (!putRes.ok) {
    await putRes.body?.cancel().catch(() => undefined);
    throw upstreamError('MinerU Cloud 上传', putRes.status, '');
  }

  await sleep(1500, config.signal);

  // 3) 轮询
  const deadline = Date.now() + MINERU_CLOUD_POLL_MAX_MS;
  let lastState = '';
  while (Date.now() < deadline) {
    const statusRes = await ctx.fetch(`${apiRoot}/extract-results/batch/${batch.batch_id}`, {
      redirect: 'manual',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: config.signal,
    });
    if (!statusRes.ok) throw upstreamError('MinerU Cloud', statusRes.status, await readBoundedErrorBody(statusRes));
    const statusData = await statusRes.json();

    const rows = statusData.extract_result;
    const list = Array.isArray(rows) ? rows : rows ? [rows] : [];
    const row =
      list.find((r) => r.file_name === fileName)
      || list.find((r) => r.file_name?.toLowerCase() === fileName.toLowerCase())
      || list[0];

    if (row?.state && row.state !== lastState) lastState = row.state;
    if (row?.state === 'failed') {
      throw new MediaError('E_UPSTREAM_ERROR', `MinerU Cloud 解析失败：${row.err_msg ?? ''}`, {
        provider: 'mineru-cloud',
        retryable: false,
      });
    }
    if (row?.state === 'done' && row.full_zip_url) {
      return parseMinerUZip(ctx, row.full_zip_url, config.signal);
    }
    await sleep(MINERU_CLOUD_POLL_INTERVAL_MS, config.signal);
  }
  throw new MediaError('E_UPSTREAM_ERROR', `MinerU Cloud 轮询超时（${MINERU_CLOUD_POLL_MAX_MS / 1000}s）`, {
    provider: 'mineru-cloud',
    retryable: true,
  });
}

/** source:alidocmind-client.ts:123-216 的入口形状（实现依赖 SDK） */
async function parseWithAliDocMind(ctx, config, documentBuffer, options) {
  let sdk;
  try {
    sdk = await import('@alicloud/docmind-api20220711');
  } catch {
    throw dependencyMissing(
      '@alicloud/docmind-api20220711',
      'PDF 解析（AliDocMind）',
      'npm i @alicloud/docmind-api20220711 @alicloud/openapi-client',
    );
  }
  const { default: Client } = sdk;
  if (!config.accessKeyId || !config.accessKeySecret) {
    throw notConfigured('PDF 解析', 'alidocmind', 'AliDocMind 需要 accessKeyId + accessKeySecret');
  }
  if (!config.baseUrl) throw invalidInput('AliDocMind 必须给 endpoint', 'baseUrl');

  const client = new Client({ accessKeyId: config.accessKeyId, accessKeySecret: config.accessKeySecret, endpoint: config.baseUrl });
  const submit = await client.submitDocDocumentExtractJob({
    fileName: options.fileName || 'document.pdf',
    fileUrl: '', // 上游用 OSS 直传；这里退化成"提交后再 PUT"，SDK 版本差异由部署方保证
    llmEnhancement: true,
  });
  void submit;
  void documentBuffer;
  void ctx;
  throw new MediaError(
    'E_UNSUPPORTED_PROVIDER',
    'AliDocMind 的 submit→poll→get 流程需要 SDK 具体版本的请求/响应类型，本包只保留了分支与依赖探测',
    { provider: 'alidocmind', hint: '需要完整实现时，按 alidocmind-client.ts:123-300 补齐调用参数' },
  );
}

/**
 * 解析 PDF。source:pdf-providers.ts:303-357 —— key 校验、分支、processingTime 全保留。
 *
 * @param {{fetch: Function}} ctx
 * @param {{providerId: string, apiKey?: string, baseUrl?: string, accessKeyId?: string,
 *          accessKeySecret?: string, textOnly?: boolean, signal?: AbortSignal}} config
 * @param {Buffer} pdfBuffer
 * @param {{fileName?: string, mimeType?: string}} [options]
 */
export async function parsePDF(ctx, config, pdfBuffer, options = {}) {
  const meta = PDF_PROVIDERS[config.providerId];
  if (!meta) throw unsupportedProvider('PDF 解析', config.providerId, Object.keys(PDF_PROVIDERS));
  if (!Buffer.isBuffer(pdfBuffer) && !(pdfBuffer instanceof Uint8Array)) {
    throw invalidInput('parsePdf(buffer) 需要 Buffer', 'buffer');
  }
  if (pdfBuffer.byteLength === 0) throw invalidInput('parsePdf(buffer) 收到了空文件', 'buffer');

  if (meta.requiresApiKey && !config.apiKey) {
    const hasAkPair = Boolean(config.accessKeyId && config.accessKeySecret);
    if (config.providerId !== 'alidocmind' || !hasAkPair) throw notConfigured('PDF 解析', config.providerId);
  }

  const startTime = Date.now();
  const buffer = Buffer.isBuffer(pdfBuffer) ? pdfBuffer : Buffer.from(pdfBuffer);
  let result;

  switch (config.providerId) {
    case 'unpdf':
      result = await parseWithUnpdf(buffer, config.textOnly === true);
      break;
    case 'mineru':
      result = await parseWithMinerU(ctx, config, buffer, options);
      break;
    case 'mineru-cloud':
      result = await parseWithMinerUCloud(ctx, config, buffer, options.fileName);
      break;
    case 'alidocmind':
      result = await parseWithAliDocMind(ctx, config, buffer, options);
      break;
    default:
      throw unsupportedProvider('PDF 解析', config.providerId, Object.keys(PDF_PROVIDERS));
  }

  if (result.metadata) result.metadata.processingTime = Date.now() - startTime;
  return result;
}
