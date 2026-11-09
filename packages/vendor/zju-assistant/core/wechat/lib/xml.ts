/**
 * A small, strict XML reader with the part of Python's xml.etree.ElementTree that message parsing used. Until
 * 2026-10-16 messages were parsed by Python, whose expat parser rejects anything that is not well-formed; a lenient
 * HTML-style parser would turn such payloads into partial elements and change which messages count as parsed. So
 * this follows expat: one root element, defined entities only, valid characters and names, matching tags, bound
 * namespace prefixes. A DOCTYPE is skipped; of its internal subset only plain-text entity declarations are used.
 * Comments and processing instructions are checked and dropped, as ElementTree drops them. Only element text before
 * the first child (ElementTree's `text`) is kept.
 */

const XML_NAMESPACE = 'http://www.w3.org/XML/1998/namespace'
const PREDEFINED = new Map([['lt', '<'], ['gt', '>'], ['amp', '&'], ['apos', "'"], ['quot', '"']])

const START = 'A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C\\u200D\\u2070-\\u218F' +
  '\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD\\u{10000}-\\u{EFFFF}'
const NAME_CHAR = START + '\\-.0-9\\u00B7\\u0300-\\u036F\\u203F\\u2040'
/** An XML Name (colons allowed); namespace rules are checked separately. */
const NAME = new RegExp(`[:${START}][:${NAME_CHAR}]*`, 'uy')
const NCNAME = new RegExp(`^[${START}][${NAME_CHAR}]*$`, 'u')
/** Characters XML never allows, even escaped as a character reference. */
// eslint-disable-next-line no-control-regex
const INVALID = /[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]/
const SPACE = /[ \t\n]*/y
const DECLARATION = /<\?xml[ \t\n]+version[ \t\n]*=[ \t\n]*(?:"[A-Za-z0-9_.:-]+"|'[A-Za-z0-9_.:-]+')(?:[ \t\n]+encoding[ \t\n]*=[ \t\n]*(?:"[A-Za-z][A-Za-z0-9._-]*"|'[A-Za-z][A-Za-z0-9._-]*'))?(?:[ \t\n]+standalone[ \t\n]*=[ \t\n]*(?:"(?:yes|no)"|'(?:yes|no)'))?[ \t\n]*\?>/y

class NotWellFormed extends Error {}
const fail = (): never => { throw new NotWellFormed('not well-formed') }

/** One element: tag ("{uri}name" inside a namespace), attributes in document order, text before the first child. */
export class XmlElement {
  readonly tag: string
  readonly attrib: Map<string, string>
  text: string | null = null
  readonly children: XmlElement[] = []
  constructor(tag: string, attrib: Map<string, string>) {
    this.tag = tag
    this.attrib = attrib
  }

  /** An attribute value, or null when it is missing. */
  get(name: string): string | null { return this.attrib.get(name) ?? null }

  /** Elements matching a path such as "a/b", "./a/b" or ".//a/b", in document order. */
  findall(path: string): XmlElement[] {
    let context: XmlElement[] = [this]
    let descendants = false
    for (const step of path.split('/')) {
      if (step === '.') continue
      if (step === '') { descendants = true; continue }
      const next: XmlElement[] = []
      for (const element of context) {
        if (descendants) {
          // ElementPath's ".//name": every match below the element, never the element itself.
          for (const found of element.iter()) if (found !== element && found.tag === step) next.push(found)
        } else {
          for (const child of element.children) if (child.tag === step) next.push(child)
        }
      }
      context = next
      descendants = false
    }
    return context
  }

  find(path: string): XmlElement | null { return this.findall(path)[0] ?? null }

  /** The found element's text ("" when it has none), or null when nothing matches. */
  findtext(path: string): string | null {
    const found = this.find(path)
    return found ? found.text ?? '' : null
  }

  /** This element and every element below it, in document order. */
  *iter(): Generator<XmlElement> {
    const stack: XmlElement[] = [this]
    while (stack.length) {
      const element = stack.pop()!
      yield element
      for (let at = element.children.length - 1; at >= 0; at--) stack.push(element.children[at]!)
    }
  }
}

