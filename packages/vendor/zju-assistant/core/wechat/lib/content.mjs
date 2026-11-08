import { parseDocument } from 'htmlparser2'
import { zstdDecompressSync } from 'node:zlib'
import { iso } from '../../chat/common.mjs'
const TYPES = {
  1: 'text',
  3: 'image',
  34: 'voice',
  42: 'contact',
  43: 'video',
  47: 'sticker',
  48: 'location',
  49: 'app',
  50: 'call',
  62: 'video',
  10000: 'system',
  10002: 'system'
}
const APP = {
  1: 'text',
  4: 'link',
  5: 'link',
  6: 'file',
  8: 'sticker',
  19: 'forward',
  33: 'miniapp',
  36: 'miniapp',
  51: 'channel',
  57: 'quote',
  62: 'system',
  2000: 'transfer',
  2001: 'red_packet'
}
export const messageTypes = [...new Set([...Object.values(TYPES), ...Object.values(APP), 'unknown'])]
export function decodeContent(value) {
  if (typeof value === 'string') return value
  if (!(value instanceof Uint8Array)) return ''
  const bytes = Buffer.from(value)
  try {
    return (
      bytes.subarray(0, 4).equals(Buffer.from([0x28, 0xb5, 0x2f, 0xfd]))
        ? zstdDecompressSync(bytes, { maxOutputLength: 16 * 1024 * 1024 })
        : bytes
    ).toString('utf8')
  } catch {
    return ''
  }
}
export function protobuf(input) {
  const data = Buffer.from(input || []),
    result = []
  let offset = 0
  const varint = () => {
    let value = 0n
    for (let shift = 0n; shift < 70n; shift += 7n) {
      if (offset >= data.length) throw Error('Truncated protobuf')
      const byte = data[offset++]
      value |= BigInt(byte & 127) << shift
      if (byte < 128) return Number(value)
    }
    throw Error('Invalid protobuf')
  }
  while (offset < data.length) {
    const tag = varint(),
      field = Math.floor(tag / 8),
      wire = tag & 7
    if (!field) throw Error('Invalid protobuf')
    let value
    if (wire === 0) value = varint()
    else if ([1, 2, 5].includes(wire)) {
      const size = wire === 2 ? varint() : wire === 1 ? 8 : 4
      if (!Number.isSafeInteger(size) || size < 0 || offset + size > data.length)
        throw Error('Truncated protobuf')
      value = data.subarray(offset, offset + size)
      offset += size
    } else throw Error('Unsupported protobuf')
    result.push([field, value])
  }
  return result
}
export function groupNicknames(buffer) {
  const result = new Map()
  for (const [field, value] of protobuf(buffer))
    if (field === 1 && Buffer.isBuffer(value)) {
      const member = new Map(protobuf(value))
      if (Buffer.isBuffer(member.get(1)))
        result.set(
          member.get(1).toString('utf8'),
          Buffer.isBuffer(member.get(2)) ? member.get(2).toString('utf8') : ''
        )
    }
  return result
}
export const hashes = (buffer) =>
  Buffer.from(buffer || [])
    .toString('latin1')
    .match(/(?<![a-f0-9])[a-f0-9]{32}(?![a-f0-9])/g) || []
const children = (root, name) => (root?.children || []).filter((n) => n.type === 'tag' && n.name === name)
function find(root, route) {
  let node = root
  for (const name of route.split('/')) node = children(node, name)[0]
  return node
}
function descendant(root, name) {
  if (root?.name === name) return root
  for (const node of root?.children || []) {
    const found = descendant(node, name)
    if (found) return found
  }
}
function textOf(root) {
  return (root?.children || []).map((n) => (n.type === 'text' ? n.data : textOf(n))).join('')
}
const text = (root, route) => textOf(find(root, route))
const xml = (value) =>
  typeof value === 'string' && value.trim().startsWith('<')
    ? parseDocument(value, { xmlMode: true, decodeEntities: true })
    : null
const num = (value) =>
  value !== '' && value != null && Number.isFinite(Number(value)) ? Number(value) : null
