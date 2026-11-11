/**
 * Value rules the chat parser relies on. Until 2026-10-16 the parser was a Python script; its results are kept:
 * Python truthiness for "a or b", str() and int() of database and XML values, str.casefold() matching, string order
 * by code point, tuple comparison for cursors, and json.dumps(ensure_ascii=True) for anything hashed or printed.
 */

/** A value as read from SQLite (integers beyond 2^53 stay bigint). */
export type Value = null | number | bigint | string | Uint8Array
export type Row = Record<string, Value>
export type JsonObject = { [key: string]: unknown }

export const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Uint8Array)

/** Python truthiness: None, zero and empty strings, bytes, lists and objects are false. */
export function truthy(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (typeof value === 'string' || Array.isArray(value)) return value.length > 0
  if (value instanceof Uint8Array) return value.byteLength > 0
  if (value instanceof Map || value instanceof Set) return value.size > 0
  if (typeof value === 'object') return Object.keys(value).length > 0
  return Boolean(value)
}

/** Python's `a or b or c`: the first truthy value, else the last one. */
export function or<T extends unknown[]>(...values: T): T[number] {
  for (const value of values) if (truthy(value)) return value
  return values[values.length - 1]
}

/** Python's str() of a database or JSON value. */
export function str(value: unknown): string {
  if (value === null || value === undefined) return 'None'
  if (typeof value === 'boolean') return value ? 'True' : 'False'
  return String(value)
}

/** A bigint as a plain number when no digit is lost. */
export const small = (value: bigint): number | bigint =>
  value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value

/** Python's whitespace (str.isspace): it has U+001C..U+001F and U+0085, and no U+FEFF. */
const SPACE = '\\t\\n\\v\\f\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000'
const EDGES = new RegExp(`^[${SPACE}]+|[${SPACE}]+$`, 'g')
const LEADING = new RegExp(`^[${SPACE}]+`)
export const strip = (text: string) => text.replace(EDGES, '')
export const lstrip = (text: string) => text.replace(LEADING, '')

/** The value of a Unicode decimal digit. Decimal digits are always encoded in runs of ten, 0 to 9 (a Unicode stability rule). */
const DIGIT = /^\p{Nd}$/u
function digitValue(char: string): number {
  const code = char.codePointAt(0)!
  if (code >= 0x30 && code <= 0x39) return code - 0x30
  let run = 0
  while (run < 60 && DIGIT.test(String.fromCodePoint(code - run - 1))) run++
  return run % 10
}

const INT_TEXT = /^([+-]?)(\p{Nd}+(?:_\p{Nd}+)*)$/u
/**
 * Python's int() of a str, int or bool; null where Python raises (None, '', '1.0', '0x10', bytes and so on).
 * Strings allow surrounding whitespace, a sign, single underscores between digits and any Unicode decimal digits.
 */
export function pyInt(value: unknown): number | bigint | null {
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'bigint') return small(value)
  if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : null
  if (typeof value !== 'string') return null
  const match = INT_TEXT.exec(strip(value))
  if (!match) return null
  const digits = [...match[2]!.replaceAll('_', '')]
  if (digits.length > 4300) return null // Python's limit on int() of a decimal string.
  const text = digits.map(digit => String(digitValue(digit))).join('')
  return small(BigInt(match[1] === '-' ? '-' + text : text))
}

/** Python's int(value) where a failure aborts the whole query, as the former parser did. */
export function int(value: unknown): number | bigint {
  const result = pyInt(value)
  if (result === null) throw new TypeError('Not an integer')
  return result
}

/** Numbers and bigints compared without losing digits. */
export function compareNumbers(a: number | bigint, b: number | bigint): number {
  if (typeof a === 'number' && typeof b === 'number') return a < b ? -1 : a > b ? 1 : 0
  const x = typeof a === 'bigint' ? a : BigInt(a), y = typeof b === 'bigint' ? b : BigInt(b)
  return x < y ? -1 : x > y ? 1 : 0
}

/** Code point order (Python's string order); UTF-16 order differs between surrogates and U+E000..U+FFFF. */
export function compareText(a: string, b: string): number {
  if (a === b) return 0
  const length = Math.min(a.length, b.length)
  for (let at = 0; at < length; at++) {
    let x = a.charCodeAt(at), y = b.charCodeAt(at)
    if (x === y) continue
    if (x >= 0xd800) x += x < 0xe000 ? 0x2000 : -0x800
    if (y >= 0xd800) y += y < 0xe000 ? 0x2000 : -0x800
    return x - y
  }
  return a.length - b.length
}

/** A JSON number written with a fraction or exponent, which Python reads as a float rather than an int. */
export class Float {
  readonly value: number
  constructor(value: number) { this.value = value }
}