interface Open { element: XmlElement; name: string; scope: Map<string, string>; text: string; hasChild: boolean }

class Parser {
  private readonly source: string
  private at = 0
  private readonly entities = new Map<string, string>()

  constructor(source: string) { this.source = source }

  private startsWith(text: string) { return this.source.startsWith(text, this.at) }
  private space(): boolean {
    SPACE.lastIndex = this.at
    SPACE.exec(this.source)
    const moved = SPACE.lastIndex > this.at
    this.at = SPACE.lastIndex
    return moved
  }
  private name(): string {
    NAME.lastIndex = this.at
    const match = NAME.exec(this.source)
    if (!match) fail()
    this.at = NAME.lastIndex
    return match![0]
  }
  private expect(text: string) {
    if (!this.startsWith(text)) fail()
    this.at += text.length
  }
  /** Everything up to the terminator, which is consumed; a missing terminator is an error. */
  private until(terminator: string): string {
    const end = this.source.indexOf(terminator, this.at)
    if (end < 0) fail()
    const text = this.source.slice(this.at, end)
    this.at = end + terminator.length
    return text
  }
  private quoted(): string {
    const quote = this.source[this.at]
    if (quote !== '"' && quote !== "'") fail()
    this.at++
    return this.until(quote!)
  }

  private comment() {
    this.at += 4
    const body = this.until('--')
    if (this.source[this.at] !== '>' || body.endsWith('-')) fail()
    this.at++
  }

  private instruction() {
    this.at += 2
    const target = this.name()
    if (target.toLowerCase() === 'xml') fail() // A declaration anywhere but the very start.
    if (!this.space() && !this.startsWith('?>')) fail()
    this.until('?>')
  }

  /** A DOCTYPE: skipped, except that plain-text general entities of its internal subset become defined. */
  private doctype() {
    this.at += 9
    if (!this.space()) fail()
    this.name()
    this.space()
    if (this.startsWith('SYSTEM')) { this.at += 6; this.space(); this.quoted() }
    else if (this.startsWith('PUBLIC')) { this.at += 6; this.space(); this.quoted(); this.space(); this.quoted() }
    this.space()
    if (this.startsWith('[')) {
      this.at++
      for (;;) {
        this.space()
        if (this.startsWith(']')) { this.at++; break }
        if (this.startsWith('<!--')) this.comment()
        else if (this.startsWith('<?')) this.instruction()
        else if (this.startsWith('%')) { this.at++; this.name(); this.expect(';') }
        else if (this.startsWith('<!ENTITY')) this.entity()
        else if (this.startsWith('<!')) this.declaration()
        else fail()
      }
      this.space()
    }
    this.expect('>')
  }

