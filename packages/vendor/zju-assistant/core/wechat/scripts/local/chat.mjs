import { Query } from '../../lib/query.mjs'
import { memoryDatabase, SkillError } from '../../../chat/common.mjs'
// Consume one authenticated image at a time; plaintext stays in memory.
let chunks = [],
  length = 0,
  nameSize = 0,
  imageSize = 0,
  result,
  error
const query = new Query(JSON.parse(Buffer.from(process.argv[2], 'base64')))
function take(size) {
  const result = Buffer.allocUnsafe(size)
  let at = 0
  while (at < size) {
    const chunk = chunks[0],
      n = Math.min(chunk.length, size - at)
    chunk.copy(result, at, 0, n)
    if (n === chunk.length) chunks.shift()
    else chunks[0] = chunk.subarray(n)
    at += n
  }
  length -= size
  return result
}
for await (const chunk of process.stdin) {
  if (error) continue
  chunks.push(chunk)
  length += chunk.length
  try {
    while (true) {
      if (!nameSize) {
        if (length < 8) break
        const header = take(8)
        nameSize = header.readUInt32LE(0)
        imageSize = header.readUInt32LE(4)
        if (nameSize < 1 || nameSize > 100 || imageSize < 4096 || imageSize > 512 * 1024 * 1024)
          throw Error('Invalid snapshot')
      }
      if (length < nameSize + imageSize) break
      const name = take(nameSize).toString('utf8'),
        image = take(imageSize)
      let db
      try {
        db = memoryDatabase(image)
        query.read(name, db)
      } finally {
        db?.close()
        image.fill(0)
      }
      nameSize = imageSize = 0
    }
  } catch (e) {
    error = e
    chunks = []
    length = 0
  }
}
try {
  if (error) throw error
  if (length || nameSize) throw Error('Incomplete snapshot')
  result = query.result()
} catch (e) {
  result =
    e instanceof SkillError
      ? e.result()
      : { ok: false, status: 'chat_schema_unsupported', message: '当前微信数据库结构或消息编码无法解析。' }
}
process.stdout.write(
  JSON.stringify(result).replace(
    /[\u007f-\uffff]/g,
    (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')
  )
)
