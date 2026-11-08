import { afterEach, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { addBack, installBack } from './back.ts'

const ELEMENT = { name: 'crumb' }
/** 页面上的确认框，后打开的排在后面。 */
let modals = []
let clock = 1_000_000
let stop, removeEntry, runs

/** Node 的 EventTarget 移除监听时不认布尔的 capture，这里按浏览器的规矩转一下。 */
class FakeWindow extends EventTarget {
  addEventListener(type, listener, capture) { super.addEventListener(type, listener, { capture: !!capture }) }
  removeEventListener(type, listener, capture) { super.removeEventListener(type, listener, { capture: !!capture }) }
}
globalThis.window = new FakeWindow()
globalThis.document = { querySelectorAll: () => modals }
Date.now = () => clock

/** 派发一次输入；target 是焦点所在的元素。返回事件，看它有没有被拦下。 */
function fire(type, fields, target) {
  clock += 1000
  const event = Object.assign(new Event(type, { cancelable: true }), fields)
  if (target) Object.defineProperty(event, 'target', { value: target })
  window.dispatchEvent(event)
  return event
}
const altLeft = (target, extra) => fire('keydown', { key: 'ArrowLeft', altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, ...extra }, target)
const field = (tag) => ({ isContentEditable: false, matches: selector => selector.split(', ').includes(tag) })

beforeEach(() => {
  modals = []
  runs = 0
  stop = installBack()
  removeEntry = addBack({ run: () => { runs++ }, element: () => ELEMENT })
})
afterEach(() => {
  stop()
  removeEntry()
})

test('Alt+Left, the BrowserBack key and the mouse back button all run the back that is on screen', () => {
  assert.equal(altLeft().defaultPrevented, true)
  assert.equal(runs, 1)
  assert.equal(fire('keydown', { key: 'BrowserBack' }).defaultPrevented, true)
  assert.equal(runs, 2)
  assert.equal(fire('mouseup', { button: 3 }).defaultPrevented, true)
  assert.equal(runs, 3)
})

test('other keys and buttons are left alone, including AltGr+Left, which reports Ctrl and Alt together', () => {
  assert.equal(fire('mouseup', { button: 0 }).defaultPrevented, false)
  assert.equal(altLeft(undefined, { ctrlKey: true }).defaultPrevented, false)
  assert.equal(altLeft(undefined, { shiftKey: true }).defaultPrevented, false)
  assert.equal(altLeft(undefined, { key: 'ArrowRight' }).defaultPrevented, false)
  assert.equal(altLeft(undefined, { altKey: false }).defaultPrevented, false)
  assert.equal(runs, 0)
})

test('without a back on screen nothing is intercepted', () => {
  removeEntry()
  assert.equal(altLeft().defaultPrevented, false)
  assert.equal(fire('keydown', { key: 'BrowserBack' }).defaultPrevented, false)
  assert.equal(fire('mouseup', { button: 3 }).defaultPrevented, false)
  assert.equal(runs, 0)
})

test('Alt+Left in a place you can type keeps its own meaning, the other back inputs still work', () => {
  for (const target of [field('input'), field('textarea'), { isContentEditable: true, matches: () => false }]) {
    assert.equal(altLeft(target).defaultPrevented, false)
  }
  assert.equal(runs, 0)
  assert.equal(altLeft(field('button')).defaultPrevented, true)
  assert.equal(runs, 1)
  assert.equal(fire('keydown', { key: 'BrowserBack' }, field('input')).defaultPrevented, true)
  assert.equal(runs, 2)
})

test('the newest back wins, and a confirm dialog over it holds it until the dialog is dealt with', () => {
  let inPanel = 0
  const panel = addBack({ run: () => { inPanel++ }, element: () => ({ name: 'panel crumb' }) })
  altLeft()
  assert.deepEqual([runs, inPanel], [0, 1])
  panel()

  modals = [{ contains: () => false }]
  assert.equal(altLeft().defaultPrevented, true)
  assert.equal(runs, 0)
  modals = [{ contains: element => element === ELEMENT }]
  altLeft()
  assert.equal(runs, 1)
})

test('a held key repeating quickly only goes back once', () => {
  altLeft()
  clock -= 900
  altLeft()
  assert.equal(runs, 1)
})

test('stopping removes the listeners', () => {
  stop()
  assert.equal(altLeft().defaultPrevented, false)
  assert.equal(fire('mouseup', { button: 3 }).defaultPrevented, false)
  assert.equal(runs, 0)
})

test('the plugin turns the back inputs on inside an effect, so they stop when it is disabled', () => {
  const index = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8')
  assert.match(index, /ctx\.effect\(\(\) => installBack\(\),/)
})
