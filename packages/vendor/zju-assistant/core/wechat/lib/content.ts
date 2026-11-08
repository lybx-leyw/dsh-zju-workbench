/**
 * WeChat message payloads: the XML of app, media and system messages, and the small protobuf records kept beside them.
 * A port of the former Python parser (chat_content.py and the helpers it took from metadata.py); results are the same.
 */
import { zstdDecompressSync } from 'node:zlib'
import { parseXml, type XmlElement } from './xml.ts'
import { ascii, lstrip, or, pyInt, utf8, utf8Replace, truthy, str, type JsonObject, type Value } from './values.ts'

const TYPES = new Map<number, string>([[1, 'text'], [3, 'image'], [34, 'voice'], [42, 'contact'], [43, 'video'], [47, 'sticker'],
  [48, 'location'], [49, 'app'], [50, 'call'], [62, 'video'], [10000, 'system'], [10002, 'system']])
const APP_TYPES = new Map<number, string>([[1, 'text'], [4, 'link'], [5, 'link'], [6, 'file'], [8, 'sticker'], [19, 'forward'],
  [33, 'miniapp'], [36, 'miniapp'], [51, 'channel'], [57, 'quote'], [62, 'system'], [2000, 'transfer'], [2001, 'red_packet']])
/** Item types inside a merged forward (recordinfo/datalist/dataitem@datatype). */
const RECORD_TYPES = new Map<number, string>([[1, 'text'], [2, 'image'], [3, 'voice'], [4, 'video'], [5, 'link'], [6, 'location'], [8, 'file'], [17, 'forward']])

/** Every value of --type, in the order the help lists them. */
export const MESSAGE_TYPES = ['text', 'image', 'voice', 'video', 'file', 'link', 'quote', 'forward', 'miniapp', 'channel', 'contact',
  'location', 'sticker', 'call', 'system', 'transfer', 'red_packet', 'app', 'unknown']

const ZSTD = [0x28, 0xb5, 0x2f, 0xfd]

/** A message payload as text: zstd-compressed and plain bytes are UTF-8 (invalid bytes become U+FFFD); anything else is "". */
export function decodeContent(value: Value | undefined): string {
  if (value instanceof Uint8Array) {
    try {
      const bytes = ZSTD.every((byte, at) => value[at] === byte) ? zstdDecompressSync(value) : value
      return utf8Replace(bytes)
    } catch {
      return ''
    }
  }
  return typeof value === 'string' ? value : ''
}

/** The last second the former parser could convert on Windows (its gmtime limit); later values had no time. */
const LAST_SECOND = 32536850399n
const pad = (value: number, width = 2) => String(value).padStart(width, '0')