  private entity() {
    this.at += 8
    if (!this.space()) fail()
    const parameter = this.startsWith('%')
    if (parameter) { this.at++; this.space() }
    const name = this.name()
    this.space()
    if (this.source[this.at] === '"' || this.source[this.at] === "'") {
      const value = this.quoted()
      // Character references are expanded where the entity is declared; the first declaration wins.
      if (!parameter && !this.entities.has(name)) this.entities.set(name, value.replace(/&#(x[0-9a-fA-F]+|[0-9]+);/g, (_m, code: string) => this.character(code)))
    } else {
      this.declaration() // An external entity: never fetched, so a reference to it stays undefined.
      return
    }
    this.space()
    this.expect('>')
  }

  /** Any other markup declaration, skipped to its closing bracket outside quotes. */
  private declaration() {
    while (this.at < this.source.length && this.source[this.at] !== '>') {
      if (this.source[this.at] === '"' || this.source[this.at] === "'") this.quoted()
      else this.at++
    }
    this.expect('>')
  }

  private character(code: string): string {
    const value = code[0] === 'x' ? parseInt(code.slice(1), 16) : parseInt(code, 10)
    if (!(value === 9 || value === 10 || value === 13 || (value >= 0x20 && value <= 0xd7ff) || (value >= 0xe000 && value <= 0xfffd) || (value >= 0x10000 && value <= 0x10ffff))) fail()
    return String.fromCodePoint(value)
  }

  /** A reference after "&": a character, a predefined entity or one declared in the DOCTYPE. */
  private reference(depth = 0): string {
    this.at++
    if (this.startsWith('#')) {
      this.at++
      const match = /x[0-9a-fA-F]+;|[0-9]+;/y
      match.lastIndex = this.at
      const found = match.exec(this.source)
      if (!found) fail()
      this.at = match.lastIndex
      return this.character(found![0].slice(0, -1))
    }
    const name = this.name()
    this.expect(';')
    return this.expand(name, depth)
  }

  private expand(name: string, depth: number): string {
    const predefined = PREDEFINED.get(name)
    if (predefined !== undefined) return predefined
    const value = this.entities.get(name)
    // Markup inside an entity would become elements in expat; that is not supported here, so it counts as unreadable.
    if (value === undefined || depth > 16 || value.includes('<')) fail()
    return new Parser(value).replacement(this.entities, depth + 1)
  }

  /** The text an entity stands for, with its own references expanded. */
  private replacement(entities: Map<string, string>, depth: number): string {
    for (const [key, value] of entities) this.entities.set(key, value)
    let text = ''
    while (this.at < this.source.length) {
      const amp = this.source.indexOf('&', this.at)
      if (amp < 0) { text += this.source.slice(this.at); break }
      text += this.source.slice(this.at, amp)
      this.at = amp
      text += this.reference(depth)
    }
    return text
  }

  /** Attribute value: references expanded, literal tabs and newlines become spaces, "<" is not allowed. */
  private attributeValue(): string {
    const raw = this.quoted()
    if (raw.includes('<')) fail()
    if (!raw.includes('&')) return raw.replace(/[\t\n]/g, ' ')
    const inner = new Parser(raw)
    inner.entities.clear()
    for (const [key, value] of this.entities) inner.entities.set(key, value)
    let value = ''
    while (inner.at < raw.length) {
      const amp = raw.indexOf('&', inner.at)
      const end = amp < 0 ? raw.length : amp
      value += raw.slice(inner.at, end).replace(/[\t\n]/g, ' ')
      inner.at = end
      if (amp >= 0) value += inner.reference()
    }
    return value
  }

  /** A start tag after "<"; returns the element, its raw name and scope, and whether it was empty ("/>"). */
  private startTag(scope: Map<string, string>): { open: Open; empty: boolean } {
    this.at++
    const name = this.name()
    const raw: [string, string][] = []
    let empty = false
    for (;;) {
      const spaced = this.space()
      if (this.startsWith('>')) { this.at++; break }
      if (this.startsWith('/>')) { this.at += 2; empty = true; break }
      if (!spaced) fail()
      const attribute = this.name()
      this.space()
      this.expect('=')
      this.space()
      if (raw.some(([existing]) => existing === attribute)) fail()
      raw.push([attribute, this.attributeValue()])
    }

    // Namespace declarations apply to the element that carries them.
    let inner = scope
    for (const [attribute, value] of raw) {
      if (attribute === 'xmlns') {
        if (inner === scope) inner = new Map(scope)
        inner.set('', value)
      } else if (attribute.startsWith('xmlns:')) {
        const prefix = attribute.slice(6)
        if (!NCNAME.test(prefix) || prefix === 'xmlns' || value === '' || (prefix === 'xml') !== (value === XML_NAMESPACE)) fail()
        if (inner === scope) inner = new Map(scope)
        inner.set(prefix, value)
      }
    }
    const attrib = new Map<string, string>()
    for (const [attribute, value] of raw) {
      if (attribute === 'xmlns' || attribute.startsWith('xmlns:')) continue
      const expanded = expandName(attribute, inner, false)
      if (attrib.has(expanded)) fail()
      attrib.set(expanded, value)
    }
    const element = new XmlElement(expandName(name, inner, true), attrib)
    return { open: { element, name, scope: inner, text: '', hasChild: false }, empty }
  }

  /** The whole document: prolog, one root element, then only comments, instructions and whitespace. */
  document(): XmlElement {
    if (this.startsWith('\ufeff')) this.at++
    if (this.startsWith('<?xml') && /[ \t\n?]/.test(this.source[this.at + 5] ?? '')) {
      DECLARATION.lastIndex = this.at
      if (!DECLARATION.exec(this.source)) fail()
      this.at = DECLARATION.lastIndex
    }
    let doctype = false
    for (;;) {
      this.space()
      if (this.startsWith('<!--')) this.comment()
      else if (this.startsWith('<?')) this.instruction()
      else if (this.startsWith('<!DOCTYPE') && !doctype) { this.doctype(); doctype = true }
      else if (this.startsWith('<') && !this.startsWith('<!')) break
      else fail() // Text before the root, a second DOCTYPE, or no element at all.
    }
    const root = this.content()
    for (;;) {
      this.space()
      if (this.at >= this.source.length) return root
      if (this.startsWith('<!--')) this.comment()
      else if (this.startsWith('<?')) this.instruction()
      else fail() // "junk after document element"
    }
  }

  /** The root element and everything inside it, without recursion so deep nesting cannot overflow the stack. */
  private content(): XmlElement {
    const base = new Map([['xml', XML_NAMESPACE]])
    const first = this.startTag(base)
    if (first.empty) return first.open.element
    const stack: Open[] = [first.open]
    const addText = (text: string) => {
      const top = stack[stack.length - 1]!
      if (!top.hasChild) top.text += text
    }
    while (stack.length) {
      const next = this.source.indexOf('<', this.at)
      const end = next < 0 ? this.source.length : next
      // Character data: references expanded, "]]>" not allowed.
      let chunk = this.source.slice(this.at, end)
      if (chunk.includes(']]>')) fail()
      while (chunk) {
        const amp = chunk.indexOf('&')
        if (amp < 0) { addText(chunk); break }
        addText(chunk.slice(0, amp))
        this.at += amp
        addText(this.reference())
        chunk = this.source.slice(this.at, end)
      }
      this.at = end
      if (next < 0) fail() // An element is never closed.
      if (this.startsWith('</')) {
        this.at += 2
        const name = this.name()
        this.space()
        this.expect('>')
        const closed = stack.pop()!
        if (closed.name !== name) fail()
        if (closed.text) closed.element.text = closed.text
      } else if (this.startsWith('<!--')) {
        this.comment()
      } else if (this.startsWith('<![CDATA[')) {
        this.at += 9
        addText(this.until(']]>'))
      } else if (this.startsWith('<?')) {
        this.instruction()
      } else if (this.startsWith('<!')) {
        fail()
      } else {
        const parent = stack[stack.length - 1]!
        const { open, empty } = this.startTag(parent.scope)
        parent.element.children.push(open.element)
        if (!parent.hasChild) { parent.hasChild = true; if (parent.text) parent.element.text = parent.text }
        if (!empty) stack.push(open)
      }
    }
    return first.open.element
  }
}

/** "{uri}local" for a bound prefix (or the default namespace for elements); an unbound prefix is an error. */
function expandName(name: string, scope: Map<string, string>, element: boolean): string {
  const colon = name.indexOf(':')
  if (colon < 0) {
    const uri = element ? scope.get('') : undefined
    return uri ? `{${uri}}${name}` : name
  }
  const prefix = name.slice(0, colon), local = name.slice(colon + 1)
  if (!NCNAME.test(prefix) || !NCNAME.test(local)) fail()
  const uri = scope.get(prefix)
  if (!uri) fail()
  return `{${uri}}${local}`
}

/** Python's ET.fromstring(text): the root element, or null when the text is not well-formed XML. */
export function parseXml(text: unknown): XmlElement | null {
  if (typeof text !== 'string' || INVALID.test(text)) return null
  try {
    // Line ends are normalised before parsing, as expat does; "&#13;" still yields a carriage return.
    return new Parser(text.replace(/\r\n?/g, '\n')).document()
  } catch (error) {
    if (error instanceof NotWellFormed) return null
    throw error
  }
}