/** Python's numeric types for comparison: bool, int and float compare with each other. */
const numeric = (value: unknown): number | bigint | undefined =>
  typeof value === 'number' || typeof value === 'bigint' ? value
    : typeof value === 'boolean' ? Number(value)
      : value instanceof Float ? value.value : undefined

function pyEqual(a: unknown, b: unknown): boolean {
  const x = numeric(a), y = numeric(b)
  if (x !== undefined && y !== undefined) return compareNumbers(x, y) === 0
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((item, at) => pyEqual(item, b[at]))
  if (isObject(a) && isObject(b)) {
    const keys = Object.keys(a)
    return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && pyEqual(a[key], b[key]))
  }
  return a === b
}

/**
 * Python's ordering of two tuple elements or tuples: numbers with numbers, strings with strings, sequences element by
 * element. Anything else raises TypeError, which the cursor code reports as an invalid cursor.
 */
export function pyCompare(a: unknown, b: unknown): number {
  const x = numeric(a), y = numeric(b)
  if (x !== undefined && y !== undefined) return compareNumbers(x, y)
  if (typeof a === 'string' && typeof b === 'string') return compareText(a, b)
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let at = 0; at < Math.min(a.length, b.length); at++) {
      if (!pyEqual(a[at], b[at])) return pyCompare(a[at], b[at])
    }
    return a.length - b.length
  }
  throw new TypeError('Values cannot be ordered')
}

/** Characters whose str.casefold() is not upper-then-lower: dotless i stays, and Cherokee folds to its capitals. */
function foldChar(char: string): string {
  const code = char.codePointAt(0)!
  if (code === 0x131) return char
  if (code >= 0xab70 && code <= 0xabbf) return String.fromCodePoint(code - 0xab70 + 0x13a0)
  if (code >= 0x13f8 && code <= 0x13fd) return String.fromCodePoint(code - 8)
  if (code >= 0x13a0 && code <= 0x13f5) return char
  // One character at a time, so the final-sigma rule of toLowerCase() never applies; ß becomes ss, ς becomes σ.
  return char.toUpperCase().toLowerCase()
}

/** Python's str.casefold(). */
export function casefold(text: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7f]*$/.test(text)) return text.toLowerCase()
  let result = ''
  for (const char of text) result += foldChar(char)
  return result
}

/** Strict UTF-8, as Python's bytes.decode('utf-8'); a byte-order mark is kept. */
const strictUtf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
/** UTF-8 with U+FFFD for invalid bytes, as Python's bytes.decode('utf-8', errors='replace'). */
const lenientUtf8 = new TextDecoder('utf-8', { ignoreBOM: true })
export const utf8 = (bytes: Uint8Array) => strictUtf8.decode(bytes)
export const utf8Replace = (bytes: Uint8Array) => lenientUtf8.decode(bytes)

/** bytes.decode('ascii'): any byte above 0x7F raises. */
export function ascii(bytes: Uint8Array): string {
  if (bytes.some(byte => byte > 0x7f)) throw new TypeError('Not ASCII')
  return Buffer.from(bytes).toString('latin1')
}

const { rawJSON } = JSON as unknown as { rawJSON(text: string): unknown }
/** Every character outside printable ASCII as \uXXXX, as Python's ensure_ascii writes it. */
// eslint-disable-next-line no-control-regex
const escapeAscii = (json: string) => json.replace(/[\u007f-\uffff]/g, char => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'))

/** Compact JSON with only ASCII characters; bigints are written as plain numbers with every digit. */
export const asciiJson = (value: unknown) =>
  escapeAscii(JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? rawJSON(item.toString()) : item))

/** json.dumps(value, sort_keys=True, ensure_ascii=True) with its default separators, for values that are hashed. */
export function pythonJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(pythonJson).join(', ') + ']'
  if (isObject(value)) return '{' + Object.keys(value).sort(compareText).map(key => asciiJson(key) + ': ' + pythonJson(value[key])).join(', ') + '}'
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return asciiJson(value)
}

type Reviver = (this: unknown, key: string, value: unknown, context?: { source?: string }) => unknown
/** Integers beyond 2^53 come back as bigint with every digit and fractions as Float, as Python's json.loads keeps them apart. */
const pythonNumbers: Reviver = (_key, value, context) => {
  if (typeof value !== 'number' || context?.source === undefined) return value
  if (!/^-?\d+$/.test(context.source)) return new Float(value)
  return Number.isSafeInteger(value) ? value : BigInt(context.source)
}

/** json.loads: integers keep every digit and floats stay distinguishable from integers. */
export const parsePythonJson = (text: string): unknown => JSON.parse(text, pythonNumbers as Parameters<typeof JSON.parse>[1])
