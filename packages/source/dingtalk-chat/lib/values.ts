/**
 * Value rules the reader relies on. Until 2026-10-16 the reader was a Python script, and its results are kept:
 * Python truthiness for "a or b", str() of database values, matching close to str.casefold(), string order by
 * code point, and 64-bit integers that keep every digit.
 */

/** A value as read from SQLite (integers beyond 2^53 stay bigint). */
export type Value = null | number | bigint | string | Uint8Array
export type Row = Record<string, Value>
export type JsonObject = { [key: string]: unknown }
/** A sort key compared element by element, like a Python tuple. */
export type Key = (number | string)[]

export const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Uint8Array)

/** An own property only, so a key such as "constructor" never reaches Object.prototype. */
export const get = (object: JsonObject, key: string): unknown => Object.hasOwn(object, key) ? object[key] : undefined

/** Python truthiness: None, zero and empty strings, lists and objects are false. */
export function truthy(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (typeof value === 'string' || Array.isArray(value)) return value.length > 0
  if (value instanceof Uint8Array) return value.byteLength > 0
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

/** Python's int() of a database value; throws for anything that is not a whole number. */
export function int(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === 'bigint' || typeof value === 'boolean') return Number(value)
  if (typeof value === 'string' && /^\s*[+-]?\d+\s*$/.test(value)) return Number(value)
  throw new TypeError('Not an integer')
}

/** Python's `value == n` for a small integer n, true for the number or bigint form and nothing else. */
export const eqNum = (value: unknown, n: number): boolean =>
  (typeof value === 'number' && value === n) || (typeof value === 'bigint' && value === BigInt(n))

/** A database integer as bigint; null and undefined are zero. */
export const toBig = (value: unknown): bigint =>
  typeof value === 'bigint' ? value : typeof value === 'number' ? BigInt(Math.trunc(value)) : value === null || value === undefined ? 0n : BigInt(String(value))

/** Case-insensitive form for matching. Upper then lower folds ß to ss and final sigma to sigma, as casefold() does. */
export const casefold = (text: string) => text.toUpperCase().toLowerCase()

/** Whether any value contains query as a literal, case-insensitive substring. Falsy values count as empty. */
export function contains(query: string, ...values: unknown[]): boolean {
  const needle = casefold(query)
  return values.some(value => casefold(truthy(value) ? str(value) : '').includes(needle))
}

/** Code point order (Python's string order); UTF-16 order differs between surrogates and U+E000..U+FFFF. */
export function compare(a: string, b: string): number {
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

export function compareKeys(a: Key, b: Key): number {
  for (let at = 0; at < Math.min(a.length, b.length); at++) {
    const x = a[at]!, y = b[at]!
    const order = typeof x === 'number' && typeof y === 'number' ? x - y : compare(String(x), String(y))
    if (order) return order
  }
  return a.length - b.length
}

/** Python's str.strip(): its whitespace set has U+001C..U+001F and U+0085, and no U+FEFF. */
const SPACE = '\\t\\n\\v\\f\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000'
const EDGES = new RegExp(`^[${SPACE}]+|[${SPACE}]+$`, 'g')
export const strip = (text: string) => text.replace(EDGES, '')

/** Length in code points, as Python counts it. */
export const codePoints = (text: string) => [...text].length

type Reviver = (this: unknown, key: string, value: unknown, context?: { source?: string }) => unknown
const INTEGER = /^-?\d+$/
/** Integers beyond 2^53 come back as bigint with every digit, as Python's json keeps them. */
const keepDigits: Reviver = (_key, value, context) =>
  typeof value === 'number' && !Number.isSafeInteger(value) && context?.source !== undefined && INTEGER.test(context.source) ? BigInt(context.source) : value

/** Python's json.loads for text or UTF-8 bytes; undefined when the value is not JSON. */
export function parseJson(value: unknown, reviver: Reviver = keepDigits): unknown {
  try {
    const text = value instanceof Uint8Array ? new TextDecoder('utf-8', { fatal: true }).decode(value) : value
    return typeof text === 'string' ? JSON.parse(text, reviver as Parameters<typeof JSON.parse>[1]) : undefined
  } catch {
    return undefined
  }
}

const { rawJSON } = JSON as unknown as { rawJSON(text: string): unknown }
/** Compact JSON; bigint values are written as plain numbers with every digit. */
export const stringify = (value: unknown) => JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? rawJSON(item.toString()) : item)

/** json.dumps(value, sort_keys=True, ensure_ascii=False) with its default separators, for keys that must not change. */
export function pythonJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(pythonJson).join(', ') + ']'
  if (isObject(value)) return '{' + Object.keys(value).sort(compare).map(key => JSON.stringify(key) + ': ' + pythonJson(value[key])).join(', ') + '}'
  return JSON.stringify(value)
}
