/** Visible text and selected metadata of a message; never raw auth or media payloads. */
import { eqNum, get, int, isObject, or, parseJson, str, truthy, type JsonObject, type Row } from './values.ts'

const TYPES = new Map<number, string>([
  [1, 'text'], [2, 'image'], [3, 'voice'], [102, 'link'], [202, 'video'],
  [300, 'card'], [500, 'file'], [501, 'file'], [1101, 'call'],
  [1200, 'markdown'], [1201, 'markdown'], [1202, 'markdown'], [1400, 'markdown'],
  [1500, 'forward'], [1600, 'ding'], [2900, 'card'], [2950, 'card'], [3100, 'richtext'],
])
export const MESSAGE_TYPES = [...new Set([...TYPES.values(), 'system', 'unknown'])].sort()

export interface Attachment { name?: unknown; size?: unknown; extension?: unknown; duration?: unknown; width?: unknown; height?: unknown }
export interface Content {
  type: string
  rawType: string
  text: string
  contentStatus: string
  attachments?: Attachment[]
  reference?: { messageId: string; senderId: string | null; contentStatus: 'id_only' }
}

/** A JSON object, or the object a JSON string holds; anything else is empty. */
function objectValue(value: unknown): JsonObject {
  if (isObject(value)) return value
  const parsed = parseJson(truthy(value) ? value : '{}')
  return isObject(parsed) ? parsed : {}
}

const TEXT_KEYS = ['text', 'markdown', 'title', 'summary', 'desc', 'description', 'f_name',
  'fileName', 'filename', 'dingContent', 'biz_custom_title', 'biz_custom_desc',
  'interactiveCardLastMessage', 'b_tl', 'h_tl']
const I18N_KEYS = ['LastMessageI18n', 'i18n_summary', 'i18n_title']
const LOCALES = ['zh_CN', 'zh_TW', 'en_US']

/** Known display fields and rich-text containers; no arbitrary JSON traversal. */
function visibleText(value: unknown, depth = 0): string[] {
  if (depth > 16) return []
  if (Array.isArray(value)) return value.flatMap(entry => visibleText(entry, depth + 1))
  if (!isObject(value)) return []
  const result: string[] = []
  const add = (texts: string[]) => { for (const text of texts) result.push(text) }
  for (const key of TEXT_KEYS) {
    const item = get(value, key)
    if (typeof item === 'string' && item) result.push(item)
    else if (key === 'text' && isObject(item)) add(visibleText(item, depth + 1))
  }
  for (const key of I18N_KEYS) {
    const values = objectValue(get(value, key))
    const text = LOCALES.map(locale => get(values, locale)).find(item => typeof item === 'string' && item)
    if (typeof text === 'string') result.push(text)
  }
  // Prefer v2 rich text over the legacy payload, which repeats the same body.
  for (const key of ['items', 'contents', 'data', 'value', 'textRuns', 'b_form', truthy(get(value, 'payloadV2')) ? 'payloadV2' : 'payload']) {
    const item = get(value, key)
    add(visibleText(typeof item === 'string' ? objectValue(item) : item, depth + 1))
  }
  const fallback = get(value, 'fallbackText')
  if (!result.length && typeof fallback === 'string') result.push(fallback)
  // OA form labels and values are visible fields inside b_form.
  if (Object.keys(value).every(key => key === 'k' || key === 'v')) {
    for (const key of ['k', 'v']) { const item = get(value, key); if (typeof item === 'string') result.push(item) }
  }
  return result
}

const METADATA: [string, keyof Attachment][] = [['f_name', 'name'], ['fileName', 'name'], ['f_size', 'size'],
  ['f_type', 'extension'], ['duration', 'duration'], ['width', 'width'], ['height', 'height']]

export function parseContent(row: Row): Content {
  const rawType = int(or(row.contentType, 0))
  const kind = eqNum(row.type, 3) ? 'system' : TYPES.get(rawType) ?? 'unknown'
  const result: Content = { type: kind, rawType: str(rawType), text: '', contentStatus: 'metadata_only' }
  if (truthy(row.recallStatus)) return { ...result, text: '[消息已撤回]', contentStatus: 'recalled' }
  if (truthy(row.shieldStatus)) return { ...result, text: '[消息已屏蔽]', contentStatus: 'shielded' }
  if (!eqNum(row.isDecrypt, 1)) return { ...result, text: '[本地消息尚未解密]', contentStatus: 'encrypted' }
  const content = objectValue(row.content)
  const extension = objectValue(row.extension)
  const parts = visibleText(content)
  const attachments = get(content, 'attachments')
  const metadata: Attachment[] = []
  for (const attachment of Array.isArray(attachments) ? attachments : []) {
    if (!isObject(attachment)) continue
    const detail = objectValue(get(attachment, 'extension'))
    parts.push(...visibleText(detail))
    const item: Attachment = {}
    for (const [source, target] of METADATA) {
      const value = get(detail, source)
      if (['string', 'number', 'bigint', 'boolean'].includes(typeof value)) item[target] = value
    }
    if (Object.keys(item).length) metadata.push(item)
  }
  if (!parts.length) parts.push(...visibleText(extension))
  // Drop repeated strings, keeping reading order.
  result.text = [...new Set(parts)].join('\n')
  if (result.text) result.contentStatus = kind === 'forward' ? 'summary_only' : 'parsed'
  else if (!truthy(content)) result.contentStatus = 'empty_or_unsupported'
  if (metadata.length) result.attachments = metadata
  if (truthy(get(extension, 'sourceMessageId'))) {
    const sender = get(extension, 'sourceSenderId')
    result.reference = { messageId: str(get(extension, 'sourceMessageId')), senderId: truthy(sender) ? str(sender) : null, contentStatus: 'id_only' }
  }
  return result
}