/** Seconds since the epoch as a UTC+8 ISO time, or null for anything that is not a positive whole number. */
export function timestamp(value: unknown): string | null {
  const seconds = pyInt(value)
  if (seconds === null || BigInt(seconds) <= 0n || BigInt(seconds) > LAST_SECOND) return null
  const date = new Date((Number(seconds) + 8 * 3600) * 1000)
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}+08:00`
}

/** One protobuf field: a varint, or the raw bytes of a fixed64, length-delimited or fixed32 field. */
export type Field = [number, number | bigint | Uint8Array]

/** The top-level fields of a protobuf message in order. Malformed input throws, which fails the whole query. */
export function protobuf(data: Uint8Array): Field[] {
  const fields: Field[] = []
  let offset = 0
  const varint = (): number | bigint => {
    let value = 0n
    for (let shift = 0n; shift < 70n; shift += 7n) {
      if (offset >= data.length) throw new RangeError('Truncated protobuf integer')
      const byte = data[offset++]!
      value |= BigInt(byte & 127) << shift
      if (byte < 128) return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value
    }
    throw new RangeError('Invalid protobuf integer')
  }
  while (offset < data.length) {
    const tag = BigInt(varint())
    const number = Number(tag >> 3n), wire = Number(tag & 7n)
    if (!number) throw new RangeError('Invalid protobuf field')
    if (wire === 0) {
      fields.push([number, varint()])
    } else if (wire === 1 || wire === 2 || wire === 5) {
      const size = wire === 2 ? Number(varint()) : wire === 1 ? 8 : 4
      const value = data.subarray(offset, offset + size)
      offset += size
      if (value.length !== size) throw new RangeError('Truncated protobuf field')
      fields.push([number, value])
    } else {
      throw new RangeError('Unsupported protobuf wire type')
    }
  }
  return fields
}

/** dict(protobuf(data)): the last value of each field number. */
export const fieldMap = (data: Uint8Array) => new Map(protobuf(data))

/** Bytes as Python sees them for `buffer or b""`: missing is empty, and anything that is not bytes cannot be parsed. */
function bytesOf(value: unknown): Uint8Array {
  if (value === null || value === undefined) return new Uint8Array()
  if (value instanceof Uint8Array) return value
  if (!truthy(value)) return new Uint8Array()
  throw new TypeError('Expected bytes')
}

/** Group nicknames from chat_room.ext_buffer: field 1 holds members, each with username (1) and nickname (2). */
export function groupNicknames(buffer: Value | undefined): Map<string, string> {
  const result = new Map<string, string>()
  for (const [number, value] of protobuf(bytesOf(buffer))) {
    if (number !== 1 || !(value instanceof Uint8Array)) continue
    const member = fieldMap(value)
    const id = member.get(1)
    if (!(id instanceof Uint8Array)) continue
    const nickname = member.get(2) ?? new Uint8Array()
    if (!(nickname instanceof Uint8Array)) throw new TypeError('Nickname is not bytes')
    result.set(utf8(id), utf8(nickname))
  }
  return result
}

/** Standalone 32-character lowercase hex digests in a binary record (media MD5s kept in packed_info_data). */
export function hashes(buffer: Value | undefined): string[] {
  const text = Buffer.from(bytesOf(buffer)).toString('latin1')
  return text.match(/(?<![a-f0-9])[a-f0-9]{32}(?![a-f0-9])/g) ?? []
}

/** A resource that `chat download` may extract. Fields beginning with "_" never reach the output. */
export interface MediaRef { kind: string; name: string; hashes: string[]; [key: string]: unknown }
export type Message = JsonObject & { _media?: MediaRef[]; items?: Message[]; reference?: Message }

const attachment = (kind: string, name = '', md5: string | null = null, extra: JsonObject = {}): MediaRef =>
  ({ kind, name, hashes: truthy(md5) ? [md5!] : [], ...extra })

/** Python's `int(x)` that yields None on failure, as the former number() helper. */
const number = (value: unknown) => pyInt(value)

/** The items of a merged-forward record, expanded up to 12 levels; `prefix` addresses nested resources on disk. */
function forwarded(record: string | XmlElement | null, depth: number, prefix = ''): Message[] {
  const root = typeof record === 'string' ? parseXml(record) : record
  if (!root) return []
  return root.findall('./datalist/dataitem').map((item, index) => {
    const resourceIndex = prefix + String(index)
    const datatype = number(item.get('datatype'))
    const kind = (typeof datatype === 'number' ? RECORD_TYPES.get(datatype) : undefined) ?? 'app'
    const entry: Message = {
      type: kind,
      text: or(item.findtext('datadesc'), null),
      title: or(item.findtext('datatitle'), null),
      sender: { name: or(item.findtext('sourcename'), '') },
      sentAt: timestamp(item.findtext('dataitemsource/srcMsgCreateTime')),
      serverId: or(item.findtext('dataitemsource/fromnewmsgid'), item.findtext('fromnewmsgid')),
    }
    if (kind === 'forward' && depth < 12) {
      const nested = item.find('recordxml/recordinfo') ?? parseXml(item.findtext('recordxml'))
      entry.items = forwarded(nested, depth + 1, resourceIndex + '_')
    } else if (['image', 'voice', 'video', 'file'].includes(kind)) {
      entry._media = [attachment(kind, String(or(entry.title, '')), item.findtext('fullmd5'),
        { size: number(item.findtext('datasize')), format: item.findtext('datafmt'), index: resourceIndex })]
    } else if (kind === 'link') {
      entry.url = or(item.findtext('weburlitem/link'), item.findtext('datadesc'))
    }
    return entry
  })
}

const kindOf = (types: Map<number, string>, value: number | bigint, fallback: string) =>
  (typeof value === 'number' ? types.get(value) : undefined) ?? fallback

/**
 * Type, text and metadata of one message. rawType is local_type: the low 32 bits are the base type, and app messages
 * (49) carry their app subtype in the high bits. Payment amounts, AES keys and other credentials are never returned.
 */
export function parseContent(rawType: number | bigint, content: string, depth = 0): Message {
  const raw = BigInt(rawType)
  const base = Number(BigInt.asUintN(32, raw))
  let subtype: number | bigint = raw >> 32n
  subtype = subtype >= BigInt(Number.MIN_SAFE_INTEGER) && subtype <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(subtype) : subtype
  let kind = base === 49 ? kindOf(APP_TYPES, subtype, 'app') : kindOf(TYPES, base, 'unknown')
  const result: Message = { type: kind, text: null, contentStatus: 'metadata_only' }
  if (base === 1) return { type: 'text', text: content, contentStatus: content ? 'parsed' : 'empty_or_unreadable' }
  const root = parseXml(content)
  if (!root) {
    if (kind === 'system' && !lstrip(content).startsWith('<')) {
      result.text = content
      result.contentStatus = 'parsed'
    } else if (kind === 'unknown') {
      result.contentStatus = 'unsupported'
    }
    return result
  }
  const app = root.tag === 'appmsg' ? root : root.find('.//appmsg')
  if (base === 49 && app) {
    subtype = or(number(app.findtext('type')), subtype) as number | bigint
    kind = kindOf(APP_TYPES, subtype, 'app')
    Object.assign(result, { type: kind, appType: subtype, title: or(app.findtext('title'), ''), description: or(app.findtext('des'), ''), contentStatus: 'parsed' })
    result.summary = or(result.title, result.description)
    if (['link', 'miniapp', 'channel'].includes(kind)) result.url = or(app.findtext('url'), null)
    if (kind === 'quote') {
      result.text = result.title
      const ref = app.find('refermsg')
      if (ref && depth < 12) {
        result.reference = {
          ...parseContent(or(number(ref.findtext('type')), 1) as number | bigint, String(or(ref.findtext('content'), '')), depth + 1),
          serverId: ref.findtext('svrid'),
          sender: { id: ref.findtext('fromusr'), name: ref.findtext('displayname') },
          sentAt: timestamp(ref.findtext('createtime')),
        }
      }
    } else if (kind === 'forward') {
      result.items = forwarded(String(or(app.findtext('recorditem'), '')), depth)
    } else if (kind === 'file') {
      const file = { name: result.title, size: number(app.findtext('appattach/totallen')), extension: app.findtext('appattach/fileext') }
      result.file = file
      result._media = [attachment(kind, str(result.title), app.findtext('md5'), { size: file.size })]
    } else if (kind === 'miniapp') {
      result.miniapp = { username: app.findtext('weappinfo/username'), appId: app.findtext('weappinfo/appid'), page: app.findtext('weappinfo/pagepath') }
    } else if (kind === 'transfer' || kind === 'red_packet') {
      result.payment = { amount: app.findtext('wcpayinfo/feedesc'), memo: app.findtext('wcpayinfo/pay_memo'), subtype: number(app.findtext('wcpayinfo/paysubtype')) }
    } else if (subtype === 62) {
      result.text = or(result.title, app.findtext('patinfo/template'))
    } else if (kind === 'text') {
      result.text = result.title
    }
    return result
  }
  const tags: Record<string, string> = { image: 'img', voice: 'voicemsg', video: 'videomsg', sticker: 'emoji', location: 'location' }
  const element = Object.hasOwn(tags, kind) ? root.find('.//' + tags[kind]) : null
  if (element) {
    const attrs = element.attrib
    const get = (name: string) => attrs.get(name) ?? null
    if (['image', 'voice', 'video', 'sticker'].includes(kind)) {
      const media = {
        size: number(or(get('length'), get('len'))),
        durationMs: kind === 'voice' ? number(get('voicelength'))
          : kind === 'video' ? multiply(or(number(get('playlength')), 0) as number | bigint, 1000) : null,
      }
      result.media = media
      result._media = [attachment(kind, '', or(get('md5'), get('voicemd5')), media)]
    } else {
      result.location = Object.fromEntries(['x', 'y', 'label', 'poiname', 'scale'].map(key => [key, get(key)]))
    }
    result.contentStatus = 'parsed'
  } else if (kind === 'contact') {
    result.contact = Object.fromEntries(['username', 'nickname', 'alias', 'province', 'city', 'sex', 'signature'].map(key => [key, root.get(key)]))
    result.contentStatus = 'parsed'
  } else if (kind === 'system' || kind === 'call') {
    result.text = or(root.findtext('.//replacemsg'), root.findtext('.//content'), root.findtext('.//VoIPBubbleMsg/msg'))
    result.contentStatus = truthy(result.text) ? 'parsed' : 'metadata_only'
  }
  return result
}

/** An integer product that keeps every digit. */
function multiply(value: number | bigint, factor: number): number | bigint {
  const product = BigInt(value) * BigInt(factor)
  return product <= BigInt(Number.MAX_SAFE_INTEGER) && product >= BigInt(Number.MIN_SAFE_INTEGER) ? Number(product) : product
}

/** All searchable text of a message: its own fields, the quoted message and every forwarded item. */
export function textContent(value: Message): string {
  const parts = ['text', 'title', 'description', 'summary', 'url'].map(key => truthy(value[key]) ? str(value[key]) : '')
  if (truthy(value.reference)) parts.push(textContent(value.reference!))
  for (const item of value.items ?? []) parts.push(textContent(item))
  return parts.join('\n')
}

/** Every downloadable resource of a message, its quote and forwarded items, with the forward record id they live under. */
export function mediaItems(value: Message, record: unknown = null): MediaRef[] {
  const owner = or(value._record, record)
  const result: MediaRef[] = (value._media ?? []).map(item => ({ ...item, serverId: value.serverId ?? null, record: owner }))
  if (truthy(value.reference)) result.push(...mediaItems(value.reference!, owner))
  for (const item of value.items ?? []) result.push(...mediaItems(item, owner))
  return result
}

/** The record id of a merged forward: field 9 of packed_info_data holds a record whose field 1 is its ASCII id. */
export function forwardRecord(packed: Value | undefined): string {
  const outer = fieldMap(bytesOf(packed)).get(9) ?? new Uint8Array()
  if (!(outer instanceof Uint8Array)) throw new TypeError('Record is not bytes')
  const inner = fieldMap(outer).get(1) ?? new Uint8Array()
  if (!(inner instanceof Uint8Array)) throw new TypeError('Record id is not bytes')
  return ascii(inner)
}