const attachment = (kind, name = '', md5, ...extra) => ({
  kind,
  name,
  hashes: md5 ? [md5] : [],
  ...Object.assign({}, ...extra)
})
function forwarded(record, depth, prefix = '') {
  const root = typeof record === 'string' ? descendant(xml(record), 'recordinfo') : record
  const kinds = {
    1: 'text',
    2: 'image',
    3: 'voice',
    4: 'video',
    5: 'link',
    6: 'location',
    8: 'file',
    17: 'forward'
  }
  return children(find(root, 'datalist'), 'dataitem').map((item, i) => {
    const type = kinds[item.attribs.datatype] || 'app',
      index = prefix + i
    const entry = {
      type,
      text: text(item, 'datadesc') || null,
      title: text(item, 'datatitle') || null,
      sender: { name: text(item, 'sourcename') },
      sentAt: iso(Number(text(item, 'dataitemsource/srcMsgCreateTime')) * 1000),
      serverId: text(item, 'dataitemsource/fromnewmsgid') || text(item, 'fromnewmsgid')
    }
    if (type === 'forward' && depth < 12)
      entry.items = forwarded(
        find(item, 'recordxml/recordinfo') || text(item, 'recordxml'),
        depth + 1,
        index + '_'
      )
    else if (['image', 'voice', 'video', 'file'].includes(type))
      entry._media = [
        attachment(type, entry.title || '', text(item, 'fullmd5'), {
          size: num(text(item, 'datasize')),
          format: text(item, 'datafmt'),
          index
        })
      ]
    else if (type === 'link') entry.url = text(item, 'weburlitem/link') || text(item, 'datadesc')
    return entry
  })
}
export function parseContent(rawType, content, depth = 0) {
  const raw = BigInt(rawType || 0),
    base = Number(raw & 0xffffffffn)
  let subtype = Number(raw >> 32n),
    kind = base === 49 ? APP[subtype] || 'app' : TYPES[base] || 'unknown'
  const result = { type: kind, text: null, contentStatus: 'metadata_only' }
  if (base === 1)
    return { ...result, text: content, contentStatus: content ? 'parsed' : 'empty_or_unreadable' }
  const root = xml(content)
  if (!root) {
    if (kind === 'system') return { ...result, text: content, contentStatus: 'parsed' }
    return { ...result, contentStatus: kind === 'unknown' ? 'unsupported' : 'metadata_only' }
  }
  const app = descendant(root, 'appmsg')
  if (base === 49 && app) {
    subtype = num(text(app, 'type')) || subtype
    kind = APP[subtype] || 'app'
    Object.assign(result, {
      type: kind,
      appType: subtype,
      title: text(app, 'title'),
      description: text(app, 'des'),
      contentStatus: 'parsed'
    })
    result.summary = result.title || result.description
    if (['link', 'miniapp', 'channel'].includes(kind)) result.url = text(app, 'url') || null
    if (kind === 'quote') {
      result.text = result.title
      const ref = find(app, 'refermsg')
      if (ref && depth < 12)
        result.reference = {
          ...parseContent(num(text(ref, 'type')) || 1, text(ref, 'content'), depth + 1),
          serverId: text(ref, 'svrid'),
          sender: { id: text(ref, 'fromusr'), name: text(ref, 'displayname') },
          sentAt: iso(Number(text(ref, 'createtime')) * 1000)
        }
    } else if (kind === 'forward') result.items = forwarded(text(app, 'recorditem'), depth)
    else if (kind === 'file') {
      result.file = {
        name: result.title,
        size: num(text(app, 'appattach/totallen')),
        extension: text(app, 'appattach/fileext')
      }
      result._media = [attachment(kind, result.title, text(app, 'md5'), { size: result.file.size })]
    } else if (['transfer', 'red_packet'].includes(kind))
      result.payment = {
        amount: text(app, 'wcpayinfo/feedesc'),
        memo: text(app, 'wcpayinfo/pay_memo'),
        subtype: num(text(app, 'wcpayinfo/paysubtype'))
      }
    else if (kind === 'text' || subtype === 62) result.text = result.title || text(app, 'patinfo/template')
    if (kind === 'miniapp')
      result.miniapp = {
        username: text(app, 'weappinfo/username'),
        appId: text(app, 'weappinfo/appid'),
        page: text(app, 'weappinfo/pagepath')
      }
    return result
  }
  const tag = { image: 'img', voice: 'voicemsg', video: 'videomsg', sticker: 'emoji', location: 'location' }[
      kind
    ],
    element = tag ? descendant(root, tag) : null
  if (element) {
    const a = element.attribs
    if (kind !== 'location') {
      result.media = {
        size: num(a.length || a.len),
        durationMs:
          kind === 'voice' ? num(a.voicelength) : kind === 'video' ? (num(a.playlength) || 0) * 1000 : null
      }
      result._media = [attachment(kind, '', a.md5 || a.voicemd5, result.media)]
    } else
      result.location = Object.fromEntries(
        ['x', 'y', 'label', 'poiname', 'scale'].map((k) => [k, a[k] || null])
      )
    result.contentStatus = 'parsed'
  } else if (kind === 'contact') {
    result.contact = Object.fromEntries(
      ['username', 'nickname', 'alias', 'province', 'city', 'sex', 'signature'].map((k) => [
        k,
        root.children.find((n) => n.type === 'tag')?.attribs[k] || null
      ])
    )
    result.contentStatus = 'parsed'
  } else if (['system', 'call'].includes(kind)) {
    result.text =
      textOf(descendant(root, 'replacemsg')) ||
      textOf(descendant(root, 'content')) ||
      text(descendant(root, 'VoIPBubbleMsg'), 'msg')
    result.contentStatus = result.text ? 'parsed' : 'metadata_only'
  }
  return result
}
export function textContent(value) {
  return [
    value.text,
    value.title,
    value.description,
    value.summary,
    value.url,
    value.reference ? textContent(value.reference) : '',
    ...(value.items || []).map(textContent)
  ]
    .filter(Boolean)
    .join('\n')
}
export function mediaItems(value, record) {
  record = value._record || record
  return [
    ...(value._media || []).map((item) => ({ ...item, serverId: value.serverId, record })),
    ...(value.reference ? mediaItems(value.reference, record) : []),
    ...(value.items || []).flatMap((item) => mediaItems(item, record))
  ]
}
